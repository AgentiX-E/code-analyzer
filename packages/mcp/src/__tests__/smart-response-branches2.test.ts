// @code-analyzer/mcp — Smart Response builder: additional branch coverage for
// reviewer-derivation, transitive-caller depth, and trace/search edge cases.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  buildImpactResponse,
  buildTraceResponse,
  buildSearchResponse,
} from '../tools/smart-response.js';
import type { GraphNode, RelationshipType } from '@code-analyzer/shared';

let nodeId = 2000;
let edgeId = 2000;

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
    properties: { name: `f${nodeId}` },
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

function addEdge(
  store: InMemoryGraphStore,
  sourceId: number,
  targetId: number,
  type: RelationshipType = 'CALLS',
) {
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

describe('buildImpactResponse — transitive caller depth cap', () => {
  it('stops collecting callers beyond the max depth', () => {
    const store = new InMemoryGraphStore();
    const target = addNode(store, { name: 'target', qualifiedName: 'pkg.Target' });
    const c1 = addNode(store, { name: 'c1', qualifiedName: 'pkg.C1' });
    const c2 = addNode(store, { name: 'c2', qualifiedName: 'pkg.C2' });
    const c3 = addNode(store, { name: 'c3', qualifiedName: 'pkg.C3' });
    const c4 = addNode(store, { name: 'c4', qualifiedName: 'pkg.C4' });
    addEdge(store, c1, target);
    addEdge(store, c2, c1);
    addEdge(store, c3, c2);
    addEdge(store, c4, c3);

    const result = buildImpactResponse(
      emptyImpactResult({ changedSymbols: [{ symbolQname: 'pkg.Target' }] }),
      store,
      'pkg.Target',
    );
    // The transitive-caller BFS is capped at depth 3, so c4 (depth 4) is pruned.
    expect(result.indirectCallers.some((c) => c.qualifiedName === 'pkg.C4')).toBe(false);
  });
});

describe('buildImpactResponse — reviewer derivation', () => {
  it('skips an indirect caller with a null file path', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({
        impactTree: [{ symbolQname: 'pkg.A', label: 'Function', filePath: null, depth: 2 }],
      }),
      store,
    );
    expect(result.indirectCallers[0]!.filePath).toBeNull();
    expect(result.suggestedReviewers).toHaveLength(0);
  });

  it('ignores a single-segment file path when deriving reviewers', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({
        impactTree: [{ symbolQname: 'pkg.A', label: 'Function', filePath: 'single.ts', depth: 1 }],
      }),
      store,
    );
    // A bare filename has no directory, so it cannot yield a module owner.
    expect(result.suggestedReviewers).toHaveLength(0);
  });

  it('ignores a dot-prefixed relative path when deriving reviewers', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({
        impactTree: [{ symbolQname: 'pkg.A', label: 'Function', filePath: './foo.ts', depth: 1 }],
      }),
      store,
    );
    expect(result.suggestedReviewers).toHaveLength(0);
  });
});

describe('buildImpactResponse — change clusters without a root symbol', () => {
  it('falls back to the directory when an impact tree item lacks a symbolQname', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({
        changedFiles: ['/src/feature/a.ts'],
        impactTree: [{ label: 'Function', depth: 1 }],
      }),
      store,
    );
    expect(result.changeClusters[0]!.rootSymbol).toBe('/src/feature');
  });

  it('assigns medium effort to a 6-10 file cluster', () => {
    const store = new InMemoryGraphStore();
    const files = Array.from({ length: 6 }, (_, i) => `/src/feature/f${i}.ts`);
    const result = buildImpactResponse(emptyImpactResult({ changedFiles: files }), store);
    expect(result.changeClusters[0]!.estimatedEffort).toBe('medium');
  });
});

describe('buildTraceResponse — empty previous symbol', () => {
  it('skips call-type resolution when the previous hop has an empty symbol', () => {
    const store = new InMemoryGraphStore();
    addNode(store, { name: 'A', qualifiedName: 'pkg.A' });
    const result = buildTraceResponse(
      {
        path: [
          { symbol: '', depth: 0, relationship: 'calls', filePath: null },
          { symbol: 'pkg.A', depth: 1, relationship: 'calls', filePath: '/src/a.ts' },
        ],
        found: true,
        maxDepthReached: false,
      },
      store,
    );
    // The previous symbol is empty, so call type stays as the relationship.
    expect(result.path[1]!.callType).toBe('calls');
  });

  it('keeps the relationship when consecutive nodes share no edge', () => {
    const store = new InMemoryGraphStore();
    addNode(store, { name: 'A', qualifiedName: 'pkg.A' });
    addNode(store, { name: 'B', qualifiedName: 'pkg.B' });
    // No edge between A and B: call-type resolution finds nothing and keeps the
    // relationship string from the path step.
    const result = buildTraceResponse(
      {
        path: [
          { symbol: 'pkg.A', depth: 0, relationship: 'calls', filePath: '/src/a.ts' },
          { symbol: 'pkg.B', depth: 1, relationship: 'calls', filePath: '/src/b.ts' },
        ],
        found: true,
        maxDepthReached: false,
      },
      store,
    );
    expect(result.path[1]!.callType).toBe('calls');
  });

  it('uses the empty last path segment when a hop has an empty symbol and no node', () => {
    const store = new InMemoryGraphStore();
    const result = buildTraceResponse(
      {
        path: [{ symbol: '', depth: 0, relationship: 'calls', filePath: null }],
        found: true,
        maxDepthReached: false,
      },
      store,
    );
    // Empty symbol -> split('.').pop() yields '' (String.split never returns an
    // empty array), which is the name when there is no graph node.
    expect(result.path[0]!.name).toBe('');
  });
});

describe('buildImpactResponse — projectId and test-file detection', () => {
  it('falls back to unknown when a changed symbol matches no graph node', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({ changedSymbols: [{ symbolQname: 'pkg.DoesNotExist' }] }),
      store,
    );
    expect(result.summary.projectId).toBe('unknown');
  });

  it('flags a changed file that is itself a test file', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({ changedFiles: ['src/__tests__/foo.test.ts'] }),
      store,
    );
    expect(result.testFilesAffected).toContain('src/__tests__/foo.test.ts');
  });

  it('does not mark a test file whose callees do not reference the target', () => {
    const store = new InMemoryGraphStore();
    addNode(store, { name: 'target', qualifiedName: 'pkg.Target' });
    const other = addNode(store, { name: 'other', qualifiedName: 'pkg.Other' });
    const testNode = addNode(store, {
      name: 'testFn',
      qualifiedName: 'pkg.TestFn',
      filePath: 'src/__tests__/fn.test.ts',
    });
    addEdge(store, testNode, other);

    const result = buildImpactResponse(
      emptyImpactResult({ changedSymbols: [{ symbolQname: 'pkg.Target' }] }),
      store,
      'pkg.Target',
    );
    expect(result.testFilesAffected).not.toContain('src/__tests__/fn.test.ts');
  });
});

describe('buildSearchResponse — missing qualified name fallback', () => {
  it('falls back to the result name when both node and qualifiedName are absent', () => {
    const store = new InMemoryGraphStore();
    const result = buildSearchResponse([{ nodeId: 99999, name: 'bareName' }], store);
    // No node, no qualifiedName -> the qname falls back to the result name.
    expect(result.items[0]!.name).toBe('bareName');
  });
});

describe('buildImpactResponse — impact-tree item defaults', () => {
  it('defaults depth and label when an impact-tree item omits them', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({ impactTree: [{ symbolQname: 'pkg.X' }] }),
      store,
    );
    // Missing depth -> 0 (direct caller); missing label -> 'unknown'.
    expect(result.directCallers[0]!.name).toBe('X');
    expect(result.directCallers[0]!.label).toBe('unknown');
    expect(result.directCallers[0]!.qualifiedName).toBe('pkg.X');
  });
});

describe('buildImpactResponse — test-coverage critical path', () => {
  it('flags the test-coverage path when at least five test files are affected', () => {
    const store = new InMemoryGraphStore();
    const result = buildImpactResponse(
      emptyImpactResult({
        changedFiles: [
          'src/a.test.ts',
          'src/b.test.ts',
          'src/c.test.ts',
          'src/d.test.ts',
          'src/e.test.ts',
        ],
      }),
      store,
    );
    expect(result.testFilesAffected).toHaveLength(5);
    expect(result.riskAssessment.criticalPaths).toContain('test-coverage');
  });
});

describe('buildTraceResponse — system_call / network / null-signature side effects', () => {
  it('detects system_call and network side effects, tolerating a null signature', () => {
    const store = new InMemoryGraphStore();
    addNode(store, { name: 'spawn', qualifiedName: 'pkg.Spawn', signature: null });
    addNode(store, { name: 'connect', qualifiedName: 'pkg.Connect', signature: 'connect(): void' });
    const result = buildTraceResponse(
      {
        path: [
          { symbol: 'pkg.Spawn', depth: 0, relationship: 'CALLS', filePath: null },
          { symbol: 'pkg.Connect', depth: 1, relationship: 'CALLS', filePath: null },
        ],
        found: true,
        maxDepthReached: false,
      },
      store,
    );
    const types = result.sideEffects.map((se) => se.type);
    expect(types).toContain('system_call');
    expect(types).toContain('network');
  });
});

describe('buildTraceResponse — alternative path detection', () => {
  it('builds an alternative path when BFS finds a shorter route', () => {
    const store = new InMemoryGraphStore();
    const a = addNode(store, { name: 'A', qualifiedName: 'pkg.A' });
    const b = addNode(store, { name: 'B', qualifiedName: 'pkg.B', complexity: null });
    const c = addNode(store, { name: 'C', qualifiedName: 'pkg.C' });
    const d = addNode(store, { name: 'D', qualifiedName: 'pkg.D' });
    const e = addNode(store, { name: 'E', qualifiedName: 'pkg.E', complexity: 5 });
    // Main path A -> B -> C -> D (3 hops). A direct A -> D edge (1 hop) and a
    // sibling A -> E edge (1 hop) give the BFS two nearer intermediate nodes.
    addEdge(store, a, b);
    addEdge(store, b, c);
    addEdge(store, c, d);
    addEdge(store, a, d);
    addEdge(store, a, e);

    const result = buildTraceResponse(
      {
        path: [
          { symbol: 'pkg.A', depth: 0, relationship: 'CALLS', filePath: null },
          { symbol: 'pkg.B', depth: 1, relationship: 'CALLS', filePath: null },
          { symbol: 'pkg.C', depth: 2, relationship: 'CALLS', filePath: null },
          { symbol: 'pkg.D', depth: 3, relationship: 'CALLS', filePath: null },
        ],
        found: true,
        maxDepthReached: false,
      },
      store,
    );

    expect(result.alternativePaths.length).toBeGreaterThan(0);
    const alt = result.alternativePaths[0]!;
    // Alt path length is the direct A->D distance (1), not the 3-hop main path.
    expect(alt.length).toBe(1);
    expect(alt.hops).toEqual(['pkg.A', 'pkg.B', 'pkg.E', 'pkg.D']);
    // B has null complexity (?? 0) and E has complexity 5.
    expect(alt.totalComplexity).toBe(5);
  });
});

describe('buildSearchResponse — imports resolution', () => {
  it('resolves the qualified names of imported targets', () => {
    const store = new InMemoryGraphStore();
    const src = addNode(store, { name: 'src', qualifiedName: 'pkg.Src' });
    const imported = addNode(store, { name: 'imported', qualifiedName: 'pkg.Imported' });
    addEdge(store, src, imported, 'IMPORTS');
    const result = buildSearchResponse(
      [{ nodeId: src, name: 'src', qualifiedName: 'pkg.Src' }],
      store,
    );
    expect(result.items[0]!.relatedSymbols.imports).toEqual(['pkg.Imported']);
  });
});

describe('buildSearchResponse — cross-repo references', () => {
  it('collects only cross-repo edges that resolve to a different project', () => {
    const store = new InMemoryGraphStore();
    const src = addNode(store, { name: 'src', qualifiedName: 'pkg.Src' });
    const foreign = addNode(store, {
      name: 'foreign',
      qualifiedName: 'pkg.Foreign',
      projectId: 'other-project',
    });
    const sameProject = addNode(store, { name: 'same', qualifiedName: 'pkg.Same' });
    addEdge(store, src, foreign, 'CROSS_REPO_CALLS');
    addEdge(store, src, sameProject, 'CROSS_REPO_CALLS');
    const result = buildSearchResponse(
      [{ nodeId: src, name: 'src', qualifiedName: 'pkg.Src' }],
      store,
    );
    expect(result.items[0]!.crossRepoRefs).toEqual(['other-project:pkg.Foreign']);
  });
});

describe('buildSearchResponse — callee deduplication', () => {
  it('dedupes duplicate outgoing CALLS edges to the same callee', () => {
    const store = new InMemoryGraphStore();
    const src = addNode(store, { name: 'src', qualifiedName: 'pkg.Src' });
    const dst = addNode(store, { name: 'dst', qualifiedName: 'pkg.Dst' });
    addEdge(store, src, dst);
    addEdge(store, src, dst); // duplicate -> dedup in getCallees
    const result = buildSearchResponse(
      [{ nodeId: src, name: 'src', qualifiedName: 'pkg.Src' }],
      store,
    );
    expect(result.items[0]!.relatedSymbols.callees).toHaveLength(1);
  });
});
