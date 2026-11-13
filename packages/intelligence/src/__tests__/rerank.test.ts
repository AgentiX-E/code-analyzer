// Listwise reranking: the prompt, the parse, the permutation, and the four ways it declines to act.
//
// **The parse is the safety boundary**, so the cases below are mostly about what a model actually returns - a fence, a
// sentence before the numbers, a repeated id, an id one past the end - and about the invariant that matters: **a
// candidate can never be lost by asking for a better order.**

import { describe, expect, it } from 'vitest';

import { LLMRateLimitError } from '../review/llm/provider.js';
import {
  answerBudget,
  applyOrder,
  describeFailure,
  parseRerankAnswer,
  rateLimitDelayMs,
  rerankCandidates,
  rerankPrompt,
} from '../search/rerank.js';


import type { LLMProvider } from '../review/llm/provider.js';
import type { RerankCandidate } from '../search/rerank.js';

interface Candidate {
  rank: number;
  name: string;
}

const candidate = (rank: number, name: string): Candidate => ({ rank, name });
const describeCandidate = (value: Candidate): RerankCandidate => ({
  rank: value.rank,
  name: value.name,
  qualifiedName: `pkg.${value.name}`,
  filePath: `/src/${value.name}.ts`,
});

/** A provider that answers with a fixed text and records the prompt. */
function answering(content: string): { provider: LLMProvider; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    provider: {
      name: 'fake',
      complete: async (prompt: string) => {
        prompts.push(prompt);
        return {
          content,
          model: 'fake',
          createdAt: new Date(0).toISOString(),
          finishReason: 'stop',
        };
      },
    } as unknown as LLMProvider,
  };
}

describe('rerankPrompt', () => {
  it('numbers the candidates and shows the fields a judgement needs', () => {
    const prompt = rerankPrompt('where do we count the calls?', [
      {
        rank: 1,
        name: 'countCalls',
        qualifiedName: 'pkg.countCalls',
        filePath: 'src/calls.ts',
        signature: 'function countCalls(source: string): number',
        excerpt: 'return source.split("\\n").length;',
      },
      { rank: 2, name: 'walk', qualifiedName: 'pkg.walk', filePath: null },
    ]);

    expect(prompt).toContain('where do we count the calls?');
    expect(prompt).toContain('[1] countCalls');
    expect(prompt).toContain('path: src/calls.ts');
    expect(prompt).toContain('signature: function countCalls');
    // **A candidate with no path shows no path line**, rather than an empty one the model has to interpret.
    expect(prompt).toContain('[2] walk');
    expect(prompt).not.toContain('path: null');
    expect(prompt).toContain('bracket numbers only');
  });
});

describe('parseRerankAnswer', () => {
  it('accepts the shapes a model produces, and keeps the first mention of an id', () => {
    expect(parseRerankAnswer('3 1 2', 3)).toEqual([3, 1, 2]);
    expect(parseRerankAnswer('[3, 1, 2]', 3)).toEqual([3, 1, 2]);
    expect(parseRerankAnswer('Here is my ranking:\n3, 1, 2', 3)).toEqual([3, 1, 2]);
    expect(parseRerankAnswer('2 2 1', 3)).toEqual([2, 1]);
  });

  it('drops an answer that is not in the list rather than clamping it', () => {
    // **0 and `count + 1` are what an off-by-one answer produces**, and a clamp would reorder the wrong candidate.
    expect(parseRerankAnswer('0 1 4', 3)).toEqual([1]);
    expect(parseRerankAnswer('no idea', 3)).toEqual([]);
  });
});

describe('applyOrder', () => {
  it('appends every candidate the order did not mention, in its own order', () => {
    const candidates = [candidate(1, 'a'), candidate(2, 'b'), candidate(3, 'c')];
    expect(applyOrder(candidates, [3, 1]).map((c) => c.name)).toEqual(['c', 'a', 'b']);
  });

  it('ignores an id that is not a candidate', () => {
    const candidates = [candidate(1, 'a'), candidate(2, 'b')];
    expect(applyOrder(candidates, [9, 2, 1]).map((c) => c.name)).toEqual(['b', 'a']);
  });
});

describe('rerankCandidates', () => {
  const candidates = [candidate(1, 'first'), candidate(2, 'second'), candidate(3, 'third')];

  it('reorders when the model names a different order', async () => {
    const { provider, prompts } = answering('3 2 1');
    const result = await rerankCandidates('q', candidates, describeCandidate, provider);

    expect(result.applied).toBe(true);
    expect(result.ordered.map((c) => c.name)).toEqual(['third', 'second', 'first']);
    expect(prompts[0]).toContain('Question: q');
  });

  it('says it did nothing when the model kept the fused order', async () => {
    const { provider } = answering('1 2 3');
    const result = await rerankCandidates('q', candidates, describeCandidate, provider);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('kept the fused order');
  });

  it('returns the input when there is nothing to order or nobody to ask', async () => {
    const { provider } = answering('3 2 1');
    expect(
      (await rerankCandidates('q', [candidate(1, 'only')], describeCandidate, provider)).reason,
    ).toContain('fewer than two');
    expect((await rerankCandidates('q', candidates, describeCandidate, null)).reason).toContain(
      'no LLM provider',
    );
  });

  it('returns the input when the provider fails, because the fused order is still an answer', async () => {
    const failing = {
      name: 'failing',
      complete: async () => {
        throw new Error('429 rate limited');
      },
    } as unknown as LLMProvider;
    const result = await rerankCandidates('q', candidates, describeCandidate, failing);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('429 rate limited');
    expect(result.ordered).toEqual(candidates);
  });

  it('passes the budget through, and survives a provider that throws something that is not an Error', async () => {
    // **Both arms exist because the measurement passes a 60 s timeout** while the default is the provider's; and a
    // rejected fetch can throw a string, which must not become `undefined` in the recorded reason.
    const seen: Array<{ maxTokens?: number; timeout?: number }> = [];
    const refusing = {
      name: 'refusing',
      complete: async (_prompt: string, options: { maxTokens?: number; timeout?: number }) => {
        seen.push(options);
        throw new Error('socket closed');
      },
    } as unknown as LLMProvider;

    const result = await rerankCandidates('q', candidates, describeCandidate, refusing, {
      maxTokens: 20,
      timeout: 1_000,
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('socket closed');
    expect(seen[0]).toMatchObject({ maxTokens: 20, timeout: 1_000 });
  });

  it('turns whatever a transport rejected with into a reason', () => {
    // **Both arms, without a transport**: a fetch can reject with a string, and a reason recorded as `undefined` would
    // hide the failure rather than report it.
    expect(describeFailure(new Error('429 rate limited'))).toBe('429 rate limited');
    expect(describeFailure('socket closed')).toBe('socket closed');
  });

  it('sizes the default budget to the pool, because an order is one number per candidate', async () => {
    // **The pool grew and the budget did not.** `120` was chosen when fifty candidates fitted one prompt; a hundred and
    // fifty numbers do not fit in it, and a completion cut mid-list is read by `applyOrder` as a model that chose to
    // stop - the surviving numbers reorder the head and the tail keeps the fused order, so a deeper pool would be
    // measured as a worse one for a reason no column would name.
    const seen: Array<{ maxTokens?: number }> = [];
    const recording = {
      name: 'recording',
      complete: async (_prompt: string, options: { maxTokens?: number }) => {
        seen.push(options);
        return {
          content: '1',
          model: 'fake',
          createdAt: new Date(0).toISOString(),
          finishReason: 'stop',
        };
      },
    } as unknown as LLMProvider;

    const pool = (size: number): Candidate[] =>
      Array.from({ length: size }, (_, index) => candidate(index + 1, `node${index}`));
    await rerankCandidates('q', pool(50), describeCandidate, recording);
    await rerankCandidates('q', pool(150), describeCandidate, recording);

    // **The budget asked for is at least the budget the pool needs**, and a deeper pool asks for more than a shallower
    // one - which is the whole point of deriving it.
    expect(answerBudget(50)).toBeLessThanOrEqual(seen[0]!.maxTokens!);
    expect(seen[1]!.maxTokens!).toBeGreaterThan(seen[0]!.maxTokens!);
    // **And it is a floor, not a formula**: a pool small enough to fit the constant keeps the constant.
    expect(answerBudget(2)).toBe(120);
  });

  it('returns the input when the answer has no usable number, and keeps the answer for the reader', async () => {
    const { provider } = answering('I would rather not.');
    const result = await rerankCandidates('q', candidates, describeCandidate, provider);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('no usable candidate number');
    expect(result.answer).toBe('I would rather not.');
  });
});

describe('the reranker reports what it was billed rather than what it was expected to cost', () => {
  /** A three-candidate pool: enough for a reorder, small enough to write down. */
  const pool = [candidate(1, 'a'), candidate(2, 'b'), candidate(3, 'c')];

  /** A provider that answers with a fixed text and a bill. */
  const billing = (
    content: string,
    extra: { usage?: unknown; costUsd?: number; model?: string } = {},
  ): LLMProvider =>
    ({
      name: 'billing',
      complete: async () => ({
        content,
        model: extra.model ?? 'deepseek-chat',
        createdAt: new Date(0).toISOString(),
        finishReason: 'stop',
        ...(extra.usage === undefined ? {} : { usage: extra.usage }),
        ...(extra.costUsd === undefined ? {} : { costUsd: extra.costUsd }),
      }),
    }) as unknown as LLMProvider;

  it('carries the model, the tokens and the priced amount out of the call', async () => {
    // **Every cost figure this repository published for the reranker was an estimate** ("~0.70 USD for two arms"), while
    // the provider had been returning the tokens and the amount all along. This is the difference between the two.
    const result = await rerankCandidates(
      'q',
      pool,
      describeCandidate,
      billing('2 1 3', {
        usage: { promptTokens: 1_800, completionTokens: 40, totalTokens: 1_840 },
        costUsd: 0.000_521,
      }),
    );
    expect(result.applied).toBe(true);
    expect(result.cost).toMatchObject({
      model: 'deepseek-chat',
      usage: { promptTokens: 1_800, completionTokens: 40, totalTokens: 1_840 },
      usd: 0.000_521,
    });
  });

  it('keeps an unpriced model unpriced rather than free', async () => {
    // **A zero is absorbed by any total**, and a bill that reports an unknown model as costing nothing is worse than one
    // that reports it as unknown. The price table refuses; this refuses the same way.
    const result = await rerankCandidates(
      'q',
      pool,
      describeCandidate,
      billing('1 2 3', { usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }),
    );
    expect(result.cost).toBeDefined();
    expect(result.cost?.usd).toBeUndefined();
    expect(result.cost?.usage?.promptTokens).toBe(10);
  });

  it('records a bill for a call that answered nothing usable', async () => {
    // **The prompt was paid for whether or not the parser could read the answer**, and an arm whose completions the
    // model ignored would otherwise report as the cheapest one.
    const result = await rerankCandidates('q', pool, describeCandidate, billing('no idea'));
    expect(result.applied).toBe(false);
    expect(result.cost?.model).toBe('deepseek-chat');
  });

  it('has no bill when nothing was sent', async () => {
    // A failure, a single candidate and an absent provider are three ways not to call a model, and none of them costs
    // anything - an attributable zero here would be a real zero rather than an unknown, and the field is absent.
    const failing = {
      name: 'failing',
      complete: async () => {
        throw new Error('429 rate limited');
      },
    } as unknown as LLMProvider;
    expect((await rerankCandidates('q', pool, describeCandidate, failing)).cost).toBeUndefined();
    expect((await rerankCandidates('q', pool, describeCandidate, null)).cost).toBeUndefined();
    expect(
      (await rerankCandidates('q', [candidate(1, 'only')], describeCandidate, billing('1'))).cost,
    ).toBeUndefined();
  });

  /**
   * **A rate limit is not an opinion, and the difference is the whole reason the ladder can be parallelised.**
   *
   * The provider refuses to retry a 429 on purpose - it reports what the service said - and `rerankCandidates` used to
   * fold that into "the fused order is my answer", which is the same output a model that shrugged produces. **A wide
   * ladder is exactly where that folds into a published figure**: eight questions in flight hit a limit that one in
   * flight never did, and the arm would be reported as having no effect rather than as having been throttled.
   */
  describe('rate limits', () => {
    /** A provider that refuses `times` times and then answers, **counting the calls it was asked to make**. */
    function throttled(
      times: number,
      answer: string,
    ): { provider: LLMProvider; calls: () => number } {
      let made = 0;
      return {
        calls: () => made,
        provider: {
          name: 'throttled',
          complete: async () => {
            made += 1;
            if (made <= times) throw new LLMRateLimitError('deepseek', '0');
            return {
              content: answer,
              model: 'throttled',
              createdAt: new Date(0).toISOString(),
              finishReason: 'stop',
            };
          },
        } as unknown as LLMProvider,
      };
    }

    it('asks again after a rate limit and applies the answer it eventually got', async () => {
      const { provider, calls } = throttled(1, '3 1 2');
      const result = await rerankCandidates('q', pool, describeCandidate, provider);

      expect(calls()).toBe(2);
      expect(result.applied).toBe(true);
      expect(result.rateLimitRetries).toBe(1);
      expect(result.ordered.map((entry) => entry.rank)).toEqual([3, 1, 2]);
    });

    it('gives up after the retry budget and says it was throttled rather than uninterested', async () => {
      const { provider, calls } = throttled(Number.POSITIVE_INFINITY, '1 2 3');
      const result = await rerankCandidates('q', pool, describeCandidate, provider);

      // **Four calls: the first attempt and three retries**, which is the number the constant states.
      expect(calls()).toBe(4);
      expect(result.applied).toBe(false);
      expect(result.rateLimitRetries).toBe(3);
      expect(result.reason).toContain('Rate limit exceeded');
      // **No bill**: a refused request was not answered, so counting one would report a cost nothing bought.
      expect(result.cost).toBeUndefined();
    });

    it('honours a Retry-After date that is already in the past without waiting', async () => {
      // **The header is either seconds or an HTTP date**, providers send both, and a caller that parsed only seconds
      // would compute `NaN` - which `setTimeout` fires immediately. That is right by accident for a past date and wrong
      // for a future one, so the test uses a past date and also asserts the wait did not happen.
      let made = 0;
      const dated = {
        name: 'dated',
        complete: async () => {
          made += 1;
          if (made === 1) {
            throw new LLMRateLimitError('deepseek', new Date(Date.now() - 1000).toUTCString());
          }
          return {
            content: '2 1 3',
            model: 'dated',
            createdAt: new Date(0).toISOString(),
            finishReason: 'stop',
          };
        },
      } as unknown as LLMProvider;

      const startedAt = Date.now();
      const result = await rerankCandidates('q', pool, describeCandidate, dated);

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(made).toBe(2);
      expect(result.applied).toBe(true);
      expect(result.rateLimitRetries).toBe(1);
    });

    it('turns each Retry-After form into a wait, capped so one search cannot become an hour', async () => {
      // **The header has two forms and the cap has to survive both.** `3600` is a real value and waiting for it would
      // hold a search open for an hour, so the arithmetic is tested directly rather than by waiting: the constant is
      // what keeps a throttled provider degrading to a refused rerank instead of to a hung process.
      expect(rateLimitDelayMs(new LLMRateLimitError('deepseek', '2'), 0)).toBe(2000);
      expect(rateLimitDelayMs(new LLMRateLimitError('deepseek', '0'), 0)).toBe(0);
      expect(rateLimitDelayMs(new LLMRateLimitError('deepseek', '3600'), 0)).toBe(30_000);
      // **A date in the past is zero rather than a negative timer**, which `setTimeout` would also fire immediately -
      // correct by accident, and `Math.max` is what makes it correct on purpose.
      expect(
        rateLimitDelayMs(
          new LLMRateLimitError('deepseek', new Date(Date.now() - 5000).toUTCString()),
          0,
        ),
      ).toBe(0);
      // **An unparseable header falls back to exponential**, which is where the attempt number is used.
      expect(rateLimitDelayMs(new LLMRateLimitError('deepseek', 'soon'), 0)).toBe(1000);
      expect(rateLimitDelayMs(new LLMRateLimitError('deepseek', 'soon'), 2)).toBe(4000);
      // **Absent header, same fallback**: a provider that sent none is a provider that wants a polling client.
      expect(rateLimitDelayMs(new LLMRateLimitError('deepseek'), 1)).toBe(2000);
    });

    it('does not retry a failure that a retry cannot fix', async () => {
      let made = 0;
      const broken = {
        name: 'broken',
        complete: async () => {
          made += 1;
          throw new Error('socket hang up');
        },
      } as unknown as LLMProvider;
      const result = await rerankCandidates('q', pool, describeCandidate, broken);

      expect(made).toBe(1);
      expect(result.reason).toContain('socket hang up');
      // **Absent rather than zero**: a call that was never throttled has no retry count, and a `0` would be a claim
      // about a run that did not happen.
      expect(result.rateLimitRetries).toBeUndefined();
    });
  });
});
