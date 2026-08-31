// @code-analyzer/mcp — MCP Server Health Endpoint Tests
// Verifies the /health endpoint responds 200 on both HTTP and SSE transports.
// The Docker HEALTHCHECK (`wget --spider .../health`) and the CI smoke test
// (`curl .../health`) depend on this endpoint — a missing handler makes those
// probes hang and report an empty status.

import { afterEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';

function getHealth(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// `listen(port, …)` binds the port asynchronously, so poll until the server
// reports a concrete address (address() returns null until the bind completes).
async function waitForAddress(server: CodeAnalyzerMCPServer): Promise<AddressInfo> {
  const httpServer = (server as unknown as { httpServer: http.Server }).httpServer;
  for (let i = 0; i < 100; i++) {
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') return addr as AddressInfo;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('server did not bind a port in time');
}

describe('CodeAnalyzerMCPServer /health endpoint', () => {
  let server: CodeAnalyzerMCPServer | undefined;

  afterEach(async () => {
    try {
      await server?.shutdown();
    } catch {
      // Ignore teardown errors
    }
  });

  it('responds 200 on /health over SSE transport', async () => {
    server = new CodeAnalyzerMCPServer();
    await server.start({ transport: 'sse', port: 0 });
    const addr = await waitForAddress(server);

    const res = await getHealth(addr.port, '/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', transport: 'sse' });
  });

  it('responds 200 on /healthz over SSE transport', async () => {
    server = new CodeAnalyzerMCPServer();
    await server.start({ transport: 'sse', port: 0 });
    const addr = await waitForAddress(server);

    const res = await getHealth(addr.port, '/healthz');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok' });
  });

  it('responds 200 on /health over HTTP transport', async () => {
    server = new CodeAnalyzerMCPServer();
    await server.start({ transport: 'http', port: 0 });
    const addr = await waitForAddress(server);

    const res = await getHealth(addr.port, '/health');
    expect(res.status).toBe(200);
  });
});
