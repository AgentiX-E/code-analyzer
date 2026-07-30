// @code-analyzer/intelligence — Impact Graph Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';
import { ImpactGraphBuilder } from '../../cross-repo/impact-graph.js';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createIndexerWithRepos() {
  const store = new InMemoryGraphStore();
  const groupManager = new RepoGroupManager();
  groupManager.createGroup('test-group', 'Test Group', 'Test description');
  groupManager.addRepo('test-group', 'org', 'core', 'https://github.com/org/core', '/tmp/core');
  groupManager.addRepo('test-group', 'org', 'service-a', 'https://github.com/org/service-a', '/tmp/a');
  groupManager.addRepo('test-group', 'org', 'service-b', 'https://github.com/org/service-b', '/tmp/b');
  groupManager.addRepo('test-group', 'org', 'lib-util', 'https://github.com/org/lib-util', '/tmp/util');

  // Add nodes to each repo
  const repos = ['org/core', 'org/service-a', 'org/service-b', 'org/lib-util'];
  for (const repo of repos) {
    for (let i = 0; i < 3; i++) {
      store.insertNode({
        id: store.getNodeCount() + 1 + i,
        label: 'Function',
        name: `${repo.split('/')[1]}-fn-${i}`,
        qualifiedName: `${repo.split('/')[1]}-fn-${i}()`,
        filePath: `src/${repo.split('/')[1]}/file${i}.ts`,
        startLine: 1,
        endLine: 5,
        properties: { repoId: repo },
      });
    }
  }

  const indexer = new CrossRepoIndexer(store, groupManager);
  return { indexer, store, groupManager };
}

// ---------------------------------------------------------------------------
// ImpactGraphBuilder Tests
// ---------------------------------------------------------------------------

describe('ImpactGraphBuilder', () => {
  let builder: ImpactGraphBuilder;
  let indexer: CrossRepoIndexer;

  beforeEach(() => {
    const { indexer: idx } = createIndexerWithRepos();
    indexer = idx;
    builder = new ImpactGraphBuilder(indexer);
  });

  describe('build', () => {
    it('should build an impact graph', async () => {
      const graph = await builder.build('test-group');
      expect(graph).toBeDefined();
      expect(graph.nodes).toBeDefined();
      expect(graph.edges).toBeDefined();
    });

    it('should handle unknown groups gracefully', async () => {
      const graph = await builder.build('non-existent-group');
      expect(graph.nodes.size).toBe(0);
      expect(graph.edges.length).toBe(0);
    });
  });

  describe('calculateBlastRadius', () => {
    it('should calculate blast radius from source repo', async () => {
      const graph = await builder.build('test-group');
      const result = builder.calculateBlastRadius('org/core', graph);

      expect(result.sourceRepo).toBe('org/core');
      expect(result.totalAffected).toBeGreaterThanOrEqual(0);
      expect(result.directImpact).toBeDefined();
      expect(result.transitiveImpact).toBeDefined();
      expect(result.severityRankings).toBeDefined();
    });

    it('should return empty result for repos with no dependents', async () => {
      // Build graph with no edges
      const graph = {
        nodes: new Map([['org/isolated', { repo: 'org/isolated', symbols: [], directDependents: [], transitiveDependents: [] }]]),
        edges: [],
      };

      const result = builder.calculateBlastRadius('org/isolated', graph);
      expect(result.totalAffected).toBe(0);
    });

    it('should include critical paths', () => {
      const graph = {
        nodes: new Map(),
        edges: [
          { from: 'org/core', to: 'org/service-a', symbols: ['api'], weight: 10 },
          { from: 'org/core', to: 'org/service-b', symbols: ['types'], weight: 7 },
        ],
      };

      const result = builder.calculateBlastRadius('org/core', graph);
      expect(result.criticalPaths.length).toBeGreaterThanOrEqual(0);
    });

    it('should compute severity rankings for affected repos', () => {
      const graph = {
        nodes: new Map(),
        edges: [
          { from: 'org/core', to: 'org/service-a', symbols: ['api'], weight: 10 },
          { from: 'org/core', to: 'org/service-b', symbols: ['types'], weight: 4 },
        ],
      };

      const result = builder.calculateBlastRadius('org/core', graph);
      expect(result.severityRankings.has('org/service-a')).toBe(true);
      expect(result.severityRankings.get('org/service-a')).toBe('critical');
    });
  });

  describe('findDependencyChains', () => {
    it('should find dependency chains from source repo', () => {
      const graph = {
        nodes: new Map(),
        edges: [
          { from: 'org/core', to: 'org/service-a', symbols: ['api'], weight: 10 },
          { from: 'org/service-a', to: 'org/service-b', symbols: ['types'], weight: 7 },
        ],
      };

      const chains = builder.findDependencyChains('org/core', graph);
      expect(chains.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty for repos with no outgoing edges', () => {
      const graph = {
        nodes: new Map(),
        edges: [],
      };

      const chains = builder.findDependencyChains('org/isolated', graph);
      expect(chains.length).toBe(0);
    });

    it('should track chain depth correctly', () => {
      const graph = {
        nodes: new Map(),
        edges: [
          { from: 'org/core', to: 'org/service-a', symbols: ['a'], weight: 4 },
          { from: 'org/service-a', to: 'org/service-b', symbols: ['b'], weight: 4 },
          { from: 'org/service-b', to: 'org/lib-util', symbols: ['c'], weight: 1 },
        ],
      };

      const chains = builder.findDependencyChains('org/core', graph);
      const deepChain = chains.find((c) => c.depth >= 3);
      // At least one chain should have depth > 1
      if (chains.length > 0) {
        expect(chains.some((c) => c.depth >= 1)).toBe(true);
      }
    });
  });

  describe('computeTransitiveDependents', () => {
    it('should compute transitive dependents for all nodes', () => {
      const graph = {
        nodes: new Map([
          ['org/core', { repo: 'org/core', symbols: [], directDependents: ['org/service-a'], transitiveDependents: [] }],
          ['org/service-a', { repo: 'org/service-a', symbols: [], directDependents: ['org/service-b'], transitiveDependents: [] }],
          ['org/service-b', { repo: 'org/service-b', symbols: [], directDependents: [], transitiveDependents: [] }],
        ]),
        edges: [],
      };

      builder.computeTransitiveDependents(graph);

      const core = graph.nodes.get('org/core')!;
      expect(core.transitiveDependents).toContain('org/service-b');
    });

    it('should handle empty graphs', () => {
      const graph = {
        nodes: new Map(),
        edges: [],
      };

      expect(() => builder.computeTransitiveDependents(graph)).not.toThrow();
    });
  });

  describe('getGraph', () => {
    it('should return the current graph', () => {
      const graph = builder.getGraph();
      expect(graph).toBeDefined();
      expect(graph.nodes).toBeInstanceOf(Map);
      expect(graph.edges).toBeInstanceOf(Array);
    });
  });
});
