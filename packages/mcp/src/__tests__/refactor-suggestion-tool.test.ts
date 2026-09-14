// @code-analyzer/mcp — Refactor Suggestion Tool Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import refactorSuggestionTool from '../tools/refactor-suggestion.js';

function createStoreWithData(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  insertNode(store, {
    projectId: 'test-project',
    label: 'Project',
    name: 'Test',
    qualifiedName: 'Test',
  });
  const funcId = insertNode(store, {
    projectId: 'test-project',
    label: 'Function',
    name: 'bigFunction',
    qualifiedName: 'bigFunction',
    filePath: 'src/big.ts',
  });
  const classId = insertNode(store, {
    projectId: 'test-project',
    label: 'Class',
    name: 'BigClass',
    qualifiedName: 'BigClass',
    filePath: 'src/big.ts',
  });
  for (let i = 0; i < 12; i++) {
    const depId = insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: `dep${i}`,
      qualifiedName: `dep${i}`,
      filePath: 'src/dep.ts',
    });
    insertEdge(store, {
      projectId: 'test-project',
      type: 'CALLS',
      sourceId: funcId,
      targetId: depId,
    });
  }
  for (let i = 0; i < 8; i++) {
    const clsDepId = insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: `clsDep${i}`,
      qualifiedName: `clsDep${i}`,
      filePath: 'src/dep.ts',
    });
    insertEdge(store, {
      projectId: 'test-project',
      type: 'CALLS',
      sourceId: classId,
      targetId: clsDepId,
    });
  }
  return store;
}

describe('refactorSuggestionTool', () => {
  it('should have correct name', () => {
    expect(refactorSuggestionTool.name).toBe('refactor_suggestion');
  });
  it('should have callable handler', () => {
    expect(typeof refactorSuggestionTool.handler).toBe('function');
  });
  it('should return error with no store', async () => {
    const r = await refactorSuggestionTool.handler({ projectId: 'test-project' });
    expect(r.isError).toBe(true);
  });
  it('should generate suggestions from graph data', async () => {
    const r = await refactorSuggestionTool.handler(
      { projectId: 'test-project', maxSuggestions: 10 },
      createStoreWithData(),
    );
    expect(r.content[0]!.text).toContain('Refactor Suggestions');
    expect(r.metadata!['suggestionCount']!).toBeGreaterThan(0);
  });
  it('should return none for empty store', async () => {
    const r = await refactorSuggestionTool.handler(
      { projectId: 'test-project' },
      new InMemoryGraphStore(),
    );
    expect(r.content[0]!.text).toContain('No symbols found');
  });
  it('should respect maxSuggestions limit', async () => {
    const r = await refactorSuggestionTool.handler(
      { projectId: 'test-project', maxSuggestions: 1 },
      createStoreWithData(),
    );
    expect(r.metadata!['suggestionCount']!).toBeLessThanOrEqual(1);
  });

  it('should flag high-severity extract-method for >20 outgoing calls', async () => {
    const store = new InMemoryGraphStore();
    const fnId = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'mega',
      qualifiedName: 'mega',
      filePath: 'src/mega.ts',
    });
    for (let i = 0; i < 25; i++) {
      const dep = insertNode(store, {
        projectId: 'p',
        label: 'Function',
        name: `d${i}`,
        qualifiedName: `d${i}`,
        filePath: 'src/d.ts',
      });
      insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: fnId, targetId: dep });
    }
    const r = await refactorSuggestionTool.handler({ projectId: 'p' }, store);
    expect(r.content[0]!.text).toContain('high priority');
    expect(r.content[0]!.text).toContain('Extract Method');
  });

  it('should flag split-class for a class with >15 dependencies', async () => {
    const store = new InMemoryGraphStore();
    const clsId = insertNode(store, {
      projectId: 'p',
      label: 'Class',
      name: 'GodClass',
      qualifiedName: 'GodClass',
      filePath: 'src/god.ts',
    });
    for (let i = 0; i < 20; i++) {
      const dep = insertNode(store, {
        projectId: 'p',
        label: 'Function',
        name: `m${i}`,
        qualifiedName: `m${i}`,
        filePath: 'src/m.ts',
      });
      insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: clsId, targetId: dep });
    }
    const r = await refactorSuggestionTool.handler({ projectId: 'p' }, store);
    expect(r.content[0]!.text).toContain('Split Class');
  });

  it('should flag reduce-coupling for >15 incoming calls', async () => {
    const store = new InMemoryGraphStore();
    const targetId = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'hotspot',
      qualifiedName: 'hotspot',
      filePath: 'src/hot.ts',
    });
    for (let i = 0; i < 20; i++) {
      const caller = insertNode(store, {
        projectId: 'p',
        label: 'Function',
        name: `caller${i}`,
        qualifiedName: `caller${i}`,
        filePath: 'src/c.ts',
      });
      insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: caller, targetId: targetId });
    }
    const r = await refactorSuggestionTool.handler({ projectId: 'p' }, store);
    expect(r.content[0]!.text).toContain('Reduce Coupling');
  });

  // Three arms nothing had reached, plus one function nothing had called:
  //
  //   - every fixture so far set a `filePath`, so `node.filePath ?? '<unknown>'` (in all three
  //     finding constructors) had only ever taken the left side;
  //   - `dependencyEdges > 25` and `incomingCalls > 30` are the high tiers, and every existing
  //     fixture sat below them;
  //   - the severity comparator had **never run**, because no single call ever produced two
  //     suggestions for it to order.
  it('should reach the high tiers, the unknown-path fallback and the sort comparator', async () => {
    const store = new InMemoryGraphStore();
    const projectId = 'quiet-project';

    // a function with 22 outgoing calls → extract-method, high, and no file path
    const megaFn = insertNode(store, {
      projectId,
      label: 'Function',
      name: 'megaFn',
      qualifiedName: 'megaFn',
    });
    for (let i = 0; i < 22; i++) {
      const dep = insertNode(store, {
        projectId,
        label: 'Function',
        name: `fnDep${i}`,
        qualifiedName: `fnDep${i}`,
      });
      insertEdge(store, { projectId, type: 'CALLS', sourceId: megaFn, targetId: dep });
    }

    // a class with 27 dependencies → split-class, high (>25), and no file path
    const megaClass = insertNode(store, {
      projectId,
      label: 'Class',
      name: 'MegaClass',
      qualifiedName: 'MegaClass',
    });
    for (let i = 0; i < 27; i++) {
      const dep = insertNode(store, {
        projectId,
        label: 'Function',
        name: `clsDep${i}`,
        qualifiedName: `clsDep${i}`,
      });
      insertEdge(store, { projectId, type: 'CALLS', sourceId: megaClass, targetId: dep });
    }

    // a function with 31 incoming calls → reduce-coupling, high (>30), and no file path
    const hub = insertNode(store, {
      projectId,
      label: 'Function',
      name: 'hub',
      qualifiedName: 'hub',
    });
    for (let i = 0; i < 31; i++) {
      const caller = insertNode(store, {
        projectId,
        label: 'Function',
        name: `caller${i}`,
        qualifiedName: `caller${i}`,
      });
      insertEdge(store, { projectId, type: 'CALLS', sourceId: caller, targetId: hub });
    }

    // a function with 15 outgoing calls → extract-method, medium — so the comparator has to
    // compare two *different* severities, not just fall through to the dependency tie-break
    const mediumFn = insertNode(store, {
      projectId,
      label: 'Function',
      name: 'mediumFn',
      qualifiedName: 'mediumFn',
    });
    for (let i = 0; i < 15; i++) {
      const dep = insertNode(store, {
        projectId,
        label: 'Function',
        name: `midDep${i}`,
        qualifiedName: `midDep${i}`,
      });
      insertEdge(store, { projectId, type: 'CALLS', sourceId: mediumFn, targetId: dep });
    }

    const r = await refactorSuggestionTool.handler({ projectId, maxSuggestions: 20 }, store);

    // four findings of two different severities means the comparator had to order them
    expect(r.metadata!['suggestionCount']).toBeGreaterThanOrEqual(4);
    expect(r.content[0]!.text).toContain('🟡');
    expect(r.content[0]!.text).toContain('<unknown>');
    expect(r.content[0]!.text).toContain('high');
  });

  it('should filter by filePath', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'small',
      qualifiedName: 'small',
      filePath: 'src/a.ts',
    });
    const r = await refactorSuggestionTool.handler(
      { projectId: 'p', filePath: 'src/missing.ts' },
      store,
    );
    expect(r.content[0]!.text).toContain('No symbols found');
  });

  it('should filter by symbolName', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'small',
      qualifiedName: 'small',
      filePath: 'src/a.ts',
    });
    const r = await refactorSuggestionTool.handler({ projectId: 'p', symbolName: 'small' }, store);
    expect(r.metadata!['suggestionCount']!).toBe(0);
    expect(r.content[0]!.text).toContain('No refactoring opportunities');
  });
});
