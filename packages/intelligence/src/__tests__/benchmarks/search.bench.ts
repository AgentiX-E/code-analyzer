// @code-analyzer/intelligence — Hybrid Search Benchmarks
// Measures BM25 + vector search latency and throughput.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  HybridSearchEngine,
  tokenize,
  cosineSimilarity,
} from '../../../src/search/hybrid-search.js';
import { EmbeddingEngine } from '../../../src/embeddings/embedder.js';
import type { GraphNode, NodeLabel } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Simple Benchmark Helper
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
  return {
    name,
    meanMs: durations.reduce((s, d) => s + d, 0) / durations.length,
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

function createSampleNode(
  id: number,
  name: string,
  label: NodeLabel = 'Function',
  signature?: string,
  docstring?: string,
): GraphNode {
  return {
    id,
    projectId: 'bench',
    label,
    name,
    qualifiedName: `${label}:${name}`,
    filePath: `src/${name.toLowerCase()}.ts`,
    startLine: id * 10,
    endLine: id * 10 + 15,
    language: 'typescript',
    properties: { name },
    signature: signature ?? null,
    docstring: docstring ?? null,
    complexity: id % 20,
    isExported: id % 3 === 0,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function populateStore(store: InMemoryGraphStore, count: number): void {
  const methods = [
    'create',
    'update',
    'delete',
    'find',
    'list',
    'process',
    'validate',
    'transform',
    'initialize',
    'configure',
    'handle',
    'resolve',
    'authenticate',
    'authorize',
    'parse',
    'serialize',
    'deserialize',
    'migrate',
    'backup',
    'restore',
  ];
  const types = [
    'User',
    'Post',
    'Comment',
    'Profile',
    'Settings',
    'Config',
    'Auth',
    'Session',
    'Role',
    'Permission',
    'Log',
    'Metrics',
    'Cache',
    'Queue',
    'Event',
  ];

  for (let i = 0; i < count; i++) {
    const method = methods[i % methods.length]!;
    const type = types[Math.floor(i / methods.length) % types.length]!;
    const name = `${method}${type}_${i}`; // Ensure uniqueness with index suffix
    const node = createSampleNode(
      i + 1,
      name,
      i % 3 === 0 ? 'Class' : 'Function',
      `${method}${type}(id: string, options?: Record<string, unknown>): Promise<${type}>`,
      `Handles the ${method} operation for ${type} entities.`,
    );
    store.insertNode({ ...node, projectId: 'bench' });
  }
}

// ---------------------------------------------------------------------------
// Benchmark Tests
// ---------------------------------------------------------------------------

describe('Search Benchmarks', () => {
  it('should build inverted index efficiently', { timeout: 60_000 }, async () => {
    const store = new InMemoryGraphStore();
    populateStore(store, 10000);
    const engine = new HybridSearchEngine(store);

    const result = await bench(
      'index-build-10000',
      () => {
        engine.initialize();
      },
      10,
      2,
    );

    expect(engine.documentCount).toBe(10000);
    console.log(
      `Build inverted index (10K docs): mean=${formatMs(result.meanMs)}, ` +
        `docs/sec=${(10000 / (result.meanMs / 1000)).toFixed(0)}`,
    );
  });

  it('should perform BM25 search with low latency', { timeout: 60_000 }, async () => {
    const store = new InMemoryGraphStore();
    populateStore(store, 5000);
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const result = await bench(
      'bm25-search-5000',
      () => {
        const results = engine.bm25Search('create user');
        expect(results.length).toBeGreaterThan(0);
      },
      50,
      5,
    );

    console.log(
      `BM25 search (5K docs): mean=${formatMs(result.meanMs)}, p95=${formatMs(result.p95Ms)}`,
    );
    expect(result.meanMs).toBeLessThan(50);
  });

  it('should perform hybrid search with embeddings', { timeout: 60_000 }, async () => {
    const store = new InMemoryGraphStore();
    populateStore(store, 1000);

    const embedEngine = new EmbeddingEngine({ dimensions: 768 });
    await embedEngine.initialize();

    // Pre-compute embeddings for all nodes
    const allNodes = store.getAllNodes();
    for (const node of allNodes) {
      const code = `${node.signature ?? node.name}\n${node.docstring ?? ''}`;
      const vec = await embedEngine.embedCode(code);
      embedEngine.storeEmbedding(node.id, vec);
    }

    const searchEngine = new HybridSearchEngine(store);
    searchEngine.initialize();
    searchEngine.registerEmbeddings(embedEngine.createEmbeddingLookup(), async (content: string) =>
      embedEngine.embedCode(content),
    );

    const result = await bench(
      'hybrid-search-1000',
      async () => {
        const results = await searchEngine.search({ query: 'authentication', limit: 20 });
        expect(Array.isArray(results)).toBe(true);
      },
      20,
      3,
    );

    console.log(
      `Hybrid search (1K docs + embeddings): mean=${formatMs(result.meanMs)}, ` +
        `p95=${formatMs(result.p95Ms)}`,
    );

    embedEngine.dispose();
  });

  it('should tokenize efficiently', { timeout: 10_000 }, async () => {
    const testStr = 'getUserProfileData_fromCache';

    const result = await bench(
      'tokenize',
      () => {
        const tokens = tokenize(testStr);
        expect(tokens.length).toBe(6); // get, user, profile, data, from, cache
      },
      500,
      10,
    );

    console.log(`Tokenize (camelCase+snake): mean=${formatMs(result.meanMs)}`);
    expect(result.meanMs).toBeLessThan(0.5); // <0.5ms
  });

  it('should fuse results efficiently', { timeout: 10_000 }, async () => {
    const store = new InMemoryGraphStore();
    populateStore(store, 200);
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const bm25Results = engine.bm25Search('create user');
    const vectorResults = engine.bm25Search('update post');

    const result = await bench(
      'rrf-fusion',
      () => {
        const fused = engine.fuseResults(bm25Results, vectorResults, 60, 20);
        expect(Array.isArray(fused)).toBe(true);
      },
      100,
      10,
    );

    console.log(`RRF fusion: mean=${formatMs(result.meanMs)}`);
    expect(result.meanMs).toBeLessThan(5);
  });

  it('should handle cache-friendly repeated searches', { timeout: 30_000 }, async () => {
    const store = new InMemoryGraphStore();
    populateStore(store, 2000);
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    // First search (cold)
    const coldResult = await bench(
      'bm25-cold-search',
      () => {
        engine.bm25Search('find settings');
      },
      5,
      0,
    );

    // Subsequent searches (warm — store/reinitialize introduces minimal state change)
    const warmResult = await bench(
      'bm25-warm-search',
      () => {
        engine.bm25Search('list config');
      },
      50,
      5,
    );

    console.log(
      `BM25 cold start: ${formatMs(coldResult.meanMs)}, ` +
        `warm start: ${formatMs(warmResult.meanMs)}`,
    );

    // Warm should not be significantly worse than cold
    // (They should be similar since there's no caching)
  });
});
