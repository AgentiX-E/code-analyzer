// @code-analyzer — The paired test the review benchmarks share
//
// **Why this is a module rather than two copies.** A benchmark that compares two configurations of one engine compares
// **two reviewers on the same goldens**, and the statistic that answers it is the two-sided exact binomial tail over
// the discordant pairs. **The same statistic is computed in two places**: inside one job, between two arms of the same
// run, and between two runs that differ in one configuration flag. **Two copies of a significance test drift**, and a
// p-value produced by a copy that drifted is a number nobody can reproduce - which is the one thing this repository
// refuses to publish.
//
// **And exact rather than asymptotic.** McNemar's chi-square approximation needs roughly ten discordant pairs before it
// is usable; a corpus of a hundred and forty goldens where one configuration gains six and loses two has eight. The
// exact tail is valid at any count, and at small counts it is the difference between "not significant" and "cannot
// say" - which is a distinction the report has to be able to make.

/** `n choose k`, as a float, because the counts here are tens and the answers are far inside the safe range. */
export function choose(n, k) {
  let value = 1;
  for (let i = 0; i < k; i += 1) value = (value * (n - i)) / (i + 1);
  return value;
}

/**
 * **Exact McNemar, because two reviewers scored on the same goldens are paired data.**
 *
 * The statistic is the two-sided exact binomial tail over the discordant pairs: **the goldens one reviewer found and
 * the other did not** are the only observations that carry information about which reviewer is better. Goldens both
 * found, and goldens neither found, are agreement - and **a test that counts them inflates its own sample and calls a
 * difference significant because the corpus is large.**
 *
 * Returned unrounded; the caller decides how many digits an artifact keeps.
 */
export function exactMcNemar(oursOnly, theirsOnly) {
  const n = oursOnly + theirsOnly;
  if (n === 0) return 1;
  let mass = 0;
  for (let i = 0; i <= Math.min(oursOnly, theirsOnly); i += 1) mass += choose(n, i);
  return Math.min(1, (2 * mass) / 2 ** n);
}

/**
 * **The pairing itself, over coverage sets**, so both callers build the sets the same way.
 *
 * A coverage set is `${pullRequestKey}#${goldenIndex}` - **the key a corpus needs**, because a golden index alone is
 * only unique within its pull request. Both benchmarks key it this way, and **this function asserts that the two sets
 * were drawn from the same corpus** by returning the counts it was given rather than inventing any.
 */
export function pairedComparison(oursCoverage, theirsCoverage) {
  const both = [...oursCoverage].filter((key) => theirsCoverage.has(key)).length;
  const oursOnly = [...oursCoverage].filter((key) => !theirsCoverage.has(key)).length;
  const theirsOnly = [...theirsCoverage].filter((key) => !oursCoverage.has(key)).length;
  const pValue = exactMcNemar(oursOnly, theirsOnly);
  return {
    both,
    oursOnly,
    theirsOnly,
    pValue,
    verdict: pValue <= 0.05 ? 'significant at 0.05' : 'not significant at 0.05',
  };
}
