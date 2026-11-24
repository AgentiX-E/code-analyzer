/**
 * **The declaration for `paired-difference.mjs`.**
 *
 * The module answers two questions about one comparison - does the interval on the difference exclude zero, and did the
 * reference comments change hands lopsidedly - and both are stated here so a caller cannot pass two unpaired numbers and
 * believe it measured something.
 */

/** The seed every published figure used, so a rerun reproduces it rather than approximating it. */
export const DEFAULT_SEED: number;

/** A 32-bit generator with a seed, because `Math.random` makes a published interval unreproducible. */
export function mulberry32(seed: number): () => number;

/** One arm's contribution to one pull request. */
export interface ArmPoint {
  readonly truePositives: number;
  readonly emitted: number;
  readonly goldens: number;
}

export interface BootstrapInterval {
  readonly rounds: number;
  readonly seed: number;
  readonly observed: number;
  readonly mean: number;
  readonly lo: number;
  readonly hi: number;
  readonly sd: number;
  readonly mde: number;
}

/** The interval on the F1 difference, by resampling pull requests with replacement. */
export function bootstrapF1Delta(options: {
  readonly perPullRequest: readonly { readonly base: ArmPoint; readonly alt: ArmPoint }[];
  readonly rounds?: number;
  readonly seed?: number;
}): BootstrapInterval;

/** The exact two-sided McNemar p-value on the two discordant counts. `(0, 0)` returns 1. */
export function mcnemarExact(onlyBase: number, onlyAlt: number): number;
