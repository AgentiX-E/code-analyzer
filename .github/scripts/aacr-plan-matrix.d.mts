// **Declarations for the planner, because a test that imports it would otherwise be a test over `any`.**
//
// The type-check gate refuses an implicit any rather than recording one (TS7016), so a script a test reads needs a
// declaration beside it. This one is short on purpose: the planner has one row type and four functions, and
// `declarations-match-the-script.test.ts` reads both files to keep them equal - the drift that file was written for is
// exactly what happens when a hand-written declaration outlives the script it describes.

/** One matrix row: the baseline with some keys overridden. Every key is a string, because the workflow reads strings. */
export type PlanRow = Readonly<Record<string, string>>;

/** The reviewer every published figure was measured on, with all ten keys present. */
export const BASE: PlanRow;

/** The factors `window: grid` varies, in the order their loops nest. */
export const GRID_FACTORS: readonly string[];

/** The full `2^3` factorial over `GRID_FACTORS`, baseline row first. */
export function gridRows(): PlanRow[];

/** The arms a dispatch buys, from its `workflow_dispatch` inputs. */
export function planMatrix(inputs?: Record<string, string | undefined>): PlanRow[];

/**
 * Which experiment a set of rows is.
 *
 * `'pair'` is a subtraction over one key, `'grid'` a factorial over `k` keys at two levels, `'single'` everything else -
 * and saying `'single'` for a shape that is neither is better than analysing it as one.
 */
export function experimentKind(rows: readonly PlanRow[]): 'pair' | 'grid' | 'single';
