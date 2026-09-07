// @code-analyzer/intelligence — Cross-Repo Webhook Bridge Tests
// Comprehensive tests for CrossRepoWebhookBridge with mocked dependencies.

import { describe, it, expect, vi } from 'vitest';
import { CrossRepoWebhookBridge } from '../github/cross-repo-bridge.js';
import type { WebhookPayload, BridgeResult } from '../github/cross-repo-bridge.js';
import type { GitHubApiClient } from '../github/client.js';
import type { GitHubRepoSync } from '../github/repo-sync.js';
import type { GitHubCheckRunManager } from '../github/check-run.js';
import type { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import type { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import type { CrossRepoPRReviewEngine } from '../cross-repo/cross-repo-pr-review.js';
import type { RepoGroup, GroupRepo, GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient(): GitHubApiClient {
  return {
    getPRDiff: vi.fn().mockResolvedValue(''),
  } as unknown as GitHubApiClient;
}

function createMockSync(): GitHubRepoSync {
  return {
    ensureSynced: vi.fn().mockResolvedValue({ results: [], errors: [] }),
  } as unknown as GitHubRepoSync;
}

function createMockCheckRunManager(): GitHubCheckRunManager {
  return {
    create: vi.fn().mockResolvedValue({ id: 0 }),
    complete: vi.fn().mockResolvedValue({ checkRun: { id: 0 }, annotationsCount: 0 }),
    fail: vi.fn().mockResolvedValue({ id: 0 }),
  } as unknown as GitHubCheckRunManager;
}

function createMockGroupManager(): RepoGroupManager {
  return {
    listGroups: vi.fn().mockReturnValue([]),
    getRepos: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
  } as unknown as RepoGroupManager;
}

function createMockIndexer(): CrossRepoIndexer {
  return {
    indexGroup: vi.fn().mockResolvedValue(undefined),
  } as unknown as CrossRepoIndexer;
}

function createMockReviewEngine(): CrossRepoPRReviewEngine {
  return {
    reviewPRWithCrossRepoContext: vi.fn().mockResolvedValue(makeReviewResult()),
  } as unknown as CrossRepoPRReviewEngine;
}

function createMocks() {
  const client = createMockClient();
  const sync = createMockSync();
  const checkRunManager = createMockCheckRunManager();
  const groupManager = createMockGroupManager();
  const indexer = createMockIndexer();
  const reviewEngine = createMockReviewEngine();

  return { client, sync, checkRunManager, groupManager, indexer, reviewEngine };
}

function createBridge(mocks = createMocks()): CrossRepoWebhookBridge {
  return new CrossRepoWebhookBridge(
    mocks.client,
    mocks.sync,
    mocks.checkRunManager,
    mocks.groupManager,
    mocks.indexer,
    mocks.reviewEngine,
  );
}

/** Expose the private `findGroupForRepo` method without `as any`. */
function findGroupForRepo(bridge: CrossRepoWebhookBridge, repoFullName: string): string | null {
  return (
    bridge as unknown as { findGroupForRepo(repoFullName: string): string | null }
  ).findGroupForRepo(repoFullName);
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

function makeSyncedResult(owner: string, repo: string, localPath: string) {
  return {
    owner,
    repo,
    localPath,
    branch: 'main',
    commitSha: 'abc',
    synced: true,
    durationMs: 100,
  };
}

/** Configure a bridge whose group contains the source repo and whose sync succeeds. */
function setupHappyPath() {
  const mocks = createMocks();
  const groupRepo = makeGroupRepo('org/service-a');
  mocks.groupManager.listGroups = vi.fn().mockReturnValue([makeGroup('group-1', [groupRepo])]);
  mocks.groupManager.getRepos = vi.fn().mockReturnValue([groupRepo]);
  mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 123 });
  mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
    results: [makeSyncedResult('org', 'service-a', '/tmp/service-a')],
    errors: [],
  });
  mocks.client.getPRDiff = vi
    .fn()
    .mockResolvedValue('diff --git a/file.ts b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
  mocks.reviewEngine.reviewPRWithCrossRepoContext = vi.fn().mockResolvedValue(makeReviewResult());
  mocks.checkRunManager.complete = vi
    .fn()
    .mockResolvedValue({ checkRun: { id: 123 }, annotationsCount: 0 });
  return { mocks, bridge: createBridge(mocks) };
}

// ---------------------------------------------------------------------------
// Bridge Tests
// ---------------------------------------------------------------------------

describe('CrossRepoWebhookBridge', () => {
  it('creates an instance with its dependencies', () => {
    const bridge = createBridge();
    expect(bridge).toBeInstanceOf(CrossRepoWebhookBridge);
  });

  describe('process — event type validation', () => {
    it('skips unsupported actions', async () => {
      const { bridge, mocks } = setupHappyPath();
      const result = await bridge.process(makePayload({ action: 'closed' }));
      expect(result.status).toBe('skipped');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mocks.sync.ensureSynced).not.toHaveBeenCalled();
    });

    it('accepts opened, synchronize and reopened actions', async () => {
      for (const action of ['opened', 'synchronize', 'reopened'] as const) {
        const { bridge } = setupHappyPath();
        const result = await bridge.process(makePayload({ action }));
        expect(result.status).toBe('completed');
      }
    });
  });

  describe('process — no group found', () => {
    it('skips when no groups exist', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([]);
      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('skipped');
    });

    it('skips when the repo is not in any group', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([
          makeGroup('group-1', [makeGroupRepo('org/other-repo', 'org', 'other-repo')]),
        ]);
      mocks.groupManager.getRepos = vi
        .fn()
        .mockReturnValue([makeGroupRepo('org/other-repo', 'org', 'other-repo')]);
      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('skipped');
    });
  });

  describe('process — sync errors', () => {
    function setupSyncError(checkRunId?: number) {
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
      if (checkRunId) {
        mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: checkRunId });
      } else {
        mocks.checkRunManager.create = vi.fn().mockRejectedValue(new Error('check run failed'));
      }
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [],
        errors: [
          { owner: 'org', repo: 'service-a', error: 'clone failed' },
          { owner: 'org', repo: 'service-b', error: 'network error' },
        ],
      });
      mocks.checkRunManager.fail = vi.fn().mockResolvedValue({ id: checkRunId ?? 0 });
      return { mocks, bridge: createBridge(mocks) };
    }

    it('fails the check run and returns an error when sync has errors', async () => {
      const { bridge, mocks } = setupSyncError(100);
      const result = await bridge.process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('error');
      expect(result.checkRunId).toBe(100);
      expect(result.error).toContain('clone failed');
      expect(result.error).toContain('network error');
      expect(mocks.checkRunManager.fail).toHaveBeenCalledWith(
        100,
        'org',
        'service-a',
        expect.stringContaining('clone failed'),
      );
    });

    it('returns an error without failing the check run when checkRunId is undefined', async () => {
      const { bridge, mocks } = setupSyncError();
      const result = await bridge.process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('error');
      expect(result.checkRunId).toBeUndefined();
      expect(result.error).toContain('clone failed');
      expect(mocks.checkRunManager.fail).not.toHaveBeenCalled();
    });
  });

  describe('process — diff fetch errors', () => {
    function setupDiffError(
      getPRDiff: (owner: string, repo: string, number: number) => Promise<string>,
      checkRunId?: number,
    ) {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: checkRunId ?? 0 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [makeSyncedResult('org', 'service-a', '/tmp/service-a')],
        errors: [],
      });
      mocks.client.getPRDiff = getPRDiff;
      mocks.checkRunManager.fail = vi.fn().mockResolvedValue({ id: checkRunId ?? 0 });
      return { mocks, bridge: createBridge(mocks) };
    }

    it('fails the check run and returns an error when diff fetch throws an Error', async () => {
      const { bridge, mocks } = setupDiffError(
        vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
        200,
      );
      const result = await bridge.process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('error');
      expect(result.error).toContain('Diff fetch failed');
      expect(result.error).toContain('API rate limit exceeded');
      expect(mocks.checkRunManager.fail).toHaveBeenCalledWith(
        200,
        'org',
        'service-a',
        expect.stringContaining('API rate limit exceeded'),
      );
    });

    it('returns an error without failing when diff fetch throws a non-Error', async () => {
      const { bridge } = setupDiffError(vi.fn().mockRejectedValue('string error'));
      const result = await bridge.process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('error');
      expect(result.error).toContain('string error');
    });

    it('fails the check run when diff fetch throws a non-Error', async () => {
      const { bridge, mocks } = setupDiffError(vi.fn().mockRejectedValue('string error'), 300);
      const result = await bridge.process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('error');
      expect(mocks.checkRunManager.fail).toHaveBeenCalledWith(
        300,
        'org',
        'service-a',
        expect.stringContaining('string error'),
      );
    });
  });

  describe('process — catch-all error handler', () => {
    it('catches an unexpected Error thrown during processing', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockImplementation(() => {
        throw new Error('unexpected database error');
      });
      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('error');
      expect(result.error).toBe('unexpected database error');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('stringifies an unexpected non-Error thrown during processing', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockImplementation(() => {
        throw 'some string error';
      });
      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('error');
      expect(result.error).toBe('some string error');
    });
  });

  describe('process — complete success flow', () => {
    it('runs the full pipeline with a cross-repo review', async () => {
      const { bridge, mocks } = setupHappyPath();
      const result = await bridge.process(makePayload({ action: 'opened' }));

      expect(result.status).toBe('completed');
      expect(result.checkRunId).toBe(123);
      expect(result.reviewResult).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mocks.sync.ensureSynced).toHaveBeenCalledWith([{ owner: 'org', repo: 'service-a' }]);
      expect(mocks.indexer.indexGroup).toHaveBeenCalledWith('group-1');
      expect(mocks.client.getPRDiff).toHaveBeenCalledWith('org', 'service-a', 42);
      expect(mocks.reviewEngine.reviewPRWithCrossRepoContext).toHaveBeenCalled();
      expect(mocks.checkRunManager.complete).toHaveBeenCalledWith(
        123,
        'org',
        'service-a',
        expect.any(Object),
      );
    });

    it('completes successfully when check run creation throws (non-fatal)', async () => {
      // Override create to throw, forcing checkRunId to remain undefined.
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockRejectedValue(new Error('check run failed'));
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [makeSyncedResult('org', 'service-a', '/tmp/service-a')],
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

      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('completed');
      expect(result.checkRunId).toBeUndefined();
      expect(mocks.checkRunManager.complete).not.toHaveBeenCalled();
    });
  });

  describe('process — null repos from group manager', () => {
    it('falls back to an empty repo list when getRepos returns null in process', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      // First call (findGroupForRepo) returns the repo so the group is found;
      // second call (process) returns null to exercise the `?? []` fallback.
      mocks.groupManager.getRepos = vi
        .fn()
        .mockReturnValueOnce([makeGroupRepo('org/service-a')])
        .mockReturnValueOnce(null);
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

      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('completed');
      expect(mocks.sync.ensureSynced).toHaveBeenCalledWith([]);
    });
  });

  describe('process — multiple repos in group', () => {
    it('syncs every repo in the group', async () => {
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
          makeSyncedResult('org', 'service-a', '/tmp/service-a'),
          makeSyncedResult('org', 'service-b', '/tmp/service-b'),
          makeSyncedResult('org', 'shared-lib', '/tmp/shared-lib'),
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

      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('completed');
      expect(mocks.sync.ensureSynced).toHaveBeenCalledWith([
        { owner: 'org', repo: 'service-a' },
        { owner: 'org', repo: 'service-b' },
        { owner: 'org', repo: 'shared-lib' },
      ]);
    });
  });

  describe('process — diff content variations', () => {
    it('handles an empty diff string', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);
      mocks.checkRunManager.create = vi.fn().mockResolvedValue({ id: 1 });
      mocks.sync.ensureSynced = vi.fn().mockResolvedValue({
        results: [makeSyncedResult('org', 'service-a', '/tmp/service-a')],
        errors: [],
      });
      mocks.client.getPRDiff = vi.fn().mockResolvedValue('');
      mocks.reviewEngine.reviewPRWithCrossRepoContext = vi
        .fn()
        .mockResolvedValue(makeReviewResult());
      mocks.checkRunManager.complete = vi
        .fn()
        .mockResolvedValue({ checkRun: { id: 1 }, annotationsCount: 0 });

      const result = await createBridge(mocks).process(makePayload({ action: 'opened' }));
      expect(result.status).toBe('completed');
      expect(mocks.client.getPRDiff).toHaveBeenCalledWith('org', 'service-a', 42);
    });
  });

  describe('findGroupForRepo', () => {
    it('finds the matching group by repo full name', () => {
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

      expect(findGroupForRepo(createBridge(mocks), 'org/service-a')).toBe('group-1');
    });

    it('matches a repo in a later group', () => {
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

      expect(findGroupForRepo(createBridge(mocks), 'org/repo-b')).toBe('beta');
    });

    it('matches a repo among multiple repos in a single group', () => {
      const mocks = createMocks();
      const repos = [
        makeGroupRepo('org/frontend', 'org', 'frontend'),
        makeGroupRepo('org/backend', 'org', 'backend'),
        makeGroupRepo('org/shared', 'org', 'shared'),
      ];
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([makeGroup('monorepo', repos)]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue(repos);

      expect(findGroupForRepo(createBridge(mocks), 'org/shared')).toBe('monorepo');
    });

    it('returns null when no group matches', () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi
        .fn()
        .mockReturnValue([makeGroup('group-1', [makeGroupRepo('org/service-a')])]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue([makeGroupRepo('org/service-a')]);

      expect(findGroupForRepo(createBridge(mocks), 'org/service-c')).toBeNull();
    });

    it('returns null when there are no groups', () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([]);

      expect(findGroupForRepo(createBridge(mocks), 'org/service-a')).toBeNull();
    });

    it('returns null when getRepos returns null for a group', () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([makeGroup('group-1')]);
      mocks.groupManager.getRepos = vi.fn().mockReturnValue(null);

      expect(findGroupForRepo(createBridge(mocks), 'org/service-a')).toBeNull();
    });
  });

  describe('BridgeResult shape', () => {
    it('has the completed shape', async () => {
      const { bridge } = setupHappyPath();
      const result: BridgeResult = await bridge.process(makePayload({ action: 'opened' }));
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('durationMs');
      expect(typeof result.status).toBe('string');
      expect(typeof result.durationMs).toBe('number');
    });

    it('has the skipped shape', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockReturnValue([]);
      const result: BridgeResult = await createBridge(mocks).process(
        makePayload({ action: 'closed' }),
      );
      expect(result.status).toBe('skipped');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.checkRunId).toBeUndefined();
      expect(result.reviewResult).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('has the error shape', async () => {
      const mocks = createMocks();
      mocks.groupManager.listGroups = vi.fn().mockImplementation(() => {
        throw new Error('critical failure');
      });
      const result: BridgeResult = await createBridge(mocks).process(
        makePayload({ action: 'opened' }),
      );
      expect(result.status).toBe('error');
      expect(result.error).toBe('critical failure');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
