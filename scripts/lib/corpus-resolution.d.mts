/**
 * **A corpus error bar computed from one artifact** - declared because the module is JavaScript and the tests are
 * TypeScript.
 */
/** One artifact's per-pull-request coverage row, as the bench writes it. */
export interface CoverageRow {
  readonly pr?: string;
  readonly goldens?: number;
  readonly covered?: readonly number[];
  /** What was posted, which is what a false positive is counted from. */
  readonly shippedEmitted?: number;
  /** What was produced before the gate and the budget; read only when `shippedEmitted` is absent. */
  readonly emitted?: number;
}

export interface PullRequestOutcome {
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  /** Set when the row carried no `shippedEmitted`, so the false positives are an upper bound rather than a count. */
  readonly estimated?: boolean;
}

export interface BootstrapOptions {
  readonly resamples?: number;
  readonly seed?: number;
}

export interface BootstrapDelta {
  /** Standard deviation of the paired difference - the resolution a registration's bar has to clear. */
  readonly sd: number;
  readonly mean: number;
  readonly lower: number;
  readonly upper: number;
  /** Share of draws on which the registered arm came out ahead; a coin flip is no evidence. */
  readonly positiveRate: number;
  readonly resamples: number;
  readonly pullRequests: number;
  readonly goldens: number;
  readonly estimated?: boolean;
}

export declare function perPullRequestOutcome(row: CoverageRow): PullRequestOutcome;
export declare function f1From(tp: number, fp: number, fn: number): number;
export declare function clusterBootstrapDelta(
  withRows: readonly CoverageRow[],
  withoutRows: readonly CoverageRow[],
  options?: BootstrapOptions,
): BootstrapDelta;
export declare function corpusResolution(
  withRows: readonly CoverageRow[],
  withoutRows: readonly CoverageRow[],
  options?: BootstrapOptions,
): number;
export declare function pullRequestsForResolution(
  resolution: number,
  options?: { anchor?: { pullRequests: number; deltaSd: number } | null },
): number;
