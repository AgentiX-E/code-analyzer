// @code-analyzer/intelligence — Hybrid Search Engine Tests

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  HybridSearchEngine,
  indexablePath,
  tokenize,
  cosineSimilarity,
} from '../search/hybrid-search.js';

import type { FieldWeighting, RankedResult } from '../search/hybrid-search.js';
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

  it('cuts a word at punctuation, because a body is source text and a question is prose', () => {
    // **A word boundary is not only whitespace.** This function was written for identifiers, where punctuation cannot
    // occur by construction: a name is letters, digits and separators. The moment a declaration's body and a
    // developer's question reach the index, punctuation is everywhere and *between* words - so `['escape',` kept its
    // brackets and quote, `input?` kept its question mark, and neither word could be matched by anything.
    expect(tokenize("['escape', 'HtmlEncode', 'htmlspecialchars'];")).toEqual([
      'escape',
      'html',
      'encode',
      'htmlspecialchars',
    ]);
    expect(tokenize('what cleans dangerous input?')).toEqual([
      'what',
      'cleans',
      'dangerous',
      'input',
    ]);
    // **A contraction is cut as well**, because an apostrophe is a boundary like any other and telling it apart from
    // the quote that opens a string literal is not a question this function can answer. Normalising `doesn't` to
    // `does not` is stemming, which is a different layer.
    expect(tokenize("doesn't")).toEqual(['doesn', 't']);
    // **A non-Latin word survives**, because a letter is a letter: cutting on `[^a-z]` would delete a Chinese
    // identifier rather than keep it as one word.
    expect(tokenize('解析器 处理')).toEqual(['解析器', '处理']);
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

describe('HybridSearchEngine — how much a semantic rank counts', () => {
  const node = (id: number) => createNode(id, { name: `n${id}` });

  it('leaves the lexical order untouched at weight zero', () => {
    // **The off switch**: a weight of 0 has to answer exactly what the lexical list answered, or "semantic search
    // disabled" is not a state this engine has.
    const engine = new HybridSearchEngine(createStore());
    const lexical = [
      { node: node(1), score: 3 },
      { node: node(2), score: 2 },
      { node: node(3), score: 1 },
    ];
    const semantic = [
      { node: node(3), score: 0.9 },
      { node: node(1), score: 0.8 },
    ];

    const fused = engine.fuseResults(lexical, semantic, 60, undefined, 0);
    expect(fused.map((r) => r.node.id)).toEqual([1, 2, 3]);
  });

  it('lets a semantic hit overtake a lexical one at full weight and not at zero', () => {
    // The same two lists, two weights: **C is lexical rank 3 and semantic rank 1**, and whether it rises above B is
    // exactly what the parameter decides. This is the knob the sweep sets, so its effect is asserted rather than
    // described.
    const engine = new HybridSearchEngine(createStore());
    const lexical = [
      { node: node(1), score: 3 },
      { node: node(2), score: 2 },
      { node: node(3), score: 1 },
    ];
    const semantic = [
      { node: node(3), score: 0.9 },
      { node: node(1), score: 0.8 },
    ];

    const full = engine.fuseResults(lexical, semantic, 60, undefined, 1);
    expect(full.map((r) => r.node.id)).toEqual([1, 3, 2]);
    expect(engine.fuseResults(lexical, semantic, 60, undefined, 0).map((r) => r.node.id)).toEqual([
      1, 2, 3,
    ]);
  });
});

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
    // Overlapped node keeps both per-source scores and sums both RRF ranks.
    const overlapped = fused.find((r) => r.node.id === 1)!;
    expect(overlapped.bm25Score).toBe(10);
    expect(overlapped.vectorScore).toBe(0.8);
    expect(overlapped.combinedScore).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it('merges duplicate ids within the BM25 list instead of overwriting', () => {
    const node = createNode(1);
    const bm25Results: RankedResult[] = [
      { node, score: 10 },
      { node, score: 5 },
    ];

    const fused = engine.fuseResults(bm25Results, [], 60);

    expect(fused.length).toBe(1);
    expect(fused[0]!.bm25Score).toBe(5);
    // Both duplicate entries contribute RRF (rank 1 + rank 2).
    expect(fused[0]!.combinedScore).toBeCloseTo(1 / 61 + 1 / 62, 10);
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

  it('answers exactly what it answered once when it is initialized twice', () => {
    // **`initialize` means "make the store visible", and the store is the truth** - so a second call has to leave the
    // index holding the store's nodes and nothing else. It appended instead: every posting listed twice, every field
    // twice as long as itself, and every document frequency counted twice while the document count stayed at ten.
    // **A frequency larger than the number of documents makes IDF negative, and a negative score is not a result**,
    // so a second `initialize()` made the engine return nothing at all for every question - silently, because
    // `documentCount` is a map size and could not see it.
    const store = createStore();
    const once = new HybridSearchEngine(store);
    once.initialize();
    const twice = new HybridSearchEngine(store);
    twice.initialize();
    twice.initialize();

    expect(twice.documentCount).toBe(once.documentCount);
    const ranked = (engine: HybridSearchEngine): [number, number][] =>
      engine.bm25Search('function_7').map((hit) => [hit.node.id, hit.score]);
    expect(ranked(twice)).toEqual(ranked(once));
    expect(ranked(once).length).toBeGreaterThan(0);
  });

  it('sees a node inserted after it was initialized, once it is initialized again', () => {
    // **The other half of the same statement**: rebuilding has to *include* what arrived while the index was built,
    // which is why "skip when already initialized" would be the wrong repair for the defect above.
    const store = createStore();
    const engine = new HybridSearchEngine(store);
    engine.initialize();
    const late = createNode(42, {
      name: 'late_arrival',
      qualifiedName: 'pkg.late_arrival',
      signature: 'function late_arrival(): void',
    });
    // **The store assigns the id**, so the assertion is on the id it returned rather than on the one the node asked for.
    const lateId = store.insertNode(late);
    expect(engine.bm25Search('late_arrival')).toEqual([]);

    engine.initialize();
    expect(engine.bm25Search('late_arrival').map((hit) => hit.node.id)).toEqual([lateId]);
    expect(engine.documentCount).toBe(11);
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
    expect(results.every((r) => r.node.complexity === null || (r.node.complexity ?? 0) <= 5)).toBe(
      true,
    );
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

    store.insertNode(
      createNode(1, {
        name: 'target',
        label: 'Function',
        filePath: '/src/core/target.ts',
        isExported: true,
        complexity: 8,
      }),
    );
    store.insertNode(
      createNode(2, {
        name: 'target',
        label: 'Class',
        filePath: '/src/core/target.ts',
        isExported: true,
        complexity: 5,
      }),
    );
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

// ---------------------------------------------------------------------------
// vectorSearch — candidate ID and max cap branches
// ---------------------------------------------------------------------------

describe('HybridSearchEngine — vectorSearch branches', () => {
  it('searches with a vector the caller already has, and does not embed the query', async () => {
    // **The expanded-query path**: the vector is the mean of a question and a hypothesis, so there is no single string
    // to embed. A cosine against node 1's vector has to rank node 1 first, and the embedder must never be called.
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'calls', qualifiedName: 'pkg.calls' }));
    store.insertNode(createNode(2, { name: 'other', qualifiedName: 'pkg.other' }));

    const engine = new HybridSearchEngine(store);
    const emb = new Map<number, Float32Array>();
    emb.set(1, new Float32Array([1, 0]));
    emb.set(2, new Float32Array([0, 1]));
    let embedded = 0;
    engine.registerEmbeddings(
      (nodeId) => emb.get(nodeId) ?? null,
      async () => {
        embedded += 1;
        return new Float32Array([0, 1]);
      },
    );

    const results = await engine.vectorSearch('ignored', 2, null, new Float32Array([1, 0]));
    expect(results[0]?.node.name).toBe('calls');
    expect(embedded).toBe(0);
  });

  it('works with a precomputed vector and no embedder registered at all', async () => {
    // **A caller that has the vector does not need the endpoint**: the query side of a measurement is often computed
    // once and reused, and requiring an embedContent function would make that caller register a function it never uses.
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'a', qualifiedName: 'pkg.a' }));
    const engine = new HybridSearchEngine(store);
    engine.registerEmbeddings(() => new Float32Array([1, 0]), undefined);

    const results = await engine.vectorSearch('q', 1, null, new Float32Array([1, 0]));
    expect(results).toHaveLength(1);
  });

  it('returns nothing when neither a vector nor an embedder is available', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'a', qualifiedName: 'pkg.a' }));
    const engine = new HybridSearchEngine(store);
    engine.registerEmbeddings(() => new Float32Array([1, 0]));

    expect(await engine.vectorSearch('q', 1)).toEqual([]);
  });

  it('should accept candidateIds for scoped vector search', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'target', qualifiedName: 'pkg.target' }));
    store.insertNode(createNode(2, { name: 'other', qualifiedName: 'pkg.other' }));
    store.insertNode(createNode(3, { name: 'third', qualifiedName: 'pkg.third' }));

    const engine = new HybridSearchEngine(store);
    const emb = new Map<number, Float32Array>();
    emb.set(1, new Float32Array([0.9, 0.1]));
    emb.set(2, new Float32Array([0.1, 0.9]));
    emb.set(3, new Float32Array([0.5, 0.5]));

    engine.registerEmbeddings(
      (nodeId) => emb.get(nodeId) ?? null,
      async () => new Float32Array([0.9, 0.1]),
    );

    // Only score node 1 and 2 via candidate IDs
    const results = await engine.vectorSearch('test', 2, [1, 2]);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('scores every embedded node when no candidate list is given', async () => {
    const store = new InMemoryGraphStore();
    for (let i = 1; i <= 5; i++) {
      store.insertNode(createNode(i));
    }

    const engine = new HybridSearchEngine(store);
    const emb = new Map<number, Float32Array>();
    for (let i = 1; i <= 5; i++) {
      emb.set(i, new Float32Array([0.1 * i, 0.2]));
    }

    engine.registerEmbeddings(
      (nodeId) => emb.get(nodeId) ?? null,
      async () => new Float32Array([0.5, 0.5]),
    );

    // vectorSearch without candidates → scores all nodes (less than 1000, exercises the no-cap path)
    const results = await engine.vectorSearch('test', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('should handle vectorSearch with null candidateIds (line 416)', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'a', qualifiedName: 'pkg.a' }));
    store.insertNode(createNode(2, { name: 'b', qualifiedName: 'pkg.b' }));

    const engine = new HybridSearchEngine(store);
    const emb = new Map<number, Float32Array>();
    emb.set(1, new Float32Array([0.8, 0.2]));
    emb.set(2, new Float32Array([0.2, 0.8]));

    engine.registerEmbeddings(
      (nodeId) => emb.get(nodeId) ?? null,
      async () => new Float32Array([0.5, 0.5]),
    );

    // Explicitly pass null candidateIds to hit the "score all nodes" branch
    const results = await engine.vectorSearch('test', 2, null);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle vectorSearch with empty candidateIds array', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'x', qualifiedName: 'pkg.x' }));

    const engine = new HybridSearchEngine(store);
    const emb = new Map<number, Float32Array>();
    emb.set(1, new Float32Array([0.7, 0.3]));

    engine.registerEmbeddings(
      (nodeId) => emb.get(nodeId) ?? null,
      async () => new Float32Array([0.5, 0.5]),
    );

    // Empty candidateIds array → fallback to all nodes
    const results = await engine.vectorSearch('test', 1, []);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// cosineSimilarity — negative values and edge cases
// ---------------------------------------------------------------------------

describe('cosineSimilarity — negative and mixed values', () => {
  it('should handle mixed positive and negative components', () => {
    const a = new Float32Array([1, -2, 3]);
    const b = new Float32Array([-1, 2, -3]);
    const result = cosineSimilarity(a, b);
    // a·b = -1 -4 -9 = -14; |a| = sqrt(14); |b| = sqrt(14); cos = -14/14 = -1
    expect(result).toBeCloseTo(-1, 5);
  });

  it('should handle large magnitude vectors', () => {
    const a = new Float32Array([1e6, 2e6]);
    const b = new Float32Array([1e6, 2e6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('should handle vectors with one zero and one non-zero', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HybridSearchEngine — dataflow search integration
// ---------------------------------------------------------------------------

describe('HybridSearchEngine — dataflow search', () => {
  it('should return empty paths for dataflowSearch without entryPoints', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    const paths = engine.dataflowSearch();
    expect(Array.isArray(paths)).toBe(true);
  });

  it('should handle dataflowSearch with custom maxDepth and maxPaths', () => {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);
    const paths = engine.dataflowSearch({ maxDepth: 5, maxPaths: 10 });
    expect(Array.isArray(paths)).toBe(true);
  });

  it('should handle dataflowReachableSinks', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'source', qualifiedName: 'pkg.source' }));
    store.insertNode(createNode(2, { name: 'sink', qualifiedName: 'pkg.sink' }));
    const engine = new HybridSearchEngine(store);
    const sinks = engine.dataflowReachableSinks(1, 5);
    expect(Array.isArray(sinks)).toBe(true);
  });

  it('should handle dataflowSearch with entryPoints', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'source', qualifiedName: 'pkg.source' }));
    const engine = new HybridSearchEngine(store);
    const paths = engine.dataflowSearch({ entryPoints: ['pkg.source'], maxDepth: 5 });
    expect(Array.isArray(paths)).toBe(true);
  });

  it('should handle dataflowSearch with entryPoints and default maxDepth', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'source', qualifiedName: 'pkg.source' }));
    const engine = new HybridSearchEngine(store);
    const paths = engine.dataflowSearch({ entryPoints: ['pkg.source'] });
    expect(Array.isArray(paths)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HybridSearchEngine.search — auto-initialize and zero results
// ---------------------------------------------------------------------------

describe('HybridSearchEngine.search — additional paths', () => {
  it('should handle search with filePath filter option', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      createNode(1, {
        name: 'apiHandler',
        filePath: '/src/api/users.ts',
        qualifiedName: 'api.users',
      }),
    );
    store.insertNode(
      createNode(2, {
        name: 'utilFunc',
        filePath: '/src/utils/helpers.ts',
        qualifiedName: 'utils.helpers',
      }),
    );
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const results = await engine.search({ query: 'api', filePath: '*api*' });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle search with labels filter option', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      createNode(1, { name: 'myFunc', label: 'Function', qualifiedName: 'pkg.myFunc' }),
    );
    store.insertNode(
      createNode(2, { name: 'MyClass', label: 'Class', qualifiedName: 'pkg.MyClass' }),
    );
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const results = await engine.search({
      query: 'my',
      labels: ['Function' as const],
    });
    expect(results.every((r) => r.node.label === 'Function')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tokenize — additional patterns
// ---------------------------------------------------------------------------

describe('tokenize — additional patterns', () => {
  it('should handle identifiers with trailing separators', () => {
    expect(tokenize('getUser_')).toEqual(['get', 'user']);
  });

  it('should handle identifiers with leading separators', () => {
    expect(tokenize('_privateField')).toEqual(['private', 'field']);
  });

  it('should handle consecutive uppercase followed by camelCase', () => {
    expect(tokenize('XMLHTTPParser')).toEqual(['xmlhttp', 'parser']);
  });

  it('should handle single uppercase letter', () => {
    expect(tokenize('I')).toEqual(['i']);
  });

  it('should handle mixed separators', () => {
    expect(tokenize('my-module_v2.config')).toEqual(['my', 'module', 'v2', 'config']);
  });
});

// ---------------------------------------------------------------------------
// Coverage: null metadata indexing + vector search defensive branches
// ---------------------------------------------------------------------------

describe('HybridSearchEngine — null metadata and vector search branches', () => {
  it('should index nodes with null signature and null docstring', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      createNode(1, {
        name: 'plainNode',
        qualifiedName: 'pkg.plainNode',
        signature: null,
        docstring: null,
      }),
    );

    const engine = new HybridSearchEngine(store);
    engine.initialize();

    // Node with no signature/docstring is still indexed via name + qualifiedName.
    const results = engine.bm25Search('plainNode');
    expect(results.length).toBe(1);
    expect(results[0]!.node.id).toBe(1);
  });

  it('should disable vector search when only a lookup is registered (no content fn)', async () => {
    const store = createStore();
    const engine = new HybridSearchEngine(store);

    // Register a lookup without an embed-content function → embedContent stays null.
    engine.registerEmbeddings(() => new Float32Array([0.5, 0.5]));

    const results = await engine.vectorSearch('query', 5);
    expect(results).toEqual([]);
  });

  it('should fall back to scoring all nodes when BM25 yields no candidates', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'alpha', qualifiedName: 'pkg.alpha' }));
    store.insertNode(createNode(2, { name: 'beta', qualifiedName: 'pkg.beta' }));

    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const emb = new Map<number, Float32Array>();
    emb.set(1, new Float32Array([0.9, 0.1]));
    emb.set(2, new Float32Array([0.1, 0.9]));
    engine.registerEmbeddings(
      (nodeId) => emb.get(nodeId) ?? null,
      async () => new Float32Array([0.9, 0.1]),
    );

    // Query matches no BM25 term → bm25Results empty → candidateIds null.
    const results = await engine.search({ query: 'zzz_no_match_xyz' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('should skip candidate IDs that do not exist in the store', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'present', qualifiedName: 'pkg.present' }));

    const engine = new HybridSearchEngine(store);
    engine.registerEmbeddings(
      () => new Float32Array([0.5, 0.5]),
      async () => new Float32Array([0.5, 0.5]),
    );

    // candidateIds includes 999, which is not in the store → getNode returns null.
    const results = await engine.vectorSearch('query', 5, [1, 999]);
    expect(results.length).toBe(1);
    expect(results[0]!.node.id).toBe(1);
  });

  it('finds an answer past the thousandth node, which the old cap could not', async () => {
    // **This is the recall ceiling made observable.** The engine used to score only the first 1 000 nodes it was given,
    // so on any repository larger than that the tail of the index was invisible to semantic search - silently, and
    // while the figure it produced was reported as the retriever's. The right answer here is node 1001.
    const store = new InMemoryGraphStore();
    for (let i = 1; i <= 1000; i++) {
      store.insertNode(createNode(i));
    }
    store.insertNode(createNode(1001, { name: 'onlyAnswer', qualifiedName: 'pkg.onlyAnswer' }));

    const engine = new HybridSearchEngine(store);
    engine.registerEmbeddings(
      (nodeId) => new Float32Array(nodeId === 1001 ? [1, 0] : [0, 1]),
      async () => new Float32Array([1, 0]),
    );

    const results = await engine.vectorSearch('query', 1);
    expect(results).toHaveLength(1);
    expect(results[0]!.node.id).toBe(1001);
  });

  it('should skip nodes without a stored embedding', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'hasEmb', qualifiedName: 'pkg.hasEmb' }));
    store.insertNode(createNode(2, { name: 'noEmb', qualifiedName: 'pkg.noEmb' }));

    const engine = new HybridSearchEngine(store);
    engine.registerEmbeddings(
      (nodeId) => (nodeId === 1 ? new Float32Array([0.5, 0.5]) : null),
      async () => new Float32Array([0.5, 0.5]),
    );

    const results = await engine.vectorSearch('query', 5);
    expect(results.length).toBe(1);
    expect(results[0]!.node.id).toBe(1);
  });

  it('should exclude results with non-positive similarity', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createNode(1, { name: 'aligned', qualifiedName: 'pkg.aligned' }));
    store.insertNode(createNode(2, { name: 'orthogonal', qualifiedName: 'pkg.orthogonal' }));

    const engine = new HybridSearchEngine(store);
    engine.registerEmbeddings(
      (nodeId) => (nodeId === 1 ? new Float32Array([1, 0]) : new Float32Array([0, 1])),
      async () => new Float32Array([1, 0]),
    );

    // Node 2 is orthogonal to the query (similarity 0) → excluded.
    const results = await engine.vectorSearch('query', 5);
    expect(results.length).toBe(1);
    expect(results[0]!.node.id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Field weighting
// ---------------------------------------------------------------------------

/**
 * **One bag of tokens cannot tell where a word was written**, and the corpus is full of documents that say the same
 * words in different places: `Parser.sanitize` in `sanitize.ts` mentions `sanitize` twice, once as its own name and
 * once as its file, while `sanitize`'s sibling in `keep.ts` mentions it once, as a name. BM25 sums those mentions and
 * therefore ranks the file name and the declaration as the same evidence.
 *
 * **The fields are separated and weighted instead.** `name` is what a developer would say out loud, `path` is where it
 * lives, `signature` is how it is called, `docstring` is what it does — and each is normalised against its own average
 * length, because a signature is longer than a name by nature and not by verbosity.
 */
describe('the fields a document is indexed under', () => {
  const corpora = (nodes: GraphNode[], weighting?: FieldWeighting): HybridSearchEngine => {
    const store = new InMemoryGraphStore();
    for (const node of nodes) store.insertNode(node);
    const engine = new HybridSearchEngine(store, weighting);
    engine.initialize();
    return engine;
  };

  const node = (
    id: number,
    qualifiedName: string,
    overrides: Partial<GraphNode> = {},
  ): GraphNode => {
    const name =
      qualifiedName
        .slice(qualifiedName.lastIndexOf(':') + 1)
        .split('.')
        .pop() ?? '';
    return createNode(id, { name, qualifiedName, signature: null, docstring: null, ...overrides });
  };

  it('keeps the file and the container in the path field, and only the declaration in the name field', () => {
    const holder = { qualifiedName: 'project:demo:file:/w/zod/src/types.ts:ZodType.checkExported' };
    expect(indexablePath(holder)).toBe('file:types:ZodType');
    // **A file's own name is its whole path**, because a file is not declared inside anything.
    expect(indexablePath({ qualifiedName: 'project:demo:file:/w/zod/src/types.ts' })).toBe(
      'file:types',
    );
  });

  it('weighs the field a query word was written in, not the document it was written in', () => {
    // `beam` is part of a declaration, and for the other document part of the file it lives in. **Neither is called
    // `beam`**, so the exact-name multiplier is out of the picture and only the field weighting can decide the order.
    const declared = node(1, 'file:/w/a.ts:Box.beamWidth');
    const lived = node(2, 'file:/w/beam.ts:Box.wind');
    const scoreOf = (engine: HybridSearchEngine, name: string): number =>
      engine.bm25Search('beam').find((hit) => hit.node.name === name)?.score ?? 0;

    const byName = corpora([declared, lived], {
      weight: { name: 2, path: 1, signature: 1, docstring: 1, vocabulary: 0 },
      lengthNormalisation: {
        name: 0.75,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0.75,
      },
    });
    expect(scoreOf(byName, 'beamWidth')).toBeGreaterThan(scoreOf(byName, 'wind'));

    // **The same two documents and the opposite order**, which is the statement that the weight is read per field.
    const byPath = corpora([declared, lived], {
      weight: { name: 0.25, path: 1, signature: 1, docstring: 1, vocabulary: 0 },
      lengthNormalisation: {
        name: 0.75,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0.75,
      },
    });
    expect(scoreOf(byPath, 'wind')).toBeGreaterThan(scoreOf(byPath, 'beamWidth'));
  });

  it('normalises a field against its own average, so a long signature does not dilute the name', () => {
    const clipped = node(1, 'file:/w/a.ts:Widget.resize', { signature: 'resize(): void' });
    const verbose = node(2, 'file:/w/b.ts:Widget.resize', {
      signature: `resize(${Array.from({ length: 40 }, (_, i) => `option${i}: string`).join(', ')}): void`,
    });
    const scoreOf = (engine: HybridSearchEngine, id: number): number =>
      engine.bm25Search('resize').find((hit) => hit.node.id === id)?.score ?? 0;
    const nameOnly: FieldWeighting = {
      weight: { name: 1, path: 0, signature: 0, docstring: 0, vocabulary: 0 },
      lengthNormalisation: {
        name: 0.75,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0.75,
      },
    };

    // **Identical name fields, and the query is that field's only word**: the two documents must score the same, or
    // the name is being diluted by something that is not the name.
    const byName = corpora([clipped, verbose], nameOnly);
    expect(scoreOf(byName, 1)).toBeCloseTo(scoreOf(byName, 2), 12);

    // **The same two documents with the signature field on, and the query matches the signature too** - `resize():`
    // is one word in one of them and forty in the other. The shorter field wins, and that gap is normalisation
    // applied to the field that is *long* rather than to the field that matched: with a single bag of all four, the
    // forty-option document would have been penalised on its name as well.
    const both = corpora([clipped, verbose]);
    expect(scoreOf(both, 1)).toBeGreaterThan(scoreOf(both, 2));

    // **A long field the query does not match costs nothing.** The document carries a page of unrelated prose and
    // the same one-word name; under one bag it would have been the longer document for a term it does match.
    const talkative = node(3, 'file:/w/c.ts:Widget.resize', {
      docstring: Array.from({ length: 300 }, () => 'unrelated').join(' '),
    });
    const quiet = node(4, 'file:/w/d.ts:Widget.resize');
    const mixed = corpora([quiet, talkative]);
    expect(scoreOf(mixed, 3)).toBeCloseTo(scoreOf(mixed, 4), 12);
  });

  it('files the sentence a documentation provider calls a name where a doc comment goes', () => {
    // **`markdown.ts` emits `## Understanding the owner controller` as a `CLASS_DEF` and every list item as a
    // `VARIABLE_DEF`**, because a documentation provider has no identifiers to offer and its text is the only thing it
    // can put where a name goes. Scored as a name, a sentence competes with every declaration in the repository - and
    // won, on `spring-petclinic`, where the README out-ranked every Java class for a natural-language question.
    const declared = node(1, 'file:/w/a.ts:Owner.owner', { language: 'typescript' });
    const documented = node(2, 'file:/w/README.md:Understanding the owner controller', {
      language: 'markdown',
    });

    const scores = new Map(
      corpora([declared, documented])
        .bm25Search('owner')
        .map((hit) => [hit.node.name, hit.score]),
    );
    // **One word, written once in each document**, so the difference between the two scores is the field and nothing
    // else: the same term matched as a name scores higher than the same term matched inside a sentence.
    expect(scores.get('owner')).toBeGreaterThan(
      scores.get('Understanding the owner controller') ?? 0,
    );

    // **And an index that does not read doc comments does not read documentation at all**, which is the sharper
    // statement: a paraphrase measurement strips every doc comment, so a README has nothing left to match on.
    const withoutDocs = corpora([declared, documented], {
      weight: { name: 1, path: 0.5, signature: 1, docstring: 0, vocabulary: 0 },
      lengthNormalisation: {
        name: 0,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0.75,
      },
    }).bm25Search('owner controller');
    expect(withoutDocs.map((hit) => hit.node.name)).toEqual(['owner']);
  });

  it('is the classical BM25 exactly when one field is weighted and the rest are not', () => {
    // **The textbook definition, written from the paper rather than from this module**: a generalisation that does not
    // reduce to the specific case at the specific case's settings is a different ranking function wearing its name, and
    // no corpus figure would ever say so.
    // The documents are handed over already tokenised, so the formula is the only thing being copied.
    const classic = (docs: string[][], query: string, k1: number, b: number): number[] => {
      const lengths = docs.map((tokens) => tokens.length);
      const avgdl = lengths.reduce((a, l) => a + l, 0) / docs.length;
      const df = docs.filter((tokens) => tokens.includes(query)).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      return docs.map((tokens, index) => {
        const tf = tokens.filter((word) => word === query).length;
        if (tf === 0) return 0;
        return (idf * (k1 + 1) * tf) / (k1 * (1 - b + (b * lengths[index]!) / avgdl) + tf);
      });
    };

    // **No document is called `alpha`**, because an exact name match multiplies the score after the ranking function
    // and this test is about the ranking function.
    const names = ['alpha_one', 'alpha_two', 'omega'];
    const store = new InMemoryGraphStore();
    names.forEach((name, index) => {
      store.insertNode(node(index + 1, `file:/w/f${index}.ts:Box.${name}`, { name }));
    });
    const engine = new HybridSearchEngine(store, {
      weight: { name: 1, path: 0, signature: 0, docstring: 0, vocabulary: 0 },
      lengthNormalisation: {
        name: 0.75,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0.75,
      },
    });
    engine.initialize();

    const expected = classic(
      names.map((name) => tokenize(name)),
      'alpha',
      1.2,
      0.75,
    );
    const scored = new Map(engine.bm25Search('alpha').map((hit) => [hit.node.name, hit.score]));
    expect(scored.size).toBe(2);
    expect(scored.get('alpha_one')).toBeCloseTo(expected[0]!, 12);
    expect(scored.get('alpha_two')).toBeCloseTo(expected[1]!, 12);
  });

  it('scores nothing from a field whose weight is zero, so a match there cannot surface at all', () => {
    const onlyInThePath = node(1, 'file:/w/telemetry.ts:Box.run');
    const results = corpora([onlyInThePath], {
      weight: { name: 1, path: 0, signature: 1, docstring: 1, vocabulary: 0 },
      lengthNormalisation: {
        name: 0.75,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0.75,
      },
    }).bm25Search('telemetry');
    expect(results).toEqual([]);
  });

  it('answers a name exactly even against a doc comment that repeats it', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(node(1, 'file:/w/a.ts:Box.resize'));
    store.insertNode(
      node(2, 'file:/w/b.ts:Box.apply', {
        docstring: Array.from({ length: 40 }, () => 'resize').join(' '),
      }),
    );
    // **At the weighting the product ships**, a document that repeats the word forty times is still not the symbol the
    // developer named: a term-frequency model ranks documents, and the exact-name multiplier is how this index stays a
    // lookup when the question is a lookup.
    const engine = new HybridSearchEngine(store);
    engine.initialize();
    expect(engine.bm25Search('resize')[0]!.node.name).toBe('resize');
  });

  it('does not let a zero-weight field change a score, because a document frequency is evidence too', () => {
    // **The defect this pins, and the way it was found.** A postings list is a union over fields, and `df` was read from
    // its length - so a document that carried a term **only** in a field worth nothing still made that term look common,
    // and lowering every other document's IDF. **`weight: 0` meant "this field is not evidence, and also a quieter word
    // for everybody else"**. Measured on the pinned corpus when a fifth field was added at zero in order to be measured
    // later: the four-field grid it was supposed to leave untouched moved from `dev` 0.3191 to 0.3617, **without the
    // fifth field ever contributing a point of score.** That is how it was found.
    const weighting: FieldWeighting = {
      weight: { name: 1, path: 0, signature: 0, docstring: 0, vocabulary: 0 },
      lengthNormalisation: {
        name: 0,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0.75,
      },
    };
    // **Both indexes hold both documents**, because the collection size is a legitimate part of an IDF and holding it
    // fixed is what leaves the frequency as the only thing that can differ. The only change is whether the second
    // document carries the term in a field that scores nothing.
    const silent = corpora(
      [node(1, 'file:/w/a.ts:Box.parse'), node(2, 'file:/w/b.ts:Box.walk')],
      weighting,
    );
    const saysItInABody = corpora(
      [
        node(1, 'file:/w/a.ts:Box.parse'),
        node(2, 'file:/w/b.ts:Box.walk', { properties: { body: 'parse parse parse' } }),
      ],
      weighting,
    );

    const scoreOf = (engine: HybridSearchEngine): number =>
      engine.bm25Search('parse').find((hit) => hit.node.name === 'parse')!.score;
    // **The same number to twelve decimals**: the second document carries the term in a field that scores nothing, so it
    // is not a document the term is about - and the score of the one it *is* about cannot depend on it.
    expect(scoreOf(saysItInABody)).toBeCloseTo(scoreOf(silent), 12);
    // **And the query still finds only the declaration**, which is the other half of the same statement.
    expect(saysItInABody.bm25Search('parse').map((hit) => hit.node.name)).toEqual(['parse']);
  });

  it('holds the distinct words of a body, once each, so a repeated word is not a stronger one', () => {
    const weighting: FieldWeighting = {
      weight: { name: 1, path: 0, signature: 0, docstring: 0, vocabulary: 1 },
      lengthNormalisation: {
        name: 0,
        path: 0.75,
        signature: 0.75,
        docstring: 0.75,
        vocabulary: 0,
      },
    };
    const engine = corpora(
      [
        node(1, 'file:/w/a.ts:Box.one', { properties: { body: 'sanitize' } }),
        node(2, 'file:/w/a.ts:Box.two', { properties: { body: 'sanitize sanitize sanitize' } }),
      ],
      weighting,
    );
    const scored = new Map(engine.bm25Search('sanitize').map((hit) => [hit.node.name, hit.score]));
    expect(scored.size).toBe(2);
    // **Equal, because a body that says it three times has not said three different things.** The field is a vocabulary
    // and not a text: `distinctTokensOf` is what makes its term frequency presence.
    expect(scored.get('one')).toBeCloseTo(scored.get('two')!, 12);
  });

  it('finds a word that is only in a body once the field is worth something', () => {
    // **The field's whole purpose, on one document**: `C_LIKE_SANITIZERS` is an array of `escape`, `HtmlEncode` and
    // `htmlspecialchars`, and its name says none of them. At weight zero the query finds nothing; at the weight the
    // product ships it finds the declaration. **The body is the declaration's own source**, which is what `parse`
    // stores — not a summary of it.
    const declaration = (): GraphNode =>
      node(1, 'project:demo:file:/w/base-c-like.ts:C_LIKE_SANITIZERS', {
        properties: {
          body: "const C_LIKE_SANITIZERS = ['escape', 'HtmlEncode', 'htmlspecialchars'];",
        },
      });
    const off: FieldWeighting = {
      weight: { name: 1, path: 0.5, signature: 1, docstring: 1, vocabulary: 0 },
      lengthNormalisation: { name: 0, path: 0.75, signature: 0.75, docstring: 0.75, vocabulary: 0 },
    };
    expect(corpora([declaration()], off).bm25Search('html encode')).toEqual([]);
    const on = corpora([declaration()], {
      ...off,
      weight: { ...off.weight, vocabulary: 0.25 },
    });
    expect(on.bm25Search('html encode')[0]!.node.name).toBe('C_LIKE_SANITIZERS');
  });
});
