// @code-analyzer/mcp — Hotspot Detection Tool Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import hotspotDetectionTool from '../tools/hotspot-detection.js';

function createStoreWithData(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();

  insertNode(store, {
    projectId: 'test-project',
    label: 'Project',
    name: 'TestProject',
    qualifiedName: 'TestProject',
  });
  const fileId = insertNode(store, {
    projectId: 'test-project',
    label: 'File',
    name: 'index.ts',
    qualifiedName: 'src/index.ts',
    filePath: 'src/index.ts',
  });
  const funcId = insertNode(store, {
    projectId: 'test-project',
    label: 'Function',
    name: 'processRequest',
    qualifiedName: 'processRequest',
    filePath: 'src/index.ts',
  });
  const func2Id = insertNode(store, {
    projectId: 'test-project',
    label: 'Method',
    name: 'validate',
    qualifiedName: 'validate',
    filePath: 'src/index.ts',
  });

  for (let i = 0; i < 20; i++) {
    const calleeId = insertNode(store, {
      projectId: 'test-project',
      label: 'Function',
      name: `helper${i}`,
      qualifiedName: `helper${i}`,
      filePath: 'src/index.ts',
    });
    insertEdge(store, {
      projectId: 'test-project',
      type: 'CALLS',
      sourceId: funcId,
      targetId: calleeId,
    });
  }

  insertEdge(store, {
    projectId: 'test-project',
    type: 'CALLS',
    sourceId: func2Id,
    targetId: fileId,
  });
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
      { projectId: 'test-project', threshold: 10, maxResults: 20 },
      emptyStore,
    );
    expect(result.content[0].text).toContain('No hotspots detected');
    expect(result.metadata.hotspotCount).toBe(0);
  });

  it('should detect hotspots from graph data', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 5, maxResults: 20 },
      store,
    );
    expect(result.metadata.hotspotCount).toBeGreaterThan(0);
    expect(result.content[0].text).toContain('processRequest');
  });

  it('should filter by threshold', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 100, maxResults: 20 },
      store,
    );
    expect(result.metadata.hotspotCount).toBe(0);
  });

  it('should respect maxResults', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: 1, maxResults: 1 },
      store,
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
      { projectId: 'test-project', threshold: 5, maxResults: 20 },
      store,
    );
    expect(result.content[0].text).toContain('Hotspot Analysis');
  });

  // The report emits one recommendation per non-zero risk level, and the tiering has three
  // bands (>=30 high, >=15 medium, else low). Existing fixtures produced high and medium only,
  // and always with a file path — so the `low` band, the `<unknown>` fallback, the 🟡/🟢 icons
  // and the zero side of two of the three "count > 0" guards had never been taken.
  it('should classify all three risk levels and only recommend the non-empty ones', async () => {
    function storeWith(outgoingCounts: number[]): InMemoryGraphStore {
      const store = new InMemoryGraphStore();
      outgoingCounts.forEach((calls, i) => {
        // no `filePath` on purpose — that is the `<unknown>` arm
        const fn = insertNode(store, {
          projectId: 'quiet',
          label: 'Function',
          name: `fn${i}`,
          qualifiedName: `fn${i}`,
        });
        for (let k = 0; k < calls; k++) {
          const callee = insertNode(store, {
            projectId: 'quiet',
            label: 'Function',
            name: `c${i}_${k}`,
            qualifiedName: `c${i}_${k}`,
          });
          insertEdge(store, {
            projectId: 'quiet',
            type: 'CALLS',
            sourceId: fn,
            targetId: callee,
          });
        }
      });
      return store;
    }

    // one hotspot per band: 30 → high, 20 → medium, 12 → low
    const mixed = await hotspotDetectionTool.handler(
      { projectId: 'quiet', threshold: 10 },
      storeWith([30, 20, 12]),
    );
    const mixedText = mixed.content[0]!.text;
    expect(mixedText).toContain('🔴');
    expect(mixedText).toContain('🟡');
    expect(mixedText).toContain('🟢');
    expect(mixedText).toContain('<unknown>');
    expect(mixedText).toContain('high-risk hotspots');
    expect(mixedText).toContain('medium-risk areas');
    expect(mixedText).toContain('low-risk symbols');

    // a high-only report must not recommend the bands it has none of
    const highOnly = await hotspotDetectionTool.handler(
      { projectId: 'quiet', threshold: 10 },
      storeWith([30]),
    );
    expect(highOnly.content[0]!.text).toContain('high-risk hotspots');
    expect(highOnly.content[0]!.text).not.toContain('medium-risk areas');
    expect(highOnly.content[0]!.text).not.toContain('low-risk symbols');

    // and a low-only report must not recommend the louder ones
    const lowOnly = await hotspotDetectionTool.handler(
      { projectId: 'quiet', threshold: 10 },
      storeWith([12]),
    );
    expect(lowOnly.content[0]!.text).toContain('low-risk symbols');
    expect(lowOnly.content[0]!.text).not.toContain('high-risk hotspots');
    expect(lowOnly.content[0]!.text).not.toContain('medium-risk areas');
  });

  it('should handle null threshold and maxResults', async () => {
    const store = createStoreWithData();
    const result = await hotspotDetectionTool.handler(
      { projectId: 'test-project', threshold: null, maxResults: null },
      store,
    );
    expect(result.metadata.threshold).toBe(10);
  });
});
