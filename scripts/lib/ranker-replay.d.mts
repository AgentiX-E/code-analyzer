/**
 * **The shape of a ranker replay**: the features an artifact already carries, a fold boundary, and the two orderings a
 * cut can be scored under.
 *
 * Nothing here describes a measurement that needs a dispatch. Every field is read from one artifact, which is why the
 * question "would a fitted ordering score higher" costs nothing to ask and nothing to get wrong late.
 */

import type { AuditPoint } from './selection-audit.mjs';
import type { CutStep, EmittedFinding } from './operating-point.mjs';

/** One finding as the artifact carries it, plus the two fields a fit reads and `EmittedFinding` does not name. */
export interface RankerRow extends EmittedFinding {
  readonly lane?: string;
  readonly text?: string;
  readonly features?: {
    readonly grounded?: boolean;
    readonly quotesDiff?: boolean;
    readonly namesSymbol?: boolean;
    readonly proposesChange?: boolean;
    readonly hedged?: boolean;
    readonly agreement?: number;
    readonly severity?: string;
    readonly lane?: string;
  };
}

/** The artifact this reads: a run's own findings and the corpus's denominator. */
export interface RankerArtifact {
  readonly rankedFindings?: readonly RankerRow[];
  readonly missedGoldens?: { readonly total?: number };
  readonly emissionRules?: { readonly shipped?: { readonly steps?: readonly CutStep[] } };
}

export interface ReplayCurvePoint extends AuditPoint {
  /** The cap, or `null` for the cut that applies no budget at all. */
  readonly budget: number | null;
}

export interface ReplayResult {
  readonly goldens: number;
  readonly shipped: AuditPoint;
  readonly fitted: AuditPoint;
  readonly curve: readonly ReplayCurvePoint[];
}

export interface FitOptions {
  readonly l2?: number;
  readonly iterations?: number;
  readonly rate?: number;
}

/** The feature names, in the order `featuresOf` writes them. */
export declare const FEATURE_NAMES: readonly string[];

export declare function featuresOf(finding: RankerRow): number[];

export declare function labelOf(finding: RankerRow): 0 | 1;

export declare function fitLogistic(
  rows: readonly number[][],
  labels: readonly number[],
  options?: FitOptions,
): number[];

export declare function leaveOnePullRequestOut(
  findings: readonly RankerRow[],
  options?: FitOptions,
): number[];

export declare function scoreCut(
  findings: readonly RankerRow[],
  steps: readonly CutStep[],
  goldens: number,
): AuditPoint;

export declare function shippedSteps(artifact: RankerArtifact): readonly CutStep[];

export declare function replay(artifact: RankerArtifact, options?: FitOptions): ReplayResult | null;

export declare function curveOf(
  findings: readonly RankerRow[],
  steps: readonly CutStep[],
  goldens: number,
  budgets?: readonly number[],
): ReplayCurvePoint[];

export declare function loadArtifact(path: string): RankerArtifact;

/** One point of a rank curve: a prefix of an ordering, scored the way the protocol scores any cut. */
export interface RankCurvePoint extends AuditPoint {
  /** How many comments the budget allowed, as a count rather than as a score threshold. */
  readonly k: number;
}

/**
 * **Four orderings of one pool**, so a ranker is read beside the row that needs no ranker.
 *
 * `oracle` is a ceiling rather than a device: it sorts by how many goldens a finding carried, which nothing at review
 * time can know. A curve near it has no ranking left to win; one far below it is a curve about the ranker.
 */
export interface RankCurves {
  readonly goldens: number;
  readonly pool: number;
  readonly curves: {
    readonly score: readonly RankCurvePoint[];
    readonly prior: readonly RankCurvePoint[];
    readonly priorTimesPenalty: readonly RankCurvePoint[];
    readonly oracle: readonly RankCurvePoint[];
  };
}

export declare function penaltyOf(finding: RankerRow): number;

export declare function leaveOnePullRequestOutPrior(
  findings: readonly RankerRow[],
  options?: { readonly keys?: readonly string[] },
): number[];

export declare function matchedPairs(findings: readonly RankerRow[]): number;

export declare function curveAtBudget(
  order: readonly RankerRow[],
  goldens: number,
  ks: readonly number[],
): RankCurvePoint[];

export declare function rankCurves(artifact: RankerArtifact, ks: readonly number[]): RankCurves;
