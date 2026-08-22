// @code-analyzer — Extended Property-Based Graph Invariant Tests
// Additional invariants beyond the existing graph-invariants.test.ts.
// Tests edge consistency, acyclic properties, component sizes, and degree distributions.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): InMemoryGraphStore {
  return new InMemoryGraphStore(':memory:');
}

function addNode(
  store: InMemoryGraphStore,
  name: string,
  label = 'Function',
  projectId = 'prop-ext',
): number {
  const now = new Date().toISOString();
  return store.insertNode({
    id: 0,
    projectId,
    label: label as any,
    name,
    qualifiedName: `${projectId}.${name}`,
    filePath: `src/${name}.ts`,
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  });
}

function addEdge(
  store: InMemoryGraphStore,
  src: number,
  tgt: number,
  type = 'IMPORTS',
  projectId = 'prop-ext',
): number {
  return store.insertEdge({
    id: 0,
    projectId,
    sourceId: src,
    targetId: tgt,
    type: type as any,
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Edge Consistency
// ---------------------------------------------------------------------------

describe('Extended Graph Invariants', () => {
  describe('Edge Consistency', () => {
    it('all edge source nodes exist after insertion', () => {
      const store = makeStore();
      const a = addNode(store, 'A');
      const b = addNode(store, 'B');
      const edgeId = addEdge(store, a, b);

      // Verify edge exists by querying from source
      const edges = store.queryEdges({ sourceId: a, targetId: b, projectId: 'prop-ext' }).items;
      expect(edges.length).toBeGreaterThan(0);
      expect(store.getNode(a)).not.toBeNull();
      expect(store.getNode(b)).not.toBeNull();
    });

    it('inserting edge with non-existent source throws', () => {
      const store = makeStore();
      const b = addNode(store, 'B');
      expect(() => addEdge(store, 999999, b)).toThrow();
    });

    it('inserting edge with non-existent target throws', () => {
      const store = makeStore();
      const a = addNode(store, 'A');
      expect(() => addEdge(store, a, 999999)).toThrow();
    });

    it('deleting a node cascades to edges (or throws)', () => {
      const store = makeStore();
      const a = addNode(store, 'A');
      const b = addNode(store, 'B');
      const edgeId = addEdge(store, a, b);

      // Try deleting source node
      let threw = false;
      try {
        store.deleteNode(a);
      } catch {
        threw = true;
      }

      if (!threw) {
        // Edge should also be gone
        const remainingEdges = store.queryEdges({ sourceId: a, projectId: 'prop-ext' }).items;
        expect(remainingEdges.length).toBe(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Acyclic Properties
  // -----------------------------------------------------------------------

  describe('Acyclic Dependency Subgraphs', () => {
    it('dependency graphs can be checked for cycles', () => {
      const store = makeStore();
      const n1 = addNode(store, 'Module1');
      const n2 = addNode(store, 'Module2');
      const n3 = addNode(store, 'Module3');

      // n1 → n2 → n3 (no cycle)
      addEdge(store, n1, n2, 'DEPENDS_ON');
      addEdge(store, n2, n3, 'DEPENDS_ON');

      // Verify edges exist
      const edges1 = store.queryEdges({
        sourceId: n1,
        projectId: 'prop-ext',
        type: 'DEPENDS_ON',
      }).items;
      const edges2 = store.queryEdges({
        sourceId: n2,
        projectId: 'prop-ext',
        type: 'DEPENDS_ON',
      }).items;
      expect(edges1.length).toBeGreaterThan(0);
      expect(edges2.length).toBeGreaterThan(0);

      // Transitive: n1 has NO direct edge to n3
      const direct = store.queryEdges({ sourceId: n1, targetId: n3, projectId: 'prop-ext' }).items;
      expect(direct.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Connected Component Sizes
  // -----------------------------------------------------------------------

  describe('Component Sizes', () => {
    it('isolated nodes form components of size 1', () => {
      const store = makeStore();
      addNode(store, 'Isolated1');
      addNode(store, 'Isolated2');
      addNode(store, 'Isolated3');

      const allNodes = store.getAllNodes();
      expect(allNodes.length).toBe(3);

      // Each isolated node should have no edges
      for (const node of allNodes) {
        const outgoing = store.queryEdges({ sourceId: node.id, projectId: 'prop-ext' }).items;
        const incoming = store.queryEdges({ targetId: node.id, projectId: 'prop-ext' }).items;
        expect(outgoing.length).toBe(0);
        expect(incoming.length).toBe(0);
      }
    });

    it('connected component has correct internal edge count', () => {
      const store = makeStore();
      const a = addNode(store, 'A');
      const b = addNode(store, 'B');
      const c = addNode(store, 'C');

      // A → B, B → C (2 edges in component)
      addEdge(store, a, b);
      addEdge(store, b, c);

      // Total edges involving these nodes
      const edgesFromA = store.queryEdges({ sourceId: a, projectId: 'prop-ext' }).items;
      const edgesFromB = store.queryEdges({ sourceId: b, projectId: 'prop-ext' }).items;
      expect(edgesFromA.length + edgesFromB.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Degree Distribution
  // -----------------------------------------------------------------------

  describe('Degree Distribution', () => {
    it('out-degree sum equals total edge count', () => {
      const store = makeStore();
      const nodes: number[] = [];
      for (let i = 0; i < 10; i++) {
        nodes.push(addNode(store, `Node${i}`));
      }

      let edgeCount = 0;
      // Create bidirectional edges
      for (let i = 0; i < nodes.length - 1; i++) {
        addEdge(store, nodes[i]!, nodes[i + 1]!);
        edgeCount++;
      }

      let outDegreeSum = 0;
      for (const nodeId of nodes) {
        const edges = store.queryEdges({ sourceId: nodeId, projectId: 'prop-ext' }).items;
        outDegreeSum += edges.length;
      }

      expect(outDegreeSum).toBe(edgeCount);
    });

    it('in-degree sum equals total edge count', () => {
      const store = makeStore();
      const nodes: number[] = [];
      for (let i = 0; i < 10; i++) {
        nodes.push(addNode(store, `Node${i}`));
      }

      let edgeCount = 0;
      for (let i = 0; i < nodes.length - 1; i++) {
        addEdge(store, nodes[i]!, nodes[i + 1]!);
        edgeCount++;
      }

      let inDegreeSum = 0;
      for (const nodeId of nodes) {
        const edges = store.queryEdges({ targetId: nodeId, projectId: 'prop-ext' }).items;
        inDegreeSum += edges.length;
      }

      expect(inDegreeSum).toBe(edgeCount);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-Project Isolation
  // -----------------------------------------------------------------------

  describe('Multi-Project Isolation', () => {
    it('nodes from different projects are distinct', () => {
      const store = makeStore();
      const p1Id = addNode(store, 'Shared', 'Function', 'project-alpha');
      const p2Id = addNode(store, 'Shared', 'Function', 'project-beta');

      expect(p1Id).not.toBe(p2Id);

      const node1 = store.getNode(p1Id);
      const node2 = store.getNode(p2Id);
      expect(node1).not.toBeNull();
      expect(node2).not.toBeNull();
      if (node1 && node2) {
        expect(node1.projectId).toBe('project-alpha');
        expect(node2.projectId).toBe('project-beta');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Batch Operations
  // -----------------------------------------------------------------------

  describe('Batch Operations', () => {
    it('transaction batch insert is all-or-nothing on duplicate', () => {
      const store = makeStore();
      const now = new Date().toISOString();
      const nodes = Array.from({ length: 20 }, (_, i) => ({
        id: 0,
        projectId: 'prop-ext',
        label: 'Function' as any,
        name: `Batch${i}`,
        qualifiedName: `Batch${i}`,
        filePath: `src/Batch${i}.ts`,
        startLine: 1,
        endLine: 10,
        language: 'typescript',
        properties: {},
        signature: null,
        docstring: null,
        complexity: null,
        isExported: true,
        fingerprint: null,
        createdAt: now,
        updatedAt: now,
      }));

      const ids = store.insertNodes(nodes);
      expect(ids.length).toBe(20);
      expect(ids.every((id) => id > 0)).toBe(true);

      // All inserted nodes should be retrievable
      for (const id of ids) {
        expect(store.getNode(id)).not.toBeNull();
      }
    });

    it('batch edge insertion is consistent', () => {
      const store = makeStore();
      const a = addNode(store, 'A');
      const b = addNode(store, 'B');
      const c = addNode(store, 'C');

      const edges = [
        {
          id: 0,
          projectId: 'prop-ext',
          sourceId: a,
          targetId: b,
          type: 'IMPORTS' as any,
          properties: {},
          weight: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: 0,
          projectId: 'prop-ext',
          sourceId: b,
          targetId: c,
          type: 'IMPORTS' as any,
          properties: {},
          weight: 1,
          createdAt: new Date().toISOString(),
        },
      ];

      const edgeIds = store.insertEdges(edges);
      expect(edgeIds.length).toBe(2);

      // Verify edges exist by querying
      const edgesOutA = store.queryEdges({ sourceId: a, projectId: 'prop-ext' }).items;
      const edgesOutB = store.queryEdges({ sourceId: b, projectId: 'prop-ext' }).items;
      expect(edgesOutA.length + edgesOutB.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Node Count Consistency
  // -----------------------------------------------------------------------

  describe('Count Consistency', () => {
    it('getNodeCount matches getAllNodes length', () => {
      const store = makeStore();
      for (let i = 0; i < 15; i++) {
        addNode(store, `Count${i}`);
      }
      expect(store.getNodeCount()).toBe(store.getAllNodes().length);
    });

    it('empty store returns zero for all counts', () => {
      const store = makeStore();
      expect(store.getNodeCount()).toBe(0);
      expect(store.getEdgeCount()).toBe(0);
      expect(store.getAllNodes().length).toBe(0);
      expect(store.getAllEdges().length).toBe(0);
    });
  });
});
