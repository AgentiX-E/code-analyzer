// @code-analyzer/infra — InMemoryGraphStore Branch Coverage Tests
// Targets the remaining uncovered edge-case branches: node field updates,
// cascading deletes, index cleanup, cross-project edge queries, and FTS
// decorator matching.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';
import { createTestNode, createTestEdge, resetCounters } from './helpers.js';

describe('InMemoryGraphStore — branch coverage', () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    resetCounters();
    store = new InMemoryGraphStore();
  });

  describe('updateNode language field', () => {
    it('updates the language field', () => {
      const id = store.insertNode(createTestNode({ language: 'typescript' }));
      store.updateNode(id, { language: 'python' });
      const node = store.getNode(id)!;
      expect(node.language).toBe('python');
    });
  });

  describe('deleteNode cascades edges and indexes', () => {
    it('removes a node with a qualified name and connected edges', () => {
      const a = store.insertNode(createTestNode({ qualifiedName: 'pkg.A' }));
      const b = store.insertNode(createTestNode({ qualifiedName: 'pkg.B' }));
      const c = store.insertNode(createTestNode({ qualifiedName: 'pkg.C' }));
      store.insertEdge(createTestEdge({ sourceId: a, targetId: b }));
      store.insertEdge(createTestEdge({ sourceId: b, targetId: c }));

      // Deleting the middle node must cascade-remove its in+out edges.
      store.deleteNode(b);

      expect(store.getNode(b)).toBeNull();
      expect(store.getEdgeCount()).toBe(0);
      expect(store.getNodeByQualifiedName('pkg.B')).toBeNull();
    });
  });

  describe('deleteEdge index cleanup', () => {
    it('removes the last edge and cleans all secondary indexes', () => {
      const a = store.insertNode(createTestNode({ qualifiedName: 'pkg.A' }));
      const b = store.insertNode(createTestNode({ qualifiedName: 'pkg.B' }));
      const edgeId = store.insertEdge(createTestEdge({ sourceId: a, targetId: b }));

      store.deleteEdge(edgeId);

      expect(store.getEdgeCount()).toBe(0);
      // getEdgesForNode and queryEdges should reflect the removal.
      expect(store.getEdgesForNode(a, undefined, 'out')).toHaveLength(0);
      expect(store.queryEdges({ projectId: 'test-project' }).items).toHaveLength(0);
    });
  });

  describe('queryEdges cross-project filtering', () => {
    it('excludes edges whose project differs from the query', () => {
      const a = store.insertNode(createTestNode({ projectId: 'p1', qualifiedName: 'p1.A' }));
      const b = store.insertNode(createTestNode({ projectId: 'p1', qualifiedName: 'p1.B' }));
      const a2 = store.insertNode(createTestNode({ projectId: 'p2', qualifiedName: 'p2.A' }));
      const b2 = store.insertNode(createTestNode({ projectId: 'p2', qualifiedName: 'p2.B' }));
      store.insertEdge(createTestEdge({ projectId: 'p1', sourceId: a, targetId: b }));
      store.insertEdge(createTestEdge({ projectId: 'p2', sourceId: a2, targetId: b2 }));

      // Query edges for p1 only — the p2 edge must be excluded.
      const bySource = store.queryEdges({ projectId: 'p1', sourceId: a });
      expect(bySource.items).toHaveLength(1);
      expect(bySource.items[0]!.projectId).toBe('p1');

      const byTarget = store.queryEdges({ projectId: 'p1', targetId: b });
      expect(byTarget.items).toHaveLength(1);
      expect(byTarget.items[0]!.sourceId).toBe(a);
    });
  });

  describe('searchFts decorator matching', () => {
    it('ranks a node by its decorator when no other column matches', () => {
      const id = store.insertNode(
        createTestNode({
          name: 'zzzunique',
          qualifiedName: 'pkg.zzzunique',
          properties: { decorators: ['@Component', '@Injectable'] },
        }),
      );

      const results = store.searchFts('component');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.nodeId).toBe(id);
      expect(results[0]!.matchedColumn).toBe('decorators');
    });
  });

  describe('optimize rebuilds indexes', () => {
    it('preserves qualified-name lookup after optimize', () => {
      store.insertNode(createTestNode({ qualifiedName: 'pkg.A' }));
      store.insertNode(createTestNode({ qualifiedName: 'pkg.B' }));

      store.optimize();

      expect(store.getNodeByQualifiedName('pkg.A')).not.toBeNull();
      expect(store.getNodeByQualifiedName('pkg.B')).not.toBeNull();
    });
  });
});
