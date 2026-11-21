// A registry of two, and the four facts a second vendor has to supply
//
// **Why this file exists rather than one more case in `provider.test.ts`.** That file tests the *transport* - retries,
// 401, 429, the ceiling - and every case in it sets `DEEPSEEK_API_KEY` because until §127 there was one vendor. A second
// family adds exactly four things that can be wrong and that the transport tests cannot see: **the key variable, the
// base URL, the default model, and the name a bill is filed under.** Each is asserted here against a stubbed `fetch`,
// so a wrong endpoint is caught before it is a 404 in a fifty-minute job.
//
// **And one thing that can be wrong without any test noticing**, which is why the last describe block exists: an
// insertion that puts a new vendor first in the registry table changes what every unconfigured deployment measures while
// every assertion about a *named* provider still passes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLLMProvider,
  isLLMProviderName,
  knownLLMProviders,
} from '../review/llm/provider-factory.js';
import { DeepSeekProvider, ZhipuProvider } from '../review/llm/provider.js';

const KEY = 'test-key-not-a-real-one';

/** One answer in the shape an OpenAI-compatible endpoint returns, with the cache fields a caller can read. */
const answer = (usage: Record<string, unknown>, model = 'the-model-that-answered') =>
  new Response(
    JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('the second vendor, GLM', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env['DEEPSEEK_API_KEY'];
    process.env['ZHIPU_API_KEY'] = KEY;
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('posts to the version prefix the embedding client already uses, not to a bare host', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return answer({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
    });

    await new ZhipuProvider().complete('hello');

    // **The exact string**, because the base URL ends where the route begins: `.../v4` plus `/chat/completions` is the
    // endpoint, and a base written with the route already on it would produce `/chat/completions/chat/completions`.
    expect(calls).toEqual(['https://open.bigmodel.cn/api/paas/v4/chat/completions']);
  });

  it('reads ZHIPU_API_KEY and refuses to construct without it', () => {
    expect(new ZhipuProvider().name).toBe('GLM');
    // **The default model is a name the vendor serves, and it is asserted rather than described** so that an edit which
    // retires the alias fails here instead of in a job whose artifact says `404 model not found`.
    expect(new ZhipuProvider().model).toBe('glm-4.6');

    delete process.env['ZHIPU_API_KEY'];
    expect(() => new ZhipuProvider()).toThrow(/GLM/u);
  });

  it('files its calls under the model that answered, and under its own name', async () => {
    vi.stubGlobal('fetch', async () =>
      answer({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, 'glm-4.6-air'),
    );

    const result = await new ZhipuProvider().complete('hello');

    // **`data.model`, not `this.model`**, because the alias is not what was billed - the same rule the DeepSeek arm
    // follows, asserted here because a second vendor is where a copy of the transport would have dropped it.
    expect(result.model).toBe('glm-4.6-air');
  });

  it('reads the cache split from where GLM puts it, and derives the miss', async () => {
    vi.stubGlobal('fetch', async () =>
      answer({
        prompt_tokens: 1_000,
        completion_tokens: 5,
        total_tokens: 1_005,
        prompt_tokens_details: { cached_tokens: 640 },
      }),
    );

    const result = await new ZhipuProvider().complete('hello');

    expect(result.usage?.cacheHitTokens).toBe(640);
    // **Derived, because GLM reports the cached count and the prompt total and leaves the subtraction to the reader.** A
    // split that reported 640 hits and no miss would leave 360 tokens billed at no rate at all.
    expect(result.usage?.cacheMissTokens).toBe(360);
  });

  it('keeps a missing split missing rather than reporting a zero', async () => {
    vi.stubGlobal('fetch', async () =>
      answer({ prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 }),
    );

    const result = await new ZhipuProvider().complete('hello');

    // **`undefined` is "the vendor did not say" and `0` is "the vendor said no hits"** - a report that conflates them
    // turns a vendor without a cache into a run whose cache never worked.
    expect(result.usage?.cacheHitTokens).toBeUndefined();
    expect(result.usage?.cacheMissTokens).toBeUndefined();
  });

  it('prefers the top-level pair when a proxy in front of GLM normalises the fields', async () => {
    vi.stubGlobal('fetch', async () =>
      answer({
        prompt_tokens: 100,
        completion_tokens: 1,
        total_tokens: 101,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      }),
    );

    const result = await new ZhipuProvider().complete('hello');

    expect(result.usage?.cacheHitTokens).toBe(80);
    expect(result.usage?.cacheMissTokens).toBe(20);
  });

  it('does not treat a cached count larger than the prompt as a negative miss', async () => {
    vi.stubGlobal('fetch', async () =>
      answer({
        prompt_tokens: 100,
        completion_tokens: 1,
        total_tokens: 101,
        prompt_tokens_details: { cached_tokens: 120 },
      }),
    );

    const result = await new ZhipuProvider().complete('hello');

    // A vendor that counted the cached block twice would otherwise produce `miss: -20`, which every total downstream
    // would silently absorb.
    expect(result.usage?.cacheMissTokens).toBe(0);
  });
});

describe('the two vendors are the same transport', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('builds the same request body for both, from the same code', async () => {
    process.env['DEEPSEEK_API_KEY'] = KEY;
    process.env['ZHIPU_API_KEY'] = KEY;
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return answer({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
    });

    const options = { maxTokens: 32, temperature: 0, topP: 0.9 };
    await new DeepSeekProvider().complete('hello', options);
    await new ZhipuProvider().complete('hello', options);

    // **Everything but the model name**, which is the vendor's fact rather than the transport's. This is the assertion
    // that makes "the wire format is the shared part" a checked claim instead of a comment: a subclass that overrode the
    // body would fail here and only here.
    expect({ ...bodies[0], model: 'x' }).toEqual({ ...bodies[1], model: 'x' });
    expect(bodies[0]!['model']).toBe('deepseek-chat');
    expect(bodies[1]!['model']).toBe('glm-4.6');
  });
});

describe('the registry, grown by one', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('knows both vendors and still refuses a name it does not have', () => {
    expect(knownLLMProviders()).toEqual(['deepseek', 'zhipu']);
    expect(isLLMProviderName('zhipu')).toBe(true);
    expect(isLLMProviderName('glm')).toBe(false);
  });

  it('keeps DeepSeek first, so an unconfigured deployment measures the family the figures describe', () => {
    // **The order is the default.** `createLLMProvider` falls back to the first factory that can run, so this assertion
    // is what stops a future insertion from silently re-pricing every number in `EVAL-CONTRACT.md` - the failure is
    // invisible in every test that names a provider and visible in one line here.
    expect(knownLLMProviders()[0]).toBe('deepseek');
  });

  it('builds GLM when the environment names it', () => {
    process.env['ZHIPU_API_KEY'] = KEY;
    const provider = createLLMProvider('zhipu');

    expect(provider?.name).toBe('GLM');
    expect(provider?.model).toBe('glm-4.6');
  });

  it('builds DeepSeek when the environment names it and both keys are present', () => {
    process.env['DEEPSEEK_API_KEY'] = KEY;
    process.env['ZHIPU_API_KEY'] = KEY;

    // **Both keys present and the name given: the name wins.** A registry that let insertion order decide this would make
    // a run labelled `deepseek` a run on whichever vendor happened to be registered first.
    expect(createLLMProvider('deepseek')?.name).toBe('DeepSeek');
  });
});
