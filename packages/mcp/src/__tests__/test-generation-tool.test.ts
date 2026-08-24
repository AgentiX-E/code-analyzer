// @code-analyzer/mcp — Test Generation Tool Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import testGenerationTool from '../tools/test-generation.js';

function createStoreWithData(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  insertNode(store, {
    projectId: 'test-project',
    label: 'Project',
    name: 'Test',
    qualifiedName: 'Test',
  });
  const fId = insertNode(store, {
    projectId: 'test-project',
    label: 'Function',
    name: 'calc',
    qualifiedName: 'calc',
    filePath: 'src/math.ts',
  });
  const mId = insertNode(store, {
    projectId: 'test-project',
    label: 'Method',
    name: 'getUser',
    qualifiedName: 'getUser',
    filePath: 'src/api.ts',
  });
  const dId = insertNode(store, {
    projectId: 'test-project',
    label: 'Function',
    name: 'validate',
    qualifiedName: 'validate',
    filePath: 'src/utils.ts',
  });
  insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: fId, targetId: dId });
  insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: mId, targetId: dId });
  return store;
}

describe('testGenerationTool', () => {
  it('should have correct name', () => {
    expect(testGenerationTool.name).toBe('test_generation');
  });
  it('should support frameworks', () => {
    const e = (testGenerationTool.inputSchema.properties.framework as Record<string, unknown>)
      .enum as string[];
    expect(e).toContain('vitest');
    expect(e).toContain('jest');
    expect(e).toContain('pytest');
    expect(e).toContain('go-test');
  });
  it('should have callable handler', () => {
    expect(typeof testGenerationTool.handler).toBe('function');
  });
  it('should return error with no store', async () => {
    const r = await testGenerationTool.handler({ projectId: 'test-project' });
    expect(r.isError).toBe(true);
  });
  it('should generate vitest tests', async () => {
    const r = await testGenerationTool.handler(
      { projectId: 'test-project', framework: 'vitest', maxTests: 10 },
      createStoreWithData(),
    );
    expect(r.content[0].text).toContain('describe');
    expect(r.metadata.framework).toBe('vitest');
  });
  it('should generate jest tests', async () => {
    const r = await testGenerationTool.handler(
      { projectId: 'test-project', framework: 'jest', maxTests: 10 },
      createStoreWithData(),
    );
    expect(r.metadata.framework).toBe('jest');
  });
  it('should generate pytest tests', async () => {
    const r = await testGenerationTool.handler(
      { projectId: 'test-project', framework: 'pytest', maxTests: 10 },
      createStoreWithData(),
    );
    expect(r.metadata.framework).toBe('pytest');
  });
  it('should generate go-test tests', async () => {
    const r = await testGenerationTool.handler(
      { projectId: 'test-project', framework: 'go-test', maxTests: 10 },
      createStoreWithData(),
    );
    expect(r.metadata.framework).toBe('go-test');
  });
  it('should return empty for store with no functions', async () => {
    const r = await testGenerationTool.handler(
      { projectId: 'test-project' },
      new InMemoryGraphStore(),
    );
    expect(r.content[0].text).toContain('No testable symbols found');
  });
  it('should respect maxTests', async () => {
    const r = await testGenerationTool.handler(
      { projectId: 'test-project', maxTests: 1 },
      createStoreWithData(),
    );
    expect(r.metadata.skeletonCount).toBeLessThanOrEqual(1);
  });

  it('should generate Python pytest code for .py files', async () => {
    const store = new InMemoryGraphStore();
    const fId = insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: 'handle_request',
      qualifiedName: 'handle_request',
      filePath: 'src/handler.py',
    });
    const dId = insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: 'db_query',
      qualifiedName: 'db_query',
      filePath: 'src/db.py',
    });
    insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: fId, targetId: dId });

    const r = await testGenerationTool.handler({ projectId: 'test-project' }, store);
    const text = r.content[0].text;
    expect(text).toContain('import pytest');
    expect(text).toContain('from unittest.mock import patch');
  });

  it('should generate Go test code for .go files', async () => {
    const store = new InMemoryGraphStore();
    const fId = insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: 'ServeHTTP',
      qualifiedName: 'ServeHTTP',
      filePath: 'main.go',
    });
    const dId = insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: 'store',
      qualifiedName: 'store',
      filePath: 'store.go',
    });
    insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: fId, targetId: dId });

    const r = await testGenerationTool.handler({ projectId: 'test-project' }, store);
    const text = r.content[0].text;
    expect(text).toContain('package main');
    expect(text).toContain('func TestServeHTTP');
  });

  it('should detect JavaScript language for .js files', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: 'render',
      qualifiedName: 'render',
      filePath: 'src/view.js',
    });
    const r = await testGenerationTool.handler({ projectId: 'test-project' }, store);
    expect(r.content[0].text).toContain('javascript');
  });

  it('should filter by symbolName', async () => {
    const store = createStoreWithData();
    const r = await testGenerationTool.handler(
      { projectId: 'test-project', symbolName: 'calc' },
      store,
    );
    expect(r.metadata.skeletonCount).toBe(1);
    expect(r.content[0].text).toContain('calc');
  });

  it('should filter by filePath', async () => {
    const store = createStoreWithData();
    const r = await testGenerationTool.handler(
      { projectId: 'test-project', filePath: 'src/math.ts' },
      store,
    );
    expect(r.metadata.skeletonCount).toBe(1);
  });

  it('should handle nodes without a filePath', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: 'orphan',
      qualifiedName: 'orphan',
      filePath: null,
    });
    const r = await testGenerationTool.handler({ projectId: 'test-project' }, store);
    // The null filePath is tolerated (falls back to typescript skeleton).
    expect(r.metadata.skeletonCount).toBe(1);
    expect(r.content[0].text).toContain('orphan');
  });
});
