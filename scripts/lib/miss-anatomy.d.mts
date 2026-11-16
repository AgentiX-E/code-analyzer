export interface MissAnatomyBand {
  'true-positive': number;
  'false-positive': number;
}

export interface MissAnatomy {
  /** Every golden the artifact recorded, which is the denominator of every share below. */
  goldens: number;
  /** The attribution's own buckets, passed through unchanged so a caller can reconcile this table against it. */
  buckets: Record<string, number>;
  /** How many goldens were rejected on a path we commented on - the bucket this module splits. */
  rejected: number;
  /** Rejects whose nearest comment could not be found in `rankedFindings`, reported rather than folded into a cell. */
  unlinked: number;
  /** Whether every reject landed in exactly one cell. */
  reconciled: boolean;
  matrix: Record<'sameLine' | 'near' | 'beyond', MissAnatomyBand>;
  /** The share of rejects whose nearest comment matched a *different* golden. */
  neighbourIsAccepted: number;
  silence: { pathNotInPull: number; notReviewed: number; noFindingOnPath: number };
}

export declare function decomposeMisses(bench: unknown): MissAnatomy;
export declare function describeMisses(anatomy: MissAnatomy): string;
