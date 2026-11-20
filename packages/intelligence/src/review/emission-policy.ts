// @code-analyzer/intelligence — the operating point the product ships, as one function over findings a run already has
//
// **The finding this file answers.** `docs/EVAL-CONTRACT.md` §54 prices twenty-three cuts of one run's own verdicts. The
// point this repository had been publishing - the actionability gate and the category floor - scores F1 0.1823; a
// different cut of the same findings scores 0.2121, on the same 100 pull requests, the same goldens and the same judge,
// while emitting 148 fewer comments and raising precision from 0.1735 to 0.2236. **The published point was 0.0298 below
// the best point the artifact could already price, and nothing was spending money to find that out - the cut is
// arithmetic over verdicts the run paid for once.**
//
// **So the cut stops being a report and becomes the product.** A figure measured at a point no command applies is a
// description of a harness. This module is the point: the command that posts comments applies it, the harness that
// measures applies it, and §54's table is where the numbers for it come from.
//
// **Why not a scorer.** The four steps here are the whole space the campaign registered - drop a category, keep a
// category, drop a class of path, keep at most *k* per pull request - and every one of them is priced in a table.
// **A rule language with more expressive power than the campaign has hypotheses is a rule language that can fit the
// corpus.** The path-class step was added in §106, and it was added as a step with a classifier that has six named
// outputs rather than as a predicate seam, for the same reason: a predicate can be tuned per corpus and a class cannot.

/** One step of a cut. The order the steps are applied in is part of the cut, not a detail of its implementation. */
export type EmissionStep =
  | { readonly kind: 'drop'; readonly categories: readonly string[] }
  | { readonly kind: 'keep-category'; readonly categories: readonly string[] }
  | { readonly kind: 'drop-path-class'; readonly classes: readonly string[] }
  | { readonly kind: 'budget'; readonly k: number };

/**
 * **The classes a changed path can fall into, decided by its name alone.**
 *
 * §106 measured what this classifier is for: on run `44693503049` the five lanes filed **72 findings on paths this
 * function calls `test`**, and **not one of them stands on a path a golden is written about** - the three findings in
 * that class a human accepted describe goldens from other files. The class is therefore not a guess about a comment's
 * quality; it is a fact about where a reviewer's own attention goes, and it is available before any model is called.
 *
 * **Six classes and not a boolean**, because the corpus has four populations with different prices and a `testFile:
 * true` flag would be a flag nobody can price. `fixture` is separate from `test` because `testdata/baselines/...` is
 * golden output committed as text, `vendored` because a third party's code is not ours to review, `docs` because a
 * markdown finding is a real finding (precision 0.38 on the run above) and must not be confused with either.
 */
export const REVIEW_PATH_CLASSES = [
  'test',
  'fixture',
  'vendored',
  'docs',
  'source',
  'other',
] as const;

/** What `reviewPathClass` answers. */
export type ReviewPathClass = (typeof REVIEW_PATH_CLASSES)[number];

/** Directories whose every file is a test, a golden output, a third party's, or documentation. */
const PATH_CLASS_RULES: readonly { readonly pathClass: ReviewPathClass; readonly test: RegExp }[] =
  [
    // **First, because a golden output under `testdata/` would otherwise be read as a test** by the directory rule below,
    // and the two classes carry different prices.
    { pathClass: 'fixture', test: /(^|\/)(testdata|__snapshots__|baselines|goldens?)(\/|$)/u },
    {
      pathClass: 'test',
      test: /(^|\/)(test|tests|testing|spec|specs|__tests__|e2e)(\/|$)|(^|\/)[^/]*[._-](test|spec)\.[a-z]+$/u,
    },
    {
      pathClass: 'vendored',
      test: /(^|\/)(3rdparty|third[_-]party|vendor|vendored|external|extern|node_modules)(\/|$)/u,
    },
    {
      pathClass: 'docs',
      test: /(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|rst|adoc|txt)$/u,
    },
    {
      pathClass: 'source',
      test: /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|py|pyi|js|jsx|mjs|cjs|ts|tsx|java|kt|kts|groovy|scala|swift|go|rs|rb|php|cs|dart|lua|pl|r|jl|ex|exs|hs|ml|clj)$/u,
    },
  ];

/**
 * **Which class a changed path belongs to, from the path and nothing else.**
 *
 * An absent path is `other` rather than an error: the `review pr` command knows its files, a caller assembling findings
 * by hand may not, and **a step that threw on a missing path would refuse to emit a report over a shape the report
 * already tolerates**.
 */
export function reviewPathClass(path: string | null | undefined): ReviewPathClass {
  const normalised = String(path ?? '')
    .replace(/\\/gu, '/')
    .toLowerCase();
  if (normalised === '') return 'other';
  for (const rule of PATH_CLASS_RULES) if (rule.test.test(normalised)) return rule.pathClass;
  return 'other';
}

/**
 * **What the product ships, and the row of §106's table it is.**
 *
 * `test` is dropped before any budget applies because §49.3 measured the category as a loss at every cut: 171 findings
 * carried 9 goldens on the published run, precision 0.0526, and dropping it frees slots the budget then spends on
 * findings that carry goldens. The budget is twelve per pull request because §52 priced the axis and twelve is the point
 * §54's table names first.
 *
 * **The path-class step is §106's, and it is not the category step said twice.** §49.3 dropped findings a *lane* labelled
 * `test`; this drops findings that stand on a *file* the classifier calls a test, whatever lane wrote them. On run
 * `44693503049` the two sets are nearly disjoint: 72 findings stand on test paths, of which 44 carry a category the
 * shipped policy keeps, and exact replay of that run's own verdicts prices the step at **F1 0.2222 against 0.2119**
 * (84 true positives against 82, precision 0.2763 against 0.2547) with **eighteen fewer comments**.
 */
export const SHIPPED_EMISSION_STEPS: readonly EmissionStep[] = Object.freeze([
  Object.freeze({ kind: 'drop', categories: Object.freeze(['test']) } satisfies EmissionStep),
  Object.freeze({
    kind: 'drop-path-class',
    classes: Object.freeze(['test']),
  } satisfies EmissionStep),
  Object.freeze({ kind: 'budget', k: 12 } satisfies EmissionStep),
]);

/**
 * **The point every figure before §106 was filed under**, kept as a value rather than as a sentence in a document.
 *
 * A run prints both, from one pool and one set of verdicts, so the difference between the two rows is the step and not
 * the day. **A rule that only exists in a changelog cannot be re-priced**, and the first question a later iteration asks
 * about a shipped policy is what it was before.
 */
export const PREVIOUS_EMISSION_STEPS: readonly EmissionStep[] = Object.freeze([
  Object.freeze({ kind: 'drop', categories: Object.freeze(['test']) } satisfies EmissionStep),
  Object.freeze({ kind: 'budget', k: 12 } satisfies EmissionStep),
]);

/** Anything the policy can order: a category, a score, and the pull request the finding belongs to. */
export interface EmissionSubject {
  readonly category?: string | null;
  /**
   * The rank a budget orders by. **Both shapes the pipeline carries are read here** - the number the artifact writes
   * and the `{ score }` object the harness hands around - because a policy that read one of them as zero would keep
   * whichever findings happened to arrive first and call it the highest-scoring twelve.
   *
   * **Absent is not zero by accident.** The `review pr` command sorts its findings by severity and has no score to give;
   * a caller in that position gets its own order back for ties, which is what makes the command's published figure the
   * one the harness prices.
   */
  readonly score?: number | { readonly score?: number } | null;
  /** The pull request a budget counts within. A caller reviewing one pull request need not supply it. */
  readonly pr?: string | null;
  readonly pullRequest?: string | null;
  /**
   * **The file the finding stands on, which a `drop-path-class` step reads.**
   *
   * Three keys because the pipeline carries three: the harness's ranked rows call it `path`, a report's findings call it
   * `file`, and a lens finding - the shape this command actually passes - calls it `filePath`. A policy that read one of
   * them would drop nothing on the callers that used the others, and **the artifact would then price a step the command
   * does not apply** - §54's defect one level down, found by writing the test in `pr-review.test.ts` rather than by
   * reading this comment.
   */
  readonly path?: string | null;
  readonly file?: string | null;
  readonly filePath?: string | null;
}

/** What a cut did, so a report can say why a finding a reviewer wrote is not in front of them. */
export interface EmissionOutcome<T> {
  readonly kept: readonly T[];
  /** Findings the policy's `drop` steps removed, by category, in the order the categories were first seen. */
  readonly droppedByCategory: readonly { readonly category: string; readonly count: number }[];
  /** Findings a `drop-path-class` step removed, by class, in the order the classes were first seen. */
  readonly droppedByPathClass: readonly { readonly pathClass: string; readonly count: number }[];
  /** Findings the budget removed: written by a reviewer, and then refused a slot. */
  readonly truncated: number;
}

/** The score a budget ranks by, from either shape a finding has carried. */
function scoreOf(subject: EmissionSubject): number {
  const value = subject.score;
  if (typeof value === 'number') return value;
  const nested = value?.score;
  return typeof nested === 'number' ? nested : 0;
}

/** The path a `drop-path-class` step classifies, from whichever key the caller's shape carries. */
function pathOf(subject: EmissionSubject): string {
  return String(subject.path ?? subject.file ?? subject.filePath ?? '');
}

/** The pull request a budget counts within. A caller that reviews one pull request omits the key, and gets one bucket. */
function pullRequestOf(subject: EmissionSubject): string {
  return String(subject.pr ?? subject.pullRequest ?? '');
}

/**
 * **The cut, applied in the order it is written.**
 *
 * The order matters and is not an implementation detail: dropping `test` before the budget frees the slots the two test
 * findings at the top of a pull request would have spent, and §54 prices the reversed order as a worse point.
 */
export function applyEmissionPolicy<T extends EmissionSubject>(
  items: readonly T[],
  steps: readonly EmissionStep[] = SHIPPED_EMISSION_STEPS,
): EmissionOutcome<T> {
  let kept: T[] = [...items];
  const droppedByCategory = new Map<string, number>();
  const droppedByPathClass = new Map<string, number>();

  for (const step of steps) {
    if (step.kind === 'drop' || step.kind === 'keep-category') {
      const named = new Set(step.categories);
      const survivors: T[] = [];
      for (const item of kept) {
        const category = String(item.category ?? '');
        const admitted = step.kind === 'drop' ? !named.has(category) : named.has(category);
        if (admitted) survivors.push(item);
        else if (step.kind === 'drop') {
          droppedByCategory.set(category, (droppedByCategory.get(category) ?? 0) + 1);
        }
      }
      kept = survivors;
      continue;
    }
    if (step.kind === 'drop-path-class') {
      // **The class is computed here rather than passed in**, so a caller cannot file a finding under a class this
      // module would not have given it - §106's row is a price for one classifier, and two classifiers is two rows.
      const named = new Set(step.classes);
      const survivors: T[] = [];
      for (const item of kept) {
        const pathClass = reviewPathClass(pathOf(item));
        if (named.has(pathClass)) {
          droppedByPathClass.set(pathClass, (droppedByPathClass.get(pathClass) ?? 0) + 1);
        } else survivors.push(item);
      }
      kept = survivors;
      continue;
    }
    if (step.kind === 'budget') {
      const byPullRequest = new Map<string, T[]>();
      for (const item of kept) {
        const key = pullRequestOf(item);
        const bucket = byPullRequest.get(key);
        if (bucket === undefined) byPullRequest.set(key, [item]);
        else bucket.push(item);
      }
      const withinBudget: T[] = [];
      for (const bucket of byPullRequest.values()) {
        // **Highest score first, and ties keep the caller's order** - the same rule the harness's `applyCut` applies,
        // and the reason a policy read here and a cut priced by the table cannot disagree about which twelve survive.
        const ordered = bucket
          .map((item, at) => ({ item, at, score: scoreOf(item) }))
          .sort((left, right) => right.score - left.score || left.at - right.at);
        for (const entry of ordered.slice(0, step.k)) withinBudget.push(entry.item);
      }
      kept = withinBudget;
      continue;
    }
    throw new Error(`unknown emission step "${String((step as { kind?: unknown }).kind)}"`);
  }

  return {
    kept,
    droppedByCategory: [...droppedByCategory.entries()].map(([category, count]) => ({
      category,
      count,
    })),
    droppedByPathClass: [...droppedByPathClass.entries()].map(([pathClass, count]) => ({
      pathClass,
      count,
    })),
    truncated:
      items.length -
      kept.length -
      [...droppedByCategory.values()].reduce((sum, n) => sum + n, 0) -
      [...droppedByPathClass.values()].reduce((sum, n) => sum + n, 0),
  };
}

/**
 * **The label a table row prints, derived from the steps rather than written beside them.**
 *
 * §54's table has a row called `drop test, budget 12`. If this string and that row ever disagree, the shipped point is a
 * point the table does not price and every figure filed under it is the price of something else.
 */
export function describeEmissionSteps(steps: readonly EmissionStep[]): string {
  if (steps.length === 0) return 'no rule';
  return steps
    .map((step) => {
      if (step.kind === 'drop') return `drop ${step.categories.join('+')}`;
      if (step.kind === 'keep-category') return `keep ${step.categories.join('+')}`;
      if (step.kind === 'drop-path-class') return `drop path ${step.classes.join('+')}`;
      return `budget ${String(step.k)}`;
    })
    .join(', ');
}
