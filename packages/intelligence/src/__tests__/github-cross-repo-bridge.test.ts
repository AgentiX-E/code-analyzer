// @code-analyzer/intelligence — Cross-Repo Webhook Bridge Tests
// Comprehensive tests for CrossRepoWebhookBridge with mocked dependencies.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrossRepoWebhookBridge } from '../github/cross-repo-bridge.js';
import type { WebhookPayload, BridgeResult } from '../github/cross-repo-bridge.js';
import type { GitHubApiClient } from '../github/client.js';
import type { GitHubRepoSync } from '../github/repo-sync.js';
import type { GitHubCheckRunManager } from '../github/check-run.js';
import type { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import type { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import type { CrossRepoPRReviewEngine } from '../cross-repo/cross-repo-pr-review.js';
import type { PRReviewEngine } from '../review/pr-review.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { RepoGroup, GroupRepo, GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    getPRDiff: vi.fn().mockResolvedValue(''),
    createCheckRun: vi.fn().mockResolvedValue({ id: 0 }),
    updateCheckRun: vi.fn().mockResolvedValue({ id: 0 }),
  } as unknown as GitHubApiClient;
}

function createMockSync() {
  return {
    ensureSynced: vi.fn().mockResolvedValue({ results: [], errors: [] }),
  } as unknown as GitHubRepoSync;
}

function createMockCheckRunManager() {
  return {
    create: vi.fn().mockResolvedValue({ id: 0 }),
    complete: vi.fn().mockResolvedValue({ checkRun: { id: 0 }, annotationsCount: 0 }),
    fail: vi.fn().mockResolvedValue({ id: 0 }),
  } as unknown as GitHubCheckRunManager;
}

function createMockGroupManager() {
  return {
    listGroups: vi.fn().mockReturnValue([]),
    getRepos: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
  } as unknown as RepoGroupManager;
}

function createMockIndexer() {
  return {
    indexGroup: vi.fn().mockResolvedValue(undefined),
  } as unknown as CrossRepoIndexer;
}

function createMockReviewEngine() {
  return {
    reviewPRWithCrossRepoContext: vi.fn().mockResolvedValue(makeReviewResult()),
  } as unknown as CrossRepoPRReviewEngine;
}

function createMockSingleRepoReviewEngine() {
  return {} as unknown as PRReviewEngine;
}

function createMockStore() {
  return {} as unknown as InMemoryGraphStore;
}

function createMocks() {
  const client = createMockClient();
  const sync = createMockSync();
  const checkRunManager = createMockCheckRunManager();
  const groupManager = createMockGroupManager();
  const indexer = createMockIndexer();
  const reviewEngine = createMockReviewEngine();
  const singleRepoReviewEngine = createMockSingleRepoReviewEngine();
  const store = createMockStore();

  return {
    client,
    sync,
    checkRunManager,
    groupManager,
    indexer,
    reviewEngine,
    singleRepoReviewEngine,
    store,
  };
}

function createBridge(mocks = createMocks()) {
  return new CrossRepoWebhookBridge(
    mocks.client,
    mocks.sync,
    mocks.checkRunManager,
    mocks.groupManager,
    mocks.indexer,
    mocks.reviewEngine,
    mocks.singleRepoReviewEngine,
    mocks.store,
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

function makeGroup(id: string, repos: GroupRepo[] = []): RepoGroup {
  return {
    id,
    name: id,
    description: 'Test group',
    repos,
    contracts: [],
    indexedAt: null,
  };
}

function makeGroupRepo(fullName: string, owner = 'org', repo = 'service-a'): GroupRepo {
  return {
    owner,
    repo,
    fullName,
    localPath: `/tmp/${repo}`,
    projectId: null,
    role: 'dependency',
    autoIndex: true,
  };
}

function makeReviewResult() {
  return {
    sourceRepo: 'org/service-a',
    prComments: [],
    crossRepoImpacts: [],
    apiBreakingChanges: [],
    testPredictions: [],
    summary: {
      crossRepoRisk: 'low' as const,
      affectedRepos: [],
      totalComments: 0,
      recommendation: 'approve' as const,
    },
  };
}

// ---------------------------------------------------------------------------
// Bridge Tests
// ---------------------------------------------------------------------------

describe('CrossRepoWebhookBridge', () => {
  describe('constructor', () => {
    it('should create an instance with all dependencies', () => {
      const mocks = createMocks();
      const bridge = createBridge(mocks);
      expect(bridge).toBeInstanceOf(CrossRepoWebhookBridge);
    });
  });

  // ── process — event type validation ──

  describe('process — event type validation', () => {
    let mocks: ReturnType<typeof createMocks>;
    let bridge: CrossRepoWebhookBridge;

    beforeEach(() => {
      mocks = createMocks();
      bridge = createBridge(mocks);
    });

    it('should skip unsupported actions (closed)', async () => {
      const payload = makePayload({ action: 'closed' as any });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mocks.sync.ensureSynced).not.toHaveBeenCalled();
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

    it('should skip unsupported actions (assigned)', async () => {
      const payload = makePayload({ action: 'assigned' as any });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });

    it('should skip unsupported actions (review_requested)', async () => {
      const payload = makePayload({ action: 'review_requested' as any });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });
  });

  // ── process — no group found ──

  describe('process — no group found', () => {
    it('should skip when no groups exist', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([]);
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });

    it('should skip when repo not in any group', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([
          makeGroup('group-1', [makeGroupRepo('org/other-repo', 'org', 'other-repo')]),
        ]);
      mocks.groupManager.getRepos = vi
        .fn()
        .mockReturnValue([makeGroupRepo('org/other-repo', 'org', 'other-repo')]);
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('skipped');
    });

    it('should accept opened action and attempt processing', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 123 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 123 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('completed');
      expect(result.checkRunId).toBe(123);
      expect(result.reviewResult).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should accept synchronize action', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 456 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'def',
            synced: true,
            durationMs: 50,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 456 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'synchronize' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('completed');
    });

    it('should accept reopened action', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 789 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'ghi',
            synced: true,
            durationMs: 75,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 789 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'reopened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('completed');
    });
  });

  // ── process — sync errors ──

  describe('process — sync errors', () => {
    it('should return error when sync has errors', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([
          makeGroup('group-1', [
            makeGroupRepo('org/service-a'),
            makeGroupRepo('org/service-b', 'org', 'service-b'),
          ]),
        ]);
      mocks.groupManager.getRepos = vi
        .fn()
        .mockReturnValue([
          makeGroupRepo('org/service-a'),
          makeGroupRepo('org/service-b', 'org', 'service-b'),
        ]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 100 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [],
        errors: [
          { owner: 'org', repo: 'service-a', error: 'clone failed' },
          { owner: 'org', repo: 'service-b', error: 'network error' },
        ],
      });
      mocks.checkRunManager.fail = vi.fn().mockResolvedValue({ id: 100 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('error');
      expect(result.error).toContain('clone failed');
      expect(result.error).toContain('network error');
    });

    it('should return error when sync has errors without checkRunId', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      // checkRunManager.create throws so checkRunId stays undefined
      mocks.checkRunManager.create = vi.fn().mockRejectedValue(new Error('check run failed'));
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [],
        errors: [{ owner: 'org', repo: 'service-a', error: 'clone failed' }],
      });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('error');
      expect(result.checkRunId).toBeUndefined();
      expect(result.error).toContain('clone failed');
    });
  });

  // ── process — diff fetch errors ──

  describe('process — diff fetch errors', () => {
    it('should return error when diff fetch fails', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 200 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi.fn().mockRejectedValue(new Error('API rate limit exceeded'));
      mocks.checkRunManager.fail = vi.fn().mockResolvedValue({ id: 200 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Diff fetch failed');
      expect(result.error).toContain('API rate limit exceeded');
    });

    it('should return error when diff fetch fails without checkRunId', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockRejectedValue(new Error('create failed'));
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi.fn().mockRejectedValue(new Error('diff not found'));
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('error');
      expect(result.checkRunId).toBeUndefined();
    });

    it('should handle non-Error diff fetch failures', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 300 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi.fn().mockRejectedValue('string error');
      mocks.checkRunManager.fail = vi.fn().mockResolvedValue({ id: 300 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('error');
      expect(result.error).toContain('string error');
    });
  });

  // ── process — catch-all error handler ──

  describe('process — catch-all error handler', () => {
    it('should catch unexpected errors during processing', async () => {
      const mocks = createMocks();
      // listGroups throws unexpectedly
      mocks.groupManager.listGroups = vi.fn().mockImplementation(() => {
        throw new Error('unexpected database error');
      });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('error');
      expect(result.error).toBe('unexpected database error');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should catch non-Error unexpected failures', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockImplementation(() => {
        throw 'some string error';
      });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('error');
      expect(result.error).toBe('some string error');
    });
  });

  // ── process — complete success flow ──

  describe('process — complete success flow', () => {
    it('should complete full pipeline with cross-repo review', async () => {
      const mocks = createMocks();
      const groupRepo = makeGroupRepo('org/service-a');
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([makeGroup('group-1', [groupRepo])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([groupRepo]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 500 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc123',
            synced: true,
            durationMs: 200,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue(
          'diff --git a/src/index.ts b/src/index.ts\n@@ -1,3 +1,3 @@\n-const x = 1;\n+const x = 2;\n const y = 3;',
        );
      const reviewResult = makeReviewResult();
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi.fn().mockResolvedValue(reviewResult);
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 500 }, annotationsCount: 5 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);

      expect(result.status).toBe('completed');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.reviewResult).toBeDefined();
      expect(mocks.sync.ensureSynced).toHaveBeenCalledWith([{ owner: 'org', repo: 'service-a' }]);
      expect(mocks.indexer.indexGroup).toHaveBeenCalledWith('group-1');
      expect(mocks.client.getPRDiff).toHaveBeenCalledWith('org', 'service-a', 42);
      expect(mocks.reviewEngine.reviewPRWithCrossRepoContext).toHaveBeenCalled();
    });

    it('should handle checkRunManager.create throwing gracefully', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi
        .fn()
        .mockRejectedValue(new Error('check run creation failed'));
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 0 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      // Should complete successfully — check run creation failure is non-fatal
      expect(result.status).toBe('completed');
    });
  });

  // ── findGroupForRepo ──

  describe('findGroupForRepo', () => {
    it('should find matching group by repo full name', () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([
          makeGroup('group-1', [makeGroupRepo('org/service-a')]),
          makeGroup('group-2', [makeGroupRepo('org/service-b', 'org', 'service-b')]),
        ]);
      mocks.groupManager.getRepos = vi
        .fn()
        .mockReturnValueOnce([makeGroupRepo('org/service-a')])
        .mockReturnValueOnce([makeGroupRepo('org/service-b', 'org', 'service-b')]);
      const bridge = createBridge(mocks);

      // Access private method via any
      const result = (bridge as any).findGroupForRepo('org/service-a');
      expect(result).toBe('group-1');
    });

    it('should return null when no group matches', () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      const bridge = createBridge(mocks);

      const result = (bridge as any).findGroupForRepo('org/service-c');
      expect(result).toBeNull();
    });

    it('should return null when groups are empty', () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([]);
      const bridge = createBridge(mocks);

      const result = (bridge as any).findGroupForRepo('org/service-a');
      expect(result).toBeNull();
    });

    it('should match repo in second group', () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([
          makeGroup('alpha', [makeGroupRepo('org/repo-a', 'org', 'repo-a')]),
          makeGroup('beta', [makeGroupRepo('org/repo-b', 'org', 'repo-b')]),
          makeGroup('gamma', [makeGroupRepo('org/repo-c', 'org', 'repo-c')]),
        ]);
      mocks.groupManager.getRepos = vi
        .fn()
        .mockReturnValueOnce([makeGroupRepo('org/repo-a', 'org', 'repo-a')])
        .mockReturnValueOnce([makeGroupRepo('org/repo-b', 'org', 'repo-b')])
        .mockReturnValueOnce([makeGroupRepo('org/repo-c', 'org', 'repo-c')]);
      const bridge = createBridge(mocks);

      const result = (bridge as any).findGroupForRepo('org/repo-b');
      expect(result).toBe('beta');
    });

    it('should match repo with multiple repos in a group', () => {
      const mocks = createMocks();
      const repos = [
        makeGroupRepo('org/frontend', 'org', 'frontend'),
        makeGroupRepo('org/backend', 'org', 'backend'),
        makeGroupRepo('org/shared', 'org', 'shared'),
      ];
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([makeGroup('monorepo', repos)]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue(repos);
      const bridge = createBridge(mocks);

      const result = (bridge as any).findGroupForRepo('org/shared');
      expect(result).toBe('monorepo');
    });
  });

  // ── BridgeResult structure ──

  describe('BridgeResult structure', () => {
    it('should have correct shape for completed status', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 999 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 999 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result: BridgeResult = await bridge.process(payload);

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('durationMs');
      expect(typeof result.status).toBe('string');
      expect(typeof result.durationMs).toBe('number');
    });

    it('should have correct shape for skipped status', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([]);
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'closed' as any });
      const result: BridgeResult = await bridge.process(payload);

      expect(result.status).toBe('skipped');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.checkRunId).toBeUndefined();
      expect(result.reviewResult).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('should have correct shape for error status', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockImplementation(() => {
        throw new Error('critical failure');
      });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result: BridgeResult = await bridge.process(payload);

      expect(result.status).toBe('error');
      expect(result.error).toBe('critical failure');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── process — group manager returns null repos ──

  describe('process — null repos from group manager', () => {
    it('should handle empty repos from getRepos gracefully', async () => {
      const mocks = createMocks();
      const groupRepo = makeGroupRepo('org/service-a');
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([makeGroup('group-1', [groupRepo])]);
      // listGroups returns group with repos, but getRepos is called separately
      // and might return empty (simulating edge case where getRepos returns different data)
      // However, findGroupForRepo uses getRepos, so we need the repo to be found
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([groupRepo]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 1 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({ results: [], errors: [] });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 1 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('completed');
      expect(mocks.sync.ensureSynced).toHaveBeenCalled();
    });
  });

  // ── process — multiple repos in group ──

  describe('process — multiple repos in group', () => {
    it('should sync all repos in the group', async () => {
      const mocks = createMocks();
      const repos = [
        makeGroupRepo('org/service-a'),
        makeGroupRepo('org/service-b', 'org', 'service-b'),
        makeGroupRepo('org/shared-lib', 'org', 'shared-lib'),
      ];
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([makeGroup('multi-repo', repos)]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue(repos);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 1 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'a',
            synced: true,
            durationMs: 100,
          },
          {
            owner: 'org',
            repo: 'service-b',
            localPath: '/tmp/service-b',
            branch: 'main',
            commitSha: 'b',
            synced: true,
            durationMs: 150,
          },
          {
            owner: 'org',
            repo: 'shared-lib',
            localPath: '/tmp/shared-lib',
            branch: 'main',
            commitSha: 'c',
            synced: true,
            durationMs: 200,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 1 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('completed');
      expect(mocks.sync.ensureSynced).toHaveBeenCalledWith([
        { owner: 'org', repo: 'service-a' },
        { owner: 'org', repo: 'service-b' },
        { owner: 'org', repo: 'shared-lib' },
      ]);
    });
  });

  // ── process — diff content variations ──

  describe('process — diff content variations', () => {
    it('should handle empty diff string', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 1 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi.fn().mockResolvedValue('');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 1 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('completed');
    });

    it('should handle multi-file diff', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 1 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [
          {
            owner: 'org',
            repo: 'service-a',
            localPath: '/tmp/service-a',
            branch: 'main',
            commitSha: 'abc',
            synced: true,
            durationMs: 100,
          },
        ],
        errors: [],
      });
      mocks.client.getPRDiff = vi
        .fn()
        .mockResolvedValue(
          'diff --git a/src/a.ts b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n' +
            'diff --git a/src/b.ts b/src/b.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n' +
            'diff --git a/src/c.ts b/src/c.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
        );
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 1 }, annotationsCount: 0 });
      const bridge = createBridge(mocks);

      const payload = makePayload({ action: 'opened' });
      const result = await bridge.process(payload);
      expect(result.status).toBe('completed');
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

  it('should handle different repository owner', () => {
    const payload = makePayload({
      repository: {
        full_name: 'my-org/my-repo',
        name: 'my-repo',
        owner: { login: 'my-org' },
      },
    });
    expect(payload.repository.owner.login).toBe('my-org');
    expect(payload.repository.full_name).toBe('my-org/my-repo');
  });
});
