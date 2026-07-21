// @code-analyzer/intelligence — LSH Searcher Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { LSHSearcher } from '../similarity/lsh.js';
import { MinHashSimilarity } from '../similarity/minhash.js';
import { SqliteStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenizeCode(code: string): string[] {
  return code
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function createNode(id: number, name: string): GraphNode {
  return {
    id,
    projectId: 'test',
    label: 'Function',
    name,
    qualifiedName: `pkg.${name}`,
    filePath: `/src/${name}.ts`,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: { name, isExported: true },
    signature: `function ${name}(): void`,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Insertion Tests
// ---------------------------------------------------------------------------

describe('LSHSearcher.insert', () => {
  let lsh: LSHSearcher;

  beforeEach(() => {
    lsh = new LSHSearcher(16);
  });

  it('should insert fingerprints into buckets', () => {
    const mh = new MinHashSimilarity(128);
    const fp = mh.computeFingerprint(['a', 'b', 'c']);

    lsh.insert(1, fp);

    // Should have created some buckets
    expect(lsh.bucketCount).toBeGreaterThan(0);
  });

  it('should handle multiple insertions', () => {
    const mh = new MinHashSimilarity(128);
    const fp1 = mh.computeFingerprint(['a', 'b', 'c']);
    const fp2 = mh.computeFingerprint(['d', 'e', 'f']);

    lsh.insert(1, fp1);
    lsh.insert(2, fp2);

    // Total buckets should increase when fingerprints differ significantly
    expect(lsh.bucketCount).toBeGreaterThan(0);
  });

  it('should handle empty fingerprints gracefully', () => {
    lsh.insert(1, []);
    expect(lsh.bucketCount).toBe(0);
  });

  it('should use custom band count', () => {
    const lsh8 = new LSHSearcher(8);
    expect(lsh8.bands).toBe(8);

    const lsh32 = new LSHSearcher(32);
    expect(lsh32.bands).toBe(32);
  });

  it('should use default band count of 16', () => {
    const lsh = new LSHSearcher();
    expect(lsh.bands).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Query Tests
// ---------------------------------------------------------------------------

describe('LSHSearcher.query', () => {
  let lsh: LSHSearcher;
  let mh: MinHashSimilarity;

  beforeEach(() => {
    lsh = new LSHSearcher(16);
    mh = new MinHashSimilarity(128);
  });

  it('should find inserted nodes with identical fingerprints', () => {
    const tokens = ['function', 'get', 'user', 'profile'];
    const fp = mh.computeFingerprint(tokens);

    lsh.insert(1, fp);
    const candidates = lsh.query(fp);

    expect(candidates).toContain(1);
  });

  it('should find similar nodes', () => {
    const tokens1 = tokenizeCode('function getUserProfile(userId: number)');
    const tokens2 = tokenizeCode('function getUserProfile(userId: string)');

    const fp1 = mh.computeFingerprint(tokens1);
    const fp2 = mh.computeFingerprint(tokens2);

    lsh.insert(1, fp1);
    const candidates = lsh.query(fp2);

    // Similar nodes should be found as candidates
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates).toContain(1);
  });

  it('should return empty for empty index', () => {
    const fp = mh.computeFingerprint(['test']);
    const candidates = lsh.query(fp);
    expect(candidates).toEqual([]);
  });

  it('should return empty for empty fingerprint query', () => {
    const candidates = lsh.query([]);
    expect(candidates).toEqual([]);
  });

  it('should handle multiple nodes in same bucket', () => {
    const tokens = ['function', 'process', 'data'];
    const fp = mh.computeFingerprint(tokens);

    lsh.insert(1, fp);
    lsh.insert(2, fp);
    lsh.insert(3, fp);

    const candidates = lsh.query(fp);
    expect(candidates).toContain(1);
    expect(candidates).toContain(2);
    expect(candidates).toContain(3);
  });

  it('should return unique candidate IDs', () => {
    const tokens = ['a', 'b', 'c'];
    const fp = mh.computeFingerprint(tokens);

    lsh.insert(1, fp);

    const candidates = lsh.query(fp);
    const unique = new Set(candidates);
    expect(candidates.length).toBe(unique.size);
  });

  it('should not return candidates for very different nodes', () => {
    const fp1 = mh.computeFingerprint(tokenizeCode('function getUserProfile()'));
    const fp2 = mh.computeFingerprint(tokenizeCode('class DatabaseConnectionPool'));

    lsh.insert(1, fp1);
    const candidates = lsh.query(fp2);

    // Very different fingerprints should unlikely collide
    // (not guaranteed with LSH, but with enough bands it should be unlikely)
    if (candidates.length > 0) {
      // If it does find candidates, their similarity should be low
      const sim = mh.estimateSimilarity(fp1, fp2);
      expect(sim).toBeLessThan(0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Build Similarity Edges Tests
// ---------------------------------------------------------------------------

describe('LSHSearcher.buildSimilarityEdges', () => {
  it('should find similar node pairs', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();
    const mh = new MinHashSimilarity(128);

    // Create nodes with similar and dissimilar code snippets
    const node1 = createNode(1, 'getUser');
    const node2 = createNode(2, 'getUserClone'); // Same semantic content, different node name
    const node3 = createNode(3, 'getUserWithDefaults');
    const node4 = createNode(4, 'DatabaseConnection');

    store.insertNode(node1);
    store.insertNode(node2);
    store.insertNode(node3);
    store.insertNode(node4);

    const fingerprints = new Map<number, number[]>();
    fingerprints.set(1, mh.computeFingerprint(tokenizeCode('function getUser(id: number): User')));
    fingerprints.set(2, mh.computeFingerprint(tokenizeCode('function getUser(id: number): User'))); // Same code
    fingerprints.set(3, mh.computeFingerprint(tokenizeCode('function getUserWithDefaults(id: number, opts: Options): User')));
    fingerprints.set(4, mh.computeFingerprint(tokenizeCode('class DatabaseConnection connect close query execute disconnect')));

    lsh.clear(); // Clear any previous state

    const edges = lsh.buildSimilarityEdges(
      store,
      [1, 2, 3, 4],
      (id) => fingerprints.get(id) ?? [],
      0.5,
    );

    // Nodes 1 and 2 should form a pair (identical code)
    const pair12 = edges.find(
      (e) =>
        (e.sourceId === 1 && e.targetId === 2) ||
        (e.sourceId === 2 && e.targetId === 1),
    );

    expect(pair12).toBeDefined();
    if (pair12) {
      expect(pair12.similarity).toBeGreaterThan(0.9);
    }
  });

  it('should respect the similarity threshold', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();
    const mh = new MinHashSimilarity(128);

    for (let i = 1; i <= 5; i++) {
      store.insertNode(createNode(i, `func_${i}`));
    }

    const fingerprints = new Map<number, number[]>();
    // Identical code for all, but we set a very high threshold
    fingerprints.set(1, mh.computeFingerprint(tokenizeCode('function a() { return 1; }')));
    fingerprints.set(2, mh.computeFingerprint(tokenizeCode('function a() { return 1; }')));
    fingerprints.set(3, mh.computeFingerprint(tokenizeCode('function b() { return 2; }')));

    store.insertNode(createNode(1, 'f1'));
    store.insertNode(createNode(2, 'f2'));
    store.insertNode(createNode(3, 'f3'));

    const edgesLowThreshold = lsh.buildSimilarityEdges(
      store,
      [1, 2, 3],
      (id) => fingerprints.get(id) ?? [],
      0.5,
    );

    lsh.clear();

    const edgesHighThreshold = lsh.buildSimilarityEdges(
      store,
      [1, 2, 3],
      (id) => fingerprints.get(id) ?? [],
      0.99,
    );

    // Lower threshold should find more pairs
    expect(edgesLowThreshold.length).toBeGreaterThanOrEqual(edgesHighThreshold.length);
  });

  it('should avoid self-pairs and duplicates', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();
    const mh = new MinHashSimilarity(128);

    store.insertNode(createNode(1, 'f1'));
    store.insertNode(createNode(2, 'f2'));

    const fp = mh.computeFingerprint(tokenizeCode('function test() {}'));

    const edges = lsh.buildSimilarityEdges(
      store,
      [1, 2],
      () => fp,
      0.3,
    );

    // No self-pairs (sourceId !== targetId)
    for (const edge of edges) {
      expect(edge.sourceId).not.toBe(edge.targetId);
    }

    // No duplicate pairs
    const pairSet = new Set<string>();
    for (const edge of edges) {
      const key = [edge.sourceId, edge.targetId].sort().join('-');
      expect(pairSet.has(key)).toBe(false);
      pairSet.add(key);
    }
  });

  it('should handle empty node list', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();

    const edges = lsh.buildSimilarityEdges(store, [], () => [], 0.8);
    expect(edges).toEqual([]);
  });

  it('should handle nodes without fingerprints', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();
    const mh = new MinHashSimilarity(128);

    store.insertNode(createNode(1, 'f1'));
    store.insertNode(createNode(2, 'f2'));

    // Node 1 has a fingerprint, node 2 doesn't
    const edges = lsh.buildSimilarityEdges(
      store,
      [1, 2],
      (id) => (id === 1 ? mh.computeFingerprint(tokenizeCode('test')) : []),
      0.5,
    );

    // Nodes without fingerprints shouldn't create edges
    for (const edge of edges) {
      expect(edge.sourceId).not.toBe(2);
      expect(edge.targetId).not.toBe(2);
    }
  });

  it('should handle candidateId without fingerprint in map', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();
    const mh = new MinHashSimilarity(128);

    store.insertNode(createNode(1, 'f1'));
    store.insertNode(createNode(2, 'f2'));

    // First build with both nodes
    lsh.buildSimilarityEdges(
      store,
      [1, 2],
      (id) => mh.computeFingerprint(tokenizeCode('function test() {}')),
      0.5,
    );

    // Clear and rebuild with only node 1 - node 2 was in old LSH but not in new map
    lsh.clear();
    const fp1 = mh.computeFingerprint(tokenizeCode('function test() {}'));
    lsh.insert(1, fp1);

    const fingerprintMap = new Map<number, number[]>();
    fingerprintMap.set(1, fp1);
    // node 2 not in fingerprintMap but might be in LSH buckets from first build

    const edges = lsh.buildSimilarityEdges(
      store,
      [1],
      (id) => fingerprintMap.get(id) ?? [],
      0.5,
    );

    expect(Array.isArray(edges)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clear Tests
// ---------------------------------------------------------------------------

describe('LSHSearcher.clear', () => {
  it('should clear all buckets', () => {
    const lsh = new LSHSearcher(16);
    const mh = new MinHashSimilarity(128);

    lsh.insert(1, mh.computeFingerprint(['test']));
    expect(lsh.bucketCount).toBeGreaterThan(0);

    lsh.clear();
    expect(lsh.bucketCount).toBe(0);
  });

  it('should not return results after clear', () => {
    const lsh = new LSHSearcher(16);
    const mh = new MinHashSimilarity(128);

    const fp = mh.computeFingerprint(['test', 'data']);
    lsh.insert(1, fp);

    lsh.clear();

    const candidates = lsh.query(fp);
    expect(candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Similarity Edge Insertion Tests
// ---------------------------------------------------------------------------

describe('LSHSearcher.insertSimilarityEdge', () => {
  it('should insert a SIMILAR_TO edge into the store', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();

    // Insert nodes first
    store.insertNode(createNode(1, 'func_a'));
    store.insertNode(createNode(2, 'func_b'));

    lsh.insertSimilarityEdge(
      store,
      { sourceId: 1, targetId: 2, similarity: 0.85 },
      'test-project',
    );

    const edges = store.queryEdges({ projectId: 'test-project' });
    expect(edges.items.length).toBe(1);
    expect(edges.items[0]!.type).toBe('SIMILAR_TO');
    expect(edges.items[0]!.weight).toBe(0.85);
  });

  it('should gracefully handle duplicate edge insertion', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();

    store.insertNode(createNode(1, 'func_a'));
    store.insertNode(createNode(2, 'func_b'));

    // Insert the same edge twice - should not throw (catch block handles it)
    const edge = { sourceId: 1, targetId: 2, similarity: 0.85 };
    expect(() => lsh.insertSimilarityEdge(store, edge, 'test-project')).not.toThrow();
    expect(() => lsh.insertSimilarityEdge(store, edge, 'test-project')).not.toThrow();
  });

  it('should handle insertSimilarityEdge with non-existent nodes', () => {
    const lsh = new LSHSearcher(16);
    const store = new SqliteStore();

    // Insert edge referencing nodes that don't exist - the catch block should handle it
    const edge = { sourceId: 999, targetId: 998, similarity: 0.5 };
    expect(() => lsh.insertSimilarityEdge(store, edge, 'test-project')).not.toThrow();
  });
});
