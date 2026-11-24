/**
 * **The declaration for `score-ablation.mjs`, so a delta can be asserted rather than read off a printed table.**
 *
 * The module is `.mjs` because the bench workflow and `scripts/aacr-score-ablation.mjs` call it with plain `node`, and a
 * `.d.mts` sits beside it for the reason `like-for-like.d.mts` gives: **a helper exercised only through its CLI is a
 * helper whose arithmetic is asserted by reading output.**
 */

import type { ScoreWeights } from './score-weights.d.mts';

/** The version of this arithmetic, recorded beside every figure it publishes. */
export const SCORE_ABLATION_VERSION: string;

/** One published row, in either shape an artifact has carried. */
export interface ScoredRow {
  readonly pr?: string | null;
  readonly path?: string | null;
  readonly matchedGoldens?: readonly number[];
  readonly features?: Readonly<Record<string, unknown>>;
  readonly score?:
    number | { readonly score?: number; readonly features?: Readonly<Record<string, unknown>> };
}

/** One operating point, as `operating-point.mjs` scores it. */
export interface ScorePoint {
  readonly goldens: number;
  readonly emitted: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/** Raised when the weights do not rebuild the artifact, which makes every delta meaningless. */
export class ScoreReproductionError extends Error {
  readonly mismatches: readonly {
    readonly index: number;
    readonly pr: string;
    readonly published: number;
    readonly recomputed: number;
  }[];
}

/** One row's score, rebuilt from its features in the engine's own accumulation order. */
export function recomputeScore(row: ScoredRow, weights: ScoreWeights): number;

export interface AblationTerm {
  readonly term: string;
  readonly weight: number;
  readonly firedOn: number;
  readonly dead: boolean;
  readonly without: ScorePoint;
  /** `F1` without the term minus `F1` with it. Positive means the term was costing true positives. */
  readonly delta: number;
  readonly costsTruePositives: number;
}

export interface AblationResult {
  readonly version: string;
  readonly weightsVersion: string;
  readonly cut: string;
  readonly rows: number;
  readonly goldens: number;
  readonly baseline: ScorePoint;
  readonly terms: readonly AblationTerm[];
}

export function ablateScoreTerms(options: {
  readonly findings: readonly ScoredRow[];
  readonly goldens: number;
  readonly weights: ScoreWeights;
  readonly cut?: string;
}): AblationResult;

export interface BootstrapInterval {
  readonly rounds: number;
  readonly seed: number;
  readonly observed: number;
  readonly mean: number;
  readonly lo: number;
  readonly hi: number;
  readonly sd: number;
  /** The smallest difference this design could show, at 5 % two-sided and 80 % power. */
  readonly mde: number;
}

export interface PairedTerm {
  readonly term: string;
  readonly weight: number;
  readonly firedOn: number;
  readonly dead: boolean;
  /** The arm's own point, which is what the `tp` and `F1` columns report. */
  readonly without: ScorePoint;
  readonly delta: number;
  readonly interval: BootstrapInterval;
  /** Reference comments the baseline bought and this arm did not. */
  readonly onlyBase: number;
  /** Reference comments this arm bought and the baseline did not. */
  readonly onlyAlt: number;
  /** Exact McNemar on the two discordant counts. */
  readonly p: number;
}

export interface PairedComparison {
  readonly version: string;
  readonly weightsVersion: string;
  readonly cut: string;
  readonly rows: number;
  readonly goldens: number;
  readonly pullRequests: number;
  readonly baseline: ScorePoint;
  /** The corpus's resolution, which is a property of the number of pull requests and not of a term. */
  readonly resolution: { readonly sd: number; readonly mde: number };
  readonly terms: readonly PairedTerm[];
}

export function pairedTermComparison(options: {
  readonly findings: readonly ScoredRow[];
  /** A pull request with no count is zero reference comments, which is what an uncovered pull request has. */
  readonly goldensByPullRequest: readonly { readonly pr: string; readonly goldens?: number }[];
  readonly weights: ScoreWeights;
  readonly cut?: string;
  readonly rounds?: number;
  readonly seed?: number;
}): PairedComparison;

/** A fixed-width line table of the unpaired pricing. */
export function ablationTable(result: AblationResult): string;
