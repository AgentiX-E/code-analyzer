/**
 * **Two arms, one corpus, one cut** - declared because the module is JavaScript and the tests are TypeScript.
 *
 * The declarations are the ones the module honours: an artifact is whatever the benchmark wrote, and the only fields this
 * comparison reads are the configuration it varies, the coverage rows it pairs, the published point it divides by, and
 * the findings behind them.
 */
import type { CutStep, EmittedFinding, Point } from './operating-point.mjs';

/** The pull-request coverage rows an artifact carries at the point it published. */
export interface CoverageRow {
  readonly pr?: string;
  readonly covered?: readonly number[];
}

export interface PairedArtifact {
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly truePositives?: number;
  readonly falseNegatives?: number;
  readonly coverage?: { readonly byPullRequest?: readonly CoverageRow[] };
  readonly rankedFindings?: readonly EmittedFinding[];
  readonly fullEmission?: { readonly truePositives?: number; readonly falseNegatives?: number };
}

/** The `(pull request, golden)` pairs an arm was credited with. **Throws when the artifact carries no coverage block.** */
export function coverageSet(artifact: PairedArtifact): Set<string>;

export interface ArmPair {
  readonly both: number;
  readonly offOnly: number;
  readonly onOnly: number;
  readonly pValue: number;
  readonly verdict: string;
  readonly off: { readonly covered: number };
  readonly on: { readonly covered: number };
  /** The configuration keys the two arms differ in, so a comparison can say what it is a comparison of. */
  readonly varied: readonly string[];
}

export function pairArms(off: PairedArtifact, on: PairedArtifact): ArmPair;

export interface CutRow {
  readonly cut: string;
  readonly steps: readonly CutStep[];
  readonly off: Point;
  readonly on: Point;
  /** Signed `on - off`, so a negative device prints negative. */
  readonly delta: number;
}

export function cutComparison(
  off: PairedArtifact,
  on: PairedArtifact,
  budgets?: readonly number[],
): CutRow[];
