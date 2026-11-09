// @code-analyzer/intelligence — what a run costs, recorded where the call is made
//
// **Why this file exists, in the account's own numbers.** On 2026-11-09 the balance on this project's provider key read
// `195.98` at 01:30, `155.14` at 02:15, `62.71` at 05:56 and `161.32` when the last benchmark job of the day finished at
// 10:03 - **four benchmark runs, one account, and not one figure anywhere in this repository that said how many tokens
// produced any of it.** The harness reads the balance before and after a job, so it can say what a *job* cost; **it
// cannot say what a lane, a scope, a retry or a judge cost, because nothing counted a call.** An account-level delta is
// a fact about the account. It is not an instrument.
//
// **So the ledger is written at the call site**, where the vendor's `usage` object is in hand, and **every completion
// goes through it or through nothing** - the provider records, the engine reads, the artifact publishes. The figures
// below are consequently **ours and attributable**: a per-call record carrying the model, the tokens the vendor said it
// billed, the cache split the vendor reported, the attempt index, and a price read from a table with a citation.
//
// **And the price table is data rather than a constant buried in arithmetic**, because **the last three times this
// project published a figure whose inputs it did not name, the figure outlived its inputs.**

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * One model's published prices, in the vendor's own currency, **at peak**, per million tokens.
 *
 * **Why peak is the stored figure and off-peak is derived.** The vendor states that off-peak rates are *half* of peak
 * rates, so one multiplication is the whole difference - and **storing both would let the two rows drift**, which is the
 * defect that made a withdrawn figure stand in two files at once.
 */
export interface LLMPriceRow {
  /** The model name as it is sent in the request body. */
  readonly model: string;
  /** USD per million tokens at peak, by token class. */
  readonly usdPerMillion: {
    /** Input tokens the vendor served from its prefix cache. */
    readonly cacheHit: number;
    /** Input tokens the vendor had to read fresh. */
    readonly cacheMiss: number;
    /** Tokens the model generated. */
    readonly output: number;
  };
  /** Where the numbers came from. A price without a citation is a guess with a decimal point. */
  readonly source: string;
  /** The day the source was read, ISO `YYYY-MM-DD`. */
  readonly checkedAt: string;
  /** What the row assumes, when it assumes anything. */
  readonly note?: string;
}

/** The day every price below was read, and the page they were read from. */
const PRICING_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing';
const PRICING_CHECKED = '2026-11-10';

/**
 * **The table, with the one assumption it makes written on the row that makes it.**
 *
 * The vendor's page currently lists `deepseek-flash` and `deepseek-v4-pro`, and says that legacy model names are still
 * accepted and **billed at the Flash price**. `deepseek-chat` - the name this product sends - is not listed, so its row
 * is the Flash row and `note` says so. **The alternative was refusing to price the product's own default**, which would
 * have made every figure below unavailable in exchange for a purity nobody could use.
 *
 * **The arithmetic that says the row is not wrong.** A 14-pull-request job on 2026-11-09 recorded 3 400 lane calls and
 * moved the balance by 62.82 CNY. At the prices below, a call of ~3 000 prompt and ~700 completion tokens costs
 * $0.00174 at peak, so 3 400 of them are ~$5.9 - about 42 CNY at 7.1 - and the remaining ~20 CNY is the judge and the
 * competitor arm, which the same job also ran. **A price table that reproduces an observed balance movement to within
 * a fifth is a price table that can be used, and the one thing it must never do is report zero for a model it does not
 * know.**
 */
export const LLM_PRICE_TABLE: readonly LLMPriceRow[] = [
  {
    model: 'deepseek-chat',
    usdPerMillion: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
    source: PRICING_SOURCE,
    checkedAt: PRICING_CHECKED,
    note: 'Not listed on the pricing page; sent as a legacy name and billed at the Flash price, which is the row below.',
  },
  {
    model: 'deepseek-flash',
    usdPerMillion: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
    source: PRICING_SOURCE,
    checkedAt: PRICING_CHECKED,
  },
  {
    model: 'deepseek-v4-pro',
    usdPerMillion: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    source: PRICING_SOURCE,
    checkedAt: PRICING_CHECKED,
  },
];

/** Off-peak is half of peak, which is the vendor's own statement rather than a discount this file invented. */
export const OFF_PEAK_FACTOR = 0.5;

/**
 * **Peak hours, in UTC, as the vendor defines them: 01:00-04:00 and 06:00-10:00, Monday to Friday.**
 *
 * **Why this is a function rather than a footnote.** Two thirds of this project's benchmark spend happens in jobs a
 * person starts, and **the same job run at 05:00 UTC costs half what it costs at 08:00 UTC** - so the schedule is a
 * cost lever with a magnitude that can be computed, and **a lever nobody can compute is a lever nobody pulls.**
 *
 * The vendor excludes Chinese public holidays from peak and **this function does not model them**: a holiday run is
 * priced as peak, which **overstates** the bill rather than understating it.
 */
export function isPeakHour(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/** The price row for a model, or `null` when this table does not know it. */
export function priceFor(model: string): LLMPriceRow | null {
  return LLM_PRICE_TABLE.find((row) => row.model === model) ?? null;
}

// ---------------------------------------------------------------------------
// Usage and cost
// ---------------------------------------------------------------------------

/**
 * What the vendor said it billed.
 *
 * **`cacheHitTokens` and `cacheMissTokens` are optional because not every OpenAI-compatible endpoint sends them**, and
 * **a usage object that guesses zero for a field it did not receive would understate the bill by the whole cache
 * discount.** A usage without the split is billed as if every prompt token missed, which is the upper bound.
 */
export interface LLMTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** Prompt tokens the vendor served from its prefix cache, when it reports them. */
  readonly cacheHitTokens?: number;
  /** Prompt tokens the vendor read fresh, when it reports them. */
  readonly cacheMissTokens?: number;
}

/**
 * **What one completion cost, or `null` when the table cannot price it.**
 *
 * **`null` rather than `0`.** A zero is a number a total will happily absorb, and **an unpriced model folded into a
 * total as zero is a bill reported as smaller than it is** - which is the failure this whole file exists to stop. The
 * ledger counts unpriced calls separately so that a figure can say *"1 700 of 3 400 calls are unpriced"* instead of
 * publishing a confident half.
 */
export function costUsdOf(usage: LLMTokenUsage, model: string, at: Date): number | null {
  const row = priceFor(model);
  if (!row) return null;

  const factor = isPeakHour(at) ? 1 : OFF_PEAK_FACTOR;
  const perMillion = row.usdPerMillion;

  // **The split, when the vendor sent one, is what is billed.** When it did not, every prompt token is charged at the
  // miss rate: the cache hit price is one fiftieth of the miss price, so guessing "hit" would be the more expensive
  // mistake to make in a report.
  const hit = usage.cacheHitTokens ?? 0;
  const miss = usage.cacheMissTokens ?? usage.promptTokens;

  return (
    ((hit * perMillion.cacheHit + miss * perMillion.cacheMiss) / 1_000_000) * factor +
    ((usage.completionTokens * perMillion.output) / 1_000_000) * factor
  );
}

/** What a group of calls came to. */
export interface CostTotals {
  /** Calls that returned a completion. */
  readonly calls: number;
  /** Calls that threw, and therefore billed nothing this ledger can see. */
  readonly failures: number;
  /** Attempts after the first, which are the ones a retry policy caused. */
  readonly retries: number;
  /** Calls this table could not price. **A total containing one of these is a lower bound.** */
  readonly unpricedCalls: number;
  readonly promptTokens: number;
  readonly cacheHitTokens: number;
  readonly cacheMissTokens: number;
  readonly completionTokens: number;
  /** USD. Sums only the priced calls. */
  readonly costUsd: number;
  /** The share of prompt tokens the vendor served from its cache, or `null` when no call reported a split. */
  readonly cacheHitRatio: number | null;
}

/** One completion, as it happened. */
export interface CostEntry {
  /** ISO timestamp of when the call returned. */
  readonly at: string;
  readonly model: string;
  /** What the call was for: a lane, a judge, a reranker. Free text, compared exactly. */
  readonly tag: string;
  readonly usage: LLMTokenUsage;
  /** USD, or `null` when the model is not in the table. */
  readonly costUsd: number | null;
  /** `0` for the first attempt, `1` for the first retry. */
  readonly attempt: number;
  /** Whether the attempt produced a completion. */
  readonly outcome: 'ok' | 'error';
  readonly durationMs: number;
  /** The error class or message, for an attempt that failed. */
  readonly error?: string;
}

const EMPTY_TOTALS: CostTotals = {
  calls: 0,
  failures: 0,
  retries: 0,
  unpricedCalls: 0,
  promptTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  cacheHitRatio: null,
};

function addInto(totals: CostTotals, entry: CostEntry): CostTotals {
  const ok = entry.outcome === 'ok';
  // **One read of the field, so the total and the unpriced count cannot disagree about it**: an assertion here would
  // compile and would be a second opinion about a value the branch above already established.
  const cost = entry.costUsd;
  const cacheHitTokens = totals.cacheHitTokens + (entry.usage.cacheHitTokens ?? 0);
  const cacheMissTokens = totals.cacheMissTokens + (entry.usage.cacheMissTokens ?? 0);
  const reportedSplit =
    totals.cacheHitRatio !== null || (ok && entry.usage.cacheHitTokens !== undefined);
  const denominator = cacheHitTokens + cacheMissTokens;

  return {
    calls: totals.calls + (ok ? 1 : 0),
    failures: totals.failures + (ok ? 0 : 1),
    retries: totals.retries + (entry.attempt > 0 ? 1 : 0),
    unpricedCalls: totals.unpricedCalls + (ok && cost === null ? 1 : 0),
    promptTokens: totals.promptTokens + (ok ? entry.usage.promptTokens : 0),
    cacheHitTokens,
    cacheMissTokens,
    completionTokens: totals.completionTokens + (ok ? entry.usage.completionTokens : 0),
    costUsd: totals.costUsd + (cost ?? 0),
    cacheHitRatio:
      reportedSplit && denominator > 0 ? cacheHitTokens / denominator : totals.cacheHitRatio,
  };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * **Every completion this process made, and what each one cost.**
 *
 * **A ledger rather than a counter, because the question is never "how much" but "which part".** The account delta can
 * answer the first. It cannot answer *"is the file scope or the pull-request scope the expensive one"*, *"is the judge
 * or the reviewer the expensive one"*, or *"did the retries cost more than the cache saved"* - and those are the
 * questions a bill of this size is worth asking.
 *
 * **`byTag` is keyed on the caller's own word for the work**, which is why `tag` is a string and not an enum: the lanes,
 * the judge, the competitor arm and the reranker are different kinds of thing, and **a ledger whose categories were
 * fixed here would not have a row for the next thing.**
 */
export class CostLedger {
  private readonly records: CostEntry[] = [];

  /** Record one attempt. Called by the provider on every path, including the ones that threw. */
  record(entry: CostEntry): void {
    this.records.push(entry);
  }

  /** What has been spent so far, in USD, over the priced calls. */
  get spentUsd(): number {
    return this.records.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
  }

  /** How many calls have been recorded, priced or not. */
  get size(): number {
    return this.records.length;
  }

  /** Everything, in the order it happened. */
  get entries(): readonly CostEntry[] {
    return this.records;
  }

  /** The whole run's figures. */
  totals(): CostTotals {
    return this.records.reduce(addInto, EMPTY_TOTALS);
  }

  /** The figures per tag, worst first, so the expensive part is the first line of the report. */
  byTag(): Array<{ tag: string; totals: CostTotals }> {
    const groups = new Map<string, CostTotals>();
    for (const entry of this.records) {
      groups.set(entry.tag, addInto(groups.get(entry.tag) ?? EMPTY_TOTALS, entry));
    }
    return [...groups.entries()]
      .map(([tag, totals]) => ({ tag, totals }))
      .sort((a, b) => b.totals.costUsd - a.totals.costUsd || a.tag.localeCompare(b.tag));
  }

  /** The ledger as an artifact: the entries are kept, not just the sums, because a sum is not auditable. */
  toJSON(): {
    totals: CostTotals;
    byTag: Array<{ tag: string; totals: CostTotals }>;
    entries: readonly CostEntry[];
  } {
    return { totals: this.totals(), byTag: this.byTag(), entries: this.records };
  }

  /** Forget everything. For a caller that wants one artifact per unit of work rather than per process. */
  reset(): void {
    this.records.length = 0;
  }
}

// ---------------------------------------------------------------------------
// The ceiling
// ---------------------------------------------------------------------------

/** Thrown instead of making a call that would take a run past what its caller said it may spend. */
export class LLMBudgetError extends Error {
  constructor(
    /** USD. */
    public readonly ceilingUsd: number,
    /** USD already spent when the call was refused. */
    public readonly spentUsd: number,
    /** What the refused call was for. */
    public readonly tag: string,
  ) {
    super(
      `LLM spend ceiling reached: ${spentUsd.toFixed(4)} USD spent against a ceiling of ${ceilingUsd.toFixed(4)} USD. ` +
        `The "${tag}" call was refused before it was sent.`,
    );
    this.name = 'LLMBudgetError';
  }
}

/**
 * **A ceiling that stops the next call, and says so about the current one.**
 *
 * **The cost of a call is known only after it returns** - the vendor bills tokens it generated, which nobody can know
 * in advance - so a ceiling that claimed to predict would be a sentence rather than a bound, and this project has
 * already paid for one of those: *a bound that cannot fire is not a bound; it is a sentence in a report.*
 *
 * **What is guaranteed is therefore exact and narrow**: no call is *sent* once the recorded spend has reached the
 * ceiling, so a run cannot exceed it by more than the cost of the calls already in flight. That is a property a test
 * can hold, and `CostBudget.test`'s suite holds it by counting requests at a real server.
 */
export class CostBudget {
  constructor(
    /** USD. */
    public readonly ceilingUsd: number,
    private readonly ledger: CostLedger,
  ) {}

  /**
   * Throw if the next call must not be made.
   *
   * **`tag` is in the error** because *"the run stopped"* and *"the run stopped during the fourth lane of the ninth
   * file"* are different amounts of information about a job that spent its budget.
   */
  assertAffordable(tag: string): void {
    if (this.ledger.spentUsd >= this.ceilingUsd) {
      throw new LLMBudgetError(this.ceilingUsd, this.ledger.spentUsd, tag);
    }
  }
}
