/**
 * **The declaration for `gate-replay-page.mjs`.**
 *
 * The page is pure string building, which is exactly the kind of code that gets tested by looking at it: a broken row
 * renders as a table with a column missing and nobody notices for three iterations. So the shape is declared and the
 * tests assert the four properties a page has to have - one row per pull request, no external reference, a filter per
 * decision, and a refusal when there is nothing to draw.
 */

/** One pull request's line on the page, as the replay reports it. */
export interface GateReplayRow {
  readonly pr: string;
  readonly applied: boolean;
  readonly withheld: string | null;
  readonly findings: number;
  readonly readable: number;
  readonly dropped: number;
  readonly postedBefore: number;
  readonly postedAfter: number;
  readonly goldensBefore: number;
  readonly goldensAfter: number;
}

/** The report the page is drawn from. Only the fields the page reads are named, so a wider report still renders. */
export interface GateReplayForPage {
  readonly cut: { readonly label: string };
  readonly baseline: {
    readonly emitted: number;
    readonly truePositives: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
  };
  readonly gated: GateReplayForPage['baseline'];
  readonly reproduced: boolean | null;
  readonly delta: { readonly f1: number };
  readonly removals: { readonly posted: number; readonly share: number | null };
  readonly goldens: { readonly lost: readonly string[]; readonly gained: readonly string[] };
  readonly gate: {
    readonly withheldPullRequests: number;
    readonly byReason: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
    readonly perPullRequest: readonly GateReplayRow[];
  };
}

/** The page, or a throw when the report carries no rows: a figure with nothing behind it is not a page. */
export function renderGateReplayPage(
  report: GateReplayForPage,
  options?: { readonly title?: string },
): string;
