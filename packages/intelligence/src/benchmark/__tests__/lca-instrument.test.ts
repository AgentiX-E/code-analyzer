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
  BoundedNodes,
  DECLARATIONS_PER_FILE,
  DECLARATIONS_PER_FILE_LADDER,
  DeclarationCeilingExceeded,
  FIXED_MB,
  LCA_CONFIGS,
  MB_PER_DECLARATION,
  MEASURED_DECLARATION_CEILING,
  MEASURED_DECLARATIONS_PER_FILE,
  MEASURED_MB_PER_FILE,
  MODEL_MARGIN_MB,
  MS_PER_FILE,
  analysableDeclarationBudget,
  checkoutBytes,
  checkoutFileCount,
  checkoutFiles,
  corpusBytes,
  corpusFiles,
  decideInstance,
  fileBudgetAtDensity,
  firstRelevantRank,
  dedupePreservingOrder,
  isTestPath,
  lcaQualityMetrics,
  limitedTotalMb,
  mean,
  modelledAnalysisMb,
  outsideUniverse,
  parseLanguages,
  quantile,
  restrictToUniverse,
  toCorpusPath,
} from '../lca-instrument.js';

import type { InstanceBounds } from '../lca-instrument.js';
import type { GraphNode } from '@code-analyzer/shared';

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

it('converts files at a rung of a ladder the sample was measured against', () => {
  // **The operating density is a published rung, and the direction of its error is now stated rather than the
  // reverse.** Until iteration 79 this case asserted that the rung sat *above* "the sample's median of 117.7", which was
  // the median of the 68 Java and Kotlin rows alone: the 109-row median is 164.6, so the rung sits *below* the median
  // and the bound is more generous than the sample implies. **A test that pinned one published constant to another
  // published constant could not see that** - both were wrong together - so the invariant now names the direction and
  // the coverage it costs is published by the artifact's `density` block instead.
  expect(DECLARATIONS_PER_FILE_LADDER).toContain(DECLARATIONS_PER_FILE);
  expect(DECLARATIONS_PER_FILE).toBeLessThanOrEqual(MEASURED_DECLARATIONS_PER_FILE.median);
});

it('publishes the density it charges against with the rows it was taken over', () => {
  // **A median whose denominator is unstated is a rumour**, and this sample's denominator was the shards that happened
  // to have finished. The figures here are the 109-row ones; the artifact recomputes them from its own rows every run
  // and the gate refuses a block whose row count is smaller than the sample it claims.
  expect(MEASURED_DECLARATIONS_PER_FILE.rows).toBe(109);
  expect(MEASURED_DECLARATIONS_PER_FILE.min).toBeLessThan(MEASURED_DECLARATIONS_PER_FILE.p25);
  expect(MEASURED_DECLARATIONS_PER_FILE.median).toBeLessThan(MEASURED_DECLARATIONS_PER_FILE.p90);
  expect(MEASURED_DECLARATIONS_PER_FILE.p90).toBeLessThan(MEASURED_DECLARATIONS_PER_FILE.max);
  // The three languages do not share a density, **which is the argument against one rung being exact for any of them**.
  const medians = Object.values(MEASURED_DECLARATIONS_PER_FILE.byLanguage).map(
    (entry) => entry.median,
  );
  expect(Math.max(...medians) / Math.min(...medians)).toBeGreaterThan(2);
});

describe('analysableDeclarationBudget', () => {
  /** The model the run of 6 November 2026 fitted over 109 measured instances. */
  const MODEL = {
    mbPerDeclaration: MB_PER_DECLARATION,
    fixedMb: FIXED_MB,
    marginMb: MODEL_MARGIN_MB,
  };

  it('pays the fixed cost and the margin before it counts a single declaration', () => {
    // 6 144 MB ceiling, nothing resident, an analysis that costs 515 MB before it reads a file plus 546 MB of margin -
    // the model's ninetieth-percentile residual - leaves 5 083 MB, at 22 KB per declaration.
    expect(
      analysableDeclarationBudget({ totalMb: 6144, residentMb: 0, reserveMb: 0, ...MODEL }),
    ).toBe(229_999);
  });

  it('is smaller than the per-file arithmetic it replaced, on the same ceiling', () => {
    // **The defect this replaces, as an inequality.** The old arithmetic divided the whole ceiling by 3.7 MB per file
    // and promised 1 660 files - 6 142 MB of the 6 144 MB available, with nothing set aside for the half gigabyte the
    // pipeline spends before it reads anything. The fitted model answers with fewer declarations at the *median* density
    // than that promise, and with the margin it needs.
    const declarations = analysableDeclarationBudget({
      totalMb: 6144,
      residentMb: 0,
      reserveMb: 0,
      ...MODEL,
    });
    const files = fileBudgetAtDensity({ declarations, declarationsPerFile: DECLARATIONS_PER_FILE });
    expect(declarations * MB_PER_DECLARATION + FIXED_MB + MODEL_MARGIN_MB).toBeLessThanOrEqual(
      6144,
    );
    // And it is still a usable bound: the same ceiling affords **3 833 files** at the operating density. **The margin
    // moved this number by 83**, from 1 999 at the mean residual to 1 916 at the ninetieth percentile, which is the
    // whole price of the tail: a tenth of the corpus's error is no longer charged to the instances that do not make it.
    // **And iteration 83 moved the rung from 120 to 60**, so the same declarations now convert to 3 833 files:
    // 1 916 was a cap the artifact published beside a 4 000-file cap, and the two disagreed about the same run.
    expect(files).toBe(3833);
  });

  it('shrinks as the run accumulates resident pages', () => {
    const of = (residentMb: number): number =>
      analysableDeclarationBudget({ totalMb: 6144, residentMb, reserveMb: 0, ...MODEL });
    // The measurement that explains the sharding: V8 keeps reclaimed pages, so a run's resident figure is the
    // high-water mark of every instance it has analysed and the next instance's allowance is smaller than the first's.
    expect(of(0)).toBeGreaterThan(of(1024));
    expect(of(1024)).toBeGreaterThan(of(3072));
    expect(of(3072)).toBeGreaterThan(0);
    // **The margin is paid before the first declaration**, so a run whose resident set leaves less than the fixed cost
    // plus the margin affords nothing at all rather than a negative count.
    expect(of(6144 - FIXED_MB - MODEL_MARGIN_MB)).toBe(0);
  });

  it('is zero rather than negative when the fixed cost alone exceeds the room', () => {
    expect(
      analysableDeclarationBudget({ totalMb: 800, residentMb: 0, reserveMb: 0, ...MODEL }),
    ).toBe(0);
    expect(
      analysableDeclarationBudget({ totalMb: 4096, residentMb: 9000, reserveMb: 0, ...MODEL }),
    ).toBe(0);
  });

  it('refuses to divide by a cost of zero declarations', () => {
    expect(
      analysableDeclarationBudget({
        totalMb: 6144,
        residentMb: 0,
        reserveMb: 0,
        ...MODEL,
        mbPerDeclaration: 0,
      }),
    ).toBe(0);
  });
});

describe('fileBudgetAtDensity', () => {
  it('converts the declaration budget at the density it is given', () => {
    expect(fileBudgetAtDensity({ declarations: 239_954, declarationsPerFile: 120 })).toBe(1999);
    expect(fileBudgetAtDensity({ declarations: 239_954, declarationsPerFile: 20 })).toBe(11_997);
    expect(fileBudgetAtDensity({ declarations: 239_954, declarationsPerFile: 600 })).toBe(399);
  });

  it('is monotone: a denser checkout affords no more files at the same ceiling', () => {
    const files = DECLARATIONS_PER_FILE_LADDER.map((declarationsPerFile) =>
      fileBudgetAtDensity({ declarations: 239_954, declarationsPerFile }),
    );
    for (const [index, value] of files.entries()) {
      if (index === 0) continue;
      expect(value).toBeLessThan(files[index - 1]!);
    }
    // **A factor of thirty across one stated ladder, on one ceiling and one model**: which is why the density is
    // published beside the bound rather than folded into it.
    expect(files[0]! / files.at(-1)!).toBeGreaterThan(20);
  });

  it('answers zero for a density that is not a density', () => {
    expect(fileBudgetAtDensity({ declarations: 1000, declarationsPerFile: 0 })).toBe(0);
    expect(fileBudgetAtDensity({ declarations: 1000, declarationsPerFile: -1 })).toBe(0);
    expect(fileBudgetAtDensity({ declarations: 0, declarationsPerFile: 100 })).toBe(0);
  });
});

describe('modelledAnalysisMb', () => {
  it('charges the fixed cost, the margin and the declarations a checkout is expected to produce', () => {
    // 100 files at the operating density: 12 000 declarations at 22 KB is 265 MB, plus 515 fixed and 546 of margin.
    // **The three terms are the model's, so the expectation is stated as their sum rather than as a number** - the
    // literal 1 106 this replaces was the sum of a margin that has since become a quantile.
    expect(modelledAnalysisMb({ files: 100, declarationsPerFile: DECLARATIONS_PER_FILE })).toBe(
      Math.round(FIXED_MB + MODEL_MARGIN_MB + MB_PER_DECLARATION * 100 * DECLARATIONS_PER_FILE),
    );
    expect(modelledAnalysisMb({ files: 0, declarationsPerFile: DECLARATIONS_PER_FILE })).toBe(
      FIXED_MB + MODEL_MARGIN_MB,
    );
  });

  it('never charges a negative analysis', () => {
    expect(modelledAnalysisMb({ files: -5, declarationsPerFile: 100 })).toBe(
      FIXED_MB + MODEL_MARGIN_MB,
    );
  });

  it('agrees with the budget it is inverted from', () => {
    // **The two functions are one model read in two directions**, so a checkout the budget admits must be estimated
    // inside the ceiling and one it refuses must be estimated outside it.
    const ceiling = 6144;
    const declarations = analysableDeclarationBudget({
      totalMb: ceiling,
      residentMb: 0,
      reserveMb: 0,
      mbPerDeclaration: MB_PER_DECLARATION,
      fixedMb: FIXED_MB,
      marginMb: MODEL_MARGIN_MB,
    });
    const admitted = fileBudgetAtDensity({
      declarations,
      declarationsPerFile: DECLARATIONS_PER_FILE,
    });
    expect(
      modelledAnalysisMb({ files: admitted, declarationsPerFile: DECLARATIONS_PER_FILE }),
    ).toBeLessThanOrEqual(ceiling);
    expect(
      modelledAnalysisMb({ files: admitted + 1, declarationsPerFile: DECLARATIONS_PER_FILE }),
    ).toBeGreaterThan(ceiling);
  });
});

describe('decideInstance', () => {
  const roomy: InstanceBounds = {
    capFiles: 4000,
    elapsedMs: 0,
    budgetMs: 45 * 60_000,
  };

  it('measures what fits inside both bounds', () => {
    expect(decideInstance(568, roomy)).toEqual({ analyse: true });
  });

  it('refuses what is above the stated cap, and says which cap', () => {
    const verdict = decideInstance(4001, roomy);
    expect(verdict.analyse).toBe(false);
    expect(verdict.analyse ? '' : verdict.because).toBe(
      'the analysis would read 4001 files, above the stated cap of 4000',
    );
  });

  it('charges the cap for what the analysis reads, not for what the checkout holds', () => {
    // **The difference the scoping made.** `quarkusio/quarkus` holds a hundred and twenty-eight Kotlin files inside a
    // fifteen-thousand-file checkout; charged for the checkout it was refused, and charged for what the analysis would
    // read it is an ordinary instance. The bound is a promise about the reading, which is what the sentence says.
    expect(decideInstance(128, roomy)).toEqual({ analyse: true });
  });

  it('**admits a checkout the density conversion would have refused**, because the count is not a prediction', () => {
    // **This is the iteration.** Admission used to divide the memory budget by a density and compare the result with a
    // file count; 43 of the 115 rows of the 6 November 2026 run cost more declarations than that charge, and the two
    // instances the ceiling killed were under-covered by 4.1 and 4.9 GB. A file count converted at a density the
    // checkout's own contents decide is a prediction, and the density spans four orders of magnitude.
    //
    // So a 2 600-file checkout - above the 1 916 the model's budget converted to at 120 declarations per file - is now
    // admitted, and the guard in the child process is what decides whether it can be measured.
    expect(decideInstance(2600, roomy)).toEqual({ analyse: true });
    // **And it is still a bound**: the cap is applied before anything is started.
    expect(decideInstance(4001, roomy).analyse).toBe(false);
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

describe('BoundedNodes', () => {
  const node = (id: number, qualifiedName: string): GraphNode =>
    ({ id, qualifiedName }) as unknown as GraphNode;

  it('holds exactly the budget and refuses the declaration past it', () => {
    const nodes = new BoundedNodes(3);
    for (let index = 1; index <= 3; index += 1) nodes.set(index, node(index, `a${String(index)}`));
    expect(nodes.size).toBe(3);
    expect(nodes.crossedAt).toBeNull();
    expect(() => nodes.set(4, node(4, 'a4'))).toThrow(DeclarationCeilingExceeded);
    expect(nodes.size).toBe(3);
    expect(nodes.crossedAt).toBe(4);
  });

  it('reports the crossing as the declaration that was refused, not as the budget', () => {
    const nodes = new BoundedNodes(2);
    nodes.set(1, node(1, 'a'));
    nodes.set(2, node(2, 'b'));
    expect(() => nodes.set(9, node(9, 'c'))).toThrow(/reached 3 declarations/);
    expect(nodes.crossedAt).toBe(3);
  });

  it('does not charge an update to a declaration it already holds', () => {
    // **A graph that rewrites a node is not a graph that grew.** Several phases replace a node in place - a resolution
    // pass that fills in a parent, a prune that rewrites a property - and charging those would stop an analysis that was
    // not costing any memory.
    const nodes = new BoundedNodes(1);
    nodes.set(1, node(1, 'a'));
    nodes.set(1, node(1, 'a'));
    expect(nodes.size).toBe(1);
    expect(nodes.crossedAt).toBeNull();
  });

  it('refuses a budget that is not a budget, rather than guarding nothing', () => {
    // **A guard of zero refuses the first declaration**, which looks like a working guard and is a missing one; a guard
    // of `NaN` compares false against everything and stops nothing. Both are caller mistakes that would be invisible in
    // an artifact, so they are thrown where the caller can see them.
    expect(() => new BoundedNodes(0)).toThrow(RangeError);
    expect(() => new BoundedNodes(-1)).toThrow(RangeError);
    expect(() => new BoundedNodes(Number.NaN)).toThrow(RangeError);
  });

  it('carries the sentence the artifact publishes, with both numbers in it', () => {
    const error = new DeclarationCeilingExceeded(237_797, 237_796);
    expect(error.declarations).toBe(237_797);
    expect(error.budget).toBe(237_796);
    expect(error.message).toContain('237797');
    expect(error.message).toContain('237796');
  });
});

describe('the measured declaration ceiling', () => {
  it('is a record of a sample, so it states the rows and the runner it was taken on', () => {
    expect(MEASURED_DECLARATION_CEILING.rows).toBeGreaterThan(0);
    expect(MEASURED_DECLARATION_CEILING.declarations).toBeGreaterThan(0);
    expect(MEASURED_DECLARATION_CEILING.ceilingMb).toBeGreaterThan(0);
    expect(MEASURED_DECLARATION_CEILING.repo).toMatch(/\S+\/\S+/);
  });

  it('is the largest count the sample produced and completed, **not the count the model affords**', () => {
    // The two disagree, and the disagreement is the finding: the budget the 6 144 MB ceiling affords under the fitted
    // model is 229 999 declarations, while a `wekan/wekan` row of 237 796 declarations **completed** - so the model
    // under-charges by at least 8 000 declarations, and a guard set at the model would have refused a row that ran.
    const affordable = analysableDeclarationBudget({
      totalMb: 6144,
      residentMb: 0,
      reserveMb: 0,
      mbPerDeclaration: MB_PER_DECLARATION,
      fixedMb: FIXED_MB,
      marginMb: MODEL_MARGIN_MB,
    });
    expect(affordable).toBe(229_999);
    expect(MEASURED_DECLARATION_CEILING.declarations).toBeGreaterThan(affordable);
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

describe('quantile', () => {
  it('interpolates between the order statistics that bracket the position', () => {
    // **`numpy.percentile`'s default**, so a reader checking the artifact in a notebook gets the published figure.
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([10], 0.9)).toBe(10);
  });

  it('answers the extremes exactly, and clamps a probability outside the unit interval', () => {
    expect(quantile([4, 1, 3], 0)).toBe(1);
    expect(quantile([4, 1, 3], 1)).toBe(4);
    expect(quantile([4, 1, 3], 2)).toBe(4);
    expect(quantile([4, 1, 3], -1)).toBe(1);
  });

  it('answers zero for an empty sample rather than throwing', () => {
    // The caller publishes its row count beside the figure, so a zero with no rows is visible rather than silent.
    expect(quantile([], 0.5)).toBe(0);
  });
});
