/**
 * **A difference the corpus cannot resolve is not a difference, and this is the arithmetic that says so.**
 *
 * Iteration 147 priced every term of the actionability score by removing it, and the best single move looked like a
 * **+0.0053 F1** gain from dropping the hedge penalty. Resampling the fifty pull requests puts the 95 % interval at
 * **[−0.0050, +0.0146]**: the point estimate is real, the corpus cannot tell it from zero, and choosing terms on one half
 * of the corpus and reading them on the other picks a *different* term in each direction. The lesson is not about the
 * score - it is that **a fifty-pull-request corpus has a resolution, and every remaining move has to be quoted against
 * it** rather than against zero.
 *
 * Two tests, because they answer different questions and one is much more powerful than the other:
 *
 * - {@link bootstrapF1Delta} resamples pull requests with replacement and reports the interval on ΔF1. It is the test a
 *   reader expects, and it is the weaker one: F1 is a ratio of two sums, so a single reference comment moving changes it.
 * - {@link mcnemarExact} asks a sharper question - of the reference comments exactly one side bought, is the split
 *   lopsided? - and it is the one that can resolve a consistent gain of eight comments where ΔF1 sits under the noise.
 *
 * Both are paired: the same resampled pull requests, or the same reference comments, on both sides. **An unpaired
 * comparison of two F1 numbers over two row sets is not a measurement**, which is the defect §140.5 and §141 removed one
 * level up.
 */

/** The seed every published figure used, so a rerun reproduces it rather than approximating it. */
export const DEFAULT_SEED = 20_261_124;

/** Two-sided 95 % and 80 % power, the constants a minimum detectable effect is made of. */
const Z_ALPHA = 1.959_964;
const Z_POWER = 0.841_621;

/** A 32-bit generator with a seed, because `Math.random` makes a published interval unreproducible. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const round6 = (x) => Math.round(x * 1_000_000) / 1_000_000;

const f1Of = (point) => {
  const denominator = point.emitted + point.goldens;
  return denominator === 0 ? 0 : (2 * point.truePositives) / denominator;
};

/**
 * The interval on the F1 difference, by resampling pull requests.
 *
 * @param perPullRequest one entry per pull request, each carrying both arms' `{truePositives, emitted, goldens}`.
 * @param rounds        resamples; 2000 is the disclosure the contract's statistics section names.
 * @param seed          the generator's seed, published beside the interval.
 */
export function bootstrapF1Delta({ perPullRequest, rounds = 2000, seed = DEFAULT_SEED }) {
  if (perPullRequest.length === 0)
    return { rounds: 0, seed, observed: 0, mean: 0, lo: 0, hi: 0, sd: 0, mde: 0 };

  const sums = (sample) => {
    let baseTrue = 0;
    let baseEmitted = 0;
    let baseGoldens = 0;
    let altTrue = 0;
    let altEmitted = 0;
    let altGoldens = 0;
    for (const entry of sample) {
      baseTrue += entry.base.truePositives;
      baseEmitted += entry.base.emitted;
      baseGoldens += entry.base.goldens;
      altTrue += entry.alt.truePositives;
      altEmitted += entry.alt.emitted;
      altGoldens += entry.alt.goldens;
    }
    return (
      f1Of({ truePositives: altTrue, emitted: altEmitted, goldens: altGoldens }) -
      f1Of({ truePositives: baseTrue, emitted: baseEmitted, goldens: baseGoldens })
    );
  };

  const observed = sums(perPullRequest);
  const random = mulberry32(seed);
  const n = perPullRequest.length;
  const deltas = [];
  for (let round = 0; round < rounds; round += 1) {
    const sample = [];
    for (let k = 0; k < n; k += 1) sample.push(perPullRequest[Math.floor(random() * n)]);
    deltas.push(sums(sample));
  }
  deltas.sort((a, b) => a - b);

  const mean = deltas.reduce((total, value) => total + value, 0) / rounds;
  const variance = deltas.reduce((total, value) => total + (value - mean) ** 2, 0) / rounds;
  const sd = Math.sqrt(variance);
  const at = (p) =>
    deltas[Math.min(deltas.length - 1, Math.max(0, Math.floor(p * (deltas.length - 1))))];

  return {
    rounds,
    seed,
    observed: round6(observed),
    mean: round6(mean),
    lo: round6(at(0.025)),
    hi: round6(at(0.975)),
    sd: round6(sd),
    /** The smallest difference this design could show, at 5 % two-sided and 80 % power. */
    mde: round6((Z_ALPHA + Z_POWER) * sd),
  };
}

/**
 * **The exact McNemar test on the reference comments exactly one arm bought.**
 *
 * The statistic is the smaller of the two discordant counts, and the p-value is the two-sided exact binomial probability
 * of a split at least that lopsided under "both arms are equally likely to buy a given comment". Exact rather than
 * asymptotic because the discordant count is small - eight, on the run this was written for - and a chi-square
 * approximation on eight cells is a claim about a normal that is not there.
 *
 * `(0, 0)` returns 1: two arms that bought the same comments agree, and agreeing is not evidence of a difference.
 */
export function mcnemarExact(onlyBase, onlyAlt) {
  const n = onlyBase + onlyAlt;
  if (n === 0) return 1;
  const smaller = Math.min(onlyBase, onlyAlt);
  let tail = 0;
  let coefficient = 1;
  for (let k = 0; k <= smaller; k += 1) {
    if (k > 0) coefficient = (coefficient * (n - k + 1)) / k;
    tail += coefficient;
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}
