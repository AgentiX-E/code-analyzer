// @ts-nocheck
// @code-analyzer/mcp — Smart Response builder branch coverage (utility helpers
// and edge cases not exercised by smart-response.test.ts).

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  buildImpactResponse,
  buildTraceResponse,
  buildSearchResponse,
} from '../tools/smart-response.js';
import type { GraphNode } from '@code-analyzer/shared';

let nodeId = 1000;
let edgeId = 1000;

function addNode(store: InMemoryGraphStore, overrides: Partial<GraphNode> = {}): number {
  const id = store.insertNode({
    id: 0,
    projectId: 'test-project',
    label: 'Function',
    name: `f${nodeId}`,
    qualifiedName: `pkg.F${nodeId++}`,
    filePath: `/src/f${nodeId}.ts`,
    startLine: 1,
    endLine: 2,
    language: 'typescript',
    properties: {},
    signature: `f${nodeId}(): void`,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });
  return id;
}

function addEdge(store: InMemoryGraphStore, sourceId: number, targetId: number, type = 'CALLS') {
  store.insertEdge({
    id: edgeId++,
    projectId: 'test-project',
    sourceId,
    targetId,
    type,
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
  });
}

function emptyImpactResult(overrides = {}) {
  return {
    changedFiles: [],
    changedSymbols: [],
    impactTree: [],
    riskLevel: 'low',
    processesAffected: [],
    estimatedEffort: 'low',
    directDependents: 0,
    indirectDependents: 0,
    totalImpact: 0,
    ...overrides,
  };
}

describe('buildImpactResponse — empty changedSymbols / null filePath', () => {
  it('defaults projectId to unknown and tolerates a null caller filePath', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({
        impactTree: [{ symbolQname: 'pkg.X', label: 'Function', filePath: null, depth: 1 }],
      }),
      store,
    );
    expect(result.summary.projectId).toBe('unknown');
    expect(result.directCallers[0].filePath).toBeNull();
  });

  it('dedupes callers that share a qualified name from graph edges', () => {
    const store = new InMemoryGraphStore();
    const target = addNode(store, { name: 'target', qualifiedName: 'pkg.Target' });
    const caller = addNode(store, { name: 'caller', qualifiedName: 'pkg.Caller' });
    addEdge(store, caller, target);
    addEdge(store, caller, target); // duplicate edge -> dedup in getCallers
    const result = buildImpactResponse(
      emptyImpactResult({ changedSymbols: [{ symbolQname: 'pkg.Target' }] }),
      store,
      'pkg.Target',
    );
    expect(result.directCallers.filter((c) => c.qualifiedName === 'pkg.Caller')).toHaveLength(1);
  });

  it('produces change clusters with distinct effort levels', () => {
    const store = new InMemoryGraphStore();
    const many = Array.from({ length: 12 }, (_, i) => `/src/feature/f${i}.ts`);
    const result = buildImpactResponse(emptyImpactResult({ changedFiles: many }), store);
    expect(result.changeClusters.length).toBe(1);
    expect(result.changeClusters[0].estimatedEffort).toBe('high');
  });
});

describe('buildImpactResponse — deriveSuggestedReviewers with null caller paths', () => {
  it('skips callers with null filePath when deriving reviewers', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({
        impactTree: [
          { symbolQname: 'pkg.A', label: 'Function', filePath: null, depth: 1 },
          { symbolQname: 'pkg.B', label: 'Function', filePath: '/src/pkg/b.ts', depth: 1 },
        ],
      }),
      store,
    );
    // reviewer teams derive only from non-null file paths
    expect(result.suggestedReviewers.some((r) => r.includes('/src/pkg'))).toBe(true);
  });
});

describe('buildTraceResponse — edge-derived callType and prev-node resolution', () => {
  it('derives callType from a real edge between consecutive hops', () => {
    const store = new InMemoryGraphStore();
    const a = addNode(store, { name: 'A', qualifiedName: 'pkg.A' });
    const b = addNode(store, { name: 'B', qualifiedName: 'pkg.B' });
    addEdge(store, a, b, 'IMPLEMENTS');
    const result = buildTraceResponse(
      {
        path: [
          { symbol: 'pkg.A', depth: 0, relationship: 'calls', filePath: '/src/a.ts' },
          { symbol: 'pkg.B', depth: 1, relationship: 'calls', filePath: '/src/b.ts' },
        ],
        found: true,
        maxDepthReached: false,
        nodes: [],
        edges: [],
      },
      store,
    );
    expect(result.path[1].callType).toBe('IMPLEMENTS');
  });

  it('marks in-cycle hops when the path revisits a symbol', () => {
    const store = new InMemoryGraphStore();
    addNode(store, { name: 'A', qualifiedName: 'pkg.A' });
    const result = buildTraceResponse(
      {
        path: [
          { symbol: 'pkg.A', depth: 0, relationship: 'calls', filePath: null },
          { symbol: 'pkg.B', depth: 1, relationship: 'calls', filePath: null },
          { symbol: 'pkg.A', depth: 2, relationship: 'calls', filePath: null },
        ],
        found: true,
        maxDepthReached: false,
      },
      store,
    );
    expect(result.cyclesDetected.length).toBe(1);
    expect(result.path[0].isInCycle).toBe(true);
  });
});

describe('buildSearchResponse — single-part qualifiedName and path', () => {
  it('returns null module/package context for single-segment identifiers', () => {
    const store = new InMemoryGraphStore();
    const result = buildSearchResponse(
      [{ nodeId: 99999, name: 'bareName', qualifiedName: 'bareName', filePath: 'single.ts' }],
      store,
    );
    const item = result.items[0];
    expect(item.moduleContext.moduleName).toBeNull();
    expect(item.moduleContext.packageName).toBeNull();
    expect(item.name).toBe('bareName');
  });
});
