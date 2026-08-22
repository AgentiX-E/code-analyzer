// @code-analyzer/infra — Query Benchmark Suite
// Performance measurements for graph store operations.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '../../storage/in-memory-graph-store.js';
import { NodeIndex } from '../../storage/graph-index.js';
import type { GraphNode, NodeLabel } from '@code-analyzer/shared';

function createTestNode(id: number, projectId?: string): GraphNode {
  return {
    id,
    label: (id % 10 === 0 ? 'Class' : 'Function') as NodeLabel,
    name: `node_${id}`,
    qualifiedName: `pkg::node_${id}`,
    projectId: projectId ?? 'test/project',
    filePath: `src/file_${id % 100}.ts`,
    startLine: id,
    endLine: id + 5,
    complexity: id % 20,
    isExported: id % 3 === 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    properties: {} as Record<string, unknown>,
  };
}

describe('Performance — Node Insertion', () => {
  it('should insert 1K nodes in under 200ms', () => {
    const store = new InMemoryGraphStore();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) store.insertNode(createTestNode(i));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(store.getNodeCount()).toBe(1000);
  });

  it('should achieve >5K nodes/sec throughput', () => {
    const store = new InMemoryGraphStore();
    const count = 5000;
    const start = performance.now();
    for (let i = 0; i < count; i++) store.insertNode(createTestNode(i));
    const elapsed = performance.now() - start;
    const throughput = count / (elapsed / 1000);
    expect(throughput).toBeGreaterThan(5000);
  });
});

describe('Performance — Node Lookup', () => {
  it('should retrieve single node from 1K set quickly', () => {
    const store = new InMemoryGraphStore();
    for (let i = 0; i < 1000; i++) store.insertNode(createTestNode(i));
    const start = performance.now();
    const node = store.getNode(500);
    const elapsed = performance.now() - start;
    expect(node).toBeDefined();
    expect(elapsed).toBeLessThan(5);
  });

  it('should return null for non-existent node quickly', () => {
    const store = new InMemoryGraphStore();
    for (let i = 0; i < 100; i++) store.insertNode(createTestNode(i));
    const start = performance.now();
    const node = store.getNode(99999);
    const elapsed = performance.now() - start;
    expect(node).toBeNull();
    expect(elapsed).toBeLessThan(5);
  });
});

describe('Performance — Query', () => {
  it('should query by project quickly', () => {
    const store = new InMemoryGraphStore();
    for (let i = 0; i < 10000; i++) store.insertNode(createTestNode(i, 'my-project'));
    const start = performance.now();
    const result = store.queryNodes({ projectId: 'my-project', limit: 50, offset: 0 });
    const elapsed = performance.now() - start;
    expect(result.items.length).toBe(50);
    expect(elapsed).toBeLessThan(30);
  });
});

describe('Performance — NodeIndex', () => {
  it('should index 10K nodes', () => {
    const idx = new NodeIndex();
    const nodes = Array.from({ length: 10000 }, (_, i) => createTestNode(i));
    const start = performance.now();
    idx.bulkAdd(nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(idx.getStats().totalNodes).toBe(10000);
  });

  it('should lookup by name in under 5ms', () => {
    const idx = new NodeIndex();
    for (let i = 0; i < 1000; i++) idx.add(createTestNode(i));
    const start = performance.now();
    const results = idx.findByName('node_500');
    const elapsed = performance.now() - start;
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5);
  });

  it('should maintain after mixed operations', () => {
    const idx = new NodeIndex();
    idx.bulkAdd([
      createTestNode(1),
      createTestNode(2),
      createTestNode(3),
      createTestNode(4),
      createTestNode(5),
    ]);
    idx.remove(2);
    idx.remove(4);
    idx.add(createTestNode(6));
    expect(idx.getStats().totalNodes).toBe(4);
  });
});

describe('Performance — Memory Under Load', () => {
  it('should handle 50K nodes', () => {
    const store = new InMemoryGraphStore();
    for (let i = 0; i < 50000; i++) store.insertNode(createTestNode(i));
    expect(store.getNodeCount()).toBe(50000);
    const node = store.getNode(1);
    expect(node).toBeDefined();
  });
});
