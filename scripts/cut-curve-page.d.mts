/**
 * **The declarations exist because the renderer is JavaScript and the tests are TypeScript.**
 *
 * A `.mjs` import without declarations is `any`, and the renderer's whole job is to read fields the instrument wrote -
 * so an undeclared field name would survive into a page that draws a blank cell and adds up. The types here are the ones
 * `scripts/cut-curve.mjs` actually writes and this module actually reads.
 */

/** One row of a curve: an operating point at one per-pull-request budget. */
export interface CurveRow {
  readonly budget: number;
  readonly emitted: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/** The held-out half, chosen on one half of the pull requests and read on the other. */
export interface SplitHalf {
  readonly chosenOn: string;
  readonly chosenGoldens: number;
  readonly heldOutGoldens: number;
  readonly budget: number;
  readonly chosenF1: number;
  readonly heldOut: CurveRow;
  /** `null` when the artifact published no cut, which is every artifact older than the policy. */
  readonly heldOutAtShipped: CurveRow | null;
  readonly gain: number | null;
}

/** One artifact's curve, as `cut-curve-v1` records it. */
export interface Curve {
  readonly artifact: string;
  readonly corpus?: string | null;
  readonly cut: string;
  readonly profile: string;
  readonly budgets?: readonly number[];
  readonly shippedBudget: number | null;
  readonly shipped: CurveRow | null;
  readonly goldens: number;
  readonly curve: readonly CurveRow[];
  readonly best: { readonly budget: number; readonly f1: number };
  readonly costAtBest: number | null;
  readonly splitHalf?: SplitHalf;
}

/** The three readings S35 produced, in the order the page shows them. */
export declare const SOURCES: readonly string[];

/** Raised for input this renderer will not draw, rather than drawing an empty panel over it. */
export declare class UnreadableCurveError extends Error {}

/**
 * Read one file into one curve, or refuse it.
 *
 * Refuses a version it does not know, a file with no curve, a curve row that is not `{budget, f1}`, and **a `best` whose
 * budget is not a row of that curve** - the one claim a table can carry and a page cannot.
 */
export declare function read(source: string, text: string): Curve;

/** A board name from the artifact the curve was measured on. */
export declare function boardOf(record: { readonly artifact?: string } | undefined): string;

/** A denominator name, because `all` and `core` are denominators and not labels. */
export declare function basisOf(record: { readonly profile?: string } | undefined): string;

/** One inline SVG chart: the curve, the shipped point and the best point. */
export declare function chart(record: Curve): string;

/** One table of the curve's rows, with the shipped and best budgets named in the row. */
export declare function table(record: Curve): string;

/** One summary row, which is the claim the panels evidence. */
export declare function summary(record: Curve, index: number): string;

/** The whole document. Deterministic: no clock, no run id, and no ordering that depends on a `Map`. */
export declare function page(records: readonly Curve[]): string;

/** Read the files and write `docs/cut-curve.html`. */
export declare function main(argv: readonly string[]): void;
