/** What one pull request has cost us to score, per arm, with the margin a ceiling needs. */
export declare const CEILING_USD_PER_PULL_REQUEST: { replay: number; record: number };

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
}): number;
