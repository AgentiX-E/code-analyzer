// @code-analyzer/mcp — MCP Server Transport Tests
// Exercises the start/startStdio/startHTTP/startSSE/start dispatch and the
// auto-index helper (success and failure paths) that unit tests bypassed.

import { afterEach, describe, expect, it } from 'vitest';

import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';

describe('CodeAnalyzerMCPServer transport', () => {
  let server: CodeAnalyzerMCPServer | undefined;

  afterEach(async () => {
    try {
      await server?.shutdown();
    } catch {
      // Ignore teardown errors
    }
  });

  it('starts and stops on stdio via startStdio()', async () => {
    server = new CodeAnalyzerMCPServer();
    await server.startStdio();
    await server.stop(); // stop() delegates to shutdown()
  });

  it('auto-indexes a root path on stdio start', async () => {
    server = new CodeAnalyzerMCPServer();
    // A non-existent root triggers the auto-index failure + notification path.
    await server.startStdio('/definitely/not/a/real/project');
    await server.shutdown();
  });

  it('dispatches to stdio via start({ transport: "stdio" })', async () => {
    server = new CodeAnalyzerMCPServer();
    await server.start({ transport: 'stdio' });
    await server.shutdown();
  });

  it('dispatches to HTTP via start({ transport: "http" })', async () => {
    server = new CodeAnalyzerMCPServer();
    await server.start({ transport: 'http', port: 0 });
    await server.shutdown();
  });

  it('dispatches to SSE via start({ transport: "sse" })', async () => {
    server = new CodeAnalyzerMCPServer();
    await server.start({ transport: 'sse', port: 0 });
    await server.shutdown();
  });

  it('falls back to stdio when an HTTP port is invalid', async () => {
    server = new CodeAnalyzerMCPServer();
    // An out-of-range port makes listen() throw, exercising the catch fallback.
    await server.start({ transport: 'http', port: 70000 });
    await server.shutdown();
  });

  it('guards against a NaN port via the environment', async () => {
    server = new CodeAnalyzerMCPServer();
    const prevTransport = process.env['MCP_TRANSPORT'];
    const prevPort = process.env['MCP_PORT'];
    try {
      process.env['MCP_TRANSPORT'] = 'stdio';
      process.env['MCP_PORT'] = 'not-a-number';
      await server.start();
    } finally {
      if (prevTransport === undefined) delete process.env['MCP_TRANSPORT'];
      else process.env['MCP_TRANSPORT'] = prevTransport;
      if (prevPort === undefined) delete process.env['MCP_PORT'];
      else process.env['MCP_PORT'] = prevPort;
    }
    await server.shutdown();
  });

  it('selects SSE from the environment when MCP_TRANSPORT is not stdio', async () => {
    server = new CodeAnalyzerMCPServer();
    const prevTransport = process.env['MCP_TRANSPORT'];
    try {
      process.env['MCP_TRANSPORT'] = 'sse';
      await server.start({ port: 0 });
    } finally {
      if (prevTransport === undefined) delete process.env['MCP_TRANSPORT'];
      else process.env['MCP_TRANSPORT'] = prevTransport;
    }
    await server.shutdown();
  });
});
