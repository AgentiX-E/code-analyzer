// @code-analyzer/server — GraphQL Server Factory & Fastify Mount Tests
// Covers createGraphQLServer (logging/graphiql/maskedErrors configuration)
// and mountGraphQLOnFastify (route registration, logging, request handling).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { resolveConfig } from '../server-config.js';

const createYogaMock = vi.hoisted(() => vi.fn());
const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock('graphql-yoga', () => ({
  createYoga: createYogaMock,
}));

import { createGraphQLServer, mountGraphQLOnFastify } from '../graphql/server.js';

const ORIGINAL_NODE_ENV = process.env['NODE_ENV'];

function makeOptions(logging?: {
  enabled: boolean;
  level?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}) {
  return {
    store: new InMemoryGraphStore(),
    config: resolveConfig(logging ? { logging } : undefined),
    startTime: 123456,
  };
}

/** A yoga-looking response whose framing headers must not be forwarded. */
function yogaResponse(body = '{"ok":true}', status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'x-test': 'yes',
      'content-length': String(body.length),
      'transfer-encoding': 'chunked',
    },
  });
}

describe('createGraphQLServer', () => {
  beforeEach(() => {
    createYogaMock.mockReset();
    fetchSpy.mockReset();
    createYogaMock.mockReturnValue({ fetch: fetchSpy });
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
  });

  it('returns a yoga instance', () => {
    const yoga = createGraphQLServer(makeOptions());
    expect(yoga).toBeDefined();
    expect(yoga.fetch).toBe(fetchSpy);
  });

  it('provides request-scoped context from store, config and startTime', () => {
    const options = makeOptions();
    createGraphQLServer(options);
    const opts = createYogaMock.mock.calls[0][0];
    const context = opts.context();

    expect(context.store).toBe(options.store);
    expect(context.config).toBe(options.config);
    expect(context.startTime).toBe(options.startTime);
  });

  it('enables debug logging when logging is enabled at a non-silent level', () => {
    createGraphQLServer(makeOptions({ enabled: true, level: 'info' }));
    const opts = createYogaMock.mock.calls[0][0];
    expect(opts.logging).toBe('debug');
  });

  it('disables logging when logging is disabled', () => {
    createGraphQLServer(makeOptions({ enabled: false }));
    const opts = createYogaMock.mock.calls[0][0];
    expect(opts.logging).toBe(false);
  });

  it('disables logging when the level is silent', () => {
    createGraphQLServer(makeOptions({ enabled: true, level: 'silent' }));
    const opts = createYogaMock.mock.calls[0][0];
    expect(opts.logging).toBe(false);
  });

  it('enables GraphiQL and keeps errors unmasked outside production', () => {
    process.env['NODE_ENV'] = 'development';
    createGraphQLServer(makeOptions());
    const opts = createYogaMock.mock.calls[0][0];
    expect(opts.graphiql).toBe(true);
    expect(opts.maskedErrors).toBe(false);
  });

  it('disables GraphiQL and masks errors in production', () => {
    process.env['NODE_ENV'] = 'production';
    createGraphQLServer(makeOptions());
    const opts = createYogaMock.mock.calls[0][0];
    expect(opts.graphiql).toBe(false);
    expect(opts.maskedErrors).toBe(true);
  });
});

describe('mountGraphQLOnFastify', () => {
  beforeEach(() => {
    createYogaMock.mockReset();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(yogaResponse());
    createYogaMock.mockReturnValue({ fetch: fetchSpy });
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
  });

  function mount(logging?: {
    enabled: boolean;
    level?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  }) {
    const routes: Array<Record<string, unknown>> = [];
    const app = {
      route: (cfg: Record<string, unknown>) => {
        routes.push(cfg);
      },
    };
    const options = {
      store: new InMemoryGraphStore(),
      config: resolveConfig(logging ? { logging } : undefined),
      startTime: 123456,
    };
    mountGraphQLOnFastify(app, options, '/api/v1');
    return { routes };
  }

  it('registers the /graphql route with GET, POST and OPTIONS', () => {
    const { routes } = mount();
    expect(routes).toHaveLength(1);
    expect(routes[0].url).toBe('/api/v1/graphql');
    expect(routes[0].method).toEqual(['GET', 'POST', 'OPTIONS']);
  });

  it('logs the endpoint when logging is enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mount({ enabled: true, level: 'info' });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('does not log the endpoint when logging is disabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mount({ enabled: false });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('does not log the endpoint when the level is silent', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mount({ enabled: true, level: 'silent' });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  type Handler = (req: unknown, reply: unknown) => Promise<void>;

  function handler(): Handler {
    const { routes } = mount();
    return routes[0].handler as Handler;
  }

  function makeReply() {
    const send = vi.fn();
    return { header: vi.fn(), status: vi.fn().mockReturnValue({ send }), send };
  }

  it('forwards a self-contained request built from the Fastify request', async () => {
    const reply = makeReply();
    const req = {
      method: 'POST',
      url: '/api/v1/graphql?trace=1',
      headers: { host: 'example.test', 'content-type': 'application/json' },
      body: { query: '{ __typename }' },
    };

    await handler()(req, reply);

    const forwarded = fetchSpy.mock.calls[0]![0] as Request;
    expect(forwarded).toBeInstanceOf(Request);
    expect(forwarded.method).toBe('POST');
    expect(forwarded.url).toBe('http://example.test/api/v1/graphql?trace=1');
    expect(forwarded.headers.get('content-type')).toBe('application/json');
    // Fastify has already drained the raw stream, so the payload must be
    // re-serialised; a forwarded read would hang yoga forever.
    await expect(forwarded.text()).resolves.toBe('{"query":"{ __typename }"}');
  });

  it('joins repeated headers and skips valueless ones', async () => {
    const reply = makeReply();
    const req = {
      method: 'GET',
      url: '/api/v1/graphql',
      headers: { 'x-forwarded-for': ['10.0.0.1', '10.0.0.2'], 'x-absent': undefined },
      body: undefined,
    };

    await handler()(req, reply);

    const forwarded = fetchSpy.mock.calls[0]![0] as Request;
    expect(forwarded.method).toBe('GET');
    expect(forwarded.headers.get('x-forwarded-for')).toBe('10.0.0.1, 10.0.0.2');
    expect(forwarded.headers.has('x-absent')).toBe(false);
    // A GET must carry no body at all, and no Host header means a local fallback.
    expect(forwarded.body).toBeNull();
    expect(forwarded.url).toBe('http://localhost/api/v1/graphql');
  });

  it('sends the materialised body and forwards the status without framing headers', async () => {
    const reply = makeReply();
    const req = { method: 'POST', url: '/api/v1/graphql', headers: {}, body: undefined };

    await handler()(req, reply);

    // `?? {}` keeps yoga from receiving the string "undefined" as its body.
    const forwarded = fetchSpy.mock.calls[0]![0] as Request;
    await expect(forwarded.text()).resolves.toBe('{}');

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith('{"ok":true}');
    expect(reply.header).toHaveBeenCalledWith('x-test', 'yes');
    // Fastify derives framing from the body it materialises; forwarding yoga's
    // stale content-length (or a transfer-encoding) would corrupt the response.
    expect(reply.header).not.toHaveBeenCalledWith('content-length', expect.anything());
    expect(reply.header).not.toHaveBeenCalledWith('transfer-encoding', expect.anything());
  });

  it('forwards a non-200 status from yoga verbatim', async () => {
    fetchSpy.mockResolvedValue(yogaResponse('{"errors":[{"message":"nope"}]}', 418));
    const reply = makeReply();
    const req = { method: 'POST', url: '/api/v1/graphql', headers: {}, body: { query: '{ x }' } };

    await handler()(req, reply);

    // A hard-coded 200 would silently turn every GraphQL error response into a
    // success, so the status has to survive the hop unchanged.
    expect(reply.status).toHaveBeenCalledWith(418);
    expect(reply.send).toHaveBeenCalledWith('{"errors":[{"message":"nope"}]}');
  });
});
