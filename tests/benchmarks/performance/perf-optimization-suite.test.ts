// @code-analyzer — Performance Optimization Benchmark Suite
// Validates that Iteration 9 optimizations yield measurable throughput improvements.
// Covers: InMemoryGraphStore indexes, query performance, parallel parsing, search.

import { describe, it, expect, beforeAll } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, NodeLabel, RelationshipType } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createNode(id: number, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    projectId: overrides.projectId ?? 'bench-project',
    label: overrides.label ?? 'Function',
    name: overrides.name ?? `node_${id}`,
    qualifiedName: overrides.qualifiedName ?? `pkg:node_${id}`,
    filePath: overrides.filePath ?? `/src/bench/file_${id % 100}.ts`,
    startLine: overrides.startLine ?? id * 5,
    endLine: overrides.endLine ?? id * 5 + 10,
    language: overrides.language ?? 'typescript',
    properties: overrides.properties ?? {},
    signature: overrides.signature ?? `function node_${id}(a: number): void`,
    docstring: overrides.docstring ?? `Documentation for node_${id}`,
    complexity: overrides.complexity ?? id % 42,
    isExported: overrides.isExported ?? id % 3 === 0,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function populateStore(store: InMemoryGraphStore, nodeCount: number): void {
  for (let i = 0; i < nodeCount; i++) {
    const label = (['Function', 'Class', 'Method', 'Variable', 'Interface'] as NodeLabel[])[i % 5]!;
    const projectId = i < nodeCount / 2 ? 'proj-a' : 'proj-b';
    store.insertNode(createNode(i + 1, { label, projectId }));
  }
}

// ---------------------------------------------------------------------------
// Benchmark: QueryNodes with Project + Label Index vs Full Scan
// ---------------------------------------------------------------------------

describe('Performance: queryNodes with secondary indexes', () => {
  const NODE_COUNT = 5000;
  let store: InMemoryGraphStore;

  beforeAll(() => {
    store = new InMemoryGraphStore();
    populateStore(store, NODE_COUNT);
    // Insert edges for edge query tests
    for (let i = 0; i < 1000; i++) {
      store.insertEdge({
        id: i + 1,
        projectId: i < 500 ? 'proj-a' : 'proj-b',
        sourceId: i + 1,
        targetId: ((i + 100) % NODE_COUNT) + 1,
        type: (['CALLS', 'IMPORTS', 'DEFINES', 'INHERITS'] as RelationshipType[])[i % 4]!,
        properties: {},
        weight: 1,
        createdAt: new Date().toISOString(),
      });
    }
  });

  it('queryNodes by project ID should be fast (O(project_nodes) not O(total_nodes))', () => {
    const start = performance.now();
    const result = store.queryNodes({ projectId: 'proj-a', limit: 100 });
    const elapsed = performance.now() - start;

    // Should return only proj-a nodes, ~2500 of 5000 total
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(NODE_COUNT / 2 + 100); // Allow some margin
    expect(result.items.every((n) => n.projectId === 'proj-a')).toBe(true);

    // Throughput assertion: querying 5000 nodes should complete in < 50ms
    expect(elapsed).toBeLessThan(50);
  });

  it('queryNodes by project + label should use intersection optimization', () => {
    const start = performance.now();
    const result = store.queryNodes({
      projectId: 'proj-a',
      label: ['Function' as const, 'Method' as const],
      limit: 50,
    });
    const elapsed = performance.now() - start;

    expect(
      result.items.every(
        (n) => n.projectId === 'proj-a' && (n.label === 'Function' || n.label === 'Method'),
      ),
    ).toBe(true);
    expect(elapsed).toBeLessThan(30);
  });

  it('queryNodes with no project index should fallback to full scan but complete', () => {
    const start = performance.now();
    const result = store.queryNodes({
      projectId: 'NONEXISTENT',
      limit: 10,
    });
    const elapsed = performance.now() - start;

    expect(result.total).toBe(0);
    expect(elapsed).toBeLessThan(20);
  });

  it('queryEdges by sourceId should use adjacency index (not full scan)', () => {
    const start = performance.now();
    const result = store.queryEdges({ projectId: 'proj-a', sourceId: 1, limit: 10 });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(15);
  });

  it('queryEdges by type should use type index', () => {
    const start = performance.now();
    const result = store.queryEdges({
      projectId: 'proj-a',
      type: ['CALLS' as const],
      limit: 50,
    });
    const elapsed = performance.now() - start;

    expect(result.items.every((e) => e.type === 'CALLS')).toBe(true);
    expect(elapsed).toBeLessThan(20);
  });

  it('searchFts with projectId should pre-filter by project index', () => {
    const start = performance.now();
    const results = store.searchFts('node_42', {
      projectId: 'proj-a',
      limit: 5,
    });
    const elapsed = performance.now() - start;

    // Should find at least one match (node_42, node_420, node_421, etc.)
    expect(elapsed).toBeLessThan(40);
  });

  it('insertNode should maintain secondary indexes correctly', () => {
    // Verify projectNodesIndex is populated
    const projANodes = store.queryNodes({ projectId: 'proj-a', limit: 10000 });
    expect(projANodes.total).toBeGreaterThan(0);

    // Verify labelNodesIndex is populated
    const funcNodes = store.queryNodes({
      projectId: 'proj-a',
      label: 'Function',
      limit: 10000,
    });
    expect(funcNodes.total).toBeGreaterThan(0);
    expect(funcNodes.items.every((n) => n.label === 'Function')).toBe(true);
  });

  it('deleteNode should clean up secondary indexes', () => {
    const testStore = new InMemoryGraphStore();
    const node = createNode(1, { projectId: 'test', label: 'Function' });
    testStore.insertNode(node);

    expect(testStore.queryNodes({ projectId: 'test' }).total).toBe(1);
    expect(testStore.queryNodes({ projectId: 'test', label: 'Function' }).total).toBe(1);

    testStore.deleteNode(node.id);

    expect(testStore.queryNodes({ projectId: 'test' }).total).toBe(0);
    expect(testStore.queryNodes({ projectId: 'test', label: 'Function' }).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Benchmark: Optimize() should rebuild secondary indexes
// ---------------------------------------------------------------------------

describe('Performance: optimize() rebuilds secondary indexes', () => {
  it('optimize should rebuild all indexes and query still works', () => {
    const store = new InMemoryGraphStore();
    populateStore(store, 100);

    store.optimize();

    const result = store.queryNodes({ projectId: 'proj-a', limit: 50 });
    expect(result.total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Benchmark: Transaction with secondary indexes
// ---------------------------------------------------------------------------

describe('Performance: transaction rollback preserves secondary indexes', () => {
  it('rollback should restore all secondary indexes', () => {
    const store = new InMemoryGraphStore();
    const node = createNode(1, { projectId: 'test', label: 'Function' });
    store.insertNode(node);

    expect(store.queryNodes({ projectId: 'test' }).total).toBe(1);

    try {
      store.transaction(() => {
        store.insertNode(
          createNode(2, {
            projectId: 'test',
            label: 'Class',
            qualifiedName: 'pkg:duplicate',
          }),
        );
        // Force rollback by throwing
        throw new Error('Intentional rollback');
      });
    } catch {
      // Expected
    }

    // After rollback, indexes should be as before
    expect(store.queryNodes({ projectId: 'test' }).total).toBe(1);
    expect(store.queryNodes({ projectId: 'test', label: 'Class' }).total).toBe(0);
    expect(store.queryNodes({ projectId: 'test', label: 'Function' }).total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Benchmark: Memory behavior with secondary indexes
// ---------------------------------------------------------------------------

describe('Performance: memory efficiency of secondary indexes', () => {
  it('close() should clear all secondary indexes', () => {
    const store = new InMemoryGraphStore();
    populateStore(store, 100);
    store.close();

    // Query on closed store should throw
    expect(() => store.getNode(1)).toThrow('InMemoryGraphStore is closed');
  });
});
