/**
 * **The declarations exist because the module is JavaScript and the tests are TypeScript.**
 *
 * `tsconfig.tests.json` typechecks the tests, and a `.mjs` import without declarations is `any` - which is how a typo in
 * a field name survives to a table that reads plausibly and adds up wrong. The types here are the ones the module
 * actually honours: a finding is whatever the artifact wrote, and the only fields this arithmetic reads are named.
 */

/** One finding as an artifact stores it. **Only the fields the arithmetic reads are required.** */
export interface EmittedFinding {
  readonly pr?: string;
  readonly path?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly category?: string;
  readonly severity?: string;
  readonly actionable?: boolean;
  readonly score?: number | { readonly score?: number; readonly actionable?: boolean };
  /** The golden indices this finding's judge verdicts allow it to claim, **within its own pull request**. */
  readonly matchedGoldens?: readonly number[];
}

export type CutStep =
  | { readonly kind: 'drop'; readonly categories: readonly string[] }
  | { readonly kind: 'keep-category'; readonly categories: readonly string[] }
  | { readonly kind: 'gate' }
  | { readonly kind: 'budget'; readonly k: number };

export interface Point {
  readonly emitted: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export function maximumMatchingByPullRequest(
  findings: readonly EmittedFinding[],
  creditOf: (finding: EmittedFinding) => readonly number[],
): number;

export function pullRequestOf(finding: EmittedFinding | undefined): string;

export function score(
  findings: readonly EmittedFinding[],
  creditOf: (finding: EmittedFinding) => readonly number[],
  goldens: number,
): Point;

/**
 * **F1 as credit over the sum of its denominators** - the cancelled form of `2PR/(P+R)`, and the form that prices an
 * added comment: one more comment earns its place when its own precision exceeds `TP/(C+G)`, which is half the F1 it
 * joins. Published rather than private so a reader can check a threshold against the figure it came from.
 */
export function f1FromCounts(truePositives: number, emitted: number, goldens: number): number;

/** **Half the point's F1**, the precision an added comment needs to raise F1 rather than lower it. */
export function breakEvenPrecision(point: Point | undefined): number | null;

/** **One point projected onto a run that wrote `comments` more comments**, `truePositives` of them credited. */
export function projectAddition(
  point: Point | undefined,
  added: { readonly comments: number; readonly truePositives: number },
): Point & { readonly delta: number };

export function applyCut(
  findings: readonly EmittedFinding[],
  steps: readonly CutStep[],
): EmittedFinding[];

export function describeCut(steps: readonly CutStep[]): string;

export function registeredCuts(
  budgets?: readonly number[],
): ReadonlyArray<{ readonly steps: readonly CutStep[] }>;

export function parseCut(text: string): CutStep[];

export const TABLE_HEADER: string;

export function formatRow(label: string, point: Point, width?: number): string;

/** The score the budget step sorts by, exported because a second reader of one ranking is how two orders diverge. */
export function scoreOf(finding: EmittedFinding | undefined): number;

/** One row of the table an artifact carries: the cut, the steps that reproduce it, and the point it was scored at. */
export interface OperatingPointRow extends Point {
  readonly cut: string;
  readonly steps: readonly CutStep[];
}

/**
 * **The registered cuts, scored, as rows an artifact carries beside the `rankedFindings` they were computed from.**
 *
 * `goldens` is the corpus denominator (`truePositives + falseNegatives` at the published point), never the cut's own
 * misses.
 */
export function operatingPointTable(
  findings: readonly EmittedFinding[],
  goldens: number,
  budgets?: readonly number[],
): OperatingPointRow[];
