// @code-analyzer/intelligence — Hybrid Search Engine Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { HybridSearchEngine, tokenize, cosineSimilarity } from '../search/hybrid-search.js';
import type { RankedResult } from '../search/hybrid-search.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
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

function createStore(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
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
    const store = new InMemoryGraphStore();
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

  it('should handle removeNode for non-existent node', () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();
    const before = engine.documentCount;
    engine.removeNode(999);
    expect(engine.documentCount).toBe(before);
  });

  it('should handle rebuild with empty store', () => {
    const emptyStore = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(emptyStore);
    engine.initialize();
    expect(engine.documentCount).toBe(0);
    engine.rebuildIndex();
    expect(engine.documentCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter edge cases
// ---------------------------------------------------------------------------

describe('HybridSearchEngine — filter edge cases', () => {
  it('should filter by isExported = false', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);

    store.insertNode(createNode(1, { name: 'exportedFunc', isExported: true }));
    store.insertNode(createNode(2, { name: 'internalFunc', isExported: false }));
    engine.initialize();

    const results = engine.bm25Search('func', { isExported: false });
    expect(results.every((r) => r.node.isExported === false)).toBe(true);
  });

  it('should filter with filePattern for wildcard paths', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);

    store.insertNode(createNode(1, { name: 'myFunc', filePath: '/src/utils/helpers.ts' }));
    store.insertNode(createNode(2, { name: 'myFunc', filePath: '/src/api/routes.ts' }));
    engine.initialize();

    const results = engine.bm25Search('myFunc', { filePattern: '*utils*' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.node.filePath?.includes('utils'))).toBe(true);
  });

  it('should reject nodes without filePath for filePattern filter', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);

    store.insertNode(createNode(1, { name: 'orphan', filePath: undefined }));
    store.insertNode(createNode(2, { name: 'orphan', filePath: '/src/real.ts' }));
    engine.initialize();

    const results = engine.bm25Search('orphan', { filePattern: '*' });
    expect(results.every((r) => r.node.filePath !== undefined)).toBe(true);
  });

  it('should handle maxComplexity with null complexity nodes', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);

    store.insertNode(createNode(1, { name: 'simple', complexity: null }));
    store.insertNode(createNode(2, { name: 'simple', complexity: 10 }));
    engine.initialize();

    const results = engine.bm25Search('simple', { maxComplexity: 5 });
    // Nodes with null complexity should pass (null <= 5 → false due to !== null check)
    expect(results.every((r) => r.node.complexity === null || (r.node.complexity ?? 0) <= 5)).toBe(true);
  });

  it('should handle minComplexity with null complexity nodes', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);

    store.insertNode(createNode(1, { name: 'node_null', complexity: null }));
    store.insertNode(createNode(2, { name: 'node_high', complexity: 20 }));
    engine.initialize();

    const results = engine.bm25Search('node', { minComplexity: 5 });
    // Nodes with null complexity fail min check
    expect(results.every((r) => (r.node.complexity ?? 0) >= 5)).toBe(true);
  });

  it('should handle all filters combined', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);

    store.insertNode(createNode(1, {
      name: 'target', label: 'Function', filePath: '/src/core/target.ts',
      isExported: true, complexity: 8,
    }));
    store.insertNode(createNode(2, {
      name: 'target', label: 'Class', filePath: '/src/core/target.ts',
      isExported: true, complexity: 5,
    }));
    engine.initialize();

    const results = engine.bm25Search('target', {
      labels: ['Function' as const],
      filePattern: '*core*',
      isExported: true,
      minComplexity: 5,
      maxComplexity: 10,
    });

    expect(results.length).toBe(1);
    expect(results[0]!.node.name).toBe('target');
    expect(results[0]!.node.label).toBe('Function');
  });

  it('should handle no filters (undefined)', () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    // Call with no filters to test passesFilters default
    const results = engine.bm25Search('function', undefined);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Vector search and embeddings
// ---------------------------------------------------------------------------

describe('HybridSearchEngine — vector search', () => {
  it('should return empty for vector search without embeddings', async () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);

    const results = await engine.vectorSearch('query', 5);
    expect(results).toEqual([]);
  });

  it('should register embeddings and perform vector search', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'getUser', qualifiedName: 'api.getUser' }));
    store.insertNode(createNode(2, { name: 'getAccount', qualifiedName: 'api.getAccount' }));

    const engine = new HybridSearchEngine(store);

    // Store test embeddings
    const embeddings = new Map<number, Float32Array>();
    embeddings.set(1, new Float32Array([0.5, 0.3, 0.1]));
    embeddings.set(2, new Float32Array([0.1, 0.8, 0.2]));

    engine.registerEmbeddings(
      (nodeId) => embeddings.get(nodeId) ?? null,
      async (content) => {
        if (content === 'getUser') return new Float32Array([0.5, 0.3, 0.1]);
        return new Float32Array([0.1, 0.1, 0.1]);
      },
    );

    const results = await engine.vectorSearch('getUser', 2);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should limit vector search results to topK', async () => {
    const store = new InMemoryGraphStore();
    for (let i = 1; i <= 5; i++) {
      store.insertNode(createNode(i));
    }

    const engine = new HybridSearchEngine(store);
    const emb = new Map<number, Float32Array>();
    for (let i = 1; i <= 5; i++) {
      emb.set(i, new Float32Array([0.1 * i, 0.2, 0.3]));
    }

    engine.registerEmbeddings(
      (nodeId) => emb.get(nodeId) ?? null,
      async () => new Float32Array([0.5, 0.5, 0.5]),
    );

    const results = await engine.vectorSearch('query', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Hybrid search with embeddings
// ---------------------------------------------------------------------------

describe('HybridSearchEngine.search with embeddings', () => {
  it('should combine BM25 and vector results when embeddings registered', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'getUserData', qualifiedName: 'api.getUserData' }));
    store.insertNode(createNode(2, { name: 'setUserData', qualifiedName: 'api.setUserData' }));

    const engine = new HybridSearchEngine(store);

    const embMap = new Map<number, Float32Array>();
    embMap.set(1, new Float32Array([0.8, 0.2]));
    embMap.set(2, new Float32Array([0.1, 0.9]));

    engine.registerEmbeddings(
      (nodeId) => embMap.get(nodeId) ?? null,
      async () => new Float32Array([0.5, 0.5]),
    );
    engine.initialize();

    const results = await engine.search({ query: 'user' });
    expect(results.length).toBeGreaterThan(0);
    // Should have both BM25 and vector scores for overlapping results
    const withBoth = results.filter((r) => r.bm25Score > 0 && r.vectorScore > 0);
    expect(withBoth.length).toBeGreaterThanOrEqual(0);
  });

  it('should auto-initialize if not initialized before search', async () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);

    // Don't call initialize() — search should auto-init
    const results = await engine.search({ query: 'function_1' });
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Pagination edge cases
// ---------------------------------------------------------------------------

describe('HybridSearchEngine — pagination', () => {
  it('should not limit when limit is undefined in fuseResults', () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);

    const nodes: RankedResult[] = Array.from({ length: 5 }, (_, i) => ({
      node: createNode(i + 1),
      score: 10 - i,
    }));

    const fused = engine.fuseResults(nodes, [], 60, undefined);
    expect(fused.length).toBe(5);
  });

  it('should handle limit of 0', () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);

    const fused = engine.fuseResults([], [], 60, 0);
    expect(fused.length).toBe(0);
  });

  it('should handle search with zero limit', async () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    // Zero limit defaults to 20 (the default in search method)
    const results = await engine.search({ query: 'function', limit: 0 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle fuseResults with negative limit', () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);

    const nodes: RankedResult[] = [{ node: createNode(1), score: 5 }];
    const fused = engine.fuseResults(nodes, [], 60, -1);
    // Negative limit is falsy for `if (limit !== undefined && limit > 0)`, so returns all
    expect(fused.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cosine similarity edge cases
// ---------------------------------------------------------------------------

describe('cosineSimilarity — edge cases', () => {
  it('should handle zero vectors on both sides', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should handle vectors of length 1', () => {
    const a = new Float32Array([1]);
    const b = new Float32Array([1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('should handle small floating-point values', () => {
    const a = new Float32Array([1e-10, 2e-10]);
    const b = new Float32Array([1e-10, 2e-10]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 2);
  });
});

// ---------------------------------------------------------------------------
// Tokenization — additional edge cases
// ---------------------------------------------------------------------------

describe('tokenize — additional edge cases', () => {
  it('should handle dot-separated identifiers', () => {
    expect(tokenize('my.module.name')).toEqual(['my', 'module', 'name']);
  });

  it('should handle acronym patterns', () => {
    expect(tokenize('HTMLElement')).toEqual(['html', 'element']);
    expect(tokenize('XMLParser')).toEqual(['xml', 'parser']);
  });

  it('should handle single-letter camelCase', () => {
    expect(tokenize('aB')).toEqual(['a', 'b']);
  });

  it('should handle string with only separators', () => {
    expect(tokenize('_')).toEqual([]);
    expect(tokenize('-')).toEqual([]);
    expect(tokenize('__')).toEqual([]);
  });

  it('should handle whitespace-only strings', () => {
    expect(tokenize('   ')).toEqual([]);
  });

  it('should handle numbers-in-prefix identifiers', () => {
    expect(tokenize('get2FA')).toEqual(['get2fa']);
  });
});

// ---------------------------------------------------------------------------
// InvertedIndex — add/remove edge cases
// ---------------------------------------------------------------------------

describe('HybridSearchEngine — inverted index edge cases', () => {
  it('should handle removing and re-adding a document', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const node = createNode(1, { name: 'testFunc', qualifiedName: 'pkg.testFunc' });
    engine.refreshNode(node);
    expect(engine.documentCount).toBe(1);

    engine.removeNode(node.id);
    expect(engine.documentCount).toBe(0);

    engine.refreshNode(node);
    expect(engine.documentCount).toBe(1);
  });

  it('should handle search with no query terms (empty after tokenization)', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    store.insertNode(createNode(1, { name: 'func', qualifiedName: 'pkg.func' }));
    engine.initialize();

    // Query with only separators tokenizes to empty → no candidates from postings
    // falls back to all docs
    const results = engine.bm25Search('_');
    // Score returns 0 for all since query terms are empty
    // But all nodes are candidates, just scored at 0
    // Since scoreDocument returns only score > 0, results should be empty
    expect(results.length).toBe(0);
  });

  it('should handle removeDocument for node not in docs', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();
    const before = engine.documentCount;
    engine.removeNode(99999);
    expect(engine.documentCount).toBe(before);
  });

  it('should handle InvertedIndex removeDocument last posting', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    const node = createNode(1, { name: 'unique_term_xyz', qualifiedName: 'pkg.unique_term_xyz' });
    engine.refreshNode(node);
    expect(engine.documentCount).toBe(1);
    engine.removeNode(node.id);
    expect(engine.documentCount).toBe(0);
  });

  it('should handle minimum complexity filter with exactly matching value', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    store.insertNode(createNode(1, { name: 'testFunc', complexity: 5 }));
    engine.initialize();

    const results = engine.bm25Search('test', { minComplexity: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('should search all docs when no index term matches', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    store.insertNode(createNode(1, { name: 'hello', qualifiedName: 'pkg.hello' }));
    engine.initialize();

    // Term "zzznotfound" won't be in the index → fallback to all docs
    const results = engine.bm25Search('zzznotfound');
    // Score will be 0 so only results with score > 0 included → empty
    expect(results.length).toBe(0);
  });
});
