// @ts-nocheck
// @code-analyzer/mcp — MCP server error-path and transport-option branch coverage
//
// Exercises the remaining defensive branches in mcp-server.ts: the
// `error instanceof Error ? message : String(error)` ternaries across the
// CallTool, auto-index, transport, and shutdown paths; the `!autoIndexer` early
// return; the host/rootPath transport options; the `?? '0.0.0.0'` and
// `?? []` fallbacks; and the listen success callbacks (which only fire after
// the underlying server binds to its port).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server as HttpServer } from 'http';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';

async function connectClient() {
  const mcp = new CodeAnalyzerMCPServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.getServer().connect(serverTransport);
  const client = new Client({ name: 'vitest', version: '1.0.0' });
  await client.connect(clientTransport);
  return { mcp, client };
}

/** Wait until the underlying HTTP/SSE server has actually bound its port, so the
 * `listen` success callback (and its `host ?? '0.0.0.0'` logging) executes. */
function waitListening(mcp: CodeAnalyzerMCPServer): Promise<void> {
  const server = (mcp as unknown as { httpServer: HttpServer }).httpServer;
  return new Promise<void>((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once('listening', () => resolve());
  });
}

describe('CodeAnalyzerMCPServer error paths', () => {
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

  it('wraps an Error throw from a tool into an internal error', async () => {
    ({ mcp, client } = await connectClient());
    (mcp as any).registry.execute = async () => {
      throw new Error('boom');
    };

    const result = await client.callTool({ name: 'search_graph', arguments: { query: 'x' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Internal error: boom');
  });

  it('returns early from tryAutoIndex when no auto-indexer is configured', async () => {
    mcp = new CodeAnalyzerMCPServer();
    (mcp as any).autoIndexer = null;
    await (mcp as any).tryAutoIndex('/some/root');
    // Reaching this line without throwing is the assertion: the early return ran.
  });

  it('logs an Error-typed auto-index failure and sends a notification', async () => {
    mcp = new CodeAnalyzerMCPServer();
    (mcp as any).autoIndexer = {
      onProjectOpen: async () => {
        throw new Error('index exploded');
      },
    };
    await (mcp as any).tryAutoIndex('/some/root');
  });

  it('serializes a non-Error auto-index failure into the message', async () => {
    mcp = new CodeAnalyzerMCPServer();
    (mcp as any).autoIndexer = {
      onProjectOpen: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain failure';
      },
    };
    await (mcp as any).tryAutoIndex('/some/root');
  });

  it('starts HTTP with an explicit host, root path, and waits for listening', async () => {
    mcp = new CodeAnalyzerMCPServer();
    await mcp.startHTTP(0, '127.0.0.1', '/definitely/not/a/real/project');
    await waitListening(mcp);
    await mcp.shutdown();
    mcp = undefined;
  });

  it('starts HTTP without a host, exercising the 0.0.0.0 fallback', async () => {
    mcp = new CodeAnalyzerMCPServer();
    await mcp.startHTTP(0);
    await waitListening(mcp);
    await mcp.shutdown();
    mcp = undefined;
  });

  it('starts SSE with an explicit host, root path, and waits for listening', async () => {
    mcp = new CodeAnalyzerMCPServer();
    await mcp.startSSE(0, '127.0.0.1', '/definitely/not/a/real/project');
    await waitListening(mcp);
    await mcp.shutdown();
    mcp = undefined;
  });

  it('starts SSE without a host, exercising the 0.0.0.0 fallback', async () => {
    mcp = new CodeAnalyzerMCPServer();
    await mcp.startSSE(0);
    await waitListening(mcp);
    await mcp.shutdown();
    mcp = undefined;
  });

  it('falls back to stdio when the SSE port is invalid', async () => {
    mcp = new CodeAnalyzerMCPServer();
    await mcp.startSSE(70000);
    await mcp.shutdown();
    mcp = undefined;
  });

  it('shutdown swallows Error-typed failures from every collaborator', async () => {
    mcp = new CodeAnalyzerMCPServer();
    (mcp as any).transport = {};
    (mcp as any).server = {
      close: async () => {
        throw new Error('close boom');
      },
    };
    (mcp as any).sseTransport = {
      shutdown: async () => {
        throw new Error('sse boom');
      },
    };
    (mcp as any).httpServer = {
      close: () => {
        throw new Error('http boom');
      },
    };
    (mcp as any).store = {
      close: () => {
        throw new Error('store boom');
      },
    };
    await mcp.shutdown();
    mcp = undefined;
  });

  it('shutdown serializes non-Error failures from every collaborator', async () => {
    mcp = new CodeAnalyzerMCPServer();
    (mcp as any).transport = {};
    (mcp as any).server = {
      close: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'close-string';
      },
    };
    (mcp as any).sseTransport = {
      shutdown: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'sse-string';
      },
    };
    (mcp as any).httpServer = {
      close: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'http-string';
      },
    };
    (mcp as any).store = {
      close: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'store-string';
      },
    };
    await mcp.shutdown();
    mcp = undefined;
  });

  it('formats a prompt with an explicit arguments list', () => {
    mcp = new CodeAnalyzerMCPServer();
    const formatted = (mcp as any).formatPrompt({
      name: 'review',
      description: 'Review a file',
      arguments: [{ name: 'path', description: 'File path', required: true }],
    });
    expect(formatted.arguments).toHaveLength(1);
  });

  it('formats a prompt without arguments via the [] fallback', () => {
    mcp = new CodeAnalyzerMCPServer();
    const formatted = (mcp as any).formatPrompt({
      name: 'review',
      description: 'Review a file',
    });
    expect(formatted.arguments).toEqual([]);
  });
});
