// @code-analyzer — a floor read by two judges is evidence about the pairs only when the two readings are compared pair by pair
//
// **Why this file exists.** §69.4's answer - 18.6 % of rejected pairs accepted against a 16.0 % same-file floor, 6.97
// recoverable goldens - is quoted as a property of the corpus, and it was produced by one judge: `deepseek-chat`, the
// same model that wrote the comments being judged. **A rate is not a property of the pairs until a second reader
// reproduces it**, and the second reader cannot be compared to the first by subtracting two percentages, because the two
// readings are the same pairs: the difference between them is paired, and its error bar is the discordant pairs rather
// than the sample size.
//
// **So the comparison is a table, not a subtraction.** Each pair contributes one of four cells - both judges said
// "same", only the first did, only the second did, neither - and McNemar's exact test is the binomial on the two
// discordant cells. **A comparison that subtracted 0.16 from 0.21 and called the 0.05 a difference would be reporting
// the sample size of the corpus as if it were the disagreement between the judges.**

import { describe, expect, it } from 'vitest';

import { compareReadings, readingIsUsable } from '../../../scripts/lib/claims-match.mjs';

function row(id: string, sameFile: string | null): { id: string; sameFile: string | null } {
  return { id, sameFile };
}

describe('two readings of one corpus are compared pair by pair', () => {
  it('reports no difference and no evidence when the judges agree everywhere', () => {
    const a = [row('a', 'same'), row('b', 'different'), row('c', 'different')];
    const b = [row('a', 'same'), row('b', 'different'), row('c', 'different')];

    const comparison = compareReadings(a, b);

    expect(comparison.paired).toBe(3);
    expect(comparison.difference).toBe(0);
    expect(comparison.aOnly).toBe(0);
    expect(comparison.bOnly).toBe(0);
    // **p is 1 rather than 0**: no discordant pair is a test that cannot separate anything, and a p of 0 there would be
    // the strongest possible claim from the least possible evidence.
    expect(comparison.mcnemarP).toBe(1);
    expect(comparison.withinBar).toBe(true);
  });

  it('counts the discordant pairs in the direction each judge went', () => {
    // One pair the second judge accepted and the first rejected, one the other way round: the marginals are equal and
    // the readings still disagree, which is the case a subtraction reports as "identical".
    const a = [row('a', 'different'), row('b', 'same')];
    const b = [row('a', 'same'), row('b', 'different')];

    const comparison = compareReadings(a, b);

    expect(comparison.aOnly).toBe(1);
    expect(comparison.bOnly).toBe(1);
    expect(comparison.difference).toBe(0);
    // **And the disagreement is visible in the paired table even though the difference is zero**, because a reader
    // deciding whether to trust the floor needs to know the judges swapped a pair, not only that the rates matched.
    expect(comparison.discordant).toBe(2);
    // Two discordant pairs cannot separate at any conventional level: the exact two-sided binomial is 1.
    expect(comparison.mcnemarP).toBe(1);
  });

  it('separates a lopsided disagreement from a balanced one at the same difference', () => {
    // **Twelve pairs one way and three the other** is a difference of nine pairs out of fifteen discordant, which is the
    // first cell in this file that is evidence: 2 * P(X <= 3 of 15) = 0.035.
    const a = [
      ...Array.from({ length: 12 }, (_, i) => row(`a-only-${String(i)}`, 'same')),
      ...Array.from({ length: 3 }, (_, i) => row(`b-only-${String(i)}`, 'different')),
      ...Array.from({ length: 35 }, (_, i) => row(`agreed-${String(i)}`, 'different')),
    ];
    const b = [
      ...Array.from({ length: 12 }, (_, i) => row(`a-only-${String(i)}`, 'different')),
      ...Array.from({ length: 3 }, (_, i) => row(`b-only-${String(i)}`, 'same')),
      ...Array.from({ length: 35 }, (_, i) => row(`agreed-${String(i)}`, 'different')),
    ];

    const comparison = compareReadings(a, b);

    expect(comparison.aOnly).toBe(12);
    expect(comparison.bOnly).toBe(3);
    expect(comparison.mcnemarP).toBeCloseTo(0.0352, 4);
    expect(comparison.mcnemarP).toBeLessThan(0.05);
  });

  it('does not compare pairs one reading does not have', () => {
    // **A re-read is capped (`limit`) and a failed call answers nothing**, so the two reports can hold different pair
    // sets. Joining on the pair's own id and counting the rest as unpaired is what keeps a truncated second reading from
    // looking like a judge that changed its mind.
    const a = [row('a', 'same'), row('b', 'different'), row('c', 'different')];
    const b = [row('b', 'same'), row('d', 'same')];

    const comparison = compareReadings(a, b);

    expect(comparison.paired).toBe(1);
    expect(comparison.unpaired).toBe(3);
    expect(comparison.bOnly).toBe(1);
  });

  it('reads an unanswered pair as unanswered rather than as a rejection', () => {
    // **The same distinction the judge loop makes, one instrument further out.** A rate-limited call that returned
    // `null` is not a judge saying "different", and counting it as one would report the second judge as stricter than it
    // was - which is the direction that would make a floor look stable.
    const a = [row('a', 'same'), row('b', 'different')];
    const b = [row('a', 'same'), row('b', null)];

    const comparison = compareReadings(a, b);

    expect(comparison.paired).toBe(1);
    expect(comparison.unanswered).toBe(1);
  });
});

describe('a reading that did not answer is not a reading', () => {
  // **The second judge answered 34 of 263 pairs and the report still printed four rates and a recovery of 1.08 pairs.**
  // Every one of those numbers was computed over the 13 % that answered, with nothing in the table saying so - which is
  // the same failure the judge loop's own comment warns about, one instrument further out: a rate-limited re-read that
  // counted its refusals as rejections would report a stricter matcher, and a re-read that counts them as *answered*
  // reports a rate about a subsample nobody chose.
  it('withholds the verdict when a fifth of the pairs went unanswered', () => {
    expect(readingIsUsable({ pairs: 263, unanswered: 229 })).toBe(false);
    expect(readingIsUsable({ pairs: 263, unanswered: 53 })).toBe(false);
  });

  it('accepts a reading that lost a handful of calls, because that is what a rate limit is', () => {
    expect(readingIsUsable({ pairs: 263, unanswered: 5 })).toBe(true);
    expect(readingIsUsable({ pairs: 263, unanswered: 52 })).toBe(true);
  });

  it('refuses a reading with nothing in it rather than calling it unanimous', () => {
    expect(readingIsUsable({ pairs: 0, unanswered: 0 })).toBe(false);
  });
});
