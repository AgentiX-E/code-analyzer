/**
 * **The declaration for `file-cut.mjs`, so a test can read the arithmetic a table of cuts is built from.**
 *
 * The module is `.mjs` because the bench CLI and `scripts/aacr-file-cut-table.mjs` both call it with plain `node`, and
 * the repository keeps a `.d.mts` beside such a module for the reason `anchor-rate.d.mts` gives: **a helper that is only
 * exercised through its CLI is a helper whose arithmetic is asserted by reading printed output**, which is how a table
 * gets pasted into a document instead of being rebuilt from the artifact.
 */

/** One comment, as the two instruments see it: the position it was emitted at and the reference comments it was credited. */
export interface ScoredFinding {
  /** The pull request it belongs to. Golden indices are per pull request, so this is a coordinate and not a label. */
  readonly pr?: string | null;
  /** The file the walk groups by. */
  readonly path?: string | null;
  /** The second instrument's verdict, when the run bought one; the first instrument's otherwise. */
  readonly fileLevelGoldens?: readonly number[];
  readonly matchedGoldens?: readonly number[];
  readonly category?: string | null;
  readonly score?: number;
}

/** A cut, scored under `file-level-semantic-v1`. */
export interface FileCutPoint {
  emitted: number;
  /** Comments that covered at least one reference comment nothing before them had covered. */
  hitNewGt: number;
  /** Comments that covered only reference comments an earlier comment had already covered. */
  duplicateHits: number;
  coveredGoldens: number;
  precision: number;
  recall: number;
  f1: number;
}

export function scoreFileCut(input: {
  readonly findings: readonly ScoredFinding[];
  /** The corpus's size. Passed in rather than counted from the cut, or a cut would report the recall of what it kept. */
  readonly goldens: number;
  readonly matchesOf: (finding: ScoredFinding) => readonly number[];
}): FileCutPoint;
