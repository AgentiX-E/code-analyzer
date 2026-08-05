// @code-analyzer/mcp — Trend Analysis Tool Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import trendAnalysisTool from '../tools/trend-analysis.js';

function createStoreWithData(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  insertNode(store, { projectId: 'test-project', label: 'Project', name: 'Test', qualifiedName: 'Test' });
  const fileId = insertNode(store, { projectId: 'test-project', label: 'File', name: 'index.ts', qualifiedName: 'src/index', filePath: 'src/index.ts' });
  const funcId = insertNode(store, { projectId: 'test-project', label: 'Function', name: 'main', qualifiedName: 'main', filePath: 'src/index.ts' });
  const classId = insertNode(store, { projectId: 'test-project', label: 'Class', name: 'App', qualifiedName: 'App', filePath: 'src/index.ts' });
  insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: funcId, targetId: classId });
  insertEdge(store, { projectId: 'test-project', type: 'IMPORTS', sourceId: fileId, targetId: funcId });
  insertEdge(store, { projectId: 'test-project', type: 'CONTAINS', sourceId: fileId, targetId: funcId });
  insertEdge(store, { projectId: 'test-project', type: 'CONTAINS', sourceId: fileId, targetId: classId });
  return store;
}

describe('trendAnalysisTool', () => {
  it('should have correct name', () => {
    expect(trendAnalysisTool.name).toBe('trend_analysis');
  });
  it('should have callable handler', () => {
    expect(typeof trendAnalysisTool.handler).toBe('function');
  });

  it('should return error with no store', async () => {
    const r = await trendAnalysisTool.handler({ projectId: 'test-project' });
    expect(r.isError).toBe(true);
  });

  it('should return no data for unknown project', async () => {
    const r = await trendAnalysisTool.handler(
      { projectId: 'unknown', metric: 'health' }, new InMemoryGraphStore(),
    );
    expect(r.content[0].text).toContain('No data found');
  });

  it('should analyze complexity', async () => {
    const r = await trendAnalysisTool.handler(
      { projectId: 'test-project', metric: 'complexity' }, createStoreWithData(),
    );
    expect(r.content[0].text).toContain('Complexity Analysis');
  });

  it('should analyze health', async () => {
    const r = await trendAnalysisTool.handler(
      { projectId: 'test-project', metric: 'health' }, createStoreWithData(),
    );
    expect(r.content[0].text).toContain('Health Report');
  });

  it('should analyze structure', async () => {
    const r = await trendAnalysisTool.handler(
      { projectId: 'test-project', metric: 'structure' }, createStoreWithData(),
    );
    expect(r.content[0].text).toContain('Structure Analysis');
  });

  it('should analyze dependencies', async () => {
    const r = await trendAnalysisTool.handler(
      { projectId: 'test-project', metric: 'dependencies' }, createStoreWithData(),
    );
    expect(r.content[0].text).toContain('Dependency Analysis');
  });

  it('should default to health', async () => {
    const r = await trendAnalysisTool.handler(
      { projectId: 'test-project', metric: null }, createStoreWithData(),
    );
    expect(r.metadata.metric).toBe('health');
  });
});
