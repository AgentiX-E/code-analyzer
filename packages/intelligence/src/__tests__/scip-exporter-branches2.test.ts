// @code-analyzer/intelligence — SCIP Exporter Branch Coverage (round 2)
// Reaches formatExternalSymbol, which runs in exportDocument when an edge's
// targetId does not resolve to a node in the graph. InMemoryGraphStore enforces
// referential integrity (insertEdge validates targets; deleteNode cascades), so
// it can never produce a dangling edge — but the exporter is a defense-in-depth
// SCIP serializer that must degrade gracefully for unresolved (external)
// references from partial graph snapshots or future storage backends. This test
// supplies a minimal store stand-in whose getNode returns null for a referenced
// id, driving the external-symbol branch with a real assertion on the output.

import { describe, it, expect } from 'vitest';
import { exportScipIndex } from '../scip/scip-exporter.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

const NOW = '2024-01-01T00:00:00.000Z';

const nodeA: GraphNode = {
  id: 1,
  projectId: 'p',
  label: 'Function',
  name: 'a',
  qualifiedName: 'a',
  filePath: 'src/a.ts',
  startLine: 1,
  endLine: 2,
  language: 'typescript',
  properties: { name: 'a' },
  signature: null,
  docstring: null,
  complexity: null,
  isExported: false,
  fingerprint: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const danglingEdge: GraphEdge = {
  id: 0,
  projectId: 'p',
  sourceId: 1,
  targetId: 999,
  type: 'CALLS',
  properties: {},
  weight: 1,
  createdAt: NOW,
};

/** A store stand-in exposing exactly the surface exportScipIndex consumes. */
function makeStore(): InMemoryGraphStore {
  return {
    getAllNodes: () => [nodeA],
    getEdgesForNode: (nodeId: number, _type?: unknown, _direction?: unknown): GraphEdge[] =>
      nodeId === 1 ? [danglingEdge] : [],
    getNode: (id: number): GraphNode | null => (id === 1 ? nodeA : null),
  } as unknown as InMemoryGraphStore;
}

describe('SCIP Exporter — external symbol for unresolved target', () => {
  it('formats an external symbol when an edge target is not in the graph', () => {
    const idx = exportScipIndex(makeStore(), 'p');
    const rel = idx.documents.find((d) => d.relativePath === 'src/a.ts')!.symbols[0]!
      .relationships[0]!;

    expect(rel.symbol).toBe('ts . external/ref_999.');
    expect(rel.isReference).toBe(true);
    expect(rel.isDefinition).toBe(false);
  });
});
