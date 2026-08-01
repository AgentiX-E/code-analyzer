// @code-analyzer/intelligence — PR Review Bridge Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';
import { CodeReviewEngine } from '../../review/review-engine.js';
import { PRReviewBridge } from '../../cross-repo/pr-review-bridge.js';
import type { PullRequest, GitDiff, GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: 'feat: add new API',
    body: 'Adds new API endpoint',
    state: 'open',
    base: {
      ref: 'main',
      sha: 'abc123',
      repo: {
        id: 1,
        owner: 'myorg',
        name: 'service-a',
        fullName: 'myorg/service-a',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/myorg/service-a.git',
        language: 'typescript',
        topics: [],
        isPrivate: false,
        description: 'Service A',
      },
    },
    head: {
      ref: 'feature/new-api',
      sha: 'def456',
      repo: {
        id: 1,
        owner: 'myorg',
        name: 'service-a',
        fullName: 'myorg/service-a',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/myorg/service-a.git',
        language: 'typescript',
        topics: [],
        isPrivate: false,
        description: 'Service A',
      },
    },
    user: { login: 'dev1' },
    labels: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: 'src/api.ts',
    changeType: 'modified',
    oldPath: 'src/api.ts',
    oldHash: 'abc123',
    newHash: 'def456',
    ranges: [],
    ...overrides,
  };
}

function createSetup() {
  const store = new InMemoryGraphStore();
  const groupManager = new RepoGroupManager();

  groupManager.createGroup('test-group', 'Test Group', 'Test description');
  groupManager.addRepo('test-group', 'myorg', 'service-a', 'https://github.com/myorg/service-a', '/tmp/a');
  groupManager.addRepo('test-group', 'myorg', 'service-b', 'https://github.com/myorg/service-b', '/tmp/b');

  // Add some nodes
  for (let i = 0; i < 5; i++) {
    store.insertNode({
      id: i + 1,
      label: 'Function',
      name: `fn-${i}`,
      qualifiedName: `fn-${i}()`,
      filePath: `src/file${i}.ts`,
      startLine: 1,
      endLine: 5,
      properties: { name: `fn-${i}`, repoId: 'myorg/service-a' },
    } as any);
  }

  const indexer = new CrossRepoIndexer(store, groupManager);

  // Mock review engine
  const reviewEngine = {
    reviewDiff: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
  } as unknown as CodeReviewEngine;

  const bridge = new PRReviewBridge(indexer, groupManager, reviewEngine);

  return { bridge, indexer, groupManager, store, reviewEngine };
}

// ---------------------------------------------------------------------------
// PRReviewBridge Tests
// ---------------------------------------------------------------------------

describe('PRReviewBridge', () => {
  let bridge: PRReviewBridge;
  let groupManager: RepoGroupManager;
  let reviewEngine: CodeReviewEngine;

  beforeEach(() => {
    const setup = createSetup();
    bridge = setup.bridge;
    groupManager = setup.groupManager;
    reviewEngine = setup.reviewEngine;
  });

  describe('reviewPR', () => {
    it('should review a PR with cross-repo context', async () => {
      const pr = createPR();
      const diffs = [createDiff()];

      const report = await bridge.reviewPR(pr, 'test-group', 'myorg/service-a', diffs);

      expect(report).toBeDefined();
      expect(report.prNumber).toBe(42);
      expect(report.sourceRepo).toBe('myorg/service-a');
      expect(report.groupId).toBe('test-group');
      expect(report.affectedRepos).toBeDefined();
      expect(report.contractValidation).toBeDefined();
      expect(report.blastRadius).toBeDefined();
      expect(report.dependencyChains).toBeDefined();
      expect(report.riskLevel).toBeDefined();
      expect(report.mergeRecommendation).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.timestamp).toBeDefined();
    });

    it('should throw for missing PR', async () => {
      await expect(
        bridge.reviewPR(null as unknown as PullRequest, 'test-group', 'myorg/service-a', []),
      ).rejects.toThrow('PR, groupId, and sourceRepoId are required');
    });

    it('should throw for missing groupId', async () => {
      const pr = createPR();
      await expect(
        bridge.reviewPR(pr, '', 'myorg/service-a', []),
      ).rejects.toThrow('PR, groupId, and sourceRepoId are required');
    });

    it('should throw for non-existent group', async () => {
      const pr = createPR();
      await expect(
        bridge.reviewPR(pr, 'non-existent', 'myorg/service-a', []),
      ).rejects.toThrow('Group "non-existent" not found');
    });

    it('should handle empty diffs', async () => {
      const pr = createPR();
      const report = await bridge.reviewPR(pr, 'test-group', 'myorg/service-a', []);
      expect(report.breakingChangeCount).toBe(0);
    });

    it('should handle multiple diffs', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: 'src/api.ts', changeType: 'modified' }),
        createDiff({ filePath: 'src/types.ts', changeType: 'added' }),
        createDiff({ filePath: 'src/old.ts', changeType: 'deleted' }),
      ];

      const report = await bridge.reviewPR(pr, 'test-group', 'myorg/service-a', diffs);
      expect(report).toBeDefined();
    });

    it('should include contract validation results', async () => {
      const pr = createPR();
      const diffs = [createDiff({ filePath: 'src/api.ts' })];

      const report = await bridge.reviewPR(pr, 'test-group', 'myorg/service-a', diffs);
      expect(report.contractValidation.sourceRepo).toBe('myorg/service-a');
    });

    it('should include blast radius results', async () => {
      const pr = createPR();
      const diffs = [createDiff()];

      const report = await bridge.reviewPR(pr, 'test-group', 'myorg/service-a', diffs);
      expect(report.blastRadius.sourceRepo).toBe('myorg/service-a');
    });

    it('should produce valid risk levels', async () => {
      const pr = createPR();
      const report = await bridge.reviewPR(pr, 'test-group', 'myorg/service-a', [createDiff()]);
      expect(['critical', 'high', 'medium', 'low']).toContain(report.riskLevel);
    });

    it('should produce valid merge recommendations', async () => {
      const pr = createPR();
      const report = await bridge.reviewPR(pr, 'test-group', 'myorg/service-a', [createDiff()]);
      expect(['approve', 'approve-with-caution', 'request-changes', 'block']).toContain(report.mergeRecommendation);
    });
  });

  describe('discoverRelatedRepos', () => {
    it('should discover related repos', async () => {
      const repos = await bridge.discoverRelatedRepos('test-group', 'myorg/service-a');
      expect(Array.isArray(repos)).toBe(true);
    });

    it('should handle non-existent groups', async () => {
      const repos = await bridge.discoverRelatedRepos('non-existent', 'myorg/service-a');
      expect(repos).toEqual([]);
    });
  });

  describe('buildContext', () => {
    it('should build cross-repo context for a PR', async () => {
      const diffs = [createDiff({ filePath: 'src/api.ts' })];
      const context = await bridge.buildContext('test-group', 'myorg/service-a', diffs);

      expect(context.groupId).toBe('test-group');
      expect(context.sourceRepoId).toBe('myorg/service-a');
      expect(context.relatedRepos).toBeDefined();
      expect(context.sharedDependencies).toBeDefined();
      expect(context.contractChanges).toBeDefined();
    });
  });

  describe('formatReport', () => {
    it('should format a report as markdown', () => {
      const report = {
        prNumber: 42,
        sourceRepo: 'myorg/service-a',
        groupId: 'test-group',
        reviewComments: [],
        contractValidation: {
          sourceRepo: 'myorg/service-a',
          targetRepos: [],
          changes: [],
          breakingCount: 0,
          compatible: true,
          recommendations: [],
        },
        blastRadius: {
          sourceRepo: 'myorg/service-a',
          directImpact: [],
          transitiveImpact: [],
          totalAffected: 0,
          criticalPaths: [],
          severityRankings: new Map(),
        },
        dependencyChains: [],
        affectedRepos: [],
        breakingChangeCount: 0,
        riskLevel: 'low' as const,
        mergeRecommendation: 'approve' as const,
        summary: 'All clear.',
        recommendations: ['No issues found.'],
        timestamp: new Date().toISOString(),
      };

      const formatted = bridge.formatReport(report);
      expect(formatted).toContain('# Cross-Repo PR Review Report');
      expect(formatted).toContain('#42');
      expect(formatted).toContain('myorg/service-a');
      expect(formatted).toContain('All clear.');
    });

    it('should include critical paths in formatted report', () => {
      const report = {
        prNumber: 42,
        sourceRepo: 'myorg/service-a',
        groupId: 'test-group',
        reviewComments: [],
        contractValidation: {
          sourceRepo: 'myorg/service-a',
          targetRepos: [],
          changes: [],
          breakingCount: 0,
          compatible: true,
          recommendations: [],
        },
        blastRadius: {
          sourceRepo: 'myorg/service-a',
          directImpact: ['myorg/service-b'],
          transitiveImpact: [],
          totalAffected: 1,
          criticalPaths: [['myorg/service-a', 'myorg/service-b']],
          severityRankings: new Map([['myorg/service-b', 'high' as const]]),
        },
        dependencyChains: [],
        affectedRepos: ['myorg/service-b'],
        breakingChangeCount: 0,
        riskLevel: 'medium' as const,
        mergeRecommendation: 'approve-with-caution' as const,
        summary: 'Affects 1 repo.',
        recommendations: ['Coordinate with service-b maintainers.'],
        timestamp: new Date().toISOString(),
      };

      const formatted = bridge.formatReport(report);
      expect(formatted).toContain('Critical Paths');
      expect(formatted).toContain('myorg/service-a → myorg/service-b');
    });

    it('should include breaking changes in formatted report', () => {
      const report = {
        prNumber: 42,
        sourceRepo: 'myorg/service-a',
        groupId: 'test-group',
        reviewComments: [],
        contractValidation: {
          sourceRepo: 'myorg/service-a',
          targetRepos: ['myorg/service-b'],
          changes: [{
            type: 'removed' as const,
            symbol: 'oldApi',
            severity: 'critical' as const,
            description: 'API was removed',
            affectedRepos: ['myorg/service-b'],
          }],
          breakingCount: 1,
          compatible: false,
          recommendations: ['Update service-b.'],
        },
        blastRadius: {
          sourceRepo: 'myorg/service-a',
          directImpact: [],
          transitiveImpact: [],
          totalAffected: 0,
          criticalPaths: [],
          severityRankings: new Map(),
        },
        dependencyChains: [],
        affectedRepos: ['myorg/service-b'],
        breakingChangeCount: 1,
        riskLevel: 'high' as const,
        mergeRecommendation: 'request-changes' as const,
        summary: 'Breaking changes detected.',
        recommendations: ['Update service-b.'],
        timestamp: new Date().toISOString(),
      };

      const formatted = bridge.formatReport(report);
      expect(formatted).toContain('REMOVED');
      expect(formatted).toContain('oldApi');
    });
  });
});
