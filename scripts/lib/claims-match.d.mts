// **Declarations for the claims library, because a test that imports it through an undeclared `.mjs` reaches an `any`**
//
// `a-second-reading-is-only-evidence-if-it-is-controlled.test.ts` imported this module and the CI type-check failed with
// TS7016 and three cascading errors - two implicit-any parameters and an `unknown` in a `catch`. **The test was correct
// and the module was fine; what was missing was a statement of what the module returns**, and the ratchet is right to
// refuse the hole rather than record it: a pair whose `note` is `any` cannot be shown to be the golden's sentence.

/** The three buckets a re-read sorts a rejected pair into. */
export type PairKind = 'same-defect' | 'different-defect' | 'not-a-defect';

/** What the re-read's prompt is allowed to answer. */
export type ClaimVerdict = 'same' | 'different' | 'wording';

declare const PAIR_KINDS_INNER: readonly PairKind[];

export declare const PAIR_KINDS: typeof PAIR_KINDS_INNER;

/** The nearest finding an artifact attached to a rejected golden. */
export interface NearestFinding {
  text: string;
  startLine: number;
  endLine: number;
}

/** One record in an artifact's `missedGoldens.records`, as far as this library reads it. */
export interface MissedGoldenRecord {
  bucket?: string;
  proximity?: number;
  note?: string;
  pr?: string;
  path?: string;
  goldenIndex?: number;
  nearestFinding?: NearestFinding;
}

/** One real pair: a golden's sentence and the comment that was rejected against it. */
export interface ClaimPair {
  id: string;
  pr: string;
  path: string;
  goldenIndex: number;
  startLine: number;
  endLine: number;
  note: string;
  comment: string;
}

/** One control pair: the same comment against a golden it is not supposed to match. */
export interface ClaimControl extends ClaimPair {
  donorId: string;
  donorPath: string;
}

/**
 * One re-read's answer for one pair, with every control's answer for the same pair beside it.
 *
 * **The four answers are `string` rather than `ClaimVerdict`**, because they arrive as lines of a JSONL file this library
 * reads and does not write: a caller that has parsed a file has a `string`, and a declaration that demanded the union
 * would make every such caller cast the value it is about to validate. **The validation is the library's job** - it
 * accepts exactly `'same'`, `'different'` and `'wording'` and treats anything else as unanswered.
 */
export interface RejudgeRow {
  id?: string;
  real?: string | null;
  crossed?: string | null;
  sameFile?: string | null;
  samePull?: string | null;
}

/** What one control answered, and how much of it the same reader produced without the pairing. */
export interface ControlRate {
  answered: number;
  same: number;
  share: number;
}

/** What the re-read found, with the control subtracted. */
export interface RejudgeSummary {
  pairs: number;
  answered: number;
  unanswered: number;
  same: number;
  different: number;
  wording: number;
  realShare: number;
  crossed: ControlRate;
  sameFile: ControlRate;
  samePull: ControlRate;
  floorFrom: 'none' | 'crossed' | 'sameFile' | 'samePull';
  floorShare: number;
  lift: number;
  beyondControl: number;
}

/** **The pairs a re-read can be run on**: on the file, on the line, and rejected. */
export declare function sameLineRejects(artifact: object | null | undefined): ClaimPair[];

/** **The harder negative**: a different golden from the same file of the same pull request. */
export declare function samePullRequestControl(
  artifact: object | null | undefined,
  pairs: readonly ClaimPair[],
  options?: { samePath?: boolean },
): ClaimControl[];

/** **The same pairs with the golden taken from a different pull request.** */
export declare function crossPairControl(
  pairs: readonly ClaimPair[],
  options?: { stride?: number },
): ClaimControl[];

/** The one question the second reader is asked, built from the two sentences and nothing else. */
export declare function claimsPrompt(input: { note: string; comment: string }): string;

/** **What the re-read found, with the control subtracted** - the only number that licenses a re-scoring is `beyondControl`. */
export declare function summariseRejudge(rows: readonly RejudgeRow[]): RejudgeSummary;

/** **The two readings of one corpus, paired**, so the difference between them carries the disagreement rather than the corpus size. */
export interface ReadingComparison {
  field: string;
  paired: number;
  unpaired: number;
  unanswered: number;
  bothSame: number;
  aOnly: number;
  bOnly: number;
  discordant: number;
  shareA: number;
  shareB: number;
  difference: number;
  mcnemarP: number;
  withinBar: boolean;
  pairsRule: boolean;
  bar: number;
  alpha: number;
}

/** **The floor is a property of the pairs only if a second judge reproduces it** - and the bar is pre-registered. */
export declare function compareReadings(
  rowsA: readonly RejudgeRow[],
  rowsB: readonly RejudgeRow[],
  options?: { field?: string; bar?: number; alpha?: number },
): ReadingComparison;

/** **How many unanswered calls a reading may carry before it is a reading of something else.** */
export declare const UNANSWERED_LIMIT: number;

/** **Whether a reading may be quoted at all**, so a failed reading is a loud refusal rather than a table of rates. */
export declare function readingIsUsable(summary?: { pairs?: number; unanswered?: number }): boolean;

/** **The ceiling an escalated answer budget stops at.** */
export declare const TOKEN_CEILING: number;

/** **The answer budget after a truncated call: eight times the last one, capped** - a judge that needs room asks by truncating. */
export declare function escalateTokens(current: number): number;
