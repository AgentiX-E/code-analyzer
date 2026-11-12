/** What one pull request has cost us to score, per arm, with the margin a ceiling needs. */
export declare const CEILING_USD_PER_PULL_REQUEST: { replay: number; record: number };

/** What a pull request costs when the reviewer is an agent rather than five lanes. Provisional, not fitted. */
export declare const CEILING_USD_PER_PULL_REQUEST_AGENT: number;

/** The smallest ceiling that still admits the run the registration was written against. */
export declare const CEILING_USD_FLOOR: { replay: number; record: number };

/** The number of pull requests a run will read; refuses anything that is not a positive integer. */
export declare function requestedPullRequests(
  raw: string | number | null | undefined,
  options?: { fallback?: number },
): number;

/** What this run may spend, from its size and what it intends to buy. */
export declare function spendCeilingUsd(input: {
  pullRequests: string | number;
  mode?: string | null;
  override?: string | number | null;
  /**
   * Whether the reviewer is the reading agent. **The agent rate replaces the lane rate rather than adding to it**,
   * except in `record`, where both are paid for.
   */
  agent?: boolean;
}): number;

/** Where in the corpus a run starts; refuses anything that is not a non-negative integer. */
export declare function skippedPullRequests(
  raw: string | number | null | undefined,
  options?: { fallback?: number },
): number;
