// @code-analyzer/intelligence — What a category of finding is worth, measured rather than assumed
//
// **The problem this file answers.** A review engine emits findings in nine categories, and the categories are not
// equally likely to be what a reviewer was looking for: on a corpus that carries an expert's verdict for every line, the
// `test` category was accepted 11 times out of 95 and `bug` 86 times out of 211. **A ranking that treats those two
// categories alike spends three quarters of its budget on remarks nobody asked for**, and no amount of prompt wording
// fixes a mixture problem.
//
// **Why this is data and not a heuristic.** Every number below is a count of judge verdicts on a published corpus with
// a named run behind it, and `tests/unit/review/category-acceptance-is-read-from-the-artifact.test.ts` recomputes the
// whole table from `benchmarks/aacr-bench.json` and fails if this file and the artifact disagree. **A prior that cannot
// be traced to a count is an opinion with a decimal point.**
//
// **What it is not.** It is not a claim that a design remark is worthless. It is a claim that **when an expert's
// judgement is the measure, a remark about the repository's process is much less often the remark they made** - which
// is why the profile is a parameter: `defect` (the default) keeps the categories with measured acceptance, and
// `advisory` keeps everything, for the reader who wants the design opinions and will read them as such.

import type { ReviewCategory } from '@code-analyzer/shared';

/**
 * **How a category's findings were received, with the count behind the rate.**
 *
 * `accepted` is the number of findings in that category that a judge matched to at least one expert-confirmed issue;
 * `emitted` is how many were emitted. **`prior` is `accepted / emitted`, rounded to four places**, and the rounding is
 * what the test recomputes - not a hand-written decimal that could drift from its own fraction.
 */
export interface CategoryAcceptance {
  /** The denominator: how many findings in this category the measured run emitted. */
  readonly emitted: number;
  /** The numerator: how many of them a judge matched to at least one expert-confirmed issue. */
  readonly accepted: number;
  /** `accepted / emitted`, or `null` when nothing was emitted and therefore nothing is known. */
  readonly prior: number | null;
}

/**
 * **The measurement, and where it comes from.**
 *
 * `Alibaba-Aone/aacr-bench` (Apache-2.0), fifty pull requests, 452 expert-confirmed issues, judge `deepseek-chat`,
 * `pullRequestBudget` 16, prompt order `boilerplate-first`. The artifact is `benchmarks/aacr-bench.json` and the exact
 * run is recorded in its own `measuredAt`. **These are the counts of the file arm's full emission**, before any
 * deduplication threshold or budget is applied - **the emission is what the prior is about**, and a prior computed
 * after the budget would be a prior about the budget.
 *
 * **`api`, `style` and `other` were measured too**: three findings in `style` and none accepted, none emitted in `api`
 * or `other`. **A category with no emission has no measurement, and `null` is how that is said** - not zero, because a
 * zero would license dropping a category nobody has ever tried.
 */
export const CATEGORY_ACCEPTANCE: Readonly<Record<ReviewCategory, CategoryAcceptance>> =
  Object.freeze({
    bug: { emitted: 211, accepted: 86, prior: 0.4076 },
    security: { emitted: 14, accepted: 6, prior: 0.4286 },
    documentation: { emitted: 12, accepted: 8, prior: 0.6667 },
    maintainability: { emitted: 41, accepted: 10, prior: 0.2439 },
    performance: { emitted: 14, accepted: 3, prior: 0.2143 },
    architecture: { emitted: 179, accepted: 36, prior: 0.2011 },
    test: { emitted: 95, accepted: 11, prior: 0.1158 },
    style: { emitted: 3, accepted: 0, prior: 0 },
    api: { emitted: 0, accepted: 0, prior: null },
    other: { emitted: 0, accepted: 0, prior: null },
  });

/**
 * **The two profiles, and why the default is the narrow one.**
 *
 * `defect` keeps a category whose measured acceptance reaches {@link DEFECT_FLOOR} and drops the rest. `advisory` keeps
 * everything. **The default is `defect` because a review comment competes for a reader's attention against the lines
 * they changed**, and a remark about a test file the pull request did not touch is not competing on that ground.
 *
 * **`advisory` exists so the choice is visible.** A device that is always on is a device nobody can measure, and the
 * first thing a reader who disagrees with the prior should be able to do is see the findings it removed.
 */
export type EmissionProfile = 'defect' | 'advisory';

/**
 * **The floor, and the one place it is written.**
 *
 * 0.22 is not a round number chosen for comfort: it is the value that separates the four categories measured above a
 * quarter (`documentation` 0.667, `security` 0.429, `bug` 0.408, `maintainability` 0.244) from the three measured below
 * it (`performance` 0.214, `architecture` 0.201, `test` 0.116). **A floor placed between two measured groups is a
 * decision that can be argued with; one placed inside a group would be a decision about individual findings disguised
 * as a decision about categories.**
 */
export const DEFECT_FLOOR = 0.22;

/** What the selector decided about one category, with the count it decided on. */
export interface CategoryVerdict {
  /** Whether a finding in this category reaches a reader under this profile. */
  readonly emit: boolean;
  /** One sentence naming the count, the rate and the floor - the sentence a reader can check. */
  readonly reason: string;
}

/**
 * **Whether a category is emitted under a profile, as a sentence rather than a boolean.**
 *
 * The sentence is the point: an artifact that records "37 findings were dropped" cannot be argued with, and one that
 * records "37 `test` findings: 11 of 95 accepted (0.116, floor 0.22)" can.
 */
export function categoryVerdict(
  category: ReviewCategory,
  profile: EmissionProfile,
): CategoryVerdict {
  const measured = CATEGORY_ACCEPTANCE[category];
  const prior = measured.prior;
  // **A category nothing was emitted in is not a category that failed.** Its `prior` is `null` and it is kept, because
  // **dropping a category on the strength of a zero that came from not trying is how a measurement becomes a policy.**
  if (prior === null) {
    return {
      emit: true,
      reason: `${category}: nothing was emitted in the measured run, so nothing is known and nothing is dropped`,
    };
  }
  if (profile === 'advisory') {
    return {
      emit: true,
      reason: `${category}: ${String(measured.accepted)} of ${String(measured.emitted)} accepted (${prior.toFixed(3)}), kept by the advisory profile`,
    };
  }
  if (prior >= DEFECT_FLOOR) {
    return {
      emit: true,
      reason: `${category}: ${String(measured.accepted)} of ${String(measured.emitted)} accepted (${prior.toFixed(3)}, above the ${String(DEFECT_FLOOR)} floor)`,
    };
  }
  return {
    emit: false,
    reason: `${category}: ${String(measured.accepted)} of ${String(measured.emitted)} accepted (${prior.toFixed(3)}, below the ${String(DEFECT_FLOOR)} floor)`,
  };
}

/** A finding this module can decide about: the category is all it reads. */
export interface Categorised {
  readonly finding: { readonly category: ReviewCategory };
}

/** What the profile did: what it kept, and one entry per dropped category with the count and the sentence. */
export interface ProfileOutcome<T extends Categorised> {
  readonly kept: T[];
  readonly dropped: ReadonlyArray<{ category: ReviewCategory; count: number; reason: string }>;
}

/**
 * **Apply a profile to a ranked list, keeping the order and reporting what left.**
 *
 * **Filtering here rather than inside `rankFindings` is deliberate**: `rankFindings` documents that it drops nothing,
 * and a selector that quietly discards is the failure the review protocol was written after. **This function is named
 * for what it does, returns what it removed, and the caller decides whether to publish the count.**
 */
export function applyEmissionProfile<T extends Categorised>(
  items: readonly T[],
  profile: EmissionProfile,
): ProfileOutcome<T> {
  const kept: T[] = [];
  const dropped = new Map<ReviewCategory, { count: number; reason: string }>();
  for (const item of items) {
    const category = item.finding.category;
    const verdict = categoryVerdict(category, profile);
    if (verdict.emit) {
      kept.push(item);
      continue;
    }
    const seen = dropped.get(category);
    if (seen) seen.count += 1;
    else dropped.set(category, { count: 1, reason: verdict.reason });
  }
  return {
    kept,
    dropped: [...dropped.entries()].map(([category, entry]) => ({
      category,
      count: entry.count,
      reason: entry.reason,
    })),
  };
}
