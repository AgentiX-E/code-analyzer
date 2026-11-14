// Types for `file-semantic.mjs`.
//
// **These exist because the arithmetic is the thing being asserted, and `any` would let the assertion be about nothing.**
// The module is `.mjs` because it is imported by the harness as well as by tests; the declaration is what keeps a test
// that reads `score.findings` from compiling after the field is renamed.

/** One reference comment, in the shape `attributeGoldens` already reads. */
export interface Golden {
  path: string;
  note?: string;
  startLine?: number | null;
  [field: string]: unknown;
}

/** One generated comment, in the shape the ranked list already carries. */
export interface Finding {
  path: string;
  text?: string;
  [field: string]: unknown;
}

/** What both scorers take: the two lists, and the verdicts the judge already returned, by finding index. */
export interface FileSemanticInput {
  findings: readonly Finding[];
  goldens: readonly Golden[];
  matches: ReadonlyArray<readonly number[]>;
}

/** The counts every rate in this module is computed from, and nothing derived. */
export interface FileSemanticCounts {
  findings: number;
  goldens: number;
  /** Comments that covered at least one reference comment nothing before them covered. */
  hitNewGt: number;
  /** Comments that matched only reference comments an earlier comment had already covered. */
  duplicateHits: number;
  coveredGoldens: number;
  /** Verdicts naming a reference comment on another file, which the protocol cannot produce. */
  crossFileVerdicts: number;
  /** Reference comments whose own path is empty, so no verdict about them is refused for being cross-file. */
  unlocatedGoldens: number;
}

/** The counts, the two names that scope them, and the three rates. */
export interface FileSemanticScore extends FileSemanticCounts {
  protocol: string;
  judge: string;
  precision: number;
  recall: number;
  f1: number;
}

/** One normalised path's two lists, each in arrival order. */
export interface PathGroup {
  findings: Finding[];
  goldens: Golden[];
}

export declare const FILE_SEMANTIC_PROTOCOL: string;
export declare const FILE_SEMANTIC_JUDGE: string;

export declare function normaliseFilePath(path: unknown): string;

export declare function groupByPath(input: {
  findings: readonly Finding[];
  goldens: readonly Golden[];
}): ReadonlyMap<string, PathGroup>;

export declare function scoreFileSemantic(input: FileSemanticInput): FileSemanticScore;

/** The corpus figure: the counts added, then divided - never the per-pull rates averaged. */
export declare function scoreCorpusFileSemantic(input: {
  pulls: ReadonlyArray<FileSemanticInput>;
}): FileSemanticScore;
