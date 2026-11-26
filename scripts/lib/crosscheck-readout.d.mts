// **Declarations for the paired readout**, for the reason `diff-side-lines.d.mts` gives: a test that imports a `.mjs`
// without one compiles against `any`, and `pairedChange` returning an untyped object would let a wrong `delta` pass.

/** A row of a benchmark artifact, with the position it holds in the published list. */
export interface ArtifactRow {
  at?: number;
  pr?: string;
  path?: string;
  startLine?: number;
  score?: number;
  category?: string;
  text?: string;
  [field: string]: unknown;
}

/** One cut step, as `operating-point.mjs` applies it. */
export type CutStep = { kind: string; k?: number; categories?: string[]; classes?: string[] };

/** What a set of rows earns at one operating point. */
export interface Point {
  emitted: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  rows: ArtifactRow[];
}

/** What moved between two readings of the same pairs. */
export interface PairedChange {
  pairs: number;
  broken: number;
  fixed: number;
  delta: number;
  p: number;
}

export declare function postedRows(
  rows: ArtifactRow[],
  steps: CutStep[],
  budget: number,
): ArtifactRow[];

export declare function withRewrites(
  posted: ArtifactRow[],
  rewrites: Map<number, string>,
): ArtifactRow[];

export declare function pointOf(
  rows: ArtifactRow[],
  creditOf: (row: ArtifactRow) => number[],
  goldens: number,
  steps: CutStep[],
  budget: number,
): Point;

export declare function pairedChange(bitsA: boolean[], bitsB: boolean[]): PairedChange;
