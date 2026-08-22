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
});
