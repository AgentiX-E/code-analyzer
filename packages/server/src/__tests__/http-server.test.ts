// @code-analyzer/server — HTTP Server Integration Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { createServer } from '../http-server.js';
import type { ServerInstance } from '../http-server.js';
import { ToolRegistry } from '@code-analyzer/mcp';
import { resolveConfig } from '../server-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let toolCallCount = 0;
let lastToolArgs: Record<string, unknown> = {};

function createTestRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  toolCallCount = 0;
  lastToolArgs = {};

  registry.register(
    'hello',
    'Say hello',
    { type: 'object', properties: { name: { type: 'string' } }, required: [] },
    async (args: Record<string, unknown>) => {
      toolCallCount++;
      lastToolArgs = args;
      return {
        content: [{ type: 'text', text: `Hello, ${(args['name'] as string) ?? 'world'}!` }],
      };
    },
    'all',
  );

  registry.register(
    'echo',
    'Echo back the input',
    { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    async (args: Record<string, unknown>) => {
      toolCallCount++;
      lastToolArgs = args;
      return {
        content: [{ type: 'text', text: `Echo: ${args['message']}` }],
      };
    },
    'analysis',
  );

  registry.register(
    'failing',
    'Always fails',
    { type: 'object', properties: {}, required: [] },
    async () => {
      throw new Error('Intentional tool failure');
    },
    'analysis',
  );

  registry.register(
    'store_tool',
    'Accesses the store',
    { type: 'object', properties: {}, required: [] },
    async (_args: Record<string, unknown>, store?: unknown) => {
      const hasStore = store !== undefined;
      return {
        content: [{ type: 'text', text: JSON.stringify({ hasStore }) }],
      };
    },
    'analysis',
  );

  return registry;
}

// ---------------------------------------------------------------------------
// createServer Tests
// ---------------------------------------------------------------------------

describe('createServer', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should create a server with default config', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry });

    expect(server.app).toBeDefined();
    expect(server.config.port).toBe(3000);
    expect(server.config.apiPrefix).toBe('/api/v1');
  });

  it('should create a server with custom config', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        port: 9999,
        auth: { enabled: true, apiKeys: ['test-key'] },
        metadata: { name: 'custom', version: '9.9.9', environment: 'staging' },
      },
    });

    expect(server.config.port).toBe(9999);
    expect(server.config.auth.enabled).toBe(true);
    expect(server.config.metadata.name).toBe('custom');
  });

  it('should start and respond to health check', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();

    // Get the actual port the server is listening on
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    // Make a request to the running server
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toMatch(/^(ok|degraded)$/);
    expect(body.name).toBe('code-analyzer');
  });

  it('should serve tool list', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.total).toBe(4);
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it('should call tools via REST API', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'hello', args: { name: 'CodeBuddy' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  it('should return 404 for unknown tool via REST', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'ghost_tool' }),
    });
    expect(res.status).toBe(404);
  });

  it('should register custom plugins', async () => {
    const registry = createTestRegistry();
    let pluginRegistered = false;

    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
      plugins: [{
        plugin: async (app: FastifyInstance) => {
          pluginRegistered = true;
          app.get('/custom-plugin', async (_req, reply) => reply.send({ plugin: 'ok' }));
        },
      }],
    });

    await server.start();
    expect(pluginRegistered).toBe(true);

    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/custom-plugin`);
    expect(res.status).toBe(200);
  });

  it('should handle SSE event posting', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/sse/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'hello' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.processed).toBe(true);
    expect(body.broadcastTo).toBeDefined();
  });

  it('should return SSE connections info', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/sse/connections`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.activeConnections).toBe('number');
  });

  it('should handle CORS preflight', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        port: 0,
        logging: { enabled: false, level: 'silent', includeBody: false, pretty: false },
        cors: { ...resolveConfig().cors },
      },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
  });

  it('should handle graceful shutdown', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    await server.stop();

    // After stop, the server should be closed
    expect(server.app.server.listening).toBe(false);
  });

  it('should expose all server config in instance', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: { port: 4567 },
    });

    expect(server.config.port).toBe(4567);
    expect(server.config.host).toBe('0.0.0.0');
    expect(server.config.apiPrefix).toBe('/api/v1');
    expect(server.config.sseHeartbeatMs).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// API Key Auth Integration Tests
// ---------------------------------------------------------------------------

describe('createServer with auth', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should reject unauthenticated requests when auth is enabled', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        port: 0,
        auth: { enabled: true, apiKeys: ['secret'] },
        logging: { enabled: false, level: 'silent', includeBody: false, pretty: false },
      },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`);
    expect(res.status).toBe(401);
  });

  it('should allow authenticated requests via x-api-key header', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        port: 0,
        auth: { enabled: true, apiKeys: ['my-secret-key'] },
        logging: { enabled: false, level: 'silent', includeBody: false, pretty: false },
      },
    });

    await server.start();
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`, {
      headers: { 'x-api-key': 'my-secret-key' },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// External Server Instance
// ---------------------------------------------------------------------------

describe('ServerInstance external API', () => {
  it('should export createServer function from index', async () => {
    // Test that the module exports are correct
    const mod = await import('../index.js');
    expect(typeof mod.createServer).toBe('function');
    expect(typeof mod.resolveConfig).toBe('function');
    expect(mod.DEFAULT_CONFIG).toBeDefined();
  });
});
