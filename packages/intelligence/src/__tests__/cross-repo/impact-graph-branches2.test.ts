// @code-analyzer/intelligence — Impact graph branch coverage (round 2):
// duplicate-analysis dedup, `graph ?? this.graph` fallbacks, duplicate direct
// edges, off-path inbound edges in dependency chains, cycle-back guards, and
// non-source critical edges.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { EDGE_CROSS_REPO_DEPENDS } from '@code-analyzer/shared';
import type { GraphNode } from '@code-analyzer/shared';
import { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';
import { ImpactGraphBuilder } from '../../cross-repo/impact-graph.js';
import type { ImpactGraph } from '../../cross-repo/impact-graph.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(projectId: string, name: string): GraphNode {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId,
    label: 'Function',
    name,
    qualifiedName: `project:${projectId}:${name}`,
    filePath: `${name}.ts`,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: { name, isExported: true },
    signature: null,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Builds an ImpactGraphBuilder whose `this.graph` is populated by a real
 *  `build()` call, producing a single core -> svc dependency edge. */
async function makeBuilderWithBuiltGraph(): Promise<ImpactGraphBuilder> {
  const store = new InMemoryGraphStore();
  const groupManager = new RepoGroupManager();
  groupManager.createGroup('g', 'G', '');
  groupManager.addRepo('g', 'org', 'core', 'https://github.com/org/core', '/tmp/core');
  groupManager.addRepo('g', 'org', 'svc', 'https://github.com/org/svc', '/tmp/svc');

  const coreFnId = store.insertNode(makeNode('org/core', 'coreFn'));
  const svcFnId = store.insertNode(makeNode('org/svc', 'svcFn'));
  store.insertEdge({
    id: 0,
    projectId: 'org/core',
    sourceId: coreFnId,
    targetId: svcFnId,
    type: EDGE_CROSS_REPO_DEPENDS,
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  });

  const indexer = new CrossRepoIndexer(store, groupManager);
  const builder = new ImpactGraphBuilder(indexer);
  await builder.build('g', 'org/core');
  return builder;
}

// ---------------------------------------------------------------------------
// build — duplicate analysis entries
// ---------------------------------------------------------------------------

describe('ImpactGraphBuilder.build — duplicate analysis dedup', () => {
  it('does not add the same dependent repo twice (L97 false path)', async () => {
    // The indexer returns two analysis entries for the same repo. The second
    // entry must not duplicate the source node's directDependents entry.
    const duplicateIndexer = {
      async analyzeCrossRepoImpact() {
        return {
          changedRepo: 'org/core',
          affectedRepos: ['org/svc'],
          analysis: [
            { repo: 'org/svc', affectedSymbols: ['api'], impactLevel: 'high', reason: 'direct' },
            {
              repo: 'org/svc',
              affectedSymbols: ['types'],
              impactLevel: 'low',
              reason: 'duplicate',
            },
          ],
        };
      },
      getRepoNodes(repo: string) {
        return [{ name: `${repo.split('/')[1]}-fn` }];
      },
    } as unknown as CrossRepoIndexer;

    const builder = new ImpactGraphBuilder(duplicateIndexer);
    const graph = await builder.build('g', 'org/core');

    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.get('org/core')!.directDependents).toEqual(['org/svc']);
  });
});

// ---------------------------------------------------------------------------
// graph ?? this.graph fallback paths
// ---------------------------------------------------------------------------

describe('ImpactGraphBuilder — graph ?? this.graph fallback', () => {
  it('calculateBlastRadius falls back to this.graph when no graph is passed (L113)', async () => {
    const builder = await makeBuilderWithBuiltGraph();
    const result = builder.calculateBlastRadius('org/core');
    expect(result.directImpact).toEqual(['org/svc']);
    expect(result.totalAffected).toBe(1);
  });

  it('findDependencyChains falls back to this.graph when no graph is passed (L181)', async () => {
    const builder = await makeBuilderWithBuiltGraph();
    const chains = builder.findDependencyChains('org/core');
    expect(chains).toHaveLength(1);
    expect(chains[0]!.repos).toEqual(['org/core', 'org/svc']);
  });

  it('computeTransitiveDependents falls back to this.graph when no graph is passed (L218)', async () => {
    const builder = await makeBuilderWithBuiltGraph();
    builder.computeTransitiveDependents();
    expect(builder.getGraph().nodes.get('org/core')!.transitiveDependents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calculateBlastRadius — duplicate direct edges
// ---------------------------------------------------------------------------

describe('ImpactGraphBuilder.calculateBlastRadius — duplicate direct edges', () => {
  it('skips an already-visited direct dependent (L127 false path)', () => {
    const builder = new ImpactGraphBuilder({} as unknown as CrossRepoIndexer);
    const graph: ImpactGraph = {
      nodes: new Map(),
      edges: [
        { from: 'org/core', to: 'org/a', symbols: ['x'], weight: 4 },
        { from: 'org/core', to: 'org/a', symbols: ['y'], weight: 1 },
      ],
    };
    const result = builder.calculateBlastRadius('org/core', graph);
    expect(result.directImpact).toEqual(['org/a']);
    expect(result.totalAffected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findDependencyChains — off-path inbound edge in leaf weight computation
// ---------------------------------------------------------------------------

describe('ImpactGraphBuilder.findDependencyChains — off-path inbound edges', () => {
  it('evaluates the second operand of the leaf edge filter (L190 false path)', () => {
    const builder = new ImpactGraphBuilder({} as unknown as CrossRepoIndexer);
    const graph: ImpactGraph = {
      nodes: new Map(),
      edges: [
        { from: 'org/core', to: 'org/svc', symbols: ['a'], weight: 10 },
        // This edge's `from` is not on the chain path, so the `||` must
        // evaluate its second operand (`path.includes(e.to)`).
        { from: 'org/other', to: 'org/svc', symbols: ['x'], weight: 7 },
      ],
    };
    const chains = builder.findDependencyChains('org/core', graph);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.criticality).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// computeTransitiveDependents — cycle-back guard
// ---------------------------------------------------------------------------

describe('ImpactGraphBuilder.computeTransitiveDependents — cycle-back guard', () => {
  it('does not list a repo as its own transitive dependent (L233 false path)', () => {
    const builder = new ImpactGraphBuilder({} as unknown as CrossRepoIndexer);
    const graph: ImpactGraph = {
      nodes: new Map([
        [
          'org/core',
          { repo: 'org/core', symbols: [], directDependents: ['org/a'], transitiveDependents: [] },
        ],
        [
          'org/a',
          { repo: 'org/a', symbols: [], directDependents: ['org/core'], transitiveDependents: [] },
        ],
      ]),
      edges: [],
    };

    builder.computeTransitiveDependents(graph);
    expect(graph.nodes.get('org/core')!.transitiveDependents).toEqual([]);
    expect(graph.nodes.get('org/a')!.transitiveDependents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findCriticalPaths — non-source critical edges
// ---------------------------------------------------------------------------

describe('ImpactGraphBuilder.calculateBlastRadius — non-source critical edges', () => {
  it('ignores critical edges that do not start at the source repo (L284 false path)', () => {
    const builder = new ImpactGraphBuilder({} as unknown as CrossRepoIndexer);
    const graph: ImpactGraph = {
      nodes: new Map(),
      edges: [
        { from: 'org/core', to: 'org/a', symbols: ['api'], weight: 10 },
        { from: 'org/a', to: 'org/b', symbols: ['types'], weight: 7 },
      ],
    };
    const result = builder.calculateBlastRadius('org/core', graph);
    expect(result.criticalPaths).toEqual([['org/core', 'org/a']]);
  });
});
