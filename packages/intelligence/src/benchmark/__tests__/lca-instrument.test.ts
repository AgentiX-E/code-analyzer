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
  averagePrecision,
  LCA_CONFIGS,
  MEASURED_MB_PER_FILE,
  MS_PER_FILE,
  RUNNER_RESERVE_MB,
  analysableFileBudget,
  checkoutBytes,
  checkoutFileCount,
  checkoutFiles,
  corpusBytes,
  corpusFiles,
  decideInstance,
  firstRelevantRank,
  dedupePreservingOrder,
  isTestPath,
  lcaQualityMetrics,
  limitedTotalMb,
  mean,
  outsideUniverse,
  parseLanguages,
  restrictToUniverse,
  toCorpusPath,
} from '../lca-instrument.js';

import type { InstanceBounds } from '../lca-instrument.js';

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

  it('strips a checkout that the path already carries, because the pipeline joined a relative root', () => {
    // **The second published zero's signature.** The workflow unpacks the corpus at a relative path, so the pipeline's
    // `join(rootPath, file)` yields `benchmarks/.../checkouts/o__n/src/app.py` - relative, checkout included. Treating
    // it as checkout-relative joined the checkout onto itself and matched nothing: `offered: 0, outside: 10..17`.
    expect(
      toCorpusPath(
        'benchmarks/corpora/lca/checkouts/thealgorithms__python',
        'benchmarks/corpora/lca/checkouts/thealgorithms__python/strings/anagram.py',
      ),
    ).toBe('strings/anagram.py');
  });

  it('leaves a path that is already corpus-relative alone even when the checkout is absolute', () => {
    expect(toCorpusPath('/checkouts/flask', 'src/flask/sessions.py')).toBe('src/flask/sessions.py');
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

describe('corpusBytes', () => {
  /**
   * **The predictor the memory bound never had.** Every refuse rule in the harness was `constant × files`, and the
   * instances that ran showed peak memory per corpus file spanning 1.3 MB to 430 MB, so the quantity the next fit
   * regresses on cannot be a count. What is counted here is the bytes the analysis has to read.
   */
  const build = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'lca-bytes-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/a.py'), 'x'.repeat(300));
    writeFileSync(join(root, 'src/b.py'), 'y'.repeat(700));
    return root;
  };

  it('sums the answer space, in bytes, and reports nothing unreadable', () => {
    const root = build();
    expect(corpusBytes(root, corpusFiles(root, '.py'))).toEqual({ bytes: 1_000, unreadable: 0 });
  });

  it('counts a file that is not there instead of throwing, and says how many', () => {
    // **The race is the point**: a file can vanish between the walk that found it and the stat that sizes it, and a
    // total that silently drops it is a predictor short by an unknown amount. The count is what excludes the row.
    expect(corpusBytes(build(), ['src/a.py', 'src/gone.py'])).toEqual({
      bytes: 300,
      unreadable: 1,
    });
  });

  it('is zero over an answer space with no files', () => {
    expect(corpusBytes(build(), [])).toEqual({ bytes: 0, unreadable: 0 });
  });

  it('reports every file of an answer space that has all gone as unreadable', () => {
    expect(corpusBytes(build(), ['src/gone.py', 'src/also-gone.py'])).toEqual({
      bytes: 0,
      unreadable: 2,
    });
  });
});

describe('checkoutFileCount', () => {
  /**
   * **The bound that decides whether an instance is measurable has to count what the work counts.** It was computed
   * from `corpusFiles` — the configuration's extension, tests excluded — and `ccxt/ccxt` passed it with 686 Python
   * files while the checkout held tens of thousands of others. The pipeline is handed the directory, so the bound is
   * the directory's size.
   */
  const build = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'lca-checkout-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'src/a.py'), '');
    writeFileSync(join(root, 'src/b.js'), '');
    writeFileSync(join(root, 'tests/c.py'), '');
    writeFileSync(join(root, 'README.md'), '');
    writeFileSync(join(root, '.git/d'), '');
    return root;
  };

  it('counts every file the pipeline will read, and not the .git directory', () => {
    // Four files: two Python, one JavaScript, one Markdown - and **the test file and the other language count**, which
    // is exactly the difference between this and `corpusFiles`.
    expect(checkoutFileCount(build())).toBe(4);
  });

  it('counts more than the corpus does whenever the checkout holds another language', () => {
    const root = build();
    expect(corpusFiles(root, '.py')).toEqual(['src/a.py']);
    expect(checkoutFileCount(root)).toBeGreaterThan(corpusFiles(root, '.py').length);
  });

  it('is zero for an empty checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'lca-empty-'));
    expect(checkoutFileCount(root)).toBe(0);
  });
});

describe('checkoutBytes', () => {
  /**
   * **The predictor the first fit said was the right one.** Regressing peak memory on the answer space explained 39 %
   * of the variance: `appium/appium` has 52 Java files worth 122 KB and cost 3 074 MB, because the pipeline parses every
   * file it is handed rather than the corpus's extension. This counts what the pipeline is handed.
   */
  const build = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'lca-checkout-bytes-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'src/a.py'), 'x'.repeat(100));
    writeFileSync(join(root, 'src/b.js'), 'y'.repeat(200));
    writeFileSync(join(root, 'README.md'), 'z'.repeat(50));
    writeFileSync(join(root, '.git/HEAD'), 'w'.repeat(999));
    return root;
  };

  it('counts every file the pipeline will read and not the .git directory', () => {
    // 100 + 200 + 50, and **the other language counts**, which is exactly the difference between this and `corpusBytes`.
    expect(checkoutBytes(build())).toEqual({ bytes: 350, unreadable: 0 });
  });

  it('counts more than the answer space does, which is why the bound has to read it', () => {
    const root = build();
    expect(checkoutBytes(root).bytes).toBeGreaterThan(
      corpusBytes(root, corpusFiles(root, '.py')).bytes,
    );
  });

  it('is zero for an empty checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'lca-checkout-empty-'));
    expect(checkoutBytes(root)).toEqual({ bytes: 0, unreadable: 0 });
  });

  it('does not follow a symlink, because the count and the byte total have to agree about what a file is', () => {
    // **One walk, three readers.** A count that skipped a symlink while the byte total followed it would be two
    // statements about one checkout; `checkoutFiles` is the single answer both of them read.
    const root = build();
    symlinkSync(join(root, 'src/a.py'), join(root, 'src/link.py'));
    symlinkSync(join(root, 'nowhere'), join(root, 'src/dangling.py'));
    expect(checkoutFiles(root)).toEqual(['README.md', 'src/a.py', 'src/b.js']);
    expect(checkoutBytes(root)).toEqual({ bytes: 350, unreadable: 0 });
    expect(checkoutFileCount(root)).toBe(3);
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

// ---------------------------------------------------------------------------
// The bounds on one analysis
// ---------------------------------------------------------------------------
//
// **The job this protects never finished.** Eleven runs, every one ending in a runner shutdown signal with no figure, at
// a hundredth of the scope as well as at the full sample. The bound that existed was a number of files chosen by hand;
// what was missing was an arithmetic statement of what the machine can afford and of what the job has left to spend, so
// that an instance which would not finish is a recorded skip rather than a dead job.

describe('analysableFileBudget', () => {
  it('turns the machine’s remaining memory into a file count', () => {
    // 7 GB runner, 400 MB resident, a gigabyte of reserve, and the measured 3.7 MB per file.
    expect(
      analysableFileBudget({
        totalMb: 7168,
        residentMb: 400,
        reserveMb: RUNNER_RESERVE_MB,
        mbPerFile: MEASURED_MB_PER_FILE,
      }),
    ).toBe(1552);
  });

  it('shrinks as the run accumulates resident pages', () => {
    const of = (residentMb: number): number =>
      analysableFileBudget({
        totalMb: 7168,
        residentMb,
        reserveMb: RUNNER_RESERVE_MB,
        mbPerFile: MEASURED_MB_PER_FILE,
      });
    // The measurement that explains the sharding: V8 keeps reclaimed pages, so a run's resident figure is the
    // high-water mark of every instance it has analysed and the next instance's allowance is smaller than the first's.
    expect(of(400)).toBeGreaterThan(of(3072));
    expect(of(3072)).toBeGreaterThan(of(5120));
  });

  it('is zero rather than negative when there is no room', () => {
    expect(
      analysableFileBudget({
        totalMb: 4096,
        residentMb: 4000,
        reserveMb: RUNNER_RESERVE_MB,
        mbPerFile: 3.7,
      }),
    ).toBe(0);
    expect(
      analysableFileBudget({ totalMb: 4096, residentMb: 9000, reserveMb: 0, mbPerFile: 3.7 }),
    ).toBe(0);
  });

  it('refuses to divide by a cost of zero files', () => {
    expect(analysableFileBudget({ totalMb: 7168, residentMb: 0, reserveMb: 0, mbPerFile: 0 })).toBe(
      0,
    );
  });
});

describe('decideInstance', () => {
  const roomy: InstanceBounds = {
    capFiles: 2000,
    budgetFiles: 1500,
    elapsedMs: 0,
    budgetMs: 45 * 60_000,
    residentMb: 400,
    reserveMb: RUNNER_RESERVE_MB,
  };

  it('measures what fits inside all three bounds', () => {
    expect(decideInstance(568, roomy)).toEqual({ analyse: true });
  });

  it('refuses what is above the stated cap, and says which cap', () => {
    const verdict = decideInstance(2001, roomy);
    expect(verdict.analyse).toBe(false);
    expect(verdict.analyse ? '' : verdict.because).toBe(
      'the checkout holds 2001 files, above the stated cap of 2000',
    );
  });

  it('refuses what the remaining memory cannot afford, in megabytes and in files', () => {
    const verdict = decideInstance(1200, {
      ...roomy,
      residentMb: 3072,
      budgetFiles: 830,
    });
    expect(verdict.analyse ? '' : verdict.because).toBe(
      'an analysis of 1200 files is estimated at 4440 MB resident (3.7 MB per file) and only 830 files of room remain ' +
        'above a 1024 MB reserve, with 3072 MB resident',
    );
  });

  it('refuses what would end past the job’s own budget', () => {
    const verdict = decideInstance(700, {
      ...roomy,
      // Forty-four minutes fifty seconds spent, and a 35 s analysis left to run against a 45-minute budget.
      elapsedMs: 2_690_000,
      budgetMs: 45 * 60_000,
    });
    expect(verdict.analyse ? '' : verdict.because).toBe(
      "an analysis of 700 files is estimated at 35000 ms and would end at 2725000 ms, past this job's budget of " +
        '2700000 ms',
    );
  });

  it('applies the cap before the memory bound, so a reader is told the bound somebody chose', () => {
    const verdict = decideInstance(5000, { ...roomy, budgetFiles: 100 });
    expect(verdict.analyse ? '' : verdict.because).toContain('above the stated cap');
  });

  it('uses the measured per-file costs rather than a second copy of them', () => {
    const verdict = decideInstance(100, {
      ...roomy,
      elapsedMs: 0,
      budgetMs: MS_PER_FILE * 100 - 1,
    });
    expect(verdict.analyse ? '' : verdict.because).toContain(
      `estimated at ${String(100 * MS_PER_FILE)} ms`,
    );
    expect(MEASURED_MB_PER_FILE).toBe(3.7);
  });
});

describe('limitedTotalMb', () => {
  const SEVEN_GB = 7 * 1024 * 1024 * 1024;

  it('answers with the cgroup’s limit when one is smaller than the machine', () => {
    expect(limitedTotalMb(String(SEVEN_GB), 64 * 1024 * 1024 * 1024)).toBe(7168);
  });

  it('never answers more than the machine reports', () => {
    expect(limitedTotalMb(String(64 * 1024 * 1024 * 1024), SEVEN_GB)).toBe(7168);
  });

  it('falls back to the machine’s own figure for every unreadable limit', () => {
    expect(limitedTotalMb(null, SEVEN_GB)).toBe(7168);
    expect(limitedTotalMb('max', SEVEN_GB)).toBe(7168);
    expect(limitedTotalMb('   ', SEVEN_GB)).toBe(7168);
    expect(limitedTotalMb('0', SEVEN_GB)).toBe(7168);
    expect(limitedTotalMb('-1', SEVEN_GB)).toBe(7168);
    expect(limitedTotalMb('lots', SEVEN_GB)).toBe(7168);
  });
});

describe('parseLanguages', () => {
  it('measures all three splits when nothing is asked for', () => {
    expect(parseLanguages(undefined)).toEqual(['py', 'java', 'kt']);
    expect(parseLanguages('')).toEqual(['py', 'java', 'kt']);
    expect(parseLanguages('  ,  ')).toEqual(['py', 'java', 'kt']);
  });

  it('measures the one split a job was given', () => {
    expect(parseLanguages('java')).toEqual(['java']);
  });

  it('drops a repeat rather than measuring a split twice', () => {
    expect(parseLanguages('py,py,java')).toEqual(['py', 'java']);
  });

  it('answers with nothing when the specification names nothing valid', () => {
    // **Not with everything**: a typo would otherwise start a ninety-minute job nobody asked for.
    expect(parseLanguages('js')).toEqual([]);
    expect(parseLanguages('py,js')).toEqual(['py']);
  });
});

describe('averagePrecision', () => {
  it('is one when the first file named is the answer', () => {
    expect(averagePrecision(['src/retry.py', 'src/http.py'], ['src/retry.py'], 200)).toBe(1);
  });

  it('is the reciprocal rank when there is one answer and it is not first', () => {
    // precision at the rank where the answer sits, divided by the number of relevant files.
    expect(averagePrecision(['src/http.py', 'src/retry.py'], ['src/retry.py'], 200)).toBe(0.5);
  });

  it('averages the precisions at both ranks when two answers are found', () => {
    // P@1 = 1, P@3 = 2/3, and the mean of those is the average precision.
    const ap = averagePrecision(['a', 'b', 'c', 'd'], ['a', 'c'], 200);
    expect(ap).toBeCloseTo((1 + 2 / 3) / 2, 10);
  });

  it('counts an answer the depth never reaches as missing', () => {
    // **A truncated list can only lose credit**, which is why the published column says it is a floor.
    expect(averagePrecision(['a', 'b', 'c', 'd'], ['d'], 3)).toBe(0);
    expect(averagePrecision(['a', 'b', 'c', 'd'], ['d'], 4)).toBe(0.25);
  });

  it('answers zero for a row with no relevant file rather than dividing by none', () => {
    expect(averagePrecision(['a'], [], 200)).toBe(0);
  });

  it('answers zero for an empty ranking and for a depth of zero', () => {
    expect(averagePrecision([], ['a'], 200)).toBe(0);
    expect(averagePrecision(['a'], ['a'], 0)).toBe(0);
  });
});

describe('firstRelevantRank', () => {
  it('counts from one, because a rank is a position and not an offset', () => {
    expect(firstRelevantRank(['a', 'b', 'c'], ['c'])).toBe(3);
  });

  it('is one when the answer leads', () => {
    expect(firstRelevantRank(['a', 'b'], ['a'])).toBe(1);
  });

  it('answers null when the ranking never reaches an answer', () => {
    // **The difference this function exists to express**: a list that does not contain the answer and a list that
    // contains it in last place are both "a low average precision", and only one of them is a ranking problem.
    expect(firstRelevantRank(['a', 'b'], ['c'])).toBeNull();
  });

  it('answers null for an empty ranking or an instance with no relevant file', () => {
    expect(firstRelevantRank([], ['a'])).toBeNull();
    expect(firstRelevantRank(['a'], [])).toBeNull();
  });

  it('takes the earliest of several answers', () => {
    expect(firstRelevantRank(['a', 'b', 'c', 'd'], ['d', 'b'])).toBe(2);
  });
});
