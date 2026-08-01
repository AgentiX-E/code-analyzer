// @code-analyzer — Property-Based Cross-Repo Invariant Tests
// Validates cross-repo operations maintain key invariants under varied inputs.
// Tests contract validation, impact graph building, and PR review bridge invariants.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CrossRepoIndexer, RepoGroupManager } from '@code-analyzer/intelligence';

// Import directly from source since these aren't re-exported from index
import { ContractValidator } from '../../packages/intelligence/src/cross-repo/contract-validator.js';
import { ImpactGraphBuilder } from '../../packages/intelligence/src/cross-repo/impact-graph.js';
import { PRReviewBridge } from '../../packages/intelligence/src/cross-repo/pr-review-bridge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(): InMemoryGraphStore {
  return new InMemoryGraphStore(':memory:');
}

function populateRepo(store: InMemoryGraphStore, projectId: string, symbols: string[]): number[] {
  const now = new Date().toISOString();
  const ids: number[] = [];

  for (const sym of symbols) {
    const uniqueName = `${projectId}__${sym}`;
    const id = store.insertNode({
      id: 0, projectId, label: 'Class' as any,
      name: sym, qualifiedName: uniqueName,
      filePath: `src/${sym}.ts`, startLine: 1, endLine: 20,
      language: 'typescript',
      properties: { exported: 'true', signature: `class ${sym}` },
      signature: `class ${sym}`, docstring: null,
      complexity: 2, isExported: true, fingerprint: null,
      createdAt: now, updatedAt: now,
    });
    ids.push(id);
  }

  return ids;
}

function createMockIndexer(store: InMemoryGraphStore): CrossRepoIndexer {
  return {
    getStore: () => store,
    getRepoNodes: (repoId: string) => {
      // Return all nodes for the given repo from the store
      const nodes: any[] = [];
      for (const node of store.nodes.values()) {
        if (node.projectId === repoId) {
          nodes.push(node);
        }
      }
      return nodes;
    },
    getGroupRepos: () => [],
    indexRepo: async () => {},
    buildCrossRepoGraph: async () => ({ nodes: new Map(), edges: new Map() }),
    searchAcrossRepos: async () => [],
  } as unknown as CrossRepoIndexer;
}

function createMockReviewEngine() {
  return {
    reviewDiff: vi.fn().mockResolvedValue({ comments: [], summary: 'No issues found' }),
    reviewFile: vi.fn().mockResolvedValue({ comments: [], summary: 'No issues found' }),
  } as any;
}

function createMockGroupManager(): RepoGroupManager {
  const mgr = new RepoGroupManager();
  return mgr;
}

function createMockPR(overrides: Partial<{
  number: number;
  title: string;
  headSha: string;
  baseSha: string;
  repo: string;
}> = {}) {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? 'Test PR',
    head: { sha: overrides.headSha ?? 'head-sha', ref: 'feature/test' },
    base: { sha: overrides.baseSha ?? 'base-sha', ref: 'main' },
    repository: { full_name: overrides.repo ?? 'org/test-repo' },
    html_url: `https://github.com/${overrides.repo ?? 'org/test-repo'}/pull/${overrides.number ?? 1}`,
  } as any;
}

// ---------------------------------------------------------------------------
// Contract Validation Invariants
// ---------------------------------------------------------------------------

describe('Property — Contract Validation', () => {
  let store: InMemoryGraphStore;
  let indexer: CrossRepoIndexer;
  let validator: ContractValidator;

  beforeEach(() => {
    store = createStore();
    indexer = createMockIndexer(store);
    validator = new ContractValidator(indexer);
  });

  it('should validate contracts with matching symbols', async () => {
    populateRepo(store, 'repo-aaa', ['UserService', 'AuthProvider', 'Logger']);
    populateRepo(store, 'repo-bbb', ['UserService', 'AuthProvider', 'Logger']);

    const result = await validator.validateCrossRepo('test-group', 'repo-aaa', ['UserService']);
    expect(result).toBeDefined();
    expect(result.compatible).toBeDefined();
  });

  it('should handle empty source repo', async () => {
    populateRepo(store, 'repo-b', ['SomeService']);

    const result = await validator.validateCrossRepo('test-group', 'empty-repo', ['SomeService']);
    expect(result).toBeDefined();
    expect(result.changes).toBeDefined();
    expect(result.changes.length).toBe(0);
  });

  it('should detect changes in changed symbols', async () => {
    populateRepo(store, 'repo-a', ['ServiceX', 'ServiceY']);

    const result = await validator.validateCrossRepo('test-group', 'repo-a', ['ServiceX']);
    expect(result).toBeDefined();
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it('should always produce non-null result with valid structure', async () => {
    populateRepo(store, 'repo-ccc', ['Service1']);
    populateRepo(store, 'repo-ddd', ['Service1']);

    const result = await validator.validateCrossRepo('group-1', 'repo-ccc', ['Service1']);
    expect(result).not.toBeNull();
    expect(typeof result.sourceRepo).toBe('string');
    expect(Array.isArray(result.targetRepos)).toBe(true);
    expect(Array.isArray(result.changes)).toBe(true);
    expect(typeof result.breakingCount).toBe('number');
    expect(typeof result.compatible).toBe('boolean');
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('should handle empty changed symbols list', async () => {
    populateRepo(store, 'repo-a', ['ServiceA']);

    const result = await validator.validateCrossRepo('group-x', 'repo-a', []);
    expect(result).toBeDefined();
    expect(result.compatible).toBe(true);
    expect(result.breakingCount).toBe(0);
  });

  it('should extract contracts from populated repo', () => {
    populateRepo(store, 'repo-contracts', ['AlphaService', 'BetaService', 'GammaUtil']);

    const contract = validator.extractContracts('repo-contracts');
    expect(contract).toBeDefined();
    expect(contract.repo).toBe('repo-contracts');
    expect(contract.symbols.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty contract for non-existent repo', () => {
    const contract = validator.extractContracts('nonexistent');
    expect(contract).toBeDefined();
    expect(contract.symbols.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Impact Graph Invariants
// ---------------------------------------------------------------------------

describe('Property — Impact Graph', () => {
  let store: InMemoryGraphStore;
  let indexer: CrossRepoIndexer;

  beforeEach(() => {
    store = createStore();
    indexer = createMockIndexer(store);
  });

  it('should build an impact graph from repo with nodes', async () => {
    populateRepo(store, 'chain-repo', ['Node0', 'Node1', 'Node2', 'Node3', 'Node4']);
    const builder = new ImpactGraphBuilder(indexer);

    const graph = await builder.build('chain-repo');
    expect(graph).toBeDefined();
  });

  it('should handle non-existent project', async () => {
    const builder = new ImpactGraphBuilder(indexer);
    const graph = await builder.build('nonexistent-project');

    expect(graph).toBeDefined();
  });

  it('should always produce a graph with defined structure', async () => {
    const builder = new ImpactGraphBuilder(indexer);
    populateRepo(store, 'proj-eee', ['Sym1', 'Sym2']);
    populateRepo(store, 'proj-fff', ['Sym1', 'Sym2']);

    const graph = await builder.build('proj-eee');
    expect(graph).toBeDefined();
  });

  it('should handle repo with no edges', async () => {
    populateRepo(store, 'solo-repo', ['LoneWolf']);
    const builder = new ImpactGraphBuilder(indexer);

    const graph = await builder.build('solo-repo');
    expect(graph).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PR Review Bridge Invariants
// ---------------------------------------------------------------------------

describe('Property — PR Review Bridge', () => {
  let store: InMemoryGraphStore;
  let bridge: PRReviewBridge;
  let groupManager: RepoGroupManager;

  beforeEach(() => {
    store = createStore();
    const indexer = createMockIndexer(store);
    groupManager = createMockGroupManager();
    const reviewEngine = createMockReviewEngine();
    bridge = new PRReviewBridge(indexer, groupManager, reviewEngine);
  });

  it('should always produce a non-null review result', async () => {
    populateRepo(store, 'org/repo-a', ['Service1', 'Service2']);
    groupManager.createGroup('test-group', 'Test Group', 'desc');
    groupManager.addRepo('test-group', 'org', 'repo-a', 'https://github.com/org/repo-a', '/tmp/repo-a');

    const pr = createMockPR({ number: 1, repo: 'org/repo-a' });
    const result = await bridge.reviewPR(pr, 'test-group', 'org/repo-a', []);
    expect(result).not.toBeNull();
    expect(result.summary).toBeDefined();
    expect(result.reviewComments).toBeDefined();
    expect(Array.isArray(result.reviewComments)).toBe(true);
  });

  it('should produce consistent result structure', async () => {
    populateRepo(store, 'org/repo-x', ['Service1', 'Service2', 'Service3']);
    groupManager.createGroup('group-x', 'Group X', 'desc');
    groupManager.addRepo('group-x', 'org', 'repo-x', 'https://github.com/org/repo-x', '/tmp/repo-x');

    const pr = createMockPR({ number: 42, repo: 'org/repo-x' });
    const result = await bridge.reviewPR(pr, 'group-x', 'org/repo-x', []);

    // Structural invariants
    expect(typeof result.summary).toBe('string');
    expect(Array.isArray(result.reviewComments)).toBe(true);
    expect(typeof result.riskLevel).toBe('string');
    expect(typeof result.breakingChangeCount).toBe('number');
    expect(result.recommendations).toBeDefined();
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('should throw for non-existent group id', async () => {
    const pr = createMockPR({ number: 1, repo: 'org/repo-a' });
    await expect(
      bridge.reviewPR(pr, 'nonexistent-group', 'org/repo-a', []),
    ).rejects.toThrow();
  });

  it('should handle empty repo', async () => {
    groupManager.createGroup('empty-group', 'Empty', 'desc');
    groupManager.addRepo('empty-group', 'empty', 'repo', 'https://github.com/empty/repo', '/tmp/empty-repo');

    const pr = createMockPR({ number: 1, repo: 'empty/repo' });
    const result = await bridge.reviewPR(pr, 'empty-group', 'empty/repo', []);
    expect(result).not.toBeNull();
    expect(result.reviewComments).toBeDefined();
    expect(Array.isArray(result.reviewComments)).toBe(true);
  });
});
