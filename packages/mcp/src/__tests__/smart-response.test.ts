// @code-analyzer/mcp — Smart Response Builder Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  buildImpactResponse,
  buildTraceResponse,
  buildSearchResponse,
  type EnrichedImpactResult,
  type EnrichedTraceResult,
  type EnrichedSearchResult,
} from '../tools/smart-response.js';
import {
  computeConfidence,
  getConfidenceLabel,
  type ConfidenceScore,
} from '../tools/confidence.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let nodeId = 1;
let edgeId = 1;

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  const id = nodeId++;
  return {
    id,
    projectId: 'test-project',
    label: 'Function',
    name: `func${id}`,
    qualifiedName: `pkg.Func${id}`,
    filePath: `/src/module${id}.ts`,
    startLine: id * 10,
    endLine: id * 10 + 5,
    language: 'typescript',
    properties: { name: `func${id}` },
    signature: `func${id}(): void`,
    docstring: null,
    complexity: 2,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeEdge(sourceId: number, targetId: number, type: string = 'CALLS'): GraphEdge {
  const id = edgeId++;
  return {
    id,
    projectId: 'test-project',
    sourceId,
    targetId,
    type: type as any,
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

interface TestGraphNodes {
  target: GraphNode;
  directCaller1: GraphNode;
  directCaller2: GraphNode;
  indirectCaller: GraphNode;
  dbFunc: GraphNode;
  httpFunc: GraphNode;
  fileIOFunc: GraphNode;
  testFile: GraphNode;
  cycleNode1: GraphNode;
  cycleNode2: GraphNode;
  searchNode1: GraphNode;
  searchNode2: GraphNode;
  searchNode3: GraphNode;
}

function createTestGraph(): { store: InMemoryGraphStore; nodes: TestGraphNodes } {
  nodeId = 1;
  edgeId = 1;
  const store = new InMemoryGraphStore();

  const target = makeNode({
    name: 'targetFunc',
    qualifiedName: 'pkg.TargetFunc',
    filePath: '/src/pkg/target.ts',
    startLine: 20,
    endLine: 30,
    signature: 'targetFunc(a: number): string',
  });
  const directCaller1 = makeNode({
    name: 'callerA',
    qualifiedName: 'pkg.CallerA',
    filePath: '/src/pkg/callerA.ts',
    startLine: 5,
    endLine: 15,
  });
  const directCaller2 = makeNode({
    name: 'callerB',
    qualifiedName: 'pkg.CallerB',
    filePath: '/src/pkg/callerB.ts',
    startLine: 8,
    endLine: 18,
  });
  const indirectCaller = makeNode({
    name: 'indirectCaller',
    qualifiedName: 'pkg.IndirectCaller',
    filePath: '/src/pkg/indirect.ts',
    startLine: 1,
    endLine: 10,
  });
  const dbFunc = makeNode({
    name: 'query',
    qualifiedName: 'pkg.Query',
    filePath: '/src/pkg/db.ts',
    startLine: 15,
    endLine: 25,
    signature: 'query(sql: string): Result[]',
  });
  const httpFunc = makeNode({
    name: 'fetch',
    qualifiedName: 'pkg.Fetch',
    filePath: '/src/pkg/api.ts',
    startLine: 42,
    endLine: 52,
    signature: 'fetch(url: string): Response',
  });
  const fileIOFunc = makeNode({
    name: 'readFile',
    qualifiedName: 'pkg.ReadFile',
    filePath: '/src/pkg/config.ts',
    startLine: 30,
    endLine: 40,
    signature: 'readFile(): Config',
  });
  const testFile = makeNode({
    name: 'testTarget',
    qualifiedName: 'pkg.__tests__.testTarget',
    filePath: '/src/pkg/__tests__/target.test.ts',
    startLine: 5,
    endLine: 15,
    label: 'Test',
  });
  const cycleNode1 = makeNode({
    name: 'cycleA',
    qualifiedName: 'pkg.CycleA',
    filePath: '/src/pkg/cycle.ts',
    startLine: 10,
    endLine: 20,
  });
  const cycleNode2 = makeNode({
    name: 'cycleB',
    qualifiedName: 'pkg.CycleB',
    filePath: '/src/pkg/cycle.ts',
    startLine: 25,
    endLine: 35,
  });
  const searchNode1 = makeNode({
    name: 'SearchResult',
    qualifiedName: 'pkg.SearchResult',
    filePath: '/src/pkg/result.ts',
    startLine: 5,
    endLine: 10,
    label: 'Class',
  });
  const searchNode2 = makeNode({
    name: 'searchQuery',
    qualifiedName: 'pkg.SearchQuery',
    filePath: '/src/pkg/query.ts',
    startLine: 12,
    endLine: 18,
    label: 'Function',
  });
  const searchNode3 = makeNode({
    name: 'searchIndex',
    qualifiedName: 'pkg.SearchIndex',
    filePath: '/src/pkg/index.ts',
    startLine: 20,
    endLine: 28,
    label: 'Class',
  });

  store.insertNode(target);
  store.insertNode(directCaller1);
  store.insertNode(directCaller2);
  store.insertNode(indirectCaller);
  store.insertNode(dbFunc);
  store.insertNode(httpFunc);
  store.insertNode(fileIOFunc);
  store.insertNode(testFile);
  store.insertNode(cycleNode1);
  store.insertNode(cycleNode2);
  store.insertNode(searchNode1);
  store.insertNode(searchNode2);
  store.insertNode(searchNode3);

  // Direct calls to target
  store.insertEdge(makeEdge(directCaller1.id, target.id, 'CALLS'));
  store.insertEdge(makeEdge(directCaller2.id, target.id, 'CALLS'));

  // Indirect call chain
  store.insertEdge(makeEdge(indirectCaller.id, directCaller1.id, 'CALLS'));

  // Target calls db, http, and file IO functions
  store.insertEdge(makeEdge(target.id, dbFunc.id, 'CALLS'));
  store.insertEdge(makeEdge(target.id, httpFunc.id, 'CALLS'));
  store.insertEdge(makeEdge(target.id, fileIOFunc.id, 'CALLS'));

  // Test file calls target
  store.insertEdge(makeEdge(testFile.id, target.id, 'CALLS'));

  // Cycle: A → B → A
  store.insertEdge(makeEdge(cycleNode1.id, cycleNode2.id, 'CALLS'));
  store.insertEdge(makeEdge(cycleNode2.id, cycleNode1.id, 'CALLS'));

  // Search relationships
  store.insertEdge(makeEdge(searchNode2.id, searchNode1.id, 'CALLS'));
  store.insertEdge(makeEdge(searchNode1.id, searchNode3.id, 'CALLS'));

  const nodes: TestGraphNodes = {
    target,
    directCaller1,
    directCaller2,
    indirectCaller,
    dbFunc,
    httpFunc,
    fileIOFunc,
    testFile,
    cycleNode1,
    cycleNode2,
    searchNode1,
    searchNode2,
    searchNode3,
  };

  return { store, nodes };
}

// ---------------------------------------------------------------------------
// Confidence Scoring Tests
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('should return low confidence when no signals match', () => {
    const result = computeConfidence({ name: 'unknown' }, { targetSymbol: 'something_else' });
    expect(result.score).toBe(0.0);
    expect(result.label).toBe('low');
    expect(result.factors).toContain('no matching signals found');
  });

  it('should return high confidence for exact qualified name match', () => {
    const result = computeConfidence(
      { qualifiedName: 'pkg.TargetFunc' },
      { targetSymbol: 'pkg.TargetFunc' },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.label).toBe('high');
    expect(result.factors).toContain('exact qualified name match');
  });

  it('should return high confidence for exact file path match', () => {
    const result = computeConfidence(
      { qualifiedName: 'pkg.Func', filePath: '/src/pkg/main.ts' },
      { targetSymbol: 'pkg.Func', targetFile: '/src/pkg/main.ts' },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.label).toBe('high');
  });

  it('should return medium confidence for partial file path match only', () => {
    const result = computeConfidence(
      { filePath: '/x/src/pkg/main.ts' },
      { targetSymbol: 'different_symbol', targetFile: '/src/pkg/main.ts' },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.label).toBe('medium');
  });

  it('should return high confidence for signature match', () => {
    const result = computeConfidence(
      { signature: 'targetFunc(a: number): string' },
      { targetSignature: 'targetFunc(a: number): string' },
    );
    expect(result.label).toBe('high');
  });

  it('should return medium confidence for partial signature match', () => {
    const result = computeConfidence(
      { signature: 'targetFunc(a: number): string' },
      { targetSignature: 'targetFunc' },
    );
    expect(result.label).toBe('medium');
  });

  it('should return high confidence for direct edge match', () => {
    const result = computeConfidence(
      { qualifiedName: 'caller' },
      { edgeType: 'CALLS', hasDirectEdge: true },
    );
    expect(result.label).toBe('high');
  });

  it('should return medium confidence when line range contains target', () => {
    const result = computeConfidence({ startLine: 10, endLine: 30 }, { lineNumber: 20 });
    expect(result.label).toBe('high');
  });

  it('should return medium confidence for nearby line range', () => {
    const result = computeConfidence({ startLine: 10, endLine: 12 }, { lineNumber: 15 });
    // Proximity match (within 5 lines) is a heuristic match
    expect(result.label).toBe('medium');
  });

  it('should handle implements relationship', () => {
    const result = computeConfidence(
      { qualifiedName: 'Impl' },
      { edgeType: 'IMPLEMENTS', hasDirectEdge: true, targetSymbol: 'Impl' },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });

  it('should handle extends relationship', () => {
    const result = computeConfidence(
      { qualifiedName: 'Sub' },
      { edgeType: 'EXTENDS', hasDirectEdge: true, targetSymbol: 'Sub' },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });

  it('should handle high FTS rank', () => {
    const result = computeConfidence({ rank: 9 }, {});
    // Only rank heuristic, no direct matches → medium
    expect(result.label).toBe('medium');
  });

  it('should handle name similarity', () => {
    const result = computeConfidence({ name: 'targetFuncHelper' }, { targetSymbol: 'targetFunc' });
    expect(result.label).toBe('medium');
  });

  it('should handle same project with no edge', () => {
    const result = computeConfidence(
      { projectId: 'test-project' },
      { projectId: 'test-project', hasDirectEdge: false },
    );
    expect(result.score).toBeGreaterThan(0);
  });

  it('should handle same file with no edge', () => {
    const result = computeConfidence(
      { filePath: '/src/file.ts' },
      { targetFile: '/src/file.ts', hasDirectEdge: false },
    );
    expect(result.score).toBeGreaterThan(0);
  });

  it('should handle same label type', () => {
    const result = computeConfidence({ label: 'Function' }, { expectedLabel: 'Function' });
    expect(result.score).toBeGreaterThan(0);
  });

  it('should handle vector similarity', () => {
    const result = computeConfidence({ vectorScore: 0.85 }, {});
    expect(result.score).toBeGreaterThan(0);
  });

  it('should boost score with multiple signal types', () => {
    const result = computeConfidence(
      { qualifiedName: 'pkg.Func', filePath: '/src/pkg/main.ts', signature: 'func(): void' },
      { targetSymbol: 'pkg.Func', targetFile: '/src/pkg/main.ts', targetSignature: 'func(): void' },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.92);
    expect(result.label).toBe('high');
  });

  it('should handle proximity line range match exactly at 5 lines (line 80 branch)', () => {
    // Line 10-12 finding, target at line 15 — exactly 5 lines apart from end
    const result = computeConfidence({ startLine: 10, endLine: 10 }, { lineNumber: 15 });
    // |10 - 15| = 5, which is <= 5, triggers proximity heuristic
    expect(result.label).toBe('medium');
    expect(result.factors).toContain('proximity-based line match');
  });

  it('should handle same project without direct edge (line 126 branch)', () => {
    const result = computeConfidence(
      { projectId: 'shared-project' },
      { projectId: 'shared-project', hasDirectEdge: false },
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors).toContain('same project (no direct edge)');
  });

  it('should NOT add same project factor when hasDirectEdge is true', () => {
    const result = computeConfidence(
      { projectId: 'shared-project' },
      { projectId: 'shared-project', hasDirectEdge: true },
    );
    // hasDirectEdge is true, so line 126 branch should NOT trigger
    const projectFactor = result.factors.find((f) => f.includes('same project'));
    expect(projectFactor).toBeUndefined();
  });

  it('should handle same label type with expectedLabel (line 141 branch)', () => {
    const result = computeConfidence({ label: 'Class' }, { expectedLabel: 'Class' });
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors).toContain('same label type');
  });

  it('should boost score when heuristic and inferred both present (line 178 branch)', () => {
    // heuristic from proximity match + inferred from label match
    const result = computeConfidence(
      { startLine: 10, endLine: 10, label: 'Function' },
      { lineNumber: 15, expectedLabel: 'Function' },
    );
    // Should have both heuristic (proximity) and inferred (label) matches
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors).toContain('proximity-based line match');
    expect(result.factors).toContain('same label type');
  });
});

describe('getConfidenceLabel', () => {
  it('should return high for scores >= 0.9', () => {
    expect(getConfidenceLabel(0.9)).toBe('high');
    expect(getConfidenceLabel(0.95)).toBe('high');
    expect(getConfidenceLabel(1.0)).toBe('high');
  });

  it('should return medium for scores >= 0.7', () => {
    expect(getConfidenceLabel(0.7)).toBe('medium');
    expect(getConfidenceLabel(0.85)).toBe('medium');
    expect(getConfidenceLabel(0.899)).toBe('medium');
  });

  it('should return low for scores < 0.7', () => {
    expect(getConfidenceLabel(0.0)).toBe('low');
    expect(getConfidenceLabel(0.5)).toBe('low');
    expect(getConfidenceLabel(0.699)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Smart Response Builder Tests
// ---------------------------------------------------------------------------

describe('buildImpactResponse', () => {
  let store: InMemoryGraphStore;
  let nodes: TestGraphNodes;

  beforeEach(() => {
    const graph = createTestGraph();
    store = graph.store;
    nodes = graph.nodes;
  });

  it('should compute direct and indirect callers', () => {
    const result: EnrichedImpactResult = buildImpactResponse(
      {
        changedFiles: ['/src/pkg/target.ts'],
        changedSymbols: [
          {
            symbolQname: 'pkg.TargetFunc',
            label: 'Function',
            filePath: '/src/pkg/target.ts',
            impactType: 'direct',
            depth: 0,
            children: [],
          },
        ],
        impactTree: [
          {
            symbolQname: 'pkg.CallerA',
            label: 'Function',
            filePath: '/src/pkg/callerA.ts',
            impactType: 'direct',
            depth: 1,
            children: [],
          },
          {
            symbolQname: 'pkg.CallerB',
            label: 'Function',
            filePath: '/src/pkg/callerB.ts',
            impactType: 'direct',
            depth: 1,
            children: [],
          },
          {
            symbolQname: 'pkg.IndirectCaller',
            label: 'Function',
            filePath: '/src/pkg/indirect.ts',
            impactType: 'indirect',
            depth: 2,
            children: [],
          },
        ],
        riskLevel: 'medium',
        processesAffected: [],
        estimatedEffort: 'medium',
        directDependents: 2,
        indirectDependents: 1,
        totalImpact: 3,
      },
      store,
      'pkg.TargetFunc',
    );

    expect(result.directCallers.length).toBeGreaterThanOrEqual(2);
    expect(result.indirectCallers.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.riskLevel).toBe('medium');
    expect(result.summary.totalImpact).toBe(3);
    expect(result.summary.targetSymbol).toBe('pkg.TargetFunc');
  });

  it('should detect test files affected', () => {
    const impactTree = [
      {
        symbolQname: 'pkg.__tests__.testTarget',
        label: 'Test',
        filePath: '/src/pkg/__tests__/target.test.ts',
        impactType: 'direct',
        depth: 1,
        children: [],
      },
    ];

    const result = buildImpactResponse(
      {
        changedFiles: ['/src/pkg/target.ts'],
        changedSymbols: [
          {
            symbolQname: 'pkg.TargetFunc',
            label: 'Function',
            filePath: '/src/pkg/target.ts',
            impactType: 'direct',
            depth: 0,
            children: [],
          },
        ],
        impactTree,
        riskLevel: 'low',
        processesAffected: [],
        estimatedEffort: 'low',
        directDependents: 0,
        indirectDependents: 0,
        totalImpact: 1,
      },
      store,
      'pkg.TargetFunc',
    );

    expect(result.testFilesAffected.length).toBeGreaterThanOrEqual(1);
    expect(result.testFilesAffected.some((f) => f.includes('test'))).toBe(true);
  });

  it('should generate risk assessment', () => {
    const result = buildImpactResponse(
      {
        changedFiles: ['/src/pkg/target.ts'],
        changedSymbols: [],
        impactTree: [],
        riskLevel: 'critical',
        processesAffected: [{ processName: 'AuthFlow', severity: 'degraded' }],
        estimatedEffort: 'high',
        directDependents: 15,
        indirectDependents: 30,
        totalImpact: 50,
      },
      store,
    );

    expect(result.riskAssessment.level).toBe('critical');
    expect(result.riskAssessment.confidenceScore).toBeGreaterThanOrEqual(0.9);
    expect(result.riskAssessment.rationale.length).toBeGreaterThan(0);
  });

  it('should generate change clusters', () => {
    const result = buildImpactResponse(
      {
        changedFiles: [
          '/src/pkg/target.ts',
          '/src/pkg/callerA.ts',
          '/src/pkg/callerB.ts',
          '/src/services/auth.ts',
        ],
        changedSymbols: [],
        impactTree: [],
        riskLevel: 'medium',
        processesAffected: [],
        estimatedEffort: 'medium',
        directDependents: 0,
        indirectDependents: 0,
        totalImpact: 0,
      },
      store,
    );

    expect(result.changeClusters.length).toBeGreaterThan(0);
    result.changeClusters.forEach((cluster) => {
      expect(cluster.name).toBeTruthy();
      expect(cluster.affectedFiles.length).toBeGreaterThan(0);
      expect(cluster.estimatedEffort).toBeDefined();
    });
  });

  it('should derive suggested reviewers from caller file paths', () => {
    const result = buildImpactResponse(
      {
        changedFiles: ['/src/pkg/target.ts'],
        changedSymbols: [],
        impactTree: [
          {
            symbolQname: 'pkg.CallerA',
            label: 'Function',
            filePath: '/src/pkg/callerA.ts',
            impactType: 'direct',
            depth: 1,
            children: [],
          },
          {
            symbolQname: 'pkg.CallerB',
            label: 'Function',
            filePath: '/src/pkg/callerB.ts',
            impactType: 'direct',
            depth: 1,
            children: [],
          },
        ],
        riskLevel: 'low',
        processesAffected: [],
        estimatedEffort: 'low',
        directDependents: 2,
        indirectDependents: 0,
        totalImpact: 2,
      },
      store,
    );

    expect(result.suggestedReviewers.length).toBeGreaterThan(0);
    result.suggestedReviewers.forEach((reviewer) => {
      expect(reviewer).toContain('team:');
    });
  });

  it('should handle empty impact result gracefully', () => {
    const result = buildImpactResponse(
      {
        changedFiles: [],
        changedSymbols: [],
        impactTree: [],
        riskLevel: 'low',
        processesAffected: [],
        estimatedEffort: 'low',
        directDependents: 0,
        indirectDependents: 0,
        totalImpact: 0,
      },
      store,
    );

    expect(result.directCallers).toEqual([]);
    expect(result.indirectCallers).toEqual([]);
    expect(result.testFilesAffected).toEqual([]);
    expect(result.changeClusters).toEqual([]);
    expect(result.suggestedReviewers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Trace Response Tests
// ---------------------------------------------------------------------------

describe('buildTraceResponse', () => {
  let store: InMemoryGraphStore;
  let nodes: TestGraphNodes;

  beforeEach(() => {
    const graph = createTestGraph();
    store = graph.store;
    nodes = graph.nodes;
  });

  it('should build hop-by-hop detail', () => {
    const path = {
      path: [
        {
          symbol: nodes.directCaller1.qualifiedName,
          depth: 0,
          relationship: 'CALLS',
          filePath: nodes.directCaller1.filePath,
        },
        {
          symbol: nodes.target.qualifiedName,
          depth: 1,
          relationship: 'CALLS',
          filePath: nodes.target.filePath,
        },
      ],
      found: true,
      maxDepthReached: false,
    };

    const result: EnrichedTraceResult = buildTraceResponse(path, store);

    expect(result.totalHops).toBe(2);
    expect(result.found).toBe(true);
    expect(result.maxDepthReached).toBe(false);
    expect(result.path.length).toBe(2);
    expect(result.path[0]?.name).toBe(nodes.directCaller1.name);
    expect(result.path[1]?.name).toBe(nodes.target.name);
  });

  it('should detect side effects in the path', () => {
    const path = {
      path: [
        {
          symbol: nodes.target.qualifiedName,
          depth: 0,
          relationship: 'CALLS',
          filePath: nodes.target.filePath,
        },
      ],
      found: true,
      maxDepthReached: false,
    };

    const result = buildTraceResponse(path, store);

    // Target calls dbFunc, httpFunc, fileIOFunc → these should appear as side effects
    expect(result.sideEffects.length).toBeGreaterThan(0);
  });

  it('should detect cycles', () => {
    const path = {
      path: [
        {
          symbol: nodes.cycleNode1.qualifiedName,
          depth: 0,
          relationship: 'CALLS',
          filePath: nodes.cycleNode1.filePath,
        },
        {
          symbol: nodes.cycleNode2.qualifiedName,
          depth: 1,
          relationship: 'CALLS',
          filePath: nodes.cycleNode2.filePath,
        },
        {
          symbol: nodes.cycleNode1.qualifiedName,
          depth: 2,
          relationship: 'CALLS',
          filePath: nodes.cycleNode1.filePath,
        },
      ],
      found: true,
      maxDepthReached: false,
    };

    const result = buildTraceResponse(path, store);

    expect(result.cyclesDetected.length).toBeGreaterThan(0);
    const cycle = result.cyclesDetected[0];
    expect(cycle).toBeDefined();
    if (cycle) {
      expect(cycle).toContain(nodes.cycleNode1.qualifiedName);
      expect(cycle).toContain(nodes.cycleNode2.qualifiedName);
    }
  });

  it('should mark hops in cycles', () => {
    const path = {
      path: [
        {
          symbol: nodes.cycleNode1.qualifiedName,
          depth: 0,
          relationship: 'CALLS',
          filePath: nodes.cycleNode1.filePath,
        },
        {
          symbol: nodes.cycleNode2.qualifiedName,
          depth: 1,
          relationship: 'CALLS',
          filePath: nodes.cycleNode2.filePath,
        },
        {
          symbol: nodes.cycleNode1.qualifiedName,
          depth: 2,
          relationship: 'CALLS',
          filePath: nodes.cycleNode1.filePath,
        },
      ],
      found: true,
      maxDepthReached: false,
    };

    const result = buildTraceResponse(path, store);

    const cycleHops = result.path.filter((h) => h.isInCycle);
    expect(cycleHops.length).toBeGreaterThan(0);
  });

  it('should handle empty path gracefully', () => {
    const path = {
      path: [] as Array<{
        symbol: string;
        depth: number;
        relationship: string;
        filePath: string | null;
      }>,
      found: false,
      maxDepthReached: false,
    };

    const result = buildTraceResponse(path, store);

    expect(result.path).toEqual([]);
    expect(result.totalHops).toBe(0);
    expect(result.found).toBe(false);
    expect(result.sourceSymbol).toBe('unknown');
  });

  it('should handle non-existent nodes in path gracefully', () => {
    const path = {
      path: [
        { symbol: 'pkg.NonExistent', depth: 0, relationship: 'CALLS', filePath: null },
        { symbol: 'pkg.AlsoNonExistent', depth: 1, relationship: 'CALLS', filePath: null },
      ],
      found: false,
      maxDepthReached: true,
    };

    const result = buildTraceResponse(path, store);

    expect(result.totalHops).toBe(2);
    result.path.forEach((hop) => {
      expect(hop.qualifiedName).toBeDefined();
      expect(hop.callType).toBeDefined();
    });
  });

  it('should detect database side effects from function names', () => {
    const path = {
      path: [
        {
          symbol: nodes.dbFunc.qualifiedName,
          depth: 0,
          relationship: 'CALLS',
          filePath: nodes.dbFunc.filePath,
        },
      ],
      found: true,
      maxDepthReached: false,
    };

    const result = buildTraceResponse(path, store);

    const dbEffects = result.sideEffects.filter((se) => se.type === 'database');
    expect(dbEffects.length).toBeGreaterThan(0);
  });

  it('should detect HTTP side effects from function signatures', () => {
    const path = {
      path: [
        {
          symbol: nodes.httpFunc.qualifiedName,
          depth: 0,
          relationship: 'CALLS',
          filePath: nodes.httpFunc.filePath,
        },
      ],
      found: true,
      maxDepthReached: false,
    };

    const result = buildTraceResponse(path, store);

    const httpEffects = result.sideEffects.filter((se) => se.type === 'http_request');
    expect(httpEffects.length).toBeGreaterThan(0);
  });

  it('should detect file I/O side effects', () => {
    const path = {
      path: [
        {
          symbol: nodes.fileIOFunc.qualifiedName,
          depth: 0,
          relationship: 'CALLS',
          filePath: nodes.fileIOFunc.filePath,
        },
      ],
      found: true,
      maxDepthReached: false,
    };

    const result = buildTraceResponse(path, store);

    const fileEffects = result.sideEffects.filter((se) => se.type === 'file_io');
    expect(fileEffects.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Search Response Tests
// ---------------------------------------------------------------------------

describe('buildSearchResponse', () => {
  let store: InMemoryGraphStore;
  let nodes: TestGraphNodes;

  beforeEach(() => {
    const graph = createTestGraph();
    store = graph.store;
    nodes = graph.nodes;
  });

  it('should enrich search results with related symbols', () => {
    const rawResults = [
      {
        nodeId: nodes.target.id,
        name: nodes.target.name,
        qualifiedName: nodes.target.qualifiedName,
        label: nodes.target.label,
        filePath: nodes.target.filePath,
        rank: 10,
        snippet: nodes.target.signature,
      },
    ];

    const result: EnrichedSearchResult = buildSearchResponse(rawResults, store);

    expect(result.items.length).toBe(1);
    const item = result.items[0]!;
    expect(item.relatedSymbols.callers.length).toBeGreaterThan(0);
    expect(item.relatedSymbols.callees.length).toBeGreaterThan(0);
  });

  it('should compute label distribution', () => {
    const rawResults = [
      {
        nodeId: nodes.target.id,
        name: nodes.target.name,
        qualifiedName: nodes.target.qualifiedName,
        label: nodes.target.label,
        filePath: nodes.target.filePath,
        rank: 10,
        snippet: nodes.target.signature,
      },
      {
        nodeId: nodes.searchNode1.id,
        name: nodes.searchNode1.name,
        qualifiedName: nodes.searchNode1.qualifiedName,
        label: nodes.searchNode1.label,
        filePath: nodes.searchNode1.filePath,
        rank: 8,
        snippet: nodes.searchNode1.signature,
      },
    ];

    const result = buildSearchResponse(rawResults, store);

    expect(result.summary.labelDistribution['Function']).toBe(1);
    expect(result.summary.labelDistribution['Class']).toBe(1);
  });

  it('should compute module context', () => {
    const rawResults = [
      {
        nodeId: nodes.target.id,
        name: nodes.target.name,
        qualifiedName: nodes.target.qualifiedName,
        label: nodes.target.label,
        filePath: nodes.target.filePath,
        rank: 10,
        snippet: nodes.target.signature,
      },
    ];

    const result = buildSearchResponse(rawResults, store);

    const item = result.items[0]!;
    expect(item.moduleContext.moduleName).toBe('pkg');
    expect(item.moduleContext.isExported).toBe(true);
    expect(item.moduleContext.packageName).toBe('/src/pkg');
  });

  it('should handle empty results', () => {
    const result = buildSearchResponse([], store);

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.returnedCount).toBe(0);
    expect(result.summary.labelDistribution).toEqual({});
  });

  it('should handle results with missing nodes gracefully', () => {
    const rawResults = [
      {
        nodeId: 99999,
        name: 'nonexistent',
        qualifiedName: 'pkg.Nonexistent',
        label: 'Function',
        filePath: null,
        rank: 5,
        snippet: null,
      },
    ];

    const result = buildSearchResponse(rawResults, store);

    expect(result.items.length).toBe(1);
    const item = result.items[0]!;
    expect(item.name).toBe('nonexistent');
    expect(item.relatedSymbols.callers).toEqual([]);
    expect(item.relatedSymbols.callees).toEqual([]);
  });

  it('should compute repo distribution', () => {
    const rawResults = [
      {
        nodeId: nodes.target.id,
        name: nodes.target.name,
        qualifiedName: nodes.target.qualifiedName,
        label: nodes.target.label,
        filePath: nodes.target.filePath,
        rank: 10,
        snippet: nodes.target.signature,
      },
    ];

    const result = buildSearchResponse(rawResults, store);

    expect(result.summary.repoDistribution['test-project']).toBe(1);
  });

  it('should populate top modules', () => {
    const rawResults = [
      {
        nodeId: nodes.target.id,
        name: nodes.target.name,
        qualifiedName: nodes.target.qualifiedName,
        label: nodes.target.label,
        filePath: nodes.target.filePath,
        rank: 10,
        snippet: nodes.target.signature,
      },
      {
        nodeId: nodes.directCaller1.id,
        name: nodes.directCaller1.name,
        qualifiedName: nodes.directCaller1.qualifiedName,
        label: nodes.directCaller1.label,
        filePath: nodes.directCaller1.filePath,
        rank: 9,
        snippet: nodes.directCaller1.signature,
      },
    ];

    const result = buildSearchResponse(rawResults, store);

    expect(result.summary.topModules).toContain('pkg');
  });
});

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe('Smart Response Integration', () => {
  it('should chain impact → trace analysis coherently', () => {
    const { store, nodes } = createTestGraph();

    // First, do impact analysis
    const impact = buildImpactResponse(
      {
        changedFiles: [nodes.target.filePath ?? ''],
        changedSymbols: [
          {
            symbolQname: nodes.target.qualifiedName,
            label: nodes.target.label,
            filePath: nodes.target.filePath,
            impactType: 'direct',
            depth: 0,
            children: [],
          },
        ],
        impactTree: [
          {
            symbolQname: nodes.directCaller1.qualifiedName,
            label: nodes.directCaller1.label,
            filePath: nodes.directCaller1.filePath,
            impactType: 'direct',
            depth: 1,
            children: [],
          },
          {
            symbolQname: nodes.indirectCaller.qualifiedName,
            label: nodes.indirectCaller.label,
            filePath: nodes.indirectCaller.filePath,
            impactType: 'indirect',
            depth: 2,
            children: [],
          },
        ],
        riskLevel: 'medium',
        processesAffected: [],
        estimatedEffort: 'medium',
        directDependents: 1,
        indirectDependents: 1,
        totalImpact: 2,
      },
      store,
      nodes.target.qualifiedName,
    );

    expect(impact.directCallers).toBeDefined();
    expect(impact.indirectCallers).toBeDefined();

    // Then, trace a path between a caller and the target
    const trace = buildTraceResponse(
      {
        path: [
          {
            symbol: nodes.indirectCaller.qualifiedName,
            depth: 0,
            relationship: 'CALLS',
            filePath: nodes.indirectCaller.filePath,
          },
          {
            symbol: nodes.directCaller1.qualifiedName,
            depth: 1,
            relationship: 'CALLS',
            filePath: nodes.directCaller1.filePath,
          },
          {
            symbol: nodes.target.qualifiedName,
            depth: 2,
            relationship: 'CALLS',
            filePath: nodes.target.filePath,
          },
        ],
        found: true,
        maxDepthReached: false,
      },
      store,
    );

    expect(trace.path.length).toBe(3);
    expect(trace.totalHops).toBe(3);
    expect(trace.sideEffects.length).toBeGreaterThan(0);
  });

  it('should report null nodes in confidence with low score', () => {
    const result = computeConfidence(
      { qualifiedName: null, filePath: null },
      { targetSymbol: 'something' },
    );
    expect(result.score).toBe(0.0);
    expect(result.label).toBe('low');
  });

  it('should handle risk assessment with no data', () => {
    const { store } = createTestGraph();
    const result = buildImpactResponse(
      {
        changedFiles: [],
        changedSymbols: [],
        impactTree: [],
        riskLevel: 'low',
        processesAffected: [],
        estimatedEffort: 'low',
        directDependents: 0,
        indirectDependents: 0,
        totalImpact: 0,
      },
      store,
    );

    expect(result.riskAssessment.level).toBe('low');
    expect(result.riskAssessment.criticalPaths).toEqual(['none']);
    expect(result.riskAssessment.rationale).toContain('Minimal impact');
  });

  it('should set high risk assessment rationale', () => {
    const { store } = createTestGraph();
    const result = buildImpactResponse(
      {
        changedFiles: ['/a.ts', '/b.ts'],
        changedSymbols: [],
        impactTree: Array.from({ length: 12 }, (_, i) => ({
          symbolQname: `pkg.Func${i}`,
          label: 'Function',
          filePath: `/path/file${i}.ts`,
          impactType: 'direct',
          depth: 1,
          children: [],
        })).concat(
          Array.from({ length: 25 }, (_, i) => ({
            symbolQname: `pkg.Transitive${i}`,
            label: 'Function',
            filePath: `/path/transitive${i}.ts`,
            impactType: 'transitive',
            depth: 2,
            children: [],
          })),
        ),
        riskLevel: 'high',
        processesAffected: [{ processName: 'Test', severity: 'degraded' }],
        estimatedEffort: 'high',
        directDependents: 12,
        indirectDependents: 25,
        totalImpact: 40,
      },
      store,
    );

    expect(result.riskAssessment.level).toBe('high');
    expect(result.riskAssessment.rationale).toContain('direct dependents');
    expect(result.riskAssessment.rationale).toContain('transitive');
    expect(result.riskAssessment.criticalPaths.length).toBeGreaterThan(0);
  });

  it('should handle missing context data gracefully', () => {
    const confidence = computeConfidence({}, {});
    expect(confidence.score).toBe(0.0);
    expect(confidence.label).toBe('low');
    expect(confidence.factors).toContain('no matching signals found');
  });

  it('should hit high score boundary for direct edge with qualified name', () => {
    const result = computeConfidence(
      { qualifiedName: 'target', filePath: '/src/target.ts', startLine: 10, endLine: 20 },
      {
        targetSymbol: 'target',
        targetFile: '/src/target.ts',
        lineNumber: 15,
        edgeType: 'CALLS',
        hasDirectEdge: true,
      },
    );
    expect(result.label).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(0.92);
  });
});
