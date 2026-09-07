// @code-analyzer/mcp — Change & Impact Analysis Tools Tests

import { describe, it, expect, vi } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import {
  detectChanges,
  detectChangesSchema,
  impactAnalysis,
  impactAnalysisSchema,
  routeMap,
  routeMapSchema,
  checkCycles,
  checkCyclesSchema,
} from '../tools/change-impact.js';
import type { ToolResult } from '../tools/registry.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 0,
    projectId: 'p1',
    label: 'Function',
    name: 'fn',
    qualifiedName: 'pkg.fn',
    filePath: '/src/fn.ts',
    startLine: 1,
    endLine: 2,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 0,
    projectId: 'p1',
    sourceId: 1,
    targetId: 2,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Extract the JSON payload carried by a tool result. */
function parseText(result: ToolResult): Record<string, unknown> {
  const text = result.content[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

/** Build a ToolContext wrapping a store seeded with the given nodes/edges. */
function ctxWith(nodes: GraphNode[], edges: Array<Partial<GraphEdge>> = []): ToolContextImpl {
  const store = new InMemoryGraphStore();
  const ids = nodes.map((n) => store.insertNode(n));
  for (const edge of edges) {
    store.insertEdge(makeEdge(edge));
  }
  return new ToolContextImpl(store);
}

/** Build a star graph: one target with `count` CALLS dependents. */
function starStore(count: number): { store: InMemoryGraphStore; target: string } {
  const store = new InMemoryGraphStore();
  const root = store.insertNode(
    makeNode({ name: 'root', qualifiedName: 'pkg.root', filePath: '/src/root.ts' }),
  );
  for (let i = 0; i < count; i++) {
    const child = store.insertNode(
      makeNode({ name: `c${i}`, qualifiedName: `pkg.c${i}`, filePath: `/src/c${i}.ts` }),
    );
    store.insertEdge(makeEdge({ sourceId: root, targetId: child, type: 'CALLS' }));
  }
  return { store, target: 'pkg.root' };
}

/** Build a store with `count` nodes, each in its own high-complexity file. */
function riskyStore(count: number): ToolContextImpl {
  const store = new InMemoryGraphStore();
  for (let i = 0; i < count; i++) {
    store.insertNode(
      makeNode({
        name: `f${i}`,
        qualifiedName: `pkg.f${i}`,
        filePath: `/f${i}.ts`,
        complexity: 11,
      }),
    );
  }
  return new ToolContextImpl(store);
}

// ---------------------------------------------------------------------------
// Schema registration
// ---------------------------------------------------------------------------

describe('Change & Impact — schemas', () => {
  it('declares required fields for each tool schema', () => {
    expect(detectChangesSchema.type).toBe('object');
    expect(detectChangesSchema.required).toContain('projectId');
    expect(detectChangesSchema.properties.fromRef).toBeDefined();
    expect(detectChangesSchema.properties.toRef).toBeDefined();
    expect(detectChangesSchema.properties.includeFiles).toBeDefined();

    expect(impactAnalysisSchema.type).toBe('object');
    expect(impactAnalysisSchema.required).toEqual(['projectId', 'fromRef', 'toRef']);
    expect(impactAnalysisSchema.properties.targetSymbol).toBeDefined();
    expect(impactAnalysisSchema.properties.depth).toBeDefined();

    expect(routeMapSchema.type).toBe('object');
    expect(routeMapSchema.required).toContain('projectId');
    expect(routeMapSchema.properties.includeHandlers).toBeDefined();

    expect(checkCyclesSchema.type).toBe('object');
    expect(checkCyclesSchema.required).toContain('projectId');
    expect(checkCyclesSchema.properties.module).toBeDefined();
    expect(checkCyclesSchema.properties.maxDepth).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// detectChanges
// ---------------------------------------------------------------------------

describe('detectChanges', () => {
  it('returns a low-risk empty summary when no store is provided', async () => {
    const result = await detectChanges({ projectId: 'p1' });
    expect(result.isError).toBeUndefined();
    const data = parseText(result);
    expect(data.range).toEqual({ from: 'HEAD~1', to: 'HEAD' });
    expect(data.summary).toMatchObject({ filesChanged: 0, symbolsChanged: 0, risk: 'low' });
    expect(data.changedFiles).toBeUndefined();
    expect(data.changedSymbols).toEqual([]);
  });

  it('honors explicit refs and includeFiles when no store is present', async () => {
    const result = await detectChanges({
      projectId: 'p1',
      fromRef: 'v1',
      toRef: 'v2',
      includeFiles: true,
    });
    const data = parseText(result);
    expect(data.range).toEqual({ from: 'v1', to: 'v2' });
    expect(data.changedFiles).toEqual([]);
  });

  it('reports graph integrity for a raw graph store', async () => {
    const store = new InMemoryGraphStore();
    const result = await detectChanges({ projectId: 'p1' }, store);
    const data = parseText(result);
    expect(data.summary).toMatchObject({ filesChanged: 0, symbolsChanged: 0, risk: 'low' });
    expect(data.graphIntegrity).toMatchObject({ projectId: 'p1', valid: true, nodeCount: 0 });
    expect(data.changedFiles).toBeUndefined();
  });

  it('surfaces an empty changedFiles list when includeFiles is true', async () => {
    const store = new InMemoryGraphStore();
    const result = await detectChanges({ projectId: 'p1', includeFiles: true }, store);
    const data = parseText(result);
    expect(data.changedFiles).toEqual([]);
  });

  it('aggregates file symbol counts and skips nodes without a file path', async () => {
    const ctx = ctxWith([
      makeNode({ name: 'a', qualifiedName: 'pkg.a', filePath: '/a.ts', complexity: 11 }),
      makeNode({ name: 'b', qualifiedName: 'pkg.b', filePath: '/a.ts', complexity: null }),
      makeNode({ name: 'c', qualifiedName: 'pkg.c', filePath: null, complexity: 5 }),
    ]);
    const result = await detectChanges({ projectId: 'p1' }, ctx);
    const data = parseText(result);
    expect(data.summary.totalFiles).toBe(1);
    expect(data.summary.totalSymbols).toBe(3);
    expect(data.summary.filesChanged).toBe(1); // /a.ts complexity 11 > 10
    expect(data.summary.risk).toBe('low');
  });

  it('flags a file as risky when it accumulates more than 20 symbols', async () => {
    const nodes = Array.from({ length: 21 }, (_, i) =>
      makeNode({ name: `s${i}`, qualifiedName: `pkg.s${i}`, filePath: '/shared.ts' }),
    );
    const ctx = ctxWith(nodes);
    const result = await detectChanges({ projectId: 'p1' }, ctx);
    const data = parseText(result);
    expect(data.summary.filesChanged).toBe(1); // /shared.ts has 21 symbols > 20
  });

  it('classifies risk as medium for 11-20 risky files', async () => {
    const ctx = riskyStore(11);
    const result = await detectChanges({ projectId: 'p1', includeFiles: true }, ctx);
    const data = parseText(result);
    expect(data.summary.risk).toBe('medium');
    expect(data.summary.filesChanged).toBe(11);
    expect(Array.isArray(data.changedFiles)).toBe(true);
    expect((data.changedFiles as unknown[]).length).toBe(11);
  });

  it('classifies risk as high for more than 20 risky files', async () => {
    const ctx = riskyStore(21);
    const result = await detectChanges({ projectId: 'p1' }, ctx);
    const data = parseText(result);
    expect(data.summary.risk).toBe('high');
    expect(data.summary.filesChanged).toBe(21);
  });

  it('lists high-impact symbols sorted by dependency count descending', async () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(makeNode({ name: 'a', qualifiedName: 'pkg.a' }));
    const b = store.insertNode(makeNode({ name: 'b', qualifiedName: 'pkg.b' }));
    // `a` gets 4 dependents, `b` gets 6 → b must sort first.
    for (let i = 0; i < 4; i++) {
      const leaf = store.insertNode(
        makeNode({ name: `la${i}`, qualifiedName: `pkg.la${i}`, filePath: null }),
      );
      store.insertEdge(makeEdge({ sourceId: a, targetId: leaf, type: 'CALLS' }));
    }
    for (let i = 0; i < 6; i++) {
      const leaf = store.insertNode(
        makeNode({ name: `lb${i}`, qualifiedName: `pkg.lb${i}`, filePath: null }),
      );
      store.insertEdge(makeEdge({ sourceId: b, targetId: leaf, type: 'CALLS' }));
    }
    const ctx = new ToolContextImpl(store);
    const result = await detectChanges({ projectId: 'p1' }, ctx);
    const data = parseText(result);
    const symbols = data.changedSymbols as Array<{ name: string; dependencyCount: number }>;
    expect(symbols.length).toBeGreaterThanOrEqual(2);
    expect(symbols[0].name).toBe('b');
    expect(symbols[0].dependencyCount).toBe(6);
    expect(symbols[1].name).toBe('a');
    expect(symbols[1].dependencyCount).toBe(4);
  });

  it('returns an error when graph stats throw an Error', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    ctx.getGraphStats = () => {
      throw new Error('boom');
    };
    const result = await detectChanges({ projectId: 'p1' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Change detection error: boom');
  });

  it('stringifies a non-Error thrown value', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    ctx.getGraphStats = () => {
      throw 'plain failure';
    };
    const result = await detectChanges({ projectId: 'p1' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Change detection error: plain failure');
  });
});

// ---------------------------------------------------------------------------
// impactAnalysis
// ---------------------------------------------------------------------------

describe('impactAnalysis', () => {
  it('returns an empty low-risk result with no store', async () => {
    const result = await impactAnalysis({ projectId: 'p1', fromRef: 'a', toRef: 'b' });
    const data = parseText(result);
    expect(data.riskLevel).toBe('low');
    expect(data.estimatedEffort).toBe('low');
    expect(data.directDependents).toBe(0);
    expect(data.totalImpact).toBe(0);
    expect(data.enriched).toBeNull();
  });

  it('accepts a ToolContext store and reports an empty result for an unknown symbol', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.missing', fromRef: 'a', toRef: 'b' },
      ctx,
    );
    const data = parseText(result);
    expect(data.riskLevel).toBe('low');
    expect(data.enriched).not.toBeNull();
  });

  it('walks the impact tree for a known target symbol', async () => {
    const { store } = starStore(2);
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b', depth: 3 },
      store,
    );
    const data = parseText(result);
    expect(data.directDependents).toBe(2);
    expect(data.indirectDependents).toBe(0);
    expect(data.totalImpact).toBe(3); // root + 2 direct dependents
    expect(data.riskLevel).toBe('low');
    expect((data.changedFiles as unknown[]).length).toBe(3);
  });

  it('distinguishes direct, indirect, and transitive impact depth', async () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(makeNode({ name: 'a', qualifiedName: 'pkg.a', filePath: '/a.ts' }));
    const b = store.insertNode(makeNode({ name: 'b', qualifiedName: 'pkg.b', filePath: '/b.ts' }));
    const c = store.insertNode(makeNode({ name: 'c', qualifiedName: 'pkg.c', filePath: null }));
    store.insertEdge(makeEdge({ sourceId: a, targetId: b, type: 'CALLS' }));
    store.insertEdge(makeEdge({ sourceId: b, targetId: c, type: 'CALLS' }));

    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.a', fromRef: 'a', toRef: 'b', depth: 3 },
      store,
    );
    const data = parseText(result);
    expect(data.directDependents).toBe(1); // b
    expect(data.indirectDependents).toBe(1); // c
    expect(data.totalImpact).toBe(3);
    // c has no filePath, so only /a.ts and /b.ts land in changedFiles.
    expect(data.changedFiles).toEqual(['/a.ts', '/b.ts']);
  });

  it('reports medium risk above 5 impacted symbols', async () => {
    const { store } = starStore(6);
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b' },
      store,
    );
    const data = parseText(result);
    expect(data.totalImpact).toBe(7);
    expect(data.riskLevel).toBe('medium');
    expect(data.estimatedEffort).toBe('medium');
  });

  it('reports high risk with medium effort between 15 and 25 symbols', async () => {
    const { store } = starStore(16);
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b' },
      store,
    );
    const data = parseText(result);
    expect(data.totalImpact).toBe(17);
    expect(data.riskLevel).toBe('high');
    expect(data.estimatedEffort).toBe('medium');
  });

  it('reports high risk with high effort above 25 symbols', async () => {
    const { store } = starStore(25);
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b' },
      store,
    );
    const data = parseText(result);
    expect(data.totalImpact).toBe(26);
    expect(data.riskLevel).toBe('high');
    expect(data.estimatedEffort).toBe('high');
  });

  it('reports critical risk above 30 symbols', async () => {
    const { store } = starStore(31);
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b' },
      store,
    );
    const data = parseText(result);
    expect(data.totalImpact).toBe(32);
    expect(data.riskLevel).toBe('critical');
    expect(data.estimatedEffort).toBe('high');
  });

  it('lists affected processes and routes with default fallbacks', async () => {
    const store = new InMemoryGraphStore();
    const root = store.insertNode(
      makeNode({ name: 'root', qualifiedName: 'pkg.root', filePath: '/root.ts' }),
    );
    const proc = store.insertNode(
      makeNode({
        name: 'checkout',
        qualifiedName: 'proc.checkout',
        label: 'Process',
        filePath: null,
      }),
    );
    const route = store.insertNode(
      makeNode({
        name: 'handler',
        qualifiedName: 'routes.handler',
        label: 'Route',
        filePath: null,
        properties: { routePath: '/api/x', routeMethod: 'POST' },
      }),
    );
    const bareRoute = store.insertNode(
      makeNode({ name: 'bare', qualifiedName: 'routes.bare', label: 'Route', filePath: null }),
    );
    store.insertEdge(makeEdge({ sourceId: root, targetId: proc, type: 'CALLS' }));
    store.insertEdge(makeEdge({ sourceId: root, targetId: route, type: 'CALLS' }));
    store.insertEdge(makeEdge({ sourceId: root, targetId: bareRoute, type: 'CALLS' }));

    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b' },
      store,
    );
    const data = parseText(result);
    const affected = data.processesAffected as Array<Record<string, unknown>>;
    const processHit = affected.find((x) => x.processName === 'proc.checkout');
    expect(processHit).toMatchObject({ severity: 'degraded' });
    const routeHit = affected.find((x) => x.routePath === '/api/x');
    expect(routeHit).toMatchObject({ routeMethod: 'POST' });
    // bareRoute has no routePath/routeMethod → routePath falls back to name,
    // routeMethod falls back to 'GET'.
    const bareHit = affected.find((x) => x.routePath === 'bare');
    expect(bareHit).toMatchObject({ routeMethod: 'GET' });
  });

  it('performs global root analysis when no target symbol is given', async () => {
    const store = new InMemoryGraphStore();
    // `root` is called by `dep`, so it has an incoming edge and is NOT a root.
    const root = store.insertNode(
      makeNode({ name: 'root', qualifiedName: 'pkg.root', filePath: '/root.ts' }),
    );
    // `dep` calls `root`, so it has no incoming edges and IS a root.
    const dep = store.insertNode(
      makeNode({ name: 'dep', qualifiedName: 'pkg.dep', filePath: '/dep.ts' }),
    );
    // `orphan` has no edges at all and a null filePath (filtered out of files).
    const orphan = store.insertNode(
      makeNode({ name: 'orphan', qualifiedName: 'pkg.orphan', filePath: null }),
    );
    store.insertEdge(makeEdge({ sourceId: dep, targetId: root, type: 'CALLS' }));

    const result = await impactAnalysis({ projectId: 'p1', fromRef: 'a', toRef: 'b' }, store);
    const data = parseText(result);
    // Roots = nodes with no incoming edges: `dep` and `orphan`. `orphan`'s
    // null filePath is dropped from changedFiles.
    expect(data.changedFiles).toEqual(['/dep.ts']);
    const symbols = data.changedSymbols as Array<Record<string, unknown>>;
    expect(symbols.map((s) => s.symbolQname)).toEqual(['pkg.dep', 'pkg.orphan']);
    expect(data.note).toContain('No target symbol specified');
  });

  it('returns an error when the graph store is closed', async () => {
    const { store } = starStore(1);
    store.close();
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b' },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Impact analysis error');
  });

  it('stringifies a non-Error thrown during traversal', async () => {
    const { store } = starStore(1);
    vi.spyOn(store, 'bfs').mockImplementation(() => {
      throw 'plain failure';
    });
    const result = await impactAnalysis(
      { projectId: 'p1', targetSymbol: 'pkg.root', fromRef: 'a', toRef: 'b' },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Impact analysis error: plain failure');
  });
});

// ---------------------------------------------------------------------------
// routeMap
// ---------------------------------------------------------------------------

describe('routeMap', () => {
  it('returns an empty route list with no store', async () => {
    const result = await routeMap({ projectId: 'p1' });
    const data = parseText(result);
    expect(data.routeCount).toBe(0);
    expect(data.routes).toEqual([]);
  });

  it('maps route nodes with method/path fallbacks and omits handlers by default', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      makeNode({
        name: 'handler',
        qualifiedName: 'routes.handler',
        label: 'Route',
        properties: { routePath: '/api/x', routeMethod: 'POST' },
      }),
    );
    store.insertNode(makeNode({ name: 'bare', qualifiedName: 'routes.bare', label: 'Route' }));
    store.insertNode(makeNode({ name: 'plain', qualifiedName: 'pkg.plain' })); // not a Route

    const result = await routeMap({ projectId: 'p1' }, store);
    const data = parseText(result);
    const routes = data.routes as Array<Record<string, unknown>>;
    expect(data.routeCount).toBe(2);
    expect(routes[0]).toMatchObject({ method: 'POST', path: '/api/x' });
    expect(routes[0].handler).toBeUndefined();
    expect(routes[1]).toMatchObject({ method: 'GET', path: 'routes.bare' });
  });

  it('includes handler and file path details when requested', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    ctx.store.insertNode(
      makeNode({
        name: 'handler',
        qualifiedName: 'routes.handler',
        label: 'Route',
        filePath: '/src/routes.ts',
        properties: { routePath: '/api/x' },
      }),
    );
    ctx.store.insertNode(
      makeNode({ name: 'bare', qualifiedName: 'routes.bare', label: 'Route', filePath: null }),
    );
    const result = await routeMap({ projectId: 'p1', includeHandlers: true }, ctx);
    const data = parseText(result);
    const routes = data.routes as Array<Record<string, unknown>>;
    expect(routes[0].handler).toBe('handler');
    expect(routes[0].filePath).toBe('/src/routes.ts');
    // A null filePath collapses to undefined rather than leaking null.
    expect(routes[1].handler).toBe('bare');
    expect(routes[1].filePath).toBeUndefined();
  });

  it('returns an error when the graph store is closed', async () => {
    const store = new InMemoryGraphStore();
    store.close();
    const result = await routeMap({ projectId: 'p1' }, store);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Route map error');
  });

  it('stringifies a non-Error thrown during node listing', async () => {
    const store = new InMemoryGraphStore();
    vi.spyOn(store, 'getAllNodes').mockImplementation(() => {
      throw 'plain failure';
    });
    const result = await routeMap({ projectId: 'p1' }, store);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Route map error: plain failure');
  });
});

// ---------------------------------------------------------------------------
// checkCycles
// ---------------------------------------------------------------------------

describe('checkCycles', () => {
  it('returns no cycles with no store', async () => {
    const result = await checkCycles({ projectId: 'p1' });
    const data = parseText(result);
    expect(data.cyclesFound).toBe(0);
    expect(data.cycles).toEqual([]);
    expect(data.warnings).toEqual([]);
  });

  it('detects an import cycle across three modules', async () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(makeNode({ name: 'a', qualifiedName: 'pkg.a' }));
    const b = store.insertNode(makeNode({ name: 'b', qualifiedName: 'pkg.b' }));
    const c = store.insertNode(makeNode({ name: 'c', qualifiedName: 'pkg.c' }));
    store.insertEdge(makeEdge({ sourceId: a, targetId: b, type: 'IMPORTS' }));
    store.insertEdge(makeEdge({ sourceId: b, targetId: c, type: 'IMPORTS' }));
    store.insertEdge(makeEdge({ sourceId: c, targetId: a, type: 'IMPORTS' }));

    const result = await checkCycles({ projectId: 'p1' }, store);
    const data = parseText(result);
    expect(data.cyclesFound).toBe(1);
    const cycles = data.cycles as Array<{ nodes: string[]; types: string[] }>;
    expect(cycles[0].nodes).toEqual(['pkg.a', 'pkg.b', 'pkg.c']);
  });

  it('detects no cycle in an acyclic import graph', async () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(makeNode({ name: 'a', qualifiedName: 'pkg.a' }));
    const b = store.insertNode(makeNode({ name: 'b', qualifiedName: 'pkg.b' }));
    store.insertEdge(makeEdge({ sourceId: a, targetId: b, type: 'IMPORTS' }));

    const result = await checkCycles({ projectId: 'p1' }, store);
    const data = parseText(result);
    expect(data.cyclesFound).toBe(0);
  });

  it('does not report a cycle for a shared descendant (cross edge)', async () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(makeNode({ name: 'a', qualifiedName: 'pkg.a' }));
    const b = store.insertNode(makeNode({ name: 'b', qualifiedName: 'pkg.b' }));
    const c = store.insertNode(makeNode({ name: 'c', qualifiedName: 'pkg.c' }));
    // Diamond: c is reachable from a directly and via b, so the a→c edge
    // lands on an already-visited, already-popped node (not in the stack).
    store.insertEdge(makeEdge({ sourceId: a, targetId: b, type: 'IMPORTS' }));
    store.insertEdge(makeEdge({ sourceId: a, targetId: c, type: 'IMPORTS' }));
    store.insertEdge(makeEdge({ sourceId: b, targetId: c, type: 'IMPORTS' }));

    const result = await checkCycles({ projectId: 'p1' }, store);
    const data = parseText(result);
    expect(data.cyclesFound).toBe(0);
  });

  it('scopes cycle detection to a single module when provided', async () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(makeNode({ name: 'a', qualifiedName: 'pkg.a' }));
    store.insertNode(makeNode({ name: 'b', qualifiedName: 'pkg.b' }));
    store.insertEdge(makeEdge({ sourceId: a, targetId: a, type: 'IMPORTS' }));

    const result = await checkCycles({ projectId: 'p1', module: 'pkg.a' }, store);
    const data = parseText(result);
    expect(data.cyclesFound).toBe(1);
  });

  it('ignores a missing module and reports no cycles', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(makeNode({ name: 'a', qualifiedName: 'pkg.a' }));
    const result = await checkCycles({ projectId: 'p1', module: 'pkg.missing' }, store);
    const data = parseText(result);
    expect(data.cyclesFound).toBe(0);
  });

  it('returns an error when the graph store is closed', async () => {
    const store = new InMemoryGraphStore();
    store.close();
    const result = await checkCycles({ projectId: 'p1' }, store);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cycle check error');
  });

  it('stringifies a non-Error thrown during node listing', async () => {
    const store = new InMemoryGraphStore();
    vi.spyOn(store, 'getAllNodes').mockImplementation(() => {
      throw 'plain failure';
    });
    const result = await checkCycles({ projectId: 'p1' }, store);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cycle check error: plain failure');
  });
});
