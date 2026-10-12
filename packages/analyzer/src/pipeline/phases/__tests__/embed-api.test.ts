/**
 * Contract tests for the API embedding backend.
 *
 * **Why these exist rather than a note that the path works.** The backend that this one replaces **could not run on any
 * machine** — `@agentix-e/embed-code-node` declares `files: ['dist', 'models']` and ships no `models/` — and **three
 * reports described that as "intermittent"** until a probe printed the error. **So this path is tested against a mocked
 * transport**, with the cases that matter being the ones where it must *refuse*:
 *
 *   - no key -> null with a reason, not a throw;
 *   - a rejected probe -> null with the endpoint's own message;
 *   - a response with the wrong number of vectors -> a failure, because **pairing the wrong vector with a text
 *     produces a number nobody can trace back to that pairing**;
 *   - vectors returned out of order -> ordered by `index`.
 *
 * **And one case about the credential itself**: **the key must travel in the header and never in the URL**, because a
 * URL is logged by every proxy on the way.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiEmbedderUnavailableReason, loadApiEmbedder } from '../embed-api.js';

const KEY = 'test-key-not-a-credential';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: { model?: string; input?: string | string[] };
}

let calls: Call[] = [];

/** Install a fetch that answers with the given vectors, and record every request it received. */
function mockFetch(handler: (body: { input?: string | string[] }) => { status?: number; payload?: unknown; text?: string }) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit & { headers?: Record<string, string> }) => {
    const body = JSON.parse(String(init.body)) as { input?: string | string[] };
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string>, body });
    const { status = 200, payload, text } = handler(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => text ?? '',
    } as unknown as Response;
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the API embedding backend', () => {
  it('returns null with a reason when the key is absent, rather than throwing', async () => {
    const result = await loadApiEmbedder({} as NodeJS.ProcessEnv);
    expect(result).toBeNull();
    expect(apiEmbedderUnavailableReason()).toContain('ZHIPU_API_KEY');
  });

  it('returns null and keeps the endpoint message when the probe is rejected', async () => {
    mockFetch(() => ({ status: 401, text: 'invalid api key' }));
    const result = await loadApiEmbedder({ ZHIPU_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(result).toBeNull();
    expect(apiEmbedderUnavailableReason()).toContain('401');
    expect(apiEmbedderUnavailableReason()).toContain('invalid api key');
  });

  it('never places the key in the request URL', async () => {
    mockFetch((body) => ({
      payload: { data: (Array.isArray(body.input) ? body.input : [body.input]).map((_, i) => ({ embedding: [1, 0], index: i })) },
    }));
    const loaded = await loadApiEmbedder({ ZHIPU_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(loaded).not.toBeNull();
    for (const call of calls) {
      expect(call.url).not.toContain(KEY);
      expect(call.headers['authorization']).toBe(`Bearer ${KEY}`);
    }
  });

  it('normalises every vector to unit length', async () => {
    mockFetch((body) => ({
      payload: { data: (Array.isArray(body.input) ? body.input : [body.input]).map((_, i) => ({ embedding: [3, 4], index: i })) },
    }));
    const loaded = await loadApiEmbedder({ ZHIPU_API_KEY: KEY } as NodeJS.ProcessEnv);
    const [first] = await loaded!.embedder.embedBatch(['x']);
    const norm = Math.sqrt([...first!].reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('orders vectors by index when the response is out of order', async () => {
    // **The first version of this test asserted a count mismatch while its name promised ordering**, so it proved
    // nothing about ordering - a test named after a behaviour it does not exercise. **This one sends two texts, gets
    // their vectors back in the opposite order, and checks which vector belongs to which text.**
    const embeddings: Record<string, number[]> = { alpha: [1, 0], beta: [0, 1] };
    mockFetch((body) => {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const ordered = inputs
        .map((text, i) => ({ embedding: embeddings[String(text)] ?? [1, 1], index: i }))
        // **Reversed on the wire**, which is the condition under test.
        .reverse();
      return { payload: { data: ordered } };
    });
    const loaded = await loadApiEmbedder({ ZHIPU_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(loaded).not.toBeNull();
    const [first, second] = await loaded!.embedder.embedBatch(['alpha', 'beta']);
    // A unit-normalised `[1,0]` is `[1,0]` and `[0,1]` is `[0,1]`, so the first component identifies the text.
    expect(first![0]).toBeCloseTo(1, 5);
    expect(second![0]).toBeCloseTo(0, 5);
  });

  it('fails when the response carries a different number of vectors than were sent', async () => {
    mockFetch(() => ({ payload: { data: [{ embedding: [1, 0], index: 0 }] } }));
    const result = await loadApiEmbedder({ ZHIPU_API_KEY: KEY } as NodeJS.ProcessEnv);
    // The probe sends one text and receives one, so the probe succeeds; the failure appears on a larger batch.
    expect(result).not.toBeNull();
    await expect(result!.embedder.embedBatch(['a', 'b'])).rejects.toThrow('expected 2');
  });

  it('batches rather than sending an unbounded request', async () => {
    mockFetch((body) => ({
      payload: { data: (Array.isArray(body.input) ? body.input : [body.input]).map((_, i) => ({ embedding: [1, 0], index: i })) },
    }));
    const loaded = await loadApiEmbedder({ ZHIPU_API_KEY: KEY } as NodeJS.ProcessEnv);
    calls = [];
    const texts = Array.from({ length: 33 }, (_, i) => `t${i}`);
    const vectors = await loaded!.embedder.embedBatch(texts);
    expect(vectors).toHaveLength(33);
    // 33 texts at a maximum of 16 per request is three requests, and the last one carries one.
    expect(calls.map((c) => (c.body.input as string[]).length)).toEqual([16, 16, 1]);
  });

  it('sends the configured model and endpoint on every request', async () => {
    mockFetch((body) => ({
      payload: { data: (Array.isArray(body.input) ? body.input : [body.input]).map((_, i) => ({ embedding: [1, 0], index: i })) },
    }));
    await loadApiEmbedder({
      ZHIPU_API_KEY: KEY,
      ZHIPU_EMBEDDING_ENDPOINT: 'https://example.invalid/embeddings',
      ZHIPU_EMBEDDING_MODEL: 'a-model',
    } as unknown as NodeJS.ProcessEnv);
    expect(calls[0]!.url).toBe('https://example.invalid/embeddings');
    expect(calls[0]!.body.model).toBe('a-model');
  });
});
