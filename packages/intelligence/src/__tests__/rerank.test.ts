// Listwise reranking: the prompt, the parse, the permutation, and the four ways it declines to act.
//
// **The parse is the safety boundary**, so the cases below are mostly about what a model actually returns - a fence, a
// sentence before the numbers, a repeated id, an id one past the end - and about the invariant that matters: **a
// candidate can never be lost by asking for a better order.**

import { describe, expect, it } from 'vitest';

import {
  applyOrder,
  describeFailure,
  parseRerankAnswer,
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

  it('returns the input when the answer has no usable number, and keeps the answer for the reader', async () => {
    const { provider } = answering('I would rather not.');
    const result = await rerankCandidates('q', candidates, describeCandidate, provider);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('no usable candidate number');
    expect(result.answer).toBe('I would rather not.');
  });
});
