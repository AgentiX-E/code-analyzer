// @code-analyzer/intelligence — Embedding Engine Tests

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmbeddingEngine,
  MockEmbeddingBackend,
} from '../embeddings/embedder.js';

// ---------------------------------------------------------------------------
// MockEmbeddingBackend — direct tests
// ---------------------------------------------------------------------------

describe('MockEmbeddingBackend', () => {
  it('has backendType "mock"', () => {
    const backend = new MockEmbeddingBackend();
    expect(backend.backendType).toBe('mock');
  });

  it('respects custom dimensions', () => {
    const backend = new MockEmbeddingBackend({ dimensions: 256, normalize: true });
    expect(backend.dimensions).toBe(256);
  });

  it('embedCode returns normalized vectors by default', async () => {
    const backend = new MockEmbeddingBackend({ dimensions: 768, normalize: true });
    const vec = await backend.embedCode('test');
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
  });

  it('embedCode skips normalization when disabled', async () => {
    const backend = new MockEmbeddingBackend({ dimensions: 128, normalize: false });
    const vec = await backend.embedCode('test');
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
    // Without normalization, norm is unlikely to be 1.0
    expect(Math.sqrt(norm)).not.toBeCloseTo(1.0, 3);
  });

  it('embedBatch returns correct count', async () => {
    const backend = new MockEmbeddingBackend();
    const vecs = await backend.embedBatch(['a', 'b', 'c']);
    expect(vecs.length).toBe(3);
    expect(vecs[0]!.length).toBe(768);
  });

  it('embedBatch with empty array', async () => {
    const backend = new MockEmbeddingBackend();
    const vecs = await backend.embedBatch([]);
    expect(vecs).toEqual([]);
  });

  it('dispose is a no-op', () => {
    const backend = new MockEmbeddingBackend();
    expect(() => backend.dispose()).not.toThrow();
  });

  it('produces deterministic output for same input', async () => {
    const backend = new MockEmbeddingBackend();
    const v1 = await backend.embedCode('hello');
    const v2 = await backend.embedCode('hello');
    for (let i = 0; i < v1.length; i++) {
      expect(v1[i]).toBe(v2[i]);
    }
  });

  it('produces different output for different input', async () => {
    const backend = new MockEmbeddingBackend();
    const v1 = await backend.embedCode('alpha');
    const v2 = await backend.embedCode('beta');
    let diff = 0;
    for (let i = 0; i < v1.length; i++) {
      if (v1[i] !== v2[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
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
    engine.importEmbeddings([
      { nodeId: 3, embedding: [0.7, 0.8, 0.9] },
    ]);
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

  it('importEmbeddings does not modify original array', () => {
    const original = new Float32Array([1, 2, 3]);
    engine.importEmbeddings([{ nodeId: 1, embedding: original }]);
    original[0] = 999;
    const retrieved = engine.getEmbedding(1);
    expect(retrieved![0]).toBe(1); // Copy was made, original unchanged
  });

  it('importEmbeddings with empty array is a no-op', () => {
    engine.importEmbeddings([]);
    expect(engine.embeddingCount).toBe(0);
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

  it('returns a lookup function that finds stored embeddings', () => {
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

  it('lookup function works with importEmbeddings data', () => {
    engine.importEmbeddings([
      { nodeId: 10, embedding: [0.1, 0.2] },
      { nodeId: 20, embedding: [0.3, 0.4] },
    ]);
    const lookup = engine.createEmbeddingLookup();
    expect(lookup(10)).not.toBeNull();
    expect(lookup(20)).not.toBeNull();
    expect(lookup(30)).toBeNull();
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
// EmbeddingBackend type guards
// ---------------------------------------------------------------------------

describe('EmbeddingBackend interface conformance', () => {
  it('MockEmbeddingBackend implements EmbeddingBackend', () => {
    const backend = new MockEmbeddingBackend();
    expect(backend.backendType).toBeDefined();
    expect(typeof backend.embedCode).toBe('function');
    expect(typeof backend.embedBatch).toBe('function');
    expect(typeof backend.dimensions).toBe('number');
    expect(typeof backend.dispose).toBe('function');
  });

  it('MockEmbeddingBackend dimensions matches config', () => {
    const b768 = new MockEmbeddingBackend({ dimensions: 768, normalize: true });
    const b512 = new MockEmbeddingBackend({ dimensions: 512, normalize: true });
    const b256 = new MockEmbeddingBackend({ dimensions: 256, normalize: true });
    expect(b768.dimensions).toBe(768);
    expect(b512.dimensions).toBe(512);
    expect(b256.dimensions).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// Deterministic Output Tests
// ---------------------------------------------------------------------------

describe('EmbeddingEngine — Mock Backend', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine({ dimensions: 768, normalize: true });
    await engine.initialize();
  });

  it('should produce deterministic vectors for the same input', async () => {
    const v1 = await engine.embedCode('function hello() { return "world"; }');
    const v2 = await engine.embedCode('function hello() { return "world"; }');

    expect(v1.length).toBe(768);
    expect(v2.length).toBe(768);
    for (let i = 0; i < v1.length; i++) {
      expect(v1[i]!).toBe(v2[i]!);
    }
  });

  it('should produce different vectors for different inputs', async () => {
    const v1 = await engine.embedCode('function foo() {}');
    const v2 = await engine.embedCode('function bar() {}');

    let differences = 0;
    for (let i = 0; i < v1.length; i++) {
      if (Math.abs(v1[i]! - v2[i]!) > 1e-10) {
        differences++;
      }
    }
    // Almost all values should differ for different inputs with our mock
    expect(differences).toBeGreaterThan(0);
  });

  it('should produce normalized vectors', async () => {
    const v = await engine.embedCode('test code');

    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      norm += v[i]! * v[i]!;
    }
    norm = Math.sqrt(norm);
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('should produce vectors of correct dimension', async () => {
    const customEngine = new EmbeddingEngine({ dimensions: 512, normalize: false });
    await customEngine.initialize();

    const v = await customEngine.embedCode('test');
    expect(v.length).toBe(512);
  });

  it('should handle empty string input', async () => {
    const v = await engine.embedCode('');
    expect(v.length).toBe(768);
    // Empty string should still produce a valid vector
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      norm += v[i]! * v[i]!;
    }
    norm = Math.sqrt(norm);
    expect(norm).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// Cosine Similarity Tests
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.cosineSimilarity', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('should return 1.0 for identical content', async () => {
    const code = 'function add(a: number, b: number): number { return a + b; }';
    const v1 = await engine.embedCode(code);
    const v2 = await engine.embedCode(code);

    expect(engine.cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
  });

  it('should return low similarity for very different content', async () => {
    const v1 = await engine.embedCode('function add(a, b) { return a + b; }');
    const v2 = await engine.embedCode('class DatabaseConnection { connect() {} }');

    const sim = engine.cosineSimilarity(v1, v2);
    // For random vectors in 768D, similarity should be close to 0
    expect(Math.abs(sim)).toBeLessThan(0.3);
  });

  it('should throw on dimension mismatch', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3, 4]);
    expect(() => engine.cosineSimilarity(a, b)).toThrow('dimension mismatch');
  });

  it('should handle zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(engine.cosineSimilarity(a, b)).toBe(0);
  });

  it('should be commutative', async () => {
    const v1 = await engine.embedCode('function hello() {}');
    const v2 = await engine.embedCode('function world() {}');

    expect(engine.cosineSimilarity(v1, v2)).toBe(engine.cosineSimilarity(v2, v1));
  });
});

// ---------------------------------------------------------------------------
// Batch Embedding Tests
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.embedBatch', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('should embed multiple snippets at once', async () => {
    const codes = [
      'function a() {}',
      'function b() {}',
      'function c() {}',
    ];

    const vectors = await engine.embedBatch(codes);

    expect(vectors.length).toBe(3);
    expect(vectors[0]!.length).toBe(768);
    expect(vectors[1]!.length).toBe(768);
    expect(vectors[2]!.length).toBe(768);
  });

  it('should produce same results as individual embedding', async () => {
    const codes = [
      'function foo() { return 1; }',
      'function bar() { return 2; }',
    ];

    const batch = await engine.embedBatch(codes);
    const individual = await Promise.all(codes.map((c) => engine.embedCode(c)));

    for (let i = 0; i < codes.length; i++) {
      const batchItem = batch[i]!;
      const indivItem = individual[i]!;
      for (let j = 0; j < batchItem.length; j++) {
        expect(batchItem[j]!).toBe(indivItem[j]!);
      }
    }
  });

  it('should handle empty batch', async () => {
    const vectors = await engine.embedBatch([]);
    expect(vectors).toEqual([]);
  });

  it('should handle large batch', async () => {
    const codes = Array.from({ length: 100 }, (_, i) => `function f${i}() {}`);
    const vectors = await engine.embedBatch(codes);

    expect(vectors.length).toBe(100);
    expect(vectors[0]!.length).toBe(768);
    expect(vectors[99]!.length).toBe(768);
  });
});

// ---------------------------------------------------------------------------
// Store/Get Embedding Tests
// ---------------------------------------------------------------------------

describe('EmbeddingEngine store/get embeddings', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('should store and retrieve embeddings', async () => {
    const code = 'function test() {}';
    const vector = await engine.embedCode(code);

    engine.storeEmbedding(1, vector);
    const retrieved = engine.getEmbedding(1);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(vector.length);
    for (let i = 0; i < vector.length; i++) {
      expect(retrieved![i]!).toBe(vector[i]!);
    }
  });

  it('should return null for missing embedding', () => {
    const result = engine.getEmbedding(999);
    expect(result).toBeNull();
  });

  it('should return a copy, not the original', async () => {
    const vector = await engine.embedCode('test');
    engine.storeEmbedding(1, vector);

    vector[0] = 999;

    const retrieved = engine.getEmbedding(1);
    expect(retrieved![0]!).not.toBe(999);
  });

  it('should update existing embedding', async () => {
    const v1 = await engine.embedCode('old code');
    const v2 = await engine.embedCode('new code');

    engine.storeEmbedding(1, v1);
    engine.storeEmbedding(1, v2);

    const retrieved = engine.getEmbedding(1);
    for (let i = 0; i < v2.length; i++) {
      expect(retrieved![i]!).toBe(v2[i]!);
    }
  });

  it('should handle multiple stored embeddings', async () => {
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
// Incremental Update Tests
// ---------------------------------------------------------------------------

describe('EmbeddingEngine.incrementalUpdate', () => {
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    engine = new EmbeddingEngine();
    await engine.initialize();
  });

  it('should embed only nodes without existing embeddings', async () => {
    // Pre-populate node 1
    const existingVec = await engine.embedCode('existing');
    engine.storeEmbedding(1, existingVec);

    const nodeIds = [1, 2, 3];
    const contentMap = new Map([
      [1, 'existing'],
      [2, 'new content two'],
      [3, 'brand new content three'],
    ]);

    await engine.incrementalUpdate(nodeIds, (id) => contentMap.get(id) ?? '');

    // Node 1 should have its original embedding
    const v1 = engine.getEmbedding(1);
    expect(v1).not.toBeNull();
    for (let i = 0; i < v1!.length; i++) {
      expect(v1![i]!).toBe(existingVec[i]!);
    }

    // Nodes 2 and 3 should now have embeddings
    expect(engine.getEmbedding(2)).not.toBeNull();
    expect(engine.getEmbedding(3)).not.toBeNull();
  });

  it('should skip nodes with empty content', async () => {
    const nodeIds = [1, 2];
    await engine.incrementalUpdate(nodeIds, (id) => {
      return id === 1 ? 'valid content' : '';
    });

    expect(engine.getEmbedding(1)).not.toBeNull();
    expect(engine.getEmbedding(2)).toBeNull();
  });

  it('should handle empty node list', async () => {
    await engine.incrementalUpdate([], () => 'test');
    expect(engine.getEmbedding(0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Engine Lifecycle Tests
// ---------------------------------------------------------------------------

describe('EmbeddingEngine lifecycle', () => {
  it('should initialize lazily on first use', async () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady).toBe(false);

    await engine.embedCode('test');
    expect(engine.isReady).toBe(true);
  });

  it('should be initialized after calling initialize', async () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady).toBe(false);

    await engine.initialize();
    expect(engine.isReady).toBe(true);
  });

  it('should not reinitialize if already initialized', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    const dimensions = engine.dimensions;
    await engine.initialize();
    expect(engine.dimensions).toBe(dimensions);
  });

  it('should dispose cleanly', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    await engine.embedCode('test');
    engine.storeEmbedding(1, new Float32Array([1, 2, 3]));

    engine.dispose();

    expect(engine.isReady).toBe(false);
    expect(engine.getEmbedding(1)).toBeNull();
  });

  it('should use default dimensions when no config provided', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();
    expect(engine.dimensions).toBe(768);
  });

  it('should accept custom dimensions', async () => {
    const engine = new EmbeddingEngine({ dimensions: 256 });
    await engine.initialize();
    expect(engine.dimensions).toBe(256);

    const v = await engine.embedCode('test');
    expect(v.length).toBe(256);
  });

  it('should handle embedCode without explicit initialize (lazy init)', async () => {
    const engine = new EmbeddingEngine();
    // embedCode should auto-initialize
    const v = await engine.embedCode('lazy test');
    expect(v.length).toBe(768);
    expect(engine.isReady).toBe(true);
  });

  it('should handle embedBatch without explicit initialize', async () => {
    const engine = new EmbeddingEngine();
    const vectors = await engine.embedBatch(['test1', 'test2']);
    expect(vectors.length).toBe(2);
    expect(engine.isReady).toBe(true);
  });

  it('should handle incrementalUpdate without explicit initialize', async () => {
    const engine = new EmbeddingEngine();
    const contentMap = new Map([
      [1, 'content one'],
      [2, 'content two'],
    ]);
    await engine.incrementalUpdate([1, 2], (id) => contentMap.get(id) ?? '');
    expect(engine.isReady).toBe(true);
    expect(engine.getEmbedding(1)).not.toBeNull();
    expect(engine.getEmbedding(2)).not.toBeNull();
  });

  it('should handle incrementalUpdate with all nodes already having embeddings', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();

    const existingVec = await engine.embedCode('existing');
    engine.storeEmbedding(1, existingVec);

    await engine.incrementalUpdate([1], () => 'new content');
    // Should keep existing embedding
    const v1 = engine.getEmbedding(1);
    expect(v1).not.toBeNull();
    for (let i = 0; i < existingVec.length; i++) {
      expect(v1![i]!).toBe(existingVec[i]!);
    }
  });

  it('should handle incrementalUpdate with empty content for some nodes', async () => {
    const engine = new EmbeddingEngine();
    await engine.initialize();

    await engine.incrementalUpdate([1, 2], (id) => {
      return id === 1 ? 'content' : '';
    });

    expect(engine.getEmbedding(1)).not.toBeNull();
    expect(engine.getEmbedding(2)).toBeNull();
  });

  it('should handle dimension mismatch in cosine similarity', () => {
    const engine = new EmbeddingEngine();
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => engine.cosineSimilarity(a, b)).toThrow('dimension mismatch');
  });
});
