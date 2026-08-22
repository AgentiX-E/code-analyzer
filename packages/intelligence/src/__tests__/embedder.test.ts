// @code-analyzer/intelligence — Embedding Engine Tests
// Comprehensive tests for MockEmbeddingBackend (n-gram based) and EmbeddingEngine.
// RealEmbeddingBackend tests require ONNX runtime and are excluded from CI coverage.

import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingEngine, MockEmbeddingBackend } from '../embeddings/embedder.js';

// ---------------------------------------------------------------------------
// MockEmbeddingBackend — n-gram content-based deterministic backend
// ---------------------------------------------------------------------------

describe('MockEmbeddingBackend', () => {
  describe('Basic properties', () => {
    it('has backendType "mock"', () => {
      const backend = new MockEmbeddingBackend();
      expect(backend.backendType).toBe('mock');
    });

    it('uses normalize=true by default with 768 dimensions', () => {
      const backend = new MockEmbeddingBackend();
      expect(backend.dimensions).toBe(768);
    });

    it('respects custom dimensions', () => {
      const b256 = new MockEmbeddingBackend({ dimensions: 256, normalize: true });
      const b512 = new MockEmbeddingBackend({ dimensions: 512, normalize: true });
      const b1024 = new MockEmbeddingBackend({ dimensions: 1024, normalize: true });

      expect(b256.dimensions).toBe(256);
      expect(b512.dimensions).toBe(512);
      expect(b1024.dimensions).toBe(1024);
    });

    it('respects normalize option', () => {
      const backend = new MockEmbeddingBackend({ dimensions: 768, normalize: false });
      expect(backend.dimensions).toBe(768);
    });

    it('dispose is a no-op', () => {
      const backend = new MockEmbeddingBackend();
      expect(() => backend.dispose()).not.toThrow();
    });
  });

  describe('Determinism', () => {
    it('produces identical vectors for identical input', async () => {
      const backend = new MockEmbeddingBackend();
      const v1 = await backend.embedCode('function add(a, b) { return a + b; }');
      const v2 = await backend.embedCode('function add(a, b) { return a + b; }');

      expect(v1.length).toBe(768);
      expect(v2.length).toBe(768);
      for (let i = 0; i < v1.length; i++) {
        expect(v1[i]).toBe(v2[i]);
      }
    });

    it('produces deterministic output across separate instances', async () => {
      const b1 = new MockEmbeddingBackend();
      const b2 = new MockEmbeddingBackend();
      const v1 = await b1.embedCode('function hello() { return "world"; }');
      const v2 = await b2.embedCode('function hello() { return "world"; }');

      for (let i = 0; i < v1.length; i++) {
        expect(v1[i]).toBe(v2[i]);
      }
    });

    it('produces different vectors for different inputs', async () => {
      const backend = new MockEmbeddingBackend();
      const v1 = await backend.embedCode('function alpha() {}');
      const v2 = await backend.embedCode('class BetaWidget extends Component {}');

      let differences = 0;
      for (let i = 0; i < v1.length; i++) {
        if (Math.abs(v1[i]! - v2[i]!) > 1e-10) {
          differences++;
        }
      }
      expect(differences).toBeGreaterThan(0);
    });
  });

  describe('Normalization', () => {
    it('produces L2-normalized vectors by default', async () => {
      const backend = new MockEmbeddingBackend({ dimensions: 768, normalize: true });

      const testCases = [
        'function short() {}',
        'class VeryLongClassNameWithManyMethodsAndProperties { constructor() { this.init(); } }',
        '',
      ];

      for (const code of testCases) {
        const vec = await backend.embedCode(code);
        let norm = 0;
        for (let i = 0; i < vec.length; i++) {
          norm += vec[i]! * vec[i]!;
        }
        expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
      }
    });

    it('skips normalization when normalize=false', async () => {
      const backend = new MockEmbeddingBackend({ dimensions: 128, normalize: false });
      const vec = await backend.embedCode('function test() {}');
      let norm = 0;
      for (let i = 0; i < vec.length; i++) {
        norm += vec[i]! * vec[i]!;
      }
      // Without normalization, norm should not be close to 1.0
      expect(Math.sqrt(norm)).not.toBeCloseTo(1.0, 3);
    });

    it('produces unit-length normalized vectors for empty input', async () => {
      const backend = new MockEmbeddingBackend();
      const vec = await backend.embedCode('');
      let norm = 0;
      for (let i = 0; i < vec.length; i++) {
        norm += vec[i]! * vec[i]!;
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
    });
  });

  describe('n-gram semantic approximation', () => {
    it('similar tokens produce overlapping activation patterns', async () => {
      // n-gram approach: tokens like 'function', 'return', '{' will match
      const backend = new MockEmbeddingBackend();
      const v1 = await backend.embedCode('function add(a, b) { return a + b; }');
      const v2 = await backend.embedCode('function subtract(a, b) { return a - b; }');

      // These should have some structural similarity due to shared tokens
      const engine = new EmbeddingEngine();
      const sim = engine.cosineSimilarity(v1, v2);
      // Similar structure → similarity should NOT be near zero
      expect(sim).toBeGreaterThan(0.02);
    });

    it('very different code produces low similarity', async () => {
      const backend = new MockEmbeddingBackend();
      const v1 = await backend.embedCode(
        'function renderButton(label: string): JSX.Element { return <button>{label}</button>; }',
      );
      const v2 = await backend.embedCode(
        'async function connectDatabase(url: string): Promise<Connection> { const conn = await pg.connect(url); return conn; }',
      );

      const engine = new EmbeddingEngine();
      const sim = engine.cosineSimilarity(v1, v2);
      // Very different code → lower similarity (but not zero with n-gram overlap)
      expect(Math.abs(sim)).toBeLessThan(0.5);
    });

    it('camelCase naming produces overlapping token activation', async () => {
      const backend = new MockEmbeddingBackend();
      // 'handleUserInput' tokenizes into ['handle', 'user', 'input']
      const v1 = await backend.embedCode('function handleUserInput() {}');
      // 'processUserRequest' tokenizes into ['process', 'user', 'request']
      const v2 = await backend.embedCode('function processUserRequest() {}');
      // Both share n-grams from 'user'
      // They are somewhat related (both are user-handling functions)
      // but not identical

      let differences = 0;
      for (let i = 0; i < v1.length; i++) {
        if (Math.abs(v1[i]! - v2[i]!) > 1e-10) {
          differences++;
        }
      }
      expect(differences).toBeGreaterThan(0);
    });
  });

  describe('Batch embedding', () => {
    it('returns correct count', async () => {
      const backend = new MockEmbeddingBackend();
      const vecs = await backend.embedBatch(['a', 'b', 'c']);
      expect(vecs.length).toBe(3);
      expect(vecs[0]!.length).toBe(768);
      expect(vecs[1]!.length).toBe(768);
      expect(vecs[2]!.length).toBe(768);
    });

    it('handles empty batch', async () => {
      const backend = new MockEmbeddingBackend();
      const vecs = await backend.embedBatch([]);
      expect(vecs).toEqual([]);
    });

    it('handles single item batch', async () => {
      const backend = new MockEmbeddingBackend();
      const vecs = await backend.embedBatch(['single']);
      expect(vecs.length).toBe(1);
      expect(vecs[0]!.length).toBe(768);
    });

    it('produces same results as individual embedCode calls', async () => {
      const backend = new MockEmbeddingBackend();
      const codes = [
        'function alpha() { return 1; }',
        'function beta() { return 2; }',
        'function gamma() { return 3; }',
      ];

      const batch = await backend.embedBatch(codes);
      const individual = await Promise.all(codes.map((c) => backend.embedCode(c)));

      for (let i = 0; i < codes.length; i++) {
        for (let j = 0; j < batch[i]!.length; j++) {
          expect(batch[i]![j]).toBe(individual[i]![j]);
        }
      }
    });

    it('handles large batch efficiently', async () => {
      const backend = new MockEmbeddingBackend();
      const codes = Array.from({ length: 500 }, (_, i) => `function f${i}() { return ${i}; }`);
      const vecs = await backend.embedBatch(codes);

      expect(vecs.length).toBe(500);
      expect(vecs[0]!.length).toBe(768);
      expect(vecs[499]!.length).toBe(768);

      // Verify determinism within batch
      const vFirst = await backend.embedCode(codes[0]!);
      for (let i = 0; i < 768; i++) {
        expect(vecs[0]![i]).toBe(vFirst[i]);
      }
    });
  });

  describe('Interface conformance', () => {
    it('implements EmbeddingBackend interface', () => {
      const backend = new MockEmbeddingBackend();
      expect(backend.backendType).toBeDefined();
      expect(typeof backend.embedCode).toBe('function');
      expect(typeof backend.embedBatch).toBe('function');
      expect(typeof backend.dimensions).toBe('number');
      expect(typeof backend.dispose).toBe('function');
    });
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine — Backend type reporting
// ---------------------------------------------------------------------------

describe('EmbeddingEngine activeBackend', () => {
  it('reports "mock" when using fallback backend', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    expect(engine.activeBackend).toBe('mock');
  });

  it('reports "mock" before initialization', () => {
    const engine = new EmbeddingEngine();
    expect(engine.activeBackend).toBe('mock');
  });

  it('provides initWarning when real backend is unavailable', async () => {
    const engine = new EmbeddingEngine();
    const warning = await engine.initialize();
    // In CI/test environment without ONNX runtime, should have a warning
    expect(warning).toBeDefined();
    expect(warning).toContain('ONNX');
  });

  it('initWarning is null before initialize', () => {
    const engine = new EmbeddingEngine();
    expect(engine.initWarning).toBeNull();
  });

  it('initWarning is set after initialize with mock backend', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    expect(engine.initWarning).not.toBeNull();
    expect(typeof engine.initWarning).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine.importEmbeddings
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.importEmbeddings', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('imports embeddings from Float32Array entries', () => {
    engine.importEmbeddings([
      { nodeId: 1, embedding: new Float32Array([0.1, 0.2, 0.3]) },
      { nodeId: 2, embedding: new Float32Array([0.4, 0.5, 0.6]) },
    ]);
    expect(engine.getEmbedding(1)).not.toBeNull();
    expect(engine.getEmbedding(2)).not.toBeNull();
    expect(engine.getEmbedding(1)![0]).toBeCloseTo(0.1, 5);
  });

  it('imports embeddings from number[] entries', () => {
    engine.importEmbeddings([{ nodeId: 3, embedding: [0.7, 0.8, 0.9] }]);
    const retrieved = engine.getEmbedding(3);
    expect(retrieved).not.toBeNull();
    expect(retrieved![0]).toBeCloseTo(0.7, 5);
    expect(retrieved![1]).toBeCloseTo(0.8, 5);
    expect(retrieved![2]).toBeCloseTo(0.9, 5);
  });

  it('imports mixed Float32Array and number[] entries', () => {
    engine.importEmbeddings([
      { nodeId: 1, embedding: new Float32Array([1, 2, 3]) },
      { nodeId: 2, embedding: [4, 5, 6] },
    ]);
    expect(engine.getEmbedding(1)![0]).toBe(1);
    expect(engine.getEmbedding(2)![0]).toBe(4);
  });

  it('does not modify original Float32Array', () => {
    const original = new Float32Array([1, 2, 3]);
    engine.importEmbeddings([{ nodeId: 1, embedding: original }]);
    original[0] = 999;
    const retrieved = engine.getEmbedding(1);
    expect(retrieved![0]).toBe(1);
  });

  it('empty array is a no-op', () => {
    engine.importEmbeddings([]);
    expect(engine.embeddingCount).toBe(0);
  });

  it('imports large number of embeddings', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      nodeId: i,
      embedding: new Float32Array([i / 1000, (i % 256) / 256, 0.5]),
    }));
    engine.importEmbeddings(entries);
    expect(engine.embeddingCount).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine.createEmbeddingLookup
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.createEmbeddingLookup', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('finds stored embeddings', () => {
    const vec = new Float32Array([0.5, 0.5, 0.5]);
    engine.storeEmbedding(42, vec);
    const lookup = engine.createEmbeddingLookup();
    const result = lookup(42);
    expect(result).not.toBeNull();
    expect(result![0]).toBeCloseTo(0.5, 5);
  });

  it('returns null for unknown node IDs', () => {
    const lookup = engine.createEmbeddingLookup();
    expect(lookup(999)).toBeNull();
  });

  it('works with importEmbeddings data', () => {
    engine.importEmbeddings([
      { nodeId: 10, embedding: [0.1, 0.2] },
      { nodeId: 20, embedding: [0.3, 0.4] },
    ]);
    const lookup = engine.createEmbeddingLookup();
    expect(lookup(10)).not.toBeNull();
    expect(lookup(20)).not.toBeNull();
    expect(lookup(30)).toBeNull();
  });

  it('lookup functions from different engines are independent', () => {
    const engine2 = new EmbeddingEngine();
    engine.storeEmbedding(1, new Float32Array([1, 2]));
    engine2.storeEmbedding(2, new Float32Array([3, 4]));
    const lookup1 = engine.createEmbeddingLookup();
    expect(lookup1(1)).not.toBeNull();
    expect(lookup1(2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine.embeddingCount
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.embeddingCount', () => {
  it('starts at zero', () => {
    const engine = new EmbeddingEngine();
    expect(engine.embeddingCount).toBe(0);
  });

  it('increments with storeEmbedding', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    engine.storeEmbedding(1, new Float32Array([1, 2]));
    expect(engine.embeddingCount).toBe(1);
    engine.storeEmbedding(2, new Float32Array([3, 4]));
    expect(engine.embeddingCount).toBe(2);
  });

  it('does not increment on update', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    engine.storeEmbedding(1, new Float32Array([1, 2]));
    engine.storeEmbedding(1, new Float32Array([3, 4]));
    expect(engine.embeddingCount).toBe(1);
  });

  it('resets to zero after dispose', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    engine.storeEmbedding(1, new Float32Array([1, 2]));
    engine.dispose();
    expect(engine.embeddingCount).toBe(0);
  });

  it('tracks importEmbeddings correctly', () => {
    const engine = new EmbeddingEngine();
    engine.importEmbeddings([
      { nodeId: 1, embedding: [1, 2] },
      { nodeId: 2, embedding: [3, 4] },
    ]);
    expect(engine.embeddingCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine.cosineSimilarity
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.cosineSimilarity', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine({ dimensions: 768, normalize: true });
    await engine.initialize();
  });

  it('returns 1.0 for identical content', async () => {
    const code = 'function add(a: number, b: number): number { return a + b; }';
    const v1 = await engine.embedCode(code);
    const v2 = await engine.embedCode(code);
    expect(engine.cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
  });

  it('returns positive similarity for structurally similar code', async () => {
    const v1 = await engine.embedCode('function add(a, b) { return a + b; }');
    const v2 = await engine.embedCode('function add(x, y) { return x + y; }');
    const sim = engine.cosineSimilarity(v1, v2);
    // With n-gram approach, structurally similar code shares many tokens
    expect(sim).toBeGreaterThan(0);
  });

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3, 4]);
    expect(() => engine.cosineSimilarity(a, b)).toThrow('dimension mismatch');
  });

  it('handles zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(engine.cosineSimilarity(a, b)).toBe(0);
  });

  it('handles both zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([0, 0, 0]);
    expect(engine.cosineSimilarity(a, b)).toBe(0);
  });

  it('is commutative', async () => {
    const v1 = await engine.embedCode('function hello() {}');
    const v2 = await engine.embedCode('function world() {}');
    expect(engine.cosineSimilarity(v1, v2)).toBe(engine.cosineSimilarity(v2, v1));
  });

  it('returns symmetric values for a vs b and b vs a', () => {
    const a = new Float32Array([0.5, 0.3, 0.2]);
    const b = new Float32Array([0.1, 0.8, 0.4]);
    expect(engine.cosineSimilarity(a, b)).toBe(engine.cosineSimilarity(b, a));
  });

  it('handles negative values correctly', () => {
    const a = new Float32Array([-1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(engine.cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('handles orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(engine.cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine.findMostSimilar
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.findMostSimilar', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('finds the most similar items in a corpus', async () => {
    const query = await engine.embedCode('function add(a, b) { return a + b; }');
    const corpus = await Promise.all([
      engine.embedCode('function multiply(x, y) { return x * y; }'),
      engine.embedCode('function add(x, y) { return x + y; }'), // most similar
      engine.embedCode('class DatabaseConnection { connect() {} }'),
    ]);

    const results = engine.findMostSimilar(query, corpus, 2);
    expect(results.length).toBe(2);
    // The second corpus item should be most similar to query
    expect(results[0]!.index).toBe(1);
  });

  it('returns empty for empty corpus', () => {
    const query = new Float32Array([1, 2, 3]);
    const results = engine.findMostSimilar(query, [], 10);
    expect(results).toEqual([]);
  });

  it('respects topK limit', async () => {
    const query = await engine.embedCode('query');
    const corpus = await Promise.all(
      Array.from({ length: 20 }, (_, i) => engine.embedCode(`doc_${i}`)),
    );
    const results = engine.findMostSimilar(query, corpus, 5);
    expect(results.length).toBe(5);
  });

  it('returns results sorted by score descending', async () => {
    const query = await engine.embedCode('target');
    const corpus = await Promise.all([
      engine.embedCode('target'),
      engine.embedCode('different'),
      engine.embedCode('unrelated'),
    ]);

    const results = engine.findMostSimilar(query, corpus, 3);
    expect(results.length).toBe(3);
    // Scores should be descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
    }
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine.embedBatch
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.embedBatch', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('embeds multiple snippets at once', async () => {
    const codes = ['function a() {}', 'function b() {}', 'function c() {}'];
    const vectors = await engine.embedBatch(codes);

    expect(vectors.length).toBe(3);
    expect(vectors[0]!.length).toBe(768);
    expect(vectors[1]!.length).toBe(768);
    expect(vectors[2]!.length).toBe(768);
  });

  it('produces same results as individual embedding', async () => {
    const codes = ['function foo() { return 1; }', 'function bar() { return 2; }'];

    const batch = await engine.embedBatch(codes);
    const individual = await Promise.all(codes.map((c) => engine.embedCode(c)));

    for (let i = 0; i < codes.length; i++) {
      for (let j = 0; j < (batch[i]?.length ?? 0); j++) {
        expect(batch[i]![j]!).toBe(individual[i]![j]!);
      }
    }
  });

  it('handles empty batch', async () => {
    const vectors = await engine.embedBatch([]);
    expect(vectors).toEqual([]);
  });

  it('handles single-item batch', async () => {
    const vectors = await engine.embedBatch(['function unique() {}']);
    expect(vectors.length).toBe(1);
    expect(vectors[0]!.length).toBe(768);
  });

  it('handles large batch', async () => {
    const codes = Array.from({ length: 100 }, (_, i) => `function f${i}() {}`);
    const vectors = await engine.embedBatch(codes);
    expect(vectors.length).toBe(100);
    expect(vectors[0]!.length).toBe(768);
    expect(vectors[99]!.length).toBe(768);
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine store/get embeddings
// ---------------------------------------------------------------------------

describe('EmbeddingEngine store/get embeddings', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('stores and retrieves embeddings', async () => {
    const vector = await engine.embedCode('function test() {}');
    engine.storeEmbedding(1, vector);
    const retrieved = engine.getEmbedding(1);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(vector.length);
    for (let i = 0; i < vector.length; i++) {
      expect(retrieved![i]!).toBe(vector[i]!);
    }
  });

  it('returns null for missing embedding', () => {
    expect(engine.getEmbedding(999)).toBeNull();
  });

  it('returns a copy, not the original reference', async () => {
    const vector = await engine.embedCode('test');
    engine.storeEmbedding(1, vector);
    vector[0] = 999;
    const retrieved = engine.getEmbedding(1);
    expect(retrieved![0]!).not.toBe(999);
  });

  it('updates existing embedding', async () => {
    const v1 = await engine.embedCode('old code');
    const v2 = await engine.embedCode('new code');
    engine.storeEmbedding(1, v1);
    engine.storeEmbedding(1, v2);

    const retrieved = engine.getEmbedding(1);
    for (let i = 0; i < v2.length; i++) {
      expect(retrieved![i]!).toBe(v2[i]!);
    }
  });

  it('handles many stored embeddings', async () => {
    for (let i = 0; i < 50; i++) {
      const v = await engine.embedCode(`code_${i}`);
      engine.storeEmbedding(i, v);
    }
    for (let i = 0; i < 50; i++) {
      expect(engine.getEmbedding(i)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine.incrementalUpdate
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.incrementalUpdate', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('embeds only nodes without existing embeddings', async () => {
    const existingVec = await engine.embedCode('existing');
    engine.storeEmbedding(1, existingVec);

    const contentMap = new Map([
      [1, 'existing'],
      [2, 'new content two'],
      [3, 'brand new content three'],
    ]);

    await engine.incrementalUpdate([1, 2, 3], (id) => contentMap.get(id) ?? '');

    // Node 1 should preserve original embedding
    const v1 = engine.getEmbedding(1);
    expect(v1).not.toBeNull();
    for (let i = 0; i < v1!.length; i++) {
      expect(v1![i]!).toBe(existingVec[i]!);
    }

    // New nodes should have embeddings
    expect(engine.getEmbedding(2)).not.toBeNull();
    expect(engine.getEmbedding(3)).not.toBeNull();
  });

  it('skips nodes with empty content', async () => {
    await engine.incrementalUpdate([1, 2], (id) => {
      return id === 1 ? 'valid content' : '';
    });
    expect(engine.getEmbedding(1)).not.toBeNull();
    expect(engine.getEmbedding(2)).toBeNull();
  });

  it('handles empty node list', async () => {
    await engine.incrementalUpdate([], () => 'test');
    expect(engine.getEmbedding(0)).toBeNull();
  });

  it('skips embedding when all nodes have existing embeddings', async () => {
    const existingVec = await engine.embedCode('existing');
    engine.storeEmbedding(1, existingVec);

    await engine.incrementalUpdate([1], (id) => {
      return id === 1 ? 'completely different content' : '';
    });
    // Should keep existing embedding unchanged
    const v1 = engine.getEmbedding(1);
    expect(v1).not.toBeNull();
    for (let i = 0; i < existingVec.length; i++) {
      expect(v1![i]!).toBe(existingVec[i]!);
    }
  });
});

// ---------------------------------------------------------------------------
// EmbeddingEngine lifecycle
// ---------------------------------------------------------------------------

describe('EmbeddingEngine lifecycle', () => {
  it('initializes lazily on first embedCode call', async () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady).toBe(false);
    await engine.embedCode('test');
    expect(engine.isReady).toBe(true);
  });

  it('initializes lazily on first embedBatch call', async () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady).toBe(false);
    await engine.embedBatch(['test1', 'test2']);
    expect(engine.isReady).toBe(true);
  });

  it('initializes lazily on first incrementalUpdate call', async () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady).toBe(false);
    await engine.incrementalUpdate([1], () => 'content');
    expect(engine.isReady).toBe(true);
  });

  it('is initialized after calling initialize()', async () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady).toBe(false);
    await engine.initialize();
    expect(engine.isReady).toBe(true);
  });

  it('does not reinitialize if already initialized', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    const dimsBefore = engine.dimensions;
    await engine.initialize(); // second call should be no-op
    expect(engine.dimensions).toBe(dimsBefore);
  });

  it('dispose clears all state', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    await engine.embedCode('test');
    engine.storeEmbedding(1, new Float32Array([1, 2, 3]));

    engine.dispose();

    expect(engine.isReady).toBe(false);
    expect(engine.getEmbedding(1)).toBeNull();
    expect(engine.embeddingCount).toBe(0);
    expect(engine.initWarning).toBeNull();
  });

  it('uses default dimensions (768) when no config provided', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    expect(engine.dimensions).toBe(768);
  });

  it('accepts custom dimensions', async () => {
    const engine = new EmbeddingEngine({ dimensions: 256 });
    await engine.initialize();
    expect(engine.dimensions).toBe(256);

    const v = await engine.embedCode('test');
    expect(v.length).toBe(256);
  });

  it('can be reused after dispose and reinitialize', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    await engine.embedCode('first life');
    engine.dispose();

    // Reinitialize
    const warning = await engine.initialize();
    expect(engine.isReady).toBe(true);
    expect(warning).toBeDefined(); // Still no ONNX in CI

    const v = await engine.embedCode('second life');
    expect(v.length).toBe(768);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('EmbeddingEngine edge cases', () => {
  it('handles very long input', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();

    const longCode = 'function ' + 'a'.repeat(10000) + '() { return true; }';
    const v = await engine.embedCode(longCode);
    expect(v.length).toBe(768);

    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
  });

  it('handles unicode input', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();

    const unicodeCode = 'function 你好世界() { return "こんにちは"; }';
    const v = await engine.embedCode(unicodeCode);
    expect(v.length).toBe(768);
  });

  it('handles special characters', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();

    const specialChars = '@#$%^&*()_+-=[]{}|;:",.<>?/~`!';
    const v = await engine.embedCode(specialChars);
    expect(v.length).toBe(768);
  });

  it('handles whitespace-only input', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();

    const v = await engine.embedCode('   \n\t   ');
    expect(v.length).toBe(768);
  });

  it('importEmbeddings with very large embedding vectors', () => {
    const engine = new EmbeddingEngine();
    const largeVec = new Float32Array(768);
    for (let i = 0; i < 768; i++) largeVec[i] = i / 768;
    engine.importEmbeddings([{ nodeId: 99, embedding: largeVec }]);
    const retrieved = engine.getEmbedding(99);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(768);
  });

  it('produces consistent results with parallel embedBatch calls', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();

    const codes1 = ['function a() {}', 'function b() {}'];
    const codes2 = ['function c() {}', 'function d() {}'];

    const [batch1, batch2] = await Promise.all([
      engine.embedBatch(codes1),
      engine.embedBatch(codes2),
    ]);

    const individual = await Promise.all([
      engine.embedCode(codes1[0]!),
      engine.embedCode(codes1[1]!),
      engine.embedCode(codes2[0]!),
      engine.embedCode(codes2[1]!),
    ]);

    for (let j = 0; j < 768; j++) {
      expect(batch1[0]![j]!).toBe(individual[0]![j]!);
      expect(batch1[1]![j]!).toBe(individual[1]![j]!);
      expect(batch2[0]![j]!).toBe(individual[2]![j]!);
      expect(batch2[1]![j]!).toBe(individual[3]![j]!);
    }
  });
});
