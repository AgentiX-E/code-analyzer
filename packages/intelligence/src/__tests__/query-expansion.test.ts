// Query expansion: the prompt, the cleaning, the mean, and the degradation path.
//
// **The provider here is an object with a `complete` method**, not a mocked module: the code under test takes an
// `LLMProvider`, so a local implementation is the same seam a caller uses. What is asserted is the contract the
// retriever depends on - that the question is in the prompt, that fences do not reach the embedder, and that a model
// which answers nothing leaves the query exactly as it was.

import { describe, expect, it } from 'vitest';

import {
  MIN_HYPOTHESIS_CHARS,
  cleanHypothesis,
  expandQuestion,
  expandToVector,
  hydePrompt,
  meanVector,
} from '../search/query-expansion.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../review/llm/provider.js';

/** A provider that answers with a fixed completion, and records what it was asked. */
function answering(
  content: string,
  result: Partial<CompletionResult> = {},
): {
  provider: LLMProvider;
  prompts: string[];
  options: Array<CompletionOptions | undefined>;
} {
  const prompts: string[] = [];
  const options: Array<CompletionOptions | undefined> = [];
  const provider: LLMProvider = {
    name: 'test',
    complete: async (prompt: string, opts?: CompletionOptions) => {
      prompts.push(prompt);
      options.push(opts);
      return {
        content,
        model: 'test-model',
        createdAt: new Date(0).toISOString(),
        finishReason: 'stop',
        ...result,
      };
    },
  } as unknown as LLMProvider;
  return { provider, prompts, options };
}

describe('hydePrompt', () => {
  it('asks for code, forbids commentary, and carries the question', () => {
    const prompt = hydePrompt('How do I count the calls in a file?');
    expect(prompt).toContain('How do I count the calls in a file?');
    expect(prompt).toContain('Output code only');
    // **The ask is for an implementation rather than for an answer**: an answer names a symbol that may not exist.
    expect(prompt).toContain('Write a short, plausible implementation');
  });
});

describe('cleanHypothesis', () => {
  it('removes a fence and the sentence a model puts in front of it', () => {
    const text =
      'Sure, here it is:\n```typescript\nexport function countCalls(src: string) {\n  return 1;\n}\n```';
    expect(cleanHypothesis(text)).toBe(
      'Sure, here it is:\nexport function countCalls(src: string) {\n  return 1;\n}',
    );
  });

  it('removes a caption that is not code', () => {
    expect(cleanHypothesis('Code: export const x = 1;')).toBe('export const x = 1;');
    expect(cleanHypothesis('Implementation:\nlet n = 0;')).toBe('let n = 0;');
  });

  it('collapses the blank runs a fence leaves behind', () => {
    expect(cleanHypothesis('a();\n\n\n\nb();')).toBe('a();\n\nb();');
  });

  it('reports nothing as nothing, rather than as a newline', () => {
    expect(cleanHypothesis('   \n\n  ')).toBe('');
    expect(cleanHypothesis('```\n```')).toBe('');
  });
});

describe('expandQuestion', () => {
  it('returns the cleaned hypothesis and passes the options through', async () => {
    const { provider, prompts, options } = answering('```ts\nconst a = 1;\n```');
    const expanded = await expandQuestion('where is the constant?', provider, {
      maxTokens: 120,
      temperature: 0.2,
      timeout: 5_000,
    });
    expect(expanded.question).toBe('where is the constant?');
    expect(expanded.hypothesis).toBe('const a = 1;');
    expect(prompts[0]).toContain('where is the constant?');
    expect(options[0]).toMatchObject({ maxTokens: 120, temperature: 0.2, timeout: 5_000 });
  });

  it('defaults to a short, deterministic completion request', async () => {
    const { provider, options } = answering('const a = 1;');
    await expandQuestion('q', provider);
    expect(options[0]).toEqual({ maxTokens: 220, temperature: 0 });
  });
});

describe('meanVector', () => {
  it('averages and renormalises, so a cosine stays a dot product', () => {
    const mean = meanVector([
      [1, 0],
      [0, 1],
    ]);
    // The mean of two unit vectors has length 1/√2; renormalising puts it back on the unit sphere.
    expect(mean[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(mean[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.hypot(mean[0]!, mean[1]!)).toBeCloseTo(1, 6);
  });

  it('returns a unit vector unchanged', () => {
    const mean = meanVector([[3, 4]]);
    expect(mean[0]).toBeCloseTo(0.6, 6);
    expect(mean[1]).toBeCloseTo(0.8, 6);
  });

  it('skips a vector of another width rather than resizing it — two spaces do not average', () => {
    const mean = meanVector([
      [1, 0],
      [0, 1, 0],
    ]);
    expect(Array.from(mean)).toEqual([1, 0]);
  });

  it('has an answer for no vectors and for a zero vector', () => {
    expect(meanVector([]).length).toBe(0);
    // A zero vector scores 0 against everything, which is the honest answer for "no information".
    expect(Array.from(meanVector([[0, 0]]))).toEqual([0, 0]);
  });
});

describe('expandToVector', () => {
  const embedder = (): { embed: (text: string) => Promise<Float32Array>; texts: string[] } => {
    const texts: string[] = [];
    return {
      texts,
      embed: async (text: string) => {
        texts.push(text);
        // **The question and the hypothesis are deliberately orthogonal**, so a mean that forgot to normalise, or that
        // dropped one of the two, cannot pass.
        return text.startsWith('how') ? Float32Array.from([1, 0]) : Float32Array.from([0, 1]);
      },
    };
  };

  it('embeds the question and the hypothesis, and returns their direction', async () => {
    const { provider } = answering('x'.repeat(MIN_HYPOTHESIS_CHARS));
    const { embed, texts } = embedder();
    const expanded = await expandToVector('how do I count calls?', provider, embed);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe('x'.repeat(MIN_HYPOTHESIS_CHARS));
    expect(expanded.hypothesis).toHaveLength(MIN_HYPOTHESIS_CHARS);
    expect(expanded.vector[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('falls back to the question vector when the model produced nothing usable', async () => {
    // **The degradation is the important arm**: an expansion that fails must leave the retriever where it was.
    const { provider } = answering('   ');
    const { embed, texts } = embedder();
    const expanded = await expandToVector('how do I count calls?', provider, embed);
    expect(texts).toEqual(['how do I count calls?']);
    expect(expanded.hypothesis).toBe('');
    expect(Array.from(expanded.vector)).toEqual([1, 0]);
  });
});
