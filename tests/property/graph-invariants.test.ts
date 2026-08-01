// @code-analyzer — Property-Based Graph Invariant Tests
// Uses fast-check to validate graph store invariants under arbitrary inputs.
// NOTE: Uses vitest assertions directly (no fast-check wrapper due to esbuild compat).

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';

function createStore(): InMemoryGraphStore {
  return new InMemoryGraphStore(':memory:');
}

function addNode(store: InMemoryGraphStore, name: string, label = 'Function'): number {
  const now = new Date().toISOString();
  return store.insertNode({
    id: 0, projectId: 'prop-test', label: label as any,
    name, qualifiedName: name, filePath: `src/${name}.ts`,
    startLine: 1, endLine: 10, language: 'typescript',
    properties: {}, signature: null, docstring: null,
    complexity: null, isExported: true, fingerprint: null,
    createdAt: now, updatedAt: now,
  });
}

function addEdge(store: InMemoryGraphStore, src: number, tgt: number, type = 'IMPORTS'): number {
  return store.insertEdge({
    id: 0, projectId: 'prop-test',
    sourceId: src, targetId: tgt,
    type: type as any, properties: {},
    weight: 1, createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Graph Store Invariant Tests
// ---------------------------------------------------------------------------

describe('Graph Store Invariants', () => {
  describe('Node CRUD', () => {
    it('inserted nodes are retrievable by ID', () => {
      const s = createStore();
      const id = addNode(s, 'TestNode');
      expect(id).toBeGreaterThan(0);
      expect(s.getNode(id)).not.toBeNull();
    });

    it('getNode returns null for invalid ID', () => {
      const s = createStore();
      expect(s.getNode(999999)).toBeNull();
    });

    it('batch insert returns correct count', () => {
      const s = createStore();
      const now = new Date().toISOString();
      const nodes = Array.from({ length: 50 }, (_, i) => ({
        id: 0, projectId: 'prop-test', label: 'Function' as any,
        name: `Batch${i}`, qualifiedName: `Batch${i}`,
        filePath: `src/Batch${i}.ts`, startLine: 1, endLine: 10,
        language: 'typescript', properties: {},
        signature: null, docstring: null, complexity: null,
        isExported: true, fingerprint: null,
        createdAt: now, updatedAt: now,
      }));
      expect(s.insertNodes(nodes).length).toBe(50);
    });

    it('two inserts produce distinct IDs', () => {
      const s = createStore();
      const id1 = addNode(s, 'NodeA');
      const id2 = addNode(s, 'NodeB');
      expect(id1).not.toBe(id2);
    });

    it('insertNodes on empty array returns empty array', () => {
      const s = createStore();
      expect(s.insertNodes([])).toEqual([]);
    });
  });

  describe('Edge Operations', () => {
    it('edges are retrievable from source node', () => {
      const s = createStore();
      const a = addNode(s, 'A', 'Class');
      const b = addNode(s, 'B', 'Class');
      addEdge(s, a, b);
      const edges = s.getEdgesForNode(a);
      expect(edges.length).toBe(1);
      expect(edges[0]!.targetId).toBe(b);
    });

    it('getEdgesForNode returns empty for non-existent node', () => {
      const s = createStore();
      expect(s.getEdgesForNode(999999)).toEqual([]);
    });

    it('multiple edges from same source are all retrievable', () => {
      const s = createStore();
      const src = addNode(s, 'Source');
      const targets = [addNode(s, 'T1'), addNode(s, 'T2'), addNode(s, 'T3')];
      for (const t of targets) {
        addEdge(s, src, t);
      }
      expect(s.getEdgesForNode(src).length).toBe(3);
    });
  });

  describe('FTS Search', () => {
    it('finds node by exact name', () => {
      const s = createStore();
      addNode(s, 'handleRequest', 'Class');
      addNode(s, 'handleResponse', 'Class');
      const results = s.searchFts('handleRequest');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.node.name === 'handleRequest')).toBe(true);
    });

    it('returns empty for nonexistent search', () => {
      const s = createStore();
      expect(s.searchFts('zzz_xxxxx_nonexistent')).toEqual([]);
    });

    it('handles empty query string', () => {
      const s = createStore();
      expect(Array.isArray(s.searchFts(''))).toBe(true);
    });

    it('respects limit option', () => {
      const s = createStore();
      for (let i = 0; i < 20; i++) {
        addNode(s, `Symbol${i}`);
      }
      const results = s.searchFts('Symbol', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('BFS Traversal', () => {
    it('BFS from chain root visits all nodes', () => {
      const s = createStore();
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(addNode(s, `Chain${i}`));
      }
      for (let i = 0; i < 4; i++) {
        addEdge(s, ids[i]!, ids[i + 1]!, 'CALLS');
      }
      const result = s.bfs(ids[0]!, 10);
      expect(result.visitedCount).toBe(5);
    });

    it('BFS on empty store returns empty', () => {
      const s = createStore();
      const result = s.bfs(1, 5);
      expect(result.nodes).toEqual([]);
      expect(result.visitedCount).toBe(0);
    });

    it('BFS respects maxDepth', () => {
      const s = createStore();
      const ids: number[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(addNode(s, `Deep${i}`));
      }
      for (let i = 0; i < 9; i++) {
        addEdge(s, ids[i]!, ids[i + 1]!, 'CALLS');
      }
      const result = s.bfs(ids[0]!, 2);
      expect(result.visitedCount).toBeLessThan(10);
      expect(result.maxDepthReached).toBeLessThanOrEqual(2);
    });
  });
});
