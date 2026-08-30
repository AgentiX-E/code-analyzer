// @code-analyzer/intelligence — Leiden Refinement-Phase Branch Coverage
// Reaches the refinement-phase branches that the local-moving-phase tests do
// not touch: a self-loop encountered while a community with >2 members is
// being refined, and describeCommunities over a community whose member ids are
// absent from the graph (empty member set → dominant-label fallback).

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

describe('leiden — self-loop inside a >2-member community during refinement', () => {
  it('skips a self-loop neighbor while refining a 4-node clique', () => {
    // A 4-clique plus a self-loop on node 1: the clique forms a single
    // community (4 members), and refinement walks node 1's adjacency where it
    // encounters its own self-loop edge.
    const nodes = [makeNode(1), makeNode(2), makeNode(3), makeNode(4)];
    const edges = [
      makeEdge(1, 1, 2),
      makeEdge(2, 1, 3),
      makeEdge(3, 1, 4),
      makeEdge(4, 2, 3),
      makeEdge(5, 2, 4),
      makeEdge(6, 3, 4),
      makeEdge(7, 1, 1), // self-loop
    ];
    const result = leiden({ nodes, edges });
    expect(result.nodeToCommunity.size).toBe(4);
    expect(result.communityCount).toBeGreaterThanOrEqual(1);
  });
});

describe('LeidenCommunityDetector — refinement self-loop and empty community', () => {
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

  it('skips a self-loop neighbor while refining a 4-node clique', () => {
    const g = makeGraph(
      [plainNode(0), plainNode(1), plainNode(2), plainNode(3)],
      [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3],
        [0, 0],
      ],
    );
    const r = new LeidenCommunityDetector().detect(g);
    expect(r.nodeToCommunity.size).toBe(4);
  });

  it('falls back to Unknown dominant label for a community with no graph members', () => {
    const g = makeGraph([plainNode(0)], []);
    const d = new LeidenCommunityDetector();
    // Hand-crafted result whose community references a node id absent from the
    // graph — the member set collapses to empty, driving the `?? 'Unknown'`
    // fallback for the dominant label.
    const r = {
      nodeToCommunity: new Map<number, number>(),
      communities: new Map<number, number[]>([[0, [999]]]),
      modularity: 0,
      communityCount: 1,
      iterations: 1,
      resolution: 1.0,
    };
    const infos = d.describeCommunities(g, r);
    expect(infos).toHaveLength(1);
    expect(infos[0]!.dominantLabel).toBe('Unknown');
    expect(infos[0]!.dominantLanguage).toBe('Unknown');
  });
});
