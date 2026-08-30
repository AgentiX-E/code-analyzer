// @ts-nocheck
// @code-analyzer/mcp — MCP server transport non-Error fallback coverage
//
// The `error instanceof Error ? error.message : String(error)` ternaries in
// startHTTP / startSSE have a defensive `String(error)` arm for a non-Error
// throw from the HTTP stack. That arm is only reachable when `http.createServer`
// throws a non-Error value, which we force here by mocking the `http` module.
// (Kept in its own file because `vi.mock('http')` is file-scoped and would break
// the real-server happy-path tests elsewhere.)

import { describe, it, vi } from 'vitest';

import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';

vi.mock('http', () => ({
  createServer: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw 'non-error createServer';
  },
}));

describe('CodeAnalyzerMCPServer transport non-Error fallback', () => {
  it('falls back to stdio when HTTP setup throws a non-Error', async () => {
    const mcp = new CodeAnalyzerMCPServer();
    await mcp.startHTTP(0);
    await mcp.shutdown();
  });

  it('falls back to stdio when SSE setup throws a non-Error', async () => {
    const mcp = new CodeAnalyzerMCPServer();
    await mcp.startSSE(0);
    await mcp.shutdown();
  });
});
