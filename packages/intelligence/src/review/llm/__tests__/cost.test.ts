// What a call costs, priced by hand against the vendor's own numbers.
//
// **No mocks and no fixtures of convenience**: every expectation below is an arithmetic identity that can be checked on
// paper - one million cache-hit tokens cost the hit price and nothing else, off-peak is exactly half, a usage without a
// cache split bills every prompt token at the miss rate. **A test that asserted "a number greater than zero" would pass
// for a price table that was wrong by a factor of fifty**, which is the size of the discount this file exists to expose.

import { describe, expect, it } from 'vitest';

import {
  CostBudget,
  CostLedger,
  LLMBudgetError,
  LLM_PRICE_TABLE,
  OFF_PEAK_FACTOR,
  costUsdOf,
  cacheNeutralUsdOf,
  isPeakHour,
  priceFor,
} from '../cost.js';

import type { CostEntry } from '../cost.js';

/** A moment inside the vendor's stated peak window: 02:00 UTC on a Tuesday. */
const PEAK = new Date('2026-11-10T02:00:00Z');
/** A moment outside it: 05:00 UTC on the same Tuesday. */
const OFF_PEAK = new Date('2026-11-10T05:00:00Z');

function entry(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    at: PEAK.toISOString(),
    model: 'deepseek-chat',
    tag: 'review:security',
    usage: { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
    costUsd: 0.3,
    attempt: 0,
    outcome: 'ok',
    durationMs: 12,
    ...overrides,
  };
}

describe('the peak window is the vendor’s, in UTC, on weekdays', () => {
  it('treats the two stated windows as peak and nothing else as peak', () => {
    const at = (iso: string): boolean => isPeakHour(new Date(iso));

    expect(at('2026-11-10T01:00:00Z')).toBe(true);
    expect(at('2026-11-10T03:59:00Z')).toBe(true);
    expect(at('2026-11-10T04:00:00Z')).toBe(false);
    expect(at('2026-11-10T06:00:00Z')).toBe(true);
    expect(at('2026-11-10T09:59:00Z')).toBe(true);
    expect(at('2026-11-10T10:00:00Z')).toBe(false);
    expect(at('2026-11-10T00:59:00Z')).toBe(false);
    expect(at('2026-11-10T05:00:00Z')).toBe(false);
  });

  it('treats a weekend hour inside the window as off-peak', () => {
    // 2026-11-07 is a Saturday, 2026-11-08 a Sunday.
    expect(isPeakHour(new Date('2026-11-07T02:00:00Z'))).toBe(false);
    expect(isPeakHour(new Date('2026-11-08T02:00:00Z'))).toBe(false);
  });

  it('has a table whose every row carries where it came from and when it was read', () => {
    for (const row of LLM_PRICE_TABLE) {
      expect(row.source).toMatch(/^https:\/\//);
      expect(row.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A row that prices nothing would make every call to that model free, silently.
      expect(row.usdPerMillion.cacheMiss).toBeGreaterThan(0);
      expect(row.usdPerMillion.output).toBeGreaterThan(0);
    }
  });
});

describe('the cost of one call, by hand', () => {
  it('charges a million cache-hit tokens the hit price and nothing else', () => {
    const cost = costUsdOf(
      {
        promptTokens: 1_000_000,
        completionTokens: 0,
        totalTokens: 1_000_000,
        cacheHitTokens: 1_000_000,
        cacheMissTokens: 0,
      },
      'deepseek-chat',
      PEAK,
    );
    expect(cost).toBeCloseTo(0.006, 10);
  });

  it('charges a million cache-miss tokens the miss price', () => {
    const cost = costUsdOf(
      {
        promptTokens: 1_000_000,
        completionTokens: 0,
        totalTokens: 1_000_000,
        cacheHitTokens: 0,
        cacheMissTokens: 1_000_000,
      },
      'deepseek-chat',
      PEAK,
    );
    expect(cost).toBeCloseTo(0.3, 10);
  });

  it('charges a million completion tokens the output price', () => {
    const cost = costUsdOf(
      { promptTokens: 0, completionTokens: 1_000_000, totalTokens: 1_000_000 },
      'deepseek-chat',
      PEAK,
    );
    expect(cost).toBeCloseTo(1.2, 10);
  });

  it('bills an unreported split as if every prompt token missed', () => {
    // The vendor's cache-hit price is one fiftieth of the miss price, so guessing "hit" would understate a bill by
    // almost all of it. This is the upper bound, and it is the one the ledger reports.
    const cost = costUsdOf(
      { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
      'deepseek-chat',
      PEAK,
    );
    expect(cost).toBeCloseTo(0.3, 10);
  });

  it('halves every class off-peak', () => {
    const usage = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
      cacheHitTokens: 0,
      cacheMissTokens: 1_000_000,
    };
    const peak = costUsdOf(usage, 'deepseek-chat', PEAK);
    const offPeak = costUsdOf(usage, 'deepseek-chat', OFF_PEAK);

    expect(peak).toBeCloseTo(0.3 + 1.2, 10);
    expect(offPeak).toBeCloseTo((0.3 + 1.2) * OFF_PEAK_FACTOR, 10);
  });

  it('prices the larger model by its own row rather than by the first row', () => {
    const usage = { promptTokens: 0, completionTokens: 1_000_000, totalTokens: 1_000_000 };
    expect(costUsdOf(usage, 'deepseek-v4-pro', PEAK)).toBeCloseTo(3.96, 10);
    expect(costUsdOf(usage, 'deepseek-chat', PEAK)).toBeCloseTo(1.2, 10);
  });

  it('answers null for a model the table does not know, rather than zero', () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 };
    expect(costUsdOf(usage, 'some-model-nobody-priced', PEAK)).toBeNull();
    expect(priceFor('some-model-nobody-priced')).toBeNull();
    expect(priceFor('deepseek-chat')?.usdPerMillion.cacheMiss).toBe(0.3);
  });
});

describe('the ledger, over the calls a run made', () => {
  it('sums what the calls cost and counts what they did', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 0.3 }));
    ledger.record(
      entry({
        tag: 'review:performance',
        usage: {
          promptTokens: 500,
          completionTokens: 200,
          totalTokens: 700,
          cacheHitTokens: 400,
          cacheMissTokens: 100,
        },
        costUsd: 0.01,
      }),
    );

    const totals = ledger.totals();
    expect(totals.calls).toBe(2);
    expect(totals.costUsd).toBeCloseTo(0.31, 10);
    expect(totals.promptTokens).toBe(1_000_500);
    expect(totals.completionTokens).toBe(200);
    expect(totals.cacheHitTokens).toBe(400);
    expect(totals.cacheMissTokens).toBe(100);
    // 400 of 500 reported prompt tokens came from the cache.
    expect(totals.cacheHitRatio).toBeCloseTo(400 / 500, 10);
    expect(ledger.spentUsd).toBeCloseTo(0.31, 10);
    expect(ledger.size).toBe(2);
  });

  it('counts a failed attempt as a failure, not as a call, and counts the retry it caused', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ attempt: 0, outcome: 'error', costUsd: null, error: 'status 500' }));
    ledger.record(entry({ attempt: 1, outcome: 'ok', costUsd: 0.3 }));

    const totals = ledger.totals();
    expect(totals.calls).toBe(1);
    expect(totals.failures).toBe(1);
    expect(totals.retries).toBe(1);
    // A failure adds no tokens: nothing was billed for it, and inventing a count would inflate every average.
    expect(totals.promptTokens).toBe(1_000_000);
  });

  it('separates the calls it could not price from the ones it could', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 0.3 }));
    ledger.record(entry({ model: 'unknown-model', costUsd: null }));

    const totals = ledger.totals();
    expect(totals.calls).toBe(2);
    expect(totals.unpricedCalls).toBe(1);
    // A total containing an unpriced call is a lower bound, and it still has to be a number.
    expect(totals.costUsd).toBeCloseTo(0.3, 10);
  });

  it('counts an unpriced call as nothing spent, which is why the count is published beside the total', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: null }));
    expect(ledger.spentUsd).toBe(0);
    expect(ledger.totals().unpricedCalls).toBe(1);

    ledger.record(entry({ costUsd: 0.25 }));
    expect(ledger.spentUsd).toBeCloseTo(0.25, 12);
  });

  it('leaves the cache ratio unknown when no call reported a split', () => {
    const ledger = new CostLedger();
    ledger.record(entry());
    expect(ledger.totals().cacheHitRatio).toBeNull();
  });

  it('reports a zero ratio when the vendor reported a split with no hits', () => {
    const ledger = new CostLedger();
    ledger.record(
      entry({
        usage: {
          promptTokens: 100,
          completionTokens: 10,
          totalTokens: 110,
          cacheHitTokens: 0,
          cacheMissTokens: 100,
        },
      }),
    );
    expect(ledger.totals().cacheHitRatio).toBe(0);
  });

  it('groups by tag, most expensive first, and breaks a tie by name', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ tag: 'judge', costUsd: 0.5 }));
    ledger.record(entry({ tag: 'review:security', costUsd: 0.1 }));
    ledger.record(entry({ tag: 'review:security', costUsd: 0.1 }));
    ledger.record(entry({ tag: 'a-tie', costUsd: 0.2 }));

    const grouped = ledger.byTag();
    expect(grouped.map((group) => group.tag)).toEqual(['judge', 'a-tie', 'review:security']);
    expect(grouped[2]?.totals.calls).toBe(2);
    expect(grouped[2]?.totals.costUsd).toBeCloseTo(0.2, 10);
  });

  it('keeps the entries in its artifact, because a sum is not auditable', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ tag: 'judge' }));

    const artifact = ledger.toJSON();
    expect(artifact.entries).toHaveLength(1);
    expect(artifact.entries[0]?.tag).toBe('judge');
    expect(artifact.totals.calls).toBe(1);
    expect(artifact.byTag[0]?.tag).toBe('judge');
    expect(ledger.entries).toHaveLength(1);
  });

  it('forgets everything on request, so one artifact can describe one unit of work', () => {
    const ledger = new CostLedger();
    ledger.record(entry());
    ledger.reset();

    expect(ledger.size).toBe(0);
    expect(ledger.spentUsd).toBe(0);
    expect(ledger.totals().calls).toBe(0);
    expect(ledger.byTag()).toEqual([]);
  });
});

describe('the ceiling refuses the next call and names it', () => {
  it('allows a call while the spend is below the ceiling', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 0.4 }));
    const budget = new CostBudget(1, ledger);

    expect(() => {
      budget.assertAffordable('review:security');
    }).not.toThrow();
  });

  it('refuses a call once the spend has reached the ceiling', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 1 }));
    const budget = new CostBudget(1, ledger);

    expect(() => {
      budget.assertAffordable('review:architecture');
    }).toThrow(LLMBudgetError);
  });

  it('carries the ceiling, the spend and the refused tag on the error', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 2.5 }));
    const budget = new CostBudget(2, ledger);

    try {
      budget.assertAffordable('review:testing');
      expect.unreachable('the call should have been refused');
    } catch (error) {
      const refused = error as LLMBudgetError;
      expect(refused).toBeInstanceOf(LLMBudgetError);
      expect(refused.ceilingUsd).toBe(2);
      expect(refused.spentUsd).toBeCloseTo(2.5, 10);
      expect(refused.tag).toBe('review:testing');
      // The sentence names the two numbers and the call, so a log can be read without the stack.
      expect(refused.message).toContain('2.5000');
      expect(refused.message).toContain('2.0000');
      expect(refused.message).toContain('review:testing');
    }
  });
});

// ---------------------------------------------------------------------------
// The price a call would have carried on a cold cache
// ---------------------------------------------------------------------------

describe('the price with the cache priced out', () => {
  /**
   * **The figure exists because the vendor's cache outlives the process.** Two jobs that do identical work are billed
   * differently when one of them runs second, and on 2026-11-21 that difference inverted a cost comparison: the arm
   * with one *fewer* lane cost 1.3692 USD against the arm with five lanes' 1.2391, because the five-lane arm hit the
   * prefix cache on 82.9 % of its prompt tokens and the four-lane one on 51.0 %. The assertions below are the property
   * that makes the second figure usable - **same work, two cache states, one comparable number** - and they are
   * arithmetic identities rather than observed values, so a price change moves them only if the price change is wrong.
   */
  it('charges a fully cached prompt at the miss price, which is what the cache hides', () => {
    const warm = entry({
      usage: {
        promptTokens: 1_000_000,
        completionTokens: 0,
        totalTokens: 1_000_000,
        cacheHitTokens: 1_000_000,
        cacheMissTokens: 0,
      },
      costUsd: 0.006,
    });

    // What the account paid: one million tokens at the hit price.
    expect(costUsdOf(warm.usage, warm.model, new Date(warm.at))).toBeCloseTo(0.006, 10);
    // What the same call would have cost with nothing warm: one million at the miss price, fifty times as much.
    expect(cacheNeutralUsdOf(warm)).toBeCloseTo(0.3, 10);
  });

  it('reports one number for the same tokens in either cache state', () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 100_000, totalTokens: 1_100_000 };
    const cold = entry({ usage: { ...usage, cacheHitTokens: 0, cacheMissTokens: 1_000_000 } });
    const warm = entry({ usage: { ...usage, cacheHitTokens: 1_000_000, cacheMissTokens: 0 } });
    // Priced by the same function the provider prices a live call with, at the entry's own clock, so the two ledgers
    // below hold what the vendor would actually have billed rather than two numbers written here to make the point.
    const coldBilled = costUsdOf(cold.usage, cold.model, new Date(cold.at));
    const warmBilled = costUsdOf(warm.usage, warm.model, new Date(warm.at));

    const oneLedger = new CostLedger();
    oneLedger.record({ ...cold, costUsd: coldBilled });
    const otherLedger = new CostLedger();
    otherLedger.record({ ...warm, costUsd: warmBilled });

    // The billed figures differ by the whole cache discount...
    expect(coldBilled).toBeCloseTo(0.42, 10);
    expect(warmBilled).toBeCloseTo(0.126, 10);
    expect(oneLedger.totals().costUsd).toBeCloseTo(0.42, 10);
    expect(otherLedger.totals().costUsd).toBeCloseTo(0.126, 10);
    // ...and the cold-cache figures are the same number, because the work was the same number.
    expect(oneLedger.totals().cacheNeutralUsd).toBeCloseTo(0.42, 10);
    expect(otherLedger.totals().cacheNeutralUsd).toBeCloseTo(0.42, 10);
  });

  it('prices each call at its own clock, so a run across the peak boundary is not priced twice at one rate', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ at: PEAK.toISOString() }));
    ledger.record(entry({ at: OFF_PEAK.toISOString() }));

    // One million at 0.3 twice, the second at the off-peak factor.
    expect(ledger.totals().cacheNeutralUsd).toBeCloseTo(0.3 + 0.3 * OFF_PEAK_FACTOR, 10);
    // And the factor is still the vendor's stated half rather than a number that drifted into the new field.
    expect(OFF_PEAK_FACTOR).toBe(0.5);
  });

  it('adds nothing for a failed attempt, the same rule the billed total follows', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ outcome: 'error', costUsd: null, error: 'status 500' }));

    expect(ledger.totals().cacheNeutralUsd).toBe(0);
    expect(ledger.totals().costUsd).toBe(0);
  });

  it('leaves an unpriced model out of the figure rather than charging it at zero as if it were free work', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ model: 'unknown-model', costUsd: null }));

    // The count is the only thing that can say the figure is a lower bound, which is why it travels beside both totals.
    expect(ledger.totals().unpricedCalls).toBe(1);
    expect(ledger.totals().cacheNeutralUsd).toBe(0);
  });

  it('is published per tag, because the arm that pays the cache is not always the arm that does the work', () => {
    const ledger = new CostLedger();
    ledger.record(
      entry({
        tag: 'review:testing',
        usage: {
          promptTokens: 1_000_000,
          completionTokens: 0,
          totalTokens: 1_000_000,
          cacheHitTokens: 1_000_000,
          cacheMissTokens: 0,
        },
        costUsd: 0.006,
      }),
    );

    const [row] = ledger.byTag();
    expect(row?.tag).toBe('review:testing');
    // Sorted by the billed figure, which is what the account pays; the cold-cache figure travels beside it.
    expect(row?.totals.costUsd).toBeCloseTo(0.006, 10);
    expect(row?.totals.cacheNeutralUsd).toBeCloseTo(0.3, 10);
  });

  it('is in the artifact the ledger writes, not only in the object it returns', () => {
    const ledger = new CostLedger();
    ledger.record(entry());

    const written = ledger.toJSON();
    expect(written.totals.cacheNeutralUsd).toBeCloseTo(0.3, 10);
    // The entries are kept, because a sum is not auditable and this field's whole justification is a subtraction.
    expect(written.entries).toHaveLength(1);
  });
});
