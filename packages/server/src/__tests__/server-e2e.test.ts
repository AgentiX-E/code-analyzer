// @code-analyzer/server — Server E2E Integration Tests
// Full lifecycle tests: startup → request → graceful shutdown.
// Tests concurrency, rate limiting, error recovery, and health checks.

import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from '../http-server.js';
import type { ServerInstance } from '../http-server.js';
import { ToolRegistry } from '@code-analyzer/mcp';
import { HealthCheckRegistry } from '@code-analyzer/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    'hello',
    'Say hello',
    { type: 'object', properties: { name: { type: 'string' } }, required: [] },
    async (args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: `Hello, ${(args['name'] as string) ?? 'world'}!` }],
    }),
    'all',
  );
  registry.register(
    'slow',
    'Slow operation',
    { type: 'object', properties: {}, required: [] },
    async () => {
      await new Promise((r) => setTimeout(r, 500));
      return { content: [{ type: 'text', text: 'done' }] };
    },
    'analysis',
  );
  return registry;
}

function makeSilentConfig(port = 0) {
  return {
    port,
    logging: { enabled: false, level: 'silent' as const, includeBody: false, pretty: false },
  };
}

// ---------------------------------------------------------------------------
// Full Lifecycle Tests
// ---------------------------------------------------------------------------

describe('Server E2E — Full Lifecycle', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch { /* */ }
      server = null;
    }
  });

  it('should complete full start → request → stop lifecycle', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    // Make multiple requests
    const res1 = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res1.status).toBe(200);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`);
    expect(res2.status).toBe(200);

    const res3 = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'hello' }),
    });
    expect(res3.status).toBe(200);

    await server.stop();
    expect(server.app.server.listening).toBe(false);
  });

  it('should handle health checks via HealthCheckRegistry', async () => {
    const registry = createTestRegistry();
    const healthRegistry = new HealthCheckRegistry({ version: '1.0.0' });
    server = await createServer({
      registry,
      config: makeSilentConfig(),
      healthCheck: healthRegistry,
    });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toMatch(/^(healthy|degraded|unhealthy)$/);
    expect(body.version).toBe('1.0.0');
    expect(Array.isArray(body.checks)).toBe(true);
    expect((body.checks as unknown[]).length).toBeGreaterThanOrEqual(4);
  });

  it('should pass readiness probe when healthy', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`);
    expect(res.status).toBe(200);
  });

  it('should handle liveness probe', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health/live`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('alive');
  });
});

// ---------------------------------------------------------------------------
// Rate Limiting E2E Tests
// ---------------------------------------------------------------------------

describe('Server E2E — Rate Limiting', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch { /* */ }
      server = null;
    }
  });

  it('should enforce rate limits across multiple requests', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        ...makeSilentConfig(),
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 5, addHeaders: true },
      },
    });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    // Send 5 requests (within limit)
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`);
      expect(res.status).toBe(200);
    }

    // 6th request should be rate limited
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`);
    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('TOO_MANY_REQUESTS');
  });

  it('should not rate limit health endpoints', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        ...makeSilentConfig(),
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 1, addHeaders: true },
      },
    });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    // Multiple health requests should always succeed
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrency Tests
// ---------------------------------------------------------------------------

describe('Server E2E — Concurrency', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch { /* */ }
      server = null;
    }
  });

  it('should handle concurrent requests without errors', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    // Send 20 concurrent requests
    const promises = Array.from({ length: 20 }, () =>
      fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'hello' }),
      }).then((r) => r.json()),
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => (r as Record<string, unknown>).success === true);
    expect(successes.length).toBe(20);
  });

  it('should handle slow tool execution under concurrency', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    // Send 5 concurrent slow requests
    const promises = Array.from({ length: 5 }, () =>
      fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'slow' }),
      }).then((r) => r.json()),
    );

    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
    const allDone = results.every((r) => (r as Record<string, unknown>).success === true);
    expect(allDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error Handling Tests
// ---------------------------------------------------------------------------

describe('Server E2E — Error Handling', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch { /* */ }
      server = null;
    }
  });

  it('should return 400 for missing tool field', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent route', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('should return proper error response for invalid JSON body', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Graceful Shutdown Tests
// ---------------------------------------------------------------------------

describe('Server E2E — Graceful Shutdown', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch { /* */ }
      server = null;
    }
  });

  it('should cleanly stop a running server', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();
    expect(server.app.server.listening).toBe(true);

    await server.stop();
    expect(server.app.server.listening).toBe(false);
  });

  it('should have GracefulShutdown instance accessible', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });

    expect(server.shutdown).toBeDefined();
    expect(typeof server.shutdown.register).toBe('function');
    expect(typeof server.shutdown.listen).toBe('function');
    expect(typeof server.shutdown.shutdown).toBe('function');
  });

  it('should track active connections', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    expect(server.activeConnections).toBe(0);

    // Make a request — connection count increases then decreases
    await fetch(`http://127.0.0.1:${port}/health`);
    // After response, active connections should go back to 0
    // (small delay for the hook to fire)
    await new Promise((r) => setTimeout(r, 50));
    expect(server.activeConnections).toBe(0);
  });

  it('should handle stop on already-stopped server gracefully', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });
    await server.start();
    await server.stop();

    // Second stop should not throw
    await expect(server.stop()).resolves.not.toThrow();
  });

  it('should expose health check registry', async () => {
    const registry = createTestRegistry();
    server = await createServer({ registry, config: makeSilentConfig() });

    expect(server.health).toBeDefined();
    const health = await server.health.runAll();
    expect(health.status).toMatch(/^(healthy|degraded|unhealthy)$/);
    expect(Array.isArray(health.checks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Auth + MaxConnections Integration
// ---------------------------------------------------------------------------

describe('Server E2E — Auth Integration', () => {
  let server: ServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch { /* */ }
      server = null;
    }
  });

  it('should reject requests without API key when auth enabled', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        ...makeSilentConfig(),
        auth: { enabled: true, apiKeys: ['secret'] },
      },
    });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/tools/list`);
    expect(res.status).toBe(401);
  });

  it('should allow health endpoint without auth', async () => {
    const registry = createTestRegistry();
    server = await createServer({
      registry,
      config: {
        ...makeSilentConfig(),
        auth: { enabled: true, apiKeys: ['secret'] },
      },
    });
    await server.start();

    const addr = server.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });
});
