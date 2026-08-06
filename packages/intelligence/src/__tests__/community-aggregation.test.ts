// @code-analyzer/intelligence — Community Aggregation Tests

import { describe, it, expect } from 'vitest';
import {
  buildReducedGraph,
  mapToOriginalNodes,
  ReducedGraph,
} from '../community/aggregation.js';

/**
 * Create a simple 2-clique test graph:
 * Nodes 1,2 in clique A; nodes 3,4 in clique B;
 * One edge between cliques (2-3).
 */
function twoCliqueGraph(): {
  adj: Map<number, Map<number, number>>;
  deg: Map<number, number>;
  partition: Map<number, number>;
} {
  const adj = new Map<number, Map<number, number>>();
  // Clique A: 1-2 (fully connected)
  adj.set(1, new Map([[2, 1]]));
  adj.set(2, new Map([[1, 1], [3, 1]])); // 2 connects to clique B via 3
  // Clique B: 3-4
  adj.set(3, new Map([[2, 1], [4, 1]]));
  adj.set(4, new Map([[3, 1]]));

  const deg = new Map<number, number>();
  for (const [node, neighbors] of adj) {
    deg.set(node, [...neighbors.values()].reduce((a, b) => a + b, 0));
  }

  // Partition: clique A = community 0, clique B = community 1
  const partition = new Map<number, number>();
  partition.set(1, 0); partition.set(2, 0);
  partition.set(3, 1); partition.set(4, 1);

  return { adj, deg, partition };
}

describe('buildReducedGraph', () => {
  it('builds reduced graph from 2-community partition', () => {
    const { adj, deg, partition } = twoCliqueGraph();
    const reduced = buildReducedGraph(adj, partition, deg);

    expect(reduced.nodes).toHaveLength(2);
    expect(reduced.nodes).toContain(0);
    expect(reduced.nodes).toContain(1);

    // Community 0 should have nodes [1, 2]
    const members0 = reduced.communityMembers.get(0) ?? [];
    expect(members0).toContain(1);
    expect(members0).toContain(2);

    // Community 1 should have nodes [3, 4]
    const members1 = reduced.communityMembers.get(1) ?? [];
    expect(members1).toContain(3);
    expect(members1).toContain(4);

    // There should be an edge between communities (via edge 2-3)
    const adj0 = reduced.adjacency.get(0) ?? new Map();
    const adj1 = reduced.adjacency.get(1) ?? new Map();
    expect(adj0.get(1) ?? 0).toBeGreaterThan(0);
    expect(adj1.get(0) ?? 0).toBeGreaterThan(0);

    // Internal edges: 1-2 in community 0, 3-4 in community 1
    expect(adj0.get(0) ?? 0).toBeGreaterThan(0); // self-loop = internal edges
    expect(adj1.get(1) ?? 0).toBeGreaterThan(0);
  });

  it('returns empty reduced graph for empty input', () => {
    const reduced = buildReducedGraph(new Map(), new Map(), new Map());
    expect(reduced.nodes).toHaveLength(0);
    expect(reduced.totalWeight).toBe(0);
  });

  it('handles single community', () => {
    const adj = new Map<number, Map<number, number>>();
    adj.set(1, new Map([[2, 1]]));
    adj.set(2, new Map([[1, 1]]));
    const deg = new Map([[1, 1], [2, 1]]);
    const partition = new Map([[1, 0], [2, 0]]);

    const reduced = buildReducedGraph(adj, partition, deg);
    expect(reduced.nodes).toHaveLength(1);
    expect(reduced.nodes[0]).toBe(0);
  });
});

describe('mapToOriginalNodes', () => {
  it('maps reduced-graph partition back to original nodes', () => {
    // Reduced graph: node 0 → super-community A, node 1 → super-community A
    const reducedPartition = new Map<number, number>([
      [0, 100], [1, 100],
    ]);

    // Community membership: 0 contains [1,2], 1 contains [3,4]
    const members = new Map<number, number[]>([
      [0, [1, 2]], [1, [3, 4]],
    ]);

    const result = mapToOriginalNodes(reducedPartition, members);

    // All original nodes should be in super-community 100
    expect(result.get(1)).toBe(100);
    expect(result.get(2)).toBe(100);
    expect(result.get(3)).toBe(100);
    expect(result.get(4)).toBe(100);
    expect(result.size).toBe(4);
  });

  it('handles empty members', () => {
    const result = mapToOriginalNodes(new Map(), new Map());
    expect(result.size).toBe(0);
  });
});

