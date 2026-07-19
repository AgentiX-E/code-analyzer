// @code-analyzer/intelligence — Impact Analyzer Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { ImpactAnalyzer } from '../impact/impact-analyzer.js';
import type { ChangedSymbol } from '../impact/change-detector.js';
import { SqliteStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = 'test-project';

function createNode(
  id: number,
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    projectId: PROJECT_ID,
    label: 'Function',
    name: `fn_${id}`,
    qualifiedName: `pkg.fn_${id}`,
    filePath: `/src/file_${id}.ts`,
    startLine: id * 10,
    endLine: id * 10 + 5,
    language: 'typescript',
    properties: {
      name: `fn_${id}`,
      isExported: id % 2 === 0,
    },
    signature: `function fn_${id}(): void`,
    docstring: null,
    complexity: id,
    isExported: id % 2 === 0,
    fingerprint: `fp_${id}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createEdge(
  store: SqliteStore,
  id: number,
  sourceId: number,
  targetId: number,
  type: 'CALLS' | 'IMPLEMENTS' | 'EXTENDS' | 'MEMBER_OF' | 'TESTS' | 'HANDLES_ROUTE' | 'STEP_IN_PROCESS',
): void {
  store.insertEdge({
    id,
    projectId: PROJECT_ID,
    sourceId,
    targetId,
    type,
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
  });
}

function makeChangedSymbol(
  name: string,
  qualifiedName: string,
  filePath: string,
  lineRange: [number, number] = [10, 20],
): ChangedSymbol {
  return {
    name,
    qualifiedName,
    filePath,
    changeType: 'modified',
    lineRange,
    riskLevel: 'low',
    reason: 'test',
  };
}

// ---------------------------------------------------------------------------
// findDirectDependents Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer.findDirectDependents', () => {
  let store: SqliteStore;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    store = new SqliteStore();
    analyzer = new ImpactAnalyzer(store);
  });

  it('should find direct CALLS dependents', () => {
    const target = createNode(1);
    const caller = createNode(2);
    store.insertNode(target);
    store.insertNode(caller);
    createEdge(store, 201, caller.id, target.id, 'CALLS');

    const result = analyzer.findDirectDependents(PROJECT_ID, [target.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeId).toBe(caller.id);
    expect(result[0]!.depth).toBe(1);
    expect(result[0]!.relationship).toBe('CALLS');
  });

  it('should find IMPLEMENTS dependents', () => {
    const iface = createNode(1, { label: 'Interface' });
    const impl = createNode(2);
    store.insertNode(iface);
    store.insertNode(impl);
    createEdge(store, 201, impl.id, iface.id, 'IMPLEMENTS');

    const result = analyzer.findDirectDependents(PROJECT_ID, [iface.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.relationship).toBe('IMPLEMENTS');
  });

  it('should find EXTENDS dependents', () => {
    const base = createNode(1, { label: 'Class' });
    const derived = createNode(2, { label: 'Class' });
    store.insertNode(base);
    store.insertNode(derived);
    createEdge(store, 201, derived.id, base.id, 'EXTENDS');

    const result = analyzer.findDirectDependents(PROJECT_ID, [base.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.relationship).toBe('EXTENDS');
  });

  it('should find MEMBER_OF dependents', () => {
    const container = createNode(1, { label: 'Class' });
    const member = createNode(2, { label: 'Method' });
    store.insertNode(container);
    store.insertNode(member);
    createEdge(store, 201, member.id, container.id, 'MEMBER_OF');

    const result = analyzer.findDirectDependents(PROJECT_ID, [container.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.relationship).toBe('MEMBER_OF');
  });

  it('should find dependents across multiple relationship types', () => {
    const target = createNode(1);
    const caller1 = createNode(2);
    const caller2 = createNode(3);
    store.insertNode(target);
    store.insertNode(caller1);
    store.insertNode(caller2);
    createEdge(store, 201, caller1.id, target.id, 'CALLS');
    createEdge(store, 301, caller2.id, target.id, 'IMPLEMENTS');

    const result = analyzer.findDirectDependents(PROJECT_ID, [target.id]);
    expect(result).toHaveLength(2);
  });

  it('should return empty array when no dependents exist', () => {
    const target = createNode(1);
    store.insertNode(target);

    const result = analyzer.findDirectDependents(PROJECT_ID, [target.id]);
    expect(result).toHaveLength(0);
  });

  it('should handle multiple changed symbols', () => {
    const target1 = createNode(1);
    const target2 = createNode(2);
    const caller = createNode(3);
    store.insertNode(target1);
    store.insertNode(target2);
    store.insertNode(caller);
    createEdge(store, 301, caller.id, target1.id, 'CALLS');

    const result = analyzer.findDirectDependents(PROJECT_ID, [
      target1.id,
      target2.id,
    ]);
    expect(result).toHaveLength(1);
  });

  it('should not include the changed symbol itself in dependents', () => {
    const target = createNode(1);
    const caller = createNode(2);
    store.insertNode(target);
    store.insertNode(caller);
    createEdge(store, 102, target.id, caller.id, 'CALLS'); // Outgoing, not incoming
    createEdge(store, 201, caller.id, target.id, 'CALLS'); // Incoming

    const result = analyzer.findDirectDependents(PROJECT_ID, [target.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeId).toBe(caller.id);
  });
});

// ---------------------------------------------------------------------------
// findIndirectDependents Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer.findIndirectDependents', () => {
  let store: SqliteStore;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    store = new SqliteStore();
    analyzer = new ImpactAnalyzer(store);
  });

  it('should find transitive dependents at depth 2', () => {
    // A <- B <- C  (B depends on A, C depends on B)
    const aId = store.insertNode(createNode(1));
    const bId = store.insertNode(createNode(2));
    const cId = store.insertNode(createNode(3));
    createEdge(store, 201, bId, aId, 'CALLS');  // B calls A
    createEdge(store, 302, cId, bId, 'CALLS');  // C calls B

    const result = analyzer.findIndirectDependents(PROJECT_ID, [aId], 2);
    expect(result).toHaveLength(2);

    const directNode = result.find((n) => n.nodeId === bId);
    expect(directNode).toBeDefined();
    expect(directNode!.depth).toBe(1);

    const indirectNode = result.find((n) => n.nodeId === cId);
    expect(indirectNode).toBeDefined();
    expect(indirectNode!.depth).toBe(2);
  });

  it('should find transitive dependents at depth 3', () => {
    // A <- B <- C <- D
    const aId = store.insertNode(createNode(1));
    const bId = store.insertNode(createNode(2));
    const cId = store.insertNode(createNode(3));
    const dId = store.insertNode(createNode(4));
    createEdge(store, 201, bId, aId, 'CALLS');
    createEdge(store, 302, cId, bId, 'CALLS');
    createEdge(store, 403, dId, cId, 'CALLS');

    const result = analyzer.findIndirectDependents(PROJECT_ID, [aId], 3);
    expect(result).toHaveLength(3);

    const depths = result.map((n) => n.depth);
    expect(depths).toContain(1);
    expect(depths).toContain(2);
    expect(depths).toContain(3);
  });

  it('should respect maxDepth and stop traversal', () => {
    // A <- B <- C <- D
    const aId = store.insertNode(createNode(1));
    const bId = store.insertNode(createNode(2));
    const cId = store.insertNode(createNode(3));
    const dId = store.insertNode(createNode(4));
    createEdge(store, 201, bId, aId, 'CALLS');
    createEdge(store, 302, cId, bId, 'CALLS');
    createEdge(store, 403, dId, cId, 'CALLS');

    const result = analyzer.findIndirectDependents(PROJECT_ID, [aId], 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeId).toBe(bId);
  });

  it('should use default depth of 3 via analyze', async () => {
    // A <- B <- C <- D <- E (depth 4, but default max is 3)
    const aId = store.insertNode(createNode(1));
    const bId = store.insertNode(createNode(2));
    const cId = store.insertNode(createNode(3));
    const dId = store.insertNode(createNode(4));
    const eId = store.insertNode(createNode(5));
    createEdge(store, 201, bId, aId, 'CALLS');
    createEdge(store, 302, cId, bId, 'CALLS');
    createEdge(store, 403, dId, cId, 'CALLS');
    createEdge(store, 504, eId, dId, 'CALLS');

    const result = await analyzer.analyze(
      PROJECT_ID,
      [makeChangedSymbol('a', 'pkg.fn_1', '/src/file_1.ts')],
    );
    // With default depth 3, we get B, C, D but not E
    const nodeIds = result.impactTree.map((n) => n.symbolQname);
    expect(nodeIds).toContain('pkg.fn_2'); // B
    expect(nodeIds).toContain('pkg.fn_3'); // C
    expect(nodeIds).toContain('pkg.fn_4'); // D
    expect(nodeIds).not.toContain('pkg.fn_5'); // E (beyond default depth)
  });

  it('should return empty array when no transitive dependents', () => {
    const targetId = store.insertNode(createNode(1));
    const directId = store.insertNode(createNode(2));
    createEdge(store, 201, directId, targetId, 'CALLS');

    const result = analyzer.findIndirectDependents(PROJECT_ID, [targetId], 2);
    expect(result).toHaveLength(1);
    expect(result[0]!.depth).toBe(1);
  });

  it('should handle circular dependencies without infinite loops', () => {
    // A <-> B (circular dependency)
    const aId = store.insertNode(createNode(1));
    const bId = store.insertNode(createNode(2));
    createEdge(store, 201, bId, aId, 'CALLS');
    createEdge(store, 102, aId, bId, 'CALLS');

    const result = analyzer.findIndirectDependents(PROJECT_ID, [aId], 3);
    // Should complete without infinite loop
    expect(result.length).toBeGreaterThan(0);
    expect(result).toHaveLength(1); // Only B, A is seed so excluded
  });

  it('should handle multiple changed symbols with shared dependents', () => {
    // A <- C (C depends on both A and B)
    // B <- C
    const aId = store.insertNode(createNode(1));
    const bId = store.insertNode(createNode(2));
    const cId = store.insertNode(createNode(3));
    createEdge(store, 301, cId, aId, 'CALLS');
    createEdge(store, 302, cId, bId, 'CALLS');

    const result = analyzer.findDirectDependents(PROJECT_ID, [aId, bId]);
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeId).toBe(cId);
  });
});

// ---------------------------------------------------------------------------
// findAffectedTests Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer.findAffectedTests', () => {
  let store: SqliteStore;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    store = new SqliteStore();
    analyzer = new ImpactAnalyzer(store);
  });

  it('should find tests for a changed symbol', () => {
    const fn = createNode(1, { name: 'targetFn', qualifiedName: 'pkg.targetFn' });
    const test = createNode(2, {
      label: 'Test',
      name: 'testTargetFn',
      qualifiedName: 'pkg.test.testTargetFn',
      filePath: '/src/__tests__/target.test.ts',
    });
    store.insertNode(fn);
    store.insertNode(test);
    createEdge(store, 201, test.id, fn.id, 'TESTS');

    const result = analyzer.findAffectedTests(PROJECT_ID, [fn.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.testName).toBe('testTargetFn');
    expect(result[0]!.testFile).toBe('/src/__tests__/target.test.ts');
    expect(result[0]!.testedSymbol).toBe('pkg.targetFn');
  });

  it('should find multiple tests', () => {
    const fn = createNode(1);
    const test1 = createNode(2, { label: 'Test', name: 'test1' });
    const test2 = createNode(3, { label: 'Test', name: 'test2' });
    store.insertNode(fn);
    store.insertNode(test1);
    store.insertNode(test2);
    createEdge(store, 201, test1.id, fn.id, 'TESTS');
    createEdge(store, 301, test2.id, fn.id, 'TESTS');

    const result = analyzer.findAffectedTests(PROJECT_ID, [fn.id]);
    expect(result).toHaveLength(2);
  });

  it('should return empty when no tests exist', () => {
    const fn = createNode(1);
    store.insertNode(fn);

    const result = analyzer.findAffectedTests(PROJECT_ID, [fn.id]);
    expect(result).toHaveLength(0);
  });

  it('should classify tests as direct when the test itself is in the changed set', () => {
    const test = createNode(1, {
      label: 'Test',
      name: 'directTest',
      filePath: '/src/test.ts',
    });
    store.insertNode(test);

    // The test node itself is in symbolIds, so impactType = 'direct'
    const result = analyzer.findAffectedTests(PROJECT_ID, [test.id]);
    // But there are no TESTS edges pointing TO the test
    expect(result).toHaveLength(0);

    // Test with an actual target
    const target = createNode(2, { name: 'code', qualifiedName: 'pkg.code' });
    store.insertNode(target);
    createEdge(store, 102, test.id, target.id, 'TESTS');

    const result2 = analyzer.findAffectedTests(PROJECT_ID, [target.id, test.id]);
    expect(result2.length).toBeGreaterThanOrEqual(1);
  });

  it('should not duplicate tests', () => {
    const fn1 = createNode(1);
    const fn2 = createNode(2);
    const test = createNode(3, { label: 'Test', name: 'sharedTest' });
    store.insertNode(fn1);
    store.insertNode(fn2);
    store.insertNode(test);
    createEdge(store, 301, test.id, fn1.id, 'TESTS');
    createEdge(store, 302, test.id, fn2.id, 'TESTS');

    const result = analyzer.findAffectedTests(PROJECT_ID, [fn1.id, fn2.id]);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findAffectedRoutes Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer.findAffectedRoutes', () => {
  let store: SqliteStore;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    store = new SqliteStore();
    analyzer = new ImpactAnalyzer(store);
  });

  it('should find routes connected via HANDLES_ROUTE', () => {
    const handler = createNode(1);
    const route = createNode(2, {
      label: 'Route',
      properties: {
        name: 'GET /api/users',
        routePath: '/api/users',
        routeMethod: 'GET',
      },
    });
    store.insertNode(handler);
    store.insertNode(route);
    createEdge(store, 102, handler.id, route.id, 'HANDLES_ROUTE');

    const result = analyzer.findAffectedRoutes(PROJECT_ID, [handler.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.routePath).toBe('/api/users');
    expect(result[0]!.routeMethod).toBe('GET');
  });

  it('should find direct Route nodes among affected symbols', () => {
    const route = createNode(1, {
      label: 'Route',
      properties: {
        name: 'POST /api/data',
        routePath: '/api/data',
        routeMethod: 'POST',
      },
    });
    store.insertNode(route);

    const result = analyzer.findAffectedRoutes(PROJECT_ID, [route.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.routePath).toBe('/api/data');
    expect(result[0]!.routeMethod).toBe('POST');
  });

  it('should return empty when no routes affected', () => {
    const fn = createNode(1);
    store.insertNode(fn);

    const result = analyzer.findAffectedRoutes(PROJECT_ID, [fn.id]);
    expect(result).toHaveLength(0);
  });

  it('should find route consumers', () => {
    const handler = createNode(1);
    const route = createNode(2, {
      label: 'Route',
      properties: {
        name: 'GET /api/items',
        routePath: '/api/items',
        routeMethod: 'GET',
      },
    });
    const consumer = createNode(3, { name: 'consumer', qualifiedName: 'pkg.consumer' });
    store.insertNode(handler);
    store.insertNode(route);
    store.insertNode(consumer);
    createEdge(store, 102, handler.id, route.id, 'HANDLES_ROUTE');
    createEdge(store, 203, route.id, consumer.id, 'CALLS');

    const result = analyzer.findAffectedRoutes(PROJECT_ID, [handler.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.consumers).toContain('pkg.consumer');
  });

  it('should not duplicate routes', () => {
    const handler = createNode(1);
    const route = createNode(2, {
      label: 'Route',
      properties: {
        name: 'GET /api/dup',
        routePath: '/api/dup',
        routeMethod: 'GET',
      },
    });
    store.insertNode(handler);
    store.insertNode(route);
    createEdge(store, 102, handler.id, route.id, 'HANDLES_ROUTE');

    const result = analyzer.findAffectedRoutes(PROJECT_ID, [handler.id, route.id]);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findAffectedProcesses Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer.findAffectedProcesses', () => {
  let store: SqliteStore;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    store = new SqliteStore();
    analyzer = new ImpactAnalyzer(store);
  });

  it('should find Process nodes directly among affected symbols', () => {
    const process = createNode(1, { label: 'Process', name: 'UserOnboarding' });
    store.insertNode(process);

    const result = analyzer.findAffectedProcesses(PROJECT_ID, [process.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.processName).toBe('UserOnboarding');
    expect(result[0]!.severity).toBe('blocked');
  });

  it('should find processes via STEP_IN_PROCESS edges', () => {
    const process = createNode(1, { label: 'Process', name: 'Checkout' });
    const step = createNode(2, { name: 'validateCart' });
    store.insertNode(process);
    store.insertNode(step);
    createEdge(store, 102, process.id, step.id, 'STEP_IN_PROCESS');

    const result = analyzer.findAffectedProcesses(PROJECT_ID, [step.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.processName).toBe('Checkout');
    expect(result[0]!.severity).toBe('degraded');
    expect(result[0]!.affectedSteps).toContain('validateCart');
  });

  it('should return empty when no processes affected', () => {
    const fn = createNode(1);
    store.insertNode(fn);

    const result = analyzer.findAffectedProcesses(PROJECT_ID, [fn.id]);
    expect(result).toHaveLength(0);
  });

  it('should accumulate multiple affected steps for same process', () => {
    const process = createNode(1, { label: 'Process', name: 'OrderFlow' });
    const step1 = createNode(2, { name: 'validateOrder' });
    const step2 = createNode(3, { name: 'processPayment' });
    store.insertNode(process);
    store.insertNode(step1);
    store.insertNode(step2);
    createEdge(store, 102, process.id, step1.id, 'STEP_IN_PROCESS');
    createEdge(store, 103, process.id, step2.id, 'STEP_IN_PROCESS');

    const result = analyzer.findAffectedProcesses(PROJECT_ID, [step1.id, step2.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.affectedSteps).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// computeRiskScore Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer.computeRiskScore', () => {
  let store: SqliteStore;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    store = new SqliteStore();
    analyzer = new ImpactAnalyzer(store);
  });

  it('should return low score for no changes', () => {
    const result = {
      changedFiles: [],
      changedSymbols: [],
      impactTree: [],
      riskLevel: 'low' as const,
      processesAffected: [],
      estimatedEffort: 'low' as const,
    };
    const score = analyzer.computeRiskScore(result);
    expect(score).toBe(0);
  });

  it('should return higher score for many changed symbols', () => {
    const symbols = Array.from({ length: 20 }, (_, i) => ({
      symbolQname: `pkg.fn_${i}`,
      filePath: `/src/file_${i}.ts`,
      changeType: 'modified' as const,
      startLine: i * 10,
      endLine: i * 10 + 5,
    }));

    const result = {
      changedFiles: symbols.map((s) => s.filePath),
      changedSymbols: symbols,
      impactTree: [],
      riskLevel: 'high' as const,
      processesAffected: [],
      estimatedEffort: 'high' as const,
    };
    const score = analyzer.computeRiskScore(result);
    expect(score).toBeGreaterThan(20);
  });

  it('should include impact breadth in score', () => {
    const symbols = [
      {
        symbolQname: 'pkg.fn',
        filePath: '/src/file.ts',
        changeType: 'modified' as const,
        startLine: 10,
        endLine: 20,
      },
    ];

    const impactNodes: Array<{
      symbolQname: string;
      label: 'Function';
      filePath: string;
      impactType: 'direct';
      depth: number;
      children: never[];
    }> = Array.from({ length: 25 }, (_, i) => ({
      symbolQname: `pkg.impacted_${i}`,
      label: 'Function' as const,
      filePath: `/src/impacted_${i}.ts`,
      impactType: 'direct' as const,
      depth: 1,
      children: [],
    }));

    const result = {
      changedFiles: ['/src/file.ts'],
      changedSymbols: symbols,
      impactTree: impactNodes,
      riskLevel: 'critical' as const,
      processesAffected: [],
      estimatedEffort: 'high' as const,
    };
    const score = analyzer.computeRiskScore(result);
    expect(score).toBeGreaterThanOrEqual(50);
  });

  it('should include process impact in score', () => {
    const symbols = [
      {
        symbolQname: 'pkg.fn',
        filePath: '/src/file.ts',
        changeType: 'modified' as const,
        startLine: 10,
        endLine: 20,
      },
    ];

    const result = {
      changedFiles: ['/src/file.ts'],
      changedSymbols: symbols,
      impactTree: [],
      riskLevel: 'critical' as const,
      processesAffected: [
        {
          processName: 'p1',
          processId: 0,
          severity: 'critical' as const,
          affectedSteps: [],
          description: '',
        },
        {
          processName: 'p2',
          processId: 0,
          severity: 'high' as const,
          affectedSteps: [],
          description: '',
        },
        {
          processName: 'p3',
          processId: 0,
          severity: 'medium' as const,
          affectedSteps: [],
          description: '',
        },
      ],
      estimatedEffort: 'high' as const,
    };
    const score = analyzer.computeRiskScore(result);
    expect(score).toBeGreaterThan(20);
  });

  it('should never exceed 100', () => {
    const symbols = Array.from({ length: 100 }, (_, i) => ({
      symbolQname: `pkg.fn_${i}`,
      filePath: `/src/file_${i}.ts`,
      changeType: 'modified' as const,
      startLine: i,
      endLine: i + 5,
    }));

    const impactNodes = symbols.map((s) => ({
      symbolQname: s.symbolQname,
      label: 'Function' as const,
      filePath: s.filePath,
      impactType: 'direct' as const,
      depth: 1,
      children: [],
    }));

    const result = {
      changedFiles: symbols.map((s) => s.filePath),
      changedSymbols: symbols,
      impactTree: impactNodes,
      riskLevel: 'critical' as const,
      processesAffected: Array.from({ length: 10 }, (_, i) => ({
        processName: `p${i}`,
        processId: 0,
        severity: 'critical' as const,
        affectedSteps: [],
        description: '',
      })),
      estimatedEffort: 'high' as const,
    };
    const score = analyzer.computeRiskScore(result);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// analyze Integration Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer.analyze', () => {
  let store: SqliteStore;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    store = new SqliteStore();
    analyzer = new ImpactAnalyzer(store);
  });

  it('should perform full analysis for changed symbols', async () => {
    const fn = createNode(1, {
      filePath: '/src/app.ts',
      startLine: 10,
      endLine: 20,
      isExported: true,
    });
    const caller = createNode(2, { filePath: '/src/caller.ts' });
    const test = createNode(3, {
      label: 'Test',
      filePath: '/src/__tests__/app.test.ts',
      name: 'testApp',
      qualifiedName: 'pkg.test.testApp',
    });
    store.insertNode(fn);
    store.insertNode(caller);
    store.insertNode(test);
    createEdge(store, 201, caller.id, fn.id, 'CALLS');
    createEdge(store, 301, test.id, fn.id, 'TESTS');

    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/app.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols);
    expect(result.changedFiles).toContain('/src/app.ts');
    expect(result.changedSymbols).toHaveLength(1);
    expect(result.impactTree.length).toBeGreaterThan(0);
    expect(result.riskLevel).toBeDefined();
    expect(result.estimatedEffort).toBeDefined();
  });

  it('should handle option to disable tests', async () => {
    const fn = createNode(1);
    const caller = createNode(2);
    store.insertNode(fn);
    store.insertNode(caller);
    createEdge(store, 201, caller.id, fn.id, 'CALLS');

    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/file_1.ts'),
    ];

    // With tests disabled, impact tree should still have dependents
    const result = await analyzer.analyze(PROJECT_ID, changedSymbols, {
      includeTests: false,
    });
    expect(result.impactTree.length).toBeGreaterThan(0);
  });

  it('should handle option to disable routes', async () => {
    const fn = createNode(1);
    store.insertNode(fn);

    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/file_1.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols, {
      includeRoutes: false,
    });
    // Should not crash
    expect(result.riskLevel).toBeDefined();
  });

  it('should handle option to disable processes', async () => {
    const fn = createNode(1);
    store.insertNode(fn);

    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/file_1.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols, {
      includeProcesses: false,
    });
    expect(result.processesAffected).toHaveLength(0);
  });

  it('should handle custom maxDepth', async () => {
    // A <- B <- C <- D <- E
    for (let i = 1; i <= 5; i++) {
      store.insertNode(createNode(i));
    }
    for (let i = 2; i <= 5; i++) {
      createEdge(store, i * 100 + i - 1, i, i - 1, 'CALLS');
    }

    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/file_1.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols, {
      maxDepth: 2,
    });
    // Should only find depth 1 and 2 nodes
    const depths = result.impactTree.map((n) => n.depth);
    const maxDepth = Math.max(...depths, 0);
    expect(maxDepth).toBeLessThanOrEqual(2);
  });

  it('should return minimal result when no symbols match', async () => {
    const changedSymbols = [
      makeChangedSymbol('nonexistent', 'pkg.nonexistent', '/src/nonexistent.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols);
    expect(result.changedSymbols).toHaveLength(0); // Symbol not in store
    expect(result.impactTree).toHaveLength(0);
    expect(result.riskLevel).toBe('low');
    expect(result.estimatedEffort).toBe('low');
  });

  it('should compute estimatedEffort as high for large impact', async () => {
    // Create 25 nodes in a chain, all dependent: fn_1 <- fn_2 <- fn_3 <- ...
    const nodeIds: number[] = [];
    for (let i = 1; i <= 25; i++) {
      const n = createNode(i);
      const actualId = store.insertNode(n);
      nodeIds.push(actualId);
    }
    // nodeIds[i] depends on nodeIds[i-1]
    for (let i = 1; i < nodeIds.length; i++) {
      createEdge(
        store,
        i * 100 + i,
        nodeIds[i]!,
        nodeIds[i - 1]!,
        'CALLS',
      );
    }

    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/file_1.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols, {
      maxDepth: 25,
    });
    expect(result.impactTree.length).toBeGreaterThanOrEqual(20);
    expect(result.estimatedEffort).toBe('high');
  });

  it('should compute estimatedEffort as medium for moderate impact', async () => {
    // Create 12 nodes in a chain, use maxDepth to traverse full chain
    const nodeIds: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const n = createNode(i);
      const actualId = store.insertNode(n);
      nodeIds.push(actualId);
    }
    for (let i = 1; i < nodeIds.length; i++) {
      createEdge(
        store,
        i * 100 + i,
        nodeIds[i]!,
        nodeIds[i - 1]!,
        'CALLS',
      );
    }
    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/file_1.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols, {
      maxDepth: 12,
    });
    expect(result.impactTree.length).toBeGreaterThanOrEqual(10);
    expect(result.estimatedEffort).toBe('medium');
  });

  it('should compute estimatedEffort as low for minimal impact', async () => {
    const fn = createNode(1);
    store.insertNode(fn);

    const changedSymbols = [
      makeChangedSymbol('fn_1', 'pkg.fn_1', '/src/file_1.ts'),
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols);
    expect(result.estimatedEffort).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Risk Level Tests
// ---------------------------------------------------------------------------

describe('ImpactAnalyzer risk determination', () => {
  it('should return critical when processes are blocked', async () => {
    const store = new SqliteStore();
    const analyzer = new ImpactAnalyzer(store);

    const process = createNode(1, {
      label: 'Process',
      name: 'CriticalProcess',
      qualifiedName: 'pkg.CriticalProcess',
    });
    store.insertNode(process);

    const changedSymbols = [
      {
        name: 'CriticalProcess',
        qualifiedName: 'pkg.CriticalProcess',
        filePath: '/src/process.ts',
        changeType: 'modified' as const,
        lineRange: [10, 20] as [number, number],
        riskLevel: 'critical' as const,
        reason: '',
      },
    ];

    const result = await analyzer.analyze(PROJECT_ID, changedSymbols);
    expect(result.riskLevel).toBe('critical');
  });
});
