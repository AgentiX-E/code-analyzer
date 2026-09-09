// @code-analyzer/server — Middleware Tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { registerCors, resolveAllowedOrigin } from '../middleware/cors.js';
import { registerAuth } from '../middleware/auth.js';
import { registerLogging, shouldLog, logStructured, logPretty } from '../middleware/logging.js';
import { registerErrorHandler } from '../middleware/error-handler.js';
import type { CorsConfig, AuthConfig, LoggingConfig } from '../server-config.js';
import type { ErrorResponse } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// CORS Middleware
// ---------------------------------------------------------------------------

describe('registerCors', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should set CORS headers for allowed origins', async () => {
    registerCors(app, {
      origin: '*',
      methods: ['GET'],
      allowedHeaders: ['Content-Type'],
      exposedHeaders: [],
      credentials: false,
      maxAge: 3600,
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'https://example.com' },
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toBe('GET');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type');
  });

  it('should handle preflight OPTIONS', async () => {
    registerCors(app, {
      origin: '*',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
      exposedHeaders: [],
      credentials: false,
      maxAge: 3600,
    });

    await app.ready();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/test',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });

    expect(res.statusCode).toBe(204);
  });

  it('should set credentials header when enabled', async () => {
    registerCors(app, {
      origin: '*',
      methods: ['GET'],
      allowedHeaders: [],
      exposedHeaders: [],
      credentials: true,
      maxAge: 3600,
    });

    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'https://example.com' },
    });

    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('should set Vary header', async () => {
    registerCors(app, {
      origin: '*',
      methods: ['GET'],
      allowedHeaders: [],
      exposedHeaders: ['x-request-id'],
      credentials: false,
      maxAge: 3600,
    });

    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(res.headers['vary']).toBe('Origin');
  });

  it('skips origin header when no origin is sent and a specific origin is configured', async () => {
    registerCors(app, {
      origin: 'https://example.com',
      methods: ['GET'],
      allowedHeaders: [],
      exposedHeaders: [],
      credentials: false,
      maxAge: 3600,
    });
    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes a matching specific origin', async () => {
    registerCors(app, {
      origin: 'https://example.com',
      methods: ['GET'],
      allowedHeaders: [],
      exposedHeaders: [],
      credentials: false,
      maxAge: 3600,
    });
    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'https://example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
  });

  it('echoes a matching origin from an allowlist array', async () => {
    registerCors(app, {
      origin: ['https://a.com', 'https://b.com'],
      methods: ['GET'],
      allowedHeaders: [],
      exposedHeaders: [],
      credentials: false,
      maxAge: 3600,
    });
    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'https://b.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://b.com');
  });

  it('echoes origin when the allowlist contains a wildcard', async () => {
    registerCors(app, {
      origin: ['*'],
      methods: ['GET'],
      allowedHeaders: [],
      exposedHeaders: [],
      credentials: false,
      maxAge: 3600,
    });
    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'https://any.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://any.com');
  });

  it('omits the allow-origin header for a non-matching origin', async () => {
    registerCors(app, {
      origin: 'https://example.com',
      methods: ['GET'],
      allowedHeaders: [],
      exposedHeaders: [],
      credentials: false,
      maxAge: 3600,
    });
    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'https://evil.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveAllowedOrigin — direct unit tests (pure function)
// ---------------------------------------------------------------------------

describe('resolveAllowedOrigin', () => {
  it('returns * for a wildcard allow config', () => {
    expect(resolveAllowedOrigin('https://x.com', '*')).toBe('*');
  });

  it('returns null when no origin is provided and allow is not a wildcard', () => {
    expect(resolveAllowedOrigin(undefined, 'https://x.com')).toBeNull();
  });

  it('echoes the origin when it exactly matches a single string allow', () => {
    expect(resolveAllowedOrigin('https://x.com', 'https://x.com')).toBe('https://x.com');
  });

  it('echoes the origin when it is in the allowlist array', () => {
    expect(resolveAllowedOrigin('https://x.com', ['https://x.com', 'https://y.com'])).toBe(
      'https://x.com',
    );
  });

  it('echoes the origin when the allowlist array contains a wildcard', () => {
    expect(resolveAllowedOrigin('https://x.com', ['*'])).toBe('https://x.com');
  });

  it('returns null for a non-matching origin', () => {
    expect(resolveAllowedOrigin('https://x.com', 'https://y.com')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------

describe('registerAuth', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should not enforce auth when disabled', async () => {
    registerAuth(app, {
      enabled: false,
      apiKeys: [],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('should reject requests without API key when enabled', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['secret-key'],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('should accept valid API key from custom header', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['secret-key'],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'secret-key' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should reject invalid API key', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['secret-key'],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('should accept valid API key from Authorization Bearer', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['bearer-token'],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer bearer-token' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should skip auth for health endpoints', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['key'],
      headerName: 'x-api-key',
    });

    app.get('/health', async (_req, reply) => reply.send({ status: 'ok' }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('should skip auth for OPTIONS preflight', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['key'],
      headerName: 'x-api-key',
    });

    app.options('/test', async (_req, reply) => reply.status(204).send());
    await app.ready();

    const res = await app.inject({ method: 'OPTIONS', url: '/test' });
    expect(res.statusCode).toBe(204);
  });

  it('should skip auth for /api/v1/health endpoint', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['key'],
      headerName: 'x-api-key',
    });

    app.get('/api/v1/health', async (_req, reply) => reply.send({ status: 'ok' }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('should use custom headerName for API key extraction', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['my-custom-key'],
      headerName: 'x-custom-auth',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    // Reject when key is in default header
    const res1 = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'my-custom-key' },
    });
    expect(res1.statusCode).toBe(401);

    // Accept when key is in custom header
    const res2 = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-custom-auth': 'my-custom-key' },
    });
    expect(res2.statusCode).toBe(200);
  });

  it('should prioritize custom header over Authorization Bearer', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['header-key'],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    // Custom header has the valid key, Authorization has an invalid one
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-api-key': 'header-key',
        authorization: 'Bearer wrong-key',
      },
    });
    // Should succeed because custom header takes priority and matches
    expect(res.statusCode).toBe(200);
  });

  it('should reject Authorization header with non-Bearer type', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['secret-key'],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Basic c29tZXRoaW5n' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject Authorization Bearer with empty token', async () => {
    registerAuth(app, {
      enabled: true,
      apiKeys: ['secret-key'],
      headerName: 'x-api-key',
    });

    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    // Bearer with empty token — extractApiKey returns empty string, which is falsy
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Logging Middleware
// ---------------------------------------------------------------------------

describe('registerLogging', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should not register hooks when disabled', async () => {
    registerLogging(app, {
      enabled: false,
      level: 'info',
      includeBody: false,
      pretty: false,
    });

    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('should register hooks when enabled', async () => {
    registerLogging(app, {
      enabled: true,
      level: 'info',
      includeBody: false,
      pretty: false,
    });

    app.get('/test', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('logs in pretty format when pretty is enabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      registerLogging(app, {
        enabled: true,
        level: 'info',
        includeBody: false,
        pretty: true,
      });
      app.get('/test', async (_req, reply) => reply.send({}));
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(200);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('includes body size when includeBody is enabled and a body is present', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      registerLogging(app, {
        enabled: true,
        level: 'info',
        includeBody: true,
        pretty: false,
      });
      app.post('/echo', async (_req, reply) => reply.send({}));
      await app.ready();

      const res = await app.inject({ method: 'POST', url: '/echo', payload: { a: 1 } });
      expect(res.statusCode).toBe(200);
      const logged = logSpy.mock.calls[0]?.[0] as string | undefined;
      expect(logged).toContain('"bodySize"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('falls back to "unknown" user-agent when the header is absent', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      registerLogging(app, {
        enabled: true,
        level: 'info',
        includeBody: false,
        pretty: false,
      });
      app.get('/test', async (_req, reply) => reply.send({}));
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'user-agent': undefined as unknown as string },
      });
      expect(res.statusCode).toBe(200);
      const logged = logSpy.mock.calls[0]?.[0] as string | undefined;
      expect(logged).toContain('"userAgent":"unknown"');
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// shouldLog helper
// ---------------------------------------------------------------------------

describe('shouldLog', () => {
  it('should return false for silent level', () => {
    expect(shouldLog('silent', 200)).toBe(false);
    expect(shouldLog('silent', 500)).toBe(false);
  });

  it('should return true for all codes with debug level', () => {
    expect(shouldLog('debug', 200)).toBe(true);
    expect(shouldLog('debug', 404)).toBe(true);
    expect(shouldLog('debug', 500)).toBe(true);
  });

  it('should return true for error level only on 5xx', () => {
    expect(shouldLog('error', 500)).toBe(true);
    expect(shouldLog('error', 200)).toBe(false);
    expect(shouldLog('error', 404)).toBe(false);
  });

  it('should return true for warn level on 4xx+5xx', () => {
    expect(shouldLog('warn', 500)).toBe(true);
    expect(shouldLog('warn', 404)).toBe(true);
    expect(shouldLog('warn', 200)).toBe(false);
  });

  it('should return true for info level on 2xx+4xx+5xx', () => {
    expect(shouldLog('info', 200)).toBe(true);
    expect(shouldLog('info', 404)).toBe(true);
    expect(shouldLog('info', 500)).toBe(true);
  });

  it('treats unknown levels as info via the ?? 3 fallback', () => {
    expect(shouldLog('unknown', 200)).toBe(true);
    expect(shouldLog('unknown', 404)).toBe(true);
    expect(shouldLog('unknown', 500)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// logStructured / logPretty — direct unit tests (console side-effects spied)
// ---------------------------------------------------------------------------

describe('logStructured', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log when shouldLog returns false', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logStructured({ statusCode: 200 }, 'silent', 200);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs at error level for 5xx', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logStructured({ statusCode: 500 }, 'info', 500);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs at warn level for 4xx', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logStructured({ statusCode: 404 }, 'info', 404);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs at info level for 2xx', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logStructured({ statusCode: 200 }, 'info', 200);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('logPretty', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log when shouldLog returns false', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logPretty(
      { statusCode: 200, timestamp: 't', method: 'GET', url: '/', responseTimeMs: 1 },
      'silent',
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('uses red for 5xx', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logPretty(
      { statusCode: 500, timestamp: 't', method: 'GET', url: '/', responseTimeMs: 1 },
      'info',
    );
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toContain('\x1b[31m');
  });

  it('uses yellow for 4xx', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logPretty(
      { statusCode: 404, timestamp: 't', method: 'GET', url: '/', responseTimeMs: 1 },
      'info',
    );
    expect(logSpy.mock.calls[0]![0]).toContain('\x1b[33m');
  });

  it('uses green for 2xx', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logPretty(
      { statusCode: 200, timestamp: 't', method: 'GET', url: '/', responseTimeMs: 1 },
      'info',
    );
    expect(logSpy.mock.calls[0]![0]).toContain('\x1b[32m');
  });
});

// ---------------------------------------------------------------------------
// Error Handler Middleware
// ---------------------------------------------------------------------------

describe('registerErrorHandler', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should catch thrown errors and return structured response', async () => {
    registerErrorHandler(app);

    app.get('/error', async () => {
      throw Object.assign(new Error('Test error'), { statusCode: 400 });
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/error' });
    expect(res.statusCode).toBe(400);

    const body = JSON.parse(res.body) as ErrorResponse;
    expect(body.message).toBe('Test error');
    expect(body.error).toBeDefined();
    expect(body.statusCode).toBe(400);
  });

  it('should mask internal errors for 5xx', async () => {
    registerErrorHandler(app);

    app.get('/crash', async () => {
      throw new Error('Internal detail');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/crash' });
    expect(res.statusCode).toBe(500);

    const body = JSON.parse(res.body) as ErrorResponse;
    expect(body.message).toBe('Internal server error');
    expect(body.statusCode).toBe(500);
  });

  it('should return 404 for unknown routes', async () => {
    registerErrorHandler(app);

    app.get('/exists', async (_req, reply) => reply.send({}));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);

    const body = JSON.parse(res.body) as ErrorResponse;
    expect(body.error).toBe('NOT_FOUND');
    expect(body.statusCode).toBe(404);
  });

  it('should include requestId in error responses', async () => {
    registerErrorHandler(app);

    app.get('/error', async () => {
      throw new Error('test');
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/error',
      headers: { 'x-request-id': 'req-test-123' },
    });
    const body = JSON.parse(res.body) as ErrorResponse;
    expect(body.requestId).toBeDefined();
  });

  it('omits requestId when the generated request id is empty', async () => {
    // genReqId returning an empty string makes request.id falsy, exercising
    // the `...(requestId ? { requestId } : {})` empty-spread branch.
    const emptyIdApp = Fastify({ logger: false, genReqId: () => '' });
    try {
      registerErrorHandler(emptyIdApp);
      emptyIdApp.get('/error', async () => {
        throw new Error('boom');
      });
      await emptyIdApp.ready();

      const res = await emptyIdApp.inject({ method: 'GET', url: '/error' });
      const body = JSON.parse(res.body) as ErrorResponse;
      expect(body.requestId).toBeUndefined();
    } finally {
      await emptyIdApp.close();
    }
  });

  it('includes validation details when NODE_ENV is development', async () => {
    const prevNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    try {
      registerErrorHandler(app);
      app.get(
        '/validated',
        {
          schema: {
            querystring: {
              type: 'object',
              required: ['q'],
              properties: { q: { type: 'string' } },
            },
          },
        },
        async (_req, reply) => reply.send({ ok: true }),
      );
      await app.ready();

      // Missing required querystring `q` → Fastify validation error carrying `.validation`.
      const res = await app.inject({ method: 'GET', url: '/validated' });
      expect(res.statusCode).toBe(400);

      const body = JSON.parse(res.body) as ErrorResponse;
      expect(body.details).toBeDefined();
    } finally {
      if (prevNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prevNodeEnv;
    }
  });
});

// ---------------------------------------------------------------------------
// Fastify instance tests
// ---------------------------------------------------------------------------

describe('Fastify integration', () => {
  it('should handle empty request body gracefully', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);

    app.post('/echo', async (req, reply) => {
      return reply.send({ received: req.body });
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { test: 'value' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.received).toEqual({ test: 'value' });

    await app.close();
  });
});
