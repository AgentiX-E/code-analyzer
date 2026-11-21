/**
 * Declarations for `spend-pair.mjs`, because the module is JavaScript and the tests that hold it are TypeScript.
 *
 * The shapes are the ones the benchmark writes: a `spend` block with the reviewer's ledger totals, the judge's separately
 * counted bill, and the configuration the arm varied. Nothing here is required, because an artifact from before a field
 * existed is still an artifact - and **the functions accept a partial block and answer `null` for a figure they cannot
 * price, which is the only answer that cannot be mistaken for a cheap arm.**
 */

/** One model's prices, per million tokens, in USD. */
export interface SpendPrices {
  readonly cacheHit: number;
  readonly cacheMiss: number;
  readonly output: number;
}

/** A token group as either the ledger or the judge block reports it. */
export interface SpendGroup {
  readonly calls?: number;
  readonly promptTokens?: number;
  readonly cacheHitTokens?: number;
  readonly cacheMissTokens?: number;
  readonly completionTokens?: number;
  readonly costUsd?: number | null;
  readonly cacheNeutralUsd?: number | null;
}

/** The artifact fields this module reads. */
export interface SpendArtifact {
  readonly spend?: (SpendGroup & { readonly judge?: SpendGroup | null }) | null;
  readonly configuration?: {
    /** The named set the arm ran (`{ name, lanes }`), or the list alone in an artifact from before names existed. */
    readonly laneSet?:
      string | readonly string[] | { readonly name?: string; readonly lanes?: readonly string[] };
    readonly emissionProfile?: string;
  };
}

/** A bill with the share of prompt tokens that hit the cache, added. `hitRatio` is `null` when no split was reported. */
export interface PricedBill {
  readonly calls: number;
  readonly promptTokens: number;
  readonly cacheHitTokens: number;
  readonly cacheMissTokens: number;
  readonly completionTokens: number;
  readonly usd: number | null;
  readonly coldUsd: number | null;
  /** The arm's own peak/off-peak multiplier, recovered from the bill it was charged, or `null` when unpriced. */
  readonly factor: number | null;
  readonly hitRatio: number | null;
}

export interface PricedArm {
  readonly label: string;
  readonly engine: PricedBill;
  readonly judge: PricedBill | null;
  readonly total: PricedBill;
}

/** What one group's tokens cost at the table's prices, with the cache charged at the hit rate. */
export function listUsdOf(group: SpendGroup | null | undefined, prices: SpendPrices): number;

/** The arm's own peak/off-peak multiplier, recovered from its own bill, or `null` for an unpriced bill. */
export function factorOf(group: SpendGroup | null | undefined, prices: SpendPrices): number | null;

/** The same bill with every prompt token charged as a miss and the arm's own multiplier applied. */
export function coldUsdOf(group: SpendGroup | null | undefined, prices: SpendPrices): number | null;

/** One arm's three bills: the reviewer, the judge, and the two added. */
export function readArm(artifact: SpendArtifact | null | undefined, prices: SpendPrices): PricedArm;

/** A short name for the arm, from the lane set it ran or the profile it emitted at. */
export function labelOf(artifact: SpendArtifact | null | undefined): string;

export interface SpendRow {
  readonly part: 'engine' | 'judge' | 'total';
  readonly a: PricedBill;
  readonly b: PricedBill;
  readonly usdRatio: number | null;
  readonly coldUsdRatio: number | null;
  readonly promptTokenRatio: number | null;
  readonly callRatio: number | null;
}

export interface SpendComparison {
  readonly a: string;
  readonly b: string;
  readonly prices: SpendPrices;
  readonly rows: readonly SpendRow[];
  /** `null` when a unit is missing, because "the units agree" is a statement this file cannot make without both. */
  readonly unitsAgree: boolean | null;
}

/** The two arms side by side, in four units, with whether the units agree about the direction of the difference. */
export function compareSpend(a: PricedArm, b: PricedArm, prices: SpendPrices): SpendComparison;
