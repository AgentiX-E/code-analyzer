// @code-analyzer/mcp — MCP Server Request Handler Tests
// Drives the registered MCP request handlers end-to-end through an in-memory
// client<->server transport, covering the CallTool auth/rate-limit/execute/
// error paths and the resource/prompt handlers that unit tests bypassed.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';

interface Connected {
  mcp: CodeAnalyzerMCPServer;
  client: Client;
}

async function connectClient(
  config?: ConstructorParameters<typeof CodeAnalyzerMCPServer>[0],
): Promise<Connected> {
  const mcp = new CodeAnalyzerMCPServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.getServer().connect(serverTransport);
  const client = new Client({ name: 'vitest', version: '1.0.0' });
  await client.connect(clientTransport);
  return { mcp, client };
}

describe('CodeAnalyzerMCPServer request handlers', () => {
  let conn: Connected | undefined;

  afterEach(async () => {
    try {
      await conn?.client.close();
    } catch {
      // Ignore teardown errors
    }
    try {
      await conn?.mcp.shutdown();
    } catch {
      // Ignore teardown errors
    }
  });

  it('lists tools via the ListTools handler', async () => {
    conn = await connectClient();
    const { tools } = await conn.client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('description');
    expect(tools[0]).toHaveProperty('inputSchema');
  });

  it('executes a tool via the CallTool handler', async () => {
    conn = await connectClient();
    const result = await conn.client.callTool({
      name: 'search_graph',
      arguments: { query: 'getUser' },
    });
    expect(result).toBeDefined();
  });

  it('returns an error for an unknown tool through the CallTool handler', async () => {
    conn = await connectClient();
    const result = await conn.client.callTool({
      name: 'made_up_tool_xyz',
      arguments: {},
    });
    // The registry returns an isError result (rather than throwing), which the
    // handler propagates verbatim.
    expect(result.isError).toBe(true);
  });

  it('handles a tool call with no arguments', async () => {
    conn = await connectClient();
    const result = await conn.client.callTool({ name: 'list_projects' } as never);
    expect(result).toBeDefined();
  });

  it('lists resources via the ListResources handler', async () => {
    conn = await connectClient();
    const { resources } = await conn.client.listResources();
    expect(resources.length).toBeGreaterThan(0);
    expect(resources[0]).toHaveProperty('uri');
    expect(resources[0]).toHaveProperty('name');
    expect(resources[0]).toHaveProperty('mimeType');
  });

  it('reads a resource via the ReadResource handler', async () => {
    conn = await connectClient();
    const { resources } = await conn.client.listResources();
    const first = resources.find((r) => r.uri.includes('stats'));
    expect(first).toBeDefined();
    const result = await conn.client.readResource({ uri: first!.uri });
    expect(result.contents.length).toBeGreaterThan(0);
  });

  it('throws for an unknown resource through the ReadResource handler', async () => {
    conn = await connectClient();
    await expect(
      conn.client.readResource({ uri: 'code-analyzer://does-not-exist' }),
    ).rejects.toThrow();
  });

  it('lists prompts via the ListPrompts handler', async () => {
    conn = await connectClient();
    const { prompts } = await conn.client.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).toHaveProperty('name');
    expect(prompts[0]).toHaveProperty('description');
  });

  it('gets a prompt via the GetPrompt handler', async () => {
    conn = await connectClient();
    const { prompts } = await conn.client.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    const result = await conn.client.getPrompt({ name: prompts[0]!.name, arguments: {} });
    expect(result.messages).toBeDefined();
  });

  it('does not register resource handlers when enableResources is false', async () => {
    conn = await connectClient({ enableResources: false });
    await expect(conn.client.listResources()).rejects.toThrow();
  });

  it('does not register prompt handlers when enablePrompts is false', async () => {
    conn = await connectClient({ enablePrompts: false });
    await expect(conn.client.listPrompts()).rejects.toThrow();
  });
});
