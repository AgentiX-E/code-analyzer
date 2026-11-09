// The review engine's bill: five lanes, one review, one figure that can be traced to the lanes.
//
// **The defect this holds shut.** `LLMReviewResult.tokenUsage` was declared, documented and never written: the provider
// returned a usage object for every completion and `executeLane` kept only `content`. **A five-lane review of a
// hundred-file pull request therefore made five hundred billable calls and reported none of them**, and the cost of a
// review could only be discovered afterwards, by subtracting two balance readings taken hours apart.
//
// **The provider here is a hand-written stand-in, not a mock of the unit under test.** The engine's contract is a
// `LLMProvider`, and what is asserted is that the engine reads what the interface promised: the usage the provider
// returned, the price it attached, and the tag it was given.

import { describe, expect, it } from 'vitest';

import { LLMBudgetError } from '../cost.js';
import { LLMReviewEngine } from '../llm-review-engine.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
  ToolDefinition,
} from '../provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/** A diff with one hunk, which is all the engine needs to build a prompt. */
const DIFF: GitDiff = {
  filePath: '/src/limit.ts',
  oldHash: 'a1',
  newHash: 'b2',
  ranges: [{ oldStart: 1, oldEnd: 10, newStart: 1, newEnd: 14, changeType: 'modified' }],
  changeType: 'modified',
};

/** What one lane call costs, as the provider would have priced it. */
const LANE_PROMPT_TOKENS = 3_000;
const LANE_COMPLETION_TOKENS = 200;
const LANE_CACHE_HIT_TOKENS = 2_000;
const LANE_COST_USD = 0.0021;

/**
 * A provider that answers every lane with an empty findings list and what it charged for it.
 *
 * `refuseAfter` makes it throw the same error a ceiling does, so the engine's failure path can be exercised without a
 * budget object - **the engine does not own the ceiling, the provider does**, and that separation is what this asserts.
 */
class PricedProvider implements LLMProvider {
  public readonly name = 'Priced';
  public readonly model = 'deepseek-chat';
  public readonly tags: string[] = [];
  public readonly prompts: string[] = [];

  constructor(private readonly refuseAfter = Number.POSITIVE_INFINITY) {}

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    if (this.prompts.length >= this.refuseAfter) {
      throw new LLMBudgetError(1, 1, options?.tag ?? 'untagged');
    }
    this.prompts.push(prompt);
    this.tags.push(options?.tag ?? 'untagged');
    return {
      content: '{"findings":[]}',
      model: this.model,
      createdAt: '2026-11-10T02:00:00.000Z',
      finishReason: 'stop',
      usage: {
        promptTokens: LANE_PROMPT_TOKENS,
        completionTokens: LANE_COMPLETION_TOKENS,
        totalTokens: LANE_PROMPT_TOKENS + LANE_COMPLETION_TOKENS,
        cacheHitTokens: LANE_CACHE_HIT_TOKENS,
        cacheMissTokens: LANE_PROMPT_TOKENS - LANE_CACHE_HIT_TOKENS,
      },
      costUsd: LANE_COST_USD,
    };
  }

  async completeWithTools(
    prompt: string,
    _tools: ToolDefinition[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    return this.complete(prompt, options);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('a review reports the calls it made', () => {
  it('carries each lane’s usage and price, and sums them into one figure', async () => {
    const provider = new PricedProvider();
    const engine = new LLMReviewEngine(provider);

    const results = await engine.reviewDiff(DIFF);
    const summary = engine.costSummary();

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.tokenUsage?.promptTokens).toBe(LANE_PROMPT_TOKENS);
      expect(result.tokenUsage?.cacheHitTokens).toBe(LANE_CACHE_HIT_TOKENS);
      expect(result.costUsd).toBeCloseTo(LANE_COST_USD, 12);
    }

    expect(summary.calls).toBe(5);
    expect(summary.promptTokens).toBe(5 * LANE_PROMPT_TOKENS);
    expect(summary.completionTokens).toBe(5 * LANE_COMPLETION_TOKENS);
    expect(summary.cacheHitTokens).toBe(5 * LANE_CACHE_HIT_TOKENS);
    expect(summary.costUsd).toBeCloseTo(5 * LANE_COST_USD, 12);
    // Two thirds of every prompt token came from the vendor's cache, and the review says so rather than leaving a
    // reader to infer it from a discount they cannot see.
    expect(summary.cacheHitRatio).toBeCloseTo(LANE_CACHE_HIT_TOKENS / LANE_PROMPT_TOKENS, 12);
  });

  it('tags every call with its lane, which is the only thing that makes a per-lane bill possible', async () => {
    const provider = new PricedProvider();
    await new LLMReviewEngine(provider).reviewDiff(DIFF);

    expect([...provider.tags].sort()).toEqual([
      'review:architecture',
      'review:maintainability',
      'review:performance',
      'review:security',
      'review:testing',
    ]);
  });

  it('describes one review rather than the process, so a second review does not inherit the first one’s spend', async () => {
    const provider = new PricedProvider();
    const engine = new LLMReviewEngine(provider);

    await engine.reviewDiff(DIFF);
    expect(engine.costSummary().calls).toBe(5);

    await engine.reviewDiff(DIFF);
    expect(engine.costSummary().calls).toBe(5);
    expect(engine.costSummary().costUsd).toBeCloseTo(5 * LANE_COST_USD, 12);
  });

  it('counts only the lanes that returned when a ceiling stops the rest', async () => {
    // Two lanes answer, the third refuses: the engine must report what it spent and what was refused.
    const provider = new PricedProvider(2);
    const engine = new LLMReviewEngine(provider);

    const results = await engine.reviewDiff(DIFF);

    const succeeded = results.filter((result) => result.success);
    const failed = results.filter((result) => !result.success);

    expect(succeeded).toHaveLength(2);
    expect(failed).toHaveLength(3);
    expect(failed[0]?.error).toMatch(/spend ceiling reached/);
    expect(engine.costSummary().calls).toBe(2);
    expect(engine.costSummary().costUsd).toBeCloseTo(2 * LANE_COST_USD, 12);
  });

  it('reports no cache ratio when the provider sent no split at all', async () => {
    const engine = new LLMReviewEngine(new PricedProvider());
    // A fresh engine has spent nothing, and a ratio over no tokens is not zero - it is unknown.
    expect(engine.costSummary().cacheHitRatio).toBeNull();
  });
});
