// @code-analyzer/intelligence — Embedding Engine Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingEngine } from '../embeddings/embedder.js';

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
