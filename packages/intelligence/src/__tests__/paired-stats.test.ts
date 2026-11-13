// **A difference is not a finding until the questions say so.**
//
// `EVAL-CONTRACT.md` §30.5 ends with a 0.0054 MRR gap that is smaller than the 0.0085 an identical arm moves on a
// re-run, and calls it "inside the band". **That is the strongest sentence an aggregate difference can support**, and it
// is weaker than it needs to be: both arms were measured on the *same five hundred questions in the same run*, and the
// analysis threw the pairing away by subtracting two averages.
//
// These tests are the arithmetic that keeps it. **The cases are hand-computable on purpose** - a binomially exact
// p-value is a number a reader can check on one line - because an interval nobody can recompute is a number nobody can
// argue with.

import { describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  MRR_CUT,
  compareArms,
  decodeRanks,
  encodeRanks,
  foundWithin,
  mcnemarExact,
  reciprocalRank,
} from '../search/paired-stats.js';

describe('a rank is a number inside the cut or it is an absence', () => {
  it('reads a rank, an absence and a counter that never fired as three different things', () => {
    expect(reciprocalRank(1)).toBe(1);
    expect(reciprocalRank(2)).toBe(0.5);
    expect(reciprocalRank(10)).toBe(0.1);
    // **Eleven is outside the cut**, which is what makes `MRR@10` a cut rather than a mean over the list.
    expect(reciprocalRank(11)).toBe(0);
    expect(reciprocalRank(null)).toBe(0);
    expect(reciprocalRank(undefined)).toBe(0);
    // **Zero and a negative are absences**, not hits at the front: a 1-based rank of zero is a parser that returned
    // `-1`, and scoring it as a perfect hit would make the arms with the most failures look the best.
    expect(reciprocalRank(0)).toBe(0);
    expect(reciprocalRank(-1)).toBe(0);
    expect(reciprocalRank(Number.NaN)).toBe(0);
  });

  it('answers the same question for the count, at the same cut', () => {
    expect(foundWithin(1)).toBe(true);
    expect(foundWithin(10)).toBe(true);
    expect(foundWithin(11)).toBe(false);
    expect(foundWithin(null)).toBe(false);
    expect(foundWithin(0)).toBe(false);
    // **The cut is a parameter**, so a figure quoted at another cut is not quoted at this one.
    expect(foundWithin(20, 20)).toBe(true);
    expect(reciprocalRank(20, 20)).toBe(0.05);
  });
});

describe('the exact test is a binomial tail, and every case here can be checked by hand', () => {
  it('calls complete agreement no evidence rather than infinite evidence', () => {
    // **The failure mode this guards is the worst one available**: a test that called two identical arms significant
    // would license every change anybody wanted to ship.
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(5, 5)).toBe(1);
  });

  it('computes 2 · P(smaller tail) with no normal approximation', () => {
    // Ten discordant pairs, all on one side: 2 × 1/2^10.
    expect(mcnemarExact(10, 0)).toBeCloseTo(2 / 1_024, 12);
    // Seven on one side and two on the other: 2 × (1 + 9 + 36)/512.
    expect(mcnemarExact(7, 2)).toBeCloseTo(92 / 512, 12);
    // Six and zero is the smallest one-sided count that clears 0.05: 2/64, against 2/128 one question later.
    expect(mcnemarExact(6, 0)).toBeCloseTo(0.031_25, 12);
    expect(mcnemarExact(7, 0)).toBeCloseTo(0.015_625, 12);
  });

  it('is symmetric in its two counts', () => {
    for (const [onlyA, onlyB] of [
      [3, 9],
      [0, 6],
      [11, 4],
    ]) {
      expect(mcnemarExact(onlyA!, onlyB!)).toBeCloseTo(mcnemarExact(onlyB!, onlyA!), 12);
    }
  });

  it('does not underflow where a float would', () => {
    // **900 discordant pairs was the case that mattered**: `0.5 ** 900` is zero in double precision, so a p-value
    // computed from the power directly would be reported as 0 - a claim of exhaustive evidence from a single run.
    const p = mcnemarExact(900, 0);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-100);
    // And the even split stays a one.
    expect(mcnemarExact(400, 400)).toBe(1);
  });

  it('refuses counts that are not counts', () => {
    expect(() => mcnemarExact(-1, 3)).toThrow(/non-negative/);
    expect(() => mcnemarExact(1.5, 3)).toThrow(/non-negative/);
  });
});

describe('the comparison keeps the pairing, which is the only reason it is worth computing', () => {
  it('reports zero for two arms that returned the same answers in a different order', () => {
    // **Identical lists give an interval of exactly zero**, and that is the pairing: an independent bootstrap would
    // report two intervals that overlap without saying the difference is nil.
    const result = compareArms([1, 2, 3], [1, 2, 3]);
    expect(result.deltaMrr).toBe(0);
    expect(result.mrrInterval).toEqual([0, 0]);
    expect(result.pValue).toBe(1);
    expect(result.distinguishable).toBe(false);
    expect(result.queries).toBe(3);
    expect(result.cut).toBe(MRR_CUT);
  });

  it('separates a rank difference from a found difference', () => {
    // **A reorder that swaps two hits is not a difference in `found@10`**: both arms found every answer, so the exact
    // test has nothing to work with and says 1 - while MRR moved by exactly a quarter.
    const result = compareArms([1, 1, 2, 2], [2, 2, 1, 1]);
    expect(result.foundA).toBe(4);
    expect(result.foundB).toBe(4);
    expect(result.onlyA).toBe(0);
    expect(result.onlyB).toBe(0);
    expect(result.pValue).toBe(1);
    expect(result.deltaMrr).toBe(0);
  });

  it('counts a rescue and a loss as the discordant pairs the exact test needs', () => {
    // One question rescued, three lost: four discordant pairs, all but one on B's side, so 2 × (1 + 4)/16 = 0.625.
    // **Four discordant questions cannot be significant however lopsided they are**, and the exact test says so rather
    // than letting a three-to-one ratio read as a finding.
    const result = compareArms([1, null, null, null, 1, 2], [2, 1, 2, 3, null, 1]);
    expect(result.foundA).toBe(3);
    expect(result.foundB).toBe(5);
    expect(result.onlyA).toBe(1);
    expect(result.onlyB).toBe(3);
    expect(result.pValue).toBeCloseTo(0.625, 12);
    expect(result.distinguishable).toBe(false);
    // **And the direction of the MRR delta is the direction of the difference**, which is the one thing an aggregate
    // difference and a paired one agree on.
    expect(result.deltaMrr).toBeLessThan(0);
  });

  it('calls six one-sided rescues distinguishable and five not', () => {
    // **This is the sentence the artifact needs**: how many one-sided questions it takes before the run can say the
    // arms differ. Six, at 2/64 against a 0.05 bar - not "a large number", which is what a reader assumes.
    const five = compareArms([1, 1, 1, 1, 1, null], [null, null, null, null, null, null]);
    expect(five.onlyA).toBe(5);
    expect(five.distinguishable).toBe(false);
    const six = compareArms([1, 1, 1, 1, 1, 1], [null, null, null, null, null, null]);
    expect(six.onlyA).toBe(6);
    expect(six.distinguishable).toBe(true);
  });

  it('is reproducible, because an interval that moves is not evidence', () => {
    const a = [1, 2, 3, null, 5, 11, 4, 2, null, 1];
    const b = [2, 1, 4, 3, null, 6, 2, 1, 9, 2];
    const first = compareArms(a, b);
    const second = compareArms(a, b);
    expect(second).toEqual(first);
    // **The default seed is a published number**, so a reader recomputes this document's intervals rather than their own.
    expect(compareArms(a, b, { seed: BOOTSTRAP_SEED })).toEqual(first);
  });

  it('brackets the point estimate with a finite interval', () => {
    const a = [1, 2, null, 4, 7, 3, 1, null, 2, 9];
    const b = [3, 1, 2, 6, null, 4, 2, 5, 1, null];
    const result = compareArms(a, b);
    expect(result.mrrInterval[0]).toBeLessThanOrEqual(result.mrrInterval[1]);
    expect(Number.isFinite(result.mrrInterval[0])).toBe(true);
    expect(Number.isFinite(result.mrrInterval[1])).toBe(true);
    // **A 2 000-resample percentile interval of a mean contains the mean** on any sample this size; asserting it here is
    // a check on the resampling code rather than on the data.
    expect(result.mrrInterval[0]).toBeLessThanOrEqual(result.deltaMrr);
    expect(result.mrrInterval[1]).toBeGreaterThanOrEqual(result.deltaMrr);
  });

  it('keeps the resample count a parameter, so a caller can buy precision', () => {
    const a = [1, 1, 1, 2, 2, null];
    const b = [2, 2, 3, 1, 1, 4];
    const cheap = compareArms(a, b, { resamples: 10 });
    expect(cheap.queries).toBe(6);
    expect(cheap.mrrInterval[0]).toBeLessThanOrEqual(cheap.mrrInterval[1]);
    expect(BOOTSTRAP_RESAMPLES).toBeGreaterThan(1_000);
  });

  it('refuses two lists that are not the same questions', () => {
    // **This is the defect a paired test exists to prevent**: two arms over different question sets cannot be paired,
    // and a comparison that silently truncated to the shorter one would publish a figure about nobody's corpus.
    expect(() => compareArms([1, 2], [1, 2, 3])).toThrow(/same questions/);
    expect(() => compareArms([], [])).toThrow(/no questions/);
  });
});

describe('a published column is a rank list, and an absence is not a zero', () => {
  it('round-trips the shape the artifact publishes', () => {
    const ranks = [1, 2, null, 10, null, 43];
    expect(encodeRanks(ranks)).toBe('1,2,-,10,-,43');
    expect(decodeRanks(encodeRanks(ranks))).toEqual(ranks);
    // **An empty column is an empty list**, which is a measurement of nothing rather than a parse failure.
    expect(encodeRanks([])).toBe('');
    expect(decodeRanks('')).toEqual([]);
  });

  it('refuses a zero rather than reading it as an absence', () => {
    // **This is the whole reason the encoding exists.** A rank of zero is a 1-based counter that never fired, and a
    // decoder that accepted it would publish a hit at the front of the list.
    expect(() => decodeRanks('1,0,3')).toThrow(/not a rank/);
    expect(() => decodeRanks('1,2.5')).toThrow(/not a rank/);
    expect(() => decodeRanks('1,abc')).toThrow(/not a rank/);
  });

  it('checks the question count when the caller names it', () => {
    expect(decodeRanks('1,-', 2)).toEqual([1, null]);
    // **A column shorter than the corpus is a comparison over a subset nobody chose**, which is why the count is
    // assertable at the decode rather than three functions later.
    expect(() => decodeRanks('1,-', 3)).toThrow(/expected 3 ranks/);
  });

  it('produces the same comparison as the in-memory lists it was written from', () => {
    // **The artifact and the module are the two halves of the claim**: a reader with the JSON decodes the columns and
    // gets the published interval, or the artifact was not what was analysed.
    const a = [1, 2, null, 4, 11, 3];
    const b = [2, null, 1, 9, 5, 3];
    expect(compareArms(decodeRanks(encodeRanks(a)), decodeRanks(encodeRanks(b)))).toEqual(
      compareArms(a, b),
    );
  });
});
