/**
 * **The declaration for `anchor-rate.mjs`, so a test can read the same arithmetic the command prints.**
 *
 * The script is `.mjs` because the harness and the gates call it with plain `node`, and the repository keeps a `.d.mts`
 * beside such a script for exactly this reason (`polyglot-oracle.d.mts` is the other one): **a helper that is only
 * exercised through its CLI is a helper whose arithmetic is asserted by reading the output**, which is the way a table
 * gets pasted into a document instead of being rebuilt.
 */

/** One cut of one artifact's emitted comments, scored against the artifact's own denominator. */
export interface AnchorRow {
  emitted: number;
  tp: number;
  precision: number;
  recall: number;
  f1: number;
}

/** The whole table: the rate, the three cuts, and the 2×2 the verdict turns on. */
export interface AnchorTable {
  emitted: number;
  anchoringRate: number;
  all: AnchorRow;
  anchored: AnchorRow;
  unanchored: AnchorRow;
  cell: {
    anchoredAndRight: number;
    anchoredAndWrong: number;
    unanchoredAndRight: number;
    unanchoredAndWrong: number;
  };
}

/** A ranked finding as every artifact of this harness writes it. */
export interface ArtifactRow {
  matchedGoldens: string[];
  features: { anchored?: boolean } & Record<string, unknown>;
}

export function anchorTable(findings: ArtifactRow[], falseNegatives: number): AnchorTable;
export function formatAnchorTable(table: AnchorTable): string;
export function findingsOf(artifact: {
  rankedFindings?: ArtifactRow[];
  pullRequestArm?: { rankedFindings?: ArtifactRow[] };
}): ArtifactRow[];
