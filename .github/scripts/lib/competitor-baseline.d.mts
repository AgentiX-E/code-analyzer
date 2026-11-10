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
}

/** The whole file. */
export interface CompetitorBaseline {
  version: number;
  recordedAt: string | null;
  corpus: {
    fingerprint: string;
    judge: { model: string; prompt: string };
  };
  competitor: { tool: string };
  /** **Which run the rows came from and how the transcription was checked**, when the file was not written by `record`. */
  provenance?: Record<string, unknown>;
  pulls: Record<string, RecordedPull>;
}

/** One row of the corpus, as much of it as the fingerprint reads. */
export interface CorpusRow {
  githubPrUrl?: string | null;
  comments?: unknown[];
}

/** What a run should do with the arm, and the reason it is doing it. */
export type CompetitorDecision =
  | { kind: 'off'; reason: string }
  | { kind: 'record' }
  | { kind: 'replay'; pull: RecordedPull }
  | { kind: 'missing'; reason?: string };

/** What the scoring consumes, from either a purchase or a replay. */
export interface ScoredPull {
  key: string;
  matches: number[][];
  goldens: number;
  keep: boolean[];
}

export declare function parseCompetitorMode(raw: string | undefined): CompetitorMode;

export declare function corpusFingerprint(rows: readonly CorpusRow[]): string;

export declare function emptyBaseline(input: {
  fingerprint: string;
  judgeModel: string;
  tool: string;
}): CompetitorBaseline;

export declare function readBaseline(path: string): CompetitorBaseline | null;

export declare function resolveCompetitor(input: {
  mode: 'replay' | 'record' | 'off';
  baseline: CompetitorBaseline | null;
  fingerprint: string;
  judgeModel: string;
  key: string;
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

export declare function writeBaseline(path: string, baseline: CompetitorBaseline): void;

export declare function recordedPull(input: {
  matches: number[][];
  goldens: number;
  keep: unknown[];
  detail: Array<Record<string, unknown>>;
  unanswered?: number;
  findings?: number;
}): RecordedPull;

export declare function replayedPull(key: string, pull: RecordedPull): ScoredPull;

export declare function describeDecision(decision: CompetitorDecision, key: string): string;
