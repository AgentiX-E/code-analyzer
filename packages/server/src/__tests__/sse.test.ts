// @code-analyzer/server — SSE Routes Tests

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { registerSSERoutes, sendSSEEvent } from '../routes/sse.js';
import { resolveConfig, type ServerConfig } from '../server-config.js';
import { ToolRegistry } from '@code-analyzer/mcp';

// ---------------------------------------------------------------------------
// Fakes (Fastify is a third-party dependency — a controlled test double gives
// precise access to every branch, including the long-lived SSE stream).
// ---------------------------------------------------------------------------

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => unknown;

interface RawResponse {
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  chunks: string[];
  /** Make every subsequent `write` throw, simulating a dead socket. */
  failWrites(): void;
}

function makeRawResponse(): RawResponse {
  const chunks: string[] = [];
  let failing = false;
  return {
    writeHead: vi.fn(),
    write: vi.fn((chunk: string): boolean => {
      if (failing) {
        throw new Error('stream closed');
      }
      chunks.push(chunk);
      return true;
    }),
    chunks,
    failWrites: () => {
      failing = true;
    },
  };
}

interface FakeReply {
  raw: RawResponse;
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeReply(raw: RawResponse = makeRawResponse()): FakeReply {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  return { raw, status, send };
}

interface FakeRequest {
  id: string;
  body: unknown;
  raw: EventEmitter;
}

function makeRequest(id = 'req-1', body?: unknown): FakeRequest {
  return { id, body, raw: new EventEmitter() };
}

interface Harness {
  registry: ToolRegistry;
  getSse: RouteHandler;
  postEvent: RouteHandler;
  getConnections: RouteHandler;
}

function makeHarness(config: ServerConfig = resolveConfig()): Harness {
  const getRoutes = new Map<string, RouteHandler>();
  const postRoutes = new Map<string, RouteHandler>();
  const app = {
    get(path: string, handler: RouteHandler): void {
      getRoutes.set(path, handler);
    },
    post(path: string, handler: RouteHandler): void {
      postRoutes.set(path, handler);
    },
  };
  const registry = new ToolRegistry();
  registerSSERoutes(app as unknown as FastifyInstance, config, () => registry);
  // The apiPrefix is always '/api/v1' in these tests.
  return {
    registry,
    getSse: getRoutes.get('/api/v1/sse')!,
    postEvent: postRoutes.get('/api/v1/sse/event')!,
    getConnections: getRoutes.get('/api/v1/sse/connections')!,
  };
}

/** Open an SSE connection by driving the GET /sse handler. */
async function connect(
  h: Harness,
  id: string,
): Promise<{ request: FakeRequest; reply: FakeReply; raw: RawResponse }> {
  const raw = makeRawResponse();
  const reply = makeReply(raw);
  const request = makeRequest(id);
  await h.getSse(request as unknown as FastifyRequest, reply as unknown as FastifyReply);
  return { request, reply, raw };
}

/** Drive the POST /sse/event handler. */
async function post(h: Harness, body?: unknown): Promise<FakeReply> {
  const reply = makeReply();
  const request = makeRequest('post', body);
  await h.postEvent(request as unknown as FastifyRequest, reply as unknown as FastifyReply);
  return reply;
}

/** Drive the GET /sse/connections handler. */
async function listConnections(h: Harness): Promise<FakeReply> {
  const reply = makeReply();
  await h.getConnections({} as unknown as FastifyRequest, reply as unknown as FastifyReply);
  return reply;
}

function registerPing(h: Harness): void {
  h.registry.register(
    'ping',
    'Send a ping',
    { type: 'object', properties: {} },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
    'all',
  );
}

// Tracks real-timer connections so their heartbeat interval is cleared.
const openedRequests: EventEmitter[] = [];

afterEach(() => {
  for (const raw of openedRequests) raw.emit('close');
  openedRequests.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// sendSSEEvent
// ---------------------------------------------------------------------------

describe('sendSSEEvent', () => {
  it('writes a well-formed SSE frame', () => {
    const chunks: string[] = [];
    const res = {
      write: (chunk: string): boolean => {
        chunks.push(chunk);
        return true;
      },
    };
    sendSSEEvent(res, 'connected', { requestId: 'r1' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('event: connected\ndata: {"requestId":"r1"}\n\n');
  });

  it('serializes complex data with JSON.stringify', () => {
    const chunks: string[] = [];
    const res = {
      write: (chunk: string): boolean => {
        chunks.push(chunk);
        return true;
      },
    };
    sendSSEEvent(res, 'update', { items: [1, 2, 3], nested: { a: true } });
    expect(chunks[0]).toContain('data: {"items":[1,2,3],"nested":{"a":true}}');
  });
});

// ---------------------------------------------------------------------------
// GET /sse — connection lifecycle
// ---------------------------------------------------------------------------

describe('registerSSERoutes — connection lifecycle', () => {
  it('opens a connection and sends the connected event with SSE headers', async () => {
    const h = makeHarness();
    const { raw, request } = await connect(h, 'a');
    openedRequests.push(request.raw);

    expect(raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      }),
    );
    expect(raw.write).toHaveBeenCalledTimes(1);
    expect(raw.write.mock.calls[0]![0]).toContain('event: connected');
  });

  it('sends a heartbeat ping on the configured interval', async () => {
    vi.useFakeTimers();
    const h = makeHarness(resolveConfig({ sseHeartbeatMs: 1000 }));
    const raw = makeRawResponse();
    const reply = makeReply(raw);
    const request = makeRequest('a');
    await h.getSse(request as unknown as FastifyRequest, reply as unknown as FastifyReply);

    expect(raw.write).toHaveBeenCalledTimes(1); // connected only
    vi.advanceTimersByTime(1000);
    expect(raw.write).toHaveBeenCalledTimes(2);
    expect(raw.write.mock.calls[1]![0]).toContain('event: ping');

    request.raw.emit('close'); // clear the fake interval before restoring real timers
    vi.useRealTimers();
  });

  it('drops the connection when the heartbeat write fails', async () => {
    vi.useFakeTimers();
    const h = makeHarness(resolveConfig({ sseHeartbeatMs: 1000 }));
    const raw = makeRawResponse();
    const reply = makeReply(raw);
    const request = makeRequest('a');
    await h.getSse(request as unknown as FastifyRequest, reply as unknown as FastifyReply);

    raw.failWrites(); // the next ping write throws
    vi.advanceTimersByTime(1000);

    request.raw.emit('close'); // idempotent; the heartbeat catch already cleaned up
    vi.useRealTimers();

    const list = await listConnections(h);
    expect(list.send.mock.calls[0]![0]).toMatchObject({ activeConnections: 0 });
  });

  it('drops the connection when the client disconnects', async () => {
    const h = makeHarness();
    const { request } = await connect(h, 'a');
    openedRequests.push(request.raw);

    request.raw.emit('close');

    const list = await listConnections(h);
    expect(list.send.mock.calls[0]![0]).toMatchObject({ activeConnections: 0 });
  });
});

// ---------------------------------------------------------------------------
// POST /sse/event — validation
// ---------------------------------------------------------------------------

describe('registerSSERoutes — event validation', () => {
  it('rejects a request without a tool field', async () => {
    const h = makeHarness();
    const reply = await post(h, {});
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send.mock.calls[0]![0]).toMatchObject({ error: 'INVALID_REQUEST' });
  });

  it('rejects a request with a non-string tool', async () => {
    const h = makeHarness();
    const reply = await post(h, { tool: 42 });
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it('rejects an empty request body', async () => {
    const h = makeHarness();
    const reply = await post(h, undefined);
    expect(reply.status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// POST /sse/event — execution
// ---------------------------------------------------------------------------

describe('registerSSERoutes — event execution', () => {
  it('executes a tool and reports success', async () => {
    const h = makeHarness();
    registerPing(h);
    const reply = await post(h, { tool: 'ping' });
    expect(reply.status).toHaveBeenCalledWith(200);
    const body = reply.send.mock.calls[0]![0] as Record<string, unknown>;
    expect(body['processed']).toBe(true);
    expect((body['result'] as Record<string, unknown>)['success']).toBe(true);
  });

  it('reports failure when the tool returns an error result', async () => {
    const h = makeHarness();
    h.registry.register(
      'bad',
      'Always errors',
      { type: 'object', properties: {} },
      async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
      'all',
    );
    const reply = await post(h, { tool: 'bad' });
    const body = reply.send.mock.calls[0]![0] as Record<string, unknown>;
    expect((body['result'] as Record<string, unknown>)['success']).toBe(false);
  });

  it('captures a thrown Error from execute', async () => {
    const h = makeHarness();
    vi.spyOn(h.registry, 'execute').mockRejectedValue(new Error('boom'));
    const reply = await post(h, { tool: 'ping' });
    const body = reply.send.mock.calls[0]![0] as Record<string, unknown>;
    const result = body['result'] as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect((result['content'] as Array<{ text: string }>)[0]!.text).toContain(
      'Tool execution error: boom',
    );
  });

  it('captures a thrown non-Error from execute', async () => {
    const h = makeHarness();
    vi.spyOn(h.registry, 'execute').mockRejectedValue('plain failure');
    const reply = await post(h, { tool: 'ping' });
    const body = reply.send.mock.calls[0]![0] as Record<string, unknown>;
    const result = body['result'] as Record<string, unknown>;
    expect((result['content'] as Array<{ text: string }>)[0]!.text).toContain(
      'Tool execution error: plain failure',
    );
  });

  it('defaults args to an empty object when not provided', async () => {
    const h = makeHarness();
    registerPing(h);
    const executeSpy = vi.spyOn(h.registry, 'execute');
    await post(h, { tool: 'ping' });
    expect(executeSpy.mock.calls[0]![1]).toEqual({});
  });

  it('passes through provided args', async () => {
    const h = makeHarness();
    registerPing(h);
    const executeSpy = vi.spyOn(h.registry, 'execute');
    await post(h, { tool: 'ping', args: { projectId: 'p1' } });
    expect(executeSpy.mock.calls[0]![1]).toEqual({ projectId: 'p1' });
  });
});

// ---------------------------------------------------------------------------
// POST /sse/event — connection routing
// ---------------------------------------------------------------------------

describe('registerSSERoutes — connection routing', () => {
  it('sends the result to the matching connection', async () => {
    const h = makeHarness();
    registerPing(h);
    const conn = await connect(h, 'a');
    openedRequests.push(conn.request.raw);

    await post(h, { tool: 'ping', requestId: 'a' });

    expect(conn.raw.chunks.some((c) => c.includes('event: tool_result'))).toBe(true);
  });

  it('broadcasts to other connections without double-sending to the requester', async () => {
    const h = makeHarness();
    registerPing(h);
    const a = await connect(h, 'a');
    const b = await connect(h, 'b');
    openedRequests.push(a.request.raw, b.request.raw);

    const reply = await post(h, { tool: 'ping', requestId: 'a' });

    expect(a.raw.chunks.filter((c) => c.includes('event: tool_result'))).toHaveLength(1);
    expect(b.raw.chunks.filter((c) => c.includes('event: tool_result'))).toHaveLength(1);
    expect(reply.send.mock.calls[0]![0]).toMatchObject({ broadcastTo: 2 });
  });

  it('broadcasts to everyone when the requestId is unknown', async () => {
    const h = makeHarness();
    registerPing(h);
    const a = await connect(h, 'a');
    openedRequests.push(a.request.raw);

    const reply = await post(h, { tool: 'ping', requestId: 'zzz' });

    expect(a.raw.chunks.filter((c) => c.includes('event: tool_result'))).toHaveLength(1);
    expect(reply.send.mock.calls[0]![0]).toMatchObject({ broadcastTo: 1 });
  });

  it('removes the specific connection when its write fails', async () => {
    const h = makeHarness();
    registerPing(h);
    const a = await connect(h, 'a');
    const b = await connect(h, 'b');
    openedRequests.push(a.request.raw, b.request.raw);

    a.raw.failWrites();
    await post(h, { tool: 'ping', requestId: 'a' });

    const list = await listConnections(h);
    const body = list.send.mock.calls[0]![0] as {
      activeConnections: number;
      connections: Array<{ requestId: string }>;
    };
    expect(body.activeConnections).toBe(1);
    expect(body.connections[0]!.requestId).toBe('b');
  });

  it('removes a connection when the broadcast write fails', async () => {
    const h = makeHarness();
    registerPing(h);
    const a = await connect(h, 'a');
    const b = await connect(h, 'b');
    openedRequests.push(a.request.raw, b.request.raw);

    b.raw.failWrites();
    await post(h, { tool: 'ping', requestId: 'a' });

    const list = await listConnections(h);
    const body = list.send.mock.calls[0]![0] as {
      activeConnections: number;
      connections: Array<{ requestId: string }>;
    };
    expect(body.activeConnections).toBe(1);
    expect(body.connections[0]!.requestId).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// GET /sse/connections
// ---------------------------------------------------------------------------

describe('registerSSERoutes — connections endpoint', () => {
  it('reports zero connections when none are open', async () => {
    const h = makeHarness();
    const reply = await listConnections(h);
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send.mock.calls[0]![0]).toEqual({ activeConnections: 0, connections: [] });
  });

  it('reports open connections with metadata', async () => {
    const h = makeHarness();
    const a = await connect(h, 'a');
    const b = await connect(h, 'b');
    openedRequests.push(a.request.raw, b.request.raw);

    const reply = await listConnections(h);
    const body = reply.send.mock.calls[0]![0] as {
      activeConnections: number;
      connections: Array<{ requestId: string; connectedAt: string; durationMs: number }>;
    };
    expect(body.activeConnections).toBe(2);
    expect(body.connections).toHaveLength(2);
    expect(body.connections.map((c) => c.requestId)).toEqual(['a', 'b']);
    for (const c of body.connections) {
      expect(typeof c.connectedAt).toBe('string');
      expect(typeof c.durationMs).toBe('number');
    }
  });
});
