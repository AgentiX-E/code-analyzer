// @ts-nocheck
// @code-analyzer/intelligence — Impact graph branch coverage (private weight
// mapping, transitive BFS, cycle guards, and empty-node tolerance).

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';
import { ImpactGraphBuilder } from '../../cross-repo/impact-graph.js';

function makeBuilder() {
  const store = new InMemoryGraphStore();
  const gm = new RepoGroupManager();
  return new ImpactGraphBuilder(new CrossRepoIndexer(store, gm));
}

describe('ImpactGraphBuilder — impactLevelToWeight / weightToSeverity', () => {
  const builder = makeBuilder();

  it('maps every impact level to a weight', () => {
    expect((builder as any).impactLevelToWeight('critical')).toBe(10);
    expect((builder as any).impactLevelToWeight('high')).toBe(7);
    expect((builder as any).impactLevelToWeight('medium')).toBe(4);
    expect((builder as any).impactLevelToWeight('low')).toBe(1);
    expect((builder as any).impactLevelToWeight('unknown')).toBe(1);
  });

  it('maps weights to severities across all thresholds', () => {
    expect((builder as any).weightToSeverity(10)).toBe('critical');
    expect((builder as any).weightToSeverity(7)).toBe('high');
    expect((builder as any).weightToSeverity(4)).toBe('medium');
    expect((builder as any).weightToSeverity(1)).toBe('low');
  });
});

describe('ImpactGraphBuilder — calculateBlastRadius transitive depth', () => {
  const builder = makeBuilder();

  it('separates direct from transitive impact', () => {
    const graph = {
      nodes: new Map(),
      edges: [
        { from: 'org/core', to: 'org/service-a', symbols: ['a'], weight: 10 },
        { from: 'org/service-a', to: 'org/service-b', symbols: ['b'], weight: 4 },
      ],
    };
    const result = builder.calculateBlastRadius('org/core', graph);
    expect(result.directImpact).toEqual(['org/service-a']);
    expect(result.transitiveImpact).toEqual(['org/service-b']);
    expect(result.totalAffected).toBe(2);
  });

  it('does not revisit an already-visited dependent (cycle guard)', () => {
    const graph = {
      nodes: new Map(),
      edges: [
        { from: 'org/core', to: 'org/service-a', symbols: ['a'], weight: 4 },
        { from: 'org/service-a', to: 'org/service-b', symbols: ['b'], weight: 4 },
        { from: 'org/service-b', to: 'org/core', symbols: ['c'], weight: 4 },
      ],
    };
    const result = builder.calculateBlastRadius('org/core', graph);
    expect(result.totalAffected).toBe(2); // service-a + service-b, no re-visit of core
  });
});

describe('ImpactGraphBuilder — findDependencyChains cycle guard', () => {
  const builder = makeBuilder();

  it('does not traverse a node already on the current path', () => {
    const graph = {
      nodes: new Map(),
      edges: [
        { from: 'org/core', to: 'org/service-a', symbols: ['a'], weight: 4 },
        { from: 'org/service-a', to: 'org/core', symbols: ['back'], weight: 4 },
      ],
    };
    // The back edge forms a 2-cycle; the cycle guard stops the walk, so no
    // leaf chain is ever recorded.
    const chains = builder.findDependencyChains('org/core', graph);
    expect(chains.length).toBe(0);
  });
});

describe('ImpactGraphBuilder — computeTransitiveDependents dedup', () => {
  const builder = makeBuilder();

  it('deduplicates transitive dependents and skips missing nodes', () => {
    const graph = {
      nodes: new Map([
        [
          'org/core',
          {
            repo: 'org/core',
            symbols: [],
            directDependents: ['org/service-a', 'org/service-b'],
            transitiveDependents: [],
          },
        ],
        [
          'org/service-a',
          {
            repo: 'org/service-a',
            symbols: [],
            directDependents: ['org/service-c'],
            transitiveDependents: [],
          },
        ],
        [
          'org/service-b',
          {
            repo: 'org/service-b',
            symbols: [],
            directDependents: ['org/service-c'],
            transitiveDependents: [],
          },
        ],
      ]),
      edges: [],
    };
    builder.computeTransitiveDependents(graph);
    const core = graph.nodes.get('org/core');
    // service-c reached from two paths but listed once
    expect(core.transitiveDependents).toEqual(['org/service-c']);
  });
});
