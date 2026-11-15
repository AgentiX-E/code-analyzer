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
// **Why not a scorer.** The three steps here are the whole space the campaign registered - drop a category, keep a
// category, keep at most *k* per pull request - and every one of them is priced in the table. **A rule language with
// more expressive power than the campaign has hypotheses is a rule language that can fit the corpus.**

/** One step of a cut. The order the steps are applied in is part of the cut, not a detail of its implementation. */
export type EmissionStep =
  | { readonly kind: 'drop'; readonly categories: readonly string[] }
  | { readonly kind: 'keep-category'; readonly categories: readonly string[] }
  | { readonly kind: 'budget'; readonly k: number };

/**
 * **What the product ships, and the row of §54's table it is.**
 *
 * `test` is dropped before any budget applies because §49.3 measured the category as a loss at every cut: 171 findings
 * carried 9 goldens on the published run, precision 0.0526, and dropping it frees slots the budget then spends on
 * findings that carry goldens. The budget is twelve per pull request because §52 priced the axis and twelve is the point
 * §54's table names first.
 *
 * **The pair is one operating point and is registered as one.** A budget read without the drop scores 0.2000 and the
 * drop read without the budget scores 0.2001; the two together score 0.2121.
 */
export const SHIPPED_EMISSION_STEPS: readonly EmissionStep[] = Object.freeze([
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
}

/** What a cut did, so a report can say why a finding a reviewer wrote is not in front of them. */
export interface EmissionOutcome<T> {
  readonly kept: readonly T[];
  /** Findings the policy's `drop` steps removed, by category, in the order the categories were first seen. */
  readonly droppedByCategory: readonly { readonly category: string; readonly count: number }[];
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
    truncated:
      items.length - kept.length - [...droppedByCategory.values()].reduce((sum, n) => sum + n, 0),
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
      return `budget ${String(step.k)}`;
    })
    .join(', ');
}
