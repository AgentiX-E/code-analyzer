/**
 * **The corpus's second question, in types.**
 *
 * The declaration is hand-written and `declarations-match-the-script.test.ts` holds it to the module's own export list in
 * both directions - a name the module gained and this file lacks fails the type check, and a name this file invents is a
 * test asserting against something that is not there.
 */

/** A review comment as the judge is shown it: the text the reviewer wrote. */
export interface FileSemanticFinding {
  readonly text: string;
  readonly path?: string;
}

/** A reference comment as the judge is shown it: its text, and the coordinate it is shown with as context. */
export interface FileSemanticGolden {
  readonly text: string;
  readonly path?: string;
  readonly line?: number | null;
  readonly side?: string | null;
}

/** One judge call's worth of work: one file's comments against one file's reference comments. */
export interface FileSemanticJudgementJob {
  /**
   * The pull request this file belongs to.
   *
   * **A label rather than necessarily an index**: the benchmark passes the index into the list it handed over, which is
   * what lets an answer be placed, and a caller that wants the URL in its logs can pass that instead - the type says
   * "identifier" and the placement below is the one place that requires it to be a number.
   */
  readonly pr: string | number;
  /** The normalised path, which is also the grouping key the scorer uses. */
  readonly path: string;
  readonly findings: readonly FileSemanticFinding[];
  readonly goldens: readonly FileSemanticGolden[];
  /** Where each finding sits in the pull request's own list, so the answer can be placed. */
  readonly findingIndices: readonly number[];
  /** And where each reference comment sits, so a local number can become the scorer's coordinate. */
  readonly goldenIndices: readonly number[];
}

export declare const FILE_SEMANTIC_JUDGE_PROTOCOL: string;

export declare const MAX_REFERENCE_COMMENTS_PER_CALL: number;

export declare function buildFileSemanticJudgeMessages(input: {
  readonly path: string;
  readonly findings: readonly FileSemanticFinding[];
  readonly goldens: readonly FileSemanticGolden[];
}): { readonly system: string; readonly user: string };

export declare function parseFileSemanticCovers(
  text: string,
  findingCount: number,
  goldenCount: number,
): number[][] | null;

export declare function planFileSemanticJudgements(
  pulls: readonly {
    readonly pr: string | number;
    readonly findings: readonly FileSemanticFinding[];
    readonly goldens: readonly FileSemanticGolden[];
  }[],
): FileSemanticJudgementJob[];

export declare function toGlobalMatches(input: {
  readonly covers: readonly (readonly number[])[];
  readonly findingIndices: readonly number[];
  readonly goldenIndices: readonly number[];
  readonly findingCount?: number;
}): number[][];
