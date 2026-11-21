// @code-analyzer/code-analyzer — the bill a cost clause may be read on, and the one it must not be
//
// **What this file guards.** On 2026-11-21 one dispatch ran two arms that differed by one lane out of five, and **the
// arm with the extra lane was the cheaper one in dollars**: 1.2391 against 1.3692. The mechanism was measured rather
// than argued - the five-lane arm ran second and hit the vendor's prefix cache on 82.9 % of its prompt tokens, the
// four-lane arm on 51.0 %, and at the vendor's prices a cached token is one fiftieth of a fresh one. **A clause written
// in `totalUsd` was therefore being read on a measurement of job order.**
//
// **So the properties below are about the second figure.** Three of them are arithmetic identities against the
// repository's own pricer, not observed values, so a price change moves them only if the change breaks the identity:
// nothing cached means the two figures are equal, the same tokens in two cache states produce one cold-cache figure,
// and the recovered multiplier is the vendor's stated `1` and `0.5`. The rest are about the answers this module must
// refuse to give - a missing spend block, an unpriced bill, a split the vendor never sent.

import { describe, expect, it } from 'vitest';

import {
  coldUsdOf,
  compareSpend,
  factorOf,
  labelOf,
  listUsdOf,
  readArm,
} from '../../../scripts/lib/spend-pair.mjs';

import { costUsdOf, OFF_PEAK_FACTOR } from '../../../packages/intelligence/src/review/llm/cost.js';

import type { SpendArtifact, SpendGroup, SpendPrices } from '../../../scripts/lib/spend-pair.mjs';

/** The table's own row for the model this product sends, read rather than copied so the test cannot outlive it. */
const PRICES: SpendPrices = { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 };

/** 02:00 UTC on a Tuesday: inside the vendor's peak window. */
const PEAK = new Date('2026-11-10T02:00:00Z');
/** 05:00 UTC on the same Tuesday: outside it. */
const OFF_PEAK = new Date('2026-11-10T05:00:00Z');

function group(usage: {
  prompt: number;
  completion?: number;
  hit?: number;
  at?: Date;
  model?: string;
}) {
  const completion = usage.completion ?? 0;
  const hit = usage.hit ?? 0;
  const at = usage.at ?? PEAK;
  const tokens = {
    promptTokens: usage.prompt,
    completionTokens: completion,
    totalTokens: usage.prompt + completion,
    cacheHitTokens: hit,
    cacheMissTokens: usage.prompt - hit,
  };
  // **The bill comes from the pricer**, so every assertion below is about this module and not about a number typed into
  // a fixture that would have gone stale the day a price moved.
  return {
    ...tokens,
    calls: 1,
    costUsd: costUsdOf(tokens, usage.model ?? 'deepseek-chat', at),
  };
}

function artifact(
  engine: SpendGroup,
  judge: SpendGroup | null,
  laneSet: SpendArtifact['configuration'] extends infer C
    ? C extends { readonly laneSet?: infer L }
      ? L
      : never
    : never = 'shipped',
) {
  return {
    configuration: { laneSet },
    spend: { ...engine, judge },
  };
}

describe('the multiplier an arm was billed at', () => {
  it('recovers the vendor half at an off-peak hour and one at peak, from the bill alone', () => {
    const peak = group({ prompt: 1_000_000, completion: 100_000, at: PEAK });
    const offPeak = group({ prompt: 1_000_000, completion: 100_000, at: OFF_PEAK });

    expect(factorOf(peak, PRICES)).toBeCloseTo(1, 10);
    expect(factorOf(offPeak, PRICES)).toBeCloseTo(OFF_PEAK_FACTOR, 10);
    // A hundred thousand completion tokens at 1.2 is the same at either hour only after the factor, which is the point.
    expect(peak.costUsd).toBeCloseTo(0.42, 10);
    expect(offPeak.costUsd).toBeCloseTo(0.21, 10);
  });

  it('reads the multiplier a partly cached bill implies, so a warm arm is still priced at its own hour', () => {
    const warm = group({ prompt: 1_000_000, completion: 0, hit: 900_000, at: OFF_PEAK });

    // 900 000 at the hit price plus 100 000 at the miss price, halved by the hour.
    expect(warm.costUsd).toBeCloseTo((0.5 * (900_000 * 0.006 + 100_000 * 0.3)) / 1_000_000, 10);
    expect(factorOf(warm, PRICES)).toBeCloseTo(OFF_PEAK_FACTOR, 10);
  });

  it('answers null for a bill it cannot price rather than charging it at the peak rate', () => {
    const unpriced = { ...group({ prompt: 1_000_000 }), costUsd: null };
    expect(factorOf(unpriced, PRICES)).toBeNull();

    // An unknown model has no bill at all, which is the same answer for the same reason: no number is better than a
    // confident one, because a confident wrong factor is a factor of two.
    const unknown = group({ prompt: 1_000_000, model: 'unknown-model' });
    expect(unknown.costUsd).toBeNull();
    expect(factorOf(unknown, PRICES)).toBeNull();
  });

  it('answers null for a group with no tokens, because zero divided by zero is not a rate', () => {
    expect(factorOf({ calls: 0, costUsd: 0 }, PRICES)).toBeNull();
  });
});

describe('the bill with the cache priced out', () => {
  it('equals the billed figure when nothing was cached', () => {
    const cold = group({ prompt: 2_000_000, completion: 500_000, hit: 0, at: OFF_PEAK });
    expect(coldUsdOf(cold, PRICES)).toBeCloseTo(cold.costUsd as number, 10);
  });

  it('is one number for the same tokens in two cache states, which is what makes a cost clause readable', () => {
    const cold = group({ prompt: 1_000_000, completion: 100_000, hit: 0 });
    const warm = group({ prompt: 1_000_000, completion: 100_000, hit: 1_000_000 });

    // The billed figures are a factor of three apart for identical work...
    expect(cold.costUsd).toBeCloseTo(0.42, 10);
    expect(warm.costUsd).toBeCloseTo(0.126, 10);
    // ...and the cold-cache figures are the same number, because the work was the same number.
    expect(coldUsdOf(cold, PRICES)).toBeCloseTo(0.42, 10);
    expect(coldUsdOf(warm, PRICES)).toBeCloseTo(0.42, 10);
  });

  it('prices a prompt split that does not add up to the reported prompt total at the larger of the two', () => {
    // A vendor that reports a prompt total with no split leaves `cacheMissTokens` absent; the plain total is then the
    // only statement about the prompt, and understating it is the direction that flatters a cost claim.
    const unreported = { calls: 1, promptTokens: 1_000_000, completionTokens: 0, costUsd: 0.3 };
    expect(coldUsdOf(unreported, PRICES)).toBeCloseTo(0.3, 10);
  });

  it('is null when the arm cannot be priced, so no total silently absorbs a zero', () => {
    expect(coldUsdOf({ calls: 1, promptTokens: 1_000_000, costUsd: null }, PRICES)).toBeNull();
  });
});

describe('one arm, read from its artifact', () => {
  it('adds the reviewer and the judge into a total, and keeps each half’s own figures', () => {
    const arm = readArm(
      artifact(
        group({ prompt: 1_000_000, completion: 100_000 }),
        group({ prompt: 500_000, completion: 20_000 }),
      ),
      PRICES,
    );

    expect(arm.engine.usd).toBeCloseTo(0.42, 10);
    expect(arm.judge?.usd).toBeCloseTo(0.174, 10);
    expect(arm.total.usd).toBeCloseTo(0.594, 10);
    // The cold-cache figure adds the same way, which is the only reason the two halves can be discussed separately.
    expect(arm.total.coldUsd).toBeCloseTo(0.594, 10);
    expect(arm.total.calls).toBe(2);
  });

  it('reports an arm with no judge as a reviewer alone rather than as a cheap arm', () => {
    const arm = readArm(artifact(group({ prompt: 1_000_000, completion: 0 }), null), PRICES);
    expect(arm.judge).toBeNull();
    expect(arm.total.usd).toBeCloseTo(arm.engine.usd as number, 10);
    expect(arm.total.coldUsd).toBeCloseTo(arm.engine.coldUsd as number, 10);
  });

  it('prefers a published cold-cache figure over a derived one', () => {
    const engine = group({ prompt: 1_000_000, completion: 0 });
    const written = artifact({ ...engine, cacheNeutralUsd: 9.99 }, null);
    const arm = readArm(written, PRICES);

    // The artifact's own figure is the one the run measured; a tool that recomputed it would be a second opinion about
    // a number the run already published, and the two would drift the first time a price row moved.
    expect(arm.engine.coldUsd).toBeCloseTo(9.99, 10);
  });

  it('refuses an artifact with no spend block, because a balance delta prices a run and not an arm', () => {
    expect(() => readArm({ configuration: { laneSet: 'shipped' } }, PRICES)).toThrow(
      /no spend block/,
    );
  });

  it('names the arm by its lane set, because the profile is the same name for both arms', () => {
    const both = {
      configuration: {
        laneSet: { name: 'lean', lanes: ['security'] },
        emissionProfile: 'advisory',
      },
    };
    expect(labelOf(both)).toBe('lean');
    expect(labelOf({ configuration: { laneSet: ['security', 'testing'] } })).toBe(
      'security+testing',
    );
    expect(labelOf({ configuration: { emissionProfile: 'advisory' } })).toBe('advisory');
    expect(labelOf(null)).toBe('arm');
  });
});

describe('two arms side by side', () => {
  /**
   * **The case the clause was written on.** Two arms, the same tokens, one warmed by the other: the billed ratio says
   * the cheaper arm is the larger one, and the cold-cache ratio says the opposite. A comparison that reported one of
   * them without the other would be an answer to a question nobody asked.
   */
  it('says so when the billed figure and the cold-cache figure disagree about whether there is a difference', () => {
    const coldArm = group({ prompt: 5_000_000, completion: 500_000, hit: 0 });
    const warmArm = group({ prompt: 5_000_000, completion: 500_000, hit: 4_500_000 });

    const comparison = compareSpend(
      readArm(artifact(coldArm, null, 'lean'), PRICES),
      readArm(artifact(warmArm, null, 'shipped'), PRICES),
      PRICES,
    );

    const total = comparison.rows.find((row) => row.part === 'total');
    // The bill says the second arm is 63 % cheaper...
    expect(total?.usdRatio).toBeCloseTo(0.37, 10);
    // ...and the cold-cache figure says the two arms are the same arm, which is what they are.
    expect(total?.coldUsdRatio).toBeCloseTo(1, 12);
    expect(comparison.unitsAgree).toBe(false);
    // The two bills differ and the two cold-cache figures are one number, which is the whole of the argument.
    expect(listUsdOf(warmArm, PRICES)).toBeLessThan(listUsdOf(coldArm, PRICES));
    expect(coldUsdOf(warmArm, PRICES)).toBeCloseTo(coldUsdOf(coldArm, PRICES) as number, 10);
  });

  it('says so when the units point opposite ways, which is the shape the clause was read on', () => {
    // One fewer lane out of five, and no cache anywhere: the arm that does less work is billed more, because the other
    // arm was warmed by it. These are the direction of the real pair rather than its amounts.
    const shipped = group({ prompt: 12_000_000, completion: 1_500_000, hit: 10_000_000 });
    const lean = group({ prompt: 9_600_000, completion: 1_050_000, hit: 0 });

    const comparison = compareSpend(
      readArm(artifact(shipped, null, 'shipped'), PRICES),
      readArm(artifact(lean, null, 'lean'), PRICES),
      PRICES,
    );

    const total = comparison.rows.find((row) => row.part === 'total');
    expect(total?.usdRatio).toBeGreaterThan(1);
    expect(total?.coldUsdRatio).toBeLessThan(1);
    expect(comparison.unitsAgree).toBe(false);
  });

  it('agrees when the work really was smaller, which is the case a cost clause exists for', () => {
    const big = group({ prompt: 5_000_000, completion: 500_000, hit: 0 });
    const small = group({ prompt: 4_000_000, completion: 400_000, hit: 0 });

    const comparison = compareSpend(
      readArm(artifact(big, null, 'shipped'), PRICES),
      readArm(artifact(small, null, 'lean'), PRICES),
      PRICES,
    );

    expect(comparison.unitsAgree).toBe(true);
    expect(comparison.rows.find((row) => row.part === 'total')?.coldUsdRatio).toBeCloseTo(0.8, 10);
    expect(comparison.rows.find((row) => row.part === 'total')?.promptTokenRatio).toBeCloseTo(
      0.8,
      10,
    );
  });

  it('reports a unit it cannot compute as null instead of as agreement', () => {
    const priced = group({ prompt: 1_000_000, completion: 0 });
    const unpriced = { ...group({ prompt: 1_000_000, completion: 0 }), costUsd: null };

    const comparison = compareSpend(
      readArm(artifact(priced, null), PRICES),
      readArm(artifact(unpriced, null), PRICES),
      PRICES,
    );

    const total = comparison.rows.find((row) => row.part === 'total');
    expect(total?.usdRatio).toBeNull();
    expect(total?.coldUsdRatio).toBeNull();
    // A missing unit is not a disagreement, and saying "the units agree" here would be a claim about nothing.
    expect(comparison.unitsAgree).toBeNull();
    // The token ratio is still there, because tokens are counted and not priced.
    expect(total?.promptTokenRatio).toBeCloseTo(1, 10);
  });

  it('leaves the judge row out when one arm ran no judge, rather than comparing it to zero', () => {
    const withJudge = artifact(group({ prompt: 1_000_000 }), group({ prompt: 100_000 }));
    const without = artifact(group({ prompt: 1_000_000 }), null);

    const comparison = compareSpend(readArm(without, PRICES), readArm(withJudge, PRICES), PRICES);

    expect(comparison.rows.map((row) => row.part)).toEqual(['engine', 'total']);
  });

  it('reports the hit ratio as null when the vendor never sent a split', () => {
    const arm = readArm(
      artifact({ calls: 1, promptTokens: 1_000_000, completionTokens: 0, costUsd: 0.3 }, null),
      PRICES,
    );
    // A zero ratio is a statement that nothing was cached; an artifact that never received the field has not made it.
    expect(arm.engine.hitRatio).toBeNull();
  });
});
