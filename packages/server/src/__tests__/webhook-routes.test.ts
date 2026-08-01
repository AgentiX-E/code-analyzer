// @code-analyzer/server — Webhook Routes Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  registerWebhookRoutes,
  verifySignature,
} from '../routes/webhook.js';
import type { WebhookHandler, WebhookConfig } from '../routes/webhook.js';
import { resolveConfig } from '../server-config.js';
import { createHmac } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHandler(): WebhookHandler & { processed: unknown[] } {
  const processed: unknown[] = [];
  return {
    processed,
    async process(payload: unknown) {
      processed.push(payload);
    },
  };
}

function signPayload(secret: string, payload: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf-8');
  return `sha256=${hmac.digest('hex')}`;
}

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------

describe('verifySignature', () => {
  const secret = 'test-webhook-secret';
  const payload = '{"action":"opened"}';

  it('should verify a valid signature', () => {
    const sig = signPayload(secret, payload);
    expect(verifySignature(secret, sig, payload)).toBe(true);
  });

  it('should reject an invalid signature', () => {
    const sig = signPayload('wrong-secret', payload);
    expect(verifySignature(secret, sig, payload)).toBe(false);
  });

  it('should reject a tampered payload', () => {
    const sig = signPayload(secret, payload);
    expect(verifySignature(secret, sig, '{"action":"closed"}')).toBe(false);
  });

  it('should reject an empty signature header', () => {
    expect(verifySignature(secret, '', payload)).toBe(false);
  });

  it('should reject undefined signature', () => {
    expect(verifySignature(secret, undefined, payload)).toBe(false);
  });

  it('should reject signature with wrong prefix', () => {
    expect(verifySignature(secret, `sha1=${'0'.repeat(40)}`, payload)).toBe(false);
  });

  it('should handle malformed hex gracefully', () => {
    expect(verifySignature(secret, 'sha256=not-hex', payload)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Webhook Routes
// ---------------------------------------------------------------------------

describe('registerWebhookRoutes', () => {
  let app: FastifyInstance;
  const config = resolveConfig();

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should register webhook endpoint', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      payload: { action: 'opened' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(true);
    expect(body.event).toBe('pull_request');
  });

  it('should reject requests without event type header', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: { 'content-type': 'application/json' },
      payload: { action: 'opened' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('MISSING_EVENT_TYPE');
  });

  it('should reject requests with invalid signature when secret configured', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, {
      handler,
      secret: 'my-secret',
    });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=invalid',
      },
      payload: { action: 'opened' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should accept requests with valid signature when secret configured', async () => {
    const handler = createHandler();
    const secret = 'my-secret';
    const payload = { action: 'opened' };
    const payloadStr = JSON.stringify(payload);
    const signature = signPayload(secret, payloadStr);

    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, {
      handler,
      secret,
    });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signature,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(true);
  });

  it('should include delivery ID in response', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-abc-123',
      },
      payload: { action: 'opened' },
    });

    const body = JSON.parse(res.body);
    expect(body.deliveryId).toBe('delivery-abc-123');
  });

  it('should serve webhook status endpoint', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, {
      handler,
      secret: 'configured',
    });

    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhook/github/status',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.configured).toBe(true);
    expect(body.eventTypes).toContain('pull_request');
  });

  it('should report not configured when no secret set', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhook/github/status',
    });

    const body = JSON.parse(res.body);
    expect(body.configured).toBe(false);
  });

  it('should process payload asynchronously after responding', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, { handler });

    await app.ready();

    const payload = { action: 'opened', pull_request: { number: 42 } };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      payload,
    });

    expect(res.statusCode).toBe(200);

    // Wait a bit for async processing to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(handler.processed.length).toBe(1);
    expect(handler.processed[0]).toEqual(payload);
  });

  it('should handle processing errors when logging is disabled', async () => {
    const handler: WebhookHandler & { processed: unknown[] } = {
      processed: [],
      async process(_payload: unknown) {
        throw new Error('Processing failed!');
      },
    };

    app = Fastify({ logger: false });

    // logging.enabled is false
    const customConfig = resolveConfig({ logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } });
    registerWebhookRoutes(app, customConfig, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      payload: { action: 'opened' },
    });

    // Response should still be 200
    expect(res.statusCode).toBe(200);
  });

  it('should log processing errors when logging is enabled', async () => {
    const handler: WebhookHandler & { processed: unknown[] } = {
      processed: [],
      async process(_payload: unknown) {
        throw new Error('Processing failed!');
      },
    };

    app = Fastify({ logger: false });

    // logging.enabled is true
    const customConfig = resolveConfig({ logging: { enabled: true, level: 'info', includeBody: false, pretty: false } });
    registerWebhookRoutes(app, customConfig, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      payload: { action: 'opened' },
    });

    // Response should still be 200
    expect(res.statusCode).toBe(200);

    // Wait for async processing to trigger the error
    await new Promise((r) => setTimeout(r, 100));
  });

  it('should use "unknown" delivery ID when x-github-delivery header is missing', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    registerWebhookRoutes(app, config, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      payload: { action: 'opened' },
    });

    const body = JSON.parse(res.body);
    expect(body.deliveryId).toBe('unknown');
  });

  it('should work with custom apiPrefix', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    const customConfig = resolveConfig({ apiPrefix: '/custom/v2' });
    registerWebhookRoutes(app, customConfig, { handler });

    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/custom/v2/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
      },
      payload: { action: 'opened' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(true);
  });

  it('should serve webhook status with custom apiPrefix', async () => {
    const handler = createHandler();
    app = Fastify({ logger: false });

    const customConfig = resolveConfig({ apiPrefix: '/custom/v2' });
    registerWebhookRoutes(app, customConfig, { handler, secret: 'configured' });

    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/custom/v2/webhook/github/status',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.configured).toBe(true);
  });
});
