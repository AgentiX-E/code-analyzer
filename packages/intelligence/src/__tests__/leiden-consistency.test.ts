// @code-analyzer/intelligence — Leiden Partition Consistency & Modularity Invariants
// Verifies that the Leiden algorithm's returned partition is internally consistent
// (every node appears in exactly one community, the union covers all nodes) and that
// the reported modularity matches an independently recomputed community-level value.
// The two-triangle-plus-bridge "dumbbell" graph has a known optimal partition with
// Q = 5/14, which guards against regressions in the gain/score formulas.

import { describe, it, expect } from 'vitest';
import { leiden } from '../community/leiden.js';
import type { GraphNode, GraphEdge, NodeLabel, RelationshipType } from '@code-analyzer/shared';

function makeNode(id: number): GraphNode {
  return {
    id,
    projectId: 'test',
    label: 'Function' as NodeLabel,
    name: `f${id}`,
    qualifiedName: `Function:f${id}`,
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    properties: { name: `f${id}` },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeEdge(id: number, sourceId: number, targetId: number): GraphEdge {
  return {
    id,
    projectId: 'test',
    sourceId,
    targetId,
    type: 'CALLS' as RelationshipType,
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

/** Two triangles (0-1-2 and 3-4-5) joined by a single bridge edge (0-3). */
function buildDumbbell() {
  const nodes = [0, 1, 2, 3, 4, 5].map(makeNode);
  const edges = [
    makeEdge(0, 0, 1),
    makeEdge(1, 1, 2),
    makeEdge(2, 0, 2),
    makeEdge(3, 3, 4),
    makeEdge(4, 4, 5),
    makeEdge(5, 3, 5),
    makeEdge(6, 0, 3),
  ];
  return { nodes, edges };
}

/**
 * Independently recompute modularity from a partition using the community-level
 * form Q = Σ_c [ e_c/m - (d_c/(2m))² ], where e_c is the internal edge weight of
 * community c, d_c its total node degree, and m the total edge weight.
 */
function recomputeModularity(
  nodeToCommunity: Map<number, number>,
  nodes: GraphNode[],
  edges: GraphEdge[],
): number {
  const m = edges.reduce((sum, e) => sum + e.weight, 0);
  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + e.weight);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + e.weight);
  }

  const communities = new Map<number, number[]>();
  for (const node of nodes) {
    const cid = nodeToCommunity.get(node.id)!;
    if (!communities.has(cid)) communities.set(cid, []);
    communities.get(cid)!.push(node.id);
  }

  let q = 0;
  for (const [cid, members] of communities) {
    const memberSet = new Set(members);
    let internal = 0;
    for (const e of edges) {
      if (memberSet.has(e.sourceId) && memberSet.has(e.targetId)) internal += e.weight;
    }
    let totalDegree = 0;
    for (const member of members) totalDegree += degree.get(member) ?? 0;
    q += internal / m - (totalDegree / (2 * m)) ** 2;
  }
  return q;
}

describe('leiden — partition consistency invariants', () => {
  it('assigns every node to exactly one community with no orphans or duplicates', () => {
    const { nodes, edges } = buildDumbbell();
    const result = leiden({ nodes, edges });

    const assigned = new Set<number>();
    for (const [nodeId, cid] of result.nodeToCommunity) {
      expect(assigned.has(nodeId)).toBe(false); // no duplicate assignment
      assigned.add(nodeId);
      // The node must be listed in its community's member list.
      expect(result.communities.get(cid)).toContain(nodeId);
    }
    // Every node is assigned, and every community member is a real node.
    expect(assigned.size).toBe(nodes.length);
    for (const members of result.communities.values()) {
      for (const member of members) expect(assigned.has(member)).toBe(true);
    }
  });

  it('reports modularity matching an independent community-level recomputation', () => {
    const { nodes, edges } = buildDumbbell();
    const result = leiden({ nodes, edges });

    const recomputed = recomputeModularity(result.nodeToCommunity, nodes, edges);
    expect(result.modularity).toBeCloseTo(recomputed, 10);
  });

  it('recovers the optimal partition (Q = 5/14) for the dumbbell graph', () => {
    const { nodes, edges } = buildDumbbell();
    const result = leiden({ nodes, edges });

    // The optimal split is {0,1,2} and {3,4,5} with modularity exactly 5/14.
    expect(result.communityCount).toBe(2);
    expect(result.modularity).toBeCloseTo(5 / 14, 10);
  });
});
