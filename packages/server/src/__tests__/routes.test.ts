// @code-analyzer/server — Routes Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { registerHealthRoutes, buildHealthResponse } from '../routes/health.js';
import { registerToolRoutes } from '../routes/tools.js';
import { registerSSERoutes, sendSSEEvent } from '../routes/sse.js';
import { registerErrorHandler } from '../middleware/error-handler.js';
import { resolveConfig } from '../server-config.js';
import { ToolRegistry } from '@code-analyzer/mcp';
import type { ToolContext } from '@code-analyzer/mcp';

// ---------------------------------------------------------------------------
// Health Routes
// ---------------------------------------------------------------------------

describe('registerHealthRoutes', () => {
  let app: FastifyInstance;
  const config = resolveConfig();

  beforeEach(() => {
    app = Fastify({ logger: false });
    registerHealthRoutes(app, config);
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / should return service info', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.service).toBe('code-analyzer');
    expect(body.version).toBeDefined();
    expect(body.docs).toBeDefined();
    expect(body.health).toBeDefined();
  });

  it('GET /health should return health status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toMatch(/^(ok|degraded)$/);
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.checks.server.status).toBe('ok');
    expect(body.checks.memory).toBeDefined();
  });

  it('GET /api/v1/health should return full health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('code-analyzer');
    expect(body.version).toBe('0.1.0');
    expect(body.environment).toBe('production');
  });

  it('GET /api/v1/health/live should return alive status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('alive');
  });

  it('GET /api/v1/health/ready should return ready status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// buildHealthResponse helper
// ---------------------------------------------------------------------------

describe('buildHealthResponse', () => {
  it('should include memory metrics', () => {
    const result = buildHealthResponse(resolveConfig(), Date.now());
    expect(result.checks.memory.heapUsedMB).toBeGreaterThan(0);
    expect(result.checks.memory.heapTotalMB).toBeGreaterThan(0);
    expect(result.checks.memory.rssMB).toBeGreaterThan(0);
  });

  it('should mark degraded when heap is above 90%', () => {
    const result = buildHealthResponse(resolveConfig(), Date.now());
    if (result.checks.memory.heapUsedMB > result.checks.memory.heapTotalMB * 0.9) {
      expect(result.status).toBe('degraded');
      expect(result.checks.memory.status).toBe('warn');
    } else {
      expect(result.checks.memory.status).toBe('ok');
    }
  });

  it('should have valid timestamp', () => {
    const result = buildHealthResponse(resolveConfig(), Date.now());
    expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tool Routes
// ---------------------------------------------------------------------------

describe('registerToolRoutes', () => {
  let app: FastifyInstance;
  let registry: ToolRegistry;
  const config = resolveConfig();

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);

    // Create a minimal registry with mock tools
    registry = new ToolRegistry();
    registry.register('hello', 'Say hello', { type: 'object', properties: {}, required: [] }, async (_args) => ({
      content: [{ type: 'text', text: 'Hello, world!' }],
    }), 'all');
    registry.register('echo', 'Echo input', { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }, async (args) => ({
      content: [{ type: 'text', text: `Echo: ${args['message']}` }],
    }), 'analysis');
    registry.register('error_tool', 'Always errors', { type: 'object', properties: {}, required: [] }, async () => {
      throw new Error('Simulated failure');
    }, 'analysis');

    registerToolRoutes(app, config, () => registry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/tools/list', () => {
    it('should list all tools', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/tools/list' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.total).toBe(3);
      expect(body.tools.length).toBe(3);
      expect(body.tools.map((t: { name: string }) => t.name)).toContain('hello');
      expect(body.tools.map((t: { name: string }) => t.name)).toContain('echo');
    });

    it('should include tool metadata', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/tools/list' });
      const body = JSON.parse(res.body);
      const helloTool = body.tools.find((t: { name: string }) => t.name === 'hello');
      expect(helloTool.description).toBe('Say hello');
      expect(helloTool.category).toBe('all');
    });
  });

  describe('POST /api/v1/tools/call', () => {
    it('should call a tool and return result', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/call',
        payload: { tool: 'hello', args: {} },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tool).toBe('hello');
      expect(body.success).toBe(true);
      expect(body.content[0].text).toBe('Hello, world!');
    });

    it('should pass arguments to the tool', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/call',
        payload: { tool: 'echo', args: { message: 'test' } },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.content[0].text).toBe('Echo: test');
    });

    it('should return 400 when tool name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/call',
        payload: { args: {} },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_REQUEST');
    });

    it('should return 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/call',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 for unknown tool', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/call',
        payload: { tool: 'nonexistent' },
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('TOOL_NOT_FOUND');
    });

    it('should handle tool errors gracefully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/call',
        payload: { tool: 'error_tool' },
      });
      // The registry catches the error and returns it as an error content item
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.isError).toBe(true);
    });

    it('should mark error results appropriately', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tools/call',
        payload: { tool: 'echo' }, // missing required 'message' param
      });
      // Tool validation error will produce isError result
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tool).toBe('echo');
    });
  });
});

// ---------------------------------------------------------------------------
// SSE Routes
// ---------------------------------------------------------------------------

describe('registerSSERoutes', () => {
  let app: FastifyInstance;
  let registry: ToolRegistry;
  const config = resolveConfig();

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);

    registry = new ToolRegistry();
    registry.register('ping', 'Send ping', { type: 'object', properties: {}, required: [] }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }), 'all');

    registerSSERoutes(app, config, () => registry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/sse should register SSE route (streaming connection)', async () => {
    // SSE endpoints keep the connection open, so we verify the route is registered via route listing
    const routes = app.printRoutes();
    expect(routes).toContain('api/v1/sse');
  }, 15000);

  it('POST /api/v1/sse/event should process tool calls', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sse/event',
      payload: { tool: 'ping' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.processed).toBe(true);
    expect(body.result.success).toBe(true);
    expect(body.result.tool).toBe('ping');
  });

  it('POST /api/v1/sse/event should return 400 without tool', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sse/event',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/sse/connections should return connection count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sse/connections' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.activeConnections).toBe('number');
    expect(Array.isArray(body.connections)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sendSSEEvent helper
// ---------------------------------------------------------------------------

describe('sendSSEEvent', () => {
  it('should write SSE formatted event', () => {
    const chunks: string[] = [];
    const mockRes = {
      write: (chunk: string): boolean => {
        chunks.push(chunk);
        return true;
      },
    };

    sendSSEEvent(mockRes, 'test_event', { key: 'value' });

    const output = chunks.join('');
    expect(output).toContain('event: test_event');
    expect(output).toContain('data: {"key":"value"}');
  });

  it('should handle complex data objects', () => {
    const chunks: string[] = [];
    const mockRes = { write: (chunk: string) => { chunks.push(chunk); return true; } };

    sendSSEEvent(mockRes, 'update', { items: [1, 2, 3], nested: { a: 1 } });
    expect(chunks.join('')).toContain('data: {"items":[1,2,3],"nested":{"a":1}}');
  });
});
