/**
 * **The shape of a selection audit**: one knob, a table of candidates, and the figure a campaign would have published
 * had it been forced to decide without the row it was deciding about.
 *
 * Every interface here is read from one artifact - the verdicts one paid run already carries - so nothing in this file
 * describes a measurement that needs a dispatch.
 */

/** One finding as the artifact carries it: the fields a cut reads, and nothing else. */
export interface EmittedRow {
  pr?: string;
  pullRequest?: string;
  path?: string;
  file?: string;
  category?: string;
  startLine?: number;
  endLine?: number;
  score?: number;
  matchedGoldens?: Array<{ index?: number } | number>;
}

/** A point of the corpus's own arithmetic: what a cut emitted and what the matching credited. */
export interface AuditPoint {
  emitted: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
}

/** A candidate the audit scored in sample. */
export interface InSampleCandidate<T> {
  point: AuditPoint;
  /** The category removed, or `''` for "remove nothing". Present on the category audit only. */
  category?: string;
  /** The cap applied. Present on the budget audit only. */
  k?: number;
}

/** What one knob's audit produced. */
export interface Audit<T> {
  inSample: Array<InSampleCandidate<T>>;
  heldOut: AuditPoint;
  /** How many folds chose each candidate, so a reader can see a decision that is confident and wrong. */
  choices: Map<T, number>;
}

export type CreditOf = (finding: EmittedRow) => number[];

export declare function emittedCategories(findings: readonly EmittedRow[]): string[];
export declare function pullRequestsOf(findings: readonly EmittedRow[]): string[];

export declare function heldOut<T>(
  fittings: readonly EmittedRow[],
  options: {
    choose: (rows: readonly EmittedRow[]) => T;
    stepsOf: (choice: T) => Array<Record<string, unknown>>;
    baseSteps: ReadonlyArray<Record<string, unknown>>;
  },
): { kept: EmittedRow[]; choices: Map<T, number> };

export declare function categorySteps(category: string): Array<Record<string, unknown>>;
export declare function budgetSteps(k: number): Array<Record<string, unknown>>;

export declare function auditCategories(
  findings: readonly EmittedRow[],
  creditOf: CreditOf,
  goldens: number,
  baseSteps: ReadonlyArray<Record<string, unknown>>,
): Audit<string>;

export declare function auditBudgets(
  findings: readonly EmittedRow[],
  creditOf: CreditOf,
  goldens: number,
  baseSteps: ReadonlyArray<Record<string, unknown>>,
  budgets: readonly number[],
): Audit<number>;

export declare function verdictOf(input: {
  shipped: AuditPoint;
  audited: { heldOut: AuditPoint };
  budgetAudited: { heldOut: AuditPoint };
}): {
  shippedF1: number;
  categoriesHeldOutF1: number;
  categoriesDelta: number;
  categoriesEarned: boolean;
  budgetsHeldOutF1: number;
  budgetsDelta: number;
  noiseBand: number;
};
