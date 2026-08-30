// @code-analyzer/intelligence — Leiden Branch Coverage
// Exercises the remaining reachable branches of the pure `leiden()` function and
// the `LeidenCommunityDetector` class: self-loops, edges referencing nodes that
// are absent from the node set (malformed input), the empty-input fallback, and
// describeCommunities over nodes with no language/name and isolated members.

import { describe, it, expect } from 'vitest';
import { leiden } from '../community/leiden.js';
import { LeidenCommunityDetector } from '../community/leiden-detector.js';
import type { GraphNode, GraphEdge, NodeLabel, RelationshipType } from '@code-analyzer/shared';

function makeNode(id: number, name = `f${id}`): GraphNode {
  return {
    id,
    projectId: 'test',
    label: 'Function' as NodeLabel,
    name,
    qualifiedName: `Function:${name}`,
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    properties: { name },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeEdge(
  id: number,
  sourceId: number,
  targetId: number,
  type = 'CALLS',
  weight = 1,
): GraphEdge {
  return {
    id,
    projectId: 'test',
    sourceId,
    targetId,
    type: type as RelationshipType,
    properties: {},
    weight,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('leiden — self-loop and malformed-edge branches', () => {
  it('skips a self-loop edge in the local-moving phase', () => {
    const nodes = [makeNode(1), makeNode(2)];
    const edges = [makeEdge(1, 1, 1), makeEdge(2, 1, 2)];
    const result = leiden({ nodes, edges });
    expect(result.nodeToCommunity.size).toBe(2);
  });

  it('ignores an edge whose neighbor is not in the node set', () => {
    // Nodes 2 and 3 are absent from `nodes`; edge 1->2 has an unknown neighbor
    // and edge 2->3 joins two unknown nodes (driving the `?? 1` fallbacks in
    // computeModularity).
    const nodes = [makeNode(1)];
    const edges = [makeEdge(1, 1, 2), makeEdge(2, 2, 3)];
    const result = leiden({ nodes, edges });
    expect(result.nodeToCommunity.size).toBe(1);
    expect(result.communityCount).toBe(1);
  });

  it('returns empty for an entirely empty input', () => {
    const result = leiden({});
    expect(result.communityCount).toBe(0);
    expect(result.iterations).toBe(0);
  });
});

describe('LeidenCommunityDetector — self-loop and malformed-edge branches', () => {
  function makeGraph(nodes: any[], edges: Array<[number, number, number?]>) {
    const nodeMap = new Map<number, any>();
    const edgeMap = new Map<number, any>();
    for (const node of nodes) nodeMap.set(node.id, node);
    edges.forEach(([s, t, w], i) => {
      edgeMap.set(i, {
        id: i,
        sourceId: s,
        targetId: t,
        weight: w ?? 1,
        projectId: 'test',
        type: 'CALLS',
        createdAt: '',
      });
    });
    return { nodes: nodeMap, edges: edgeMap, projectId: 'test' } as any;
  }

  function plainNode(id: number) {
    return { id, name: `node${id}`, label: 'Function', language: 'typescript' };
  }

  it('skips a self-loop edge during local moving', () => {
    const g = makeGraph(
      [plainNode(0), plainNode(1)],
      [
        [0, 0],
        [0, 1],
      ],
    );
    const r = new LeidenCommunityDetector().detect(g);
    expect(r.nodeToCommunity.size).toBe(2);
  });

  it('ignores neighbors and community weights for unknown nodes', () => {
    // Node 0 has an edge to node 9 (unknown); node 8 -> node 9 joins two
    // unknown nodes, exercising the computeModularity `?? 1` fallbacks.
    const g = makeGraph(
      [plainNode(0)],
      [
        [0, 9],
        [8, 9],
      ],
    );
    const r = new LeidenCommunityDetector().detect(g);
    expect(r.nodeToCommunity.size).toBe(1);
  });
});

describe('LeidenCommunityDetector.describeCommunities — missing metadata', () => {
  function makeGraph(nodes: any[], edges: Array<[number, number, number?]>) {
    const nodeMap = new Map<number, any>();
    const edgeMap = new Map<number, any>();
    for (const node of nodes) nodeMap.set(node.id, node);
    edges.forEach(([s, t, w], i) => {
      edgeMap.set(i, {
        id: i,
        sourceId: s,
        targetId: t,
        weight: w ?? 1,
        projectId: 'test',
        type: 'CALLS',
        createdAt: '',
      });
    });
    return { nodes: nodeMap, edges: edgeMap, projectId: 'test' } as any;
  }

  it('falls back to Unknown for a community with no language or name', () => {
    // Nodes lack `language` and `name`; node 2 is isolated (cohesion 0).
    const g = makeGraph(
      [
        { id: 0, name: null, label: 'Function', language: null },
        { id: 1, name: null, label: 'Function', language: null },
        { id: 2, name: null, label: 'Function', language: null },
      ],
      [[0, 1]],
    );
    const d = new LeidenCommunityDetector();
    const r = d.detect(g);
    const infos = d.describeCommunities(g, r);

    expect(infos.length).toBeGreaterThan(0);
    // Every community has no language metadata, so the dominant language is Unknown.
    expect(infos.every((i) => i.dominantLanguage === 'Unknown')).toBe(true);
    // The isolated node's community has zero internal+external edges -> cohesion 0.
    expect(infos.some((i) => i.cohesion === 0)).toBe(true);
  });
});
