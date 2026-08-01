// @code-analyzer/intelligence — Embedding Engine Benchmarks
// Measures vector embedding throughput (embeddings/sec) under varying conditions.

import { describe, it, expect } from 'vitest';
import { EmbeddingEngine } from '../../../src/embeddings/embedder.js';

// ---------------------------------------------------------------------------
// Simple Benchmark Helper (avoid cross-package test import)
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  iterations: number;
}

async function bench(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = 30,
  warmupIterations: number = 3,
): Promise<BenchResult> {
  // Warm-up
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }

  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const mean = durations.reduce((s, d) => s + d, 0) / durations.length;

  return {
    name,
    meanMs: mean,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    iterations,
  };
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function generateCodeSnippet(sizeLines: number): string {
  const lines: string[] = [];
  for (let i = 0; i < sizeLines; i++) {
    lines.push(`function helper${i}(input: string): number {`);
    lines.push(`  const result = input.length + ${i};`);
    lines.push(`  return result * 2;`);
    lines.push(`}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Benchmark Tests
// ---------------------------------------------------------------------------

describe('Embedding Benchmarks', () => {
  it(
    'should embed single snippets quickly',
    { timeout: 60_000 },
    async () => {
      const engine = new EmbeddingEngine({ dimensions: 768, normalize: true });
      await engine.initialize();

      const code = generateCodeSnippet(10);
      let vector: Float32Array | null = null;

      const result = await bench(
        'embed-single-768d',
        async () => {
          vector = await engine.embedCode(code);
        },
        50,
        5,
      );

      expect(vector).not.toBeNull();
      expect(vector!.length).toBe(768);

      console.log(`Single embed (768d): mean=${formatMs(result.meanMs)}, p95=${formatMs(result.p95Ms)}`);
      expect(result.meanMs).toBeLessThan(20); // <20ms per embedding

      engine.dispose();
    },
  );

  it(
    'should embed small batches efficiently',
    { timeout: 60_000 },
    async () => {
      const engine = new EmbeddingEngine({ dimensions: 768, normalize: true });
      await engine.initialize();

      const snippets = Array.from({ length: 10 }, (_, i) =>
        generateCodeSnippet(5 + (i % 5)),
      );
      let vectors: Float32Array[] = [];

      const result = await bench(
        'embed-batch-10',
        async () => {
          vectors = await engine.embedBatch(snippets);
        },
        20,
        3,
      );

      expect(vectors.length).toBe(10);
      for (const v of vectors) {
        expect(v.length).toBe(768);
      }

      console.log(
        `Batch embed (10 files): mean=${formatMs(result.meanMs)}, ` +
        `per-file=${formatMs(result.meanMs / 10)}`,
      );

      engine.dispose();
    },
  );

  it(
    'should embed larger batches efficiently',
    { timeout: 60_000 },
    async () => {
      const engine = new EmbeddingEngine({ dimensions: 768, normalize: true });
      await engine.initialize();

      const snippets = Array.from({ length: 100 }, (_, i) =>
        generateCodeSnippet(3 + (i % 3)),
      );
      let vectors: Float32Array[] = [];

      const result = await bench(
        'embed-batch-100',
        async () => {
          vectors = await engine.embedBatch(snippets);
        },
        10,
        2,
      );

      expect(vectors.length).toBe(100);
      console.log(
        `Batch embed (100 files): mean=${formatMs(result.meanMs)}, ` +
        `per-file=${formatMs(result.meanMs / 100)}`,
      );

      engine.dispose();
    },
  );

  it(
    'should compute cosine similarity quickly',
    { timeout: 30_000 },
    async () => {
      const engine = new EmbeddingEngine({ dimensions: 768 });
      await engine.initialize();

      const a = await engine.embedCode('function foo(): number { return 42; }');
      const b = await engine.embedCode('function bar(): number { return 99; }');

      const result = await bench(
        'cosine-similarity-768d',
        async () => {
          engine.cosineSimilarity(a, b);
        },
        200,
        10,
      );

      console.log(`Cosine similarity (768d): mean=${formatMs(result.meanMs)}`);
      expect(result.meanMs).toBeLessThan(1); // <1ms

      engine.dispose();
    },
  );

  it(
    'should store and retrieve embeddings at scale',
    { timeout: 30_000 },
    async () => {
      const engine = new EmbeddingEngine({ dimensions: 384, normalize: false });
      await engine.initialize();

      const code = generateCodeSnippet(5);
      const vec = await engine.embedCode(code);

      const result = await bench(
        'store-retrieve-1000',
        async () => {
          for (let i = 0; i < 1000; i++) {
            engine.storeEmbedding(i, vec);
          }
          for (let i = 0; i < 1000; i++) {
            const retrieved = engine.getEmbedding(i);
            expect(retrieved).not.toBeNull();
          }
        },
        20,
        3,
      );

      expect(engine.embeddingCount).toBeGreaterThanOrEqual(1000);
      console.log(`Store + retrieve 1000 embeddings: mean=${formatMs(result.meanMs)}`);

      engine.dispose();
    },
  );
});
