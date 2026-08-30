// @code-analyzer/server — GraphQL Server Factory & Fastify Mount Tests
// Covers createGraphQLServer (logging/graphiql/maskedErrors configuration)
// and mountGraphQLOnFastify (route registration, logging, request handling).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { resolveConfig } from '../server-config.js';

const createYogaMock = vi.hoisted(() => vi.fn());
const handleSpy = vi.hoisted(() => vi.fn());

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

describe('createGraphQLServer', () => {
  beforeEach(() => {
    createYogaMock.mockReset();
    handleSpy.mockReset();
    createYogaMock.mockReturnValue({ handleNodeRequestAndResponse: handleSpy });
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
  });

  it('returns a yoga instance', () => {
    const yoga = createGraphQLServer(makeOptions());
    expect(yoga).toBeDefined();
    expect(yoga.handleNodeRequestAndResponse).toBe(handleSpy);
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
    handleSpy.mockReset();
    handleSpy.mockResolvedValue({
      headers: new Headers({ 'x-test': 'yes' }),
      status: 200,
      body: '{"ok":true}',
    });
    createYogaMock.mockReturnValue({ handleNodeRequestAndResponse: handleSpy });
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

  it('passes the raw request/response pair to yoga', async () => {
    const { routes } = mount();
    const handler = routes[0].handler as (
      req: Record<string, unknown>,
      reply: Record<string, unknown>,
    ) => Promise<void>;

    const rawReq = { url: '/graphql', method: 'POST' };
    const rawReply = {};
    const req = { raw: rawReq, headers: {} };
    const reply = {
      raw: rawReply,
      header: vi.fn(),
      status: vi.fn().mockReturnValue({ send: vi.fn() }),
    };

    await handler(req, reply);

    expect(handleSpy).toHaveBeenCalledWith(rawReq, rawReply);
    expect(reply.header).toHaveBeenCalledWith('x-test', 'yes');
  });

  it('falls back to the wrapper objects when raw is absent', async () => {
    const { routes } = mount();
    const handler = routes[0].handler as (
      req: Record<string, unknown>,
      reply: Record<string, unknown>,
    ) => Promise<void>;

    const req = { url: '/graphql', method: 'POST' };
    const reply = {
      header: vi.fn(),
      status: vi.fn().mockReturnValue({ send: vi.fn() }),
    };

    await handler(req, reply);

    expect(handleSpy).toHaveBeenCalledWith(req, reply);
    expect(reply.header).toHaveBeenCalledWith('x-test', 'yes');
  });
});
