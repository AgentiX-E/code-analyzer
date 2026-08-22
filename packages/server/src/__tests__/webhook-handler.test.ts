// @code-analyzer/server — Webhook Handler Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { GitHubWebhookHandler, parseWebhookEvent } from '../webhook/webhook-handler.js';
import type { EventHandler, WebhookEvent } from '../webhook/webhook-handler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signPayload(secret: string, payload: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf-8');
  return `sha256=${hmac.digest('hex')}`;
}

function createMockHandler(): EventHandler & { handled: WebhookEvent[] } {
  const handled: WebhookEvent[] = [];
  return {
    handled,
    async handle(event: WebhookEvent) {
      handled.push(event);
    },
  };
}

function createMockFailingHandler(): EventHandler & { handled: WebhookEvent[] } {
  const handled: WebhookEvent[] = [];
  return {
    handled,
    async handle(_event: WebhookEvent) {
      handled.push(_event);
      throw new Error('Handler failed');
    },
  };
}

const SECRET = 'test-secret-12345';
const VALID_PR_PAYLOAD = JSON.stringify({
  action: 'opened',
  pull_request: {
    number: 42,
    title: 'Test PR',
    head: { sha: 'abc123' },
  },
  repository: { full_name: 'org/repo' },
});

// ---------------------------------------------------------------------------
// GitHubWebhookHandler Tests
// ---------------------------------------------------------------------------

describe('GitHubWebhookHandler', () => {
  let handler: GitHubWebhookHandler;

  beforeEach(() => {
    handler = new GitHubWebhookHandler({ secret: SECRET });
  });

  describe('constructor', () => {
    it('should create with secret', () => {
      const h = new GitHubWebhookHandler({ secret: 'my-secret' });
      expect(h).toBeDefined();
    });

    it('should create with allowed events', () => {
      const h = new GitHubWebhookHandler({
        secret: 'my-secret',
        allowedEvents: ['pull_request', 'push'],
      });
      expect(h).toBeDefined();
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', () => {
      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);
      expect(handler.verifySignature(sig, VALID_PR_PAYLOAD)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const sig = signPayload('wrong-secret', VALID_PR_PAYLOAD);
      expect(handler.verifySignature(sig, VALID_PR_PAYLOAD)).toBe(false);
    });

    it('should reject an empty signature', () => {
      expect(handler.verifySignature('', VALID_PR_PAYLOAD)).toBe(false);
    });

    it('should reject a signature without prefix', () => {
      expect(handler.verifySignature('abc123', VALID_PR_PAYLOAD)).toBe(false);
    });

    it('should skip verification when no secret configured', () => {
      const noSecretHandler = new GitHubWebhookHandler({ secret: '' });
      expect(noSecretHandler.verifySignature('any-signature', 'payload')).toBe(true);
    });
  });

  describe('on', () => {
    it('should register an event handler', () => {
      const mockHandler = createMockHandler();
      handler.on('pull_request', mockHandler);
      expect(handler.getRegisteredEvents()).toContain('pull_request');
    });

    it('should register multiple handlers for the same event', () => {
      const h1 = createMockHandler();
      const h2 = createMockHandler();
      handler.on('pull_request', h1);
      handler.on('pull_request', h2);
      expect(handler.getRegisteredEvents()).toContain('pull_request');
    });
  });

  describe('process', () => {
    it('should process a valid pull_request event', async () => {
      const mockHandler = createMockHandler();
      handler.on('pull_request', mockHandler);

      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);
      const result = await handler.process('pull_request', 'delivery-001', sig, VALID_PR_PAYLOAD);

      expect(result.success).toBe(true);
      expect(result.eventType).toBe('pull_request');
      expect(result.deliveryId).toBe('delivery-001');
      expect(mockHandler.handled.length).toBe(1);
      expect(mockHandler.handled[0]!.eventType).toBe('pull_request');
    });

    it('should reject events with invalid signature', async () => {
      const result = await handler.process(
        'pull_request',
        'delivery-001',
        'bad-sig',
        VALID_PR_PAYLOAD,
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid webhook signature');
    });

    it('should reject events with missing event type', async () => {
      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);
      const result = await handler.process('', 'delivery-001', sig, VALID_PR_PAYLOAD);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing event type header');
    });

    it('should reject events with invalid JSON payload', async () => {
      const sig = signPayload(SECRET, '{invalid json}');
      const result = await handler.process('pull_request', 'delivery-001', sig, '{invalid json}');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid JSON payload');
    });

    it('should enforce idempotency via delivery ID', async () => {
      const mockHandler = createMockHandler();
      handler.on('pull_request', mockHandler);

      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);

      // First delivery
      await handler.process('pull_request', 'delivery-dup', sig, VALID_PR_PAYLOAD);
      expect(mockHandler.handled.length).toBe(1);

      // Duplicate delivery — should be skipped
      await handler.process('pull_request', 'delivery-dup', sig, VALID_PR_PAYLOAD);
      expect(mockHandler.handled.length).toBe(1); // Still 1, not re-processed
    });

    it('should reject non-allowed event types', async () => {
      const restrictedHandler = new GitHubWebhookHandler({
        secret: SECRET,
        allowedEvents: ['pull_request'],
      });

      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);
      const result = await restrictedHandler.process('push', 'delivery-001', sig, VALID_PR_PAYLOAD);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not in the allowed list');
    });

    it('should continue processing when one handler fails', async () => {
      const failingHandler = createMockFailingHandler();
      const successHandler = createMockHandler();

      handler.on('pull_request', failingHandler);
      handler.on('pull_request', successHandler);

      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);
      const result = await handler.process('pull_request', 'delivery-001', sig, VALID_PR_PAYLOAD);

      // Second handler should still have been called
      expect(successHandler.handled.length).toBe(1);
    });

    it('should handle events with no registered handlers', async () => {
      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);
      const result = await handler.process('pull_request', 'delivery-001', sig, VALID_PR_PAYLOAD);
      expect(result.success).toBe(true); // No handlers = not an error
    });
  });

  describe('clearCache', () => {
    it('should clear processed deliveries cache', async () => {
      const mockHandler = createMockHandler();
      handler.on('pull_request', mockHandler);

      const sig = signPayload(SECRET, VALID_PR_PAYLOAD);
      await handler.process('pull_request', 'delivery-001', sig, VALID_PR_PAYLOAD);
      expect(handler.cacheSize).toBe(1);

      handler.clearCache();
      expect(handler.cacheSize).toBe(0);
    });
  });

  describe('getRegisteredEvents', () => {
    it('should return registered event types', () => {
      handler.on('pull_request', createMockHandler());
      handler.on('push', createMockHandler());

      const events = handler.getRegisteredEvents();
      expect(events).toContain('pull_request');
      expect(events).toContain('push');
    });

    it('should return empty array when no handlers registered', () => {
      expect(handler.getRegisteredEvents()).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// parseWebhookEvent Tests
// ---------------------------------------------------------------------------

describe('parseWebhookEvent', () => {
  it('should parse event from headers', () => {
    const headers = {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-123',
      'x-hub-signature-256': 'sha256=abc',
    };

    const event = parseWebhookEvent(headers, '{"test": true}');
    expect(event).toBeDefined();
    expect(event!.eventType).toBe('pull_request');
    expect(event!.deliveryId).toBe('delivery-123');
    expect(event!.signature).toBe('sha256=abc');
  });

  it('should handle missing delivery ID', () => {
    const headers = {
      'x-github-event': 'push',
    };

    const event = parseWebhookEvent(headers, '{}');
    expect(event).toBeDefined();
    expect(event!.deliveryId).toBe('unknown');
  });

  it('should return null for missing event type', () => {
    const headers = {
      'x-github-delivery': 'delivery-123',
    };

    const event = parseWebhookEvent(headers, '{}');
    expect(event).toBeNull();
  });

  it('should handle case-insensitive headers', () => {
    const headers = {
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-abc',
    };

    const event = parseWebhookEvent(headers, '{}');
    expect(event).toBeDefined();
    expect(event!.eventType).toBe('pull_request');
  });

  it('should handle array header values', () => {
    const headers = {
      'x-github-event': ['pull_request'],
      'x-github-delivery': ['delivery-xyz'],
    };

    const event = parseWebhookEvent(headers, '{}');
    expect(event).toBeDefined();
    expect(event!.eventType).toBe('pull_request');
  });
});
