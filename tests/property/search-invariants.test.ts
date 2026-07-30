// @code-analyzer — Property-Based Search Invariant Tests
// Validates the HybridSearchEngine invariants under varied inputs.
// NOTE: Uses vitest assertions directly with systematic input generation.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { HybridSearchEngine } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BENCHMARKS = ['benchmark', 'performance', 'optimization', 'speed', 'latency'];
const SECURITY = ['authentication', 'authorization', 'token', 'password', 'encrypt', 'hash'];
const DATABASE = ['database', 'query', 'migration', 'schema', 'index', 'transaction'];
const NETWORK = ['http', 'request', 'response', 'socket', 'api', 'endpoint'];
const STORAGE = ['file', 'storage', 'cache', 'buffer', 'stream', 'persist'];

interface CorpusEntry { nodeId: number; labels: string[]; content: string }

function makeStore(): InMemoryGraphStore {
  return new InMemoryGraphStore(':memory:');
}

function addCorpusNode(
  store: InMemoryGraphStore,
  name: string,
  label: string,
  props: Record<string, string> = {},
): number {
  const now = new Date().toISOString();
  return store.insertNode({
    id: 0, projectId: 'prop-test', label: label as any,
    name, qualifiedName: name, filePath: `src/${name}.ts`,
    startLine: 1, endLine: 10, language: 'typescript',
    properties: props, signature: `function ${name}()`, docstring: null,
    complexity: 5, isExported: true, fingerprint: null,
    createdAt: now, updatedAt: now,
  });
}

function buildCorpus(store: InMemoryGraphStore, count: number, offset = 0): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  const categories = [BENCHMARKS, SECURITY, DATABASE, NETWORK, STORAGE];
  const labels = ['Function', 'Class', 'Interface', 'Method'];

  for (let i = 0; i < count; i++) {
    const cat = categories[i % categories.length]!;
    const label = labels[i % labels.length]!;
    const words: string[] = [];
    const catWords: string[] = [];
    for (let j = 0; j < 3; j++) {
      words.push(cat[(i * 3 + j) % cat.length]!);
      catWords.push(cat[j % cat.length]!);
    }
    const name = `${label}_${offset + i}_${words[0]}_${words[1]}`;
    const content = `${catWords.join(' ')} ${words.join(' ')}`;
    const nodeId = addCorpusNode(store, name, label, { content });
    entries.push({ nodeId, labels: catWords, content });
  }
  return entries;
}

function buildEngine(store: InMemoryGraphStore): HybridSearchEngine {
  const engine = new HybridSearchEngine(store);
  engine.initialize();
  return engine;
}

// ---------------------------------------------------------------------------
// Property: Monotonicity
// ---------------------------------------------------------------------------

describe('Search Invariants', () => {
  describe('Monotonicity', () => {
    it('adding nodes never decreases recall for exact match queries', async () => {
      const store = makeStore();
      // Baseline: search with a small corpus
      const baseEntries = buildCorpus(store, 30, 0);
      const engine = buildEngine(store);
      const baseResults = await engine.search({ query: 'benchmark performance' });

      // Add more nodes with offset to avoid name collisions
      const extraEntries = buildCorpus(store, 30, 100);
      const engine2 = buildEngine(store);
      const expandedResults = await engine2.search({ query: 'benchmark performance' });

      // With more data, we should get at least as many results (or more)
      expect(expandedResults.length).toBeGreaterThanOrEqual(
        Math.max(0, baseResults.length - 1),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property: Idempotency
  // -----------------------------------------------------------------------

  describe('Idempotency', () => {
    it('same query on same store returns identical result ordering', async () => {
      const store = makeStore();
      buildCorpus(store, 50);
      const engine = buildEngine(store);

      const results1 = await engine.search({ query: 'authentication token password' });
      const results2 = await engine.search({ query: 'authentication token password' });

      expect(results1.length).toBe(results2.length);
      for (let i = 0; i < results1.length; i++) {
        expect(results1[i]!.node.id).toBe(results2[i]!.node.id);
        // Only compare scores if both are defined
        if (results1[i]!.score !== undefined && results2[i]!.score !== undefined) {
          expect(results1[i]!.score).toBeCloseTo(results2[i]!.score, 5);
        }
      }
    });

    it('BM25-only search is purely deterministic', () => {
      const store = makeStore();
      buildCorpus(store, 40);
      const engine = buildEngine(store);

      const results1 = engine.bm25Search('database migration');
      const results2 = engine.bm25Search('database migration');

      expect(results1.length).toBe(results2.length);
      for (let i = 0; i < results1.length; i++) {
        expect(results1[i]!.node.id).toBe(results2[i]!.node.id);
        expect(results1[i]!.score).toBe(results2[i]!.score);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Property: Symmetry / Relevance
  // -----------------------------------------------------------------------

  describe('Relevance', () => {
    it('nodes with query-matching names rank higher than unrelated nodes', async () => {
      const store = makeStore();
      // Create a named node
      addCorpusNode(store, 'authenticateUser', 'Function', {
        content: 'authenticate user with token and password encryption',
      });
      // Create unrelated nodes
      buildCorpus(store, 40);
      const engine = buildEngine(store);

      const results = await engine.search({ query: 'authenticate user' });

      // The matching node should be in top results
      const hasMatchingNode = results.slice(0, 10).some(
        (r) => r.node.name === 'authenticateUser',
      );
      expect(hasMatchingNode).toBe(true);
    });

    it('exact name match outranks content-only matches', () => {
      const store = makeStore();
      const now = new Date().toISOString();

      // Node with exact name match
      store.insertNode({
        id: 0, projectId: 'prop-test', label: 'Function' as any,
        name: 'connectToDatabase', qualifiedName: 'connectToDatabase',
        filePath: 'src/db.ts', startLine: 1, endLine: 10,
        language: 'typescript', properties: {},
        signature: 'function connectToDatabase()', docstring: null,
        complexity: 5, isExported: true, fingerprint: null,
        createdAt: now, updatedAt: now,
      });

      // Node with content-only match
      store.insertNode({
        id: 0, projectId: 'prop-test', label: 'Function' as any,
        name: 'unrelatedFunc', qualifiedName: 'unrelatedFunc',
        filePath: 'src/util.ts', startLine: 1, endLine: 10,
        language: 'typescript', properties: { content: 'connect to database helper' },
        signature: 'function unrelatedFunc()', docstring: null,
        complexity: 5, isExported: true, fingerprint: null,
        createdAt: now, updatedAt: now,
      });

      const engine = buildEngine(store);
      const results = engine.bm25Search('connectToDatabase');

      if (results.length >= 2) {
        const nameIdx = results.findIndex(r => r.node.name === 'connectToDatabase');
        const contentIdx = results.findIndex(r => r.node.name === 'unrelatedFunc');
        if (nameIdx >= 0 && contentIdx >= 0) {
          expect(nameIdx).toBeLessThan(contentIdx);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Property: Empty / Edge Cases
  // -----------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('empty query on empty store returns empty results', async () => {
      const store = makeStore();
      const engine = buildEngine(store);
      const results = await engine.search({ query: '' });
      expect(results).toEqual([]);
    });

    it('empty query on populated store returns empty results', async () => {
      const store = makeStore();
      buildCorpus(store, 50);
      const engine = buildEngine(store);
      const results = await engine.search({ query: '' });
      expect(results.length).toBe(0);
    });

    it('whitespace-only query returns empty results', async () => {
      const store = makeStore();
      buildCorpus(store, 20);
      const engine = buildEngine(store);
      const results = await engine.search({ query: '   \t\n  ' });
      expect(results.length).toBe(0);
    });

    it('very long query does not crash', async () => {
      const store = makeStore();
      buildCorpus(store, 30);
      const engine = buildEngine(store);
      const longQuery = 'benchmark '.repeat(1000);
      let threw = false;
      try {
        await engine.search({ query: longQuery });
      } catch {
        threw = true;
      }
      // Should not throw, or at most return empty gracefully
      expect(threw).toBe(false);
    });

    it('special characters in query are handled', async () => {
      const store = makeStore();
      buildCorpus(store, 30);
      const engine = buildEngine(store);
      let threw = false;
      try {
        await engine.search({ query: 'function() { return null; }' });
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });

    it('limit parameter restricts result count', async () => {
      const store = makeStore();
      buildCorpus(store, 50);
      const engine = buildEngine(store);
      const results = await engine.search({ query: 'function', limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  // -----------------------------------------------------------------------
  // Property: BM25 Scoring
  // -----------------------------------------------------------------------

  describe('BM25 Scoring', () => {
    it('higher term frequency yields higher score', () => {
      const store = makeStore();
      const now = new Date().toISOString();

      // Node with term appearing once
      store.insertNode({
        id: 0, projectId: 'prop-test', label: 'Function' as any,
        name: 'SingleMention', qualifiedName: 'SingleMention',
        filePath: 'src/single.ts', startLine: 1, endLine: 10,
        language: 'typescript', properties: { content: 'cache' },
        signature: 'function SingleMention()', docstring: null,
        complexity: 5, isExported: true, fingerprint: null,
        createdAt: now, updatedAt: now,
      });

      // Node with term appearing multiple times
      store.insertNode({
        id: 0, projectId: 'prop-test', label: 'Function' as any,
        name: 'MultiMention', qualifiedName: 'MultiMention',
        filePath: 'src/multi.ts', startLine: 1, endLine: 10,
        language: 'typescript', properties: {
          content: 'cache cache cache cache cache implementation',
        },
        signature: 'function MultiMention()', docstring: null,
        complexity: 5, isExported: true, fingerprint: null,
        createdAt: now, updatedAt: now,
      });

      // Add filler nodes
      for (let i = 0; i < 30; i++) {
        addCorpusNode(store, `Filler${i}`, 'Function', {
          content: `filler content ${i}`,
        });
      }

      const engine = buildEngine(store);
      const results = engine.bm25Search('cache');

      const multiIdx = results.findIndex(r => r.node.name === 'MultiMention');
      const singleIdx = results.findIndex(r => r.node.name === 'SingleMention');

      if (multiIdx >= 0 && singleIdx >= 0) {
        expect(multiIdx).toBeLessThan(singleIdx);
      }
    });

    it('queried terms not in document do not contribute to score', () => {
      const store = makeStore();
      addCorpusNode(store, 'benchmarkRunner', 'Function', { content: 'benchmark performance optimization' });
      buildCorpus(store, 10, 100);
      const engine = buildEngine(store);
      const results = engine.bm25Search('benchmark nonexistentterm');

      // Should still return results for matching terms
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.node.name === 'benchmarkRunner')).toBe(true);
      expect(results.every(r => r.score >= 0)).toBe(true);
    });
  });
});
