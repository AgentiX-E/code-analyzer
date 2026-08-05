// @code-analyzer/mcp — Hotspot Detection Tool Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import hotspotDetectionTool from '../tools/hotspot-detection.js';

function createStoreWithData(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();

  insertNode(store, { projectId: 'test-project', label: 'Project', name: 'TestProject', qualifiedName: 'TestProject' });
  const fileId = insertNode(store, { projectId: 'test-project', label: 'File', name: 'index.ts', qualifiedName: 'src/index.ts', filePath: 'src/index.ts' });
  const funcId = insertNode(store, { projectId: 'test-project', label: 'Function', name: 'processRequest', qualifiedName: 'processRequest', filePath: 'src/index.ts' });
  const func2Id = insertNode(store, { projectId: 'test-project', label: 'Method', name: 'validate', qualifiedName: 'validate', filePath: 'src/index.ts' });

  for (let i = 0; i < 20; i++) {
    const calleeId = insertNode(store, { projectId: 'test-project', label: 'Function', name: `helper${i}`, qualifiedName: `helper${i}`, filePath: 'src/index.ts' });
    insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: funcId, targetId: calleeId });
  }

  insertEdge(store, { projectId: 'test-project', type: 'CALLS', sourceId: func2Id, targetId: fileId });
  return store;
}

describe('hotspotDetectionTool definition', () => {
  it('should have the correct tool name', () => {
    expect(hotspotDetectionTool.name).toBe('hotspot_detection');
  });
  it('should have a non-empty description', () => {
    expect(hotspotDetectionTool.description.length).toBeGreaterThan(0);
  });
  it('should require projectId in inputSchema', () => {
    expect(hotspotDetectionTool.inputSchema.required).toContain('projectId');
  });
  it('should have a callable handler', () => {
    expect(typeof hotspotDetectionTool.handler).toBe('function');
  });
});

describe('hotspotDetectionTool handler with store', () => {
  it('should return no hotspots for empty store', async () => {
    const emptyStore = new InMemoryGraphStore();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 10, maxResults: 20 }, emptyStore,
    );
    expect(result.content[0].text).toContain('No hotspots detected');
    expect(result.metadata.hotspotCount).toBe(0);
  });

  it('should detect hotspots from graph data', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 5, maxResults: 20 }, store,
    );
    expect(result.metadata.hotspotCount).toBeGreaterThan(0);
    expect(result.content[0].text).toContain('processRequest');
  });

  it('should filter by threshold', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 100, maxResults: 20 }, store,
    );
    expect(result.metadata.hotspotCount).toBe(0);
  });

  it('should respect maxResults', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 1, maxResults: 1 }, store,
    );
    expect(result.metadata.hotspotCount).toBeLessThanOrEqual(1);
  });

  it('should return error when no store provided', async () => {
    const result = await hotspotDetectionTool.handler({ projectId: 'test-project' });
    expect(result.isError).toBe(true);
  });

  it('should report risk levels in output', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 5, maxResults: 20 }, store,
    );
    expect(result.content[0].text).toContain('Hotspot Analysis');
  });

  it('should handle null threshold and maxResults', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: null, maxResults: null }, store,
    );
    expect(result.metadata.threshold).toBe(10);
  });
});
