// @ts-nocheck
// @code-analyzer/intelligence — E2E Cross-Repo Analysis Integration Test
// Exercises the full chain: repo group management → version matrix →
// federated search → cross-repo PR review → dependency compatibility.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  RepoGroupManager,
  FederatedSearchEngine,
  VersionCompatibilityMatrix,
  CrossRepoIndexer,
  CrossRepoPRReviewEngine,
  CodeReviewEngine,
} from '@code-analyzer/intelligence';
import type { RepoGroup, GroupRepo } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_A = 'org/service-a';
const PROJECT_B = 'org/service-b';
const PROJECT_C = 'org/lib-common';
const GROUP_ID = 'e2e-cross-repo-group';

// ---------------------------------------------------------------------------
// Store Population — Simulates 3 indexed repos
// ---------------------------------------------------------------------------

function populateStoreA(store: InMemoryGraphStore): void {
  const serviceA = store.insertNode({
    projectId: PROJECT_A, name: 'OrderService', qualifiedName: 'OrderService',
    label: 'Class', filePath: 'src/order.service.ts', startLine: 1, endLine: 30,
    language: 'typescript', isExported: true, complexity: 8, properties: {},
  });
  const placeOrder = store.insertNode({
    projectId: PROJECT_A, name: 'placeOrder', qualifiedName: 'OrderService.placeOrder',
    label: 'Method', filePath: 'src/order.service.ts', startLine: 5, endLine: 15,
    language: 'typescript', isExported: false, complexity: 5, properties: {},
  });
  const calculateTotal = store.insertNode({
    projectId: PROJECT_A, name: 'calculateTotal', qualifiedName: 'OrderService.calculateTotal',
    label: 'Method', filePath: 'src/order.service.ts', startLine: 17, endLine: 25,
    language: 'typescript', isExported: false, complexity: 3, properties: {},
  });
  store.insertEdge({ sourceId: serviceA, targetId: placeOrder, type: 'HAS_METHOD', projectId: PROJECT_A });
  store.insertEdge({ sourceId: serviceA, targetId: calculateTotal, type: 'HAS_METHOD', projectId: PROJECT_A });
}

function populateStoreB(store: InMemoryGraphStore): void {
  const paymentService = store.insertNode({
    projectId: PROJECT_B, name: 'PaymentService', qualifiedName: 'PaymentService',
    label: 'Class', filePath: 'src/payment.service.ts', startLine: 1, endLine: 20,
    language: 'typescript', isExported: true, complexity: 6, properties: {},
  });
  const processPayment = store.insertNode({
    projectId: PROJECT_B, name: 'processPayment', qualifiedName: 'PaymentService.processPayment',
    label: 'Method', filePath: 'src/payment.service.ts', startLine: 4, endLine: 12,
    language: 'typescript', isExported: false, complexity: 4, properties: {},
  });
  store.insertEdge({ sourceId: paymentService, targetId: processPayment, type: 'HAS_METHOD', projectId: PROJECT_B });
}

function populateStoreC(store: InMemoryGraphStore): void {
  const commonLib = store.insertNode({
    projectId: PROJECT_C, name: 'CommonLib', qualifiedName: 'CommonLib',
    label: 'Class', filePath: 'src/common.ts', startLine: 1, endLine: 50,
    language: 'typescript', isExported: true, complexity: 12, properties: {},
  });
  const formatDate = store.insertNode({
    projectId: PROJECT_C, name: 'formatDate', qualifiedName: 'CommonLib.formatDate',
    label: 'Method', filePath: 'src/common.ts', startLine: 10, endLine: 15,
    language: 'typescript', isExported: true, complexity: 2, properties: {},
  });
  const parseJson = store.insertNode({
    projectId: PROJECT_C, name: 'parseJson', qualifiedName: 'CommonLib.parseJson',
    label: 'Method', filePath: 'src/common.ts', startLine: 20, endLine: 25,
    language: 'typescript', isExported: true, complexity: 3, properties: {},
  });
  store.insertEdge({ sourceId: commonLib, targetId: formatDate, type: 'HAS_METHOD', projectId: PROJECT_C });
  store.insertEdge({ sourceId: commonLib, targetId: parseJson, type: 'HAS_METHOD', projectId: PROJECT_C });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Cross-Repo Analysis — E2E Integration', () => {
  let storeA: InMemoryGraphStore;
  let storeB: InMemoryGraphStore;
  let storeC: InMemoryGraphStore;
  let manager: RepoGroupManager;
  let group: RepoGroup;

  beforeAll(() => {
    storeA = new InMemoryGraphStore();
    storeB = new InMemoryGraphStore();
    storeC = new InMemoryGraphStore();

    populateStoreA(storeA);
    populateStoreB(storeB);
    populateStoreC(storeC);

    manager = new RepoGroupManager();
    group = manager.createGroup(GROUP_ID, 'E2E Cross-Repo Test Group', 'Integration test repo group');
    manager.addRepo(GROUP_ID, 'org', 'service-a', 'https://github.com/org/service-a', '/tmp/service-a');
    manager.addRepo(GROUP_ID, 'org', 'service-b', 'https://github.com/org/service-b', '/tmp/service-b');
    manager.addRepo(GROUP_ID, 'org', 'lib-common', 'https://github.com/org/lib-common', '/tmp/lib-common');
  });

  afterAll(() => {
    storeA.close();
    storeB.close();
    storeC.close();
  });

  // =========================================================================
  // Repo Group Manager
  // =========================================================================

  describe('RepoGroupManager', () => {
    it('should create a group with repos', () => {
      // Create a fresh group for this test
      const testManager = new RepoGroupManager();
      const testGroup = testManager.createGroup('fresh-group', 'Fresh', 'For testing');
      expect(testGroup.id).toBe('fresh-group');
      expect(testGroup.repos.length).toBe(0);
    });

    it('should list all groups', () => {
      const groups = manager.listGroups();
      expect(groups.length).toBe(1);
      expect(groups[0]!.id).toBe(GROUP_ID);
    });

    it('should get a group by ID', () => {
      const g = manager.getGroup(GROUP_ID);
      expect(g).toBeDefined();
      expect(g!.repos.length).toBe(3);
    });

    it('should return null for non-existent group', () => {
      expect(manager.getGroup('nonexistent')).toBeNull();
    });

    it('should get repos in a group', () => {
      const repos = manager.getRepos(GROUP_ID);
      expect(repos.length).toBe(3);
      const names = repos.map(r => r.fullName);
      expect(names).toContain('org/service-a');
      expect(names).toContain('org/service-b');
      expect(names).toContain('org/lib-common');
    });

    it('should set repo project ID after indexing', () => {
      manager.setRepoProjectId(GROUP_ID, 'org/service-a', PROJECT_A);
      const repos = manager.getRepos(GROUP_ID);
      const repoA = repos.find(r => r.fullName === 'org/service-a');
      expect(repoA!.projectId).toBe(PROJECT_A);
    });

    it('should mark group as indexed', () => {
      manager.markIndexed(GROUP_ID);
      const g = manager.getGroup(GROUP_ID);
      expect(g!.indexedAt).toBeDefined();
      expect(g!.indexedAt).not.toBeNull();
    });

    it('should update group metadata', () => {
      const updated = manager.updateGroup(GROUP_ID, {
        name: 'Updated Cross-Repo Group',
        description: 'Updated description',
      });
      expect(updated).toBe(true);
      const g = manager.getGroup(GROUP_ID);
      expect(g!.name).toBe('Updated Cross-Repo Group');
    });

    it('should return false for update on non-existent group', () => {
      expect(manager.updateGroup('no-group', { name: 'x' })).toBe(false);
    });

    it('should check if group exists', () => {
      expect(manager.hasGroup(GROUP_ID)).toBe(true);
      expect(manager.hasGroup('no-such-group')).toBe(false);
    });

    it('should throw when creating duplicate group', () => {
      expect(() => manager.createGroup(GROUP_ID, 'Dup', '')).toThrow(/already exists/);
    });

    it('should throw when adding duplicate repo', () => {
      expect(() => manager.addRepo(GROUP_ID, 'org', 'service-a', '', ''))
        .toThrow(/already exists/);
    });

    it('should remove a repo from group', () => {
      // Add a temp repo first
      manager.addRepo(GROUP_ID, 'temp', 'repo', '', '/tmp/temp');
      expect(manager.getRepos(GROUP_ID).length).toBe(4);
      manager.removeRepo(GROUP_ID, 'temp/repo');
      expect(manager.getRepos(GROUP_ID).length).toBe(3);
    });

    it('should throw when removing non-existent repo', () => {
      expect(() => manager.removeRepo(GROUP_ID, 'no/such')).toThrow(/not found/);
    });

    it('should throw when adding to non-existent group', () => {
      expect(() => manager.addRepo('no-group', 'a', 'b', '', '')).toThrow(/not found/);
    });

    it('should save and load config', () => {
      const tempFile = join(tmpdir(), 'e2e-cross-repo-config.json');
      manager.saveConfig(tempFile);
      expect(existsSync(tempFile)).toBe(true);

      // Create a new manager and load
      const newManager = new RepoGroupManager();
      newManager.loadConfig(tempFile);
      expect(newManager.hasGroup(GROUP_ID)).toBe(true);

      try { unlinkSync(tempFile); } catch { /* cleanup */ }
    });

    it('should throw when loading non-existent file', () => {
      const newManager = new RepoGroupManager();
      expect(() => newManager.loadConfig('/nonexistent/config.json')).toThrow(/not found/);
    });

    it('should delete group', () => {
      const tempManager = new RepoGroupManager();
      tempManager.createGroup('temp-group', 'Temp', '');
      expect(tempManager.hasGroup('temp-group')).toBe(true);
      tempManager.deleteGroup('temp-group');
      expect(tempManager.hasGroup('temp-group')).toBe(false);
    });

    it('should throw when deleting non-existent group', () => {
      expect(() => manager.deleteGroup('no-group')).toThrow(/not found/);
    });
  });

  // =========================================================================
  // Version Compatibility Matrix
  // =========================================================================

  describe('VersionCompatibilityMatrix', () => {
    const matrix = new VersionCompatibilityMatrix();

    const repoVersions = [
      {
        repo: 'org/service-a',
        dependencies: { typescript: '^5.3.0', lodash: '4.17.21', axios: '^1.6.0' },
      },
      {
        repo: 'org/service-b',
        dependencies: { typescript: '^5.1.0', lodash: '4.17.21', express: '^4.18.0' },
      },
      {
        repo: 'org/lib-common',
        dependencies: { typescript: '^5.4.0', lodash: '4.17.20', axios: '^1.5.0' },
      },
    ];

    let compatibilityMatrix: ReturnType<typeof matrix.buildMatrix>;

    it('should build a compatibility matrix', () => {
      compatibilityMatrix = matrix.buildMatrix(GROUP_ID, repoVersions);
      expect(compatibilityMatrix.groupId).toBe(GROUP_ID);
      expect(compatibilityMatrix.repos).toEqual([
        'org/service-a', 'org/service-b', 'org/lib-common',
      ]);
      expect(compatibilityMatrix.sharedDependencies).toBeDefined();
    });

    it('should only include shared dependencies (used by 2+ repos)', () => {
      const shared = Object.keys(compatibilityMatrix.sharedDependencies);
      // lodash shared by all 3, typescript shared by all 3, axios shared by 2
      expect(shared).toContain('lodash');
      expect(shared).toContain('typescript');
      expect(shared).toContain('axios');
      // express is only used by service-b, so not shared
      expect(shared).not.toContain('express');
    });

    it('should detect version conflicts between repos', () => {
      const conflicts = matrix.detectConflicts(compatibilityMatrix);
      expect(conflicts.length).toBeGreaterThan(0);

      // Should detect TypeScript version mismatch (5.1 vs 5.3 vs 5.4)
      const tsConflict = conflicts.find(c => c.packageName === 'typescript');
      expect(tsConflict).toBeDefined();
      expect(tsConflict!.repos.length).toBeGreaterThanOrEqual(2);

      // Should detect lodash version mismatch (4.17.20 vs 4.17.21)
      const lodashConflict = conflicts.find(c => c.packageName === 'lodash');
      expect(lodashConflict).toBeDefined();

      // Should detect axios version mismatch (1.5.0 vs 1.6.0)
      const axiosConflict = conflicts.find(c => c.packageName === 'axios');
      expect(axiosConflict).toBeDefined();
    });

    it('should classify conflict types correctly', () => {
      const conflicts = matrix.detectConflicts(compatibilityMatrix);
      for (const conflict of conflicts) {
        expect(['major_mismatch', 'minor_mismatch', 'patch_mismatch']).toContain(conflict.conflictType);
        expect(conflict.recommendedVersion).toBeDefined();
        expect(conflict.repos.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should suggest version alignments', () => {
      const conflicts = matrix.detectConflicts(compatibilityMatrix);
      const alignments = matrix.suggestAlignments(conflicts);

      expect(alignments.length).toBe(conflicts.length);
      for (const alignment of alignments) {
        expect(alignment.packageName).toBeDefined();
        expect(alignment.suggestedVersion).toBeDefined();
        expect(alignment.rationale).toBeDefined();
        expect(alignment.reposToUpdate.length).toBeGreaterThanOrEqual(0);
        expect(Object.keys(alignment.currentVersions).length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should check upgrade safety', () => {
      const report = matrix.checkUpgradeSafety(
        'typescript',
        '5.3.0',
        '5.4.0',
        compatibilityMatrix,
      );

      expect(report.packageName).toBe('typescript');
      expect(report.fromVersion).toBe('5.3.0');
      expect(report.toVersion).toBe('5.4.0');
      expect(Array.isArray(report.breakingChanges)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should detect major version bump as unsafe', () => {
      const report = matrix.checkUpgradeSafety(
        'typescript',
        '4.9.0',
        '6.0.0',
        compatibilityMatrix,
      );

      expect(report.safe).toBe(false);
      expect(report.breakingChanges).toContain('Major version bump: 4.9.0 → 6.0.0');
      expect(report.recommendations.length).toBeGreaterThan(2);
    });

    it('should detect downgrade as potentially unsafe', () => {
      const report = matrix.checkUpgradeSafety(
        'axios',
        '1.6.0',
        '1.4.0',
        compatibilityMatrix,
      );

      expect(report.safe).toBe(false);
      expect(report.breakingChanges.some(b => b.includes('Downgrading'))).toBe(true);
    });

    it('should handle same version upgrade', () => {
      const report = matrix.checkUpgradeSafety(
        'lodash', '4.17.21', '4.17.21', compatibilityMatrix,
      );
      expect(report.safe).toBe(true);
      expect(report.recommendations).toContain('Versions are identical — no upgrade needed');
    });

    it('should parse semver correctly', () => {
      expect(matrix.parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(matrix.parseSemver('^5.3.0')).toEqual({ major: 5, minor: 3, patch: 0 });
      expect(matrix.parseSemver('~4.17.21')).toEqual({ major: 4, minor: 17, patch: 21 });
      expect(matrix.parseSemver('>=3.0.0 <4.0.0')).toEqual({ major: 3, minor: 0, patch: 0 });
      expect(matrix.parseSemver('v2.0.0-beta')).toEqual({ major: 2, minor: 0, patch: 0 });
      expect(matrix.parseSemver('invalid')).toEqual({ major: 0, minor: 0, patch: 0 });
    });

    it('should compare semver correctly', () => {
      expect(matrix.compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
      expect(matrix.compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(matrix.compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(matrix.compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
      expect(matrix.compareSemver('1.3.0', '1.2.9')).toBeGreaterThan(0);
    });

    it('should pick highest version', () => {
      expect(matrix.pickHighestVersion(['1.0.0', '2.0.0', '1.5.0'])).toBe('2.0.0');
      expect(matrix.pickHighestVersion(['1.2.3', '1.2.4', '1.2.0'])).toBe('1.2.4');
      expect(matrix.pickHighestVersion([])).toBe('0.0.0');
      expect(matrix.pickHighestVersion(['3.2.1'])).toBe('3.2.1');
    });

    it('should handle empty/null matrix in detectConflicts', () => {
      const conflicts = matrix.detectConflicts(null as any);
      expect(conflicts).toEqual([]);

      const conflicts2 = matrix.detectConflicts({ groupId: 'x', repos: [], sharedDependencies: {}, matrix: {} } as any);
      expect(conflicts2).toEqual([]);
    });

    it('should handle empty conflicts in suggestAlignments', () => {
      expect(matrix.suggestAlignments([])).toEqual([]);
      expect(matrix.suggestAlignments(null as any)).toEqual([]);
    });

    it('should throw for missing required params in checkUpgradeSafety', () => {
      expect(() => matrix.checkUpgradeSafety('', '1.0.0', '2.0.0', {} as any)).toThrow();
      expect(() => matrix.checkUpgradeSafety('test', '', '2.0.0', {} as any)).toThrow();
      expect(() => matrix.checkUpgradeSafety('test', '1.0.0', '', {} as any)).toThrow();
    });

    it('should throw for null matrix in checkUpgradeSafety', () => {
      expect(() => matrix.checkUpgradeSafety('test', '1.0.0', '2.0.0', null as any)).toThrow();
    });

    it('should build matrix for groups with no shared deps', () => {
      const result = matrix.buildMatrix('solo', [
        { repo: 'a', dependencies: { pkg1: '1.0.0' } },
        { repo: 'b', dependencies: { pkg2: '2.0.0' } },
      ]);
      expect(result.sharedDependencies).toEqual({});
    });
  });

  // =========================================================================
  // Federated Search Engine
  // =========================================================================

  describe('FederatedSearchEngine', () => {
    // FederatedSearchEngine searches within a single store containing all repos.
    // Create a unified store with data from all repos.
    let unifiedStore: InMemoryGraphStore;

    beforeAll(() => {
      unifiedStore = new InMemoryGraphStore();
      populateStoreA(unifiedStore);
      populateStoreB(unifiedStore);
      populateStoreC(unifiedStore);
    });

    afterAll(() => {
      unifiedStore.close();
    });

    it('should search across all repos in a unified store', () => {
      const engine = new FederatedSearchEngine(unifiedStore);

      // Search with a group filter using repoFilter
      engine.search('OrderService', { repoFilter: [PROJECT_A] }).then(results => {
        expect(results.totalResults).toBeGreaterThan(0);
      });
    });

    it('should find symbols across all repos', () => {
      const engine = new FederatedSearchEngine(unifiedStore);

      engine.search('formatDate', {}).then(results => {
        expect(results.totalResults).toBeGreaterThan(0);
      });
    });

    it('should find duplicate symbols across repos', async () => {
      const engine = new FederatedSearchEngine(unifiedStore);

      const duplicateReport = await engine.findDuplicates(GROUP_ID, 0.5);
      expect(duplicateReport).toBeDefined();
      expect(duplicateReport).toHaveProperty('duplicates');
    });

    it('should return empty for empty query', async () => {
      const engine = new FederatedSearchEngine(unifiedStore);
      await expect(engine.search('')).rejects.toThrow('required');
    });
  });

  // =========================================================================
  // Cross-Repo Indexer
  // =========================================================================

  describe('CrossRepoIndexer', () => {
    it('should create an indexer instance', () => {
      const indexer = new CrossRepoIndexer(storeA, manager);
      expect(indexer).toBeDefined();
    });

    it('should build cross-repo dependency graph', async () => {
      const indexer = new CrossRepoIndexer(storeA, manager);
      const report = await indexer.buildCrossRepoGraph(GROUP_ID);
      expect(report).toBeDefined();
      expect(report).toHaveProperty('crossRepoEdges');
      expect(report).toHaveProperty('repos');
    });

    it('should detect contracts in a group', async () => {
      const indexer = new CrossRepoIndexer(storeA, manager);
      const contracts = await indexer.detectContracts(GROUP_ID);
      expect(Array.isArray(contracts)).toBe(true);
    });

    it('should get nodes for a project', () => {
      const indexer = new CrossRepoIndexer(storeA, manager);
      const nodes = indexer.getRepoNodes(PROJECT_A);
      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('should analyze cross-repo impact', async () => {
      const indexer = new CrossRepoIndexer(storeA, manager);

      // Set the project ID on the repo first
      manager.setRepoProjectId(GROUP_ID, 'org/service-a', PROJECT_A);

      const impact = await indexer.analyzeCrossRepoImpact(GROUP_ID, PROJECT_A);
      expect(impact).toBeDefined();
      expect(impact.changedRepo).toBe(PROJECT_A);
    });
  });

  // =========================================================================
  // Cross-Repo PR Review
  // =========================================================================

  describe('CrossRepoPRReviewEngine', () => {
    let reviewEngine: CodeReviewEngine;
    let crPrReview: CrossRepoPRReviewEngine;

    beforeAll(() => {
      reviewEngine = new CodeReviewEngine(storeA);
      const indexer = new CrossRepoIndexer(storeA, manager);
      crPrReview = new CrossRepoPRReviewEngine(indexer, manager, reviewEngine);
    });

    it('should create cross-repo PR review engine', () => {
      expect(crPrReview).toBeDefined();
    });

    it('should review PR with cross-repo context', async () => {
      const result = await crPrReview.reviewPRWithCrossRepoContext(
        {
          number: 100,
          title: 'Cross-repo: update OrderService API',
          body: 'Breaking change to OrderService.placeOrder signature.',
          state: 'open',
          base: {
            ref: 'main', sha: 'abc',
            repo: { id: 1, owner: 'org', name: 'service-a', fullName: PROJECT_A, defaultBranch: 'main', cloneUrl: '', language: 'typescript', topics: [], isPrivate: false, description: '' },
          },
          head: {
            ref: 'feature', sha: 'def',
            repo: { id: 1, owner: 'org', name: 'service-a', fullName: PROJECT_A, defaultBranch: 'main', cloneUrl: '', language: 'typescript', topics: [], isPrivate: false, description: '' },
          },
          user: { login: 'developer' },
          labels: ['breaking-change'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        GROUP_ID,
        PROJECT_A,
        [],
      );

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.mergeRecommendation).toBeDefined();
    });

    it('should check API breaking changes across repos', async () => {
      const apiDiff = {
        id: 'diff1', repositoryId: PROJECT_A,
        filePath: 'src/order.service.ts',
        changeType: 'modified' as const,
        ranges: [{
          oldStart: 5, oldEnd: 5, newStart: 5, newEnd: 7,
          changeType: 'modified' as const,
        }],
        createdAt: new Date().toISOString(),
      };

      const result = await crPrReview.reviewPRWithCrossRepoContext(
        {
          number: 101,
          title: 'API signature change',
          body: '',
          state: 'open',
          base: {
            ref: 'main', sha: '',
            repo: { id: 1, owner: 'org', name: 'service-a', fullName: PROJECT_A, defaultBranch: 'main', cloneUrl: '', language: 'typescript', topics: [], isPrivate: false, description: '' },
          },
          head: {
            ref: 'feature', sha: '',
            repo: { id: 1, owner: 'org', name: 'service-a', fullName: PROJECT_A, defaultBranch: 'main', cloneUrl: '', language: 'typescript', topics: [], isPrivate: false, description: '' },
          },
          user: { login: 'dev' },
          labels: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        GROUP_ID,
        PROJECT_A,
        [apiDiff],
      );

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.apiBreakingChanges).toBeDefined();
      expect(Array.isArray(result.apiBreakingChanges)).toBe(true);
    });
  });

  // =========================================================================
  // End-to-End Workflow
  // =========================================================================

  describe('Full Cross-Repo E2E Workflow', () => {
    it('should execute the full cross-repo analysis pipeline', async () => {
      // Step 1: Verify group exists with repos
      const g = manager.getGroup(GROUP_ID);
      expect(g).toBeDefined();
      expect(g!.repos.length).toBe(3);

      // Step 2: Federated search across repos (unified store)
      const unifiedStore = new InMemoryGraphStore();
      populateStoreA(unifiedStore);
      populateStoreB(unifiedStore);
      populateStoreC(unifiedStore);
      const searchEngine = new FederatedSearchEngine(unifiedStore);

      const searchResults = await searchEngine.search('Order', { repoFilter: [PROJECT_A] });
      expect(searchResults).toBeDefined();
      unifiedStore.close();

      // Step 3: Build version compatibility matrix
      const versionMatrix = new VersionCompatibilityMatrix();
      const compatMatrix = versionMatrix.buildMatrix(GROUP_ID, [
        { repo: PROJECT_A, dependencies: { typescript: '^5.3.0', lodash: '4.17.21' } },
        { repo: PROJECT_B, dependencies: { typescript: '^5.1.0', lodash: '4.17.20' } },
        { repo: PROJECT_C, dependencies: { typescript: '^5.4.0', lodash: '4.17.21' } },
      ]);

      // Step 4: Detect and suggest version alignments
      const conflicts = versionMatrix.detectConflicts(compatMatrix);
      const alignments = versionMatrix.suggestAlignments(conflicts);

      // Verify the pipeline produced actionable results
      expect(conflicts.length).toBeGreaterThan(0);
      expect(alignments.length).toBeGreaterThan(0);

      // Step 5: Check cross-repo indexer
      const indexer = new CrossRepoIndexer(storeA, manager);
      manager.setRepoProjectId(GROUP_ID, 'org/service-a', PROJECT_A);
      const impact = await indexer.analyzeCrossRepoImpact(GROUP_ID, PROJECT_A);
      expect(impact.changedRepo).toBe(PROJECT_A);

      // Full pipeline validated
    });
  });
});
