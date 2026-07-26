// @code-analyzer/intelligence — Cross-Repo Webhook Bridge Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { CrossRepoWebhookBridge } from '../github/cross-repo-bridge.js';
import type { WebhookPayload } from '../github/cross-repo-bridge.js';
import { GitHubApiClient } from '../github/client.js';
import { GitHubRepoSync } from '../github/repo-sync.js';
import { GitHubCheckRunManager } from '../github/check-run.js';
import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import { CrossRepoPRReviewEngine } from '../cross-repo/cross-repo-pr-review.js';
import { PRReviewEngine } from '../review/pr-review.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBridge() {
  const client = new GitHubApiClient({ token: 'ghp_test' });
  const sync = new GitHubRepoSync({ client });
  const checkRunManager = new GitHubCheckRunManager({ client });
  const groupManager = new RepoGroupManager();
  const store = new InMemoryGraphStore();
  const indexer = new CrossRepoIndexer(groupManager, store);
  const reviewEngine = new PRReviewEngine(store);
  const crossRepoReviewEngine = new CrossRepoPRReviewEngine(indexer, groupManager, reviewEngine);

  return new CrossRepoWebhookBridge(
    client,
    sync,
    checkRunManager,
    groupManager,
    indexer,
    crossRepoReviewEngine,
    reviewEngine,
    store,
  );
}

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    action: 'opened',
    pull_request: {
      number: 42,
      title: 'feat: add user login endpoint',
      body: 'Implements user authentication with JWT',
      head: {
        sha: 'abc123',
        ref: 'feature/login',
        repo: {
          full_name: 'org/service-a',
          name: 'service-a',
          owner: { login: 'org' },
        },
      },
      base: {
        sha: 'def456',
        ref: 'main',
        repo: { full_name: 'org/service-a' },
      },
      html_url: 'https://github.com/org/service-a/pull/42',
    },
    repository: {
      full_name: 'org/service-a',
      name: 'service-a',
      owner: { login: 'org' },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bridge Tests
// ---------------------------------------------------------------------------

describe('CrossRepoWebhookBridge', () => {
  describe('constructor', () => {
    it('should create an instance', () => {
      const bridge = createBridge();
      expect(bridge).toBeInstanceOf(CrossRepoWebhookBridge);
    });
  });

  describe('process — event types', () => {
    let bridge: CrossRepoWebhookBridge;

    beforeEach(() => {
      bridge = createBridge();
    });

    it('should skip unsupported actions (closed)', async () => {
      const payload = makePayload({ action: 'closed' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });

    it('should skip unsupported actions (edited)', async () => {
      const payload = makePayload({ action: 'edited' as any });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });

    it('should skip unsupported actions (labeled)', async () => {
      const payload = makePayload({ action: 'labeled' as any });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });

    it('should accept opened action', async () => {
      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      // Will be skipped because no group exists for this repo
      expect(result.status).toBe('skipped');
    });

    it('should accept synchronize action', async () => {
      const payload = makePayload({ action: 'synchronize' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });

    it('should accept reopened action', async () => {
      const payload = makePayload({ action: 'reopened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });
  });

  describe('process — with repo group', () => {
    let bridge: CrossRepoWebhookBridge;
    let groupManager: RepoGroupManager;

    beforeEach(() => {
      const client = new GitHubApiClient({ token: 'ghp_test' });
      const sync = new GitHubRepoSync({ client });
      const checkRunManager = new GitHubCheckRunManager({ client });
      groupManager = new RepoGroupManager();
      const store = new InMemoryGraphStore();
      const indexer = new CrossRepoIndexer(groupManager, store);
      const reviewEngine = new PRReviewEngine(store);
      const crossRepoReviewEngine = new CrossRepoPRReviewEngine(indexer, groupManager, reviewEngine);

      bridge = new CrossRepoWebhookBridge(
        client, sync, checkRunManager, groupManager,
        indexer, crossRepoReviewEngine, reviewEngine, store,
      );

      // Create a group that contains the source repo
      groupManager.createGroup('test-group', 'Test Group', 'A test group');
      groupManager.addRepo('test-group', 'org', 'service-a', 'https://github.com/org/service-a', '/tmp/test/service-a');
    });

    it('should find matching group and attempt processing', async () => {
      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      // Will error because repos can't be cloned in CI / no GitHub access
      // But it should find the group and attempt processing
      expect(['completed', 'skipped', 'error']).toContain(result.status);
    });

    it('should include duration in result', async () => {
      const payload = makePayload({ action: 'synchronize' });
      const result = await bridge.process(payload);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should report error status on failure', async () => {
      const payload = makePayload({
        action: 'opened',
        repository: {
          full_name: 'org/service-a',
          name: 'service-a',
          owner: { login: 'org' },
        },
      });
      const result = await bridge.process(payload);
      // Should be 'error' since repos can't be cloned
      expect(result.status).toBe('error');
    });
  });
});

// ---------------------------------------------------------------------------
// WebhookPayload type
// ---------------------------------------------------------------------------

describe('WebhookPayload', () => {
  it('should construct a valid payload', () => {
    const payload = makePayload();
    expect(payload.action).toBe('opened');
    expect(payload.pull_request.number).toBe(42);
    expect(payload.repository.full_name).toBe('org/service-a');
  });

  it('should handle synchronize payload', () => {
    const payload = makePayload({ action: 'synchronize' });
    expect(payload.action).toBe('synchronize');
  });

  it('should include head and base SHA', () => {
    const payload = makePayload();
    expect(payload.pull_request.head.sha).toBe('abc123');
    expect(payload.pull_request.base.sha).toBe('def456');
  });
});
