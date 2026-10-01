// The DeepSeek provider, exercised against a real HTTP server on a loopback port.
//
// **It has been at 0% since it was written**, and the exclusion that hid it said "pure interface definitions (no
// executable code)" - which was true of a different file with the same name. The number is 299 uncovered lines, and
// this is what moves it.
//
// No mocks: the provider takes a `baseUrl`, so the tests start a server and answer with what a provider would. The
// refusal cases are the interesting ones - an auth failure, a rate limit and a timeout are three of its four error
// classes, and a test that stubs `fetch` cannot show that the code reads the status it claims to read.

import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { DeepSeekProvider, LLMAuthError, LLMRateLimitError, LLMTimeoutError } from '../provider.js';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A server that answers every request with whichever reply the calling test set. */
function startServer(
  reply: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        (req as IncomingMessage & { body: string }).body = body;
        reply(req, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

let servers: Server[] = [];

afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
  delete process.env['DEEPSEEK_API_KEY'];
});

function providerFor(url: string, timeout = 2000): DeepSeekProvider {
  process.env['DEEPSEEK_API_KEY'] = 'test-key';
  return new DeepSeekProvider({ baseUrl: url, timeout, maxRetries: 0 });
}

describe('the DeepSeek provider, against a server', () => {
  it('returns the completion and sends the prompt it was given', async () => {
    let seen = '';
    const { server, url } = await startServer((req, res) => {
      seen = (req as IncomingMessage & { body: string }).body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            { message: { role: 'assistant', content: 'the answer' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          model: 'deepseek-chat',
        }),
      );
    });
    servers.push(server);

    const result = await providerFor(url).complete('the question');
    expect(result.content).toBe('the answer');
    expect(result.usage?.totalTokens).toBe(5);
    // The request the provider built, not the one a stub was told to expect.
    expect(seen).toContain('the question');
    expect(seen).toContain('deepseek');
  });

  it('maps a 401 onto the auth error', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid key' } }));
    });
    servers.push(server);
    await expect(providerFor(url).complete('q')).rejects.toBeInstanceOf(LLMAuthError);
  });

  it('maps a 429 onto the rate limit error, and carries the retry-after it was sent', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' });
      res.end(JSON.stringify({ error: { message: 'slow down' } }));
    });
    servers.push(server);
    const error = await providerFor(url)
      .complete('q')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMRateLimitError);
    expect((error as LLMRateLimitError).retryAfter).toBe('7');
  });

  it('times out against a server that never answers', async () => {
    const { server, url } = await startServer(() => {
      // Deliberately nothing: the request is ended by the timeout, not by the server.
    });
    servers.push(server);
    await expect(providerFor(url, 150).complete('q')).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it('reports itself healthy when the endpoint answers', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
    });
    servers.push(server);
    expect(await providerFor(url).healthCheck()).toBe(true);
  });

  it('refuses to be constructed without a key', () => {
    delete process.env['DEEPSEEK_API_KEY'];
    expect(() => new DeepSeekProvider()).toThrow(LLMAuthError);
  });
});
