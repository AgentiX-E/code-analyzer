// @ts-nocheck
// @code-analyzer/server — GraphQL resolver branch coverage: impactAnalysis
// effort levels, nullable-field fallbacks, symbolUsage missing-caller/null
// filePath, dependencyGraph single-segment/cycle branches, and indexProject.

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

describe('resolvers — impactAnalysis effort levels', () => {
  it('reports low effort for few affected nodes', () => {
    insertNode({ projectId: 'p1', filePath: 'f.ts' });
    const result = resolvers.Query.impactAnalysis(
      null,
      { projectId: 'p1', changedFiles: ['f.ts'] },
      ctx,
    );
    expect(result.estimatedEffort).toBe('low');
  });

  it('reports medium effort for 11-20 affected nodes', () => {
    for (let i = 0; i < 15; i++) {
      insertNode({ projectId: 'p1', filePath: 'f.ts', qualifiedName: `pkg.N${i}` });
    }
    const result = resolvers.Query.impactAnalysis(
      null,
      { projectId: 'p1', changedFiles: ['f.ts'] },
      ctx,
    );
    expect(result.estimatedEffort).toBe('medium');
  });

  it('reports high effort for more than 20 affected nodes', () => {
    for (let i = 0; i < 25; i++) {
      insertNode({ projectId: 'p1', filePath: 'f.ts', qualifiedName: `pkg.N${i}` });
    }
    const result = resolvers.Query.impactAnalysis(
      null,
      { projectId: 'p1', changedFiles: ['f.ts'] },
      ctx,
    );
    expect(result.estimatedEffort).toBe('high');
  });

  it('falls back to 0 for null start/end line in changed symbols', () => {
    insertNode({ projectId: 'p1', filePath: 'f.ts', startLine: null, endLine: null });
    const result = resolvers.Query.impactAnalysis(
      null,
      { projectId: 'p1', changedFiles: ['f.ts'] },
      ctx,
    );
    expect(result.changedSymbols[0].startLine).toBe(0);
    expect(result.changedSymbols[0].endLine).toBe(0);
  });
});

describe('resolvers — projectStats language distribution', () => {
  it('skips nodes with null language', () => {
    insertNode({ projectId: 'p1', language: null, qualifiedName: 'pkg.noLang' });
    insertNode({ projectId: 'p1', language: 'typescript', qualifiedName: 'pkg.ts' });
    const result = resolvers.Query.projectStats(null, { projectId: 'p1' }, ctx);
    expect(result.languageDistribution).toEqual({ typescript: 1 });
  });
});

describe('resolvers — symbolUsage nullable fallbacks', () => {
  it('falls back to empty string and 0 for null filePath/startLine', () => {
    insertNode({
      projectId: 'p1',
      name: 'orphan',
      qualifiedName: 'src.orphan',
      filePath: null,
      startLine: null,
      label: 'Function',
    });
    const results = resolvers.Query.symbolUsage(
      null,
      { projectId: 'p1', symbolName: 'orphan' },
      ctx,
    );
    expect(results[0].filePath).toBe('');
    expect(results[0].line).toBe(0);
  });
});

describe('resolvers — dependencyGraph branches', () => {
  it('classifies a single-segment file path as the root package', () => {
    insertNode({ projectId: 'p1', filePath: 'single.ts', qualifiedName: 'pkg.a' });
    const result = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(result.packages).toContain('.');
  });

  it('ignores edges whose endpoints have null filePath', () => {
    const a = insertNode({ projectId: 'p1', filePath: null, qualifiedName: 'pkg.a' });
    const b = insertNode({ projectId: 'p1', filePath: null, qualifiedName: 'pkg.b' });
    insertEdge(a, b, 'CALLS', 'p1');
    const result = resolvers.Query.dependencyGraph(null, { projectId: 'p1' }, ctx);
    expect(result.edgeCount).toBe(0);
  });
});

describe('resolvers — indexProject mutation', () => {
  it('generates a project id when none is provided', () => {
    const result = resolvers.Mutation.indexProject(null, { path: '/src/app' }, ctx);
    expect(result.id).toMatch(/^proj_/);
    expect(result.name).toBe('app');
  });
});
