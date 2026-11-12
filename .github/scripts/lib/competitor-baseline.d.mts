// Types for `competitor-baseline.mjs`.
//
// **Why a hand-written declaration rather than a rewrite in TypeScript.** The module is imported by a `.mjs` script that
// runs under plain node with no build step, and by tests that run through vitest - so **the file it imports has to be
// the file that runs**. A `.ts` source would put a build between the harness and its own logic, which is the one place
// this repository has kept free of one.

/** The schema of the baseline file. */
export declare const BASELINE_VERSION: number;

/** Where the recorded competitor result lives, relative to the repository root. */
export declare const DEFAULT_BASELINE_PATH: string;

/** The identity of the judge prompt. */
export declare const JUDGE_PROMPT_VERSION: string;

/** What a mode read from the environment resolved to. */
export interface CompetitorMode {
  mode: 'replay' | 'record' | 'off';
  reason: string | null;
}

/** One recorded pull request, in the shape the scoring consumes. */
export interface RecordedPull {
  matches: number[][];
  goldens: number;
  keep: boolean[];
  detail: Array<Record<string, unknown>>;
  unanswered: number;
  findings: number;
  /** **A pull request the competitor was run on and produced nothing for.** Recorded, not omitted. */
  failed?: boolean;
  /**
   * **The goldens this row was produced against.**
   *
   * Absent on rows transcribed from an artifact that did not carry it, and **the absence is not an error**: the replay
   * reports whether the row was checked by fingerprint or only by count, and the artifact counts each kind.
   */
  fingerprint?: string;
}

/** The whole file. */
/** One origin of the rows: a run that recorded them live, or a run whose artifact they were transcribed from. */
export interface BaselineOrigin {
  how: string;
  pulls: number;
  run: string;
  source?: string;
  checkedBy?: string;
  why?: string;
}

/** **The file's account of itself**, recomputed by `refreshProvenance` from the rows rather than carried forward. */
export interface BaselineProvenance {
  measuredAt?: string;
  why?: string;
  origins?: BaselineOrigin[];
  originRule?: string;
  knownAbsences?: { pulls: string[]; reason?: string };
  [key: string]: unknown;
}

export interface CompetitorBaseline {
  version: number;
  recordedAt: string | null;
  corpus: {
    fingerprint: string;
    judge: { model: string; prompt: string };
  };
  competitor: { tool: string };
  /** **Which run the rows came from and how the transcription was checked**, when the file was not written by `record`. */
  provenance?: BaselineProvenance;
  pulls: Record<string, RecordedPull>;
}

/** One row of the corpus, as much of it as the fingerprint reads. */
export interface CorpusRow {
  githubPrUrl?: string | null;
  comments?: unknown[];
}

/**
 * **How a replayed row was checked.** `fingerprint` means this pull request's goldens were hashed and matched; `count`
 * means the row predates per-pull fingerprints and only its golden count could be compared.
 */
export type ReplayVerification = 'fingerprint' | 'count';

/** What a run should do with the arm, and the reason it is doing it. */
export type CompetitorDecision =
  | { kind: 'off'; reason: string }
  | { kind: 'record'; reason?: string }
  | { kind: 'replay'; pull: RecordedPull; verified: ReplayVerification }
  | { kind: 'missing'; reason?: string };

/** One pull request as the resolver sees it: its key, its goldens, and their fingerprint. */
export interface PullFacts {
  key: string;
  fingerprint: string;
  goldens: number;
}

/** What the scoring consumes, from either a purchase or a replay. */
export interface ScoredPull {
  key: string;
  matches: number[][];
  goldens: number;
  keep: boolean[];
}

export declare function parseCompetitorMode(raw: string | undefined): CompetitorMode;

/**
 * **The fingerprint of the whole selection.** Metadata about which corpus produced a record - **it no longer refuses a
 * row**, because a row's validity is a property of that row and not of how many other rows were selected.
 */
export declare function corpusFingerprint(rows: readonly CorpusRow[]): string;

/** **The fingerprint of one pull request's goldens**, which is the identity a recorded row is checked against. */
export declare function pullFingerprint(row: CorpusRow | null | undefined): string;

export declare function emptyBaseline(input: {
  fingerprint: string;
  judgeModel: string;
  tool: string;
}): CompetitorBaseline;

export declare function readBaseline(path: string): CompetitorBaseline | null;

export declare function resolveCompetitor(input: {
  mode: 'replay' | 'record' | 'off';
  baseline: CompetitorBaseline | null;
  judgeModel: string;
  pull: PullFacts;
}): CompetitorDecision;

export declare function withRecord(
  baseline: CompetitorBaseline,
  key: string,
  pull: RecordedPull,
): CompetitorBaseline;

export declare function startRecording(input: {
  existing: CompetitorBaseline | null;
  fingerprint: string;
  judgeModel: string;
  tool: string;
}): CompetitorBaseline;

/**
 * **The file's account of itself, recomputed from its own rows.** Counts are derived from the `fingerprint` mark, and the
 * absences from the selection the run scored, so a record that grew by replaying rows it did not buy still describes
 * itself correctly.
 */
export declare function refreshProvenance(
  baseline: CompetitorBaseline,
  options?: { selection?: Array<string | null | undefined>; run?: string },
): CompetitorBaseline;

export declare function writeBaseline(path: string, baseline: CompetitorBaseline): void;

export declare function recordedPull(input: {
  matches: number[][];
  goldens: number;
  keep: unknown[];
  detail: Array<Record<string, unknown>>;
  unanswered?: number;
  findings?: number;
  fingerprint?: string;
}): RecordedPull;

export declare function replayedPull(key: string, pull: RecordedPull): ScoredPull;

export declare function describeDecision(decision: CompetitorDecision, key: string): string;
