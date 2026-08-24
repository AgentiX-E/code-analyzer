// @code-analyzer/server — GraphQL Resolver Coverage Tests
// Directly invokes resolvers that the Yoga integration tests did not reach:
// symbolUsage, dependencyGraph, the JSON/DateTime scalars, subscriptions, and
// the remaining impactAnalysis / edges / projects branches.

import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/infra';
import { resolvers } from '../graphql/resolvers.js';
import { createTestContext, type GraphQLContext } from '../graphql/context.js';

let store: InMemoryGraphStore;
let ctx: GraphQLContext;

beforeEach(() => {
  store = new InMemoryGraphStore();
  ctx = createTestContext(store);
});

function insertNode(partial: Partial<GraphNode> & { projectId: string; filePath: string }): number {
  return store.insertNode({
    label: 'Class',
    name: 'Node',
    qualifiedName: 'pkg.Node',
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
    ...partial,
  });
}

function insertEdge(sourceId: number, targetId: number, type: string, projectId: string): void {
  store.insertEdge({
    sourceId,
    targetId,
    type: type as never,
    projectId,
    properties: {},
    weight: 1,
    createdAt: new Date('2026-01-01').toISOString(),
  });
}

describe('resolvers — symbolUsage', () => {
  it('returns callers and referencedBy for a matched symbol', () => {
    const targetId = insertNode({
      projectId: 'p1',
      name: 'getUser',
      qualifiedName: 'src.services.UserService.getUser',
      filePath: 'src/services/UserService.ts',
      label: 'Function',
    });
    const callerId = insertNode({
      projectId: 'p1',
      name: 'callerFn',
      qualifiedName: 'src.app.callerFn',
      filePath: 'src/app/index.ts',
      label: 'Function',
    });
    insertEdge(callerId, targetId, 'CALLS', 'p1');

    const results = resolvers.Query.symbolUsage(
      null,
      { projectId: 'p1', symbolName: 'getUser' },
      ctx,
    );
    expect(results).toHaveLength(1);
    expect(results[0].symbolName).toBe('getUser');
    expect(results[0].referenceCount).toBe(1);
    expect(results[0].callers).toContain('src.app.callerFn');
    expect(results[0].referencedBy).toContain('src/app/index.ts');
  });

  it('applies the limit and handles a missing limit', () => {
    for (let i = 0; i < 5; i++) {
      insertNode({
        projectId: 'p1',
        name: `getUser${i}`,
        qualifiedName: `src.getUser${i}`,
        filePath: `src/f${i}.ts`,
        label: 'Function',
      });
    }
    const results = resolvers.Query.symbolUsage(
      null,
      { projectId: 'p1', symbolName: 'getUser' },
      ctx,
    );
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

describe('resolvers — dependencyGraph', () => {
  it('builds package adjacency from import edges', () => {
    const a = insertNode({ projectId: 'p1', filePath: 'pkgA/a.ts', qualifiedName: 'pkgA.a' });
    const b = insertNode({ projectId: 'p1', filePath: 'pkgB/b.ts', qualifiedName: 'pkgB.b' });
    insertEdge(a, b, 'IMPORTS', 'p1');

    const graph = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(graph.packages).toContain('pkgA');
    expect(graph.packages).toContain('pkgB');
    expect(graph.adjacencyList['pkgA']).toContain('pkgB');
    expect(graph.circularDeps).toHaveLength(0);
  });

  it('detects circular dependencies across packages', () => {
    const a = insertNode({ projectId: 'p1', filePath: 'pkgA/a.ts', qualifiedName: 'pkgA.a' });
    const b = insertNode({ projectId: 'p1', filePath: 'pkgB/b.ts', qualifiedName: 'pkgB.b' });
    insertEdge(a, b, 'IMPORTS', 'p1');
    insertEdge(b, a, 'IMPORTS', 'p1');

    const graph = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(graph.circularDeps.length).toBeGreaterThan(0);
  });

  it('handles single-segment file paths as the root package', () => {
    const a = insertNode({
      projectId: 'p1',
      filePath: 'standalone.ts',
      qualifiedName: 'standalone',
    });
    const graph = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(graph.packages).toContain('.');
    expect(graph.nodeCount).toBeGreaterThanOrEqual(1);
  });
});

describe('resolvers — scalars', () => {
  it('serializes JSON values', () => {
    expect(resolvers.JSON.serialize({ a: 1 })).toEqual({ a: 1 });
    expect(resolvers.JSON.parseValue('{"a":1}')).toEqual('{"a":1}');
  });

  it('serializes DateTime for Date and string inputs', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(resolvers.DateTime.serialize(date)).toBe('2026-01-01T00:00:00.000Z');
    expect(resolvers.DateTime.serialize('2026-01-01')).toBe('2026-01-01');
    expect(resolvers.DateTime.parseValue('2026-01-01')).toBeInstanceOf(Date);
  });
});

describe('resolvers — subscriptions', () => {
  it('exposes empty subscription generators', async () => {
    for (const key of ['projectIndexed', 'reviewCompleted', 'healthChanged'] as const) {
      const sub = resolvers.Subscription[key];
      const gen = sub.subscribe();
      const next = await gen.next();
      expect(next.done).toBe(true);
      expect(sub.resolve('payload')).toBe('payload');
    }
  });
});

describe('resolvers — impactAnalysis risk levels', () => {
  it('reports MEDIUM risk for 6-20 affected nodes', () => {
    for (let i = 0; i < 6; i++) {
      insertNode({ projectId: 'p1', filePath: 'src/changed.ts', qualifiedName: `src.n${i}` });
    }
    const result = resolvers.Query.impactAnalysis(
      null,
      { projectId: 'p1', changedFiles: ['src/changed.ts'] },
      ctx,
    );
    expect(result.riskLevel).toBe('MEDIUM');
  });

  it('reports HIGH risk for more than 20 affected nodes', () => {
    for (let i = 0; i < 21; i++) {
      insertNode({ projectId: 'p1', filePath: 'src/changed.ts', qualifiedName: `src.n${i}` });
    }
    const result = resolvers.Query.impactAnalysis(
      null,
      { projectId: 'p1', changedFiles: ['src/changed.ts'] },
      ctx,
    );
    expect(result.riskLevel).toBe('HIGH');
    expect(result.estimatedEffort).toBe('high');
  });
});

describe('resolvers — edges filtering', () => {
  it('applies sourceId, targetId and type filters', () => {
    const a = insertNode({ projectId: 'p1', filePath: 'a.ts', qualifiedName: 'a' });
    const b = insertNode({ projectId: 'p1', filePath: 'b.ts', qualifiedName: 'b' });
    insertEdge(a, b, 'CALLS', 'p1');

    const bySource = resolvers.Query.edges(null, { projectId: 'p1', sourceId: a }, ctx);
    expect(bySource.items.length).toBeGreaterThanOrEqual(1);

    const byTarget = resolvers.Query.edges(null, { projectId: 'p1', targetId: b }, ctx);
    expect(byTarget.items.length).toBeGreaterThanOrEqual(1);

    const byType = resolvers.Query.edges(null, { projectId: 'p1', type: 'CALLS' }, ctx);
    expect(byType.items.length).toBeGreaterThanOrEqual(1);
  });
});

describe('resolvers — projects status filter', () => {
  it('filters projects by status', () => {
    // Project node → READY; a bare node without a Project node → INDEXING
    store.insertNode({
      id: 0,
      projectId: 'ready-proj',
      label: 'Project',
      name: 'ready',
      qualifiedName: 'ready',
      filePath: '/tmp/ready',
      startLine: null,
      endLine: null,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-01').toISOString(),
    });
    insertNode({ projectId: 'indexing-proj', filePath: 'x.ts', qualifiedName: 'x' });

    const ready = resolvers.Query.projects(null, { status: 'READY' }, ctx);
    expect(ready.some((p) => p.id === 'ready-proj')).toBe(true);
    expect(ready.some((p) => p.id === 'indexing-proj')).toBe(false);

    const indexing = resolvers.Query.projects(null, { status: 'INDEXING' }, ctx);
    expect(indexing.some((p) => p.id === 'indexing-proj')).toBe(true);
  });
});
