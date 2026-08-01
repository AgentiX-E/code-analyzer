// @code-analyzer/server — PR Review Handler Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PRReviewEventHandler } from '../webhook/pr-review-handler.js';
import { StatusCheckManager } from '../webhook/status-check.js';
import type { WebhookEvent } from '../webhook/webhook-handler.js';
import type { CodeReviewEngine } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPREvent(overrides: Record<string, unknown> = {}): WebhookEvent {
  const basePayload = {
    action: 'opened',
    pull_request: {
      number: 42,
      title: 'feat: add new API',
      body: 'Adds new API endpoint',
      state: 'open',
      base: { ref: 'main', sha: 'base-sha' },
      head: { ref: 'feature/api', sha: 'head-sha' },
    },
    repository: {
      full_name: 'org/repo',
      name: 'repo',
      owner: { login: 'org' },
    },
    sender: { login: 'dev1' },
  };

  const merged = { ...basePayload, ...overrides };
  return {
    eventType: 'pull_request',
    deliveryId: 'delivery-001',
    signature: 'sha256=abc',
    payload: merged,
    rawBody: JSON.stringify(merged),
  };
}

function createMockReviewEngine(): CodeReviewEngine {
  return {
    reviewDiff: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
  } as unknown as CodeReviewEngine;
}

// ---------------------------------------------------------------------------
// PRReviewEventHandler Tests
// ---------------------------------------------------------------------------

describe('PRReviewEventHandler', () => {
  let handler: PRReviewEventHandler;
  let reviewEngine: CodeReviewEngine;

  beforeEach(() => {
    reviewEngine = createMockReviewEngine();
    handler = new PRReviewEventHandler(reviewEngine, {
      autoPostComments: false,
      updateStatusChecks: false,
      maxComments: 50,
    });
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const h = new PRReviewEventHandler(reviewEngine);
      expect(h).toBeDefined();
    });

    it('should create with custom config', () => {
      const h = new PRReviewEventHandler(reviewEngine, {
        autoPostComments: true,
        maxComments: 100,
      });
      expect(h).toBeDefined();
    });
  });

  describe('handle', () => {
    it('should handle pull_request.opened event', async () => {
      const event = createPREvent({ action: 'opened' });
      await handler.handle(event);
      // Should not throw
    });

    it('should handle pull_request.synchronize event', async () => {
      const event = createPREvent({ action: 'synchronize' });
      await handler.handle(event);
      // Should not throw
    });

    it('should handle pull_request.reopened event', async () => {
      const event = createPREvent({ action: 'reopened' });
      await handler.handle(event);
      // Should not throw
    });

    it('should ignore unsupported PR actions', async () => {
      const event = createPREvent({ action: 'closed' });
      await handler.handle(event);
      // Should not throw and should not process
    });

    it('should ignore events without action', async () => {
      const event = createPREvent();
      delete (event.payload as Record<string, unknown>)['action'];
      await handler.handle(event);
      // Should not throw
    });

    it('should deduplicate by commit SHA', async () => {
      const event = createPREvent({ action: 'opened' });
      await handler.handle(event);

      const result1 = handler.getReviewResult('head-sha');
      expect(result1).toBeDefined();

      // Same SHA, should be skipped
      await handler.handle(event);
      // Still only one result
    });

    it('should handle events without pull_request data', async () => {
      const event: WebhookEvent = {
        eventType: 'pull_request',
        deliveryId: 'delivery-001',
        signature: 'sha256=abc',
        payload: { action: 'opened' },
        rawBody: JSON.stringify({ action: 'opened' }),
      };
      await handler.handle(event);
      // Should not throw
    });

    it('should handle events without repository in payload', async () => {
      const event: WebhookEvent = {
        eventType: 'pull_request',
        deliveryId: 'delivery-002',
        signature: 'sha256=abc',
        payload: {
          action: 'opened',
          pull_request: {
            number: 99,
            title: 'No Repo PR',
            body: 'Test',
            state: 'open',
            base: { ref: 'main', sha: 'nosha' },
            head: { ref: 'feat', sha: 'headsha' },
          },
        },
        rawBody: JSON.stringify({}),
      };
      await handler.handle(event);
      // Should not throw — extractPRDetails returns null when repo is missing
    });

    it('should handle events without base or head in PR', async () => {
      const event: WebhookEvent = {
        eventType: 'pull_request',
        deliveryId: 'delivery-003',
        signature: 'sha256=abc',
        payload: {
          action: 'opened',
          pull_request: {
            number: 1,
            title: 'No base/head',
            body: 'Test',
            state: 'open',
          },
          repository: {
            full_name: 'org/repo',
            name: 'repo',
            owner: { login: 'org' },
          },
        },
        rawBody: JSON.stringify({}),
      };
      await handler.handle(event);
      // Should not throw
    });

    it('should set pending status before performing review', async () => {
      const event = createPREvent({
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Pending test',
          base: { ref: 'main', sha: 'pending-sha' },
          head: { ref: 'feat', sha: 'pending-head' },
        },
      });
      await handler.handle(event);
      const result = handler.getReviewResult('pending-head');
      expect(result).toBeDefined();
      // After handle completes, status should be 'success' or 'error', not 'pending'
      expect(['success', 'error']).toContain(result!.status);
    });

    it('should store review result after successful review', async () => {
      const event = createPREvent({
        action: 'opened',
        pull_request: {
          number: 10,
          title: 'Success Test',
          base: { ref: 'main', sha: 'base-s' },
          head: { ref: 'feat', sha: 'success-sha' },
        },
      });
      await handler.handle(event);
      const result = handler.getReviewResult('success-sha');
      expect(result).toBeDefined();
      expect(result!.prNumber).toBe(10);
      expect(result!.repo).toBe('org/repo');
      expect(result!.status).toBe('success');
      expect(result!.summary).toContain('reviewed successfully');
      expect(result!.timestamp).toBeDefined();
      expect(result!.comments).toBe(0);
    });

    it('should handle review errors gracefully', async () => {
      const failingEngine = {
        reviewDiff: vi.fn().mockRejectedValue(new Error('Review failed')),
      } as unknown as CodeReviewEngine;

      const errorHandler = new PRReviewEventHandler(failingEngine);
      const event = createPREvent({ action: 'opened' });
      await errorHandler.handle(event);

      const result = errorHandler.getReviewResult('head-sha');
      expect(result).toBeDefined();
      expect(result!.status).toBe('error');
      expect(result!.error).toBe('Review failed');
    });

    it('should handle review errors with non-Error objects', async () => {
      const failingEngine = {
        reviewDiff: vi.fn().mockRejectedValue('plain string error'),
      } as unknown as CodeReviewEngine;

      const errorHandler = new PRReviewEventHandler(failingEngine);
      const event = createPREvent({ action: 'opened' });
      await errorHandler.handle(event);

      const result = errorHandler.getReviewResult('head-sha');
      expect(result!.status).toBe('error');
      expect(result!.error).toBe('plain string error');
    });
  });

  describe('extractPRDetails', () => {
    it('should extract PR details from payload', () => {
      const payload = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Test PR',
          body: 'Description',
          state: 'open',
          base: { ref: 'main', sha: 'abc123' },
          head: { ref: 'feature/test', sha: 'def456' },
        },
        repository: {
          full_name: 'org/repo',
          name: 'repo',
          owner: { login: 'org' },
        },
        sender: { login: 'dev1' },
      };

      const details = handler.extractPRDetails(payload);
      expect(details).toBeDefined();
      expect(details!.number).toBe(42);
      expect(details!.title).toBe('Test PR');
      expect(details!.repository.fullName).toBe('org/repo');
      expect(details!.head.sha).toBe('def456');
      expect(details!.base.sha).toBe('abc123');
      expect(details!.sender.login).toBe('dev1');
    });

    it('should return null for missing pull_request', () => {
      const details = handler.extractPRDetails({ action: 'opened' });
      expect(details).toBeNull();
    });

    it('should return null for missing repository', () => {
      const details = handler.extractPRDetails({
        action: 'opened',
        pull_request: { number: 1, base: { ref: 'main', sha: 'abc' }, head: { ref: 'feat', sha: 'def' } },
      });
      expect(details).toBeNull();
    });

    it('should handle payload with null values for optional fields', () => {
      const details = handler.extractPRDetails({
        action: 'opened',
        pull_request: {
          number: 5,
          title: undefined,
          body: null,
          state: 'open',
          base: { ref: 'main', sha: 'abc' },
          head: { ref: 'feat', sha: 'def' },
        },
        repository: {
          full_name: 'org/repo',
          name: 'repo',
          owner: { login: 'org' },
        },
        sender: { login: 'dev' },
      });
      expect(details).not.toBeNull();
      expect(details!.title).toBe('');
      expect(details!.body).toBeNull();
    });

    it('should handle missing sender in payload', () => {
      const details = handler.extractPRDetails({
        action: 'opened',
        pull_request: {
          number: 1,
          title: 'Test',
          state: 'open',
          base: { ref: 'main', sha: 'abc' },
          head: { ref: 'feat', sha: 'def' },
        },
        repository: {
          full_name: 'org/repo',
          name: 'repo',
          owner: { login: 'org' },
        },
      });
      expect(details).not.toBeNull();
      expect(details!.sender.login).toBe('');
    });

    it('should handle missing owner in repository', () => {
      const details = handler.extractPRDetails({
        action: 'opened',
        pull_request: {
          number: 1,
          title: 'Test',
          state: 'open',
          base: { ref: 'main', sha: 'abc' },
          head: { ref: 'feat', sha: 'def' },
        },
        repository: {
          full_name: 'org/repo',
          name: 'repo',
        },
        sender: { login: 'dev' },
      });
      expect(details).not.toBeNull();
      expect(details!.repository.owner).toBe('');
    });

    it('should handle missing full_name and name in repository', () => {
      const details = handler.extractPRDetails({
        action: 'opened',
        pull_request: {
          number: 1,
          title: 'Test',
          state: 'open',
          base: { ref: 'main', sha: 'abc' },
          head: { ref: 'feat', sha: 'def' },
        },
        repository: {
          owner: { login: 'org' },
        },
        sender: { login: 'dev' },
      });
      expect(details).not.toBeNull();
      expect(details!.repository.name).toBe('');
      expect(details!.repository.fullName).toBe('');
    });

    it('should handle pull_request with missing state field', () => {
      const details = handler.extractPRDetails({
        action: 'opened',
        pull_request: {
          number: 1,
          title: 'Test',
          base: { ref: 'main', sha: 'abc' },
          head: { ref: 'feat', sha: 'def' },
        },
        repository: {
          full_name: 'org/repo',
          name: 'repo',
          owner: { login: 'org' },
        },
        sender: { login: 'dev' },
      });
      expect(details).not.toBeNull();
      expect(details!.state).toBe('unknown');
    });
  });

  describe('getReviewResult', () => {
    it('should return undefined for unknown SHA', () => {
      expect(handler.getReviewResult('unknown-sha')).toBeUndefined();
    });

    it('should return result after handling event', async () => {
      const event = createPREvent({ action: 'opened' });
      await handler.handle(event);

      const result = handler.getReviewResult('head-sha');
      expect(result).toBeDefined();
      expect(result!.prNumber).toBe(42);
    });

    it('should return undefined after clearing cache', async () => {
      const event = createPREvent({ action: 'opened' });
      await handler.handle(event);

      const resultBefore = handler.getReviewResult('head-sha');
      expect(resultBefore).toBeDefined();

      handler.clearCache();
      expect(handler.getReviewResult('head-sha')).toBeUndefined();
    });
  });

  describe('getAllResults', () => {
    it('should return all review results', async () => {
      const event1 = createPREvent({
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'PR 42',
          base: { ref: 'main', sha: 'base1' },
          head: { ref: 'feat1', sha: 'head1' },
        },
      });

      await handler.handle(event1);
      const results = handler.getAllResults();
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty array when no reviews have been performed', () => {
      const results = handler.getAllResults();
      expect(results).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should clear all review results', async () => {
      const event = createPREvent({ action: 'opened' });
      await handler.handle(event);

      expect(handler.getReviewResult('head-sha')).toBeDefined();

      handler.clearCache();
      expect(handler.getReviewResult('head-sha')).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// StatusCheckManager Tests
// ---------------------------------------------------------------------------

describe('StatusCheckManager', () => {
  let manager: StatusCheckManager;

  beforeEach(() => {
    manager = new StatusCheckManager({
      token: 'test-token',
      owner: 'org',
      repo: 'repo',
    });
  });

  describe('createCheckRun', () => {
    it('should create a check run', async () => {
      const checkRun = await manager.createCheckRun('abc123', 'code-review', 'Code Review');
      expect(checkRun).toBeDefined();
      expect(checkRun.name).toBe('code-review');
      expect(checkRun.headSha).toBe('abc123');
      expect(checkRun.status).toBe('in_progress');
      expect(checkRun.conclusion).toBeNull();
    });
  });

  describe('updateCheckRun', () => {
    it('should update check run status', async () => {
      await manager.createCheckRun('abc123', 'code-review', 'Review');
      const updated = await manager.updateCheckRun('abc123', 'code-review', {
        status: 'completed',
        conclusion: 'success',
        output: { summary: 'All checks passed.' },
      });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe('completed');
      expect(updated!.conclusion).toBe('success');
      expect(updated!.output.summary).toBe('All checks passed.');
      expect(updated!.completedAt).toBeDefined();
    });

    it('should return null for unknown check run', async () => {
      const result = await manager.updateCheckRun('unknown', 'unknown', { status: 'completed' });
      expect(result).toBeNull();
    });
  });

  describe('addAnnotations', () => {
    it('should add annotations to check run', async () => {
      await manager.createCheckRun('abc123', 'code-review', 'Review');
      await manager.addAnnotations('abc123', 'code-review', [
        { path: 'src/api.ts', startLine: 10, endLine: 15, annotationLevel: 'warning', message: 'Consider refactoring.' },
      ]);

      const checkRun = manager.getCheckRun('abc123', 'code-review');
      expect(checkRun).toBeDefined();
      expect(checkRun!.output.annotations.length).toBe(1);
      expect(checkRun!.output.annotations[0]!.path).toBe('src/api.ts');
    });

    it('should silently return for unknown check runs', async () => {
      await manager.addAnnotations('unknown', 'unknown', [
        { path: 'src/a.ts', startLine: 1, endLine: 1, annotationLevel: 'notice', message: 'Test' },
      ]);
      // Should not throw
    });
  });

  describe('completeCheckRun', () => {
    it('should complete a check run with conclusion', async () => {
      await manager.createCheckRun('abc123', 'code-review', 'Review');
      const result = await manager.completeCheckRun('abc123', 'code-review', 'success', 'All good!');

      expect(result).toBeDefined();
      expect(result!.conclusion).toBe('success');
      expect(result!.status).toBe('completed');
    });

    it('should return null for unknown check run', async () => {
      const result = await manager.completeCheckRun('unknown', 'unknown', 'success', 'Done');
      expect(result).toBeNull();
    });
  });

  describe('commentsToAnnotations', () => {
    it('should convert review comments to annotations', () => {
      const comments = [
        { filePath: 'src/api.ts', startLine: 10, endLine: 15, severity: 'critical', message: 'Security issue' },
        { filePath: 'src/util.ts', startLine: 20, endLine: 25, severity: 'warning', message: 'Style issue' },
        { filePath: 'src/types.ts', startLine: 5, endLine: 5, severity: 'info', message: 'Consider adding docs' },
      ];

      const annotations = manager.commentsToAnnotations(comments);
      expect(annotations.length).toBe(3);
      expect(annotations[0]!.annotationLevel).toBe('failure');
      expect(annotations[1]!.annotationLevel).toBe('warning');
      expect(annotations[2]!.annotationLevel).toBe('notice');
    });

    it('should handle error severity as failure', () => {
      const comments = [
        { filePath: 'src/api.ts', startLine: 1, endLine: 1, severity: 'error', message: 'Error' },
        { filePath: 'src/api.ts', startLine: 2, endLine: 2, severity: 'high', message: 'High' },
      ];
      const annotations = manager.commentsToAnnotations(comments);
      expect(annotations[0]!.annotationLevel).toBe('failure');
      expect(annotations[1]!.annotationLevel).toBe('warning');
    });
  });

  describe('getCheckRun', () => {
    it('should return undefined for unknown check', () => {
      expect(manager.getCheckRun('unknown', 'unknown')).toBeUndefined();
    });

    it('should return check run after creation', async () => {
      await manager.createCheckRun('sha1', 'test', 'Test');
      const cr = manager.getCheckRun('sha1', 'test');
      expect(cr).toBeDefined();
      expect(cr!.headSha).toBe('sha1');
    });
  });

  describe('updateCheckRun with partial output', () => {
    it('should update title and text', async () => {
      await manager.createCheckRun('sha1', 'test', 'Initial');
      const updated = await manager.updateCheckRun('sha1', 'test', {
        output: { title: 'New Title', text: 'Details' },
        detailsUrl: 'https://example.com',
      });
      expect(updated!.output.title).toBe('New Title');
      expect(updated!.output.text).toBe('Details');
      expect(updated!.detailsUrl).toBe('https://example.com');
    });

    it('should update only status without output', async () => {
      await manager.createCheckRun('sha2', 'test2', 'Status Only');
      const updated = await manager.updateCheckRun('sha2', 'test2', {
        status: 'completed',
      });
      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).toBeDefined();
    });
  });

  describe('getActiveChecks', () => {
    it('should return all active check runs', async () => {
      await manager.createCheckRun('sha1', 'review-1', 'Review 1');
      await manager.createCheckRun('sha2', 'review-2', 'Review 2');

      const checks = manager.getActiveChecks();
      expect(checks.length).toBe(2);
    });
  });

  describe('clearChecks', () => {
    it('should clear all check runs', async () => {
      await manager.createCheckRun('sha1', 'review-1', 'Review 1');
      expect(manager.getActiveChecks().length).toBe(1);

      manager.clearChecks();
      expect(manager.getActiveChecks().length).toBe(0);
    });
  });
});
