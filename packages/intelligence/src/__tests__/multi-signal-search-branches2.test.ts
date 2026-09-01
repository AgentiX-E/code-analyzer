// @code-analyzer/intelligence — Hybrid Search Branch Tests (round 2)
// Covers the remaining uncovered functions reported by the v8 coverage map:
//   * searchSemantic's descending sort comparator (requires >= 2 cached vectors)
//   * computeAstSimilarity (previously a fabricated constant 0.5; now real Jaccard)
//   * searchMultiSignal's signal enrichment and final combined-score sort
//
// searchMultiSignal reads optional signal fields (signature / astProfile /
// filePath / pageRank) that fuseResults never populates, so these tests inject
// them by stubbing `search()` — the exact shape an upstream caller provides.

import { describe, it, expect, vi } from 'vitest';
import { HybridSearchEngine, type HybridSearchResult } from '../search/multi-signal-search.js';
import type { EmbeddingEngine } from '../embeddings/embedder.js';

/** A minimal, deterministic EmbeddingEngine stand-in. */
function mockEngine(overrides: Partial<EmbeddingEngine> = {}): EmbeddingEngine {
  return {
    embedCode: async () => new Float32Array([1, 0, 0]),
    embedBatch: async (codes: string[]) => codes.map(() => new Float32Array([1, 0, 0])),
    cosineSimilarity: () => 1,
    ...overrides,
  } as unknown as EmbeddingEngine;
}

describe('HybridSearchEngine — searchSemantic descending sort', () => {
  it('orders multiple cached embeddings by descending similarity', async () => {
    const engine = new HybridSearchEngine(
      mockEngine({
        // Lower score cached first so the sort comparator performs a real reorder.
        embedBatch: async (codes: string[]) =>
          codes.map((_, i) => new Float32Array([i === 0 ? 0.1 : 0.9, 0, 0])),
        cosineSimilarity: (_a: Float32Array, b: Float32Array) => b[0]!,
      }),
      { minScore: 0, useRRF: true, topK: 50 },
    );
    await engine.cacheDocumentEmbeddings([
      { id: 'low', text: 'alpha' },
      { id: 'high', text: 'beta' },
    ]);

    const engineWithPrivate = engine as unknown as {
      searchSemantic: (q: string, k: number) => Promise<Array<{ id: string; score: number }>>;
    };

    const results = await engineWithPrivate.searchSemantic('query', 50);
    expect(results.map((r) => r.id)).toEqual(['high', 'low']);
  });
});

describe('HybridSearchEngine — computeAstSimilarity', () => {
  it('computes real Jaccard overlap between query and AST profile tokens', () => {
    const engine = new HybridSearchEngine(mockEngine());
    const engineWithPrivate = engine as unknown as {
      computeAstSimilarity: (q: string, p: string) => number;
    };

    // Identical token streams produce a Jaccard similarity of 1.
    expect(engineWithPrivate.computeAstSimilarity('getUserById', 'getUserById')).toBe(1);
    // Disjoint token streams produce 0 — not a fabricated constant.
    expect(engineWithPrivate.computeAstSimilarity('alpha', 'beta')).toBe(0);
    // Empty profile with a non-empty query: the union is non-empty but the
    // intersection is empty, so the ratio is 0.
    expect(engineWithPrivate.computeAstSimilarity('getUser', '')).toBe(0);
    // Both empty: the union is empty, driving the ternary's false branch.
    expect(engineWithPrivate.computeAstSimilarity('', '')).toBe(0);
  });
});

describe('HybridSearchEngine — re-indexing the same document id', () => {
  it('drops stale inverted-index tokens when a doc is re-indexed', async () => {
    const engine = new HybridSearchEngine(mockEngine(), { minScore: 0, useRRF: true, topK: 50 });

    engine.indexDocument('a', 'foo bar');
    engine.indexDocument('a', 'baz qux');

    // Only the latest tokens remain; the stale 'foo'/'bar' entries are gone.
    expect(engine.getStats().uniqueTokens).toBe(2);

    // A stale token no longer surfaces the document in BM25 search.
    const results = await engine.search('foo');
    expect(results).toEqual([]);
  });
});

describe('HybridSearchEngine — searchMultiSignal enrichment & final sort', () => {
  it('enriches injected signals and sorts results by combined score', async () => {
    const engine = new HybridSearchEngine(mockEngine(), {
      minScore: 0,
      useRRF: true,
      topK: 50,
    });

    const base: HybridSearchResult[] = [
      {
        id: 'a',
        name: 'alpha',
        filePath: 'src/alpha/service.ts',
        startLine: 1,
        endLine: 2,
        relevance: 0.5,
        bm25Score: 0.5,
        semanticScore: 0.5,
        combinedScore: 0.5,
        scoreComponents: {},
        signature: 'getUserById',
        astProfile: 'getUserById',
        pageRank: 0.08,
      },
      {
        id: 'b',
        name: 'getUser',
        filePath: 'src/getuser/service.ts',
        startLine: 1,
        endLine: 2,
        relevance: 0.9,
        bm25Score: 0.9,
        semanticScore: 0.9,
        combinedScore: 0.9,
        scoreComponents: {},
        signature: 'getUser',
        astProfile: 'getUser',
        pageRank: 0.2,
      },
    ];

    // searchMultiSignal delegates to search(); stub it to inject the signal-rich
    // result set that fuseResults never produces on its own.
    vi.spyOn(engine, 'search').mockResolvedValue(base);

    const minHashSignatures = new Map<string, number[]>([
      ['__query__', [1, 2, 3]],
      ['a', [1, 2, 3]],
    ]);

    const results = await engine.searchMultiSignal('getUser', undefined, minHashSignatures);

    // Final descending sort by combinedScore puts the exact-match result first.
    expect(results.map((r) => r.id)).toEqual(['b', 'a']);

    const b = results.find((r) => r.id === 'b')!;
    const a = results.find((r) => r.id === 'a')!;

    // AST similarity is a genuine Jaccard overlap, not the old 0.5 constant.
    expect(b.scoreComponents['astProfile']).toBeGreaterThan(0);
    // Exact name-match bonus fires only for the matching result.
    expect(b.scoreComponents['exactMatch']).toBe(1);
    expect(a.scoreComponents['exactMatch']).toBe(0);
    // PageRank signal is normalized and attached.
    expect(a.scoreComponents['pageRank']).toBeCloseTo(0.8, 5);
    // MinHash signal is computed only for the result present in the signature map.
    expect(a.scoreComponents['minHash']).toBe(1);
    expect(b.scoreComponents['minHash']).toBeUndefined();
  });
});
