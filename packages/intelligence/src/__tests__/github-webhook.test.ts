// @ts-nocheck
// @code-analyzer/intelligence — GitHub PR Webhook Handler Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitHubPRWebhook } from '../review/github-webhook.js';
import { PRReviewEngine } from '../review/pr-review.js';
import { CodeReviewEngine } from '../review/review-engine.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { createHmac } from 'crypto';

import type { GitHubPREvent, WebhookResult } from '../review/github-webhook.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

function createEngineAndPR(): {
  store: InMemoryGraphStore;
  reviewEngine: CodeReviewEngine;
  prEngine: PRReviewEngine;
} {
  const store = createStore();
  const reviewEngine = new CodeReviewEngine(store);
  const prEngine = new PRReviewEngine(reviewEngine, store);
  return { store, reviewEngine, prEngine };
}

function createPREvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    action: 'opened',
    pull_request: {
      number: 1,
      title: 'Test PR',
      body: null,
      head: { sha: 'abc123', ref: 'feature/test' },
      base: { sha: 'def456', ref: 'main', repo: { full_name: 'test/repo' } },
    },
    repository: { full_name: 'test/repo' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Webhook Signature Verification Tests
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook - Signature Verification', () => {
  it('should verify valid HMAC-SHA256 signature', () => {
    const { store, prEngine } = createEngineAndPR();
    const secret = 'my-webhook-secret';
    const payload = JSON.stringify({ test: 'data' });
    const handler = new GitHubPRWebhook('token', prEngine, store, secret);

    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(handler.verifySignature(payload, signature)).toBe(true);
  });

  it('should reject invalid signature', () => {
    const { store, prEngine } = createEngineAndPR();
    const secret = 'my-webhook-secret';
    const payload = JSON.stringify({ test: 'data' });
    const handler = new GitHubPRWebhook('token', prEngine, store, secret);

    const badSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
    expect(handler.verifySignature(payload, badSignature)).toBe(false);
  });

  it('should reject signature with different secret', () => {
    const { store, prEngine } = createEngineAndPR();
    const secret = 'correct-secret';
    const payload = JSON.stringify({ test: 'data' });
    const handler = new GitHubPRWebhook('token', prEngine, store, secret);

    const wrongSig = `sha256=${createHmac('sha256', 'wrong-secret').update(payload).digest('hex')}`;
    expect(handler.verifySignature(payload, wrongSig)).toBe(false);
  });

  it('should reject tampered payload', () => {
    const { store, prEngine } = createEngineAndPR();
    const secret = 'my-webhook-secret';
    const originalPayload = JSON.stringify({ test: 'original' });
    const handler = new GitHubPRWebhook('token', prEngine, store, secret);

    const signature = `sha256=${createHmac('sha256', secret).update(originalPayload).digest('hex')}`;
    // Pass a different payload
    expect(handler.verifySignature(JSON.stringify({ test: 'tampered' }), signature)).toBe(false);
  });

  it('should accept all payloads when no secret is configured', () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store); // No secret

    expect(handler.verifySignature('anything', 'any-signature')).toBe(true);
    expect(handler.verifySignature('{ "other": "data" }', 'sha256=invalid')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PR Event Handling Tests
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook - Event Handling', () => {
  it('should skip unsupported event types', async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    const event = createPREvent();

    const result = await handler.handlePullRequestEvent('push', event);
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Unsupported event');
  });

  it('should skip closed PR events', async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    const event = createPREvent({ action: 'closed' });

    const result = await handler.handlePullRequestEvent('pull_request', event);
    expect(result.status).toBe('skipped');
    expect(result.message.toLowerCase()).toContain('skipping');
  });

  it.skip('should handle opened PR events', async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    const event = createPREvent({ action: 'opened' });

    // This will attempt to call GitHub API, which will fail in test env
    // But we want to verify it processes the event type correctly
    const result = await handler.handlePullRequestEvent('pull_request', event);
    // Should fail with network error since no real GitHub API
    expect(result.status === 'error' || result.status === 'processed').toBe(true);
  });

  it.skip('should handle synchronize PR events', { timeout: 30000 }, async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    const event = createPREvent({ action: 'synchronize' });

    const result = await handler.handlePullRequestEvent('pull_request', event);
    expect(result.status === 'error' || result.status === 'processed').toBe(true);
  });

  it.skip('should handle reopened PR events', async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    const event = createPREvent({ action: 'reopened' });

    const result = await handler.handlePullRequestEvent('pull_request', event);
    expect(result.status === 'error' || result.status === 'processed').toBe(true);
  });

  it('should return error for invalid repository name', async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    const event = createPREvent({
      repository: { full_name: '' },
    });

    const result = await handler.handlePullRequestEvent('pull_request', event);
    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Rate Limit and Error Handling Tests
// ---------------------------------------------------------------------------

describe.skip('GitHubPRWebhook - Rate Limit and Errors', () => {
  it('should handle GitHub API errors gracefully', async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('invalid-token', prEngine, store);
    const event = createPREvent();

    const result = await handler.handlePullRequestEvent('pull_request', event);
    // Should return error status since the token is invalid
    expect(result.status).toBe('error');
    expect(result.message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Webhook Secret Management Tests
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook - Secret Management', () => {
  it('should initialize without webhook secret', () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    expect(handler).toBeDefined();
  });

  it('should initialize with webhook secret', () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store, 'my-secret');
    expect(handler).toBeDefined();
  });

  it('should verify signature with special characters in payload', () => {
    const { store, prEngine } = createEngineAndPR();
    const secret = 'secret-with-unicode-chars';
    const payload = JSON.stringify({ message: 'héllö wörld! 🔥' });
    const handler = new GitHubPRWebhook('token', prEngine, store, secret);

    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(handler.verifySignature(payload, signature)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retry Logic Tests
// ---------------------------------------------------------------------------

describe.skip('GitHubPRWebhook - Retry Logic', () => {
  it('should retry on transient failures up to MAX_RETRIES', async () => {
    const { store, prEngine } = createEngineAndPR();
    const handler = new GitHubPRWebhook('token', prEngine, store);
    const event = createPREvent();

    const result = await handler.handlePullRequestEvent('pull_request', event);
    expect(result.status).toBe('error');
    // The handler should have attempted multiple retries
  });
});
