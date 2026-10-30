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

import { readdirSync } from 'node:fs';
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

/** Mean of a numeric field over the rows that produced one. **Rounded to four places, as the corpus's tables are.** */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return (
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) / 10000
  );
}
