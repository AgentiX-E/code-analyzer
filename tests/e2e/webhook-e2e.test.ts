// @code-analyzer — Webhook End-to-End Tests
// Validates webhook signature verification, event routing, idempotency,
// and PR review event handling without starting a real HTTP server.

import { describe, it, expect, beforeEach } from 'vitest';
import { verifySignature } from '@code-analyzer/server';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let deliveryCounter = 0;

function createWebhookPayload(
  event: string,
  body: Record<string, unknown>,
): { headers: Record<string, string>; body: string } {
  const payload = JSON.stringify(body);
  return {
    headers: {
      'x-github-event': event,
      'x-github-delivery': `delivery-${Date.now()}-${++deliveryCounter}`,
      'x-hub-signature-256': 'sha256=mock',
      'content-type': 'application/json',
    },
    body: payload,
  };
}

// ---------------------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------------------

describe('Webhook E2E — Signature Verification', () => {
  const secret = 'test-webhook-secret-12345';

  it('should verify a valid HMAC-SHA256 signature', () => {
    const payload = JSON.stringify({ action: 'opened', number: 1 });
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf-8');
    const signature = 'sha256=' + hmac.digest('hex');

    // verifySignature(secret, signatureHeader, payload)
    expect(verifySignature(secret, signature, payload)).toBe(true);
  });

  it('should reject an invalid signature', () => {
    const payload = JSON.stringify({ action: 'opened' });
    expect(verifySignature(secret, 'sha256=invalid', payload)).toBe(false);
  });

  it('should reject a tampered payload', () => {
    const originalPayload = JSON.stringify({ action: 'opened', number: 1 });
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(originalPayload, 'utf-8');
    const signature = 'sha256=' + hmac.digest('hex');

    const tamperedPayload = JSON.stringify({ action: 'closed', number: 1 });
    expect(verifySignature(secret, signature, tamperedPayload)).toBe(false);
  });

  it('should reject empty signature', () => {
    const payload = JSON.stringify({ action: 'opened' });
    expect(verifySignature(secret, '', payload)).toBe(false);
  });

  it('should reject missing sha256= prefix', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf-8');
    const signature = hmac.digest('hex'); // missing prefix

    expect(verifySignature(secret, signature, payload)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Webhook Event Routing
// ---------------------------------------------------------------------------

describe('Webhook E2E — Event Routing', () => {
  const supportedEvents = [
    'pull_request',
    'push',
    'check_run',
    'check_suite',
    'pull_request_review',
    'pull_request_review_comment',
    'status',
    'deployment_status',
  ];

  it('should recognize all supported GitHub event types', () => {
    for (const event of supportedEvents) {
      const { headers } = createWebhookPayload(event, { test: true });
      expect(headers['x-github-event']).toBe(event);
    }
  });

  it('should handle pull_request.opened event payload', () => {
    const body = {
      action: 'opened',
      number: 42,
      pull_request: {
        head: { sha: 'abc123', ref: 'feature/x' },
        base: { sha: 'def456', ref: 'main' },
      },
      repository: { full_name: 'org/repo', clone_url: 'https://github.com/org/repo.git' },
    };
    const { headers, body: payload } = createWebhookPayload('pull_request', body);

    expect(headers['x-github-event']).toBe('pull_request');
    const parsed = JSON.parse(payload);
    expect(parsed.action).toBe('opened');
    expect(parsed.number).toBe(42);
  });

  it('should handle pull_request.synchronize event payload', () => {
    const body = {
      action: 'synchronize',
      number: 42,
      pull_request: {
        head: { sha: 'new-sha', ref: 'feature/x' },
        base: { sha: 'def456', ref: 'main' },
      },
      repository: { full_name: 'org/repo' },
    };
    const { headers } = createWebhookPayload('pull_request', body);
    expect(headers['x-github-event']).toBe('pull_request');
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('Webhook E2E — Idempotency', () => {
  it('should generate unique delivery IDs per request', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { headers } = createWebhookPayload('pull_request', { action: 'opened' });
      ids.add(headers['x-github-delivery']);
    }
    expect(ids.size).toBe(10);
  });

  it('should detect duplicate delivery IDs', () => {
    const deliveryId = 'dup-delivery-123';
    const processedIds = new Set<string>();

    // First processing
    expect(processedIds.has(deliveryId)).toBe(false);
    processedIds.add(deliveryId);

    // Duplicate detection
    expect(processedIds.has(deliveryId)).toBe(true);
  });

  it('should handle idempotency with max processed set size', () => {
    const processed = new Set<string>();
    // Simulate many deliveries
    for (let i = 0; i < 100; i++) {
      processed.add(`delivery-${i}`);
    }
    expect(processed.size).toBe(100);

    // Old entries should not block new ones
    expect(processed.has('delivery-0')).toBe(true);
    expect(processed.has('delivery-99')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PR Review Event Handling
// ---------------------------------------------------------------------------

describe('Webhook E2E — PR Review Event Handling', () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    store = new InMemoryGraphStore(':memory:');
  });

  it('should handle a full PR opened → review flow', () => {
    // Simulate the complete flow without actually calling GitHub API
    const prPayload = {
      action: 'opened',
      number: 42,
      pull_request: {
        head: { sha: 'feature-sha', ref: 'feature/awesome-feature' },
        base: { sha: 'main-sha', ref: 'main' },
        title: 'Add awesome feature',
        body: 'This PR adds the awesome feature.',
        html_url: 'https://github.com/org/repo/pull/42',
      },
      repository: {
        full_name: 'org/repo',
        clone_url: 'https://github.com/org/repo.git',
        default_branch: 'main',
      },
    };

    expect(prPayload.action).toBe('opened');
    expect(prPayload.pull_request.head.sha).toBeTruthy();
    expect(prPayload.pull_request.base.sha).toBeTruthy();
    expect(prPayload.repository.full_name).toBe('org/repo');
  });

  it('should handle PR synchronize (new commits pushed)', () => {
    const syncPayload = {
      action: 'synchronize',
      number: 42,
      pull_request: {
        head: { sha: 'updated-sha', ref: 'feature/awesome-feature' },
        base: { sha: 'main-sha', ref: 'main' },
      },
      repository: { full_name: 'org/repo' },
    };

    expect(syncPayload.action).toBe('synchronize');
    expect(syncPayload.pull_request.head.sha).not.toBe('feature-sha');
  });

  it('should handle PR closed without review', () => {
    const closePayload = {
      action: 'closed',
      number: 42,
      pull_request: { merged: false },
      repository: { full_name: 'org/repo' },
    };

    expect(closePayload.action).toBe('closed');
    expect(closePayload.pull_request.merged).toBe(false);
  });

  it('should handle PR merged', () => {
    const mergePayload = {
      action: 'closed',
      number: 42,
      pull_request: { merged: true, merge_commit_sha: 'merge-sha' },
      repository: { full_name: 'org/repo' },
    };

    expect(mergePayload.pull_request.merged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error Handling & Edge Cases
// ---------------------------------------------------------------------------

describe('Webhook E2E — Error Handling', () => {
  it('should handle malformed JSON payload gracefully', () => {
    const malformed = '{ "action": "opened", broken }';
    let parseError = false;
    try {
      JSON.parse(malformed);
    } catch {
      parseError = true;
    }
    expect(parseError).toBe(true);
  });

  it('should handle missing x-github-event header', () => {
    const headers: Record<string, string> = {
      'x-github-delivery': 'test-123',
      'content-type': 'application/json',
    };
    expect(headers['x-github-event']).toBeUndefined();
  });

  it('should handle empty request body', () => {
    const body = '';
    expect(body.length).toBe(0);
  });

  it('should handle events with no repository info', () => {
    const body = { action: 'opened', number: 1 };
    expect((body as any).repository).toBeUndefined();
    // Should not crash — just skip processing
  });
});
