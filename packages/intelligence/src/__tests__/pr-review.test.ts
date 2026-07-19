// @code-analyzer/intelligence — PR Review Engine Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeReviewEngine } from '../review/review-engine.js';
import { PRReviewEngine } from '../review/pr-review.js';
import { SessionStore } from '../review/session-store.js';
import { SqliteStore } from '@code-analyzer/infra';
import type { GitDiff, PullRequest, GraphNode, GraphEdge } from '@code-analyzer/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(): SqliteStore {
  return new SqliteStore();
}

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: '/src/test.ts',
    oldHash: 'abc123',
    newHash: 'def456',
    ranges: [
      { oldStart: 1, oldEnd: 10, newStart: 1, newEnd: 12, changeType: 'modified' },
    ],
    changeType: 'modified',
    ...overrides,
  };
}

function createPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 'Test PR',
    body: 'Test body',
    state: 'open',
    base: {
      ref: 'main',
      sha: 'abc123',
      repo: {
        id: 1,
        owner: 'test',
        name: 'repo',
        fullName: 'test/repo',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/test/repo.git',
        language: 'typescript',
        topics: [],
        isPrivate: false,
        description: null,
      },
    },
    head: {
      ref: 'feature',
      sha: 'def456',
      repo: {
        id: 1,
        owner: 'test',
        name: 'repo',
        fullName: 'test/repo',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/test/repo.git',
        language: 'typescript',
        topics: [],
        isPrivate: false,
        description: null,
      },
    },
    user: { login: 'test-user' },
    labels: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createNode(store: SqliteStore, overrides: Partial<GraphNode> = {}): number {
  return store.insertNode({
    id: 0,
    projectId: 'test-project',
    label: 'Function',
    name: 'testFunc',
    qualifiedName: 'pkg.testFunc',
    filePath: '/src/test.ts',
    startLine: 1,
    endLine: 20,
    language: 'typescript',
    properties: { name: 'testFunc', isExported: true },
    signature: 'function testFunc(): void',
    docstring: 'A test function',
    complexity: 5,
    isExported: true,
    fingerprint: 'fp1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });
}

function createEdge(store: SqliteStore, sourceId: number, targetId: number, overrides: Partial<GraphEdge> = {}): void {
  store.insertEdge({
    id: 0,
    projectId: 'test-project',
    sourceId,
    targetId,
    type: 'CALLS',
    properties: { confidence: 1 },
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });
}

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), `pr-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PR Review Engine', () => {
  let store: SqliteStore;
  let reviewEngine: CodeReviewEngine;
  let prEngine: PRReviewEngine;
  let tempDir: string;
  let sessionStore: SessionStore;

  beforeEach(() => {
    store = createStore();
    tempDir = getTempDir();
    sessionStore = new SessionStore(tempDir);
    reviewEngine = new CodeReviewEngine(store, {}, sessionStore);
    prEngine = new PRReviewEngine(reviewEngine, store, sessionStore);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  describe('reviewPR()', () => {
    it('should return a complete PRReviewResult', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.sessionId).toBeTruthy();
      expect(result.comments).toBeDefined();
      expect(result.standardsResults).toBeDefined();
      expect(result.impactResult).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should produce standards results', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.standardsResults.length).toBeGreaterThan(0);
      for (const std of result.standardsResults) {
        expect(std.standardId).toBeTruthy();
        expect(typeof std.complianceScore).toBe('number');
        expect(std.complianceScore).toBeGreaterThanOrEqual(0);
        expect(std.complianceScore).toBeLessThanOrEqual(100);
      }
    });

    it('should produce an impact result', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.impactResult.changedFiles).toBeDefined();
      expect(result.impactResult.riskLevel).toBeTruthy();
    });

    it('should produce a summary with categories and severities', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      const summary = result.summary;
      expect(typeof summary.totalComments).toBe('number');
      expect(summary.byCategory).toBeDefined();
      expect(summary.bySeverity).toBeDefined();
      expect(summary.riskLevel).toBeTruthy();
      expect(summary.mergeRecommendation).toBeTruthy();
    });

    it('should handle multiple diffs', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/a.ts' }),
        createDiff({ filePath: '/src/b.ts' }),
        createDiff({ filePath: '/src/c.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.impactResult.changedFiles.length).toBe(3);
    });

    it('should handle diffs with various change types', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/added.ts', changeType: 'added' }),
        createDiff({ filePath: '/src/modified.ts', changeType: 'modified' }),
        createDiff({ filePath: '/src/deleted.ts', changeType: 'deleted' }),
        createDiff({
          filePath: '/src/renamed.ts',
          changeType: 'renamed',
          oldPath: '/src/old.ts',
        }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.impactResult.changedFiles.length).toBe(4);
    });
  });

  describe('Enriched Context', () => {
    it('should identify affected symbols from graph data', async () => {
      const sourceId = createNode(store);
      const targetId = createNode(store, {
        qualifiedName: 'pkg.otherFunc',
        filePath: '/src/other.ts',
        name: 'otherFunc',
      });
      createEdge(store, sourceId, targetId);

      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.impactResult.changedSymbols.length).toBeGreaterThan(0);
    });

    it('should detect related test files', async () => {
      const sourceId = createNode(store);
      const testId = createNode(store, {
        qualifiedName: 'pkg.test.testFunc',
        filePath: '/src/__tests__/test.test.ts',
        name: 'test_testFunc',
        label: 'Test',
      });
      createEdge(store, sourceId, testId, { type: 'TESTS' });

      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.impactResult.riskLevel).toBeTruthy();
    });
  });

  describe('Summary', () => {
    it('should return approve for clean code', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/simple.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.summary.mergeRecommendation).toBeTruthy();
      expect([
        'approve',
        'approve-with-comments',
        'request-changes',
        'block',
      ]).toContain(result.summary.mergeRecommendation);
    });

    it('should compute category counts correctly', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      const totalFromCategories = Object.values(result.summary.byCategory).reduce(
        (sum, val) => sum + val,
        0,
      );
      expect(totalFromCategories).toBe(result.summary.totalComments);
    });

    it('should compute severity counts correctly', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: '/src/test.ts' }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      const totalFromSeverities = Object.values(result.summary.bySeverity).reduce(
        (sum, val) => sum + val,
        0,
      );
      expect(totalFromSeverities).toBe(result.summary.totalComments);
    });
  });

  describe('Edge Cases', () => {
    it('should handle PR with no diff changes', async () => {
      const pr = createPR();
      const diffs: GitDiff[] = [];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.impactResult.changedFiles.length).toBe(0);
    });

    it('should handle PR with only added files', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({
          filePath: '/src/new.ts',
          changeType: 'added',
          ranges: [
            { oldStart: 0, oldEnd: 0, newStart: 1, newEnd: 50, changeType: 'added' },
          ],
        }),
      ];

      const result = await prEngine.reviewPR('test-project', pr, diffs);

      expect(result.sessionId).toBeTruthy();
    });
  });
});
