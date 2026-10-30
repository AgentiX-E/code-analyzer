// The instrument's own tests, and the reason they exist.
//
// **The bug-localisation harness published 0.0000 three times over before anything here was tested.** The corpus was
// fine, the repositories were fine, the retriever was fine: the product reports absolute paths and the corpus records
// repository-relative ones, so the intersection was empty on every instance in every language. No fixture in the suite
// could have caught it, because the harness only runs when a corpus directory is supplied and the conversion lived
// inside one `it()` block.
//
// These cases are cheap, need no corpus and no network, and every one of them is a way the figure can be a property of
// the harness rather than of the product: a path that was mangled, a test file that was counted, a filter that
// reordered the ranking, a metric that rounds differently from the authors'.

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONFIG_EXTENSION,
  LCA_CONFIGS,
  corpusFiles,
  dedupePreservingOrder,
  isTestPath,
  lcaQualityMetrics,
  mean,
  outsideUniverse,
  restrictToUniverse,
  toCorpusPath,
} from '../lca-instrument.js';

describe('toCorpusPath', () => {
  it('reduces an absolute path to the corpus’s own form', () => {
    expect(toCorpusPath('/checkouts/express', '/checkouts/express/lib/application.js')).toBe(
      'lib/application.js',
    );
  });

  it('leaves a relative path relative, resolved against the checkout', () => {
    expect(toCorpusPath('/checkouts/express', 'lib/application.js')).toBe('lib/application.js');
  });

  it('normalises a relative path that walks out and back', () => {
    expect(toCorpusPath('/checkouts/express', './lib/../lib/router.js')).toBe('lib/router.js');
  });

  it('refuses to pretend a path outside the checkout is inside it', () => {
    expect(toCorpusPath('/checkouts/express', '/elsewhere/vendor/x.py')).toBe(
      '../../elsewhere/vendor/x.py',
    );
  });
});

describe('isTestPath', () => {
  it.each([
    ['tests/test_parser.py', true],
    ['test/test_parser.py', true],
    ['src/__tests__/thing.ts', true],
    ['src/parser_test.go', true],
    ['src/parser.test.ts', true],
    ['src/ParserTests.java', true],
    ['src/ParserTest.kt', true],
    ['specs/a.rb', true],
  ])('%s is a test file: %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });

  it.each([
    ['src/parser.py', false],
    ['contest/entry.java', false],
    ['src/testing_utils.py', false],
    // **A directory is a test directory when it is named one, not when it starts with the letters.** A prefix rule
    // would take `test_helpers/` - and `contest/` with it - so the harness names the six directories the three
    // languages in this corpus actually use and leaves the rest in the answer space, where being wrong about them
    // costs precision rather than shrinking `all_files` and inflating FPR.
    ['src/test_helpers/util.py', false],
    ['src/Parser.java', false],
    ['README.md', false],
    // **No separator at all**: the whole path is the file name, which is the branch a `?? ''` would have made dead.
    ['test_parser.py', true],
  ])('%s is not a test file: %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });
});

describe('corpusFiles', () => {
  const build = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'lca-instrument-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'src/b.py'), '');
    writeFileSync(join(root, 'src/a.py'), '');
    writeFileSync(join(root, 'src/c.java'), '');
    writeFileSync(join(root, 'src/d_test.py'), '');
    writeFileSync(join(root, 'tests/e.py'), '');
    writeFileSync(join(root, '.git/f.py'), '');
    writeFileSync(join(root, 'node_modules/g.py'), '');
    writeFileSync(join(root, 'README.md'), '');
    // **A symlink, because a released checkout has them and a directory walk meets them.** It is neither a file nor a
    // directory to `readdir`, so a walk that only skips `.git` and `node_modules` and then assumes a file would count
    // one twice, once through the link and once through its target.
    symlinkSync(join(root, 'src/a.py'), join(root, 'src/link.py'));
    return root;
  };

  it('counts the configuration’s files, sorted, and nothing else', () => {
    expect(corpusFiles(build(), '.py')).toEqual(['src/a.py', 'src/b.py']);
  });

  it('skips .git and node_modules', () => {
    const files = corpusFiles(build(), '.py');
    expect(files.some((file) => file.startsWith('.git/'))).toBe(false);
    expect(files.some((file) => file.startsWith('node_modules/'))).toBe(false);
  });

  it('skips test files by the baseline’s rule', () => {
    expect(corpusFiles(build(), '.py')).not.toContain('src/d_test.py');
    expect(corpusFiles(build(), '.py')).not.toContain('tests/e.py');
  });

  it('does not count a symlink as a file of its own', () => {
    const files = corpusFiles(build(), '.py');
    expect(files).not.toContain('src/link.py');
    expect(files.filter((file) => file.endsWith('a.py')).length).toBe(1);
  });

  it('returns an empty list for a checkout with none of the extension', () => {
    expect(corpusFiles(build(), '.kt')).toEqual([]);
  });
});

describe('the answer space', () => {
  const universe = new Set(['src/a.py', 'src/b.py', 'src/c.py']);

  it('keeps the retriever’s order exactly', () => {
    expect(restrictToUniverse(['src/c.py', 'src/a.py', 'src/b.py'], universe)).toEqual([
      'src/c.py',
      'src/a.py',
      'src/b.py',
    ]);
  });

  it('drops what the corpus does not count and says how much', () => {
    const offered = ['README.md', 'src/a.py', 'History.md'];
    expect(restrictToUniverse(offered, universe)).toEqual(['src/a.py']);
    expect(outsideUniverse(offered, universe)).toBe(2);
  });

  it('collapses duplicates without moving the first occurrence', () => {
    expect(restrictToUniverse(['src/b.py', 'src/a.py', 'src/b.py'], universe)).toEqual([
      'src/b.py',
      'src/a.py',
    ]);
  });

  it('never reports a file twice as outside', () => {
    expect(outsideUniverse(['x.md', 'x.md', 'y.md'], universe)).toBe(2);
  });

  it('is empty when the retriever offered nothing the corpus counts', () => {
    expect(restrictToUniverse(['README.md'], universe)).toEqual([]);
  });

  it('preserves order without filtering', () => {
    expect(dedupePreservingOrder(['b', 'a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });
});

describe('lcaQualityMetrics', () => {
  const all = ['a.py', 'b.py', 'c.py', 'd.py'];

  it('is one everywhere when the answer is exactly the fixing commit', () => {
    const score = lcaQualityMetrics(all, ['a.py'], ['a.py']);
    expect(score).toMatchObject({
      precision: 1,
      recall: 1,
      f1: 1,
      fpr: 0,
      allCorrect: 1,
      atLeastOneCorrect: 1,
      allIncorrect: 0,
      expectedCount: 1,
      actualCount: 1,
      allFilesCount: 4,
      percentOfBugFiles: 0.25,
    });
  });

  it('charges for the files it named that were not needed', () => {
    const score = lcaQualityMetrics(all, ['a.py'], ['a.py', 'b.py']);
    expect(score.precision).toBe(0.5);
    expect(score.recall).toBe(1);
    expect(score.f1).toBeCloseTo(0.6666667, 6);
    expect(score.fpr).toBeCloseTo(1 / 3, 10);
    expect(score.allCorrect).toBe(0);
  });

  it('counts an empty answer as neither correct nor incorrect', () => {
    const score = lcaQualityMetrics(all, ['a.py'], []);
    expect(score.precision).toBe(0);
    expect(score.recall).toBe(0);
    expect(score.f1).toBe(0);
    expect(score.fpr).toBe(0);
    expect(score.allIncorrect).toBe(0);
    expect(score.atLeastOneCorrect).toBe(0);
  });

  it('counts a wrong answer as incorrect', () => {
    const score = lcaQualityMetrics(all, ['a.py'], ['b.py']);
    expect(score.allIncorrect).toBe(1);
    expect(score.precision).toBe(0);
    expect(score.recall).toBe(0);
  });

  it('is zero rather than NaN over an empty file set', () => {
    const score = lcaQualityMetrics([], ['a.py'], ['a.py']);
    expect(score.fpr).toBe(0);
    expect(score.percentOfBugFiles).toBe(0);
  });

  it('does not divide by zero when the fixing commit touched nothing', () => {
    const score = lcaQualityMetrics(all, [], []);
    expect(score.precision).toBe(0);
    expect(score.recall).toBe(0);
    expect(score.f1).toBe(0);
    expect(score.allCorrect).toBe(1);
  });
});

describe('mean', () => {
  it('rounds to four places, as the corpus’s tables do', () => {
    expect(mean([1 / 3, 1 / 3, 1 / 3])).toBe(0.3333);
  });

  it('is zero rather than NaN over no rows', () => {
    expect(mean([])).toBe(0);
  });
});

describe('the configuration table', () => {
  it('names three languages and one extension each', () => {
    expect(LCA_CONFIGS).toEqual(['py', 'java', 'kt']);
    expect(CONFIG_EXTENSION).toEqual({ py: '.py', java: '.java', kt: '.kt' });
  });
});
