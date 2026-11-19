/**
 * **The budget is a cost decision, and this is the declaration that lets a test read it as one.**
 *
 * `scripts/budget-frontier.mjs` is `.mjs` because it is called with plain `node` and imports nothing but `node:fs`; a
 * helper that is only exercised through its CLI is a helper whose arithmetic is asserted by pasting its printed table
 * into a document, which is what §96's predecessor did and what this file exists to stop.
 */

/** One budget, scored over the whole run, with the modelled cost of the finding text it kept. */
export interface BudgetRow {
  budget: number;
  kept: number;
  /** Distinct goldens matched at this budget, which is what the protocol counts. */
  matched: number;
  precision: number;
  recall: number;
  f1: number;
  characters: number;
  /** `characters / 4`, which is a proxy: the artifact records no usage. */
  tokens: number;
  goldensPerThousandTokens: number;
  f1PerThousandTokens: number;
  /** What this budget bought over the one below it. */
  marginal: { goldens: number; tokens: number; goldensPerThousandTokens: number };
}

export interface BudgetFrontier {
  comment: string[];
  measuredAt: string;
  source: string;
  corpusGoldens: number;
  /** The budget the artifact was produced with, read from it: no row above this one is a measurement of a bigger budget. */
  runBudget: number | null;
  rows: BudgetRow[];
  verdict: {
    bestF1Budget: number;
    bestF1: number;
    shippedBudget: number | null;
    runBudgetSitsAtBestF1: boolean;
    /** The first budget that spent tokens and matched no golden it did not already have. */
    firstBudgetThatBoughtNothing: number | null;
    /** Everything above the best budget in one row: findings, goldens, tokens and the F1 it changed by. */
    aboveBest: {
      toBudget: number;
      findingsAdded: number;
      goldensAdded: number;
      tokensAdded: number;
      f1Change: number;
    };
  };
}

/** The artifact this reads, in whatever shape the run wrote it; only these fields are read. */
export interface BenchArtifact {
  measuredAt?: string;
  configuration?: { pullRequestBudget?: number };
  coverage: { byPullRequest: Array<{ goldens: number }> };
  rankedFindings: Array<{
    pr: string;
    actionable?: boolean;
    score: number;
    text: string;
    matchedGoldens?: string[];
  }>;
}

export function buildFrontier(bench: BenchArtifact): BudgetFrontier;
