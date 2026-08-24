// @code-analyzer/mcp — Documentation Generation Tool Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import docGenerationTool from '../tools/doc-generation.js';

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
    name: 'fetchData',
    qualifiedName: 'fetchData',
    filePath: 'src/api.ts',
  });
  const cId = insertNode(store, {
    projectId: 'test-project',
    label: 'Class',
    name: 'DataService',
    qualifiedName: 'DataService',
    filePath: 'src/api.ts',
  });
  const dId = insertNode(store, {
    projectId: 'test-project',
    label: 'Function',
    name: 'makeRequest',
    qualifiedName: 'makeRequest',
    filePath: 'src/http.ts',
  });
  insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: fId, targetId: dId });
  return store;
}

describe('docGenerationTool', () => {
  it('should have correct name', () => {
    expect(docGenerationTool.name).toBe('doc_generation');
  });
  it('should support doc styles', () => {
    const e = (docGenerationTool.inputSchema.properties.style as Record<string, unknown>)
      .enum as string[];
    expect(e).toContain('jsdoc');
    expect(e).toContain('docstring');
    expect(e).toContain('godoc');
  });
  it('should have callable handler', () => {
    expect(typeof docGenerationTool.handler).toBe('function');
  });
  it('should return error with no store', async () => {
    const r = await docGenerationTool.handler({ projectId: 'test-project' });
    expect(r.isError).toBe(true);
  });
  it('should generate JSDoc', async () => {
    const r = await docGenerationTool.handler(
      { projectId: 'test-project', style: 'jsdoc', maxResults: 10 },
      createStoreWithData(),
    );
    expect(r.content[0].text).toContain('Documentation Generation');
    expect(r.metadata.style).toBe('jsdoc');
  });
  it('should generate docstring', async () => {
    const r = await docGenerationTool.handler(
      { projectId: 'test-project', style: 'docstring', maxResults: 10 },
      createStoreWithData(),
    );
    expect(r.metadata.style).toBe('docstring');
  });
  it('should generate godoc', async () => {
    const r = await docGenerationTool.handler(
      { projectId: 'test-project', style: 'godoc', maxResults: 10 },
      createStoreWithData(),
    );
    expect(r.metadata.style).toBe('godoc');
  });
  it('should return empty for no symbols', async () => {
    const r = await docGenerationTool.handler(
      { projectId: 'test-project' },
      new InMemoryGraphStore(),
    );
    expect(r.content[0].text).toContain('No documentable symbols');
  });
  it('should respect maxResults', async () => {
    const r = await docGenerationTool.handler(
      { projectId: 'test-project', maxResults: 1 },
      createStoreWithData(),
    );
    expect(r.metadata.docCount).toBeLessThanOrEqual(1);
  });

  it('should generate docstring for Python files', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'parse',
      qualifiedName: 'parse',
      filePath: 'src/parse.py',
    });
    const r = await docGenerationTool.handler({ projectId: 'p' }, store);
    expect(r.content[0].text).toContain('python');
    expect(r.content[0].text).toContain('Args:');
  });

  it('should generate godoc for Go files', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'Run',
      qualifiedName: 'Run',
      filePath: 'main.go',
    });
    const r = await docGenerationTool.handler({ projectId: 'p' }, store);
    expect(r.content[0].text).toContain('// Run is a function');
  });

  it('should detect Java language for .java files', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Class',
      name: 'Service',
      qualifiedName: 'Service',
      filePath: 'src/Service.java',
    });
    const r = await docGenerationTool.handler({ projectId: 'p' }, store);
    expect(r.content[0].text).toContain('java');
  });

  it('should include @example for Class symbols', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Class',
      name: 'Widget',
      qualifiedName: 'Widget',
      filePath: 'src/widget.ts',
    });
    const r = await docGenerationTool.handler({ projectId: 'p' }, store);
    expect(r.content[0].text).toContain('@example');
    expect(r.content[0].text).toContain('new Widget');
  });

  it('should filter by symbolName and filePath', async () => {
    const store = createStoreWithData();
    const byName = await docGenerationTool.handler(
      { projectId: 'test-project', symbolName: 'fetchData' },
      store,
    );
    expect(byName.metadata.docCount).toBe(1);

    const byFile = await docGenerationTool.handler(
      { projectId: 'test-project', filePath: 'src/http.ts' },
      store,
    );
    expect(byFile.metadata.docCount).toBe(1);
    expect(byFile.content[0].text).toContain('makeRequest');
  });

  it('should handle a node without filePath', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'orphan',
      qualifiedName: 'orphan',
      filePath: null,
    });
    const r = await docGenerationTool.handler({ projectId: 'p' }, store);
    expect(r.metadata.docCount).toBe(1);
    expect(r.content[0].text).toContain('<unknown>');
  });

  it('should render empty docs for maxResults 0', async () => {
    const r = await docGenerationTool.handler(
      { projectId: 'test-project', maxResults: 0 },
      createStoreWithData(),
    );
    expect(r.content[0].text).toContain('No documentable symbols');
  });
});
