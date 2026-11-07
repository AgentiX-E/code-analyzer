// Modularity is a property of a partition, and for four iterations this module published something else.
//
// **Two defects, both found by asking what the number means.** `computeModularity` walked the adjacency and added
// `weight − degI·degJ/(2m)` only for edges whose endpoints shared a community, so a community with no internal edge
// contributed **nothing at all** — not even the `−(d/2m)²` penalty for existing. And the loop did not use that function
// at the end: it accumulated `modularity += bestGain` along the search's own path. Between them they produced
// **21.86 on `spring-petclinic`, where the upper bound is 1**, and a test in `louvain.test.ts` asserted that this was
// fine — *"Modularity can mathematically exceed 1.0 … The theoretical range is [−1, +∞)"*. It cannot: `Q` is a weighted
// average of `(L_c/m − (d_c/2m)²)` and never exceeds 1.
//
// **Three claims are asserted here, and each one can fail.** `modularity` equals the definition applied to the returned
// partition; no single-node move improves it, measured with the same definition; and it is inside `[−0.5, 1]`.
//
// The third is a bound, the second is what makes the first meaningful: the old gain rule scored a move by the weight it
// gained and the size of the community it joined, never charging the edges it abandoned — on a five-node clique it
// moved a node out of a four-node community into a singleton at a *positive* score where the definition says the
// partition gets worse, and then stopped.

import { describe, expect, it } from 'vitest';

import { LouvainDetector } from '../louvain.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

/** A graph in the shape the detector reads: nodes and `CALLS` edges, nothing else. */
function makeGraph(): KnowledgeGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    projectId: 'louvain-modularity',
    createdAt: '',
    updatedAt: '',
  } as unknown as KnowledgeGraph;
}

function addNode(graph: KnowledgeGraph, id: number): void {
  graph.nodes.set(id, {
    id,
    projectId: 'louvain-modularity',
    label: 'Function',
    name: `f${id}`,
    qualifiedName: `pkg.f${id}`,
    filePath: 'src/a.ts',
    startLine: id,
    endLine: id + 1,
    language: 'typescript',
    signature: null,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
    properties: {},
  });
}

let nextEdge = 0;

function addEdge(graph: KnowledgeGraph, source: number, target: number, weight = 1): void {
  nextEdge += 1;
  graph.edges.set(nextEdge, {
    id: nextEdge,
    projectId: 'louvain-modularity',
    sourceId: source,
    targetId: target,
    type: 'CALLS',
    properties: {},
    weight,
    createdAt: '',
  });
}

/** The undirected weighted edges the detector sees, from the graph. */
function edgesOf(graph: KnowledgeGraph): Array<{ source: number; target: number; weight: number }> {
  const edges: Array<{ source: number; target: number; weight: number }> = [];
  for (const edge of graph.edges.values()) {
    if (edge.type !== 'CALLS') continue;
    if (edge.properties?.['isCall'] === false) continue;
    edges.push({ source: edge.sourceId, target: edge.targetId, weight: edge.weight ?? 1 });
  }
  return edges;
}

/**
 * Modularity of a partition, **computed here from the textbook definition** so the assertion does not share a bug with
 * the implementation: `Q = Σ_c [ L_c/m − (d_c/2m)² ]`, with `L_c` the weight inside `c` and `d_c` its degree sum.
 */
function modularityOf(graph: KnowledgeGraph, partition: Map<number, number>): number {
  const edges = edgesOf(graph);
  const m = edges.reduce((sum, edge) => sum + edge.weight, 0);
  if (m === 0) return 0;
  const degree = new Map<number, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + edge.weight);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + edge.weight);
  }
  const inside = new Map<number, number>();
  for (const edge of edges) {
    const community = partition.get(edge.source);
    if (community === undefined || community !== partition.get(edge.target)) continue;
    inside.set(community, (inside.get(community) ?? 0) + edge.weight);
  }
  const degrees = new Map<number, number>();
  for (const [node, community] of partition) {
    degrees.set(community, (degrees.get(community) ?? 0) + (degree.get(node) ?? 0));
  }
  let q = 0;
  for (const [community, total] of degrees) {
    q += (inside.get(community) ?? 0) / m - (total / (2 * m)) ** 2;
  }
  return q;
}

/** The best modularity reachable by moving one node to another community, **or by staying**, from the definition. */
function bestSingleMove(
  graph: KnowledgeGraph,
  partition: Map<number, number>,
): { community: number; modularity: number } {
  let best = { community: -1, modularity: modularityOf(graph, partition) };
  const communities = [...new Set(partition.values())];
  for (const [node] of partition) {
    const current = partition.get(node)!;
    for (const community of communities) {
      if (community === current) continue;
      partition.set(node, community);
      const q = modularityOf(graph, partition);
      if (q > best.modularity) best = { community, modularity: q };
      partition.set(node, current);
    }
  }
  return best;
}

/** A clique on `size` nodes, every pair joined with weight one. */
function clique(size: number): KnowledgeGraph {
  const graph = makeGraph();
  for (let node = 0; node < size; node++) addNode(graph, node);
  for (let left = 0; left < size; left++) {
    for (let right = left + 1; right < size; right++) addEdge(graph, left, right);
  }
  return graph;
}

describe('the modularity the detector publishes is the partition’s modularity', () => {
  it('equals the definition on a clique, where the answer is one community and 0', () => {
    // **A clique has no modular structure**: together it scores `m/m − (2m/2m)² = 0`, and any split is negative. The
    // old rule reported the accumulated gain (0.12 for the `4+1` split it stopped at), which is a number no partition
    // of a five-node clique can have.
    const graph = clique(5);
    const result = new LouvainDetector().detectCommunities(graph);

    expect(result.communities.size).toBe(1);
    expect(result.modularity).toBeCloseTo(modularityOf(graph, result.nodeToCommunity), 10);
    expect(result.modularity).toBeCloseTo(0, 10);
  });

  it('never leaves [−0.5, 1] on graphs built to punish the null-model term', () => {
    // **The bound is the point**: the published 21.86 came from a partition of 325 edges, and no partition of any graph
    // can exceed 1. A dense graph with a few isolated nodes is the shape that made the missing penalty visible — the
    // isolated nodes were free, so splitting them into singletons looked like a gain.
    const graph = makeGraph();
    for (let node = 0; node < 12; node++) addNode(graph, node);
    for (let left = 0; left < 6; left++) {
      for (let right = left + 1; right < 6; right++) addEdge(graph, left, right, 3);
    }
    for (let node = 6; node < 12; node++) addEdge(graph, node, node - 6, 1);

    const result = new LouvainDetector().detectCommunities(graph);

    expect(result.modularity).toBeCloseTo(modularityOf(graph, result.nodeToCommunity), 10);
    expect(result.modularity).toBeLessThanOrEqual(1);
    expect(result.modularity).toBeGreaterThanOrEqual(-0.5);
  });

  it('stops at a partition no single move improves, measured with the definition', () => {
    // **This is the assertion the old gain rule fails, and it fails it on a graph with no ambiguity.** Two triangles
    // joined by one weak edge: the answer is one community per triangle. The old rule would move a node out of a
    // triangle into the other at a positive score, because it never charged the two edges it abandoned.
    const graph = makeGraph();
    for (let node = 0; node < 6; node++) addNode(graph, node);
    addEdge(graph, 0, 1, 5);
    addEdge(graph, 1, 2, 5);
    addEdge(graph, 0, 2, 5);
    addEdge(graph, 3, 4, 5);
    addEdge(graph, 4, 5, 5);
    addEdge(graph, 3, 5, 5);
    addEdge(graph, 2, 3, 1);

    const result = new LouvainDetector().detectCommunities(graph);

    expect(result.communities.size).toBe(2);
    const best = bestSingleMove(graph, new Map(result.nodeToCommunity));
    expect(best.modularity).toBeLessThanOrEqual(result.modularity + 1e-12);
    expect(result.modularity).toBeCloseTo(modularityOf(graph, result.nodeToCommunity), 10);
  });

  it('reports the passes it took, rather than a field that is always zero', () => {
    // `iterations` was returned as a literal `0` with the comment "updated by caller", and no caller updated it — so a
    // converged partition and one stopped at `maxIterations` were the same number.
    const graph = makeGraph();
    for (let node = 0; node < 6; node++) addNode(graph, node);
    for (let node = 1; node < 6; node++) addEdge(graph, node - 1, node, 2);

    const result = new LouvainDetector().detectCommunities(graph);
    expect(result.iterations).toBeGreaterThanOrEqual(1);

    const empty = new LouvainDetector().detectCommunities(makeGraph());
    expect(empty.iterations).toBe(0);
  });

  it('records the phase it does not implement: a chain stops at pairs where aggregation would reach halves', () => {
    // **The limitation, asserted rather than described**, so a future reader cannot mistake this class for Louvain.
    // Two paths of four nodes with one weak link: `4+4` scores 0.4677 and this module returns `2+2+2+2` at 0.3949,
    // because merging two non-empty communities is not a single-node move. The figure is correct; the algorithm is
    // phase one.
    const graph = makeGraph();
    for (let node = 0; node < 8; node++) addNode(graph, node);
    for (let node = 1; node < 4; node++) addEdge(graph, node - 1, node, 10);
    for (let node = 5; node < 8; node++) addEdge(graph, node - 1, node, 10);
    addEdge(graph, 3, 4, 2);

    const result = new LouvainDetector().detectCommunities(graph);
    const halves = new Map<number, number>();
    for (let node = 0; node < 8; node++) halves.set(node, node < 4 ? 1 : 2);

    expect(result.communities.size).toBe(4);
    expect(result.modularity).toBeCloseTo(0.3949, 3);
    // The partition the missing phase would find scores more, and this assertion is the reason the gap is written down.
    expect(modularityOf(graph, halves)).toBeCloseTo(0.4677, 3);
    expect(result.modularity).toBeLessThan(modularityOf(graph, halves));
  });
});
