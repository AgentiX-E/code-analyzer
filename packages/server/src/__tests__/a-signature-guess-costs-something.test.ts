// @code-analyzer/server — a signature guess costs something
//
// **The endpoint this file is about is unauthenticated by design**: GitHub cannot present a session,
// so the only thing between a stranger and the review pipeline is an HMAC over the payload. The
// server's own rate limiter is off by default, which made that HMAC the only cost of a guess - so
// the assertions below are about the two halves of a bound: a source that guesses is refused, and a
// source that verifies is not.

import { createHmac } from 'node:crypto';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerWebhookRoutes, SignatureFailureBudget } from '../routes/webhook.js';
import { resolveConfig } from '../server-config.js';

import type { WebhookHandler } from '../routes/webhook.js';
import type { FastifyInstance } from 'fastify';

const SECRET = 'a-webhook-secret';
const URL = '/api/v1/webhook/github';

function sign(payload: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(payload, 'utf-8').digest('hex')}`;
}

function handler(): WebhookHandler & { processed: unknown[] } {
  const processed: unknown[] = [];
  return {
    processed,
    async process(payload: unknown) {
      processed.push(payload);
    },
  };
}

/** One delivery, from one address, with whatever signature the caller supplies. */
async function deliver(
  app: FastifyInstance,
  options: { from: string; signature?: string; payload?: string },
): Promise<number> {
  const payload = options.payload ?? '{"action":"opened"}';
  const response = await app.inject({
    method: 'POST',
    url: URL,
    remoteAddress: options.from,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'pull_request',
      ...(options.signature === undefined ? {} : { 'x-hub-signature-256': options.signature }),
    },
    payload,
  });
  return response.statusCode;
}

describe('a source that guesses is refused', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('refuses the eleventh bad signature from one source, and does not compute an HMAC for it', async () => {
    app = Fastify({ logger: false });
    registerWebhookRoutes(app, resolveConfig(), {
      secret: SECRET,
      handler: handler(),
      signatureFailureLimit: { windowMs: 60_000, maxFailures: 3 },
    });
    await app.ready();

    expect(await deliver(app, { from: '10.0.0.1', signature: 'sha256=00' })).toBe(401);
    expect(await deliver(app, { from: '10.0.0.1', signature: 'sha256=00' })).toBe(401);
    expect(await deliver(app, { from: '10.0.0.1', signature: 'sha256=00' })).toBe(401);

    const refused = await app.inject({
      method: 'POST',
      url: URL,
      remoteAddress: '10.0.0.1',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=00',
      },
      payload: '{"action":"opened"}',
    });

    expect(refused.statusCode).toBe(429);
    expect((JSON.parse(refused.body) as { error?: string }).error).toBe(
      'TOO_MANY_INVALID_SIGNATURES',
    );
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('refuses a correct signature too, because the budget is spent before the HMAC is read', async () => {
    app = Fastify({ logger: false });
    registerWebhookRoutes(app, resolveConfig(), {
      secret: SECRET,
      handler: handler(),
      signatureFailureLimit: { windowMs: 60_000, maxFailures: 2 },
    });
    await app.ready();

    await deliver(app, { from: '10.0.0.2', signature: 'sha256=00' });
    await deliver(app, { from: '10.0.0.2', signature: 'sha256=00' });

    expect(await deliver(app, { from: '10.0.0.2', signature: sign('{"action":"opened"}') })).toBe(429);
  });

  it('keeps one source out of another source’s budget', async () => {
    app = Fastify({ logger: false });
    registerWebhookRoutes(app, resolveConfig(), {
      secret: SECRET,
      handler: handler(),
      signatureFailureLimit: { windowMs: 60_000, maxFailures: 1 },
    });
    await app.ready();

    await deliver(app, { from: '10.0.0.3', signature: 'sha256=00' });

    expect(await deliver(app, { from: '10.0.0.3', signature: 'sha256=00' })).toBe(429);
    expect(await deliver(app, { from: '10.0.0.4', signature: sign('{"action":"opened"}') })).toBe(200);
  });

  it('clears the budget when a signature verifies', async () => {
    app = Fastify({ logger: false });
    const received = handler();
    registerWebhookRoutes(app, resolveConfig(), {
      secret: SECRET,
      handler: received,
      signatureFailureLimit: { windowMs: 60_000, maxFailures: 2 },
    });
    await app.ready();

    await deliver(app, { from: '10.0.0.5', signature: 'sha256=00' });
    expect(await deliver(app, { from: '10.0.0.5', signature: sign('{"action":"opened"}') })).toBe(200);

    // The window is empty again, so one more bad signature is 401 rather than 429.
    expect(await deliver(app, { from: '10.0.0.5', signature: 'sha256=00' })).toBe(401);
    expect(received.processed).toHaveLength(1);
  });
});

describe('the budget itself', () => {
  it('counts inside one window and forgets after it', () => {
    const budget = new SignatureFailureBudget({ windowMs: 1_000, maxFailures: 2 });
    const at = 10_000;

    budget.record('a', at);
    budget.record('a', at + 1);
    expect(budget.retryAfterSeconds('a', at + 2)).toBe(1);
    expect(budget.retryAfterSeconds('a', at + 1_000)).toBeNull();
  });

  it('never reports a retry of zero seconds, which reads as "try now"', () => {
    const budget = new SignatureFailureBudget({ windowMs: 1_000, maxFailures: 1 });

    budget.record('a', 0);
    expect(budget.retryAfterSeconds('a', 999)).toBe(1);
  });

  it('answers an unknown source with no refusal', () => {
    const budget = new SignatureFailureBudget({ windowMs: 1_000, maxFailures: 1 });

    expect(budget.retryAfterSeconds('nobody')).toBeNull();
    expect(budget.trackedSources).toBe(0);
  });

  it('drops expired sources before it drops live ones, so the table cannot grow without bound', () => {
    const budget = new SignatureFailureBudget({ windowMs: 1_000, maxFailures: 1 });

    // Fill the table with expired entries, then record one live source. The table must not grow
    // past the cap, and the live source must still be refused when it spends its budget.
    for (let index = 0; index < 5_000; index++) {
      budget.record(`expired-${index}`, 0);
    }
    budget.record('live', 10_000);
    budget.record('live', 10_001);

    expect(budget.trackedSources).toBeLessThanOrEqual(4_096);
    expect(budget.retryAfterSeconds('live', 10_002)).toBe(1);
  });

  it('forgets a source that verified', () => {
    const budget = new SignatureFailureBudget({ windowMs: 1_000, maxFailures: 1 });

    budget.record('a', 0);
    budget.clear('a');
    expect(budget.retryAfterSeconds('a', 0)).toBeNull();
  });
});
