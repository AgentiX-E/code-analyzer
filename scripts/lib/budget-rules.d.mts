/**
 * **The budget axis, as rule families and one bound** - declared because the module is JavaScript and the tests are
 * TypeScript, and a rule is a function whose signature is the whole argument for or against it.
 */
import type { CutStep, EmittedFinding, Point } from './operating-point.mjs';

/** `test` is dropped before any budget rule runs, because the category measured as a loss at every cut. */
export const DROP_TEST: readonly CutStep[];

/** The artifact shape these rules read: the rows they budget and the coverage that says what each pull request held. */
export interface BudgetArtifact {
  readonly truePositives?: number;
  readonly falseNegatives?: number;
  readonly coverage?: {
    readonly byPullRequest?: readonly {
      readonly pr?: string;
      readonly covered?: readonly number[];
    }[];
  };
  readonly rankedFindings?: readonly EmittedFinding[];
  readonly fullEmission?: { readonly truePositives?: number; readonly falseNegatives?: number };
}

/** How many goldens each pull request held. **Throws when the artifact carries no coverage rows.** */
export function goldensByPullRequest(artifact: BudgetArtifact): Map<string, number>;

/**
 * A budget rule reads what the run can see before it decides: **the pull request's own findings, in the order the ranking
 * put them**, and how many goldens that pull request actually held - which only the oracle families are allowed to use.
 */
export type BudgetRule = (list: readonly EmittedFinding[], goldens: number) => number;

export const BUDGET_RULES: Readonly<Record<string, BudgetRule>>;

export interface BudgetRow extends Point {
  readonly rule: string;
  /** Present on the oracle row only, because it is the one rule that chooses its own budget per pull request. */
  readonly medianBudget?: number;
}

export function budgetRuleTable(artifact: BudgetArtifact): {
  readonly rows: BudgetRow[];
  readonly goldens: number;
};

/** The greedy bound: it reads the answers, so it is a ceiling on the axis and never a rule. */
export function oracleGreedy(artifact: BudgetArtifact): BudgetRow;

/** The best value of the threshold axis over the values given, with the threshold that produced it. */
export function bestScoreThreshold(
  artifact: BudgetArtifact,
  values: readonly number[],
): (Point & { readonly threshold: number }) | null;
