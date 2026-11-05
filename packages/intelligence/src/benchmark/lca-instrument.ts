// @code-analyzer/intelligence — the ruler Long Code Arena lends us, and the two conversions it needs
//
// **Why this is a module and not a corner of the measurement.** The bug-localisation harness scored exactly 0.0000 on
// its first real run, in three languages, on every instance, and the figure was a property of the units rather than of
// the retriever: the pipeline records `filePath` as an absolute path because it is handed a root and joins, while the
// corpus records `changed_files` as repository-relative, so set intersection found nothing. A conversion that lives
// inside one `it()` block cannot be tested without a corpus, and a conversion nobody tests is how the next 0.0000 gets
// published. Everything here is pure, and every piece of it has a case in
// `benchmark/__tests__/lca-instrument.test.ts`.
//
// **Three things the corpus fixes and this file obeys rather than re-derives:**
//
// 1. the metric - `get_quality_metrics` from `lca-baselines/bug_localization/.../quality_metrics.py`, transcribed
//    field for field, because a re-derived F1 that rounds differently is a number that cannot be compared with the
//    table it is meant to compare against;
// 2. the coordinate system - repository-relative POSIX paths, which is what `changed_files` holds;
// 3. the answer space - the non-test files with the configuration's extension. The published baselines rank exactly
//    that set, so a `.md` file offered by our retriever is not a candidate that lost, it is a file that was never in
//    the running. Filtering it out is aligning the candidate sets, **not** reordering them: the order the retriever
//    produced is preserved exactly.

import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

/** The three language configurations the corpus publishes. **`mixed` is a fourth and is not measured here.** */
export const LCA_CONFIGS = ['py', 'java', 'kt'] as const;

export type LcaConfigName = (typeof LCA_CONFIGS)[number];

/** The extension a configuration restricts the diff to. */
export const CONFIG_EXTENSION: Record<LcaConfigName, string> = {
  py: '.py',
  java: '.java',
  kt: '.kt',
};

/**
 * Reduce a path the product reports to the form the corpus uses: repository-relative POSIX.
 *
 * **Three forms arrive here and the first version of this function handled two of them by accident.** The pipeline
 * joins its `rootPath` onto a relative path, so when the checkout is given as an absolute path the node carries an
 * absolute path - and when the corpus is unpacked at a *relative* path, as it is in the workflow
 * (`benchmarks/corpora/lca/checkouts/<owner>__<name>`), the node carries that relative path with the checkout already
 * inside it. Treating every relative path as checkout-relative then joined the checkout onto itself and produced
 * `../../benchmarks/corpora/lca/checkouts/<owner>__<name>/src/app.py`, which matches nothing in the universe: the
 * second published run reported `offered: 0, outside: 10..17` on every instance, which is the signature.
 *
 * So: an absolute path is measured from the checkout; a relative path that already begins with the checkout is that
 * path; and a relative path that does not is already in the corpus's own form. **Resolved against the working
 * directory rather than assumed**, because that is the only reading under which all three are the same question.
 */
export function toCorpusPath(checkout: string, file: string): string {
  const absoluteCheckout = resolve(checkout);
  if (isAbsolute(file)) {
    return relative(absoluteCheckout, file).split(sep).join(posix.sep);
  }
  const resolved = resolve(file);
  const fromCheckout = relative(absoluteCheckout, resolved);
  const inside =
    fromCheckout !== '' &&
    fromCheckout !== '..' &&
    !fromCheckout.startsWith(`..${sep}`) &&
    !isAbsolute(fromCheckout);
  // **Inside the checkout means the path carried it**; otherwise the path is already corpus-relative and joins
  // nothing.
  if (inside) return fromCheckout.split(sep).join(posix.sep);
  // **Normalised, not resolved**: `./a/../b.py` is `b.py` in the corpus's form, and it is already relative, so the
  // only thing left to do is the textual part.
  return posix.normalize(file.split(sep).join(posix.sep));
}

/**
 * Whether a path is a test file, by the rule the baseline applies with `ignore_tests`.
 *
 * **Stated rather than imported**, because the authors' helper is Python and this is not; the cases it has to cover
 * are the three languages in the corpus, and the effect of getting it wrong is visible in `allFilesCount` in the
 * artifact.
 */
export function isTestPath(path: string): boolean {
  // **One index rather than a split and a slice**, because `split('/')` always yields at least one element and the
  // `?? ''` a defensive version needs is a branch no input can reach - the kind of dead code this project removes
  // instead of covering.
  const cut = path.lastIndexOf('/');
  const fileName = cut === -1 ? path : path.slice(cut + 1);
  const directories = cut === -1 ? [] : path.slice(0, cut).split('/');
  if (directories.some((segment) => /^(tests?|testing|specs?|__tests__)$/i.test(segment)))
    return true;
  return (
    /^test_/i.test(fileName) ||
    /_test\./i.test(fileName) ||
    /\.(test|spec)\./i.test(fileName) ||
    /Tests?\.(java|kt)$/.test(fileName)
  );
}

/**
 * How many files the pipeline will walk in a checkout, **which is not how many the corpus counts**.
 *
 * **The size bound that decides whether an instance is measurable has to be a bound on the work, and the work is the
 * directory the pipeline is handed.** It was applied to `corpusFiles` — the configuration's own extension, test files
 * excluded — and that is a bound on the *answer space*: `ccxt/ccxt` holds **686 Python files and tens of thousands of
 * others**, passed the bound at 686, and the analysis of the whole checkout is what took the job down. Counting every
 * file except `.git` is the conservative statement of what will be read; `node_modules` is counted because the pipeline
 * walks it too, and a checkout of a JavaScript repository carries one.
 *
 * **Cheap enough to run per instance**: one `readdir` walk, against an analysis that reads and parses every one of them.
 */
export function checkoutFileCount(root: string): number {
  return checkoutFiles(root).length;
}

/**
 * Every file the pipeline will walk, as repository-relative POSIX paths, sorted.
 *
 * **One walk, three readers.** The bound counts these files, the cost fit sums their bytes, and both have to agree about
 * what a file is - a count that skips a symlink while the byte total follows it would be two different statements about
 * one checkout. Sorted for the same reason `corpusFiles` is: a figure that moved because `readdir` returned entries in
 * another order would be a figure about the filesystem.
 */
export function checkoutFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      found.push(relative(root, full).split(sep).join(posix.sep));
    }
  };
  walk(root);
  return found.sort();
}

/**
 * The bytes of every file the pipeline will walk, **which is not the bytes of the answer space**.
 *
 * **`corpusBytes` measured the wrong thing, and the first fit said so.** Regressing peak resident memory on the bytes of
 * the *answer space* explained 39 % of the variance over 24 instances, with a worst miss of 2 113 MB: `appium/appium`
 * holds 52 Java files and 122 KB of them, and its analysis cost 3 074 MB - because the pipeline parses the whole
 * checkout, not the corpus's extension. A model of the work has to count the work.
 *
 * The unreadable case is `corpusBytes`'s, not a second copy of it: a file that vanishes between the walk and the stat is
 * the same race, and it is counted by the same function.
 */
export function checkoutBytes(root: string): CorpusSize {
  return corpusBytes(root, checkoutFiles(root));
}

// ---------------------------------------------------------------------------
// The bound on one analysis, in the two currencies a runner runs out of
// ---------------------------------------------------------------------------

/**
 * Resident megabytes one analysed file costs, **measured rather than guessed**.
 *
 * **The measurement.** Four real checkouts were analysed in one process, three rounds each, recording
 * `process.memoryUsage()` around every analysis (`flask` 249 files, `zod` 226, `commons-lang` 568, `gson` 303):
 *
 *   | checkout | files | nodes | resident after | heap after | analysis |
 *   |---|---|---|---|---|---|
 *   | pallets/flask 3.0.3 | 249 | 10 731 | 417 MB | 174 MB | 2 157 ms |
 *   | colinhacks/zod v3.23.8 | 226 | 17 303 | 791 MB | 421 MB | 4 015 ms |
 *   | apache/commons-lang 3.14.0 | 568 | 62 790 | 2 879 MB | 1 148 MB | 24 851 ms |
 *   | google/gson 2.11.0 | 303 | 29 909 | 3 326 MB | 1 575 MB | 10 174 ms |
 *
 * **And the second half of the measurement matters more than the first**: on the second and third rounds the
 * *resident* figure stayed at 3.4-4.1 GB while the heap fell back to 0.4-1.9 GB. `global.gc()` was unavailable in
 * that process, so this is V8's own scavenging - which returns heap pages to itself and not to the operating system.
 * **A run over N instances therefore costs the high-water mark of all of them, not the largest one**: the job that has
 * never finished was not killed by one enormous repository, it was killed by the sixth medium one.
 *
 * 2 088 MB of resident growth over 568 files is **3.7 MB per file**, and that is the number this bound uses. It is
 * deliberately the Java figure: Kotlin is the same compiler front end and no Kotlin checkout was measured, and a bound
 * that is too generous is the failure mode this module exists to remove.
 */
export const MEASURED_MB_PER_FILE = 3.7;

/**
 * What the rest of the runner needs, in megabytes, **kept back from the analysis**.
 *
 * A GitHub-hosted `ubuntu-latest` runner has 7 GB for a private repository and 16 GB for a public one, and the job
 * shares it with the OS, the checkout on disk, vitest, and - in the answer arm - a provider client. One gigabyte is the
 * reserve; the node heap is capped separately in the workflow so that a heap exhaustion is a named error rather than a
 * runner that disappears.
 */
export const RUNNER_RESERVE_MB = 1024;

/** Milliseconds one analysed file costs, from the same table: 44 ms/file at 568 files, 34 at 303, 9 at 249. */
export const MS_PER_FILE = 50;

/** How large an analysis the remaining memory allows, in files. **Zero when there is no room, never negative.** */
export function analysableFileBudget(input: {
  totalMb: number;
  residentMb: number;
  reserveMb: number;
  mbPerFile: number;
}): number {
  const available = input.totalMb - input.residentMb - input.reserveMb;
  if (available <= 0 || input.mbPerFile <= 0) return 0;
  return Math.floor(available / input.mbPerFile);
}

/**
 * The memory a container actually has, **which is not the memory the machine reports**.
 *
 * The same defect `vitest.config.ts` documents for CPUs, one resource over: a container is handed a 7 GB limit and
 * `os.totalmem()` answers with the host's 16 or 64 GB, so a bound computed from it promises an analysis the cgroup will
 * kill. `memory.max` is read when it exists - the exact same reading as `cpu.max` in the test configuration - and the
 * smaller of the two answers wins. `'max'`, an unreadable file and a nonsensical value all fall back to the machine's
 * own figure, because a bound is only useful if it is never larger than what can really be spent.
 */
export function limitedTotalMb(cgroup: string | null, totalBytes: number): number {
  const fromMachine = Math.floor(totalBytes / 1_048_576);
  if (cgroup === null) return fromMachine;
  const trimmed = cgroup.trim();
  if (trimmed === '' || trimmed === 'max') return fromMachine;
  const bytes = Number(trimmed);
  if (!Number.isFinite(bytes) || bytes <= 0) return fromMachine;
  return Math.min(fromMachine, Math.floor(bytes / 1_048_576));
}

/**
 * The language splits one job measures, from `LCA_LANGUAGES`.
 *
 * **A job per language is the unit of work** (see `lca-merge.ts` for why), so the harness has to be told which one it
 * is. An absent or empty value means all three, which is what a local run wants. **A name that is not a configuration is
 * dropped, and a specification that names nothing valid answers with an empty list rather than with everything**:
 * `LCA_LANGUAGES=js` must measure nothing and be told so, because the alternative - silently measuring all three - is a
 * ninety-minute job the caller did not ask for, and the failure would be invisible until it finished.
 */
export function parseLanguages(spec: string | undefined): LcaConfigName[] {
  if (spec === undefined) return [...LCA_CONFIGS];
  const parts = spec
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (parts.length === 0) return [...LCA_CONFIGS];
  const wanted = parts.filter((name) => (LCA_CONFIGS as readonly string[]).includes(name));
  return [...new Set(wanted)] as LcaConfigName[];
}

/** What one instance is allowed to cost, in files and in milliseconds. */
export interface InstanceBounds {
  /** The bound stated in the artifact, from `LCA_MAX_FILES`. */
  readonly capFiles: number;
  /** The bound the remaining memory allows, from {@link analysableFileBudget}. */
  readonly budgetFiles: number;
  /** Milliseconds this job has already spent. */
  readonly elapsedMs: number;
  /** Milliseconds this job may spend in total. */
  readonly budgetMs: number;
  /** The resident figure the memory bound was computed from, so a skip can quote it. */
  readonly residentMb: number;
  /** The reserve that was subtracted, for the same reason. */
  readonly reserveMb: number;
}

/** Whether an instance is measured, and if not, **which of the three bounds refused it**. */
export type InstanceVerdict =
  { readonly analyse: true } | { readonly analyse: false; readonly because: string };

/**
 * Decide whether one instance is measurable, **before any of it is analysed**.
 *
 * **Three bounds rather than one, because the job has three ways to die and only one of them is a number somebody
 * chose.** A stated cap is a promise to the reader; the memory bound is what the machine can currently afford, which
 * shrinks as the run accumulates resident pages; the time bound is what is left of the job's own budget. **A skip is a
 * row in the artifact with the sentence that produced it**, so the sample's size is explainable without the log.
 */
export function decideInstance(files: number, bounds: InstanceBounds): InstanceVerdict {
  if (files > bounds.capFiles) {
    return {
      analyse: false,
      because: `the checkout holds ${String(files)} files, above the stated cap of ${String(bounds.capFiles)}`,
    };
  }
  if (files > bounds.budgetFiles) {
    const estimatedMb = Math.round(files * MEASURED_MB_PER_FILE);
    return {
      analyse: false,
      because:
        `an analysis of ${String(files)} files is estimated at ${String(estimatedMb)} MB resident ` +
        `(${String(MEASURED_MB_PER_FILE)} MB per file) and only ${String(bounds.budgetFiles)} files of room remain ` +
        `above a ${String(bounds.reserveMb)} MB reserve, with ${String(Math.round(bounds.residentMb))} MB resident`,
    };
  }
  const projectedMs = bounds.elapsedMs + files * MS_PER_FILE;
  if (projectedMs > bounds.budgetMs) {
    return {
      analyse: false,
      because:
        `an analysis of ${String(files)} files is estimated at ${String(files * MS_PER_FILE)} ms and would end at ` +
        `${String(projectedMs)} ms, past this job's budget of ${String(bounds.budgetMs)} ms`,
    };
  }
  return { analyse: true };
}

/**
 * Every file in a checkout that the corpus would count, as repository-relative POSIX paths.
 *
 * Sorted, because the metric is set-based and a figure that moved because `readdir` returned entries in another order
 * would be a figure about the filesystem. `.git` and `node_modules` are skipped: they are not the project's code and
 * counting them would put thousands of files in `all_files` that no issue can be about.
 */
export function corpusFiles(root: string, extension: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(extension)) continue;
      const path = relative(root, full).split(sep).join(posix.sep);
      if (isTestPath(path)) continue;
      found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

/** The size of an answer space, and how many of its files could not be read. */
export interface CorpusSize {
  /** Total bytes of the files that could be read. */
  readonly bytes: number;
  /**
   * How many files could not be read.
   *
   * **A byte count missing files is not a byte count**, so it is published rather than folded into the total: the row
   * carries both numbers and the cost fit skips a row whose `unreadable` is not zero, because a predictor computed over
   * a subset cannot be compared with a cost paid over the whole.
   */
  readonly unreadable: number;
}

/**
 * Sum the sizes of an answer space.
 *
 * **Bytes, not files, because files is the variable that failed.** The harness's two bounds were both
 * `constant × file count`, and the instances that ran showed peak memory per corpus file spanning 1.3 MB to 430 MB -
 * a factor of 330 around the constant of 3.7. A count cannot express that spread; the bytes the analysis has to read
 * are at least the right kind of quantity, and whether they predict the cost is a question the artifact answers with a
 * fit rather than with a constant.
 */
export function corpusBytes(root: string, files: readonly string[]): CorpusSize {
  let bytes = 0;
  let unreadable = 0;
  for (const file of files) {
    try {
      bytes += statSync(join(root, file)).size;
    } catch {
      // **A file that vanished between the walk and the stat** is the expected race, and it is counted rather than
      // ignored: a silenter answer would be a total that is short by an unknown amount and says nothing.
      unreadable += 1;
    }
  }
  return { bytes, unreadable };
}

/** The order of `ranked` with duplicates collapsed, as the retriever's own file ranking. */
export function dedupePreservingOrder(ranked: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const file of ranked) {
    if (seen.has(file)) continue;
    seen.add(file);
    ordered.push(file);
  }
  return ordered;
}

/**
 * The retriever's ranking restricted to the corpus's answer space, **order untouched**.
 *
 * **A filter and not a re-score.** The baseline ranks the files of the configuration and nothing else, so a document
 * our retriever returns is outside the comparison rather than a false positive inside it; removing it changes which
 * files were eligible, never which came first among those that were. `outsideUniverse` is reported beside the figure
 * so a reader can see what the restriction cost.
 */
export function restrictToUniverse(ranked: string[], universe: Set<string>): string[] {
  return dedupePreservingOrder(ranked).filter((file) => universe.has(file));
}

/** How many of the retriever's own candidates the corpus does not count. **Published, never silently dropped.** */
export function outsideUniverse(ranked: string[], universe: Set<string>): number {
  return dedupePreservingOrder(ranked).filter((file) => !universe.has(file)).length;
}

/** The authors' `get_quality_metrics`, field for field, types aside. */
export function lcaQualityMetrics(
  allFiles: string[],
  expectedFiles: string[],
  actualFiles: string[],
): {
  allFilesCount: number;
  expectedCount: number;
  actualCount: number;
  percentOfBugFiles: number;
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
  allCorrect: number;
  atLeastOneCorrect: number;
  allIncorrect: number;
} {
  const all = new Set(allFiles);
  const expected = new Set(expectedFiles);
  const actual = new Set(actualFiles);

  const truePositives = [...expected].filter((file) => actual.has(file)).length;
  const falsePositives = [...actual].filter((file) => !expected.has(file)).length;
  const falseNegatives = [...expected].filter((file) => !actual.has(file)).length;
  const trueNegatives = [...all].filter((file) => !expected.has(file) && !actual.has(file)).length;

  const precision =
    truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall =
    truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) : 0;
  const fpr =
    falsePositives + trueNegatives > 0 ? falsePositives / (falsePositives + trueNegatives) : 0;

  return {
    allFilesCount: all.size,
    expectedCount: expected.size,
    actualCount: actual.size,
    percentOfBugFiles: all.size > 0 ? actual.size / all.size : 0,
    precision,
    recall,
    f1,
    fpr,
    allCorrect: actual.size === expected.size && truePositives === expected.size ? 1 : 0,
    atLeastOneCorrect: truePositives > 0 ? 1 : 0,
    // **The authors' definition**, which counts an empty answer as neither correct nor incorrect rather than as all
    // incorrect: `len(actual_set) > 0` is part of the condition.
    allIncorrect: truePositives === 0 && actual.size > 0 ? 1 : 0,
  };
}

/**
 * Average precision of one ranked list, **which is the only column the published baselines report**.
 *
 * **Why this exists.** The corpus's own `quality_metrics.py` scores a *set* at a fixed cut, and the paper's baseline
 * table does not: it reports **MAP** - `GTE` 0.33, `Mistral` 0.30, `TF-IDF` 0.27, `BM25` below 0.25, `GPT-4` 0.39 - so
 * a figure of ours at `k = 10` cannot be placed beside any of them without a conversion somebody invented. This is that
 * conversion written once, as the textbook definition: the mean, over the ranks where a relevant file was found, of the
 * precision at that rank, divided by the number of relevant files.
 *
 * **The denominator is every relevant file, not the ones inside the answer space.** A `changed_files` entry whose
 * extension the configuration excludes can never be ranked, so it lowers average precision the same way it lowers
 * recall - and reporting AP against a smaller denominator than recall uses would make the two columns disagree about
 * what the same instance was worth.
 *
 * **`depth` is stated by the caller and published with the figure.** This product's retriever returns a bounded pool
 * (two hundred candidates), so AP is computed over that pool rather than over the repository; a list cut short can only
 * *lose* credit, which makes the figure a floor rather than an estimate, and the artifact says so where the column is
 * defined rather than in a footnote a reader has to find.
 */
export function averagePrecision(
  ranked: readonly string[],
  expected: readonly string[],
  depth: number,
): number {
  const relevant = new Set(expected);
  if (relevant.size === 0) return 0;
  const limit = Math.min(ranked.length, Math.max(0, depth));
  let hits = 0;
  let sum = 0;
  for (let index = 0; index < limit; index += 1) {
    const file = ranked[index];
    // **`undefined` is unreachable here** because `index < limit <= ranked.length`; written as a guard rather than a
    // non-null assertion so that the branch is visible to the coverage report rather than hidden from it.
    if (file === undefined) break;
    if (!relevant.has(file)) continue;
    hits += 1;
    sum += hits / (index + 1);
  }
  return sum / relevant.size;
}

/**
 * Where the first answer sits in a ranking, counting from one, or `null` when the ranking does not contain one.
 *
 * **Average precision already says the rank, but not which way to repair it.** A row that scores 0.03 because the answer
 * is at position 31 and a row that scores 0.03 because six of eight answers are missing are the same number and
 * different defects, and a report that publishes only MAP invites the reader to treat them as one. Measured side by
 * side with the control's own rank, this is the column that says **the ranking is the problem rather than the corpus**.
 */
export function firstRelevantRank(
  ranked: readonly string[],
  expected: readonly string[],
): number | null {
  const relevant = new Set(expected);
  if (relevant.size === 0) return null;
  for (let index = 0; index < ranked.length; index += 1) {
    const file = ranked[index];
    if (file === undefined) return null;
    if (relevant.has(file)) return index + 1;
  }
  return null;
}

/** Mean of a numeric field over the rows that produced one. **Rounded to four places, as the corpus's tables are.** */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return (
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) / 10000
  );
}
