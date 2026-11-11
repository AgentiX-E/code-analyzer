// Types for `paired-corpus.mjs`.

/** One side's scored row: the goldens its findings matched, the golden count, and one keep flag per finding. */
export interface ScoredRow {
  key: string;
  goldens: number;
  matches: number[][];
  keep: boolean[];
  [field: string]: unknown;
}

/** One pull request, as both arms scored it. */
export interface PairedRow {
  key: string;
  ours: ScoredRow;
  theirs: ScoredRow;
}

/** A pull request left out of the pairing, and which side left it out. */
export interface ExcludedPull {
  key: string;
  reason: string;
}

export interface PairedCorpus {
  pullRequests: number;
  pairs: PairedRow[];
  /** Pull requests we scored that the competitor has no row for. */
  excluded: ExcludedPull[];
  /** Pull requests the competitor scored that this run has no row for. */
  theirsOnly: ExcludedPull[];
}

/** The emission rule both arms are scored under: which golden indices a row's surviving findings cover. */
export type EmissionRule = (row: ScoredRow) => { indices: number[] };

export declare const COMPETITOR_ROW_ABSENT: string;
export declare const OUR_ROW_ABSENT: string;

export declare function pairedCorpus(input: {
  ours?: ScoredRow[];
  theirs?: ScoredRow[];
  keyOf?: (pull: ScoredRow) => string;
}): PairedCorpus;

export declare function goldenDiscordance(
  pairs: PairedRow[],
  rule: EmissionRule,
): { oursOnly: number; theirsOnly: number };
