/**
 * **The declaration for `score-weights.mjs`.**
 *
 * The module parses the engine's weight table out of TypeScript source, so the one thing a compiler can check here is the
 * shape of what the parse produces: three tables of numbers, keyed by the terms the score is made of.
 */

/** The terms the score adds up, in the order the engine accumulates them. */
export const SCORE_TERMS: readonly string[];

/** The version of this reading, recorded beside a figure produced from it. */
export const SCORE_WEIGHTS_VERSION: string;

export interface ScoreWeights {
  readonly actionability: Readonly<Record<string, number>>;
  readonly severity: Readonly<Record<string, number>>;
  readonly lane: Readonly<Record<string, number>>;
}

/**
 * Parse `ACTIONABILITY_WEIGHTS`, `SEVERITY_WEIGHT` and `LANE_WEIGHT` out of the engine source.
 *
 * @throws when a table is absent, or when the weights table is missing one of {@link SCORE_TERMS}.
 */
export function readScoreWeights(source: string): ScoreWeights;
