// @code-analyzer/intelligence — Leiden Input Extraction Edge Cases
// Exercises the raw `leiden()` entry point against every accepted input shape:
// InMemoryGraphStore, standalone nodes/edges, edge-type filtering, directed
// mode, and the edge-less early-return path.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { leiden } from '../community/leiden.js';
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

describe('leiden — InMemoryGraphStore input', () => {
  it('extracts nodes and edges from a graph store', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(makeNode(1));
    store.insertNode(makeNode(2));
    store.insertNode(makeNode(3));
    store.insertEdge(makeEdge(1, 1, 2));
    store.insertEdge(makeEdge(2, 2, 3));

    const result = leiden({ graphStore: store });
    expect(result.nodeToCommunity.size).toBe(3);
    expect(result.communityCount).toBeGreaterThanOrEqual(1);
  });

  it('filters graph-store edges by edge type', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(makeNode(1));
    store.insertNode(makeNode(2));
    store.insertNode(makeNode(3));
    store.insertEdge(makeEdge(1, 1, 2, 'CALLS'));
    store.insertEdge(makeEdge(2, 2, 3, 'IMPORTS'));

    // Only CALLS edges are considered — nodes 1-2 are linked, node 3 is isolated.
    const result = leiden({ graphStore: store, edgeTypes: ['CALLS'] });
    expect(result.nodeToCommunity.size).toBe(3);
  });
});

describe('leiden — standalone nodes/edges input', () => {
  it('filters raw edges by edge type', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)];
    const edges = [makeEdge(1, 1, 2, 'CALLS'), makeEdge(2, 2, 3, 'IMPORTS')];

    const result = leiden({ nodes, edges, edgeTypes: ['IMPORTS'] });
    expect(result.nodeToCommunity.size).toBe(3);
  });

  it('supports directed mode (undirected: false)', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)];
    const edges = [makeEdge(1, 1, 2), makeEdge(2, 2, 3)];

    const directed = leiden({ nodes, edges }, { undirected: false });
    expect(directed.nodeToCommunity.size).toBe(3);
    expect(directed.modularity).toBeGreaterThanOrEqual(-1);
    expect(directed.modularity).toBeLessThanOrEqual(1);
  });
});

describe('leiden — edge-less graph early return', () => {
  it('assigns each node its own community when there are no edges', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)];
    const result = leiden({ nodes, edges: [] });

    expect(result.communityCount).toBe(3);
    expect(result.modularity).toBe(0);
    expect(result.iterations).toBe(0);
    expect(result.nodeToCommunity.size).toBe(3);
    // Every node maps to a distinct community.
    expect(new Set(result.nodeToCommunity.values()).size).toBe(3);
  });

  it('treats zero-weight edges as absent and short-circuits', () => {
    const nodes = [makeNode(1), makeNode(2)];
    const edges = [makeEdge(1, 1, 2, 'CALLS', 0)];
    const result = leiden({ nodes, edges });

    expect(result.communityCount).toBe(2);
    expect(result.modularity).toBe(0);
    expect(result.iterations).toBe(0);
  });
});
