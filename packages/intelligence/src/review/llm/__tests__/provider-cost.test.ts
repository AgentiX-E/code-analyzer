// The provider's bill, recorded against a real HTTP server on a loopback port.
//
// **Why these are not assertions about a stub.** The three things that can go wrong here are all about what actually
// crosses the wire: **the cache split is in a field the client has to read and keep**, **the ceiling has to stop a
// request that has not been sent**, and **a retry has to be counted as an attempt rather than as a call**. A stubbed
// `fetch` can be told the answers; only a server can show that no second request arrived.

import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { CostLedger, LLMBudgetError, costUsdOf } from '../cost.js';
import { DeepSeekProvider, LLMRateLimitError } from '../provider.js';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 02:00 UTC on a Tuesday: inside the vendor's peak window, so a price can be checked against the table by hand. */
const PEAK_CLOCK = (): Date => new Date('2026-11-10T02:00:00Z');
/** 05:00 UTC on the same Tuesday: outside it, so the same usage must cost exactly half. */
const OFF_PEAK_CLOCK = (): Date => new Date('2026-11-10T05:00:00Z');

interface Served {
  requests: number;
  bodies: string[];
}

function startServer(
  reply: (req: IncomingMessage, res: ServerResponse, index: number) => void,
): Promise<{ server: Server; url: string; served: Served }> {
  const served: Served = { requests: 0, bodies: [] };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        served.bodies.push(body);
        served.requests += 1;
        reply(req, res, served.requests);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, served });
    });
  });
}

let servers: Server[] = [];

afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
  delete process.env['DEEPSEEK_API_KEY'];
});

/** A completion carrying the cache split, which is the field this client used to discard. */
const COMPLETION_WITH_CACHE_SPLIT = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1_700_000_000,
  model: 'deepseek-chat',
  choices: [
    { index: 0, message: { role: 'assistant', content: '{"findings":[]}' }, finish_reason: 'stop' },
  ],
  usage: {
    prompt_tokens: 3_000,
    completion_tokens: 200,
    total_tokens: 3_200,
    prompt_cache_hit_tokens: 2_000,
    prompt_cache_miss_tokens: 1_000,
  },
});

function provider(
  url: string,
  extra: Partial<ConstructorParameters<typeof DeepSeekProvider>[0]> = {},
): DeepSeekProvider {
  process.env['DEEPSEEK_API_KEY'] = 'test-key';
  return new DeepSeekProvider({
    baseUrl: url,
    timeout: 2_000,
    maxRetries: 0,
    now: PEAK_CLOCK,
    ...extra,
  });
}

describe('the completion carries the cache split the vendor reported', () => {
  it('keeps the hit and miss counts instead of the three-field usage it used to build', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(COMPLETION_WITH_CACHE_SPLIT);
    });
    servers.push(server);

    const result = await provider(url).complete('review this');

    expect(result.usage?.promptTokens).toBe(3_000);
    expect(result.usage?.cacheHitTokens).toBe(2_000);
    expect(result.usage?.cacheMissTokens).toBe(1_000);
    expect(result.usage?.completionTokens).toBe(200);
  });

  it('leaves the split absent when the vendor did not report one, rather than reporting zero hits', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      );
    });
    servers.push(server);

    const result = await provider(url).complete('review this');

    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.cacheHitTokens).toBeUndefined();
    expect(result.usage?.cacheMissTokens).toBeUndefined();
    // The price of an unreported split is the miss price for every prompt token, which is 0.3 USD per million at peak.
    expect(result.costUsd).toBeCloseTo((10 * 0.3) / 1_000_000 + (2 * 1.2) / 1_000_000, 12);
  });
});

describe('the provider records what it spent', () => {
  it('writes one entry carrying the tag, the billed model and the vendor’s own token counts', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(COMPLETION_WITH_CACHE_SPLIT);
    });
    servers.push(server);

    const ledger = new CostLedger();
    const result = await provider(url, { ledger }).complete('review this', {
      tag: 'review:security',
    });

    const totals = ledger.totals();
    expect(totals.calls).toBe(1);
    expect(totals.retries).toBe(0);
    expect(totals.failures).toBe(0);
    expect(totals.costUsd).toBeCloseTo(
      costUsdOf(result.usage!, 'deepseek-chat', PEAK_CLOCK())!,
      12,
    );
    expect(ledger.byTag()).toEqual([{ tag: 'review:security', totals: totals }]);

    const recorded = ledger.entries[0];
    expect(recorded?.model).toBe('deepseek-chat');
    expect(recorded?.tag).toBe('review:security');
    expect(recorded?.usage.cacheHitTokens).toBe(2_000);
    expect(recorded?.outcome).toBe('ok');
    // The result and the ledger must agree on one number, or one of them is a second opinion about a bill.
    expect(recorded?.costUsd).toBeCloseTo(result.costUsd!, 12);
  });

  it('calls an untagged completion untagged instead of dropping it', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(COMPLETION_WITH_CACHE_SPLIT);
    });
    servers.push(server);

    const ledger = new CostLedger();
    await provider(url, { ledger }).complete('review this');

    expect(ledger.entries[0]?.tag).toBe('untagged');
  });

  it('prices the same usage at half off-peak', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(COMPLETION_WITH_CACHE_SPLIT);
    });
    servers.push(server);

    const peak = await provider(url).complete('review this');
    const offPeak = await provider(url, { now: OFF_PEAK_CLOCK }).complete('review this');

    expect(peak.costUsd!).toBeGreaterThan(0);
    expect(offPeak.costUsd!).toBeCloseTo(peak.costUsd! / 2, 12);
  });

  it('answers an unpriced model with no cost rather than a free one', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        COMPLETION_WITH_CACHE_SPLIT.replace(
          '"model":"deepseek-chat"',
          '"model":"a-model-nobody-priced"',
        ),
      );
    });
    servers.push(server);

    const ledger = new CostLedger();
    const result = await provider(url, { ledger }).complete('review this', { tag: 'judge' });

    expect(result.costUsd).toBeUndefined();
    expect(ledger.totals().unpricedCalls).toBe(1);
    expect(ledger.totals().costUsd).toBe(0);
    expect(ledger.totals().calls).toBe(1);
  });

  it('records the attempt that failed and the one that answered, so a retry is visible', async () => {
    const { server, url } = await startServer((_req, res, index) => {
      if (index === 1) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"transient"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(COMPLETION_WITH_CACHE_SPLIT);
    });
    servers.push(server);

    const ledger = new CostLedger();
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    // The retry sleeps a second before the second attempt; that is the provider's own backoff and not a test concern.
    const retrying = new DeepSeekProvider({
      baseUrl: url,
      timeout: 2_000,
      maxRetries: 1,
      ledger,
      now: PEAK_CLOCK,
    });
    const result = await retrying.complete('review this', { tag: 'review:security' });

    expect(result.content).toBe('{"findings":[]}');
    const totals = ledger.totals();
    expect(totals.failures).toBe(1);
    expect(totals.calls).toBe(1);
    expect(totals.retries).toBe(1);
    expect(ledger.entries.map((entry) => entry.attempt)).toEqual([0, 1]);
    expect(ledger.entries[0]?.error).toContain('500');
  });
});

describe('an answer that says less is still recorded', () => {
  it('records an unpriced call when the response carries no usage at all', async () => {
    // **A compatible endpoint need not report usage.** The call happened and someone paid for it; what the ledger must
    // not do is report it as free, which is what a zero would have said.
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
      );
    });
    servers.push(server);

    const ledger = new CostLedger();
    const result = await provider(url, { ledger }).complete('review this', {
      tag: 'review:security',
    });

    expect(result.usage).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
    expect(ledger.totals().calls).toBe(1);
    expect(ledger.totals().unpricedCalls).toBe(1);
    expect(ledger.totals().costUsd).toBe(0);
    expect(ledger.entries[0]?.usage.totalTokens).toBe(0);
  });

  it('renders a tool call into the content when the message carries no text', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
    servers.push(server);

    const result = await provider(url).complete('which file?');

    expect(result.content).toBe('read_file({"path":"a.ts"})');
    expect(result.toolCalls?.[0]?.name).toBe('read_file');
    expect(result.finishReason).toBe('tool_calls');
  });

  it('answers with an empty string when the answer has neither text nor a tool call', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
        }),
      );
    });
    servers.push(server);

    const result = await provider(url).complete('review this');
    expect(result.content).toBe('');
    expect(result.toolCalls).toBeUndefined();
  });

  it('reports a rate limit that carried no Retry-After as a rate limit with no advice', async () => {
    // **The header is optional and the error has to exist without it.** A 429 that threw a generic error would be
    // retried by a caller that had no way to know a retry was the wrong move.
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end('{"error":"slow down"}');
    });
    servers.push(server);

    await expect(provider(url).complete('review this')).rejects.toBeInstanceOf(LLMRateLimitError);
    try {
      await provider(url).complete('review this');
      expect.unreachable('the call should have been refused');
    } catch (error) {
      expect((error as LLMRateLimitError).retryAfter).toBeUndefined();
      expect((error as LLMRateLimitError).message).toBe(
        'Rate limit exceeded for provider "DeepSeek"',
      );
    }
  });

  it('prices against the requested model when the response names none', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // No `model` field: the price has to come from the name the request was sent under, or the call goes unpriced.
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 },
        }),
      );
    });
    servers.push(server);

    const ledger = new CostLedger();
    const result = await provider(url, { ledger }).complete('review this');

    expect(result.costUsd).toBeCloseTo(0.3, 10);
    expect(ledger.entries[0]?.model).toBe('deepseek-chat');
  });
});

describe('the ceiling stops a request that has not been sent', () => {
  it('throws before the network is touched and reports the tag it refused', async () => {
    const { server, url, served } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(COMPLETION_WITH_CACHE_SPLIT);
    });
    servers.push(server);

    const ledger = new CostLedger();
    const first = await provider(url, { ledger }).complete('review this', {
      tag: 'review:security',
    });
    // A ceiling exactly at the first call's cost: the second call must not happen.
    const ceiling = first.costUsd!;
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    const bounded = new DeepSeekProvider({
      baseUrl: url,
      timeout: 2_000,
      maxRetries: 0,
      ledger,
      ceilingUsd: ceiling,
      now: PEAK_CLOCK,
    });

    await expect(
      bounded.complete('review this again', { tag: 'review:architecture' }),
    ).rejects.toBeInstanceOf(LLMBudgetError);
    // **The count is the assertion**: a refusal that still sent the request would be a ceiling in a report only.
    expect(served.requests).toBe(1);
    expect(ledger.totals().calls).toBe(1);
  });

  it('refuses to construct a ceiling with nothing to measure it against', () => {
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    expect(() => new DeepSeekProvider({ baseUrl: 'http://127.0.0.1:1', ceilingUsd: 1 })).toThrow(
      /without a ledger/,
    );
  });
});
