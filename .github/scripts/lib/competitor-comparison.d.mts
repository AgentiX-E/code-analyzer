// Types for `competitor-comparison.mjs`.
//
// **Why a hand-written declaration rather than a rewrite in TypeScript.** The module is imported by a `.mjs` script that
// runs under plain node with no build step, and by tests that run through vitest - so **the file it imports has to be
// the file that runs**. A `.ts` source would put a build between the harness and its own logic, which is the one place
// this repository has kept free of one.

/** The verdict a comparison carries when it is not allowed to state one. */
export declare const WITHHELD: 'withheld';

/** How much of the corpus the competitor arm actually covered. */
export interface ComparisonCoverage {
  requested: number;
  covered: number;
  missing: number;
  /** `covered / requested`, rounded to four places; `0` for an empty corpus. */
  share: number;
}

/**
 * **The corpus the two figures were computed over.**
 *
 * `whole corpus` needs no denominator; `paired subset` does, and so does what was left out of it.
 */
export interface ComparisonScope {
  basis: 'whole corpus' | 'paired subset';
  pullRequests: number;
  requested: number;
  excluded: number;
}

/** A comparison that states a verdict. */
export interface StatedComparison {
  comparable: true;
  verdict: 'significant at 0.05' | 'not significant at 0.05';
  withheldReason: null;
  oursOnly: number;
  theirsOnly: number;
  pValue: number;
  coverage: ComparisonCoverage;
  scope: ComparisonScope;
}

/** A comparison that refuses to state one, and says why. */
export interface WithheldComparison {
  comparable: false;
  verdict: 'withheld';
  withheldReason: string;
  /** **Reported even when withheld**, because it is a fact about our arm. */
  oursOnly: number;
  /** **`null`, not zero**: a guaranteed zero in a column reads as a shutout. */
  theirsOnly: null;
  pValue: null;
  coverage: ComparisonCoverage;
  /** The field exists on both arms so that a reader never has to narrow before asking what corpus a figure is over. */
  scope: null;
}

export type CompetitorComparison = StatedComparison | WithheldComparison;

export declare function compareAgainstCompetitor(input: {
  oursOnly?: number | null;
  theirsOnly?: number | null;
  coverage?: { requested?: number | null; covered?: number | null; missing?: number | null } | null;
  /**
   * **The pull requests both arms were scored on**, when the caller restricted its counts to them. Absent means the
   * caller did not, and a missing competitor row then still withholds.
   */
  paired?: { pullRequests?: number | null } | null;
}): CompetitorComparison;

export declare function describeComparison(comparison: CompetitorComparison): string;
