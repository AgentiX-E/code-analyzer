import { describe, it, expect } from 'vitest';

import { EmbeddingEngine, MockEmbeddingBackend } from '../embeddings/embedder.js';
import { HybridSearchEngine } from '../search/multi-signal-search.js';

// The HybridSearchEngine expects an EmbeddingEngine-like object with
// embedCode, embedBatch, and cosineSimilarity. Use the real (mock-backed)
// EmbeddingEngine to exercise the integration path deterministically.
function makeEngine(config?: ConstructorParameters<typeof EmbeddingEngine>[0]) {
  return new HybridSearchEngine(new EmbeddingEngine(config), {
    // Make results deterministic and threshold-inclusive
    minScore: 0,
    useRRF: true,
    bm25Weight: 0.5,
    semanticWeight: 0.5,
    topK: 50,
  });
}

describe('HybridSearchEngine', () => {
  describe('indexing', () => {
    it('indexes a document and reports stats', () => {
      const engine = makeEngine();
      engine.indexDocument('doc1', 'function getUserById user service');
      const stats = engine.getStats();
      expect(stats.documentCount).toBe(1);
      expect(stats.uniqueTokens).toBeGreaterThan(0);
    });

    it('indexes a batch of documents', () => {
      const engine = makeEngine();
      engine.indexDocuments([
        { id: 'a', text: 'function create order' },
        { id: 'b', text: 'function delete order' },
      ]);
      expect(engine.getStats().documentCount).toBe(2);
    });

    it('removes a document and cleans up inverted index', () => {
      const engine = makeEngine();
      engine.indexDocument('only', 'unique token here');
      const before = engine.getStats().uniqueTokens;
      engine.removeDocument('only');
      const after = engine.getStats();
      expect(after.documentCount).toBe(0);
      expect(after.uniqueTokens).toBeLessThan(before);
    });

    it('removeDocument is a no-op for unknown id', () => {
      const engine = makeEngine();
      expect(() => engine.removeDocument('missing')).not.toThrow();
    });

    it('clear resets all state', () => {
      const engine = makeEngine();
      engine.indexDocument('a', 'some content');
      engine.clear();
      const stats = engine.getStats();
      expect(stats.documentCount).toBe(0);
      expect(stats.uniqueTokens).toBe(0);
    });
  });

  describe('search', () => {
    it('returns results for matching query', async () => {
      const engine = makeEngine();
      engine.indexDocument('user1', 'function getUserById returns user record');
      engine.indexDocument('order1', 'function createOrder creates new order');
      const results = await engine.search('getUser');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBeDefined();
      expect(results[0]!.combinedScore).toBeGreaterThanOrEqual(0);
    });

    it('returns empty for empty index', async () => {
      const engine = makeEngine();
      const results = await engine.search('anything');
      expect(results).toHaveLength(0);
    });
  });

  describe('searchMultiSignal', () => {
    it('enriches results with additional signals', async () => {
      const engine = makeEngine();
      engine.indexDocument('getUser', 'function getUserById returns user');
      const results = await engine.searchMultiSignal('getUser');
      expect(results.length).toBeGreaterThan(0);
      const r = results[0]!;
      expect(r.scoreComponents).toBeDefined();
      expect(r.scoreComponents['exactMatch']).toBe(1.0);
    });

    it('computes exact match bonus as 0 for non-matching names', async () => {
      const engine = makeEngine();
      engine.indexDocument('someFunction', 'function someFunction does stuff');
      const results = await engine.searchMultiSignal('totally different');
      for (const r of results) {
        expect(r.scoreComponents['exactMatch']).toBe(0.0);
      }
    });

    it('applies minScore threshold filter', async () => {
      // Use a high threshold to ensure filtering works
      const engine = new HybridSearchEngine(new EmbeddingEngine(), {
        minScore: 999, // impossible threshold
      });
      engine.indexDocument('x', 'function x does something');
      const results = await engine.searchMultiSignal('x');
      expect(results).toHaveLength(0);
    });

    it('incorporates minHash signatures when available', async () => {
      const engine = makeEngine();
      engine.indexDocument('docA', 'function computeTotal value sum');
      const minHash = new Map<string, number[]>([
        ['__query__', [1, 2, 3, 4]],
        ['docA', [1, 2, 3, 4]], // identical → jaccard 1.0
      ]);
      const results = await engine.searchMultiSignal('computeTotal', undefined, minHash);
      expect(results.length).toBeGreaterThan(0);
      const r = results[0]!;
      expect(r.scoreComponents['minHash']).toBe(1.0);
    });
  });

  describe('searchMultiSignal ties', () => {
    it('orders two identically-scored documents by id, not by index order', async () => {
      // **The multi-signal path has a tie-break site of its own**, and it is the one a caller meets first: every
      // weighted signal is a function of the document's own text, so two documents with the same text land on the same
      // combined score. Without a tie the comparator's key function is never called at all.
      const engine = makeEngine();
      engine.indexDocument('zzz', 'function alpha beta');
      engine.indexDocument('aaa', 'function alpha beta');
      await engine.cacheDocumentEmbeddings([
        { id: 'zzz', text: 'function alpha beta' },
        { id: 'aaa', text: 'function alpha beta' },
      ]);

      const results = await engine.searchMultiSignal('alpha');
      expect(results.map((r) => r.id)).toEqual(['aaa', 'zzz']);
      expect(results[0]!.combinedScore).toBe(results[1]!.combinedScore);
    });
  });

  describe('cacheDocumentEmbeddings', () => {
    it('caches embeddings for documents', async () => {
      const engine = makeEngine();
      engine.indexDocument('a', 'function alpha');
      engine.indexDocument('b', 'function beta');
      await engine.cacheDocumentEmbeddings([
        { id: 'a', text: 'function alpha' },
        { id: 'b', text: 'function beta' },
      ]);
      expect(engine.getStats().cachedEmbeddings).toBe(2);
    });
  });

  describe('weighted-sum fusion (useRRF: false)', () => {
    it('combines bm25 and semantic scores by weighted sum', async () => {
      const engine = new HybridSearchEngine(new EmbeddingEngine(), {
        minScore: 0,
        useRRF: false,
        bm25Weight: 0.7,
        semanticWeight: 0.3,
        topK: 50,
      });
      engine.indexDocument('user1', 'function getUserById returns user record');
      const results = await engine.search('getUser');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.combinedScore).toBeGreaterThanOrEqual(0);
    });

    it('breaks an exact tie by document id, and gives the same answer for either insertion order', async () => {
      // **Two documents with the same text score identically in every signal**, because every signal is arithmetic
      // over the document's own text. The order between them therefore has to come from the corpus — and the only
      // thing a caller can check is that it does not come from whichever order the caller happened to index in.
      //
      // This is also the only test that reaches the id-keyed comparator: `sortByScoreThenKey` calls the key function
      // only on a tie, so the four tie-break sites in this class were uncovered code until a tie existed to test.
      const first = new HybridSearchEngine(new EmbeddingEngine(), {
        minScore: 0,
        useRRF: false,
        topK: 50,
      });
      first.indexDocument('zzz', 'function alpha beta');
      first.indexDocument('aaa', 'function alpha beta');
      await first.cacheDocumentEmbeddings([
        { id: 'zzz', text: 'function alpha beta' },
        { id: 'aaa', text: 'function alpha beta' },
      ]);

      const second = new HybridSearchEngine(new EmbeddingEngine(), {
        minScore: 0,
        useRRF: false,
        topK: 50,
      });
      second.indexDocument('aaa', 'function alpha beta');
      second.indexDocument('zzz', 'function alpha beta');
      await second.cacheDocumentEmbeddings([
        { id: 'aaa', text: 'function alpha beta' },
        { id: 'zzz', text: 'function alpha beta' },
      ]);

      const one = await first.search('alpha');
      const two = await second.search('alpha');
      expect(one.map((r) => r.id)).toEqual(['aaa', 'zzz']);
      expect(two.map((r) => r.id)).toEqual(one.map((r) => r.id));
      // And the scores really were equal, or this would be an ordering test that never saw a tie.
      expect(one[0]!.combinedScore).toBe(one[1]!.combinedScore);
    });

    it('returns results ordered by combined score', async () => {
      const engine = new HybridSearchEngine(new EmbeddingEngine(), {
        minScore: 0,
        useRRF: false,
        topK: 50,
      });
      engine.indexDocument('a', 'function alpha beta gamma');
      engine.indexDocument('b', 'function alpha');
      const results = await engine.search('alpha');
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.combinedScore).toBeGreaterThanOrEqual(results[i]!.combinedScore);
      }
    });
  });

  describe('semantic-only results (no lexical overlap)', () => {
    it('includes documents matched only by semantic similarity', async () => {
      const engine = makeEngine();
      engine.indexDocument('semanticDoc', 'function zzzalpha zzzbeta');
      await engine.cacheDocumentEmbeddings([
        { id: 'semanticDoc', text: 'function zzzalpha zzzbeta' },
      ]);
      // Query shares no token with the indexed document, so BM25 yields nothing;
      // only the cached semantic vector contributes.
      const results = await engine.search('qqqunrelated');
      const matched = results.find((r) => r.id === 'semanticDoc');
      expect(matched).toBeDefined();
      expect(matched!.bm25Score).toBe(0);
    });
  });

  describe('removeDocument inverted-index cleanup', () => {
    it('deletes a token from the inverted index when its last document is removed', () => {
      const engine = makeEngine();
      engine.indexDocument('only', 'exclusivetoken');
      expect(engine.getStats().uniqueTokens).toBeGreaterThan(0);
      engine.removeDocument('only');
      expect(engine.getStats().uniqueTokens).toBe(0);
      expect(engine.getStats().documentCount).toBe(0);
      expect(engine.getStats().avgDocLength).toBe(0);
    });

    it('keeps a token when another document still uses it', () => {
      const engine = makeEngine();
      engine.indexDocument('a', 'sharedtoken');
      engine.indexDocument('b', 'sharedtoken');
      engine.removeDocument('a');
      expect(engine.getStats().uniqueTokens).toBe(1);
    });
  });

  describe('minHash signal edge cases', () => {
    it('skips minHash when the query signature is missing', async () => {
      const engine = makeEngine();
      engine.indexDocument('docA', 'function computeTotal value');
      const minHash = new Map<string, number[]>([['docA', [1, 2, 3, 4]]]); // no '__query__'
      const results = await engine.searchMultiSignal('computeTotal', undefined, minHash);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.scoreComponents['minHash']).toBeUndefined();
    });

    it('skips minHash when the document signature is missing', async () => {
      const engine = makeEngine();
      engine.indexDocument('docA', 'function computeTotal value');
      const minHash = new Map<string, number[]>([['__query__', [1, 2, 3, 4]]]);
      const results = await engine.searchMultiSignal('computeTotal', undefined, minHash);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.scoreComponents['minHash']).toBeUndefined();
    });

    it('computes partial Jaccard for mismatched signatures', async () => {
      const engine = makeEngine();
      engine.indexDocument('docA', 'function computeTotal value');
      const minHash = new Map<string, number[]>([
        ['__query__', [1, 2, 3, 4]],
        ['docA', [1, 2, 0, 0]],
      ]);
      const results = await engine.searchMultiSignal('computeTotal', undefined, minHash);
      const r = results.find((x) => x.id === 'docA')!;
      expect(r.scoreComponents['minHash']).toBeCloseTo(0.5);
    });

    it('yields 0 Jaccard for empty signatures', async () => {
      const engine = makeEngine();
      engine.indexDocument('docA', 'function computeTotal value');
      const minHash = new Map<string, number[]>([
        ['__query__', []],
        ['docA', []],
      ]);
      const results = await engine.searchMultiSignal('computeTotal', undefined, minHash);
      const r = results.find((x) => x.id === 'docA')!;
      expect(r.scoreComponents['minHash']).toBe(0);
    });
  });
});

describe('MockEmbeddingBackend', () => {
  it('produces deterministic embeddings for identical input', async () => {
    const backend = new MockEmbeddingBackend();
    const a = await backend.embedCode('function foo');
    const b = await backend.embedCode('function foo');
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(768);
  });

  it('produces different embeddings for different input', async () => {
    const backend = new MockEmbeddingBackend();
    const a = await backend.embedCode('function foo');
    const b = await backend.embedCode('function completelyDifferent');
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('handles empty content without throwing', async () => {
    const backend = new MockEmbeddingBackend();
    const v = await backend.embedCode('');
    expect(v.length).toBe(768);
  });

  it('batch embeds in order', async () => {
    const backend = new MockEmbeddingBackend();
    const vecs = await backend.embedBatch(['a', 'b', 'c']);
    expect(vecs).toHaveLength(3);
  });
});

describe('EmbeddingEngine', () => {
  it('computes cosine similarity', () => {
    const engine = new EmbeddingEngine();
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(engine.cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    const engine = new EmbeddingEngine();
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(engine.cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('throws on dimension mismatch', () => {
    const engine = new EmbeddingEngine();
    expect(() => engine.cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1]))).toThrow(
      /dimension mismatch/i,
    );
  });

  it('stores and retrieves embeddings', () => {
    const engine = new EmbeddingEngine();
    engine.storeEmbedding(1, new Float32Array([1, 2, 3]));
    expect(engine.getEmbedding(1)).not.toBeNull();
    expect(engine.getEmbedding(999)).toBeNull();
    expect(engine.embeddingCount).toBe(1);
  });

  it('imports embeddings from arrays', () => {
    const engine = new EmbeddingEngine();
    engine.importEmbeddings([{ nodeId: 5, embedding: [1, 2, 3] }]);
    expect(engine.getEmbedding(5)).not.toBeNull();
  });
});
