// @code-analyzer/mcp — Intelligence Tool Tests (Shared Helpers)

import type { GraphNode, GraphEdge, NodeLabel, RelationshipType } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

const NOW = new Date().toISOString();

/** Create a minimal GraphNode with required fields filled in. */
function makeNode(
  overrides: Partial<GraphNode> & {
    projectId: string;
    label: NodeLabel;
    name: string;
    qualifiedName: string;
  },
): GraphNode {
  return {
    id: 0,
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Create a minimal GraphEdge. */
function makeEdge(
  overrides: Partial<GraphEdge> & {
    projectId: string;
    type: RelationshipType;
    sourceId: number;
    targetId: number;
  },
): GraphEdge {
  return {
    id: 0,
    ...overrides,
  };
}

/** Insert a node into the store and return its assigned ID. */
export function insertNode(
  store: InMemoryGraphStore,
  overrides: Parameters<typeof makeNode>[0],
): number {
  return store.insertNode(makeNode(overrides));
}

/** Insert an edge into the store and return its assigned ID. */
export function insertEdge(
  store: InMemoryGraphStore,
  overrides: Parameters<typeof makeEdge>[0],
): number {
  return store.insertEdge(makeEdge(overrides));
}
