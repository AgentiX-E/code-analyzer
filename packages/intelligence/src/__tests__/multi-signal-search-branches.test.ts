// @code-analyzer/intelligence — Hybrid Search Branch Tests
// Exercises the searchSemantic null-embedding path, cacheDocumentEmbeddings
// null-vector path, fusion minScore filtering, and the private signature /
// module-proximity helpers that the happy-path suite never reaches.

import { describe, it, expect } from 'vitest';
import { HybridSearchEngine } from '../search/multi-signal-search.js';
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

function engineWith(config?: Partial<ConstructorParameters<typeof HybridSearchEngine>[1]>) {
  return new HybridSearchEngine(mockEngine(), config);
}

describe('HybridSearchEngine — branch coverage', () => {
  describe('searchSemantic null embedding', () => {
    it('returns no results when the embedding backend yields null', async () => {
      // embedCode returning null exercises the `if (!queryEmbedding) return []`
      // guard inside searchSemantic.
      const engine = new HybridSearchEngine(
        mockEngine({ embedCode: async () => null as unknown as Float32Array }),
        { minScore: 0, useRRF: true, topK: 50 },
      );
      engine.indexDocument('doc', 'function getUserById');

      const results = await engine.search('getUser');
      // BM25 matches, but semantic yields nothing; fusion still runs on the
      // lexical-only result set.
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.semanticScore).toBe(0);
    });
  });

  describe('cacheDocumentEmbeddings null vectors', () => {
    it('skips a null vector returned by embedBatch', async () => {
      // A null vector in the batch exercises the `if (vectors[i])` guard.
      const engine = new HybridSearchEngine(
        mockEngine({
          embedBatch: async () => [new Float32Array([1, 0, 0]), null as unknown as Float32Array],
        }),
      );
      engine.indexDocument('a', 'function alpha');
      engine.indexDocument('b', 'function beta');

      await engine.cacheDocumentEmbeddings([
        { id: 'a', text: 'function alpha' },
        { id: 'b', text: 'function beta' },
      ]);

      // Only the first (non-null) vector is cached.
      expect(engine.getStats().cachedEmbeddings).toBe(1);
    });
  });

  describe('fusion minScore filtering', () => {
    it('drops results whose fused score is below the threshold', async () => {
      // An impossible threshold makes every `combinedScore >= minScore` check
      // false during fuseResults, exercising that branch.
      const engine = new HybridSearchEngine(mockEngine(), {
        minScore: 999,
        useRRF: true,
        bm25Weight: 0.5,
        semanticWeight: 0.5,
        topK: 50,
      });
      engine.indexDocument('doc', 'function getUser user service');

      const results = await engine.search('getUser');
      expect(results).toHaveLength(0);
    });
  });

  describe('private scoring helpers', () => {
    it('computes Jaccard signature match for overlapping tokens', () => {
      const engine = engineWith() as unknown as {
        computeSignatureMatch: (q: string, s: string) => number;
      };
      // "getuser" tokenizes identically in both query and signature.
      const exact = engine.computeSignatureMatch('getUser', 'getUser');
      expect(exact).toBeGreaterThan(0);
    });

    it('returns 0 signature match when both inputs have no tokens', () => {
      const engine = engineWith() as unknown as {
        computeSignatureMatch: (q: string, s: string) => number;
      };
      // Empty inputs produce an empty union, driving the `union.size > 0 ? … : 0`
      // ternary's false branch.
      expect(engine.computeSignatureMatch('', '')).toBe(0);
    });

    it('returns 0 module proximity when no query term appears in the path', () => {
      const engine = engineWith() as unknown as {
        computeModuleProximity: (q: string, p: string) => number;
      };
      expect(engine.computeModuleProximity('getUser', 'src/order/service.ts')).toBe(0);
    });

    it('returns 1 module proximity when all query terms appear in the path', () => {
      const engine = engineWith() as unknown as {
        computeModuleProximity: (q: string, p: string) => number;
      };
      expect(engine.computeModuleProximity('getuser', 'src/getuser/service.ts')).toBe(1);
    });

    it('returns 0 module proximity for an empty query', () => {
      const engine = engineWith() as unknown as {
        computeModuleProximity: (q: string, p: string) => number;
      };
      // No query terms drives the `queryTerms.length > 0 ? … : 0` false branch.
      expect(engine.computeModuleProximity('', 'src/service.ts')).toBe(0);
    });
  });
});
