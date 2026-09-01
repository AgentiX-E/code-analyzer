// @code-analyzer/intelligence — Leiden Branch Coverage (round 2)
// Reaches the two remaining uncovered functions:
//   * generateNewCommId — fired when the refinement phase splits a community
//     into multiple well-connected sub-communities (5-node path + resolution 1.5)
//   * describeCommunities' dominant-label / dominant-language sort comparators
//     (require a multi-member community with >= 2 distinct labels/languages)

import { describe, it, expect } from 'vitest';
import { LeidenCommunityDetector } from '../community/leiden-detector.js';
import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  NodeLabel,
  RelationshipType,
} from '@code-analyzer/shared';

function makeNode(
  id: number,
  opts: { name?: string; label?: NodeLabel; language?: string | null } = {},
): GraphNode {
  const name = opts.name ?? `f${id}`;
  const label = opts.label ?? 'Function';
  return {
    id,
    projectId: 'test',
    label,
    name,
    qualifiedName: `${label}:${name}`,
    filePath: null,
    startLine: null,
    endLine: null,
    language: opts.language ?? null,
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

function makeGraph(nodes: GraphNode[], edges: Array<[number, number]>): KnowledgeGraph {
  const nodeMap = new Map<number, GraphNode>();
  for (const node of nodes) nodeMap.set(node.id, node);
  const edgeMap = new Map<number, GraphEdge>();
  edges.forEach(([s, t], i) => edgeMap.set(i, makeEdge(i, s, t)));
  return { nodes: nodeMap, edges: edgeMap, projectId: 'test' } as unknown as KnowledgeGraph;
}

describe('LeidenCommunityDetector — refinement split invokes generateNewCommId', () => {
  it('splits a 5-node path at its middle node, invoking generateNewCommId', () => {
    // A 5-node path 2-1-0-3-4. At resolution 1.5 the local-moving phase merges
    // {0,1,2} into one community and {3,4} into another. The refinement phase then
    // splits {0,1,2}: node 0 (degree 2, with an external edge to node 3) carries a
    // higher degree penalty, so it is split off into its own sub-community and
    // generateNewCommId allocates a fresh (negative) community id for it. The
    // negative id is later renumbered to a non-negative id in the final result, so
    // the split is observed via the resulting 3 communities and node 0 being alone.
    const graph = makeGraph(
      [makeNode(0), makeNode(1), makeNode(2), makeNode(3), makeNode(4)],
      [
        [0, 1],
        [0, 3],
        [1, 2],
        [3, 4],
      ],
    );

    const result = new LeidenCommunityDetector({ resolution: 1.5 }).detect(graph);

    // The refinement split produced three communities ({0}, {1,2}, {3,4}).
    expect(result.communityCount).toBe(3);
    // Every node is still assigned to exactly one community.
    expect(result.nodeToCommunity.size).toBe(5);
    // Node 0 was split off into its own community by generateNewCommId.
    const c0 = result.nodeToCommunity.get(0)!;
    const c1 = result.nodeToCommunity.get(1)!;
    const c2 = result.nodeToCommunity.get(2)!;
    const c3 = result.nodeToCommunity.get(3)!;
    const c4 = result.nodeToCommunity.get(4)!;
    expect(c0).not.toBe(c1);
    expect(c0).not.toBe(c3);
    expect(c1).toBe(c2);
    expect(c3).toBe(c4);
  });
});

describe('LeidenCommunityDetector — describeCommunities dominant signal sort', () => {
  it('picks dominant label and language across a mixed community', () => {
    const graph = makeGraph(
      [
        makeNode(1, { name: 'a', label: 'Class', language: 'typescript' }),
        makeNode(2, { name: 'b', label: 'Function', language: 'typescript' }),
        makeNode(3, { name: 'c', label: 'Function', language: 'python' }),
      ],
      [],
    );

    const detector = new LeidenCommunityDetector();
    // A hand-crafted result placing all three members in one community so the
    // label/language count maps each hold >= 2 entries, forcing both sort
    // comparators to run and order by descending frequency.
    const result = {
      nodeToCommunity: new Map<number, number>([
        [1, 0],
        [2, 0],
        [3, 0],
      ]),
      communities: new Map<number, number[]>([[0, [1, 2, 3]]]),
      modularity: 0,
      communityCount: 1,
      iterations: 1,
      resolution: 1.0,
    };

    const infos = detector.describeCommunities(graph, result);

    expect(infos).toHaveLength(1);
    // Two Function members vs one Class member.
    expect(infos[0]!.dominantLabel).toBe('Function');
    // Two TypeScript members vs one Python member.
    expect(infos[0]!.dominantLanguage).toBe('typescript');
    expect(infos[0]!.size).toBe(3);
  });
});
