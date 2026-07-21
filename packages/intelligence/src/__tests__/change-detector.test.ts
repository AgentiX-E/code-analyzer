// @code-analyzer/intelligence — Change Detector Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { ChangeDetector } from '../impact/change-detector.js';
import type {
  ChangedSymbol,
} from '../impact/change-detector.js';
import { SqliteStore } from '@code-analyzer/infra';
import type {
  GraphNode,
  GraphEdge,
  GitDiff,
} from '@code-analyzer/shared';

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
  id: number,
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    id,
    projectId: PROJECT_ID,
    sourceId: 1,
    targetId: 2,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: '/src/file_1.ts',
    oldHash: 'abc123',
    newHash: 'def456',
    ranges: [
      {
        oldStart: 10,
        oldEnd: 15,
        newStart: 10,
        newEnd: 16,
        changeType: 'modified',
      },
    ],
    changeType: 'modified',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyRisk Tests
// ---------------------------------------------------------------------------

describe('ChangeDetector.classifyRisk', () => {
  const detector = new ChangeDetector(new SqliteStore());

  const baseSymbol: ChangedSymbol = {
    name: 'testFn',
    qualifiedName: 'pkg.testFn',
    filePath: '/src/test.ts',
    changeType: 'modified',
    lineRange: [10, 20],
    riskLevel: 'low',
    reason: '',
  };

  it('should classify exported interface with dependents as critical', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: true,
      degree: 2,
      isRoute: false,
      isInterface: true,
    });
    expect(result).toBe('critical');
  });

  it('should classify route with >10 dependents as critical', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 15,
      isRoute: true,
      isInterface: false,
    });
    expect(result).toBe('critical');
  });

  it('should classify exported symbol with >10 dependents as critical', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: true,
      degree: 12,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('critical');
  });

  it('should classify exported symbol with >5 but <=10 dependents as high', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: true,
      degree: 7,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('high');
  });

  it('should classify non-exported symbol with >5 dependents as high', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 8,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('high');
  });

  it('should classify symbol with 1-5 dependents as medium', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 3,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('medium');
  });

  it('should classify exported symbol with 1-5 dependents as medium', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: true,
      degree: 2,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('medium');
  });

  it('should classify symbol with no dependents as low', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 0,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('low');
  });

  it('should classify exported symbol with no dependents as low', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: true,
      degree: 0,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('low');
  });

  it('should handle boundary: exactly 5 dependents → medium', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 5,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('medium');
  });

  it('should handle boundary: exactly 6 dependents → high', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 6,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('high');
  });

  it('should handle boundary: exactly 10 dependents on exported → high', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: true,
      degree: 10,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('high');
  });

  it('should handle boundary: exactly 11 dependents on exported → critical', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: true,
      degree: 11,
      isRoute: false,
      isInterface: false,
    });
    expect(result).toBe('critical');
  });

  it('should classify non-exported interface without dependents as low', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 0,
      isRoute: false,
      isInterface: true,
    });
    expect(result).toBe('low');
  });

  it('should classify route with <=10 dependents based on degree', () => {
    const result = detector.classifyRisk(baseSymbol, {
      isExported: false,
      degree: 5,
      isRoute: true,
      isInterface: false,
    });
    expect(result).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// getSymbolsInRange Tests
// ---------------------------------------------------------------------------

describe('ChangeDetector.getSymbolsInRange', () => {
  let store: SqliteStore;
  let detector: ChangeDetector;

  beforeEach(() => {
    store = new SqliteStore();
    detector = new ChangeDetector(store);
  });

  it('should find symbols whose lines overlap with the given range', () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      15,
      18,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('fn_1');
  });

  it('should find symbols at exact range boundaries', () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      10,
      20,
    );
    expect(result).toHaveLength(1);
  });

  it('should return empty array for non-overlapping ranges', () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      30,
      40,
    );
    expect(result).toHaveLength(0);
  });

  it('should return empty array when no symbols in file', () => {
    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      1,
      100,
    );
    expect(result).toHaveLength(0);
  });

  it('should filter by file path', () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: 10,
        endLine: 20,
      }),
    );
    store.insertNode(
      createNode(2, {
        filePath: '/src/other.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      10,
      20,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('fn_1');
  });

  it('should find multiple symbols in the same range', () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: 10,
        endLine: 20,
      }),
    );
    store.insertNode(
      createNode(2, {
        filePath: '/src/app.ts',
        startLine: 15,
        endLine: 25,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      12,
      18,
    );
    expect(result).toHaveLength(2);
  });

  it('should include symbols that extend beyond the range', () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: 1,
        endLine: 100,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      40,
      50,
    );
    expect(result).toHaveLength(1);
  });

  it('should filter by project ID', () => {
    store.insertNode(
      createNode(1, {
        projectId: 'other-project',
        filePath: '/src/app.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      10,
      20,
    );
    expect(result).toHaveLength(0);
  });

  it('should handle nodes with null startLine or endLine', () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: null,
        endLine: null,
      }),
    );

    const result = detector.getSymbolsInRange(
      PROJECT_ID,
      '/src/app.ts',
      10,
      20,
    );
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mapDiffToSymbols Tests
// ---------------------------------------------------------------------------

describe('ChangeDetector.mapDiffToSymbols', () => {
  let store: SqliteStore;
  let detector: ChangeDetector;

  beforeEach(() => {
    store = new SqliteStore();
    detector = new ChangeDetector(store);
  });

  it('should map a modified diff to symbols with callers and callees', async () => {
    const callerNode = createNode(3, {
      name: 'caller',
      qualifiedName: 'pkg.caller',
      filePath: '/src/caller.ts',
      startLine: 1,
      endLine: 5,
    });
    const calleeNode = createNode(4, {
      name: 'callee',
      qualifiedName: 'pkg.callee',
      filePath: '/src/callee.ts',
      startLine: 1,
      endLine: 5,
    });
    const changedNode = createNode(1, {
      name: 'changedFn',
      qualifiedName: 'pkg.changedFn',
      filePath: '/src/changed.ts',
      startLine: 10,
      endLine: 20,
    });

    store.insertNode(changedNode);
    const callerNodeId = store.insertNode(callerNode);
    const calleeNodeId = store.insertNode(calleeNode);
    const changedNodeId = store.getNodeByQualifiedName('pkg.changedFn')!.id;

    // Caller calls changedFn
    store.insertEdge(
      createEdge(301, {
        sourceId: callerNodeId,
        targetId: changedNodeId,
        type: 'CALLS',
      }),
    );
    // changedFn calls callee
    store.insertEdge(
      createEdge(104, {
        sourceId: changedNodeId,
        targetId: calleeNodeId,
        type: 'CALLS',
      }),
    );

    const diff = createDiff({
      filePath: '/src/changed.ts',
      ranges: [
        {
          oldStart: 10,
          oldEnd: 20,
          newStart: 10,
          newEnd: 22,
          changeType: 'modified',
        },
      ],
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol.name).toBe('changedFn');
    expect(results[0]!.symbol.changeType).toBe('modified');
    expect(results[0]!.callers).toContain('pkg.caller');
    expect(results[0]!.callees).toContain('pkg.callee');
  });

  it('should map an added diff correctly', async () => {
    store.insertNode(
      createNode(1, {
        name: 'newFn',
        qualifiedName: 'pkg.newFn',
        filePath: '/src/new.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const diff = createDiff({
      filePath: '/src/new.ts',
      changeType: 'added',
      ranges: [
        {
          oldStart: 0,
          oldEnd: 0,
          newStart: 10,
          newEnd: 20,
          changeType: 'added',
        },
      ],
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol.changeType).toBe('added');
  });

  it('should map a deleted diff correctly', async () => {
    store.insertNode(
      createNode(1, {
        name: 'oldFn',
        qualifiedName: 'pkg.oldFn',
        filePath: '/src/old.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const diff = createDiff({
      filePath: '/src/old.ts',
      changeType: 'deleted',
      ranges: [
        {
          oldStart: 10,
          oldEnd: 20,
          newStart: 0,
          newEnd: 0,
          changeType: 'removed',
        },
      ],
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol.changeType).toBe('removed');
  });

  it('should include test relationships', async () => {
    const changedNode = createNode(1, {
      name: 'changedFn',
      qualifiedName: 'pkg.changedFn',
      filePath: '/src/changed.ts',
      startLine: 10,
      endLine: 20,
    });
    const testNode = createNode(5, {
      label: 'Test',
      name: 'testChangedFn',
      qualifiedName: 'pkg.test.testChangedFn',
      filePath: '/src/__tests__/changed.test.ts',
      startLine: 1,
      endLine: 10,
    });

    store.insertNode(changedNode);
    const testNodeId = store.insertNode(testNode);
    const changedNodeId = store.getNodeByQualifiedName('pkg.changedFn')!.id;
    store.insertEdge(
      createEdge(501, {
        sourceId: testNodeId,
        targetId: changedNodeId,
        type: 'TESTS',
      }),
    );

    const diff = createDiff({
      filePath: '/src/changed.ts',
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    expect(results[0]!.tests).toContain('pkg.test.testChangedFn');
  });

  it('should include route relationships', async () => {
    const changedNode = createNode(1, {
      name: 'handler',
      qualifiedName: 'pkg.handler',
      filePath: '/src/handler.ts',
      startLine: 10,
      endLine: 20,
    });
    const routeNode = createNode(6, {
      label: 'Route',
      name: 'GET /api/users',
      qualifiedName: 'route.api.users',
      filePath: '/src/routes.ts',
      startLine: 1,
      endLine: 5,
      properties: {
        name: 'GET /api/users',
        routePath: '/api/users',
        routeMethod: 'GET',
      },
    });

    store.insertNode(changedNode);
    const routeNodeId = store.insertNode(routeNode);
    const changedNodeId = store.getNodeByQualifiedName('pkg.handler')!.id;
    store.insertEdge(
      createEdge(106, {
        sourceId: changedNodeId,
        targetId: routeNodeId,
        type: 'HANDLES_ROUTE',
      }),
    );

    const diff = createDiff({
      filePath: '/src/handler.ts',
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    expect(results[0]!.routes).toContain('route.api.users');
  });

  it('should handle a diff with multiple ranges', async () => {
    store.insertNode(
      createNode(1, {
        name: 'fnA',
        qualifiedName: 'pkg.fnA',
        filePath: '/src/multi.ts',
        startLine: 10,
        endLine: 20,
      }),
    );
    store.insertNode(
      createNode(2, {
        name: 'fnB',
        qualifiedName: 'pkg.fnB',
        filePath: '/src/multi.ts',
        startLine: 30,
        endLine: 40,
      }),
    );

    const diff = createDiff({
      filePath: '/src/multi.ts',
      ranges: [
        {
          oldStart: 10,
          oldEnd: 20,
          newStart: 10,
          newEnd: 22,
          changeType: 'modified',
        },
        {
          oldStart: 30,
          oldEnd: 40,
          newStart: 30,
          newEnd: 45,
          changeType: 'modified',
        },
      ],
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(2);
  });

  it('should return empty array for a diff with no symbols', async () => {
    const diff = createDiff({
      filePath: '/src/empty.ts',
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(0);
  });

  it('should return empty array for a diff with no ranges', async () => {
    store.insertNode(
      createNode(1, {
        filePath: '/src/app.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const diff = createDiff({
      filePath: '/src/app.ts',
      ranges: [],
    });

    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectChanges Tests
// ---------------------------------------------------------------------------

describe('ChangeDetector.detectChanges', () => {
  let store: SqliteStore;
  let detector: ChangeDetector;

  beforeEach(() => {
    store = new SqliteStore();
    detector = new ChangeDetector(store);
  });

  it('should detect changes from multiple diffs', async () => {
    store.insertNode(
      createNode(1, {
        name: 'fn1',
        qualifiedName: 'pkg.fn1',
        filePath: '/src/a.ts',
        startLine: 10,
        endLine: 20,
        isExported: true,
      }),
    );
    store.insertNode(
      createNode(2, {
        name: 'fn2',
        qualifiedName: 'pkg.fn2',
        filePath: '/src/b.ts',
        startLine: 5,
        endLine: 15,
        isExported: false,
      }),
    );

    // Add dependents to fn1 to increase risk
    const callerNode = createNode(3, {
      name: 'caller',
      qualifiedName: 'pkg.caller',
      filePath: '/src/caller.ts',
      startLine: 1,
      endLine: 5,
    });
    store.insertNode(callerNode);
    store.insertEdge(
      createEdge(301, {
        sourceId: callerNode.id,
        targetId: 1,
        type: 'CALLS',
      }),
    );

    const diffs: GitDiff[] = [
      createDiff({
        filePath: '/src/a.ts',
        changeType: 'modified',
      }),
      createDiff({
        filePath: '/src/b.ts',
        changeType: 'added',
        ranges: [
          {
            oldStart: 0,
            oldEnd: 0,
            newStart: 5,
            newEnd: 15,
            changeType: 'added',
          },
        ],
      }),
    ];

    const result = await detector.detectChanges(PROJECT_ID, diffs);
    expect(result.changedSymbols).toHaveLength(2);
    expect(result.addedSymbols).toHaveLength(1);
    expect(result.addedSymbols[0]).toBe('pkg.fn2');
    expect(result.modifiedSymbols).toHaveLength(1);
    expect(result.modifiedSymbols[0]).toBe('pkg.fn1');
    expect(result.removedSymbols).toHaveLength(0);
    expect(result.riskByFile.size).toBe(2);
  });

  it('should compute overall risk as highest risk among symbols', async () => {
    // Create an exported interface node with dependents → critical
    const ifaceNode = createNode(1, {
      label: 'Interface',
      name: 'MyInterface',
      qualifiedName: 'pkg.MyInterface',
      filePath: '/src/iface.ts',
      startLine: 10,
      endLine: 20,
      isExported: true,
    });
    store.insertNode(ifaceNode);

    // Add caller to create dependents
    const caller = createNode(2, {
      name: 'user',
      qualifiedName: 'pkg.user',
      filePath: '/src/user.ts',
      startLine: 1,
      endLine: 5,
    });
    store.insertNode(caller);
    store.insertEdge(
      createEdge(201, {
        sourceId: caller.id,
        targetId: ifaceNode.id,
        type: 'IMPLEMENTS',
      }),
    );

    const diffs: GitDiff[] = [
      createDiff({
        filePath: '/src/iface.ts',
        changeType: 'modified',
      }),
    ];

    const result = await detector.detectChanges(PROJECT_ID, diffs);
    expect(result.overallRisk).toBe('critical');
  });

  it('should handle empty diffs', async () => {
    const result = await detector.detectChanges(PROJECT_ID, []);
    expect(result.changedSymbols).toHaveLength(0);
    expect(result.addedSymbols).toHaveLength(0);
    expect(result.modifiedSymbols).toHaveLength(0);
    expect(result.removedSymbols).toHaveLength(0);
    expect(result.overallRisk).toBe('low');
    expect(result.riskByFile.size).toBe(0);
  });

  it('should compute risk per file correctly', async () => {
    store.insertNode(
      createNode(1, {
        name: 'safe',
        qualifiedName: 'pkg.safe',
        filePath: '/src/safe.ts',
        startLine: 10,
        endLine: 15,
        isExported: false,
      }),
    );
    store.insertNode(
      createNode(2, {
        label: 'Interface',
        name: 'CriticalIface',
        qualifiedName: 'pkg.CriticalIface',
        filePath: '/src/risky.ts',
        startLine: 10,
        endLine: 20,
        isExported: true,
      }),
    );

    // Add caller for critical interface
    const caller = createNode(3, {
      name: 'impl',
      qualifiedName: 'pkg.impl',
      filePath: '/src/impl.ts',
      startLine: 1,
      endLine: 5,
    });
    store.insertNode(caller);
    store.insertEdge(
      createEdge(302, {
        sourceId: caller.id,
        targetId: 2,
        type: 'IMPLEMENTS',
      }),
    );

    const diffs: GitDiff[] = [
      createDiff({
        filePath: '/src/safe.ts',
      }),
      createDiff({
        filePath: '/src/risky.ts',
      }),
    ];

    const result = await detector.detectChanges(PROJECT_ID, diffs);
    expect(result.riskByFile.get('/src/safe.ts')).toBe('low');
    expect(result.riskByFile.get('/src/risky.ts')).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// Edge Case Tests
// ---------------------------------------------------------------------------

describe('ChangeDetector edge cases', () => {
  let store: SqliteStore;
  let detector: ChangeDetector;

  beforeEach(() => {
    store = new SqliteStore();
    detector = new ChangeDetector(store);
  });

  it('should handle symbols with many dependents (scalability)', async () => {
    const hubNode = createNode(1, {
      name: 'hub',
      qualifiedName: 'pkg.hub',
      filePath: '/src/hub.ts',
      startLine: 10,
      endLine: 20,
      isExported: true,
    });
    store.insertNode(hubNode);

    // Insert 15 dependents
    for (let i = 2; i <= 16; i++) {
      const dep = createNode(i, {
        name: `dep_${i}`,
        qualifiedName: `pkg.dep_${i}`,
        filePath: `/src/dep_${i}.ts`,
        startLine: 1,
        endLine: 5,
      });
      store.insertNode(dep);
      store.insertEdge(
        createEdge(i * 100 + 1, {
          sourceId: dep.id,
          targetId: hubNode.id,
          type: 'CALLS',
        }),
      );
    }

    const diff = createDiff({ filePath: '/src/hub.ts' });
    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    expect(results[0]!.callers).toHaveLength(15);
    expect(results[0]!.symbol.riskLevel).toBe('critical');
  });

  it('should handle null qualifiedName gracefully', async () => {
    store.insertNode(
      createNode(1, {
        name: 'fn',
        qualifiedName: '',
        filePath: '/src/fn.ts',
        startLine: 10,
        endLine: 20,
      }),
    );

    const diff = createDiff({ filePath: '/src/fn.ts' });
    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    // Should not crash, though empty qname means getNodeByQualifiedName returns null
    expect(results).toHaveLength(0);
  });

  it('should handle nodes with null qualifiedName for callers/callees/tests/routes fallback', async () => {
    // Create a changed node with dependents that have null qualifiedName
    const changedNode = createNode(1, {
      name: 'targetFn',
      qualifiedName: 'pkg.targetFn',
      filePath: '/src/target.ts',
      startLine: 10,
      endLine: 20,
    });
    store.insertNode(changedNode);

    // Caller with null qualifiedName
    const callerNode = createNode(3, {
      name: 'caller',
      qualifiedName: null as any,
      filePath: '/src/caller.ts',
      startLine: 1,
      endLine: 5,
    });
    const callerId = store.insertNode(callerNode);
    store.insertEdge(createEdge(301, { sourceId: callerId, targetId: 1, type: 'CALLS' }));

    // Callee with null qualifiedName
    const calleeNode = createNode(4, {
      name: 'callee',
      qualifiedName: null as any,
      filePath: '/src/callee.ts',
      startLine: 1,
      endLine: 5,
    });
    const calleeId = store.insertNode(calleeNode);
    store.insertEdge(createEdge(401, { sourceId: 1, targetId: calleeId, type: 'CALLS' }));

    const diff = createDiff({ filePath: '/src/target.ts' });
    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    // Fallback to node-{id} when qualifiedName is null
    expect(results[0]!.callers).toContain(`node-${callerId}`);
    expect(results[0]!.callees).toContain(`node-${calleeId}`);
  });

  it('should handle Route nodes with null routePath', async () => {
    // Node with Route label but null routePath
    const changedNode = createNode(1, {
      name: 'handler',
      qualifiedName: 'pkg.handler',
      filePath: '/src/handler.ts',
      startLine: 10,
      endLine: 20,
    });
    store.insertNode(changedNode);

    // Route node with null routePath
    const routeNode = createNode(6, {
      label: 'Route',
      name: 'GET /api/data',
      qualifiedName: 'route.api.data',
      filePath: '/src/routes.ts',
      startLine: 1,
      endLine: 5,
      properties: {
        name: 'GET /api/data',
        routePath: null,
        routeMethod: 'GET',
      },
    });
    const routeId = store.insertNode(routeNode);
    store.insertEdge(createEdge(601, { sourceId: 1, targetId: routeId, type: 'HANDLES_ROUTE' }));

    const diff = createDiff({ filePath: '/src/handler.ts' });
    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    // routePath === null should still make isRoute true since label === 'Route'
    expect(results[0]!.routes.length).toBeGreaterThan(0);
  });

  it('should handle test nodes with null qualifiedName fallback', async () => {
    // Changed node
    const changedNode = createNode(1, {
      name: 'targetFn',
      qualifiedName: 'pkg.targetFn',
      filePath: '/src/target.ts',
      startLine: 10,
      endLine: 20,
    });
    store.insertNode(changedNode);

    // Test node with null qualifiedName
    const testNode = createNode(5, {
      label: 'Test',
      name: 'testTarget',
      qualifiedName: null as any,
      filePath: '/src/__tests__/target.test.ts',
      startLine: 1,
      endLine: 10,
    });
    const testNodeId = store.insertNode(testNode);
    store.insertEdge(createEdge(501, { sourceId: testNodeId, targetId: 1, type: 'TESTS' }));

    const diff = createDiff({ filePath: '/src/target.ts' });
    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    // Fallback to node-{id} when qualifiedName is null
    expect(results[0]!.tests).toContain(`node-${testNodeId}`);
  });

  it('should handle route target node with null qualifiedName fallback', async () => {
    // Changed node
    const changedNode = createNode(1, {
      name: 'handler',
      qualifiedName: 'pkg.handler',
      filePath: '/src/handler.ts',
      startLine: 10,
      endLine: 20,
    });
    store.insertNode(changedNode);

    // Route target node with null qualifiedName
    const routeNode = createNode(6, {
      label: 'Route',
      name: 'GET /api/items',
      qualifiedName: null as any,
      filePath: '/src/routes.ts',
      startLine: 1,
      endLine: 5,
      properties: {
        name: 'GET /api/items',
        routePath: '/api/items',
        routeMethod: 'GET',
      },
    });
    const routeId = store.insertNode(routeNode);
    store.insertEdge(createEdge(601, { sourceId: 1, targetId: routeId, type: 'HANDLES_ROUTE' }));

    const diff = createDiff({ filePath: '/src/handler.ts' });
    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    // Fallback to node-{id} when qualifiedName is null for route target
    expect(results[0]!.routes).toContain(`node-${routeId}`);
  });

  it('should handle non-Route node with routePath explicitly null', async () => {
    // A Function node that has routePath set to null in properties
    // This triggers the routePath !== null check (line 205)
    const changedNode = createNode(1, {
      name: 'regularFn',
      qualifiedName: 'pkg.regularFn',
      filePath: '/src/regular.ts',
      startLine: 10,
      endLine: 20,
      label: 'Function',
      properties: {
        name: 'regularFn',
        routePath: null,
      },
    });
    store.insertNode(changedNode);

    const diff = createDiff({ filePath: '/src/regular.ts' });
    const results = await detector.mapDiffToSymbols(PROJECT_ID, diff);
    expect(results).toHaveLength(1);
    // isRoute should be false since label !== 'Route' AND routePath === null
    expect(results[0]!.routes).toHaveLength(0);
  });
});
