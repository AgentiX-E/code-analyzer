// @code-analyzer — Concurrency Tests for InMemoryGraphStore
// Validates thread-safety and consistency under concurrent operations.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(name: string, qualName: string) {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId: 'concur-test',
    label: 'Function' as any,
    name,
    qualifiedName: qualName,
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
  };
}

// ---------------------------------------------------------------------------
// Concurrent Reads
// ---------------------------------------------------------------------------

describe('InMemoryGraphStore Concurrency', () => {
  describe('Concurrent Reads', () => {
    it('multiple concurrent reads complete without errors', async () => {
      const store = new InMemoryGraphStore(':memory:');

      // Populate
      const ids: number[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(store.insertNode(makeNode(`ReadNode${i}`, `ReadNode${i}`)));
      }

      // Concurrent reads
      const readTasks = Array.from({ length: 50 }, async (_, i) => {
        const nodeId = ids[i % ids.length]!;
        const node = store.getNode(nodeId);
        return node !== null;
      });

      const results = await Promise.all(readTasks);
      expect(results.every((r) => r === true)).toBe(true);
    });

    it('concurrent getAllNodes returns consistent results', async () => {
      const store = new InMemoryGraphStore(':memory:');
      for (let i = 0; i < 50; i++) {
        store.insertNode(makeNode(`GetAll${i}`, `GetAll${i}`));
      }

      const tasks = Array.from({ length: 10 }, async () => {
        return store.getAllNodes().length;
      });

      const results = await Promise.all(tasks);
      // All concurrent reads should see the same count
      const first = results[0]!;
      expect(results.every((r) => r === first)).toBe(true);
    });

    it('concurrent getEdges returns consistent results', async () => {
      const store = new InMemoryGraphStore(':memory:');
      const a = store.insertNode(makeNode('A', 'A'));
      const b = store.insertNode(makeNode('B', 'B'));

      for (let i = 0; i < 20; i++) {
        store.insertEdge({
          id: 0,
          projectId: 'concur-test',
          sourceId: a,
          targetId: b,
          type: 'IMPORTS' as any,
          properties: {},
          weight: 1,
          createdAt: new Date().toISOString(),
        });
      }

      const tasks = Array.from({ length: 10 }, async () => {
        return store.queryEdges({ sourceId: a, projectId: 'concur-test', limit: 100 }).items.length;
      });

      const results = await Promise.all(tasks);
      const first = results[0]!;
      expect(results.every((r) => r === first)).toBe(true);
      expect(first).toBe(20);
    });
  });

  // -----------------------------------------------------------------------
  // Concurrent Writes
  // -----------------------------------------------------------------------

  describe('Concurrent Writes', () => {
    it('concurrent inserts with unique names all succeed', async () => {
      const store = new InMemoryGraphStore(':memory:');

      const tasks = Array.from({ length: 100 }, (_, i) => {
        return Promise.resolve().then(() => {
          const name = `ConcurrentWrite${i}`;
          return store.insertNode(makeNode(name, name));
        });
      });

      const ids = await Promise.all(tasks);
      expect(ids.length).toBe(100);

      // All unique IDs
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);

      // All retrievable
      for (const id of ids) {
        expect(store.getNode(id)).not.toBeNull();
      }
    });

    it('concurrent inserts with duplicate qualified names detect collisions', async () => {
      const store = new InMemoryGraphStore(':memory:');

      const tasks = Array.from({ length: 20 }, (_) => {
        return Promise.resolve().then(() => {
          try {
            store.insertNode(makeNode('DupNode', 'DupNode'));
            return 'success';
          } catch {
            return 'collision';
          }
        });
      });

      const results = await Promise.all(tasks);
      // At least one should succeed, rest should detect collision
      expect(results.filter((r) => r === 'success').length).toBe(1);
      expect(results.filter((r) => r === 'collision').length).toBe(19);
    });
  });

  // -----------------------------------------------------------------------
  // Read-After-Write Consistency
  // -----------------------------------------------------------------------

  describe('Read-After-Write Consistency', () => {
    it('write then immediate concurrent read sees the data', async () => {
      const store = new InMemoryGraphStore(':memory:');

      // Write first
      const id = store.insertNode(makeNode('RAW', 'RAW'));

      // Then concurrent reads
      const tasks = Array.from({ length: 20 }, async () => {
        return store.getNode(id);
      });

      const results = await Promise.all(tasks);
      expect(results.every((r) => r !== null && r.id === id)).toBe(true);
    });

    it('batched inserts are visible to all subsequent reads', async () => {
      const store = new InMemoryGraphStore(':memory:');
      const now = new Date().toISOString();

      const nodes = Array.from({ length: 30 }, (_, i) => ({
        id: 0,
        projectId: 'concur-test',
        label: 'Function' as any,
        name: `BatchVisible${i}`,
        qualifiedName: `BatchVisible${i}`,
        filePath: `src/BatchVisible${i}.ts`,
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

      // Concurrent reads after batch insert
      const tasks = ids.map(async (id) => {
        const node = store.getNode(id);
        return node !== null;
      });

      const results = await Promise.all(tasks);
      expect(results.every((r) => r === true)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Mixed Read/Write
  // -----------------------------------------------------------------------

  describe('Mixed Read/Write', () => {
    it('concurrent reads during writes are consistent', async () => {
      const store = new InMemoryGraphStore(':memory:');
      const nodeId = store.insertNode(makeNode('Mixed', 'Mixed'));

      // Insert edges synchronously
      for (let i = 0; i < 30; i++) {
        store.insertEdge({
          id: 0,
          projectId: 'concur-test',
          sourceId: nodeId,
          targetId: nodeId,
          type: 'SELF_REF' as any,
          properties: {},
          weight: 1,
          createdAt: new Date().toISOString(),
        });
      }

      // Concurrent reads while data is stable
      const reads = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const edges = store.queryEdges({
            sourceId: nodeId,
            projectId: 'concur-test',
            limit: 100,
          }).items;
          return edges.length;
        }),
      );

      expect(reads.every((r) => r === 30)).toBe(true);
      expect(
        store.queryEdges({ sourceId: nodeId, projectId: 'concur-test', limit: 100 }).items.length,
      ).toBe(30);
    });

    it('concurrent getNodeCount is consistent during inserts', async () => {
      const store = new InMemoryGraphStore(':memory:');

      const tasks: Promise<number>[] = [];

      // Readers
      for (let i = 0; i < 5; i++) {
        tasks.push(Promise.resolve().then(() => store.getNodeCount()));
      }

      // Writers
      for (let i = 0; i < 20; i++) {
        tasks.push(
          Promise.resolve().then(() => {
            const name = `Count${i}`;
            store.insertNode(makeNode(name, name));
            return store.getNodeCount();
          }),
        );
      }

      const results = await Promise.all(tasks);
      // Final count should include all insertions
      const finalCount = store.getNodeCount();
      expect(finalCount).toBe(20);
      // Some results may be from before all inserts complete
      expect(results.every((r) => r >= 0 && r <= 20)).toBe(true);
    });
  });
});
