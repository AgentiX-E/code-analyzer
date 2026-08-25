// @ts-nocheck
// @code-analyzer/mcp — MCP server CallTool middleware branch coverage: the
// auth-denied, rate-limited, and non-Error-throw paths that the happy-path
// handler tests do not exercise.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';

async function connectClient(config?: ConstructorParameters<typeof CodeAnalyzerMCPServer>[0]) {
  const mcp = new CodeAnalyzerMCPServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.getServer().connect(serverTransport);
  const client = new Client({ name: 'vitest', version: '1.0.0' });
  await client.connect(clientTransport);
  return { mcp, client };
}

describe('CodeAnalyzerMCPServer CallTool middleware', () => {
  let mcp: CodeAnalyzerMCPServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore teardown errors
    }
    try {
      await mcp?.shutdown();
    } catch {
      // Ignore teardown errors
    }
  });

  it('rejects a tool call when auth denies with a message', async () => {
    ({ mcp, client } = await connectClient());
    (mcp as any).auth = { validate: () => ({ allowed: false, message: 'Missing API key' }) };

    const result = await client.callTool({ name: 'search_graph', arguments: { query: 'x' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Missing API key');
  });

  it('falls back to a generic message when auth denies without one', async () => {
    ({ mcp, client } = await connectClient());
    (mcp as any).auth = { validate: () => ({ allowed: false }) };

    const result = await client.callTool({ name: 'search_graph', arguments: { query: 'x' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Unauthorized');
  });

  it('rejects a tool call when the rate limiter denies', async () => {
    ({ mcp, client } = await connectClient());
    (mcp as any).rateLimiter = {
      check: () => ({ allowed: false, message: 'Too many requests', retryAfterMs: 5000 }),
    };

    const result = await client.callTool({ name: 'search_graph', arguments: { query: 'x' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Rate limited');
    expect(JSON.stringify(result.content)).toContain('5000');
  });

  it('wraps a non-Error throw from a tool into an internal error', async () => {
    ({ mcp, client } = await connectClient());
    (mcp as any).registry.execute = async () => {
      throw 'plain string failure';
    };

    const result = await client.callTool({ name: 'search_graph', arguments: { query: 'x' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('plain string failure');
  });
});
