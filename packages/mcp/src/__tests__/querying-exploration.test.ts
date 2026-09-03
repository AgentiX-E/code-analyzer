// @code-analyzer/mcp — Querying & Exploration Tools Tests
// Direct unit tests for every exported handler in querying-exploration.ts.
// Covers positive paths, fallback paths (raw store / no store), error catches,
// and the semantic vector branch (via real embedding registration).

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import {
  searchGraph,
  searchGraphSchema,
  searchCode,
  searchCodeSchema,
  semanticSearch,
  semanticSearchSchema,
  traceCallPath,
  traceCallPathSchema,
  queryGraph,
  queryGraphSchema,
  getCodeSnippet,
  getCodeSnippetSchema,
  getArchitecture,
  getArchitectureSchema,
  getGraphSchema,
  getGraphSchemaSchema,
  exploreSymbol,
  exploreSymbolSchema,
  findImplementations,
  findImplementationsSchema,
} from '../tools/querying-exploration.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_HAS_METHOD, EDGE_IMPLEMENTS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT = 'test-project';

function makeNode(
  overrides: Partial<GraphNode> & Pick<GraphNode, 'name' | 'qualifiedName' | 'label'>,
): GraphNode {
  return {
    id: 0,
    projectId: PROJECT,
    label: overrides.label,
    name: overrides.name,
    qualifiedName: overrides.qualifiedName,
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Seed a graph covering all labels and relationship types exercised by the
 * querying & exploration tools. Returns nothing; tests resolve nodes by qname.
 */
function seed(store: InMemoryGraphStore): void {
  const module = makeNode({
    label: 'Module',
    name: 'core',
    qualifiedName: 'core',
    filePath: '/app/src/core',
  });
  const iface = makeNode({
    label: 'Interface',
    name: 'IService',
    qualifiedName: 'core.IService',
    filePath: '/app/src/core/service.ts',
    startLine: 1,
    endLine: 10,
    isExported: true,
    signature: 'interface IService',
    docstring: 'Service interface',
  });
  const klass = makeNode({
    label: 'Class',
    name: 'MyService',
    qualifiedName: 'core.MyService',
    filePath: '/app/src/core/my-service.ts',
    startLine: 1,
    endLine: 50,
    isExported: true,
    signature: 'class MyService',
    docstring: 'Main service',
  });
  const doWork = makeNode({
    label: 'Method',
    name: 'doWork',
    qualifiedName: 'core.MyService.doWork',
    filePath: '/app/src/core/my-service.ts',
    startLine: 10,
    endLine: 30,
    isExported: true,
    signature: 'doWork(input: string): Promise<Result>',
    docstring: 'Processes work items',
  });
  const validate = makeNode({
    label: 'Method',
    name: 'validate',
    qualifiedName: 'core.MyService.validate',
    filePath: '/app/src/core/my-service.ts',
    startLine: 32,
    endLine: 48,
    isExported: false,
    signature: 'validate(data: unknown): boolean',
  });
  const fetchData = makeNode({
    label: 'Function',
    name: 'fetchData',
    qualifiedName: 'core.fetchData',
    filePath: '/app/src/core/data.ts',
    startLine: 1,
    endLine: 25,
    isExported: true,
    signature: 'fetchData(url: string): Promise<Data>',
    docstring: 'Fetches data from API',
  });
  const complexFn = makeNode({
    label: 'Function',
    name: 'complexFn',
    qualifiedName: 'core.complexFn',
    filePath: '/app/src/core/complex.ts',
    startLine: 1,
    endLine: 120,
    isExported: true,
    signature: 'complexFn(): void',
    complexity: 35,
  });
  const route = makeNode({
    label: 'Route',
    name: 'getItems',
    qualifiedName: 'routes.getItems',
    filePath: '/app/src/routes/items.ts',
    startLine: 5,
    endLine: 15,
    isExported: true,
    properties: { routePath: '/api/items', routeMethod: 'GET' },
  });
  const bareRoute = makeNode({
    label: 'Route',
    name: 'healthCheck',
    qualifiedName: 'routes.healthCheck',
    filePath: '/app/src/routes/health.ts',
    startLine: 1,
    endLine: 5,
    properties: {},
  });
  const noFileFn = makeNode({
    label: 'Function',
    name: 'orphanFn',
    qualifiedName: 'core.orphanFn',
    filePath: null,
  });
  const openEndedFn = makeNode({
    label: 'Function',
    name: 'openEndedFn',
    qualifiedName: 'core.openEndedFn',
    filePath: '/app/src/core/open-ended.ts',
    startLine: 3,
    endLine: null,
  });
  const testNode = makeNode({
    label: 'Test',
    name: 'testDoWork',
    qualifiedName: 'core.testDoWork',
    filePath: '/app/src/core/__tests__/my-service.test.ts',
    startLine: 1,
    endLine: 20,
  });

  const ids = store.insertNodes([
    module,
    iface,
    klass,
    doWork,
    validate,
    fetchData,
    complexFn,
    route,
    bareRoute,
    noFileFn,
    openEndedFn,
    testNode,
  ]);

  const byQname = (qname: string): number => {
    const n = store.getNodeByQualifiedName(qname);
    if (!n) throw new Error(`fixture node not found: ${qname}`);
    return n.id;
  };

  const edges: GraphEdge[] = [
    {
      id: 0,
      projectId: PROJECT,
      sourceId: byQname('core.MyService'),
      targetId: byQname('core.IService'),
      type: EDGE_IMPLEMENTS,
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: PROJECT,
      sourceId: byQname('core.MyService'),
      targetId: byQname('core.MyService.doWork'),
      type: EDGE_HAS_METHOD,
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: PROJECT,
      sourceId: byQname('core.MyService'),
      targetId: byQname('core.MyService.validate'),
      type: EDGE_HAS_METHOD,
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: PROJECT,
      sourceId: byQname('core.MyService.doWork'),
      targetId: byQname('core.fetchData'),
      type: EDGE_CALLS,
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: PROJECT,
      sourceId: byQname('core.MyService.validate'),
      targetId: byQname('core.MyService.doWork'),
      type: EDGE_CALLS,
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    },
  ];
  store.insertEdges(edges);

  // Sanity: node ids were assigned (insertNodes returns contiguous ids).
  expect(ids.length).toBe(12);
}

function seededStore(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  seed(store);
  return store;
}

function seededContext(): ToolContextImpl {
  return new ToolContextImpl(seededStore());
}

/** A closed store throws on every accessor — a real way to reach catch paths. */
function closedStore(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  store.close();
  return store;
}

/**
 * A store whose designated method throws a non-Error value. Real store methods
 * only ever throw Error, so the `String(error)` branch of each handler's catch
 * is only reachable via a subclass that throws a string.
 */
class StringThrowingStore extends InMemoryGraphStore {
  throwOn: 'searchFts' | 'qname' | 'queryNodes' | 'allNodes' = 'searchFts';

  override searchFts(
    query: string,
    options?: Parameters<InMemoryGraphStore['searchFts']>[1],
  ): ReturnType<InMemoryGraphStore['searchFts']> {
    if (this.throwOn === 'searchFts') throw 'searchFts-boom';
    return super.searchFts(query, options);
  }

  override getNodeByQualifiedName(
    qname: string,
  ): ReturnType<InMemoryGraphStore['getNodeByQualifiedName']> {
    if (this.throwOn === 'qname') throw 'qname-boom';
    return super.getNodeByQualifiedName(qname);
  }

  override queryNodes(
    query: Parameters<InMemoryGraphStore['queryNodes']>[0],
  ): ReturnType<InMemoryGraphStore['queryNodes']> {
    if (this.throwOn === 'queryNodes') throw 'queryNodes-boom';
    return super.queryNodes(query);
  }

  override getAllNodes(): ReturnType<InMemoryGraphStore['getAllNodes']> {
    if (this.throwOn === 'allNodes') throw 'getAllNodes-boom';
    return super.getAllNodes();
  }
}

/** A structural ToolContext whose getSearchEngine throws a non-Error value. */
function throwingSearchContext(): unknown {
  return {
    store: new InMemoryGraphStore(),
    getSearchEngine: (): never => {
      throw 'engine-boom';
    },
  };
}

/** A structural ToolContext whose getGraphStats throws a non-Error value. */
function throwingStatsContext(): unknown {
  return {
    store: new InMemoryGraphStore(),
    getSearchEngine: (): never => {
      throw 'unused';
    },
    getGraphStats: (): never => {
      throw 'stats-boom';
    },
  };
}

function textOf(result: { content: Array<{ text?: string }> }): string {
  const first = result.content[0];
  return first?.text ?? '';
}

// ---------------------------------------------------------------------------
// searchGraph
// ---------------------------------------------------------------------------

describe('searchGraph', () => {
  it('finds nodes by name from a raw store and enriches the response', async () => {
    const result = await searchGraph({ query: 'MyService', projectId: PROJECT }, seededStore());
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(textOf(result));
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.some((i: { name: string }) => i.name === 'MyService')).toBe(true);
    expect(data.enriched).toBeDefined();
    expect(data.enriched.query).toBe('MyService');
    expect(data.hasMore).toBe(false);
  });

  it('works when passed a ToolContext instead of a raw store', async () => {
    const result = await searchGraph({ query: 'fetchData' }, seededContext());
    const data = JSON.parse(textOf(result));
    expect(data.items.some((i: { name: string }) => i.name === 'fetchData')).toBe(true);
  });

  it('respects labels filter', async () => {
    const result = await searchGraph({ query: 'core', labels: ['Function'] }, seededStore());
    const data = JSON.parse(textOf(result));
    expect(data.items.length).toBeGreaterThan(0);
    for (const item of data.items) {
      expect(item.label).toBe('Function');
    }
  });

  it('clamps limit to 100 and reports hasMore when results exceed limit', async () => {
    // "core" appears in many qnames; limit 1 forces hasMore.
    const result = await searchGraph({ query: 'core', limit: 1, offset: 0 }, seededStore());
    const data = JSON.parse(textOf(result));
    expect(data.items.length).toBeLessThanOrEqual(1);
    expect(data.hasMore).toBe(true);
  });

  it('returns empty result with message when no store is available', async () => {
    const result = await searchGraph({ query: 'x' }, null);
    const data = JSON.parse(textOf(result));
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.message).toBe('No graph store available');
  });

  it('returns empty result with message when store arg is undefined', async () => {
    const result = await searchGraph({ query: 'x' }, undefined);
    const data = JSON.parse(textOf(result));
    expect(data.message).toBe('No graph store available');
  });

  it('returns error message on store failure', async () => {
    const result = await searchGraph({ query: 'x' }, closedStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Search error');
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const result = await searchGraph({ query: 'x' }, new StringThrowingStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Search error: searchFts-boom');
  });
});

describe('searchGraphSchema', () => {
  it('requires query', () => {
    expect(searchGraphSchema.type).toBe('object');
    expect(searchGraphSchema.required).toContain('query');
  });
});

// ---------------------------------------------------------------------------
// searchCode
// ---------------------------------------------------------------------------

describe('searchCode', () => {
  it('uses hybrid BM25 search (no embeddings) via a context', async () => {
    const result = await searchCode({ query: 'doWork' }, seededContext());
    const data = JSON.parse(textOf(result));
    expect(data.items.length).toBeGreaterThan(0);
    const first = data.items[0];
    expect(first.searchMethod).toBe('BM25 text search');
    expect(first.bm25Score).toBeGreaterThan(0);
    expect(first.vectorScore).toBe(0);
  });

  it('reports hybrid search method when vector embeddings are present', async () => {
    const ctx = seededContext();
    ctx.getSearchEngine().registerEmbeddings(
      () => new Float32Array([1, 0]),
      async () => new Float32Array([1, 0]),
    );
    const result = await searchCode({ query: 'doWork' }, ctx);
    const data = JSON.parse(textOf(result));
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0].searchMethod).toBe('hybrid (BM25 + vector)');
    expect(data.items[0].vectorScore).toBeGreaterThan(0);
  });

  it('falls back to FTS when only a raw store is provided', async () => {
    const result = await searchCode({ query: 'MyService' }, seededStore());
    const data = JSON.parse(textOf(result));
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.searchMethod).toBe('FTS (basic text search)');
    expect(data.items[0].rank).toBeGreaterThan(0);
  });

  it('returns empty with message when no store is available', async () => {
    const result = await searchCode({ query: 'x' }, null);
    const data = JSON.parse(textOf(result));
    expect(data.items).toEqual([]);
    expect(data.message).toBe('No store available');
  });

  it('returns error message on store failure', async () => {
    const result = await searchCode({ query: 'x' }, new ToolContextImpl(closedStore()));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Search error');
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const result = await searchCode({ query: 'x' }, throwingSearchContext());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Search error: engine-boom');
  });
});

describe('searchCodeSchema', () => {
  it('requires query', () => {
    expect(searchCodeSchema.required).toContain('query');
  });
});

// ---------------------------------------------------------------------------
// semanticSearch
// ---------------------------------------------------------------------------

describe('semanticSearch', () => {
  it('returns vector results when embeddings are indexed', async () => {
    const ctx = seededContext();
    ctx.getSearchEngine().registerEmbeddings(
      () => new Float32Array([1, 0]),
      async () => new Float32Array([1, 0]),
    );
    const result = await semanticSearch({ query: 'doWork', limit: 10 }, ctx);
    const data = JSON.parse(textOf(result));
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.note).toBe('Vector embeddings available');
    expect(data.items[0].vectorScore).toBeGreaterThan(0);
  });

  it('falls back to BM25 message when embeddings are not indexed', async () => {
    const result = await semanticSearch({ query: 'doWork' }, seededContext());
    const data = JSON.parse(textOf(result));
    expect(data.items).toEqual([]);
    expect(data.searchMethod).toBe('BM25 text search (vector embeddings not indexed)');
  });

  it('falls back to BM25 message when no store is available', async () => {
    const result = await semanticSearch({ query: 'doWork' }, null);
    const data = JSON.parse(textOf(result));
    expect(data.searchMethod).toBe('BM25 text search (vector embeddings not indexed)');
  });

  it('returns error message on engine failure', async () => {
    const result = await semanticSearch({ query: 'x' }, new ToolContextImpl(closedStore()));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Semantic search error');
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const result = await semanticSearch({ query: 'x' }, throwingSearchContext());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Semantic search error: engine-boom');
  });
});

describe('semanticSearchSchema', () => {
  it('requires query', () => {
    expect(semanticSearchSchema.required).toContain('query');
  });
});

// ---------------------------------------------------------------------------
// traceCallPath
// ---------------------------------------------------------------------------

describe('traceCallPath', () => {
  it('traces a BFS path from a source symbol', async () => {
    const result = await traceCallPath(
      { sourceSymbol: 'core.MyService.doWork', projectId: PROJECT, maxDepth: 10 },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.path.length).toBeGreaterThan(0);
    expect(data.found).toBe(true);
    expect(data.enriched).toBeDefined();
    expect(data.enriched.totalHops).toBeGreaterThan(0);
  });

  it('detects found=false when targetSymbol is absent from the path', async () => {
    const result = await traceCallPath(
      {
        sourceSymbol: 'core.MyService.doWork',
        targetSymbol: 'core.nonexistent',
        projectId: PROJECT,
      },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.found).toBe(false);
  });

  it('detects found=true when targetSymbol is present in the path', async () => {
    const result = await traceCallPath(
      {
        sourceSymbol: 'core.MyService.doWork',
        targetSymbol: 'core.fetchData',
        projectId: PROJECT,
      },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.found).toBe(true);
  });

  it('reports maxDepthReached when maxDepth is shallow', async () => {
    const result = await traceCallPath(
      { sourceSymbol: 'core.MyService.doWork', projectId: PROJECT, maxDepth: 1 },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.maxDepthReached).toBe(true);
  });

  it('returns not-found message for an unknown source symbol', async () => {
    const result = await traceCallPath(
      { sourceSymbol: 'core.nope', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.found).toBe(false);
    expect(data.message).toBe('Source symbol "core.nope" not found in graph');
  });

  it('returns empty result when no store is available', async () => {
    const result = await traceCallPath({ sourceSymbol: 'x', projectId: PROJECT }, null);
    const data = JSON.parse(textOf(result));
    expect(data.path).toEqual([]);
    expect(data.found).toBe(false);
  });

  it('returns error message on store failure', async () => {
    const result = await traceCallPath({ sourceSymbol: 'x', projectId: PROJECT }, closedStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Trace error');
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const store = new StringThrowingStore();
    store.throwOn = 'qname';
    const result = await traceCallPath({ sourceSymbol: 'x', projectId: PROJECT }, store);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Trace error: qname-boom');
  });
});

describe('traceCallPathSchema', () => {
  it('requires sourceSymbol and projectId', () => {
    expect(traceCallPathSchema.required).toContain('sourceSymbol');
    expect(traceCallPathSchema.required).toContain('projectId');
  });
});

// ---------------------------------------------------------------------------
// queryGraph
// ---------------------------------------------------------------------------

describe('queryGraph', () => {
  it('executes a Cypher query against the store', async () => {
    const result = await queryGraph(
      { cypher: 'MATCH (n) RETURN n', projectId: PROJECT },
      seededStore(),
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(textOf(result));
    expect(Array.isArray(data.columns)).toBe(true);
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns no store message when store is absent', async () => {
    const result = await queryGraph({ cypher: 'MATCH (n) RETURN n' }, null);
    const data = JSON.parse(textOf(result));
    expect(data.error).toBe('No store available');
  });

  it('returns error for invalid Cypher', async () => {
    const result = await queryGraph({ cypher: 'INVALID QUERY !!!' }, seededStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Cypher query error');
  });

  it('skips limit assignment when limit is zero', async () => {
    const result = await queryGraph({ cypher: 'MATCH (n) RETURN n', limit: 0 }, seededStore());
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(textOf(result));
    expect(data.rows).toEqual([]);
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const store = new StringThrowingStore();
    store.throwOn = 'queryNodes';
    const result = await queryGraph({ cypher: 'MATCH (n) RETURN n' }, store);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Cypher query error: queryNodes-boom');
  });
});

describe('queryGraphSchema', () => {
  it('requires cypher', () => {
    expect(queryGraphSchema.required).toContain('cypher');
  });
});

// ---------------------------------------------------------------------------
// getCodeSnippet
// ---------------------------------------------------------------------------

describe('getCodeSnippet', () => {
  it('returns symbols in range for a known file', async () => {
    const result = await getCodeSnippet(
      { filePath: '/app/src/core/my-service.ts', startLine: 5, endLine: 35, projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.filePath).toBe('/app/src/core/my-service.ts');
    expect(data.totalSymbols).toBeGreaterThan(0);
    expect(data.symbolsInRange.length).toBeGreaterThan(0);
  });

  it('returns empty symbolsInRange when no node overlaps the line range', async () => {
    const result = await getCodeSnippet(
      { filePath: '/app/src/core/my-service.ts', startLine: 500, endLine: 600, projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.totalSymbols).toBeGreaterThan(0);
    expect(data.symbolsInRange).toEqual([]);
  });

  it('returns not-available message for an unknown file', async () => {
    const result = await getCodeSnippet(
      { filePath: '/nonexistent.ts', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.code).toBe('// Code snippet not available in current session');
  });

  it('returns not-available message when no store is available', async () => {
    const result = await getCodeSnippet({ filePath: '/x.ts', projectId: PROJECT }, null);
    const data = JSON.parse(textOf(result));
    expect(data.code).toBe('// Code snippet not available in current session');
  });

  it('returns error message on store failure', async () => {
    const result = await getCodeSnippet({ filePath: '/x.ts', projectId: PROJECT }, closedStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Snippet error');
  });

  it('excludes nodes with a null line range (directory/file nodes)', async () => {
    const result = await getCodeSnippet(
      { filePath: '/app/src/core', startLine: 1, endLine: 10, projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.totalSymbols).toBe(1);
    expect(data.symbolsInRange).toEqual([]);
  });

  it('excludes nodes whose end line is null (partially parsed symbols)', async () => {
    const result = await getCodeSnippet(
      { filePath: '/app/src/core/open-ended.ts', startLine: 1, endLine: 10, projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.totalSymbols).toBe(1);
    expect(data.symbolsInRange).toEqual([]);
  });

  it('excludes nodes whose start line is beyond the requested end line', async () => {
    const result = await getCodeSnippet(
      { filePath: '/app/src/core/my-service.ts', startLine: 1, endLine: 1, projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    // Only klass (startLine 1) overlaps; doWork (10) and validate (32) start after endLine 1.
    expect(data.symbolsInRange.map((s: { name: string }) => s.name)).toEqual(['MyService']);
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const store = new StringThrowingStore();
    store.throwOn = 'allNodes';
    const result = await getCodeSnippet({ filePath: '/x.ts', projectId: PROJECT }, store);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Snippet error: getAllNodes-boom');
  });
});

describe('getCodeSnippetSchema', () => {
  it('requires filePath and projectId', () => {
    expect(getCodeSnippetSchema.required).toContain('filePath');
    expect(getCodeSnippetSchema.required).toContain('projectId');
  });
});

// ---------------------------------------------------------------------------
// getArchitecture
// ---------------------------------------------------------------------------

describe('getArchitecture', () => {
  it('returns detailed architecture from a context', async () => {
    const result = await getArchitecture({ projectId: PROJECT }, seededContext());
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(textOf(result));
    expect(data.projectId).toBe(PROJECT);
    expect(data.nodeCount).toBeGreaterThan(0);
    expect(data.edgeCount).toBeGreaterThan(0);
    expect(data.labelDistribution.length).toBeGreaterThan(0);
    expect(data.layers.length).toBeGreaterThan(0);
    expect(data.entryPoints.length).toBeGreaterThan(0);
  });

  it('returns simplified architecture from a raw store', async () => {
    const result = await getArchitecture({ projectId: PROJECT }, seededStore());
    const data = JSON.parse(textOf(result));
    expect(data.projectId).toBe(PROJECT);
    expect(data.architecture).toBeDefined();
    expect(data.nodeCount).toBeGreaterThan(0);
  });

  it('returns no-store message when neither context nor store is provided', async () => {
    const result = await getArchitecture({ projectId: PROJECT }, null);
    const data = JSON.parse(textOf(result));
    expect(data.nodeCount).toBe(0);
    expect(data.message).toBe('No graph store available');
  });

  it('returns error message on store failure', async () => {
    const result = await getArchitecture({ projectId: PROJECT }, closedStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Architecture error');
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const result = await getArchitecture({ projectId: PROJECT }, throwingStatsContext());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Architecture error: stats-boom');
  });
});

describe('getArchitectureSchema', () => {
  it('requires projectId', () => {
    expect(getArchitectureSchema.required).toContain('projectId');
  });
});

// ---------------------------------------------------------------------------
// getGraphSchema
// ---------------------------------------------------------------------------

describe('getGraphSchema', () => {
  it('returns schema from a context', async () => {
    const result = await getGraphSchema({ projectId: PROJECT }, seededContext());
    const data = JSON.parse(textOf(result));
    expect(data.projectId).toBe(PROJECT);
    expect(data.nodeCount).toBeGreaterThan(0);
    expect(data.edgeCount).toBeGreaterThan(0);
    expect(data.nodeLabels.length).toBeGreaterThan(0);
    expect(data.relationshipTypes.length).toBeGreaterThan(0);
  });

  it('returns schema from a raw store with computed label/type counts', async () => {
    const result = await getGraphSchema({ projectId: PROJECT }, seededStore());
    const data = JSON.parse(textOf(result));
    expect(data.nodeCount).toBeGreaterThan(0);
    expect(data.edgeCount).toBeGreaterThan(0);
    // Labels sorted by descending count.
    const counts = data.nodeLabels.map((l: { count: number }) => l.count);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
    }
    // IMPLEMENTS and CALLS are present.
    const types = data.relationshipTypes.map((t: { type: string }) => t.type);
    expect(types).toContain(EDGE_CALLS);
    expect(types).toContain(EDGE_IMPLEMENTS);
  });

  it('returns no-store message when store is absent', async () => {
    const result = await getGraphSchema({ projectId: PROJECT }, null);
    const data = JSON.parse(textOf(result));
    expect(data.nodeLabels).toEqual([]);
    expect(data.relationshipTypes).toEqual([]);
    expect(data.message).toBe('No graph store available');
  });

  it('returns error message on store failure', async () => {
    const result = await getGraphSchema({ projectId: PROJECT }, closedStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Schema error');
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const result = await getGraphSchema({ projectId: PROJECT }, throwingStatsContext());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Schema error: stats-boom');
  });
});

describe('getGraphSchemaSchema', () => {
  it('requires projectId', () => {
    expect(getGraphSchemaSchema.required).toContain('projectId');
  });
});

// ---------------------------------------------------------------------------
// exploreSymbol
// ---------------------------------------------------------------------------

describe('exploreSymbol', () => {
  it('finds a symbol by qualified name with relationships', async () => {
    const result = await exploreSymbol(
      { symbolName: 'core.MyService.doWork', projectId: PROJECT, includeRelationships: true },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.symbol.name).toBe('doWork');
    expect(data.relationships.length).toBeGreaterThan(0);
    expect(data.calls.length).toBeGreaterThan(0);
    // validate calls doWork, so there is at least one caller.
    expect(data.calledBy.length).toBeGreaterThan(0);
  });

  it('finds a symbol without relationships when flag is false', async () => {
    const result = await exploreSymbol(
      { symbolName: 'core.MyService', projectId: PROJECT, includeRelationships: false },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.symbol.name).toBe('MyService');
    expect(data.relationships).toEqual([]);
    expect(data.calls).toEqual([]);
    expect(data.calledBy).toEqual([]);
    expect(data.fileSymbols.length).toBeGreaterThan(0);
  });

  it('falls back to FTS search when qname lookup misses', async () => {
    // "MyService" is not a qualified name; FTS resolves it to core.MyService.
    const result = await exploreSymbol(
      { symbolName: 'MyService', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.symbol.qualifiedName).toBe('core.MyService');
  });

  it('returns null symbol for an unknown name', async () => {
    const result = await exploreSymbol(
      { symbolName: 'zzz_unknown', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.symbol).toBeNull();
  });

  it('returns null symbol when no store is available', async () => {
    const result = await exploreSymbol({ symbolName: 'core.MyService', projectId: PROJECT }, null);
    const data = JSON.parse(textOf(result));
    expect(data.symbol).toBeNull();
    expect(data.fileSymbols).toEqual([]);
  });

  it('returns error message on store failure', async () => {
    const result = await exploreSymbol({ symbolName: 'x', projectId: PROJECT }, closedStore());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Explore error');
  });

  it('skips file siblings when the symbol has no file path', async () => {
    const result = await exploreSymbol(
      { symbolName: 'core.orphanFn', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.symbol.name).toBe('orphanFn');
    expect(data.symbol.filePath).toBeNull();
    expect(data.fileSymbols).toEqual([]);
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const store = new StringThrowingStore();
    store.throwOn = 'qname';
    const result = await exploreSymbol({ symbolName: 'x', projectId: PROJECT }, store);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Explore error: qname-boom');
  });
});

describe('exploreSymbolSchema', () => {
  it('requires symbolName and projectId', () => {
    expect(exploreSymbolSchema.required).toContain('symbolName');
    expect(exploreSymbolSchema.required).toContain('projectId');
  });
});

// ---------------------------------------------------------------------------
// findImplementations
// ---------------------------------------------------------------------------

describe('findImplementations', () => {
  it('finds interface implementations and their methods', async () => {
    const result = await findImplementations(
      { interfaceName: 'core.IService', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.interface.name).toBe('IService');
    expect(data.implementations.length).toBeGreaterThan(0);
    expect(data.implementations[0].qualifiedName).toBe('core.MyService');
    // MyService has HAS_METHOD edges to doWork and validate.
    expect(data.methodImplementations.length).toBeGreaterThan(0);
  });

  it('falls back to FTS search when qname lookup misses', async () => {
    // "IService" is not a qualified name; FTS resolves it to core.IService.
    const result = await findImplementations(
      { interfaceName: 'IService', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.interface.qualifiedName).toBe('core.IService');
  });

  it('returns empty result for an unknown interface', async () => {
    const result = await findImplementations(
      { interfaceName: 'zzz_unknown', projectId: PROJECT },
      seededStore(),
    );
    const data = JSON.parse(textOf(result));
    expect(data.interface).toBeNull();
    expect(data.implementations).toEqual([]);
  });

  it('returns empty result when no store is available', async () => {
    const result = await findImplementations(
      { interfaceName: 'core.IService', projectId: PROJECT },
      null,
    );
    const data = JSON.parse(textOf(result));
    expect(data.interface).toBeNull();
  });

  it('returns error message on store failure', async () => {
    const result = await findImplementations(
      { interfaceName: 'x', projectId: PROJECT },
      closedStore(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Implementation search error');
  });

  it('coerces a non-Error throw into a readable error message', async () => {
    const store = new StringThrowingStore();
    store.throwOn = 'qname';
    const result = await findImplementations({ interfaceName: 'x', projectId: PROJECT }, store);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Implementation search error: qname-boom');
  });
});

describe('findImplementationsSchema', () => {
  it('requires interfaceName and projectId', () => {
    expect(findImplementationsSchema.required).toContain('interfaceName');
    expect(findImplementationsSchema.required).toContain('projectId');
  });
});
