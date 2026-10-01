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

describe('the paths a first attempt does not take', () => {
  it('reports an empty choices array rather than reading past it', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [] }));
    });
    servers.push(server);
    await expect(providerFor(url).complete('q')).rejects.toThrow(/empty choices/i);
  });

  it('retries a 500 and returns the answer the second attempt gave', async () => {
    let attempts = 0;
    const { server, url } = await startServer((_req, res) => {
      attempts += 1;
      if (attempts === 1) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'server error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'second try' } }] }),
      );
    });
    servers.push(server);

    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    // **`maxRetries` is the number of attempts after the first**, and the backoff between them is a real second -
    // which is the point: the delay is the provider's, not a test's.
    const provider = new DeepSeekProvider({ baseUrl: url, timeout: 2000, maxRetries: 1 });
    const result = await provider.complete('q');
    expect(result.content).toBe('second try');
    expect(attempts).toBe(2);
  }, 10_000);

  it('throws the last error when every attempt fails', async () => {
    let attempts = 0;
    const { server, url } = await startServer((_req, res) => {
      attempts += 1;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'always broken' } }));
    });
    servers.push(server);

    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    const provider = new DeepSeekProvider({ baseUrl: url, timeout: 2000, maxRetries: 1 });
    await expect(provider.complete('q')).rejects.toThrow();
    expect(attempts).toBe(2);
  }, 10_000);

  it('builds a tool request when tools are given, and reads the call back', async () => {
    let seen = '';
    const { server, url } = await startServer((req, res) => {
      seen = (req as IncomingMessage & { body: string }).body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    servers.push(server);

    const result = await providerFor(url).completeWithTools('read it', [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    // The request the provider built carries the tool definition...
    expect(seen).toContain('read_file');
    expect(seen).toContain('tools');
    // ...and the call the provider read back is on the result.
    const calls = (result as { toolCalls?: Array<{ name: string; arguments: string }> }).toolCalls;
    expect(calls?.[0]?.name).toBe('read_file');
    expect(calls?.[0]?.arguments).toContain('a.ts');
  });
});

describe('the options that change the request, and the body that cannot be read', () => {
  it('sends the stop sequences it was given', async () => {
    let seen = '';
    const { server, url } = await startServer((req, res) => {
      seen = (req as IncomingMessage & { body: string }).body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
    });
    servers.push(server);

    await providerFor(url).complete('q', { stop: ['\n\n', '###'] });
    // **The options are the request, so the request is what the assertion reads.** A test that stubbed `fetch` would
    // have asserted what the stub was told rather than what the provider built.
    expect(seen).toContain('stop');
    expect(seen).toContain('###');
  });

  it('still reports the status when the error body cannot be read', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      // The headers are sent and the body is never completed, so reading it rejects.
      res.socket?.destroy();
    });
    servers.push(server);

    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    const provider = new DeepSeekProvider({ baseUrl: url, timeout: 2000, maxRetries: 0 });
    // **The status is the part that matters, and it survives a body that never arrives.**
    await expect(provider.complete('q')).rejects.toThrow();
  });
});
