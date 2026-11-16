/**
 * **A comment earns its place when it is more precise than half the F1 it joins.**
 *
 * Every device this campaign is still considering adds comments rather than replacing them - a second concern at a site
 * we already read, a lane we have never priced, a budget raised from twelve. The question they all have to answer is the
 * same one, and §58.4 answered it with a number that was wrong by a factor of three: it said a new sentence needs a
 * precision above **0.30** to be worth writing, while the arithmetic says **0.10**. A wrong threshold that is too high
 * does not make the campaign cautious, it makes it blind: **every device that adds a comment reads as ruled out.**
 *
 * The closed form is what makes the threshold checkable rather than asserted. With `TP` credited goldens, `C` comments
 * and `G` goldens,
 *
 *     F1 = 2·TP / (C + G)
 *
 * because `F1 = 2PR/(P+R)` with `P = TP/C` and `R = TP/G` cancels to it. **A run's F1 is a ratio of credit to the sum
 * of its two denominators**, so the marginal value of one more comment is `2·p/(C+G)` against a cost of `1/(C+G)`:
 * the threshold is `p > TP/(C+G) = F1/2`, and it does not depend on how many comments are added.
 *
 * Three properties are asserted here, because three ways of getting this wrong all read as a reasonable table:
 *
 * - **the closed form equals the formula it replaces**, on every point including the degenerate ones;
 * - **the threshold is the point's own F1 halved**, not a constant and not the precision;
 * - **the projection agrees with the threshold's sign**, so a row cannot cross the line without saying so.
 */
import { describe, expect, it } from 'vitest';

import {
  breakEvenPrecision,
  f1FromCounts,
  projectAddition,
  score,
} from '../../../scripts/lib/operating-point.mjs';

/** A point built from three numbers, which is all `score` needs once the credit is a count. */
function pointFrom(truePositives: number, emitted: number, goldens: number) {
  const findings = Array.from({ length: emitted }, (_, at) => ({
    pr: 'p',
    matchedGoldens: at < truePositives ? [at] : [],
  }));
  return score(
    findings,
    (finding: { matchedGoldens?: readonly number[] }) => finding.matchedGoldens ?? [],
    goldens,
  );
}

describe('the F1 of a point is its credit over the sum of its denominators', () => {
  it('agrees with the precision-and-recall formula it replaces', () => {
    for (const [tp, c, g] of [
      [143, 656, 724],
      [192, 1109, 724],
      [3, 6, 4],
      [2, 3, 4],
      [0, 500, 724],
      [724, 724, 724],
      [1, 1, 1],
    ] as const) {
      const point = pointFrom(tp, c, g);
      expect(point.f1, `${tp}/${c}/${g}`).toBeCloseTo(f1FromCounts(tp, c, g), 10);
    }
  });

  it('is zero rather than undefined when nothing was emitted or the corpus is empty', () => {
    expect(f1FromCounts(0, 0, 0)).toBe(0);
    expect(f1FromCounts(0, 10, 0)).toBe(0);
    expect(Number.isNaN(f1FromCounts(0, 0, 10))).toBe(false);
  });

  it('publishes nothing a caller cannot divide by', () => {
    const empty = score([], () => [], 0);
    expect(empty.f1).toBe(0);
    expect(Number.isFinite(breakEvenPrecision(empty))).toBe(true);
  });
});

describe('the threshold for adding a comment is half the F1 it would join', () => {
  it('is the shipped run\u2019s F1 halved, which is 0.104 and not 0.30', () => {
    const shipped = pointFrom(143, 656, 724);
    expect(shipped.f1).toBeCloseTo(0.2072, 4);
    expect(breakEvenPrecision(shipped)).toBeCloseTo(0.1036, 4);
    // **The number §58.4 published was 0.30**, and the difference is the difference between "every device that adds a
    // comment is ruled out" and "one of them is worth a dispatch".
    expect(breakEvenPrecision(shipped)).toBeLessThan(0.15);
  });

  it('does not depend on how many comments are added', () => {
    const shipped = pointFrom(143, 656, 724);
    const threshold = breakEvenPrecision(shipped);
    // **`null` is the arithmetic's way of saying no number of further comments pays for itself**, so the assertion is
    // part of the test rather than a `?? 1` default: a default would run the loop below against a threshold that does
    // not exist and pass on a point that cannot break even at any precision.
    expect(threshold).not.toBeNull();
    if (threshold === null)
      throw new Error('a shipped point with 143 credited goldens has a break-even precision');
    // **The credit is a count, so the line is crossed between two integers** - the question a projection answers is
    // "how many of the N new comments have to be credited", and that answer is `floor(threshold·N) + 1` for every N.
    for (const n of [24, 226, 656, 2295]) {
      const needed = Math.floor(threshold * n) + 1;
      const just = projectAddition(shipped, { comments: n, truePositives: needed });
      const oneShort = projectAddition(shipped, { comments: n, truePositives: needed - 1 });
      expect(just.delta, `n=${n}`).toBeGreaterThan(0);
      expect(oneShort.delta, `n=${n}`).toBeLessThan(0);
      // and the rule the two rows are checked against is the point's own F1 halved, not a constant
      expect(needed / n, `n=${n}`).toBeGreaterThan(threshold);
      expect((needed - 1) / n, `n=${n}`).toBeLessThanOrEqual(threshold);
    }
  });

  it('reads the budget\u2019s own removal the way the artifact did', () => {
    // The run's 1109 candidates carry 192 credited goldens; the shipped cut of 656 carries 143. **So the budget's 453
    // deleted comments were worth 49 goldens - a marginal precision of 0.108**, which is above the 0.104 threshold and
    // is why removing the budget moves F1 by +0.002 instead of by nothing. A threshold of 0.30 would have called this
    // deletion free.
    const shipped = pointFrom(143, 656, 724);
    const uncut = projectAddition(shipped, { comments: 453, truePositives: 49 });
    expect(uncut.precision).toBeCloseTo(192 / 1109, 4);
    expect(uncut.delta).toBeGreaterThan(0);
    expect(uncut.delta).toBeLessThan(0.005);
  });

  it('rules a device out only when its own marginal precision is below the line', () => {
    const shipped = pointFrom(143, 656, 724);
    const thin = projectAddition(shipped, { comments: 226, truePositives: 226 * 0.05 });
    const rich = projectAddition(shipped, { comments: 226, truePositives: 226 * 0.19 });
    expect(thin.delta).toBeLessThan(0);
    expect(rich.delta).toBeGreaterThan(0.02);
  });

  it('never reports a gain from comments that were all wrong', () => {
    const shipped = pointFrom(143, 656, 724);
    const useless = projectAddition(shipped, { comments: 500, truePositives: 0 });
    expect(useless.delta).toBeLessThan(0);
    expect(useless.recall).toBeCloseTo(shipped.recall, 10);
  });
});
