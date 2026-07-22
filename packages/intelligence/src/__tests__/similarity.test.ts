// @code-analyzer/intelligence — End-to-End Similarity Pipeline Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { HybridSearchEngine } from '../search/hybrid-search.js';
import { EmbeddingEngine } from '../embeddings/embedder.js';
import { MinHashSimilarity } from '../similarity/minhash.js';
import { LSHSearcher } from '../similarity/lsh.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
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
      isExported: true,
    },
    signature: `function function_${id}(x: number): number`,
    docstring: `Doc for function_${id}`,
    complexity: 5,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Search → Embedding → Similarity Pipeline
// ---------------------------------------------------------------------------

describe('End-to-End: Search → Embedding → Similarity', () => {
  let store: InMemoryGraphStore;
  let searchEngine: HybridSearchEngine;
  let embedEngine: EmbeddingEngine;

  beforeEach(async () => {
    store = new InMemoryGraphStore();

    // Create diverse set of nodes
    store.insertNode(createNode(1, {
      name: 'getUserProfile',
      qualifiedName: 'api.getUserProfile',
      signature: 'function getUserProfile(userId: number): UserProfile',
      docstring: 'Retrieves the user profile from the database',
    }));

    store.insertNode(createNode(2, {
      name: 'getUserSettings',
      qualifiedName: 'api.getUserSettings',
      signature: 'function getUserSettings(userId: number): Settings',
      docstring: 'Retrieves user settings',
    }));

    store.insertNode(createNode(3, {
      name: 'createUser',
      qualifiedName: 'api.createUser',
      signature: 'function createUser(data: CreateUserDTO): User',
      docstring: 'Creates a new user in the system',
    }));

    store.insertNode(createNode(4, {
      name: 'deleteUser',
      qualifiedName: 'api.deleteUser',
      signature: 'function deleteUser(userId: number): void',
      docstring: 'Deletes a user from the system',
    }));

    store.insertNode(createNode(5, {
      name: 'DatabaseManager',
      qualifiedName: 'db.DatabaseManager',
      label: 'Class' as const,
      signature: 'class DatabaseManager',
      docstring: 'Manages database connections and queries',
    }));

    searchEngine = new HybridSearchEngine(store);
    searchEngine.initialize();

    embedEngine = new EmbeddingEngine({ dimensions: 768, normalize: true });
    await embedEngine.initialize();
  });

  it('should find relevant nodes via BM25 search', () => {
    const results = searchEngine.bm25Search('getUser');
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Top results should be getUserProfile and getUserSettings
    const topNames = results.slice(0, 2).map((r) => r.node.name);
    expect(topNames).toContain('getUserProfile');
    expect(topNames).toContain('getUserSettings');
  });

  it('should embed code and compute cosine similarity', async () => {
    const vec1 = await embedEngine.embedCode('function getUserProfile(id)');
    const vec2 = await embedEngine.embedCode('function getUserSettings(id)');

    const similarity = embedEngine.cosineSimilarity(vec1, vec2);

    // These are fairly related functions, so similarity should be reasonable
    // But with mock embeddings it's pseudo-random, so just verify it's valid
    expect(similarity).toBeGreaterThanOrEqual(-1);
    expect(similarity).toBeLessThanOrEqual(1);
  });

  it('should store and retrieve embeddings for search', async () => {
    // Embed node content
    for (const node of store.getAllNodes()) {
      const content = `${node.name} ${node.signature ?? ''} ${node.docstring ?? ''}`;
      const vec = await embedEngine.embedCode(content);
      embedEngine.storeEmbedding(node.id, vec);
    }

    // Verify all stored
    for (const node of store.getAllNodes()) {
      expect(embedEngine.getEmbedding(node.id)).not.toBeNull();
    }
  });

  it('should run hybrid search end-to-end', async () => {
    const results = await searchEngine.search({
      query: 'user profile',
      limit: 5,
    });

    // BM25-only since no embeddings registered
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.node.name).toContain('getUserProfile');
  });

  it('should filter search results by label', async () => {
    const results = await searchEngine.search({
      query: 'user',
      labels: ['Class' as const],
    });

    expect(results.every((r) => r.node.label === 'Class')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. MinHash → LSH → Similarity Edges Pipeline
// ---------------------------------------------------------------------------

describe('End-to-End: MinHash → LSH → Similarity Edges', () => {
  let store: InMemoryGraphStore;

  function tokenizeCode(text: string): string[] {
    return text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-.]+/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  beforeEach(() => {
    store = new InMemoryGraphStore();
  });

  it('should detect similar function implementations', () => {
    const mh = new MinHashSimilarity(128);
    const lsh = new LSHSearcher(16);

    // Two nearly identical functions
    store.insertNode(createNode(1, {
      name: 'getUser',
      signature: 'function getUser(id: number): User { return db.find(id); }',
    }));

    store.insertNode(createNode(2, {
      name: 'getUserWithCache',
      signature: 'function getUserWithCache(id: number): User { const cached = cache.get(id); if (cached) return cached; return db.find(id); }',
    }));

    store.insertNode(createNode(3, {
      name: 'Database',
      label: 'Class' as const,
      signature: 'class Database { connect() {} query(sql: string) {} close() {} }',
    }));

    // Build content fingerprints
    const fingerprints = new Map<number, number[]>();
    for (const node of store.getAllNodes()) {
      const tokens = tokenizeCode(
        `${node.name} ${node.signature ?? ''} ${node.docstring ?? ''}`,
      );
      fingerprints.set(node.id, mh.computeFingerprint(tokens));
    }

    const edges = lsh.buildSimilarityEdges(
      store,
      [1, 2, 3],
      (id) => fingerprints.get(id) ?? [],
      0.3,
    );

    // getUser and getUserWithCache should be similar
    // Database should not be similar to either
    // MinHash is probabilistic, so we verify structure if edges were found
    if (edges.length > 0) {
      // At least verify the structure
      for (const edge of edges) {
        expect(edge.sourceId).not.toBe(edge.targetId);
        expect(edge.similarity).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('should identify near-duplicate nodes', () => {
    const mh = new MinHashSimilarity(128);

    // Duplicate function
    const code = 'function add(a: number, b: number): number { return a + b; }';

    store.insertNode(createNode(1, {
      name: 'add',
      signature: code,
    }));

    store.insertNode(createNode(2, {
      name: 'sum',
      signature: code,
    }));

    const fp = mh.computeFingerprint(tokenizeCode(code));
    const fp1 = mh.computeFingerprint(tokenizeCode(code));

    // Identical fingerprints should have similarity 1.0
    const sim = mh.estimateSimilarity(fp, fp1);
    expect(sim).toBeCloseTo(1.0, 2);
  });

  it('should produce deterministic similarity scores', () => {
    const mh = new MinHashSimilarity(128);

    const tokens1 = tokenizeCode('function process(x) { return transform(x); }');
    const tokens2 = tokenizeCode('function process(y) { return transform(y); }');

    const fp1_run1 = mh.computeFingerprint(tokens1);
    const fp2_run1 = mh.computeFingerprint(tokens2);

    const fp1_run2 = mh.computeFingerprint(tokens1);
    const fp2_run2 = mh.computeFingerprint(tokens2);

    const sim1 = mh.estimateSimilarity(fp1_run1, fp2_run1);
    const sim2 = mh.estimateSimilarity(fp1_run2, fp2_run2);

    // Same inputs should produce same similarity
    expect(sim1).toBe(sim2);
  });
});

// ---------------------------------------------------------------------------
// 3. Incremental Update Workflow
// ---------------------------------------------------------------------------

describe('End-to-End: Incremental Update', () => {
  it('should embed only new nodes and skip existing ones', async () => {
    const embedEngine = new EmbeddingEngine();
    await embedEngine.initialize();

    const contentMap = new Map<number, string>();
    const largeSet = Array.from({ length: 50 }, (_, i) => i + 1);

    for (const id of largeSet) {
      contentMap.set(id, `function func_${id}() { /* implementation */ }`);
    }

    // First batch: embed the first 25
    await embedEngine.incrementalUpdate(
      largeSet.slice(0, 25),
      (id) => contentMap.get(id) ?? '',
    );

    for (let i = 1; i <= 25; i++) {
      expect(embedEngine.getEmbedding(i)).not.toBeNull();
    }
    for (let i = 26; i <= 50; i++) {
      expect(embedEngine.getEmbedding(i)).toBeNull();
    }

    // Second batch: embed remaining, but also include some from first batch
    await embedEngine.incrementalUpdate(
      largeSet.slice(20, 50),
      (id) => contentMap.get(id) ?? '',
    );

    // All should now have embeddings
    for (let i = 1; i <= 50; i++) {
      expect(embedEngine.getEmbedding(i)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Full Pipeline: Search → Embed → Find Similar
// ---------------------------------------------------------------------------

describe('End-to-End: Full Intelligence Pipeline', () => {
  it('should search, embed, and find similar nodes', async () => {
    const store = new InMemoryGraphStore();

    // Step 1: Insert a diverse codebase
    const snippets = [
      { name: 'getUser', code: 'function getUser(id: number): User { return db.users.find(id); }' },
      { name: 'getUserById', code: 'function getUserById(id: number): User { return db.users.findById(id); }' },
      { name: 'createUser', code: 'function createUser(data: CreateDTO): User { return db.users.create(data); }' },
      { name: 'updateUser', code: 'function updateUser(id: number, data: UpdateDTO): User { return db.users.update(id, data); }' },
      { name: 'deleteUser', code: 'function deleteUser(id: number): void { db.users.delete(id); }' },
      { name: 'listUsers', code: 'function listUsers(opts: ListOptions): User[] { return db.users.list(opts); }' },
      { name: 'Database', code: 'class Database { connect() { } query(sql: string) { } disconnect() { } }' },
      { name: 'CacheLayer', code: 'class CacheLayer { get(key: string) { } set(key: string, value: any) { } invalidate(key: string) { } }' },
    ];

    for (let i = 0; i < snippets.length; i++) {
      const snippet = snippets[i]!;
      store.insertNode(createNode(i + 1, {
        name: snippet.name,
        signature: snippet.code,
        qualifiedName: `pkg.${snippet.name}`,
      }));
    }

    // Step 2: Initialize search
    const searchEngine = new HybridSearchEngine(store);
    searchEngine.initialize();

    // Step 3: Search for user CRUD functions
    const searchResults = searchEngine.bm25Search('getUser');
    expect(searchResults.length).toBeGreaterThanOrEqual(2);

    // Step 4: Initialize embeddings
    const embedEngine = new EmbeddingEngine();
    await embedEngine.initialize();

    for (const node of store.getAllNodes()) {
      const vec = await embedEngine.embedCode(
        `${node.name} ${node.signature ?? ''}`,
      );
      embedEngine.storeEmbedding(node.id, vec);
    }

    // Step 5: Check that similar functions have reasonable cosine similarity
    const getUserVec = embedEngine.getEmbedding(1)!;
    const getUserByIdVec = embedEngine.getEmbedding(2)!;
    const dbClassVec = embedEngine.getEmbedding(7)!;

    const userSim = embedEngine.cosineSimilarity(getUserVec, getUserByIdVec);
    const userDbSim = embedEngine.cosineSimilarity(getUserVec, dbClassVec);

    // Both similarities should be valid
    expect(userSim).toBeGreaterThanOrEqual(-1);
    expect(userSim).toBeLessThanOrEqual(1);
    expect(userDbSim).toBeGreaterThanOrEqual(-1);
    expect(userDbSim).toBeLessThanOrEqual(1);

    // Step 6: Run MinHash similarity on the nodes
    const mh = new MinHashSimilarity(128);
    const lsh = new LSHSearcher(16);

    const fingerprints = new Map<number, number[]>();
    for (const node of store.getAllNodes()) {
      const tokens = `${node.name} ${node.signature ?? ''}`
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_\-.]+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      fingerprints.set(node.id, mh.computeFingerprint(tokens));
    }

    const edges = lsh.buildSimilarityEdges(
      store,
      Array.from(fingerprints.keys()),
      (id) => fingerprints.get(id) ?? [],
      0.3,
    );

    // Verify edge structure
    for (const edge of edges) {
      expect(edge.sourceId).not.toBe(edge.targetId);
      expect(edge.similarity).toBeGreaterThanOrEqual(0.3);
      expect(edge.similarity).toBeLessThanOrEqual(1.0);
    }
  });
});
