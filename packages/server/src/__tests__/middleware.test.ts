// @code-analyzer/server — Middleware Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { registerCors } from '../middleware/cors.js';
import { registerAuth } from '../middleware/auth.js';
import { registerLogging, shouldLog } from '../middleware/logging.js';
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
