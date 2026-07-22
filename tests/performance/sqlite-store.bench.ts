/**
 * Performance benchmarks for SqliteStore.
 * Measures throughput of critical operations under realistic workloads.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStore } from '../../packages/infra/src/storage/sqlite-store.js';
import { GraphNode, GraphEdge, NodeLabel, RelationshipType } from '../../packages/shared/src/types/graph.js';

function generateNodes(count: number, projectId = 'perf-test'): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: 0,
      projectId,
      label: i % 10 === 0 ? 'Class' as NodeLabel : 'Function' as NodeLabel,
      name: `node_${i}`,
      qualifiedName: `${projectId}::node_${i}`,
      filePath: `src/module_${i % 50}/file_${i}.ts`,
      startLine: i * 10 + 1,
      endLine: i * 10 + 15,
      language: 'typescript',
      properties: {
        returnType: 'void',
        parameterCount: i % 5,
        isAsync: i % 3 === 0,
        visibility: 'public',
      },
      signature: `function node_${i}(arg1: string, arg2: number): void`,
      docstring: `Documentation for node_${i} with detailed description`,
      complexity: i % 20,
      isExported: i % 3 === 0,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return nodes;
}

function generateEdges(nodeIds: number[], edgesPerNode: number, projectId = 'perf-test'): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const types: RelationshipType[] = ['CALLS', 'DEFINES', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS', 'REFERENCES'];
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = 0; j < edgesPerNode; j++) {
      const targetIdx = (i + j + 1) % nodeIds.length;
      edges.push({
        id: 0,
        projectId,
        sourceId: nodeIds[i]!,
        targetId: nodeIds[targetIdx]!,
        type: types[j % types.length]!,
        properties: {},
        weight: 1,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return edges;
}

describe('SqliteStore Performance', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore();
  });

  // ── Node Insert Performance ──

  it('insertNodes: 10,000 nodes in under 200ms', () => {
    const nodes = generateNodes(10_000);
    const start = performance.now();
    store.insertNodes(nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(store.getNodeCount()).toBe(10_000);
  });

  it('insertNodes: 50,000 nodes in under 1 second', () => {
    const nodes = generateNodes(50_000);
    const start = performance.now();
    store.insertNodes(nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(store.getNodeCount()).toBe(50_000);
  });

  // ── Edge Insert Performance ──

  it('insertEdges: 20,000 edges in under 300ms', () => {
    const nodes = generateNodes(5000);
    const nodeIds = store.insertNodes(nodes);
    const edges = generateEdges(nodeIds, 4);
    const start = performance.now();
    store.insertEdges(edges);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
    expect(store.getEdgeCount()).toBe(20000);
  });

  // ── Query Performance ──

  it('queryNodes: filtered search on 10K nodes under 100ms', () => {
    const nodes = generateNodes(10_000);
    store.insertNodes(nodes);
    const start = performance.now();
    const result = store.queryNodes({
      projectId: 'perf-test',
      label: 'Function' as NodeLabel,
      limit: 100,
      offset: 0,
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThanOrEqual(100);
  });

  // ── Query Performance with Pattern ──

  it('queryNodes: with name pattern on 10K nodes under 100ms', () => {
    const nodes = generateNodes(10_000);
    store.insertNodes(nodes);
    const start = performance.now();
    const result = store.queryNodes({
      projectId: 'perf-test',
      namePattern: 'node_10*',
      limit: 100,
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  // ── Edge Traversal Performance ──

  it('getEdgesForNode: retrieves edges under 5ms on dense graph', () => {
    const nodes = generateNodes(1000);
    const nodeIds = store.insertNodes(nodes);
    const edges = generateEdges(nodeIds, 10);
    store.insertEdges(edges);
    const start = performance.now();
    const result = store.getEdgesForNode(nodeIds[0]!, undefined, 'out');
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
    expect(result.length).toBeGreaterThan(0);
  });

  it('getDegree: under 1ms on dense graph', () => {
    const nodes = generateNodes(1000);
    const nodeIds = store.insertNodes(nodes);
    const edges = generateEdges(nodeIds, 10);
    store.insertEdges(edges);
    const start = performance.now();
    const degree = store.getDegree(nodeIds[0]!);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1);
    expect(degree).toBeGreaterThan(0);
  });

  // ── BFS Performance ──

  it('bfs: depth 3 on 1000 nodes under 10ms', () => {
    const nodes = generateNodes(1000);
    const nodeIds = store.insertNodes(nodes);
    const edges = generateEdges(nodeIds, 3);
    store.insertEdges(edges);
    const start = performance.now();
    const result = store.bfs(nodeIds[0]!, 3);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  // ── FTS Performance ──

  it('searchFts: on 10K nodes under 250ms', () => {
    const nodes = generateNodes(10_000);
    store.insertNodes(nodes);
    const start = performance.now();
    const results = store.searchFts('node_500', { limit: 20 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(250);
    expect(results.length).toBeGreaterThan(0);
  });

  // ── Delete Performance ──

  it('deleteNode: cascading edge deletion on dense graph under 5ms', () => {
    const nodes = generateNodes(1000);
    const nodeIds = store.insertNodes(nodes);
    const edges = generateEdges(nodeIds, 10);
    store.insertEdges(edges);
    const start = performance.now();
    store.deleteNode(nodeIds[0]!);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  // ── Transaction Performance ──

  it('transaction: rollback on 1000 inserts under 100ms', () => {
    const start = performance.now();
    try {
      store.transaction(() => {
        const nodes = generateNodes(1000);
        store.insertNodes(nodes);
        throw new Error('forced rollback');
      });
    } catch {
      // Expected
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    // State should be restored
    expect(store.getNodeCount()).toBe(0);
  });

  // ── Integrity Check Performance ──

  it('validateIntegrity: on 10K nodes + 20K edges under 100ms', () => {
    const nodes = generateNodes(10_000);
    const nodeIds = store.insertNodes(nodes);
    const edges = generateEdges(nodeIds, 2);
    store.insertEdges(edges);
    const start = performance.now();
    const report = store.validateIntegrity('perf-test');
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(report.valid).toBe(true);
  });
});
