// @code-analyzer/intelligence — Hybrid Search Engine Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { HybridSearchEngine, tokenize, cosineSimilarity } from '../search/hybrid-search.js';
import type { RankedResult } from '../search/hybrid-search.js';
import { SqliteStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createNode(id: number, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    projectId: 'test-project',
    label: 'Function',
    name: `function_${id}`,
    qualifiedName: `pkg.function_${id}`,
    filePath: `/src/file_${id}.ts`,
    startLine: id * 10,
    endLine: id * 10 + 5,
    language: 'typescript',
    properties: {
      name: `function_${id}`,
      isExported: id % 2 === 0,
    },
    signature: `function function_${id}(x${id}: number): number`,
    docstring: `Documentation for function_${id}`,
    complexity: id * 2,
    isExported: id % 2 === 0,
    fingerprint: `fp_${id}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createStore(): SqliteStore {
  const store = new SqliteStore();
  for (let i = 1; i <= 10; i++) {
    store.insertNode(createNode(i));
  }
  return store;
}

// ---------------------------------------------------------------------------
// Tokenization Tests
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('should split camelCase identifiers', () => {
    expect(tokenize('getUserProfile')).toEqual(['get', 'user', 'profile']);
    expect(tokenize('DBConnectionPool')).toEqual(['db', 'connection', 'pool']);
    expect(tokenize('parseHTMLDocument')).toEqual(['parse', 'html', 'document']);
  });

  it('should split snake_case identifiers', () => {
    expect(tokenize('process_request')).toEqual(['process', 'request']);
    expect(tokenize('MAX_BUFFER_SIZE')).toEqual(['max', 'buffer', 'size']);
  });

  it('should split kebab-case identifiers', () => {
    expect(tokenize('my-component')).toEqual(['my', 'component']);
    expect(tokenize('user-profile-form')).toEqual(['user', 'profile', 'form']);
  });

  it('should handle mixed styles', () => {
    expect(tokenize('getUserAuth_token')).toEqual(['get', 'user', 'auth', 'token']);
    expect(tokenize('OrderProcessor-test')).toEqual(['order', 'processor', 'test']);
  });

  it('should handle empty strings', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('should convert to lowercase', () => {
    expect(tokenize('ClassName')).toEqual(['class', 'name']);
  });

  it('should handle single words', () => {
    expect(tokenize('value')).toEqual(['value']);
  });
});

// ---------------------------------------------------------------------------
// Cosine Similarity Tests
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should handle normalized vectors', () => {
    const a = new Float32Array([0.6, 0.8, 0]);
    const b = new Float32Array([0.8, 0.6, 0]);
    const expected = 0.6 * 0.8 + 0.8 * 0.6; // 0.96
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 5);
  });

  it('should throw on dimension mismatch', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2]);
    expect(() => cosineSimilarity(a, b)).toThrow('dimension mismatch');
  });

  it('should return 0 for zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BM25 Search Tests
// ---------------------------------------------------------------------------

describe('HybridSearchEngine.bm25Search', () => {
  let engine: HybridSearchEngine;

  beforeEach(() => {
    const store = createStore();
    engine = new HybridSearchEngine(store);
    engine.initialize();
  });

  it('should find nodes by name match', () => {
    const results = engine.bm25Search('function_1');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.node.name).toBe('function_1');
  });

  it('should return empty array for no match', () => {
    const results = engine.bm25Search('xyznonexistent');
    expect(results).toEqual([]);
  });

  it('should rank results by BM25 score', () => {
    // Query that matches multiple nodes
    const results = engine.bm25Search('function');
    expect(results.length).toBeGreaterThan(1);
    // Scores should decrease
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
    }
  });

  it('should filter by labels', () => {
    const results = engine.bm25Search('function', {
      labels: ['Function' as const],
    });
    expect(results.every((r) => r.node.label === 'Function')).toBe(true);
  });

  it('should filter by export status', () => {
    const results = engine.bm25Search('function', { isExported: true });
    expect(results.every((r) => r.node.isExported === true)).toBe(true);
  });

  it('should filter by file pattern', () => {
    const results = engine.bm25Search('function', {
      filePattern: '*file_1.ts',
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.node.filePath?.includes('file_1.ts'))).toBe(true);
  });

  it('should filter by complexity range', () => {
    const results = engine.bm25Search('function', { minComplexity: 10 });
    expect(results.every((r) => (r.node.complexity ?? 0) >= 10)).toBe(true);

    const results2 = engine.bm25Search('function', { maxComplexity: 4 });
    expect(results2.every((r) => (r.node.complexity ?? Infinity) <= 4)).toBe(true);
  });

  it('should handle filters with no matches', () => {
    const results = engine.bm25Search('function', {
      labels: ['Class' as const],
    });
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RRF Fusion Tests
// ---------------------------------------------------------------------------

describe('HybridSearchEngine.fuseResults', () => {
  let engine: HybridSearchEngine;

  beforeEach(() => {
    const store = createStore();
    engine = new HybridSearchEngine(store);
  });

  it('should combine BM25 and vector results using RRF', () => {
    const nodes: GraphNode[] = [
      createNode(1, { name: 'getUser' }),
      createNode(2, { name: 'getAccount' }),
      createNode(3, { name: 'getProfile' }),
    ];

    const bm25Results: RankedResult[] = [
      { node: nodes[0]!, score: 10 },
      { node: nodes[2]!, score: 5 },
    ];

    const vectorResults: RankedResult[] = [
      { node: nodes[1]!, score: 0.95 },
      { node: nodes[0]!, score: 0.8 },
    ];

    const fused = engine.fuseResults(bm25Results, vectorResults, 60);

    // Node 1 appears in both lists, should have highest combined score
    expect(fused.length).toBe(3);
    expect(fused[0]!.node.id).toBe(1); // Appears in both
  });

  it('should handle empty results', () => {
    const fused = engine.fuseResults([], []);
    expect(fused).toEqual([]);
  });

  it('should handle only BM25 results', () => {
    const nodes: GraphNode[] = [createNode(1), createNode(2)];
    const bm25Results: RankedResult[] = [
      { node: nodes[0]!, score: 10 },
      { node: nodes[1]!, score: 5 },
    ];

    const fused = engine.fuseResults(bm25Results, []);

    expect(fused.length).toBe(2);
    expect(fused[0]!.bm25Score).toBeGreaterThan(0);
    expect(fused[0]!.vectorScore).toBe(0);
    expect(fused[0]!.combinedScore).toBeGreaterThan(0);
  });

  it('should handle only vector results', () => {
    const nodes: GraphNode[] = [createNode(1), createNode(2)];
    const vectorResults: RankedResult[] = [
      { node: nodes[0]!, score: 0.95 },
      { node: nodes[1]!, score: 0.85 },
    ];

    const fused = engine.fuseResults([], vectorResults);

    expect(fused.length).toBe(2);
    expect(fused[0]!.bm25Score).toBe(0);
    expect(fused[0]!.vectorScore).toBeGreaterThan(0);
  });

  it('should respect the limit parameter', () => {
    const nodeList: GraphNode[] = Array.from({ length: 10 }, (_, i) => createNode(i + 1));
    const results: RankedResult[] = nodeList.map((n) => ({ node: n, score: 1 }));

    const fused = engine.fuseResults(results, results, 60, 5);
    expect(fused.length).toBe(5);
  });

  it('should give higher rank to items appearing earlier', () => {
    const nodes: GraphNode[] = [createNode(1), createNode(2)];
    const bm25: RankedResult[] = [{ node: nodes[0]!, score: 10 }];
    const vec: RankedResult[] = [{ node: nodes[1]!, score: 0.95 }];

    // If ranks are equal, combined score should be the same
    const fused = engine.fuseResults(bm25, vec, 60);
    expect(fused.length).toBe(2);
    // Both get RRF = 1/(60+1) since rank=1
    expect(fused[0]!.combinedScore).toBeCloseTo(fused[1]!.combinedScore, 10);
  });
});

// ---------------------------------------------------------------------------
// Hybrid Search Tests
// ---------------------------------------------------------------------------

describe('HybridSearchEngine.search', () => {
  it('should return BM25-only results when no embeddings registered', async () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const results = await engine.search({ query: 'function_1' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.bm25Score).toBeGreaterThan(0);
    expect(results[0]!.vectorScore).toBe(0);
  });

  it('should handle limit parameter', async () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const results = await engine.search({ query: 'function', limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should handle no results gracefully', async () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    // Use a term that tokenizes to something entirely absent
    const results = await engine.search({ query: 'xyzzydoodah_bogus_term_999' });
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Index Management Tests
// ---------------------------------------------------------------------------

describe('HybridSearchEngine index management', () => {
  it('should allow adding new nodes', () => {
    const store = new SqliteStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    expect(engine.documentCount).toBe(0);

    const node = createNode(1);
    store.insertNode(node);
    engine.refreshNode(node);

    expect(engine.documentCount).toBe(1);
  });

  it('should allow removing nodes', () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const count = engine.documentCount;
    engine.removeNode(1);

    expect(engine.documentCount).toBe(count - 1);
  });

  it('should support rebuild', () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();
    engine.rebuildIndex();

    expect(engine.documentCount).toBe(10);
  });
});
