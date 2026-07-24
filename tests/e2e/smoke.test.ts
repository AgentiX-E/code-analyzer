// @code-analyzer — End-to-End Smoke Tests
// Validates the full product pipeline: MCP → HTTP → Graph Store.
// Uses real instances and real file systems, no mocks.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// MCP Server E2E
// ---------------------------------------------------------------------------

describe('MCP Server E2E', () => {
  let registry: ReturnType<typeof import('@code-analyzer/mcp').createToolRegistry>;

  beforeAll(async () => {
    const mcp = await import('@code-analyzer/mcp');
    registry = mcp.createToolRegistry();
  });

  it('creates a ToolRegistry with all tools', () => {
    const tools = registry.list();
    expect(tools.length).toBeGreaterThanOrEqual(39);
  });

  it('tool list includes core tools', () => {
    const tools = registry.list();
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain('index_status');
    expect(names).toContain('search_code');
    expect(names).toContain('review_pr');
    expect(names).toContain('cross_repo_review_pr');
    expect(names).toContain('analyze_repository');
    expect(names).toContain('list_projects');
    expect(names).toContain('semantic_search');
    expect(names).toContain('impact_analysis');
  });

  it('tools are grouped by profile', () => {
    const tools = registry.list();
    const profiles = new Set(tools.map((t: { profile: string }) => t.profile));
    expect(profiles.has('all')).toBe(true);
    expect(profiles.has('analysis')).toBe(true);
  });

  it('returns error for unknown tool', async () => {
    const result = await registry.execute('nonexistent_tool_xyz', {});
    expect(result.isError).toBe(true);
  });

  it('handles missing args for tools that require them', async () => {
    // search_code requires a 'query' arg — executing without it should error
    const result = await registry.execute('search_code', {});
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP Server E2E
// ---------------------------------------------------------------------------

describe('HTTP Server E2E', () => {
  let server: Awaited<ReturnType<typeof import('@code-analyzer/server').createServer>>;

  beforeAll(async () => {
    const mcp = await import('@code-analyzer/mcp');
    const serverModule = await import('@code-analyzer/server');
    const registry = mcp.createToolRegistry();
    server = await serverModule.createServer({
      registry,
      config: { port: 0, logging: { enabled: false } },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  function getPort(): number {
    const addr = server.app.server.address();
    if (addr && typeof addr === 'object') return addr.port;
    return 0;
  }

  function url(path: string): string {
    return `http://127.0.0.1:${getPort()}${path}`;
  }

  it('health endpoint returns ok', async () => {
    const res = await fetch(url('/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('health/live returns alive', async () => {
    const res = await fetch(url('/api/v1/health/live'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('alive');
  });

  it('health/ready returns status', async () => {
    const res = await fetch(url('/api/v1/health/ready'));
    expect([200, 503]).toContain(res.status);
  });

  it('tools/list returns tools', async () => {
    const res = await fetch(url('/api/v1/tools/list'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toBeInstanceOf(Array);
    expect(body.tools.length).toBeGreaterThanOrEqual(39);
  });

  it('tools/call returns 404 for unknown tool', async () => {
    const res = await fetch(url('/api/v1/tools/call'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'nonexistent', args: {} }),
    });
    expect(res.status).toBe(404);
  });

  it('tools/call returns 400 for missing tool field', async () => {
    const res = await fetch(url('/api/v1/tools/call'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('root endpoint returns service info', async () => {
    const res = await fetch(url('/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBeDefined();
  });

  it('API health endpoint works', async () => {
    const res = await fetch(url('/api/v1/health'));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Graph Store E2E — Full CRUD + Search + Traversal
// ---------------------------------------------------------------------------

describe('Graph Store E2E', () => {
  let store: InstanceType<typeof import('@code-analyzer/infra').InMemoryGraphStore>;
  let counter = 0;

  function uniqueName(base: string): string {
    return `${base}_${++counter}`;
  }

  beforeAll(async () => {
    const infra = await import('@code-analyzer/infra');
    store = new infra.InMemoryGraphStore(':memory:');
  });

  function makeNode(name: string, label = 'Class', projectId = 'e2e'): Parameters<typeof store.insertNode>[0] {
    const now = new Date().toISOString();
    return {
      id: 0,
      projectId,
      label: label as any,
      name,
      qualifiedName: `${uniqueName(name)}`,
      filePath: `src/${name}.ts`,
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function makeEdge(srcId: number, tgtId: number, type = 'IMPORTS'): Parameters<typeof store.insertEdge>[0] {
    return {
      id: 0,
      projectId: 'e2e',
      sourceId: srcId,
      targetId: tgtId,
      type: type as any,
      properties: {},
      weight: 1,
      createdAt: new Date().toISOString(),
    };
  }

  it('inserts and retrieves a single node', () => {
    const name = uniqueName('TestNode');
    const nodeId = store.insertNode(makeNode(name));
    expect(nodeId).toBeGreaterThan(0);
    const node = store.getNode(nodeId);
    expect(node).not.toBeNull();
    expect(node!.name).toBe(name);
  });

  it('inserts nodes in batch', () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode(uniqueName(`Batch${i}`), 'Function', 'batch-test'),
    );
    const ids = store.insertNodes(nodes);
    expect(ids.length).toBe(20);
  });

  it('performs FTS search on inserted text', () => {
    const name = uniqueName('SearchTarget');
    store.insertNode(makeNode(name, 'Class', 'fts-test'));
    const results = store.searchFts(name, { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.node.name === name)).toBe(true);
  });

  it('creates and retrieves edges', () => {
    const srcId = store.insertNode(makeNode(uniqueName('Source')));
    const tgtId = store.insertNode(makeNode(uniqueName('Target')));
    store.insertEdge(makeEdge(srcId, tgtId));

    const edges = store.getEdgesForNode(srcId);
    expect(edges.length).toBe(1);
    expect(edges[0]!.targetId).toBe(tgtId);
  });

  it('traverses BFS from a node', () => {
    const a = store.insertNode(makeNode(uniqueName('A')));
    const b = store.insertNode(makeNode(uniqueName('B')));
    store.insertEdge(makeEdge(a, b, 'CALLS'));

    const result = store.bfs(a, 3);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.visitedCount).toBeGreaterThan(0);
  });

  it('handles empty FTS search gracefully', () => {
    const results = store.searchFts('zzz_nonexistent_xyz_12345');
    expect(results).toEqual([]);
  });

  it('handles invalid node id gracefully', () => {
    const edges = store.getEdgesForNode(999999);
    expect(edges).toEqual([]);
  });

  it('returns null for non-existent node', () => {
    const node = store.getNode(999999);
    expect(node).toBeNull();
  });

  it('insertNodes handles empty array', () => {
    const ids = store.insertNodes([]);
    expect(ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Resilience / Edge Cases E2E
// ---------------------------------------------------------------------------

describe('Resilience E2E', () => {
  let store: InstanceType<typeof import('@code-analyzer/infra').InMemoryGraphStore>;
  let counter = 0;

  function uniqueName(base: string): string {
    return `R_${base}_${++counter}`;
  }

  beforeAll(async () => {
    const infra = await import('@code-analyzer/infra');
    store = new infra.InMemoryGraphStore(':memory:');
  });

  function makeNode(name: string): Parameters<typeof store.insertNode>[0] {
    const now = new Date().toISOString();
    return {
      id: 0,
      projectId: 'resilience',
      label: 'Function' as any,
      name,
      qualifiedName: uniqueName(name),
      filePath: `src/${name}.ts`,
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  it('handles rapid consecutive inserts and searches', () => {
    const ids: number[] = [];
    for (let i = 0; i < 50; i++) {
      const id = store.insertNode(makeNode(uniqueName(`Rapid${i}`)));
      ids.push(id);
    }
    expect(ids.length).toBe(50);

    // Search for some
    for (let i = 0; i < 50; i += 10) {
      const node = store.getNode(ids[i]!);
      expect(node).not.toBeNull();
    }
  });

  it('handles BFS on a deep chain', () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(store.insertNode(makeNode(uniqueName(`Chain${i}`))));
    }
    for (let i = 0; i < 9; i++) {
      store.insertEdge({
        id: 0, projectId: 'resilience', sourceId: ids[i]!, targetId: ids[i + 1]!,
        type: 'CALLS' as any, properties: {}, weight: 1, createdAt: new Date().toISOString(),
      });
    }
    const result = store.bfs(ids[0]!, 10);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.visitedCount).toBe(10);
  });

  it('handles empty string FTS query', () => {
    const results = store.searchFts('');
    expect(Array.isArray(results)).toBe(true);
  });

  it('insertNodes handles empty array', () => {
    const ids = store.insertNodes([]);
    expect(ids).toEqual([]);
  });
});
