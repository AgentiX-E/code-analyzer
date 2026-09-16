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
    ...overrides,
    id: 0,
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
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

/**
 * The text payload of a tool result.
 *
 * The MCP SDK types `text` as optional, so every assertion reading a tool's JSON output had to write
 * `result.content[0]!.text` and then hand a `string | undefined` to `JSON.parse` — 59 of them across
 * two files. This asserts the text is present once, with a message naming what was missing, instead
 * of at every call site.
 */
export function toolText(result: {
  content: ReadonlyArray<{ type: string; text?: string }>;
}): string {
  const first = result.content[0];
  if (first?.text === undefined) {
    throw new Error(
      `tool result had no text content (got: ${JSON.stringify(result.content).slice(0, 200)})`,
    );
  }
  return first.text;
}
