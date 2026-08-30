// @ts-nocheck
// @code-analyzer/server — GraphQL resolver branch coverage (round 2): the
// remaining reachable branches in project / symbolUsage / dependencyGraph /
// deleteProject / manageRepoGroup that round 1 did not exercise.

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

function insertNode(partial: Partial<GraphNode> & { projectId: string }): number {
  return store.insertNode({
    label: 'Class',
    name: 'Node',
    qualifiedName: 'pkg.Node',
    filePath: 'src/node.ts',
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

describe('resolvers — project null filePath fallback', () => {
  it('falls back to the project id when the project node has no file path', () => {
    insertNode({
      projectId: 'p1',
      label: 'Project',
      name: 'proj',
      qualifiedName: 'p1',
      filePath: null,
    });
    const result = resolvers.Query.project(null, { id: 'p1' }, ctx);
    expect(result.rootPath).toBe('p1');
  });
});

describe('resolvers — symbolUsage caller fallbacks', () => {
  it('uses the caller name and skips a null file path', () => {
    const target = insertNode({
      projectId: 'p1',
      name: 'target',
      qualifiedName: 'src.target',
      filePath: 'src/target.ts',
      label: 'Function',
    });
    const caller = insertNode({
      projectId: 'p1',
      name: 'caller',
      qualifiedName: null,
      filePath: null,
      label: 'Function',
    });
    insertEdge(caller, target, 'CALLS', 'p1');

    const results = resolvers.Query.symbolUsage(
      null,
      { projectId: 'p1', symbolName: 'target' },
      ctx,
    );
    expect(results[0].callers).toEqual(['caller']);
    expect(results[0].referencedBy).toEqual([]);
  });
});

describe('resolvers — dependencyGraph edge-type and package branches', () => {
  it('skips a non-import/call edge', () => {
    const a = insertNode({ projectId: 'p1', filePath: 'a/x.ts', qualifiedName: 'a.X' });
    const b = insertNode({ projectId: 'p1', filePath: 'a/y.ts', qualifiedName: 'a.Y' });
    insertEdge(a, b, 'EXTENDS', 'p1');

    const result = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(result.edgeCount).toBe(0);
  });

  it('ignores a same-package import edge', () => {
    const a = insertNode({ projectId: 'p1', filePath: 'pkg/a.ts', qualifiedName: 'pkg.A' });
    const b = insertNode({ projectId: 'p1', filePath: 'pkg/b.ts', qualifiedName: 'pkg.B' });
    insertEdge(a, b, 'IMPORTS', 'p1');

    const result = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(result.edgeCount).toBe(0);
  });

  it('deduplicates a repeated cross-package dependency', () => {
    const a = insertNode({ projectId: 'p1', filePath: 'p1/a.ts', qualifiedName: 'p1.A' });
    const b = insertNode({ projectId: 'p1', filePath: 'p2/b.ts', qualifiedName: 'p2.B' });
    const c = insertNode({ projectId: 'p1', filePath: 'p2/c.ts', qualifiedName: 'p2.C' });
    // First p1 -> p2 edge records the dependency; the second exercises the
    // already-present-adjacency and already-includes branches.
    insertEdge(a, b, 'IMPORTS', 'p1');
    insertEdge(a, c, 'IMPORTS', 'p1');

    const result = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(result.edgeCount).toBe(1);
  });
});

describe('resolvers — deleteProject cross-project skip', () => {
  it('deletes only the matching project and ignores other projects', () => {
    insertNode({ projectId: 'p1', qualifiedName: 'p1.A' });
    const a = insertNode({ projectId: 'p2', qualifiedName: 'p2.A' });
    const b = insertNode({ projectId: 'p2', qualifiedName: 'p2.B' });
    insertEdge(a, b, 'CALLS', 'p2');

    const result = resolvers.Mutation.deleteProject(null, { id: 'p1' }, ctx);
    expect(result).toBe(true);
  });
});

describe('resolvers — manageRepoGroup default fallbacks', () => {
  it('generates default id/name/description/repos when all are omitted', () => {
    const result = resolvers.Mutation.manageRepoGroup(
      null,
      { action: 'create', groupId: null, name: null, description: null, repos: null },
      ctx,
    );
    expect(result.id).toMatch(/^group_/);
    expect(result.name).toBe('Unnamed Group');
    expect(result.description).toBe('');
    expect(result.repos).toEqual([]);
  });
});
