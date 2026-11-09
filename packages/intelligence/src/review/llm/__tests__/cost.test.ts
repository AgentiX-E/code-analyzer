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
