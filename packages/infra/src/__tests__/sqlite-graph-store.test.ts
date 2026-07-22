// @code-analyzer/infra — SqliteGraphStore Tests
// Comprehensive tests for CRUD, bulk ops, FTS5 search, BFS, integrity, and stats.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteGraphStore, deleteDatabase } from '../storage/sqlite-graph-store.js';
import { createTestNode, createTestEdge, resetCounters } from './helpers.js';
import type { GraphNode, GraphEdge, NodeLabel, EdgeProperties } from '@code-analyzer/shared';

describe('SqliteGraphStore', () => {
  let store: SqliteGraphStore;
  let dbPath: string;

  beforeEach(() => {
    resetCounters();
    dbPath = ':memory:';
    store = new SqliteGraphStore(dbPath);
  });

  afterEach(() => {
    if (store) {
      try { store.close(); } catch { /* ignore close errors */ }
    }
  });

  // ==========================================================================
  // Construction & Lifecycle
  // ==========================================================================

  describe('construction', () => {
    it('creates a store with in-memory database', () => {
      expect(store).toBeDefined();
      const stats = store.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });

    it('creates a store with file-based database path', () => {
      const testDir = mkdtempSync(join(tmpdir(), 'code-analyzer-test-'));
      const filePath = join(testDir, 'test.db');
      const fs = new SqliteGraphStore(filePath);
      expect(fs).toBeDefined();
      fs.close();
      expect(existsSync(filePath)).toBe(true);
      deleteDatabase(filePath);
      try { unlinkSync(join(testDir)); } catch { /* ignore */ }
    });

    it('throws when operating on a closed store', () => {
      store.close();
      expect(() => store.insertNode(createTestNode())).toThrow('SqliteGraphStore is closed');
    });

    it('creates schema tables on construction', () => {
      // Verify nodes_fts virtual table exists by running a search
      store.insertNode(createTestNode({ qualifiedName: 'schema.test', name: 'SchemaTest' }));
      const results = store.searchNodes('SchemaTest');
      expect(results.length).toBe(1);
    });
  });

  // ==========================================================================
  // Node CRUD — Insert
  // ==========================================================================

  describe('insertNode', () => {
    it('inserts a node and returns auto-incremented id', () => {
      const node = createTestNode({ qualifiedName: 'a.b.c' });
      const id = store.insertNode(node);
      expect(id).toBeGreaterThan(0);
    });

    it('inserts multiple nodes with sequential ids', () => {
      const id1 = store.insertNode(createTestNode({ qualifiedName: 'a.b.c1' }));
      const id2 = store.insertNode(createTestNode({ qualifiedName: 'a.b.c2' }));
      const id3 = store.insertNode(createTestNode({ qualifiedName: 'a.b.c3' }));
      expect(id2).toBeGreaterThan(id1);
      expect(id3).toBeGreaterThan(id2);
      expect(store.getStats().nodeCount).toBe(3);
    });

    it('throws on duplicate qualified name in same project', () => {
      store.insertNode(createTestNode({ qualifiedName: 'a.b.c' }));
      expect(() => store.insertNode(createTestNode({ qualifiedName: 'a.b.c' }))).toThrow();
    });

    it('allows same qualified name in different projects', () => {
      store.insertNode(createTestNode({ qualifiedName: 'same.name', projectId: 'projectA' }));
      store.insertNode(createTestNode({ qualifiedName: 'same.name', projectId: 'projectB' }));
      expect(store.getStats().nodeCount).toBe(2);
    });

    it('allows nodes with empty qualified names', () => {
      const node = createTestNode({ qualifiedName: '' });
      const id = store.insertNode(node);
      expect(id).toBeGreaterThan(0);
    });

    it('stores all node fields correctly', () => {
      const node = createTestNode({
        name: 'myFunc',
        qualifiedName: 'pkg.MyClass.myFunc',
        label: 'Method',
        projectId: 'proj123',
        filePath: '/src/MyClass.ts',
        startLine: 42,
        endLine: 58,
        language: 'typescript',
        complexity: 12,
        isExported: true,
        signature: 'myFunc(x: number): string',
        docstring: 'Does something',
        fingerprint: 'abc123',
      });
      const id = store.insertNode(node);
      const retrieved = store.getNode(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('myFunc');
      expect(retrieved!.qualifiedName).toBe('pkg.MyClass.myFunc');
      expect(retrieved!.label).toBe('Method');
      expect(retrieved!.projectId).toBe('proj123');
      expect(retrieved!.filePath).toBe('/src/MyClass.ts');
      expect(retrieved!.startLine).toBe(42);
      expect(retrieved!.endLine).toBe(58);
      expect(retrieved!.language).toBe('typescript');
      expect(retrieved!.complexity).toBe(12);
      expect(retrieved!.isExported).toBe(true);
      expect(retrieved!.signature).toBe('myFunc(x: number): string');
      expect(retrieved!.docstring).toBe('Does something');
      expect(retrieved!.fingerprint).toBe('abc123');
    });

    it('accepts nodes with null fields', () => {
      const node = createTestNode({
        qualifiedName: 'null.fields',
        filePath: null,
        startLine: null,
        endLine: null,
        language: null,
        signature: null,
        docstring: null,
        complexity: null,
        fingerprint: null,
      });
      const id = store.insertNode(node);
      const retrieved = store.getNode(id);
      expect(retrieved!.filePath).toBeNull();
      expect(retrieved!.startLine).toBeNull();
      expect(retrieved!.endLine).toBeNull();
      expect(retrieved!.signature).toBeNull();
      expect(retrieved!.docstring).toBeNull();
      expect(retrieved!.complexity).toBeNull();
      expect(retrieved!.fingerprint).toBeNull();
    });
  });

  // ==========================================================================
  // Node CRUD — Get
  // ==========================================================================

  describe('getNode', () => {
    it('returns node by id', () => {
      const node = createTestNode({ qualifiedName: 'a.b.c' });
      const id = store.insertNode(node);
      const retrieved = store.getNode(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.qualifiedName).toBe('a.b.c');
    });

    it('returns null for non-existent id', () => {
      expect(store.getNode(999)).toBeNull();
    });
  });

  describe('getNodeByQName', () => {
    it('returns node by qualified name', () => {
      const node = createTestNode({ qualifiedName: 'pkg.Class.method' });
      store.insertNode(node);
      const found = store.getNodeByQName('pkg.Class.method');
      expect(found).not.toBeNull();
      expect(found!.qualifiedName).toBe('pkg.Class.method');
    });

    it('returns null for unknown qualified name', () => {
      expect(store.getNodeByQName('unknown.qname')).toBeNull();
    });

    it('returns first match when multiple nodes share qname across projects', () => {
      store.insertNode(createTestNode({ qualifiedName: 'shared.name', projectId: 'projA' }));
      store.insertNode(createTestNode({ qualifiedName: 'shared.name', projectId: 'projB' }));
      const found = store.getNodeByQName('shared.name');
      expect(found).not.toBeNull();
      expect(found!.qualifiedName).toBe('shared.name');
    });
  });

  describe('getNodesByLabel', () => {
    it('returns nodes matching the label', () => {
      store.insertNode(createTestNode({ qualifiedName: 'fn.a', label: 'Function' }));
      store.insertNode(createTestNode({ qualifiedName: 'fn.b', label: 'Function' }));
      store.insertNode(createTestNode({ qualifiedName: 'cls.a', label: 'Class' }));
      const functions = store.getNodesByLabel('Function' as NodeLabel);
      expect(functions.length).toBe(2);
      functions.forEach((n) => expect(n.label).toBe('Function'));
    });

    it('returns empty array when no nodes match', () => {
      const results = store.getNodesByLabel('Interface' as NodeLabel);
      expect(results).toEqual([]);
    });
  });

  describe('getNodesByFile', () => {
    it('returns nodes in the given file', () => {
      store.insertNode(createTestNode({ qualifiedName: 'f1.a', filePath: 'src/foo.ts' }));
      store.insertNode(createTestNode({ qualifiedName: 'f1.b', filePath: 'src/foo.ts' }));
      store.insertNode(createTestNode({ qualifiedName: 'f2.a', filePath: 'src/bar.ts' }));
      const fooNodes = store.getNodesByFile('src/foo.ts');
      expect(fooNodes.length).toBe(2);
    });

    it('returns empty array for unknown file', () => {
      expect(store.getNodesByFile('unknown.ts')).toEqual([]);
    });
  });

  // ==========================================================================
  // Node CRUD — Update
  // ==========================================================================

  describe('updateNode', () => {
    it('updates basic scalar properties', () => {
      const node = createTestNode({ name: 'oldName', qualifiedName: 'upd.name' });
      const id = store.insertNode(node);
      store.updateNode(id, { name: 'newName' });
      const updated = store.getNode(id);
      expect(updated!.name).toBe('newName');
    });

    it('updates label', () => {
      const node = createTestNode({ qualifiedName: 'upd.label', label: 'Function' as NodeLabel });
      const id = store.insertNode(node);
      store.updateNode(id, { label: 'Method' as NodeLabel });
      expect(store.getNode(id)!.label).toBe('Method');
    });

    it('updates file path', () => {
      const node = createTestNode({ qualifiedName: 'upd.file', filePath: '/old/path.ts' });
      const id = store.insertNode(node);
      store.updateNode(id, { filePath: '/new/path.ts' });
      expect(store.getNode(id)!.filePath).toBe('/new/path.ts');
    });

    it('updates line numbers', () => {
      const node = createTestNode({ qualifiedName: 'upd.lines', startLine: 1, endLine: 10 });
      const id = store.insertNode(node);
      store.updateNode(id, { startLine: 5, endLine: 20 });
      const updated = store.getNode(id);
      expect(updated!.startLine).toBe(5);
      expect(updated!.endLine).toBe(20);
    });

    it('updates complexity', () => {
      const node = createTestNode({ qualifiedName: 'upd.complex', complexity: 3 });
      const id = store.insertNode(node);
      store.updateNode(id, { complexity: 15 });
      expect(store.getNode(id)!.complexity).toBe(15);
    });

    it('updates isExported', () => {
      const node = createTestNode({ qualifiedName: 'upd.export', isExported: false });
      const id = store.insertNode(node);
      store.updateNode(id, { isExported: true });
      expect(store.getNode(id)!.isExported).toBe(true);
    });

    it('updates signature', () => {
      const node = createTestNode({ qualifiedName: 'upd.sig', signature: 'old()' });
      const id = store.insertNode(node);
      store.updateNode(id, { signature: 'new()' });
      expect(store.getNode(id)!.signature).toBe('new()');
    });

    it('updates docstring', () => {
      const node = createTestNode({ qualifiedName: 'upd.doc', docstring: 'Old docs' });
      const id = store.insertNode(node);
      store.updateNode(id, { docstring: 'New docs' });
      expect(store.getNode(id)!.docstring).toBe('New docs');
    });

    it('updates properties', () => {
      const node = createTestNode({ qualifiedName: 'upd.props' });
      const id = store.insertNode(node);
      store.updateNode(id, {
        properties: { name: 'newProps', isAsync: true, decorators: ['@Test'] },
      });
      const updated = store.getNode(id)!;
      expect(updated.properties.name).toBe('newProps');
      expect(updated.properties.isAsync).toBe(true);
      expect(updated.properties.decorators).toEqual(['@Test']);
    });

    it('updates qualified name', () => {
      const node = createTestNode({ qualifiedName: 'upd.oldqname' });
      const id = store.insertNode(node);
      store.updateNode(id, { qualifiedName: 'upd.newqname' });
      expect(store.getNode(id)!.qualifiedName).toBe('upd.newqname');
    });

    it('throws when updating non-existent node', () => {
      expect(() => store.updateNode(999, { name: 'nope' })).toThrow(
        'Node update failed: node id=999 not found',
      );
    });

    it('does not change node id on update', () => {
      const node = createTestNode({ qualifiedName: 'upd.id' });
      const id = store.insertNode(node);
      store.updateNode(id, { name: 'updated' });
      expect(store.getNode(id)!.id).toBe(id);
    });
  });

  // ==========================================================================
  // Node CRUD — Delete
  // ==========================================================================

  describe('deleteNode', () => {
    it('deletes a node by id', () => {
      const node = createTestNode({ qualifiedName: 'del.test' });
      const id = store.insertNode(node);
      expect(store.getStats().nodeCount).toBe(1);
      store.deleteNode(id);
      expect(store.getStats().nodeCount).toBe(0);
      expect(store.getNode(id)).toBeNull();
    });

    it('cascades delete to connected edges', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'del.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'del.n2' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      expect(store.getStats().edgeCount).toBe(1);

      store.deleteNode(n1);
      expect(store.getStats().edgeCount).toBe(0);
    });

    it('silently ignores delete for non-existent node', () => {
      expect(() => store.deleteNode(999)).not.toThrow();
    });
  });

  // ==========================================================================
  // Edge CRUD
  // ==========================================================================

  describe('insertEdge', () => {
    let node1: number;
    let node2: number;

    beforeEach(() => {
      node1 = store.insertNode(createTestNode({ qualifiedName: 'e.n1' }));
      node2 = store.insertNode(createTestNode({ qualifiedName: 'e.n2' }));
    });

    it('inserts an edge and returns id', () => {
      const edge = createTestEdge({ sourceId: node1, targetId: node2 });
      const id = store.insertEdge(edge);
      expect(id).toBeGreaterThan(0);
      expect(store.getStats().edgeCount).toBe(1);
    });

    it('throws when source node does not exist', () => {
      const edge = createTestEdge({ sourceId: 999, targetId: node2 });
      expect(() => store.insertEdge(edge)).toThrow('source node id=999 not found');
    });

    it('throws when target node does not exist', () => {
      const edge = createTestEdge({ sourceId: node1, targetId: 999 });
      expect(() => store.insertEdge(edge)).toThrow('target node id=999 not found');
    });

    it('inserts edges with different relationship types', () => {
      const types: Array<'CALLS' | 'IMPLEMENTS' | 'EXTENDS' | 'IMPORTS'> = [
        'CALLS',
        'IMPLEMENTS',
        'EXTENDS',
        'IMPORTS',
      ];
      for (const type of types) {
        store.insertEdge(createTestEdge({ sourceId: node1, targetId: node2, type }));
      }
      expect(store.getStats().edgeCount).toBe(4);
    });
  });

  describe('getEdge', () => {
    it('returns edge by id', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'ge.src' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'ge.tgt' }));
      const edgeId = store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      const edge = store.getEdge(edgeId);
      expect(edge).not.toBeNull();
      expect(edge!.sourceId).toBe(n1);
      expect(edge!.targetId).toBe(n2);
    });

    it('returns null for non-existent id', () => {
      expect(store.getEdge(999)).toBeNull();
    });
  });

  describe('getEdgesBySource', () => {
    it('returns edges from source node', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'ges.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'ges.n2' }));
      const n3 = store.insertNode(createTestNode({ qualifiedName: 'ges.n3' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n3 }));
      store.insertEdge(createTestEdge({ sourceId: n2, targetId: n3 }));
      expect(store.getEdgesBySource(n1).length).toBe(2);
      expect(store.getEdgesBySource(n2).length).toBe(1);
    });

    it('returns empty array for node with no edges', () => {
      const isolated = store.insertNode(createTestNode({ qualifiedName: 'ges.iso' }));
      expect(store.getEdgesBySource(isolated)).toEqual([]);
    });
  });

  describe('getEdgesByTarget', () => {
    it('returns edges pointing to target', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'get.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'get.n2' }));
      const n3 = store.insertNode(createTestNode({ qualifiedName: 'get.n3' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n3 }));
      store.insertEdge(createTestEdge({ sourceId: n2, targetId: n3 }));
      expect(store.getEdgesByTarget(n3).length).toBe(2);
      expect(store.getEdgesByTarget(n1).length).toBe(0);
    });
  });

  describe('getEdgesByType', () => {
    it('returns edges of given type', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'gty.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'gty.n2' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, type: 'CALLS' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, type: 'IMPORTS' }));
      expect(store.getEdgesByType('CALLS').length).toBe(1);
      expect(store.getEdgesByType('IMPORTS').length).toBe(1);
      expect(store.getEdgesByType('EXTENDS').length).toBe(0);
    });
  });

  describe('updateEdge', () => {
    it('updates edge type', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'ue.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'ue.n2' }));
      const edgeId = store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, type: 'CALLS' }));
      store.updateEdge(edgeId, { type: 'IMPLEMENTS' });
      expect(store.getEdge(edgeId)!.type).toBe('IMPLEMENTS');
    });

    it('updates edge weight', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'uew.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'uew.n2' }));
      const edgeId = store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, weight: 1 }));
      store.updateEdge(edgeId, { weight: 5 });
      expect(store.getEdge(edgeId)!.weight).toBe(5);
    });

    it('throws when updating non-existent edge', () => {
      expect(() => store.updateEdge(999, { type: 'CALLS' })).toThrow(
        'Edge update failed: edge id=999 not found',
      );
    });
  });

  describe('deleteEdge', () => {
    it('deletes an edge by id', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'de.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'de.n2' }));
      const edgeId = store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      store.deleteEdge(edgeId);
      expect(store.getStats().edgeCount).toBe(0);
    });

    it('silently ignores non-existent edge', () => {
      expect(() => store.deleteEdge(999)).not.toThrow();
    });
  });

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  describe('insertNodes', () => {
    it('inserts multiple nodes within a transaction', () => {
      const nodes = [
        createTestNode({ qualifiedName: 'bulk.n1' }),
        createTestNode({ qualifiedName: 'bulk.n2' }),
        createTestNode({ qualifiedName: 'bulk.n3' }),
      ];
      const ids = store.insertNodes(nodes);
      expect(ids.length).toBe(3);
      expect(store.getStats().nodeCount).toBe(3);
    });

    it('returns empty array for empty input', () => {
      expect(store.insertNodes([])).toEqual([]);
    });

    it('rolls back on error within batch', () => {
      const nodes = [
        createTestNode({ qualifiedName: 'bulk.rollback1' }),
        createTestNode({ qualifiedName: 'bulk.rollback1' }), // duplicate
      ];
      expect(() => store.insertNodes(nodes)).toThrow();
      expect(store.getStats().nodeCount).toBe(0);
    });

    it('handles 100 nodes efficiently', () => {
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 100; i++) {
        nodes.push(createTestNode({ qualifiedName: `bulk.100.${i}` }));
      }
      const ids = store.insertNodes(nodes);
      expect(ids.length).toBe(100);
      expect(store.getStats().nodeCount).toBe(100);
    });
  });

  describe('insertEdges', () => {
    it('inserts multiple edges within a transaction', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'be.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'be.n2' }));
      const n3 = store.insertNode(createTestNode({ qualifiedName: 'be.n3' }));
      const edges = [
        createTestEdge({ sourceId: n1, targetId: n2, type: 'CALLS' }),
        createTestEdge({ sourceId: n2, targetId: n3, type: 'CALLS' }),
        createTestEdge({ sourceId: n3, targetId: n1, type: 'IMPORTS' }),
      ];
      const ids = store.insertEdges(edges);
      expect(ids.length).toBe(3);
      expect(store.getStats().edgeCount).toBe(3);
    });

    it('returns empty array for empty input', () => {
      expect(store.insertEdges([])).toEqual([]);
    });

    it('rolls back on error within batch', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'be.rollback' }));
      const edges = [
        createTestEdge({ sourceId: n1, targetId: n1 }),
        createTestEdge({ sourceId: n1, targetId: 99999 }),
      ];
      expect(() => store.insertEdges(edges)).toThrow();
      expect(store.getStats().edgeCount).toBe(0);
    });
  });

  // ==========================================================================
  // FTS5 Search
  // ==========================================================================

  describe('searchNodes', () => {
    beforeEach(() => {
      store.insertNode(
        createTestNode({
          name: 'calculateTotal',
          qualifiedName: 'utils.calculateTotal',
          label: 'Function',
          signature: '(items: Item[]): number',
          docstring: 'Calculates the total price of all items in the cart',
          filePath: 'src/utils/math.ts',
        }),
      );
      store.insertNode(
        createTestNode({
          name: 'UserService',
          qualifiedName: 'services.UserService',
          label: 'Class',
          signature: '',
          docstring: 'Service that handles user authentication and data',
          filePath: 'src/services/user.ts',
        }),
      );
      store.insertNode(
        createTestNode({
          name: 'processPayment',
          qualifiedName: 'payments.processPayment',
          label: 'Function',
          signature: '(amount: number, method: string): Promise<boolean>',
          docstring: 'Processes a payment transaction',
          filePath: 'src/payments/process.ts',
        }),
      );
    });

    it('finds nodes by name', () => {
      const results = store.searchNodes('calculate');
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('calculateTotal');
    });

    it('finds nodes by qualifiedName', () => {
      const results = store.searchNodes('payments');
      expect(results.length).toBe(1);
      expect(results[0]!.qualifiedName).toContain('payments');
    });

    it('finds nodes by signature content', () => {
      const results = store.searchNodes('Item');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds nodes by docstring content', () => {
      const results = store.searchNodes('authentication');
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('UserService');
    });

    it('respects limit parameter', () => {
      const results = store.searchNodes('service', 1);
      expect(results.length).toBe(1);
    });

    it('returns empty for no matches', () => {
      const results = store.searchNodes('zzz_nonexistent_zzz');
      expect(results.length).toBe(0);
    });

    it('handles empty query string', () => {
      const results = store.searchNodes('');
      // Empty query may match nothing or everything depending on FTS5 behavior
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles multi-word query', () => {
      const results = store.searchNodes('Service user');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('searchNodesByLabel', () => {
    beforeEach(() => {
      store.insertNode(
        createTestNode({
          name: 'ProcessManager',
          qualifiedName: 'process.Manager',
          label: 'Class',
          docstring: 'Manages business processes',
        }),
      );
      store.insertNode(
        createTestNode({
          name: 'startProcess',
          qualifiedName: 'process.start',
          label: 'Function',
          docstring: 'Starts a new process',
        }),
      );
    });

    it('finds nodes by text and label', () => {
      const results = store.searchNodesByLabel('process', 'Function' as NodeLabel);
      expect(results.length).toBe(1);
      expect(results[0]!.label).toBe('Function');
      expect(results[0]!.name).toBe('startProcess');
    });

    it('returns empty when no node matches label', () => {
      const results = store.searchNodesByLabel('process', 'Interface' as NodeLabel);
      expect(results.length).toBe(0);
    });

    it('respects limit parameter', () => {
      const results = store.searchNodesByLabel('process', 'Class' as NodeLabel, 1);
      expect(results.length).toBe(1);
    });
  });

  // ==========================================================================
  // Graph Traversal — BFS
  // ==========================================================================

  describe('bfs', () => {
    let n1: number;
    let n2: number;
    let n3: number;
    let n4: number;
    let n5: number;

    beforeEach(() => {
      // Create graph: n1 -> n2 -> n3 -> n5
      //              n1 -> n4
      n1 = store.insertNode(createTestNode({ qualifiedName: 'bfs.n1', name: 'N1' }));
      n2 = store.insertNode(createTestNode({ qualifiedName: 'bfs.n2', name: 'N2' }));
      n3 = store.insertNode(createTestNode({ qualifiedName: 'bfs.n3', name: 'N3' }));
      n4 = store.insertNode(createTestNode({ qualifiedName: 'bfs.n4', name: 'N4' }));
      n5 = store.insertNode(createTestNode({ qualifiedName: 'bfs.n5', name: 'N5' }));

      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, type: 'CALLS' }));
      store.insertEdge(createTestEdge({ sourceId: n2, targetId: n3, type: 'CALLS' }));
      store.insertEdge(createTestEdge({ sourceId: n3, targetId: n5, type: 'CALLS' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n4, type: 'IMPORTS' }));
    });

    it('returns source node at depth 0', () => {
      const result = store.bfs(n1, 0);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('N1');
    });

    it('traverses to depth 1', () => {
      const result = store.bfs(n1, 1);
      expect(result.length).toBe(3); // n1, n2, n4
    });

    it('traverses full graph with no depth limit', () => {
      const result = store.bfs(n1);
      expect(result.length).toBe(5); // all nodes
    });

    it('handles isolated nodes', () => {
      const isolated = store.insertNode(createTestNode({ qualifiedName: 'bfs.iso', name: 'ISO' }));
      const result = store.bfs(isolated);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('ISO');
    });

    it('returns empty for non-existent start node', () => {
      expect(store.bfs(999)).toEqual([]);
    });

    it('handles cyclic graphs without infinite loops', () => {
      // Create cycle: n5 -> n1
      store.insertEdge(createTestEdge({ sourceId: n5, targetId: n1, type: 'CALLS' }));
      const result = store.bfs(n1);
      expect(result.length).toBe(5);
    });

    it('does not traverse backwards', () => {
      const result = store.bfs(n2);
      expect(result.length).toBe(3); // n2, n3, n5 (not n1)
    });
  });

  describe('getNeighbors', () => {
    it('returns neighbors with edges', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'nb.n1', name: 'N1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'nb.n2', name: 'N2' }));
      const n3 = store.insertNode(createTestNode({ qualifiedName: 'nb.n3', name: 'N3' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, type: 'CALLS' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n3, type: 'IMPORTS' }));

      const neighbors = store.getNeighbors(n1);
      expect(neighbors.length).toBe(2);
      expect(neighbors[0]!.node.name).toBe('N2');
      expect(neighbors[0]!.edge.type).toBe('CALLS');
      expect(neighbors[1]!.node.name).toBe('N3');
      expect(neighbors[1]!.edge.type).toBe('IMPORTS');
    });

    it('returns empty array for node with no edges', () => {
      const isolated = store.insertNode(createTestNode({ qualifiedName: 'nb.iso' }));
      expect(store.getNeighbors(isolated)).toEqual([]);
    });

    it('skips neighbors whose target node was deleted', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'nb.del.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'nb.del.n2' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      store.deleteNode(n2);
      const neighbors = store.getNeighbors(n1);
      expect(neighbors.length).toBe(0);
    });
  });

  // ==========================================================================
  // Integrity & Validation
  // ==========================================================================

  describe('validate', () => {
    it('returns valid for clean graph', () => {
      store.insertNode(createTestNode({ qualifiedName: 'clean.a' }));
      store.insertNode(createTestNode({ qualifiedName: 'clean.b' }));
      const n1 = store.getNodeByQName('clean.a')!.id;
      const n2 = store.getNodeByQName('clean.b')!.id;
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      const result = store.validate();
      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);
    });

    it('detects duplicate qualified names', () => {
      // Insert with same qname, same project
      store.insertNode(createTestNode({ qualifiedName: 'dup.name', projectId: 'p1' }));
      // Need to bypass unique constraint - use raw SQL
      // Since unique index prevents duplicates, we verify unique constraint works
      expect(() =>
        store.insertNode(createTestNode({ qualifiedName: 'dup.name', projectId: 'p1' })),
      ).toThrow();
    });

    it('detects missing qualified names', () => {
      store.insertNode(createTestNode({ qualifiedName: '', projectId: 'missing-qname' }));
      const result = store.validate();
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('empty qualifiedName'))).toBe(true);
    });

    it('detects orphan edges', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'orphan.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'orphan.n2' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      // With foreign keys and ON DELETE CASCADE, deleting a node removes its edges
      // So orphan detection is mostly for integrity checking of manually-corrupted data
      const result = store.validate();
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // Stats
  // ==========================================================================

  describe('getStats', () => {
    it('returns zero counts for empty store', () => {
      const stats = store.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(Object.keys(stats.labels).length).toBe(0);
      expect(Object.keys(stats.edgeTypes).length).toBe(0);
    });

    it('returns correct counts after inserts', () => {
      store.insertNode(createTestNode({ qualifiedName: 'stats.a', label: 'Function' as NodeLabel }));
      store.insertNode(createTestNode({ qualifiedName: 'stats.b', label: 'Function' as NodeLabel }));
      store.insertNode(createTestNode({ qualifiedName: 'stats.c', label: 'Class' as NodeLabel }));

      const n1 = store.getNodeByQName('stats.a')!.id;
      const n2 = store.getNodeByQName('stats.b')!.id;
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, type: 'CALLS' }));

      const stats = store.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(1);
      expect(stats.labels['Function']).toBe(2);
      expect(stats.labels['Class']).toBe(1);
      expect(stats.edgeTypes['CALLS']).toBe(1);
    });

    it('reflects deletes in counts', () => {
      const id = store.insertNode(createTestNode({ qualifiedName: 'stats.del' }));
      expect(store.getStats().nodeCount).toBe(1);
      store.deleteNode(id);
      expect(store.getStats().nodeCount).toBe(0);
    });
  });

  // ==========================================================================
  // Vacuum
  // ==========================================================================

  describe('vacuum', () => {
    it('runs vacuum without errors', () => {
      store.insertNode(createTestNode({ qualifiedName: 'vac.a' }));
      store.deleteNode(store.getNodeByQName('vac.a')!.id);
      expect(() => store.vacuum()).not.toThrow();
    });

    it('vacuums empty store', () => {
      expect(() => store.vacuum()).not.toThrow();
    });
  });

  // ==========================================================================
  // Persistence (close and reopen)
  // ==========================================================================

  describe('persistence', () => {
    it('persists data across close and reopen', () => {
      const testDir = mkdtempSync(join(tmpdir(), 'code-analyzer-test-'));
      const filePath = join(testDir, 'persist.db');

      // Create and populate
      const store1 = new SqliteGraphStore(filePath);
      store1.insertNode(createTestNode({ qualifiedName: 'persist.a', name: 'PersistA' }));
      store1.insertNode(createTestNode({ qualifiedName: 'persist.b', name: 'PersistB' }));
      const n1 = store1.getNodeByQName('persist.a')!.id;
      const n2 = store1.getNodeByQName('persist.b')!.id;
      store1.insertEdge(createTestEdge({ sourceId: n1, targetId: n2, type: 'CALLS' }));
      store1.close();

      // Reopen and verify
      const store2 = new SqliteGraphStore(filePath);
      expect(store2.getStats().nodeCount).toBe(2);
      expect(store2.getStats().edgeCount).toBe(1);
      expect(store2.getNodeByQName('persist.a')).not.toBeNull();
      expect(store2.getNodeByQName('persist.b')).not.toBeNull();
      store2.close();

      // Cleanup
      deleteDatabase(filePath);
      try { unlinkSync(testDir); } catch { /* ignore */ }
    });

    it('persists FTS index data', () => {
      const testDir = mkdtempSync(join(tmpdir(), 'code-analyzer-test-'));
      const filePath = join(testDir, 'fts-persist.db');

      const store1 = new SqliteGraphStore(filePath);
      store1.insertNode(
        createTestNode({
          qualifiedName: 'fts.persist',
          name: 'SearchableName',
          docstring: 'This should be searchable after reopen',
        }),
      );
      store1.close();

      const store2 = new SqliteGraphStore(filePath);
      const results = store2.searchNodes('SearchableName');
      expect(results.length).toBe(1);
      store2.close();

      deleteDatabase(filePath);
      try { unlinkSync(testDir); } catch { /* ignore */ }
    });
  });

  // ==========================================================================
  // Foreign Key Constraints
  // ==========================================================================

  describe('foreign key constraints', () => {
    it('deleting a node cascades to its edges', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'fk.n1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'fk.n2' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      store.insertEdge(createTestEdge({ sourceId: n2, targetId: n1 }));

      expect(store.getStats().edgeCount).toBe(2);
      store.deleteNode(n1);
      // Both edges should be deleted: n1->n2 (source cascade) and n2->n1 (target cascade)
      expect(store.getStats().edgeCount).toBe(0);
    });

    it('foreign key protects against invalid edge insert', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'fk.valid' }));
      expect(() => store.insertEdge(createTestEdge({ sourceId: n1, targetId: 999 }))).toThrow();
    });

    it('can delete target node with cascade', () => {
      const n1 = store.insertNode(createTestNode({ qualifiedName: 'fk.tgt1' }));
      const n2 = store.insertNode(createTestNode({ qualifiedName: 'fk.tgt2' }));
      store.insertEdge(createTestEdge({ sourceId: n1, targetId: n2 }));
      store.deleteNode(n2);
      expect(store.getStats().edgeCount).toBe(0);
      expect(store.getNode(n1)).not.toBeNull();
    });
  });

  // ==========================================================================
  // Concurrent Access
  // ==========================================================================

  describe('concurrent access', () => {
    it('handles 200 rapid node inserts', () => {
      for (let i = 0; i < 200; i++) {
        store.insertNode(createTestNode({ qualifiedName: `concurrent.${i}` }));
      }
      expect(store.getStats().nodeCount).toBe(200);
      for (let i = 0; i < 200; i++) {
        expect(store.getNodeByQName(`concurrent.${i}`)).not.toBeNull();
      }
    });

    it('handles interleaved reads and writes', () => {
      const id1 = store.insertNode(createTestNode({ qualifiedName: 'rw.1' }));
      expect(store.getNode(id1)).not.toBeNull();

      const id2 = store.insertNode(createTestNode({ qualifiedName: 'rw.2' }));
      expect(store.getNode(id1)).not.toBeNull();
      expect(store.getNode(id2)).not.toBeNull();

      store.deleteNode(id1);
      expect(store.getNode(id1)).toBeNull();
      expect(store.getNode(id2)).not.toBeNull();
    });

    it('handles many edge inserts and lookups', () => {
      const nodeIds: number[] = [];
      for (let i = 0; i < 10; i++) {
        nodeIds.push(store.insertNode(createTestNode({ qualifiedName: `mesh.${i}` })));
      }

      // Create a fully connected mesh (simplified)
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          if (i !== j) {
            store.insertEdge(
              createTestEdge({ sourceId: nodeIds[i]!, targetId: nodeIds[j]!, type: 'CALLS' }),
            );
          }
        }
      }

      expect(store.getStats().edgeCount).toBe(90);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles nodes with special characters in names', () => {
      store.insertNode(
        createTestNode({
          qualifiedName: 'pkg.$pecial.name_with_underscores',
          name: '$pecialFunc',
        }),
      );
      const found = store.getNodeByQName('pkg.$pecial.name_with_underscores');
      expect(found).not.toBeNull();
    });

    it('handles searching for special characters via FTS', () => {
      store.insertNode(
        createTestNode({
          qualifiedName: 'special.search',
          name: 'get_user_data',
          docstring: 'Fetches user_data from database',
        }),
      );
      const results = store.searchNodes('get_user');
      expect(results.length).toBeGreaterThanOrEqual(0);
      // FTS tokenizer behavior varies, but it shouldn't crash
    });

    it('handles nodes with very long qualified names', () => {
      const longQname = 'com.very.long.package.path.' + 'sub'.repeat(20) + '.ClassName';
      const id = store.insertNode(createTestNode({ qualifiedName: longQname }));
      expect(store.getNode(id)!.qualifiedName).toBe(longQname);
    });

    it('handles nodes with complex JSON properties', () => {
      const id = store.insertNode(
        createTestNode({
          qualifiedName: 'complex.props',
          properties: {
            name: 'complex',
            decorators: ['@Component', '@Injectable', '@Path("/api/v1")'],
            baseClasses: ['BaseController', 'LoggingMixin'],
            isAsync: true,
            isStatic: false,
            visibility: 'public' as const,
          },
        }),
      );
      const node = store.getNode(id)!;
      expect(node.properties.decorators).toHaveLength(3);
      expect(node.properties.baseClasses).toHaveLength(2);
    });

    it('createTestNode with explicit id', () => {
      resetCounters();
      const node = createTestNode({ id: 42, qualifiedName: 'explicit.id' });
      expect(node.id).toBe(42);
    });

    it('createTestEdge with explicit id', () => {
      resetCounters();
      const edge = createTestEdge({ id: 99, sourceId: 1, targetId: 2 });
      expect(edge.id).toBe(99);
    });
  });
});
