/**
 * **The declaration for `symbol-anatomy.mjs`, so a test can read the same arithmetic the command prints.**
 *
 * The module is `.mjs` because the instrument and the gates call it with plain `node`, and this repository keeps a
 * `.d.mts` beside such a file for the reason `anchor-rate.d.mts` states: **an arithmetic that is only exercised through a
 * CLI is an arithmetic asserted by reading output**, which is how a table gets pasted into a document instead of rebuilt.
 */

/** One row of a pool, addressed by the index it holds in the artifact so that a plan can rewrite it. */
export interface PoolRow {
  text?: string;
  pr?: string;
  path?: string;
  score?: number | string;
  category?: string;
  profileGoldens?: number[];
  matchedGoldens?: number[];
}

/** A pull request's posted comments, each with the artifact index it came from. */
export type Pool = Map<string, { at: number; row: PoolRow }[]>;

/** A golden as the reading needs it: an identity, the sentence, and the specific symbols of that sentence. */
export interface Golden {
  key: string;
  pullRequest?: string;
  index?: number;
  category?: string;
  note?: string;
  symbols: string[];
}

/** How the two arms' credited goldens divide. */
export interface CreditSets {
  ours: Set<string>;
  theirs: Set<string>;
  shared: number;
  onlyOurs: number;
  onlyTheirs: string[];
}

/** The counts a null distribution is reported by. */
export interface NullDistribution {
  permutations: number;
  seed: number;
  mean: number;
  p95: number;
  max: number;
}

/** One scored point: the comments a cut emits, and the goldens a matching buys. */
export interface Point {
  emitted: number;
  truePositives: number;
  f1: number;
}

/** A rewrite priced under both readings of "the sentence changed". */
export interface Oracle {
  converted: number;
  findings: number;
  additive: { ceiling: number; atBudget: Point };
  replacement: { ceiling: number; atBudget: Point };
}

/** One planned correction: which golden, which comment, and the symbols that connect them. */
export interface PlanEntry {
  key: string;
  golden: number;
  findingAt: number | null;
  symbols: string[];
}

/** The two fields the arithmetic of a rewrite reads, so a caller does not have to carry the rest of a plan. */
export interface PlanUnit {
  golden: number;
  findingAt: number | null;
}

export function identifiersOf(text: unknown): string[];
export function documentFrequency(pool: Pool): Map<string, number>;
export function specificSymbols(
  text: unknown,
  frequency: Map<string, number>,
  cap: number,
): string[];
export function namesSymbol(text: unknown, symbol: string): boolean;
export function symbolsTheDiffNames(symbols: string[], names: Iterable<string>): string[];
export function goldenKey(pullRequest: string, index: number): string;
export function splitKey(key: string): [string, number];
export function creditedGoldens(
  findings: PoolRow[],
  creditOf: (finding: PoolRow) => number[],
): Set<string>;
export function creditSets(input: {
  ours: PoolRow[] | null;
  theirs: Record<string, { detail?: { matchedGoldens?: number[] }[] }> | null;
  maps: Map<string, Map<number, number>>;
  creditOf: (finding: PoolRow) => number[];
}): CreditSets;
export function adjacency(input: { goldens: Golden[]; poolByPullRequest: Pool }): (Golden & {
  matches: number[];
})[];
export function permutationNull(input: {
  goldens: Golden[];
  poolByPullRequest: Pool;
  permutations: number;
  seed: number;
}): NullDistribution;
export function baseRate(input: { goldens: Golden[]; poolByPullRequest: Pool }): {
  goldens: number;
  withSymbols: number;
  adjacent: number;
};
export function wrongPullRequest(input: {
  goldens: Golden[];
  poolByPullRequest: Pool;
  repositoryOf: (pullRequest: string) => string;
}): { adjacent: number; uncontrolled: number };
export function rewriteOracle(input: {
  rows: PoolRow[];
  creditOf: (finding: PoolRow) => number[];
  goldens: number;
  steps: Record<string, unknown>[];
  budget: number;
  plan: PlanUnit[];
}): Oracle;
export function conversionsNeeded(input: {
  truePositives: number;
  emitted: number;
  goldens: number;
  target: number;
}): { replacement: number; additive: number };
export function conversionCurve(input: {
  rows: PoolRow[];
  creditOf: (finding: PoolRow) => number[];
  goldens: number;
  steps: Record<string, unknown>[];
  budget: number;
  plan: PlanUnit[];
  points?: number;
}): { converted: number; credited: number; f1: number }[];
export function firstClearing(
  curve: { converted: number; f1: number }[],
  target: number,
): number | null;
export function ranksOf(input: {
  plan: PlanUnit[];
  rows: PoolRow[];
  steps: Record<string, unknown>[];
  poolByPullRequest: Pool;
}): (PlanUnit & { rank: number | null })[];
export class SymbolAnatomyInputError extends Error {}
