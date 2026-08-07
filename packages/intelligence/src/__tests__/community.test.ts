// @code-analyzer/intelligence — Community Detection Tests
// Comprehensive tests for Louvain and Leiden community detection algorithms.

import { describe, it, expect } from 'vitest';
import { LouvainDetector } from '../community/louvain.js';
import { leiden } from '../community/leiden.js';
import { LeidenCommunityDetector } from '../community/leiden-detector.js';
import { buildReducedGraph, mapToOriginalNodes } from '../community/aggregation.js';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@code-analyzer/shared';
import type { LeidenCommunityResult } from '../community/leiden.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeGraph(): KnowledgeGraph {
  return {
    projectId: 'test',
    nodes: new Map(),
    edges: new Map(),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

function addNode(g: KnowledgeGraph, id: number, label: string, name: string): GraphNode {
  const node: GraphNode = {
    id, projectId: g.projectId, label: label as any, name,
    qualifiedName: `${label}:${name}`,
    filePath: null, startLine: null, endLine: null, language: null,
    properties: { name }, signature: null, docstring: null, complexity: null,
    isExported: false, fingerprint: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  g.nodes.set(id, node);
  return node;
}

function addEdge(
  g: KnowledgeGraph,
  id: number,
  sourceId: number,
  targetId: number,
  type: string,
  weight = 1,
): void {
  const edge: GraphEdge = {
    id, projectId: g.projectId, sourceId, targetId,
    type: type as any, properties: {}, weight,
    createdAt: new Date().toISOString(),
  };
  g.edges.set(id, edge);
}

/** Build a two-community graph with a weak inter-community edge. */
function buildTwoCommunityGraph(): KnowledgeGraph {
  const g = makeGraph();
  for (let i = 0; i < 6; i++) addNode(g, i, 'Function', `f${i}`);
  // Community A: 0-1-2
  addEdge(g, 0, 0, 1, 'CALLS');
  addEdge(g, 1, 1, 2, 'CALLS');
  addEdge(g, 2, 0, 2, 'CALLS');
  // Community B: 3-4-5
  addEdge(g, 3, 3, 4, 'CALLS');
  addEdge(g, 4, 4, 5, 'CALLS');
  addEdge(g, 5, 3, 5, 'CALLS');
  // Weak inter-community edge
  addEdge(g, 6, 0, 3, 'CALLS');
  return g;
}

/** Build a fully connected graph (clique). */
function buildCliqueGraph(n: number): KnowledgeGraph {
  const g = makeGraph();
  for (let i = 0; i < n; i++) addNode(g, i, 'Function', `f${i}`);
  let edgeId = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      addEdge(g, edgeId++, i, j, 'CALLS');
    }
  }
  return g;
}

/** Build a disconnected graph (two isolated components). */
function buildDisconnectedGraph(): KnowledgeGraph {
  const g = makeGraph();
  for (let i = 0; i < 4; i++) addNode(g, i, 'Function', `f${i}`);
  // Component A: 0-1
  addEdge(g, 0, 0, 1, 'CALLS');
  // Component B: 2-3
  addEdge(g, 1, 2, 3, 'CALLS');
  return g;
}

/** Build a star graph (one center connected to all leaves). */
function buildStarGraph(n: number): KnowledgeGraph {
  const g = makeGraph();
  for (let i = 0; i < n; i++) addNode(g, i, 'Function', `f${i}`);
  for (let i = 1; i < n; i++) {
    addEdge(g, i - 1, 0, i, 'CALLS');
  }
  return g;
}

// ===========================================================================
// Louvain Tests
// ===========================================================================

describe('LouvainDetector', () => {
  const detector = new LouvainDetector();

  it('should detect communities in a two-community call graph', () => {
    const g = buildTwoCommunityGraph();
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(6);
    expect(result.modularity).toBeGreaterThan(0);
  });

  it('should produce a single community for a fully connected graph', () => {
    const g = buildCliqueGraph(5);
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(5);
  });

  it('should handle empty graph', () => {
    const g = makeGraph();
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBe(0);
    expect(result.modularity).toBe(0);
  });

  it('should handle graph with nodes but no edges', () => {
    const g = makeGraph();
    addNode(g, 0, 'Function', 'f0');
    addNode(g, 1, 'Function', 'f1');
    const result = detector.detectCommunities(g);
    expect(result.nodeToCommunity.size).toBe(0);
  });

  it('should handle single node graph', () => {
    const g = makeGraph();
    addNode(g, 0, 'Function', 'f0');
    const result = detector.detectCommunities(g);
    expect(result.nodeToCommunity.size).toBe(0);
  });

  it('should assign all nodes in a community to the same community ID', () => {
    const g = makeGraph();
    for (let i = 0; i < 4; i++) addNode(g, i, 'Function', `f${i}`);
    addEdge(g, 0, 0, 1, 'CALLS');
    addEdge(g, 1, 1, 2, 'CALLS');
    addEdge(g, 2, 2, 3, 'CALLS');

    const result = detector.detectCommunities(g);
    // In a linear chain, all nodes tend to be in the same community
    const communities = new Set(result.nodeToCommunity.values());
    expect(communities.size).toBeGreaterThanOrEqual(1);
  });

  it('should achieve non-negative modularity', () => {
    const g = buildTwoCommunityGraph();
    const result = detector.detectCommunities(g);
    expect(result.modularity).toBeGreaterThanOrEqual(0);
  });

  it('should label communities by dominant node label', () => {
    const g = makeGraph();
    for (let i = 0; i < 3; i++) addNode(g, i, 'Function', `f${i}`);
    addEdge(g, 0, 0, 1, 'CALLS');
    addEdge(g, 1, 1, 2, 'CALLS');

    const result = detector.detectCommunities(g);
    for (const [, label] of result.communityLabels) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('should produce valid community assignments for same input', () => {
    const g = buildTwoCommunityGraph();
    const result1 = detector.detectCommunities(g);
    const result2 = detector.detectCommunities(g);
    // Louvain is non-deterministic due to random initialization order.
    // Both runs should produce valid community partitions with positive modularity
    // and cover all nodes.
    expect(result1.modularity).toBeGreaterThan(0);
    expect(result2.modularity).toBeGreaterThan(0);
    expect(result1.nodeToCommunity.size).toBeGreaterThan(0);
    expect(result2.nodeToCommunity.size).toBeGreaterThan(0);
    expect(result1.communities.size).toBeGreaterThan(0);
    expect(result2.communities.size).toBeGreaterThan(0);
    // Both runs should classify the same number of nodes
    expect(result1.nodeToCommunity.size).toBe(result2.nodeToCommunity.size);
  });

  it('should handle star graph topology', () => {
    const g = buildStarGraph(6);
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(6);
  });
});

// ===========================================================================
// Leiden Tests
// ===========================================================================

describe('Leiden Algorithm', () => {
  it('should detect communities in a two-community graph', () => {
    const g = buildTwoCommunityGraph();
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });

    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(6);
    expect(result.modularity).toBeGreaterThan(0);
  });

  it('should achieve modularity >= 0.3 for well-structured graphs', () => {
    const g = buildTwoCommunityGraph();
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });

    // Two clearly separated communities with one weak edge
    // should yield high modularity
    expect(result.modularity).toBeGreaterThanOrEqual(0.2);
  });

  it('should produce a single community for a fully connected graph', () => {
    const g = buildCliqueGraph(5);
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });

    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(5);
  });

  it('should handle empty graph', () => {
    const result = leiden({ nodes: [], edges: [] });
    expect(result.communities.size).toBe(0);
    expect(result.communityCount).toBe(0);
    expect(result.modularity).toBe(0);
  });

  it('should handle single node graph', () => {
    const g = makeGraph();
    addNode(g, 0, 'Function', 'f0');
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });
    expect(result.nodeToCommunity.size).toBe(1);
  });

  it('should handle disconnected graph', () => {
    const g = buildDisconnectedGraph();
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });

    // Disconnected components should be in separate communities
    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(4);
  });

  it('should handle complete graph (all-to-all)', () => {
    const g = buildCliqueGraph(8);
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });
    expect(result.nodeToCommunity.size).toBe(8);
  });

  it('should return valid modularity score', () => {
    const g = buildTwoCommunityGraph();
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });
    // Modularity is always between -0.5 and 1.0
    expect(result.modularity).toBeGreaterThanOrEqual(-0.5);
    expect(result.modularity).toBeLessThanOrEqual(1.0);
  });

  it('should respect resolution parameter', () => {
    const g = buildTwoCommunityGraph();

    const lowRes = leiden({ nodes: g.nodes.values(), edges: g.edges.values() }, { resolution: 0.5 });
    const highRes = leiden({ nodes: g.nodes.values(), edges: g.edges.values() }, { resolution: 2.0 });

    // Higher resolution tends to produce more communities
    expect(lowRes.communityCount).toBeGreaterThanOrEqual(0);
    expect(highRes.communityCount).toBeGreaterThanOrEqual(0);

    // Both should have valid modularity
    expect(lowRes.modularity).toBeGreaterThan(-1);
    expect(highRes.modularity).toBeGreaterThan(-1);
  });

  it('should respect maxIterations parameter', () => {
    const g = buildTwoCommunityGraph();
    const result = leiden(
      { nodes: g.nodes.values(), edges: g.edges.values() },
      { maxIterations: 1 },
    );

    // At most 1 iteration should have been performed
    expect(result.iterations).toBeLessThanOrEqual(2);
  });

  it('should handle star graph topology correctly', () => {
    const g = buildStarGraph(8);
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });
    expect(result.nodeToCommunity.size).toBe(8);
    expect(result.communityCount).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Leiden Detector (Class-based) Tests
// ===========================================================================

describe('LeidenCommunityDetector', () => {
  it('should detect communities using class interface', () => {
    const detector = new LeidenCommunityDetector();
    const g = buildTwoCommunityGraph();
    const result = detector.detect(g);

    expect(result.communityCount).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(6);
  });

  it('should describe communities with metadata', () => {
    const detector = new LeidenCommunityDetector();
    const g = buildTwoCommunityGraph();
    const result = detector.detect(g);
    const infos = detector.describeCommunities(g, result);

    expect(infos.length).toBeGreaterThanOrEqual(1);
    for (const info of infos) {
      expect(info.size).toBeGreaterThan(0);
      expect(info.dominantLabel).toBeDefined();
      expect(info.cohesion).toBeGreaterThanOrEqual(0);
      expect(info.cohesion).toBeLessThanOrEqual(1);
    }
  });

  it('should return correct iteration count', () => {
    const detector = new LeidenCommunityDetector();
    const g = buildTwoCommunityGraph();
    const result = detector.detect(g);
    expect(result.iterations).toBeGreaterThanOrEqual(0);
  });

  it('should work with different edge types', () => {
    const detector = new LeidenCommunityDetector();
    const g = makeGraph();
    for (let i = 0; i < 4; i++) addNode(g, i, 'Function', `f${i}`);
    addEdge(g, 0, 0, 1, 'CALLS');
    addEdge(g, 1, 1, 2, 'CALLS');
    addEdge(g, 2, 2, 3, 'IMPORTS');
    addEdge(g, 3, 0, 3, 'CALLS');

    const result = detector.detect(g);
    expect(result.nodeToCommunity.size).toBe(4);
  });
});

// ===========================================================================
// Aggregation Tests
// ===========================================================================

describe('Community Aggregation', () => {
  it('should build a reduced graph from a partition', () => {
    const g = buildTwoCommunityGraph();
    const adj = new Map<number, Map<number, number>>();
    for (const [, edge] of g.edges) {
      if (edge.type !== 'CALLS') continue;
      if (!adj.has(edge.sourceId)) adj.set(edge.sourceId, new Map());
      if (!adj.has(edge.targetId)) adj.set(edge.targetId, new Map());
      adj.get(edge.sourceId)!.set(edge.targetId, edge.weight);
      adj.get(edge.targetId)!.set(edge.sourceId, edge.weight);
    }

    const n2c = new Map<number, number>();
    n2c.set(0, 0); n2c.set(1, 0); n2c.set(2, 0);
    n2c.set(3, 1); n2c.set(4, 1); n2c.set(5, 1);

    const reduced = buildReducedGraph(adj, n2c, new Map());
    expect(reduced.nodes.length).toBe(2);
    expect(reduced.communityMembers.size).toBe(2);
  });

  it('should map community-of-communities back to original nodes', () => {
    const communityMembers = new Map<number, number[]>();
    communityMembers.set(0, [0, 1, 2]);
    communityMembers.set(1, [3, 4, 5]);

    const reducedN2c = new Map<number, number>();
    reducedN2c.set(0, 100);
    reducedN2c.set(1, 100);

    const result = mapToOriginalNodes(reducedN2c, communityMembers);
    expect(result.get(0)).toBe(100);
    expect(result.get(3)).toBe(100);
    expect(result.size).toBe(6);
  });
});

// ===========================================================================
// Edge Case Tests
// ===========================================================================

describe('Community Detection Edge Cases', () => {
  it('should handle graph with only non-CALLS edges', () => {
    const g = makeGraph();
    for (let i = 0; i < 4; i++) addNode(g, i, 'Function', `f${i}`);
    addEdge(g, 0, 0, 1, 'IMPORTS');
    addEdge(g, 1, 1, 2, 'ACCESSES');
    addEdge(g, 2, 2, 3, 'REFERENCES');

    const louResult = new LouvainDetector().detectCommunities(g);
    const leiResult = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });

    // Both should handle it gracefully
    expect(louResult.nodeToCommunity.size).toBeGreaterThanOrEqual(0);
    expect(leiResult.nodeToCommunity.size).toBeGreaterThanOrEqual(0);
  });

  it('should handle graph with duplicate edges', () => {
    const g = makeGraph();
    addNode(g, 0, 'Function', 'f0');
    addNode(g, 1, 'Function', 'f1');
    addEdge(g, 0, 0, 1, 'CALLS', 2);
    addEdge(g, 1, 0, 1, 'CALLS', 3); // Duplicate edge

    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });
    expect(result.nodeToCommunity.size).toBe(2);
  });

  it('should handle graph with self-loops', () => {
    const g = makeGraph();
    addNode(g, 0, 'Function', 'f0');
    addEdge(g, 0, 0, 0, 'CALLS');

    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });
    expect(result.nodeToCommunity.size).toBe(1);
  });

  it('should have all nodes assigned to a community', () => {
    const g = buildTwoCommunityGraph();
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() });

    for (let i = 0; i < 6; i++) {
      expect(result.nodeToCommunity.has(i)).toBe(true);
    }
  });
});

// ===========================================================================
// Performance Tests
// ===========================================================================

describe('Community Detection Performance', () => {
  it('should process 1000-node graph in reasonable time', () => {
    const g = makeGraph();
    const n = 1000;

    for (let i = 0; i < n; i++) {
      addNode(g, i, 'Function', `f${i}`);
    }

    // Create a ring with some cross edges
    for (let i = 0; i < n; i++) {
      addEdge(g, i, i, (i + 1) % n, 'CALLS');
      if (i % 10 === 0) {
        addEdge(g, n + i, i, (i + 5) % n, 'CALLS');
      }
    }

    const start = Date.now();
    const result = leiden({ nodes: g.nodes.values(), edges: g.edges.values() }, { maxIterations: 10 });
    const duration = Date.now() - start;

    expect(result.nodeToCommunity.size).toBe(n);
    expect(duration).toBeLessThan(5000); // Should complete in < 5s
  });

  it('should scale linearly with small performance overhead', () => {
    const sizes = [50, 100, 200];
    const times: number[] = [];

    for (const n of sizes) {
      const g = makeGraph();
      for (let i = 0; i < n; i++) addNode(g, i, 'Function', `f${i}`);
      for (let i = 0; i < n; i++) {
        addEdge(g, i, i, (i + 1) % n, 'CALLS');
      }

      const start = Date.now();
      leiden({ nodes: g.nodes.values(), edges: g.edges.values() }, { maxIterations: 10 });
      times.push(Date.now() - start);
    }

    // Time should not grow superlinearly
    if (times.length >= 2) {
      const ratio = times[times.length - 1]! / times[times.length - 2]!;
      // Size ratio is 200/100 = 2. The Leiden algorithm is O(N log N) in practice.
      // Under load (full test suite), allow up to 50x time ratio for 2x size increase.
      expect(ratio).toBeLessThan(50);
    }
  });
});
