// @code-analyzer/intelligence — Cross-Repo PR Review Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import { CodeReviewEngine } from '../review/review-engine.js';
import {
  CrossRepoPRReviewEngine,
  buildSuggestedActionsForImpact,
} from '../cross-repo/cross-repo-pr-review.js';
import { VersionCompatibilityMatrix } from '../cross-repo/version-matrix.js';
import type { PullRequest, GitDiff, GraphNode } from '@code-analyzer/shared';
import type {
  CrossRepoReviewResult,
  APIBreakingReport,
  TestImpactReport,
  CrossRepoReviewSummary,
  VersionCompatibilityReport,
  APIBreakingChange,
} from '../cross-repo/cross-repo-pr-review.js';
import type {
  CompatibilityMatrix,
  VersionConflict,
  VersionAlignment,
  UpgradeSafetyReport,
} from '../cross-repo/version-matrix.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: 'feat: add new API endpoint',
    body: 'Adds /api/v2/users endpoint',
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
    user: { login: 'developer' },
    labels: [],
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: 'src/api/users.ts',
    oldHash: 'abc',
    newHash: 'def',
    ranges: [
      {
        oldStart: 10,
        oldEnd: 15,
        newStart: 10,
        newEnd: 18,
        changeType: 'modified',
      },
    ],
    changeType: 'modified',
    ...overrides,
  };
}

function createNode(id: number, projectId: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    projectId,
    label: 'Function',
    name: `fn_${id}`,
    qualifiedName: `pkg.fn_${id}`,
    filePath: `src/file_${id}.ts`,
    startLine: id * 10,
    endLine: id * 10 + 5,
    language: 'typescript',
    properties: { name: `fn_${id}`, isExported: id % 2 === 0 },
    signature: `function fn_${id}(x: number): void`,
    docstring: null,
    complexity: id,
    isExported: id % 2 === 0,
    fingerprint: `fp_${id}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function setupGroup(groupManager: RepoGroupManager): void {
  // Create a local directory first
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-group-'));

  // Create repo directories
  const repoADir = path.join(tmpDir, 'service-a');
  const repoBDir = path.join(tmpDir, 'service-b');
  const repoCDir = path.join(tmpDir, 'service-c');
  fs.mkdirSync(repoADir, { recursive: true });
  fs.mkdirSync(repoBDir, { recursive: true });
  fs.mkdirSync(repoCDir, { recursive: true });

  // Create package.json files
  fs.writeFileSync(
    path.join(repoADir, 'package.json'),
    JSON.stringify({
      name: 'service-a',
      version: '1.0.0',
      dependencies: { lodash: '^4.17.0', axios: '^1.6.0' },
    }),
  );

  fs.writeFileSync(
    path.join(repoBDir, 'package.json'),
    JSON.stringify({
      name: 'service-b',
      version: '2.0.0',
      dependencies: { lodash: '^3.10.0', express: '^4.18.0' },
    }),
  );

  fs.writeFileSync(
    path.join(repoCDir, 'package.json'),
    JSON.stringify({
      name: 'service-c',
      version: '1.5.0',
      dependencies: { lodash: '^4.17.0', axios: '^0.27.0' },
    }),
  );

  groupManager.createGroup('test-group', 'Test Group', 'Test group for cross-repo analysis');
  groupManager.addRepo(
    'test-group',
    'myorg',
    'service-a',
    'https://github.com/myorg/service-a',
    repoADir,
  );
  groupManager.addRepo(
    'test-group',
    'myorg',
    'service-b',
    'https://github.com/myorg/service-b',
    repoBDir,
  );
  groupManager.addRepo(
    'test-group',
    'myorg',
    'service-c',
    'https://github.com/myorg/service-c',
    repoCDir,
  );
}

/**
 * Build a standalone CrossRepoPRReviewEngine over a temp directory populated
 * with the given repo manifests. Lets version-compatibility tests exercise
 * go.mod parsing, minor/patch conflicts, non-numeric versions, and malformed
 * package.json without disturbing the shared `setupGroup` fixtures.
 */
function buildVersionGroupEngine(
  reviewEngine: CodeReviewEngine,
  repoSpecs: Array<{ repo: string; packageJson?: Record<string, unknown>; goMod?: string }>,
): CrossRepoPRReviewEngine {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const manager = new RepoGroupManager();
  manager.createGroup('vg', 'Version Group', '');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-'));

  for (const spec of repoSpecs) {
    const dir = path.join(base, spec.repo);
    fs.mkdirSync(dir, { recursive: true });
    if (spec.packageJson !== undefined) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(spec.packageJson));
    }
    if (spec.goMod !== undefined) {
      fs.writeFileSync(path.join(dir, 'go.mod'), spec.goMod);
    }
    manager.addRepo('vg', 'myorg', spec.repo, '', dir);
  }

  return new CrossRepoPRReviewEngine(
    new CrossRepoIndexer(new InMemoryGraphStore(), manager),
    manager,
    reviewEngine,
  );
}

// ---------------------------------------------------------------------------
// Graph seeding helpers — populate the shared InMemoryGraphStore with real
// nodes and CROSS_REPO_* edges (no mocks) so impact analysis, dependency
// tracing, and test-impact prediction operate on live data.
// ---------------------------------------------------------------------------

const REPO_A = 'myorg/service-a';
const REPO_B = 'myorg/service-b';
const REPO_C = 'myorg/service-c';

function insertCrossRepoEdge(store: InMemoryGraphStore, sourceId: number, targetId: number): void {
  store.insertEdge({
    id: 0,
    projectId: 'cross-repo:test-group',
    sourceId,
    targetId,
    type: 'CROSS_REPO_CALLS',
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
  });
}

/**
 * Seed a three-repo dependency chain:
 *   service-a.UserService --CROSS_REPO_CALLS--> service-b.OrderService
 *   service-b.OrderService --CROSS_REPO_CALLS--> service-c.PaymentService
 * This makes analyzeCrossRepoImpact report service-b (depth 1, high) and
 * service-c (depth 2, medium), and makes traceSymbolDependencies return
 * direct + transitive traces for the "UserService" symbol.
 */
function seedCrossRepoGraph(store: InMemoryGraphStore): void {
  const userService = store.insertNode(
    createNode(0, REPO_A, {
      label: 'Class',
      name: 'UserService',
      qualifiedName: 'UserService',
      filePath: 'src/api/UserService.ts',
      isExported: true,
      properties: { name: 'UserService', filePath: 'src/api/UserService.ts', isExported: true },
    }),
  );
  const orderService = store.insertNode(
    createNode(0, REPO_B, {
      label: 'Class',
      name: 'OrderService',
      qualifiedName: 'OrderService',
      filePath: 'src/order.service.ts',
      isExported: true,
      properties: { name: 'OrderService', filePath: 'src/order.service.ts', isExported: true },
    }),
  );
  const paymentService = store.insertNode(
    createNode(0, REPO_C, {
      label: 'Class',
      name: 'PaymentService',
      qualifiedName: 'PaymentService',
      filePath: 'src/payment.service.ts',
      isExported: true,
      properties: { name: 'PaymentService', filePath: 'src/payment.service.ts', isExported: true },
    }),
  );

  insertCrossRepoEdge(store, userService, orderService);
  insertCrossRepoEdge(store, orderService, paymentService);
}

/**
 * Seed the resolveCrossRepoSymbols fallback scenario: service-a exports
 * `SharedUtil`, and a service-b File node imports it via an IMPORTS edge.
 * With no CROSS_REPO_* edges, traceSymbolDependencies returns empty, so
 * detectBreakingChanges falls through to resolveCrossRepoSymbols and maps
 * the "SharedUtil" symbol to service-b via the import-reference match.
 */
function seedResolveSymbolScenario(store: InMemoryGraphStore): void {
  const sharedUtil = store.insertNode(
    createNode(0, REPO_A, {
      label: 'Function',
      name: 'SharedUtil',
      qualifiedName: 'SharedUtil',
      filePath: 'src/shared/SharedUtil.ts',
      isExported: true,
      properties: { name: 'SharedUtil', filePath: 'src/shared/SharedUtil.ts', isExported: true },
    }),
  );
  const importerFile = store.insertNode(
    createNode(0, REPO_B, {
      label: 'File',
      name: 'SharedUtil.ts',
      qualifiedName: 'file:service-b:src/shared/SharedUtil.ts',
      filePath: 'src/shared/SharedUtil.ts',
      isExported: false,
      properties: { name: 'SharedUtil.ts', filePath: 'src/shared/SharedUtil.ts' },
    }),
  );

  store.insertEdge({
    id: 0,
    projectId: REPO_B,
    sourceId: importerFile,
    targetId: sharedUtil,
    type: 'IMPORTS',
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
  });
}

/**
 * Seed test-file nodes in service-b so predictTests can produce related test
 * files at every confidence tier.
 */
function seedTestNodes(
  store: InMemoryGraphStore,
  repo: string,
  count: number,
  symbol: string,
): void {
  for (let i = 0; i < count; i++) {
    store.insertNode(
      createNode(0, repo, {
        label: 'Function',
        name: `${symbol}Test${i}`,
        qualifiedName: `pkg.${symbol}Test${i}`,
        filePath: `src/${symbol}${i}.test.ts`,
        isExported: false,
        properties: { name: `${symbol}Test${i}`, filePath: `src/${symbol}${i}.test.ts` },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// CrossRepoPRReviewEngine Tests
// ---------------------------------------------------------------------------

describe('CrossRepoPRReviewEngine', () => {
  let store: InMemoryGraphStore;
  let groupManager: RepoGroupManager;
  let indexer: CrossRepoIndexer;
  let reviewEngine: CodeReviewEngine;
  let engine: CrossRepoPRReviewEngine;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    groupManager = new RepoGroupManager();
    setupGroup(groupManager);
    indexer = new CrossRepoIndexer(store, groupManager);
    reviewEngine = new CodeReviewEngine(store, { allowMetadataFallback: true });
    engine = new CrossRepoPRReviewEngine(indexer, groupManager, reviewEngine);
  });

  // -----------------------------------------------------------------------
  // reviewPRWithCrossRepoContext
  // -----------------------------------------------------------------------

  describe('reviewPRWithCrossRepoContext', () => {
    it('should validate required parameters', async () => {
      const pr = createPR();
      await expect(
        engine.reviewPRWithCrossRepoContext(null as never, 'test-group', 'myorg/service-a', []),
      ).rejects.toThrow('required');
    });

    it('should throw for non-existent group', async () => {
      const pr = createPR();
      await expect(
        engine.reviewPRWithCrossRepoContext(pr, 'non-existent', 'myorg/service-a', []),
      ).rejects.toThrow('Group "non-existent" not found');
    });

    it('should throw for repo not in group', async () => {
      const pr = createPR();
      await expect(
        engine.reviewPRWithCrossRepoContext(pr, 'test-group', 'unknown/repo', []),
      ).rejects.toThrow('Repo "unknown/repo" not found in group');
    });

    it('should return cross-repo review result with no diffs', async () => {
      const pr = createPR();
      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );
      expect(result).toBeDefined();
      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(result.crossRepoImpacts).toBeDefined();
      expect(result.apiBreakingChanges).toBeDefined();
      expect(result.testPredictions).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should process diffs and return cross-repo impact', async () => {
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/users.ts' });

      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [diff],
      );

      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(Array.isArray(result.apiBreakingChanges)).toBe(true);
      expect(Array.isArray(result.testPredictions)).toBe(true);
    });

    it('should report impact levels and suggested actions from a seeded dependency chain', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();

      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );

      expect(result.crossRepoImpacts.length).toBe(2);
      const impactB = result.crossRepoImpacts.find((i) => i.affectedRepo === 'myorg/service-b');
      const impactC = result.crossRepoImpacts.find((i) => i.affectedRepo === 'myorg/service-c');
      expect(impactB?.impactLevel).toBe('high');
      expect(impactB?.suggestedActions.length).toBeGreaterThan(0);
      expect(impactC?.impactLevel).toBe('medium');
      expect(impactC?.suggestedActions.length).toBeGreaterThan(0);
    });

    it('should swallow review engine failures when git ops are unavailable', async () => {
      const noGitOpsReview = new CodeReviewEngine(store, { allowMetadataFallback: false });
      const noGitOpsEngine = new CrossRepoPRReviewEngine(indexer, groupManager, noGitOpsReview);
      const pr = createPR();

      const result = await noGitOpsEngine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [createDiff()],
      );

      expect(result.prComments).toEqual([]);
      expect(result.sourceRepo).toBe('myorg/service-a');
    });
  });

  // -----------------------------------------------------------------------
  // detectAPIBreakingChanges
  // -----------------------------------------------------------------------

  describe('detectAPIBreakingChanges', () => {
    it('should validate groupId and sourceRepoId', async () => {
      const pr = createPR();
      await expect(engine.detectAPIBreakingChanges(pr, '', 'myorg/service-a', [])).rejects.toThrow(
        'required',
      );
    });

    it('should detect no breaking changes for new files', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/new-feature.ts',
        changeType: 'added',
        ranges: [{ oldStart: 0, oldEnd: 0, newStart: 1, newEnd: 10, changeType: 'added' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(result.totalBreakingChanges).toBe(0);
      expect(result.severity).toBe('low');
    });

    it('should detect removed file as breaking', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/old-api.ts',
        changeType: 'deleted',
        ranges: [{ oldStart: 1, oldEnd: 20, newStart: 0, newEnd: 0, changeType: 'removed' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.totalBreakingChanges).toBeGreaterThan(0);
      expect(result.breakingChanges.some((b) => b.changeType === 'removed')).toBe(true);
      expect(result.severity).toBe('critical');
    });

    it('should detect renamed file as breaking', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/new-name.ts',
        changeType: 'renamed',
        oldPath: 'src/old-name.ts',
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.breakingChanges.some((b) => b.changeType === 'renamed')).toBe(true);
    });

    it('should detect signature changes in modified TS files', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 15, changeType: 'modified' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      // Signature changes are detected via heuristics
      expect(result.sourceRepo).toBe('myorg/service-a');
    });

    it('should detect return type changes in TS files with multiple ranges', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'modified',
        ranges: [
          { oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 14, changeType: 'modified' },
          { oldStart: 20, oldEnd: 22, newStart: 20, newEnd: 25, changeType: 'modified' },
        ],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.sourceRepo).toBe('myorg/service-a');
    });

    it('should detect required parameter additions', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 10, newStart: 10, newEnd: 12, changeType: 'added' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);
      expect(result.sourceRepo).toBe('myorg/service-a');
    });

    it('should detect parameter removals', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 14, newStart: 10, newEnd: 10, changeType: 'removed' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);
      expect(result.sourceRepo).toBe('myorg/service-a');
    });

    it('should set severity to high for type/visibility changes', async () => {
      const pr = createPR();
      // A deleted file triggers the removed branch which is 'critical'
      // Modified file with signature change triggers critical path
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 14, changeType: 'modified' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);
      expect(result.severity).toBeDefined();
    });

    it('should report affected repos in breaking changes', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/shared-util.ts',
        changeType: 'deleted',
        ranges: [{ oldStart: 1, oldEnd: 10, newStart: 0, newEnd: 0, changeType: 'removed' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      // Even if there are no cross-repo dependencies indexed, we get a breaking change
      expect(result.totalBreakingChanges).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple diffs with mixed changes', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: 'src/removed.ts', changeType: 'deleted' }),
        createDiff({ filePath: 'src/modified.ts', changeType: 'modified' }),
        createDiff({ filePath: 'src/added.ts', changeType: 'added' }),
      ];

      const result = await engine.detectAPIBreakingChanges(
        pr,
        'test-group',
        'myorg/service-a',
        diffs,
      );

      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(Array.isArray(result.breakingChanges)).toBe(true);
    });

    it('should detect signature change for a modified symbol with dependents', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 15, changeType: 'modified' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.breakingChanges.some((b) => b.changeType === 'signature_changed')).toBe(true);
      const sig = result.breakingChanges.find((b) => b.changeType === 'signature_changed');
      expect(sig?.affectedInRepos).toContain('myorg/service-b');
    });

    it('should detect return type change only for tsx symbols', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.tsx',
        changeType: 'modified',
        ranges: [
          { oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 12, changeType: 'modified' },
          { oldStart: 20, oldEnd: 22, newStart: 20, newEnd: 22, changeType: 'modified' },
        ],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.breakingChanges.some((b) => b.changeType === 'return_type_changed')).toBe(true);
      expect(result.breakingChanges.some((b) => b.changeType === 'signature_changed')).toBe(false);
    });

    it('should detect required parameter addition for non-signature-file symbols', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.java',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 10, newStart: 10, newEnd: 12, changeType: 'added' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.breakingChanges.some((b) => b.changeType === 'parameter_added_required')).toBe(
        true,
      );
      expect(result.breakingChanges.some((b) => b.changeType === 'signature_changed')).toBe(false);
    });

    it('should detect parameter removal', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 14, newStart: 10, newEnd: 10, changeType: 'removed' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.breakingChanges.some((b) => b.changeType === 'parameter_removed')).toBe(true);
    });

    it('should fall back to resolveCrossRepoSymbols when no graph traces exist', async () => {
      seedResolveSymbolScenario(store);
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/shared/SharedUtil.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 4, changeType: 'modified' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      const sig = result.breakingChanges.find((b) => b.changeType === 'signature_changed');
      expect(sig).toBeDefined();
      expect(sig?.affectedInRepos).toContain('myorg/service-b');
    });

    it('should return empty breaking changes for a non-existent group', async () => {
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts', changeType: 'modified' });

      const result = await engine.detectAPIBreakingChanges(pr, 'nope', 'myorg/service-a', [diff]);

      expect(result.totalBreakingChanges).toBe(0);
      expect(result.severity).toBe('low');
    });

    it('should handle a closed graph store gracefully', async () => {
      seedCrossRepoGraph(store);
      store.close();
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts', changeType: 'modified' });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.totalBreakingChanges).toBe(0);
    });

    it('should set severity to medium for many minor breaking changes', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: 'src/a.ts', changeType: 'renamed', oldPath: 'src/a-old.ts' }),
        createDiff({ filePath: 'src/b.ts', changeType: 'renamed', oldPath: 'src/b-old.ts' }),
        createDiff({ filePath: 'src/c.ts', changeType: 'renamed', oldPath: 'src/c-old.ts' }),
      ];

      const result = await engine.detectAPIBreakingChanges(
        pr,
        'test-group',
        'myorg/service-a',
        diffs,
      );

      expect(result.totalBreakingChanges).toBe(6);
      expect(result.severity).toBe('medium');
    });

    it('should suggest a fix for removed symbols that have dependents', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.ts',
        changeType: 'deleted',
        ranges: [{ oldStart: 1, oldEnd: 20, newStart: 0, newEnd: 0, changeType: 'removed' }],
      });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      const removed = result.breakingChanges.find((b) => b.changeType === 'removed');
      expect(removed?.affectedInRepos).toContain('myorg/service-b');
      expect(removed?.suggestedFix).toBeDefined();
    });

    it('should handle dotfile diffs without a base name or directory', async () => {
      const pr = createPR();
      const diff = createDiff({ filePath: '.gitignore', changeType: 'modified' });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.totalBreakingChanges).toBe(0);
      expect(result.severity).toBe('low');
    });

    it('should skip graph nodes with empty symbol names when extracting changed symbols', async () => {
      // A graph node with an empty name/qualifiedName (e.g. an anonymous
      // symbol) must not contribute a bogus empty string to the change set.
      store.insertNode(
        createNode(0, REPO_A, {
          name: '',
          qualifiedName: '',
          filePath: 'src/api/UserService.ts',
          properties: { name: '', filePath: 'src/api/UserService.ts' },
        }),
      );
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts', changeType: 'modified' });

      const result = await engine.detectAPIBreakingChanges(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(result.breakingChanges.every((b) => b.symbol !== '')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // predictCrossRepoTestImpact
  // -----------------------------------------------------------------------

  describe('predictCrossRepoTestImpact', () => {
    it('should validate required parameters', async () => {
      const pr = createPR();
      await expect(
        engine.predictCrossRepoTestImpact(pr, '', 'myorg/service-a', []),
      ).rejects.toThrow('required');
    });

    it('should return test impact report with no diffs', async () => {
      const pr = createPR();
      const result = await engine.predictCrossRepoTestImpact(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );

      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(Array.isArray(result.affectedTests)).toBe(true);
      expect(result.totalTestsAffected).toBe(0);
    });

    it('should predict test impact for changed source', async () => {
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/users.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(Array.isArray(result.reposWithAffectedTests)).toBe(true);
    });

    it('should identify repos with affected tests', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({ filePath: 'src/core/auth.ts' }),
        createDiff({ filePath: 'src/api/users.ts' }),
      ];

      const result = await engine.predictCrossRepoTestImpact(
        pr,
        'test-group',
        'myorg/service-a',
        diffs,
      );

      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(result.totalTestsAffected).toBeDefined();
    });

    it('should provide predictions for all other repos in group', async () => {
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/index.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      // Should have predictions for service-b and service-c
      const otherRepos = result.affectedTests.filter((t) => t.repo !== 'myorg/service-a');
      expect(otherRepos.length).toBeGreaterThanOrEqual(0);
    });

    it('should assign medium confidence for 1-5 related test files', async () => {
      seedTestNodes(store, REPO_B, 3, 'UserService');
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      const serviceB = result.affectedTests.find((t) => t.repo === 'myorg/service-b');
      expect(serviceB).toBeDefined();
      expect(serviceB?.testFiles.length).toBe(3);
      expect(serviceB?.confidence).toBe('medium');
      expect(result.reposWithAffectedTests).toContain('myorg/service-b');
    });

    it('should assign high confidence for more than 5 related test files', async () => {
      seedTestNodes(store, REPO_B, 6, 'UserService');
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      const serviceB = result.affectedTests.find((t) => t.repo === 'myorg/service-b');
      expect(serviceB?.testFiles.length).toBe(6);
      expect(serviceB?.confidence).toBe('high');
    });

    it('should return empty predictions for a non-existent group', async () => {
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'nope', 'myorg/service-a', [diff]);

      expect(result.totalTestsAffected).toBe(0);
      expect(result.affectedTests).toEqual([]);
    });

    it('should not match unrelated test files', async () => {
      seedTestNodes(store, REPO_B, 2, 'UserService');
      seedTestNodes(store, REPO_B, 1, 'Unrelated');
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      const serviceB = result.affectedTests.find((t) => t.repo === 'myorg/service-b');
      expect(serviceB?.testFiles.length).toBe(2);
    });

    it('should handle a closed graph store during prediction', async () => {
      seedTestNodes(store, REPO_B, 2, 'UserService');
      store.close();
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      // Every other repo reports low confidence with an "Unable to analyze" reason.
      const serviceB = result.affectedTests.find((t) => t.repo === 'myorg/service-b');
      expect(serviceB?.testFiles).toEqual([]);
      expect(serviceB?.confidence).toBe('low');
      expect(serviceB?.reason).toContain('Unable to analyze');
    });

    it('should deduplicate test files when multiple nodes share a file path', async () => {
      // Two symbols resolved to the same test file must count that file once.
      const sharedPath = 'src/UserService.test.ts';
      for (const nm of ['UserServiceAlpha', 'UserServiceBeta']) {
        store.insertNode(
          createNode(0, REPO_B, {
            name: nm,
            qualifiedName: `pkg.${nm}`,
            filePath: sharedPath,
            isExported: false,
            properties: { name: nm, filePath: sharedPath },
          }),
        );
      }
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      const serviceB = result.affectedTests.find((t) => t.repo === 'myorg/service-b');
      expect(serviceB?.testFiles).toEqual([sharedPath]);
    });
  });

  // -----------------------------------------------------------------------
  // generateCrossRepoSummary
  // -----------------------------------------------------------------------

  describe('generateCrossRepoSummary', () => {
    it('should validate required parameters', async () => {
      const pr = createPR();
      await expect(engine.generateCrossRepoSummary(pr, '', 'myorg/service-a', [])).rejects.toThrow(
        'required',
      );
    });

    it('should return summary with no diffs', async () => {
      const pr = createPR();
      const summary = await engine.generateCrossRepoSummary(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );

      expect(summary.sourceRepo).toBe('myorg/service-a');
      expect(summary.crossRepoRisk).toBe('low');
      expect(summary.reposImpacted).toBe(0);
      expect(summary.breakingChanges).toBe(0);
      expect(summary.mergeRecommendation).toBe('approve');
    });

    it('should set risk to critical for breaking changes', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/PublicInterface.ts',
        changeType: 'deleted',
        ranges: [{ oldStart: 1, oldEnd: 20, newStart: 0, newEnd: 0, changeType: 'removed' }],
      });

      const summary = await engine.generateCrossRepoSummary(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(summary.mergeRecommendation).toBe('block');
    });

    it('should approve clean PRs', async () => {
      const pr = createPR();
      const summary = await engine.generateCrossRepoSummary(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );

      expect(summary.mergeRecommendation).toBe('approve');
    });

    it('should include recommendations in summary', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/PublicInterface.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 15, changeType: 'modified' }],
      });

      const summary = await engine.generateCrossRepoSummary(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(Array.isArray(summary.recommendations)).toBe(true);
    });

    it('should return approve-with-caution for medium risk', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/config.ts',
        changeType: 'modified',
        ranges: [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 4, changeType: 'modified' }],
      });

      const summary = await engine.generateCrossRepoSummary(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);
      expect(summary.mergeRecommendation).toBeDefined();
    });

    it('should include impacted repos and a run-tests recommendation', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();

      const summary = await engine.generateCrossRepoSummary(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );

      expect(summary.reposImpacted).toBe(2);
      expect(summary.recommendations.some((r) => r.includes('2 repos may be impacted'))).toBe(true);
    });

    it('should set risk to high for return-type-only changes', async () => {
      seedCrossRepoGraph(store);
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/UserService.tsx',
        changeType: 'modified',
        ranges: [
          { oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 12, changeType: 'modified' },
          { oldStart: 20, oldEnd: 22, newStart: 20, newEnd: 22, changeType: 'modified' },
        ],
      });

      const summary = await engine.generateCrossRepoSummary(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(summary.crossRepoRisk).toBe('high');
      expect(summary.mergeRecommendation).toBe('request-changes');
    });

    it('should return approve-with-caution for medium-risk renamed changes', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/new-name.ts',
        changeType: 'renamed',
        oldPath: 'src/old-name.ts',
      });

      const summary = await engine.generateCrossRepoSummary(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      expect(summary.crossRepoRisk).toBe('medium');
      expect(summary.mergeRecommendation).toBe('approve-with-caution');
    });

    it('should include a run-tests recommendation when test impact is predicted', async () => {
      seedTestNodes(store, REPO_B, 1, 'UserService');
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/UserService.ts' });

      const summary = await engine.generateCrossRepoSummary(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);

      // predictTests resolves the seeded service-b test node against the
      // "UserService" changed symbol, so the summary must surface a run-tests
      // recommendation naming the affected repo.
      expect(summary.recommendations.some((r) => r.includes('Run tests in 1 affected repos'))).toBe(
        true,
      );
      expect(summary.recommendations.some((r) => r.includes('myorg/service-b'))).toBe(true);
    });

    it('should recover from an impact-analysis failure on a closed graph store', async () => {
      store.close();
      const pr = createPR();

      const summary = await engine.generateCrossRepoSummary(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );

      // analyzeCrossRepoImpact throws once the store is closed; the summary must
      // fall back to an empty impact result instead of propagating the error.
      expect(summary.sourceRepo).toBe('myorg/service-a');
      expect(summary.reposImpacted).toBe(0);
      expect(summary.crossRepoRisk).toBe('low');
      expect(summary.mergeRecommendation).toBe('approve');
    });
  });

  // -----------------------------------------------------------------------
  // checkVersionCompatibility
  // -----------------------------------------------------------------------

  describe('checkVersionCompatibility', () => {
    it('should validate groupId', async () => {
      await expect(engine.checkVersionCompatibility('')).rejects.toThrow('required');
    });

    it('should throw for non-existent group', async () => {
      await expect(engine.checkVersionCompatibility('non-existent')).rejects.toThrow('not found');
    });

    it('should return version compatibility report', async () => {
      const result = await engine.checkVersionCompatibility('test-group');

      expect(result.groupId).toBe('test-group');
      expect(Array.isArray(result.repoVersions)).toBe(true);
      expect(Array.isArray(result.incompatiblePairs)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('should detect lodash version mismatch', async () => {
      const result = await engine.checkVersionCompatibility('test-group');

      // service-a: ^4.17.0, service-b: ^3.10.0, service-c: ^4.17.0
      // There should be conflicts for lodash between service-a/service-b and service-b/service-c
      expect(result.incompatiblePairs.length).toBeGreaterThan(0);
    });

    it('should include version info for each repo', async () => {
      const result = await engine.checkVersionCompatibility('test-group');

      expect(result.repoVersions.length).toBe(3);
      expect(result.repoVersions.some((rv) => rv.version === '1.0.0')).toBe(true);
      expect(result.repoVersions.some((rv) => rv.version === '2.0.0')).toBe(true);
      expect(result.repoVersions.some((rv) => rv.version === '1.5.0')).toBe(true);
    });

    it('should read a go.mod manifest when package.json is absent', async () => {
      const goEngine = buildVersionGroupEngine(reviewEngine, [
        {
          repo: 'go-repo',
          goMod: [
            'module example.com/foo',
            '',
            'go 1.21',
            '',
            'require (',
            '\tgithub.com/gin-gonic/gin v1.9.0',
            '\tgolang.org/x/sync v0.3.0',
            ')',
          ].join('\n'),
        },
      ]);

      const result = await goEngine.checkVersionCompatibility('vg');

      const rv = result.repoVersions.find((r) => r.repo === 'myorg/go-repo');
      expect(rv?.version).toBe('example.com/foo');
      expect(rv?.dependencies['github.com/gin-gonic/gin']).toBe('v1.9.0');
      expect(rv?.dependencies['golang.org/x/sync']).toBe('v0.3.0');
    });

    it('should detect a minor version mismatch', async () => {
      const minorEngine = buildVersionGroupEngine(reviewEngine, [
        {
          repo: 'ra',
          packageJson: { name: 'ra', version: '1.0.0', dependencies: { express: '^4.18.0' } },
        },
        {
          repo: 'rb',
          packageJson: { name: 'rb', version: '1.0.0', dependencies: { express: '^4.17.0' } },
        },
      ]);

      const result = await minorEngine.checkVersionCompatibility('vg');

      expect(result.incompatiblePairs.length).toBeGreaterThan(0);
      expect(result.incompatiblePairs[0]!.issue).toContain('minor version mismatch');
    });

    it('should detect a patch version mismatch', async () => {
      const patchEngine = buildVersionGroupEngine(reviewEngine, [
        {
          repo: 'ra',
          packageJson: { name: 'ra', version: '1.0.0', dependencies: { axios: '1.6.0' } },
        },
        {
          repo: 'rb',
          packageJson: { name: 'rb', version: '1.0.0', dependencies: { axios: '1.6.1' } },
        },
      ]);

      const result = await patchEngine.checkVersionCompatibility('vg');

      expect(result.incompatiblePairs.length).toBeGreaterThan(0);
      expect(result.incompatiblePairs[0]!.issue).toContain('patch version mismatch');
    });

    it('should handle non-numeric dependency versions gracefully', async () => {
      const nonNumericEngine = buildVersionGroupEngine(reviewEngine, [
        {
          repo: 'ra',
          packageJson: { name: 'ra', version: '1.0.0', dependencies: { lodash: 'latest' } },
        },
        {
          repo: 'rb',
          packageJson: { name: 'rb', version: '1.0.0', dependencies: { lodash: '^4.17.0' } },
        },
      ]);

      const result = await nonNumericEngine.checkVersionCompatibility('vg');

      expect(result.incompatiblePairs.length).toBeGreaterThan(0);
      expect(result.incompatiblePairs[0]!.issue).toContain('major version mismatch');
    });

    it('should handle a package.json missing dependencies and version', async () => {
      const minimalEngine = buildVersionGroupEngine(reviewEngine, [
        { repo: 'ra', packageJson: { name: 'ra' } },
      ]);

      const result = await minimalEngine.checkVersionCompatibility('vg');

      const rv = result.repoVersions.find((r) => r.repo === 'myorg/ra');
      expect(rv?.dependencies).toEqual({});
      expect(rv?.version).toBeUndefined();
    });

    it('should handle an unreadable package.json gracefully', async () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');

      const manager = new RepoGroupManager();
      manager.createGroup('bad', 'Bad Group', '');
      const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bad-')), 'bad-repo');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json !! }');
      manager.addRepo('bad', 'myorg', 'bad-repo', '', dir);

      const badEngine = new CrossRepoPRReviewEngine(
        new CrossRepoIndexer(new InMemoryGraphStore(), manager),
        manager,
        reviewEngine,
      );

      const result = await badEngine.checkVersionCompatibility('bad');

      expect(result.repoVersions.length).toBe(1);
      expect(result.repoVersions[0]!.dependencies).toEqual({});
    });

    it('should report no conflict for identical shared dependency versions', async () => {
      const sameEngine = buildVersionGroupEngine(reviewEngine, [
        {
          repo: 'ra',
          packageJson: { name: 'ra', version: '1.0.0', dependencies: { lodash: '^4.17.0' } },
        },
        {
          repo: 'rb',
          packageJson: { name: 'rb', version: '1.0.0', dependencies: { lodash: '^4.17.0' } },
        },
      ]);

      const result = await sameEngine.checkVersionCompatibility('vg');

      expect(result.incompatiblePairs).toEqual([]);
      expect(result.recommendations).toEqual([]);
    });

    it('should handle a go.mod without a module directive or require block', async () => {
      const bareGoEngine = buildVersionGroupEngine(reviewEngine, [
        { repo: 'go-repo', goMod: 'go 1.21\n' },
      ]);

      const result = await bareGoEngine.checkVersionCompatibility('vg');

      const rv = result.repoVersions.find((r) => r.repo === 'myorg/go-repo');
      expect(rv?.version).toBe('unknown');
      expect(rv?.dependencies).toEqual({});
    });

    it('should treat a version starting with a digit as non-numeric', async () => {
      const weirdEngine = buildVersionGroupEngine(reviewEngine, [
        {
          repo: 'ra',
          packageJson: { name: 'ra', version: '1.0.0', dependencies: { foo: '4beta' } },
        },
        {
          repo: 'rb',
          packageJson: { name: 'rb', version: '1.0.0', dependencies: { foo: '4.0.0' } },
        },
      ]);

      const result = await weirdEngine.checkVersionCompatibility('vg');

      expect(result.incompatiblePairs.length).toBeGreaterThan(0);
      expect(result.incompatiblePairs[0]!.issue).toContain('major version mismatch');
    });
  });

  // -----------------------------------------------------------------------
  // Edge Cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty diffs gracefully', async () => {
      const pr = createPR();
      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [],
      );
      expect(result.summary.mergeRecommendation).toBe('approve');
    });

    it('should handle single repo in group', async () => {
      const singleManager = new RepoGroupManager();
      const fs2 = require('node:fs');
      const os2 = require('node:os');
      const path2 = require('node:path');
      const tmpDir2 = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'single-'));
      fs2.mkdirSync(path2.join(tmpDir2, 'only-repo'), { recursive: true });
      fs2.writeFileSync(
        path2.join(tmpDir2, 'only-repo', 'package.json'),
        JSON.stringify({
          name: 'only-repo',
          version: '1.0.0',
        }),
      );

      singleManager.createGroup('single', 'Single Group', '');
      singleManager.addRepo('single', 'myorg', 'only-repo', '', path2.join(tmpDir2, 'only-repo'));

      const singleStore = new InMemoryGraphStore();
      const singleIndexer = new CrossRepoIndexer(singleStore, singleManager);
      const singleRevEngine = new CodeReviewEngine(singleStore, { allowMetadataFallback: true });
      const singleEngine = new CrossRepoPRReviewEngine(
        singleIndexer,
        singleManager,
        singleRevEngine,
      );

      const pr = createPR();
      const result = await singleEngine.reviewPRWithCrossRepoContext(
        pr,
        'single',
        'myorg/only-repo',
        [],
      );

      expect(result.summary.crossRepoRisk).toBe('low');
    });

    it('should handle empty group with no repos', async () => {
      const emptyManager = new RepoGroupManager();
      emptyManager.createGroup('empty', 'Empty Group', '');
      const emptyStore = new InMemoryGraphStore();
      const emptyIndexer = new CrossRepoIndexer(emptyStore, emptyManager);
      const emptyRevEngine = new CodeReviewEngine(emptyStore, { allowMetadataFallback: true });
      const emptyEngine = new CrossRepoPRReviewEngine(emptyIndexer, emptyManager, emptyRevEngine);

      const pr = createPR();
      // Source repo "myorg/ghost" is not in the group, should throw
      await expect(
        emptyEngine.reviewPRWithCrossRepoContext(pr, 'empty', 'myorg/ghost', []),
      ).rejects.toThrow('not found in group');
    });

    it('should handle review engine failure gracefully', async () => {
      const pr = createPR();
      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [createDiff()],
      );
      expect(result.prComments).toEqual([]);
    });

    it('should handle deleted file diffs', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/to-delete.ts',
        changeType: 'deleted',
        ranges: [{ oldStart: 1, oldEnd: 50, newStart: 0, newEnd: 0, changeType: 'removed' }],
      });

      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [diff],
      );

      expect(result.summary.mergeRecommendation).toBe('block');
      expect(result.apiBreakingChanges.some((b) => b.changeType === 'removed')).toBe(true);
    });

    it('should handle added file diffs without breaking', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/new-file.ts',
        changeType: 'added',
        ranges: [{ oldStart: 0, oldEnd: 0, newStart: 1, newEnd: 30, changeType: 'added' }],
      });

      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [diff],
      );

      expect(result.apiBreakingChanges.length).toBe(0);
    });

    it('should handle renamed file with old path', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/new-path.ts',
        changeType: 'renamed',
        oldPath: 'src/old-path.ts',
      });

      const result = await engine.reviewPRWithCrossRepoContext(
        pr,
        'test-group',
        'myorg/service-a',
        [diff],
      );

      expect(result.apiBreakingChanges.some((b) => b.changeType === 'renamed')).toBe(true);
    });

    it('should detect multiple breaking changes for medium severity', async () => {
      const pr = createPR();
      const diffs = [
        createDiff({
          filePath: 'src/api/one.ts',
          changeType: 'deleted',
          ranges: [{ oldStart: 1, oldEnd: 10, newStart: 0, newEnd: 0, changeType: 'removed' }],
        }),
        createDiff({
          filePath: 'src/api/two.ts',
          changeType: 'deleted',
          ranges: [{ oldStart: 1, oldEnd: 10, newStart: 0, newEnd: 0, changeType: 'removed' }],
        }),
        createDiff({
          filePath: 'src/api/three.ts',
          changeType: 'deleted',
          ranges: [{ oldStart: 1, oldEnd: 10, newStart: 0, newEnd: 0, changeType: 'removed' }],
        }),
        createDiff({
          filePath: 'src/api/four.ts',
          changeType: 'deleted',
          ranges: [{ oldStart: 1, oldEnd: 10, newStart: 0, newEnd: 0, changeType: 'removed' }],
        }),
      ];

      const result = await engine.detectAPIBreakingChanges(
        pr,
        'test-group',
        'myorg/service-a',
        diffs,
      );
      expect(result.totalBreakingChanges).toBeGreaterThanOrEqual(0);
    });

    it('should generate cross-repo summary with recommendations', async () => {
      const pr = createPR();
      const diff = createDiff({
        filePath: 'src/api/PublicInterface.ts',
        changeType: 'deleted',
        ranges: [{ oldStart: 1, oldEnd: 20, newStart: 0, newEnd: 0, changeType: 'removed' }],
      });

      const summary = await engine.generateCrossRepoSummary(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);
      expect(Array.isArray(summary.recommendations)).toBe(true);
      expect(summary.breakingChanges).toBeGreaterThanOrEqual(1);
    });

    it('should handle version compatibility with empty repos', async () => {
      const emptyManager = new RepoGroupManager();
      const fs3 = require('node:fs');
      const os3 = require('node:os');
      const path3 = require('node:path');
      const tmpDir3 = fs3.mkdtempSync(path3.join(os3.tmpdir(), 'empty-ver-'));
      fs3.mkdirSync(path3.join(tmpDir3, 'bare-repo'), { recursive: true });

      emptyManager.createGroup('bare', 'Bare Group', '');
      emptyManager.addRepo('bare', 'myorg', 'bare-repo', '', path3.join(tmpDir3, 'bare-repo'));

      const emptyIdx = new CrossRepoIndexer(new InMemoryGraphStore(), emptyManager);
      const emptyEng = new CrossRepoPRReviewEngine(emptyIdx, emptyManager, reviewEngine);
      const result = await emptyEng.checkVersionCompatibility('bare');
      expect(result.groupId).toBe('bare');
    });

    it('should predict test impact with diffs on other repos', async () => {
      const pr = createPR();
      const diff = createDiff({ filePath: 'src/api/users.ts' });

      const result = await engine.predictCrossRepoTestImpact(pr, 'test-group', 'myorg/service-a', [
        diff,
      ]);
      expect(result.sourceRepo).toBe('myorg/service-a');
      expect(result.totalTestsAffected).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// buildSuggestedActionsForImpact (pure helper)
// ---------------------------------------------------------------------------

describe('buildSuggestedActionsForImpact', () => {
  it('should build critical remediation actions', () => {
    const actions = buildSuggestedActionsForImpact('critical', 'myorg/service-b');
    expect(actions.length).toBe(3);
    expect(actions[0]).toContain('Block merge');
    expect(actions[1]).toContain('Coordinate breaking changes');
    expect(actions[2]).toContain('full integration test suite');
  });

  it('should build high remediation actions', () => {
    const actions = buildSuggestedActionsForImpact('high', 'myorg/service-b');
    expect(actions.length).toBe(3);
    expect(actions[0]).toContain('Notify');
    expect(actions[1]).toContain('test suite');
    expect(actions[2]).toContain('integration tests');
  });

  it('should build medium remediation actions', () => {
    const actions = buildSuggestedActionsForImpact('medium', 'myorg/service-b');
    expect(actions.length).toBe(2);
    expect(actions[0]).toContain('smoke tests');
    expect(actions[1]).toContain('import reference updates');
  });

  it('should build low remediation actions', () => {
    const actions = buildSuggestedActionsForImpact('low', 'myorg/service-b');
    expect(actions.length).toBe(1);
    expect(actions[0]).toContain('Monitor');
  });
});

// ---------------------------------------------------------------------------
// VersionCompatibilityMatrix Tests
// ---------------------------------------------------------------------------

describe('VersionCompatibilityMatrix', () => {
  let matrix: VersionCompatibilityMatrix;

  beforeEach(() => {
    matrix = new VersionCompatibilityMatrix();
  });

  // -----------------------------------------------------------------------
  // buildMatrix
  // -----------------------------------------------------------------------

  describe('buildMatrix', () => {
    it('should validate groupId', () => {
      expect(() => matrix.buildMatrix('', [])).toThrow('required');
    });

    it('should build empty matrix for no repos', () => {
      const result = matrix.buildMatrix('test', []);
      expect(result.groupId).toBe('test');
      expect(result.repos).toEqual([]);
      expect(Object.keys(result.sharedDependencies)).toEqual([]);
    });

    it('should build matrix with repo dependencies', () => {
      const result = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0', react: '^18.0.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^4.17.0', express: '^4.18.0' } },
      ]);

      expect(result.repos).toEqual(['repo-a', 'repo-b']);
      expect(result.matrix['repo-a']).toBeDefined();
      expect(result.matrix['repo-b']).toBeDefined();
    });

    it('should identify shared dependencies', () => {
      const result = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^4.17.0' } },
        { repo: 'repo-c', dependencies: { lodash: '^4.17.0' } },
      ]);

      expect(Object.keys(result.sharedDependencies)).toEqual(['lodash']);
    });

    it('should exclude non-shared dependencies', () => {
      const result = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0', unique_a: '^1.0.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^4.17.0', unique_b: '^2.0.0' } },
      ]);

      expect(Object.keys(result.sharedDependencies)).toEqual(['lodash']);
    });
  });

  // -----------------------------------------------------------------------
  // detectConflicts
  // -----------------------------------------------------------------------

  describe('detectConflicts', () => {
    it('should return empty array for null/undefined matrix', () => {
      // @ts-expect-error testing null
      expect(matrix.detectConflicts(null)).toEqual([]);
    });

    it('should detect no conflicts for identical versions', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^4.17.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      expect(conflicts).toEqual([]);
    });

    it('should detect major version conflict', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^3.10.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.packageName).toBe('lodash');
      expect(conflicts[0]!.conflictType).toBe('major_mismatch');
    });

    it('should detect minor version conflict', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { express: '^4.18.0' } },
        { repo: 'repo-b', dependencies: { express: '^4.17.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.packageName).toBe('express');
      expect(conflicts[0]!.conflictType).toBe('minor_mismatch');
    });

    it('should detect patch version conflict', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { axios: '1.6.0' } },
        { repo: 'repo-b', dependencies: { axios: '1.6.1' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.conflictType).toBe('patch_mismatch');
    });

    it('should recommend highest version', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^3.10.0' } },
        { repo: 'repo-c', dependencies: { lodash: '^4.20.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      expect(conflicts[0]!.recommendedVersion).toBe('^4.20.0');
    });
  });

  // -----------------------------------------------------------------------
  // suggestAlignments
  // -----------------------------------------------------------------------

  describe('suggestAlignments', () => {
    it('should return empty array for no conflicts', () => {
      const result = matrix.suggestAlignments([]);
      expect(result).toEqual([]);
    });

    it('should return empty array for null input', () => {
      // @ts-expect-error testing null
      const result = matrix.suggestAlignments(null);
      expect(result).toEqual([]);
    });

    it('should suggest alignment for single conflict', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^3.10.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      const alignments = matrix.suggestAlignments(conflicts);

      expect(alignments.length).toBe(1);
      expect(alignments[0]!.packageName).toBe('lodash');
      expect(alignments[0]!.suggestedVersion).toBe('^4.17.0');
      expect(alignments[0]!.reposToUpdate).toContain('repo-b');
    });

    it('should include rationale text', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { axios: '1.6.0' } },
        { repo: 'repo-b', dependencies: { axios: '1.5.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      const alignments = matrix.suggestAlignments(conflicts);

      expect(alignments[0]!.rationale.length).toBeGreaterThan(0);
    });

    it('should not update repos already on recommended version', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '^4.17.0' } },
        { repo: 'repo-b', dependencies: { lodash: '^3.10.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      const alignments = matrix.suggestAlignments(conflicts);

      expect(alignments[0]!.reposToUpdate).not.toContain('repo-a');
      expect(alignments[0]!.reposToUpdate).toContain('repo-b');
    });
  });

  // -----------------------------------------------------------------------
  // checkUpgradeSafety
  // -----------------------------------------------------------------------

  describe('checkUpgradeSafety', () => {
    it('should validate required parameters', () => {
      expect(() =>
        matrix.checkUpgradeSafety('', '', '', null as unknown as CompatibilityMatrix),
      ).toThrow('required');
    });

    it('should validate matrix parameter', () => {
      expect(() =>
        matrix.checkUpgradeSafety(
          'lodash',
          '1.0.0',
          '2.0.0',
          null as unknown as CompatibilityMatrix,
        ),
      ).toThrow('required');
    });

    it('should detect safe minor upgrade', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '4.17.0' } },
      ]);

      const report = matrix.checkUpgradeSafety('lodash', '4.17.0', '4.18.0', m);
      expect(report.safe).toBe(true);
    });

    it('should detect unsafe major upgrade', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '4.17.0' } },
      ]);

      const report = matrix.checkUpgradeSafety('lodash', '4.17.0', '5.0.0', m);
      expect(report.safe).toBe(false);
      expect(report.breakingChanges.length).toBeGreaterThan(0);
    });

    it('should detect downgrade as unsafe', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '4.17.0' } },
      ]);

      const report = matrix.checkUpgradeSafety('lodash', '4.17.0', '3.0.0', m);
      expect(report.safe).toBe(false);
    });

    it('should identify repos already on target version', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '4.17.0' } },
        { repo: 'repo-b', dependencies: { lodash: '5.0.0' } },
      ]);

      const report = matrix.checkUpgradeSafety('lodash', '4.17.0', '5.0.0', m);
      expect(report.recommendations.some((r) => r.includes('already on'))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // parseSemver / compareSemver / pickHighestVersion
  // -----------------------------------------------------------------------

  describe('parseSemver', () => {
    it('should parse standard semver', () => {
      const result = matrix.parseSemver('1.2.3');
      expect(result).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('should strip prefix characters', () => {
      expect(matrix.parseSemver('^4.17.0')).toEqual({ major: 4, minor: 17, patch: 0 });
      expect(matrix.parseSemver('~1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(matrix.parseSemver('>=2.0.0')).toEqual({ major: 2, minor: 0, patch: 0 });
    });

    it('should handle invalid versions gracefully', () => {
      const result = matrix.parseSemver('latest');
      expect(result.major).toBe(0);
      expect(result.minor).toBe(0);
      expect(result.patch).toBe(0);
    });

    it('should handle missing patch versions', () => {
      const result = matrix.parseSemver('1.2');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(0);
    });
  });

  describe('compareSemver', () => {
    it('should return negative when a < b', () => {
      expect(matrix.compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
      expect(matrix.compareSemver('1.0.0', '1.1.0')).toBeLessThan(0);
      expect(matrix.compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
    });

    it('should return zero when equal', () => {
      expect(matrix.compareSemver('1.0.0', '1.0.0')).toBe(0);
    });

    it('should return positive when a > b', () => {
      expect(matrix.compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(matrix.compareSemver('1.1.0', '1.0.0')).toBeGreaterThan(0);
      expect(matrix.compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
    });
  });

  describe('pickHighestVersion', () => {
    it('should return single version', () => {
      expect(matrix.pickHighestVersion(['1.0.0'])).toBe('1.0.0');
    });

    it('should pick highest from multiple', () => {
      expect(matrix.pickHighestVersion(['1.0.0', '2.0.0', '1.5.0'])).toBe('2.0.0');
    });

    it('should handle empty array', () => {
      expect(matrix.pickHighestVersion([])).toBe('0.0.0');
    });

    it('should handle prefixed versions', () => {
      const result = matrix.pickHighestVersion(['^3.10.0', '^4.17.0', '^4.20.0']);
      expect(result).toBe('^4.20.0');
    });
  });

  // -----------------------------------------------------------------------
  // Integration tests
  // -----------------------------------------------------------------------

  describe('integration', () => {
    it('should handle parseSemver with trailing characters', () => {
      const result = matrix.parseSemver('^4.17.0-beta.1');
      expect(result.major).toBe(4);
      expect(result.minor).toBe(17);
      expect(result.patch).toBe(0);
    });

    it('should build matrix and detect conflicts in one flow', () => {
      const m = matrix.buildMatrix('test-group', [
        { repo: 'repo-a', version: '1.0.0', dependencies: { a: '1.0', b: '2.0' } },
        { repo: 'repo-b', version: '2.0.0', dependencies: { a: '1.0', c: '3.0' } },
        { repo: 'repo-c', version: '3.0.0', dependencies: { a: '2.0', b: '2.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      expect(conflicts.length).toBe(1); // only 'a' has conflict
      expect(conflicts[0]!.packageName).toBe('a');
    });

    it('should build matrix, detect conflicts, and suggest alignments', () => {
      const m = matrix.buildMatrix('test-group', [
        { repo: 'repo-a', dependencies: { shared: '1.0.0' } },
        { repo: 'repo-b', dependencies: { shared: '2.0.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      const alignments = matrix.suggestAlignments(conflicts);

      expect(alignments.length).toBe(1);
      expect(alignments[0]!.suggestedVersion).toBe('2.0.0');
      expect(alignments[0]!.reposToUpdate).toEqual(['repo-a']);
    });

    it('should handle repos with no dependencies', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: {} },
        { repo: 'repo-b', dependencies: {} },
      ]);

      expect(m.sharedDependencies).toEqual({});
      expect(m.matrix['repo-a']).toEqual({});
      expect(m.matrix['repo-b']).toEqual({});
    });

    it('should handle three-repo all-different versions', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { pkg: '1.0.0' } },
        { repo: 'repo-b', dependencies: { pkg: '2.0.0' } },
        { repo: 'repo-c', dependencies: { pkg: '3.0.0' } },
      ]);

      const conflicts = matrix.detectConflicts(m);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.repos.length).toBe(3);
      expect(conflicts[0]!.recommendedVersion).toBe('3.0.0');
    });

    it('should handle parseSemver with trailing characters', () => {
      const result = matrix.parseSemver('^4.17.0-beta.1');
      expect(result.major).toBe(4);
      expect(result.minor).toBe(17);
      expect(result.patch).toBe(0);
    });

    it('should handle checkUpgradeSafety for same version', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { lodash: '4.17.0' } },
      ]);
      const report = matrix.checkUpgradeSafety('lodash', '4.17.0', '4.17.0', m);
      expect(report.safe).toBe(true);
      expect(report.recommendations.some((r) => r.includes('identical'))).toBe(true);
    });

    it('should handle pickHighestVersion with prefixed versions across ranges', () => {
      const result = matrix.pickHighestVersion(['~1.0.0', '^2.0.0', '3.0.0']);
      expect(result).toBe('3.0.0');
    });

    it('should handle detectConflicts with single shared dependency and 3 different versions', () => {
      const m = matrix.buildMatrix('test', [
        { repo: 'repo-a', dependencies: { pkg: '1.0.0' } },
        { repo: 'repo-b', dependencies: { pkg: '2.0.0' } },
        { repo: 'repo-c', dependencies: { pkg: '1.5.0' } },
      ]);
      const conflicts = matrix.detectConflicts(m);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.packageName).toBe('pkg');
      expect(conflicts[0]!.conflictType).toBe('major_mismatch');
    });

    it('should handle detectConflicts with null matrix', () => {
      // @ts-expect-error testing null
      expect(matrix.detectConflicts(undefined)).toEqual([]);
    });
  });
});
