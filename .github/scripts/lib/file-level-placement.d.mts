/**
 * **The declaration for `file-level-placement.mjs`, so a test can assert which row a verdict was filed on.**
 *
 * A verdict filed one row off leaves every published total unchanged, because the totals are sums - and the only figure
 * that moves is the score of a cut nobody ran. That is the failure this module exists to make testable rather than
 * observable, and a test needs the shapes in types.
 */

/** The coordinate a published row came from: the pull request, and the finding's position inside it. */
export interface RowCoordinate {
  readonly pr: string | number;
  readonly at: number;
}

/** One pull request, as the judge pass was planned from. */
export interface JudgeTarget {
  readonly pr: string | number;
}

/**
 * Each row, with `fileLevelGoldens` attached when the second instrument answered the finding it is about.
 *
 * A row it did not answer keeps no field - not `[]`, which is a verdict, and not `null`, which a consumer has to
 * remember to check - so a reader defaults to the pairwise verdict it already has, which is the registered fallback.
 */
export function fileLevelOnFindings<R extends object>(input: {
  readonly rows: readonly R[];
  readonly keys: readonly RowCoordinate[];
  readonly matchesByPull: ReadonlyMap<string, readonly (readonly number[])[] | undefined>;
}): (R & { readonly fileLevelGoldens?: readonly number[] })[];

/** The verdicts one instrument gave, keyed by the pull request the rows are keyed by. */
export function verdictsByPull(input: {
  readonly pulls: readonly JudgeTarget[];
  readonly matches: readonly (readonly (readonly number[])[] | undefined)[];
}): Map<string, readonly (readonly number[])[] | undefined>;
