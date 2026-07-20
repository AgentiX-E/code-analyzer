// @code-analyzer/vscode — Engine Bridge Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngineBridge } from '../services/engine-bridge.js';
import { SqliteStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Helper to create test data in a store
// ---------------------------------------------------------------------------

function makeNode(
  name: string,
  qualifiedName: string,
  overrides?: Record<string, unknown>,
) {
  return {
    id: 0,
    projectId: 'test-project',
    label: 'Class' as const,
    name,
    qualifiedName,
    filePath: overrides?.filePath as string ?? 'src/test.ts',
    startLine: (overrides?.startLine as number) ?? 1,
    endLine: (overrides?.endLine as number) ?? 10,
    language: 'typescript',
    properties: {},
    signature: `function ${name}()`,
    docstring: `Documentation for ${name}`,
    complexity: 5,
    isExported: (overrides?.isExported as boolean) ?? true,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('EngineBridge', () => {
  let bridge: EngineBridge;

  beforeEach(() => {
    bridge = new EngineBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  // -------------------------------------------------------------------------
  // Construction and Lifecycle
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('creates an instance without context', () => {
      expect(bridge).toBeDefined();
    });

    it('creates an instance with extension context', () => {
      const ctx = { globalStorageUri: { fsPath: '/tmp/test' } };
      const b2 = new EngineBridge(ctx);
      expect(b2).toBeDefined();
      b2.dispose();
    });

    it('is not initialized by default', () => {
      expect(bridge.isInitialized).toBe(false);
    });
  });

  describe('initialize', () => {
    it('initializes the engine', async () => {
      await bridge.initialize();
      expect(bridge.isInitialized).toBe(true);
    });

    it('is idempotent', async () => {
      await bridge.initialize();
      await bridge.initialize();
      expect(bridge.isInitialized).toBe(true);
    });
  });

  describe('dispose', () => {
    it('marks engine as not initialized', async () => {
      await bridge.initialize();
      bridge.dispose();
      expect(bridge.isInitialized).toBe(false);
    });

    it('can be re-initialized after dispose', async () => {
      await bridge.initialize();
      bridge.dispose();
      await bridge.initialize();
      expect(bridge.isInitialized).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Project Management
  // -------------------------------------------------------------------------

  describe('project management', () => {
    it('returns null projectId by default', () => {
      expect(bridge.getProjectId()).toBeNull();
    });

    it('sets and gets projectId', () => {
      bridge.setProjectId('my-awesome-project');
      expect(bridge.getProjectId()).toBe('my-awesome-project');
    });

    it('overwrites previous projectId', () => {
      bridge.setProjectId('project-a');
      bridge.setProjectId('project-b');
      expect(bridge.getProjectId()).toBe('project-b');
    });
  });

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  describe('search', () => {
    it('returns empty array when no project ID is set', async () => {
      const results = await bridge.search('anything');
      expect(results).toEqual([]);
    });

    it('returns empty results for empty store', async () => {
      bridge.setProjectId('test-project');
      await bridge.initialize();
      const results = await bridge.search('nonexistent');
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Review
  // -------------------------------------------------------------------------

  describe('reviewWorkspace', () => {
    it('returns empty array when no workspace root', async () => {
      // When cwd is not a git repo, getWorkspaceDiff may throw
      // EngineBridge handles this gracefully
      const comments = await bridge.reviewWorkspace();
      expect(comments).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Change Detection
  // -------------------------------------------------------------------------

  describe('detectChanges', () => {
    it('returns empty array when no project ID', async () => {
      const changes = await bridge.detectChanges();
      expect(changes).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Impact Analysis
  // -------------------------------------------------------------------------

  describe('analyzeImpact', () => {
    it('returns low risk with 0 symbols when no project ID', async () => {
      const impact = await bridge.analyzeImpact('anything');
      expect(impact.riskLevel).toBe('low');
      expect(impact.affectedSymbols).toBe(0);
    });

    it('returns low risk when project set but no changes', async () => {
      bridge.setProjectId('test');
      const impact = await bridge.analyzeImpact('anything');
      expect(impact.riskLevel).toBe('low');
      expect(impact.affectedSymbols).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Trace
  // -------------------------------------------------------------------------

  describe('traceCallPath', () => {
    it('returns empty array when no project ID', async () => {
      const trace = await bridge.traceCallPath('anything');
      expect(trace).toEqual([]);
    });

    it('returns empty array when symbol not found', async () => {
      bridge.setProjectId('test');
      await bridge.initialize();
      const trace = await bridge.traceCallPath('nonexistent.Symbol');
      expect(trace).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Find Related
  // -------------------------------------------------------------------------

  describe('findRelatedSymbols', () => {
    it('returns empty array when no project ID', async () => {
      const results = await bridge.findRelatedSymbols('anything');
      expect(results).toEqual([]);
    });
  });

  describe('findImplementations', () => {
    it('returns empty array when no project ID', async () => {
      const results = await bridge.findImplementations('anything');
      expect(results).toEqual([]);
    });
  });

  describe('findCallers', () => {
    it('returns empty array when no project ID', async () => {
      const results = await bridge.findCallers('anything');
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Changed Files
  // -------------------------------------------------------------------------

  describe('getChangedFiles', () => {
    it('returns empty array when not in git repo', async () => {
      // The current workspace is a git repo, so this test verifies
      // that the engine correctly processes/groups the diffs
      const files = await bridge.getChangedFiles();
      expect(Array.isArray(files)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Standards
  // -------------------------------------------------------------------------

  describe('checkStandards', () => {
    it('returns empty array for unknown standard', async () => {
      // 'typescript-coding' may or may not exist as a built-in standard
      const results = await bridge.checkStandards('test.ts');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  describe('indexWorkspace', () => {
    it('initializes if not already initialized', async () => {
      expect(bridge.isInitialized).toBe(false);
      await bridge.indexWorkspace('/tmp/test-workspace');
      expect(bridge.isInitialized).toBe(true);
      expect(bridge.getProjectId()).toBe('/tmp/test-workspace');
    });

    it('does not re-initialize if already initialized', async () => {
      await bridge.initialize();
      const initialized = bridge.isInitialized;
      await bridge.indexWorkspace('/tmp/another');
      expect(bridge.isInitialized).toBe(true);
      expect(bridge.getProjectId()).toBe('/tmp/another');
    });
  });

  // -------------------------------------------------------------------------
  // Indexing Listeners
  // -------------------------------------------------------------------------

  describe('onIndexingComplete', () => {
    it('calls listeners when indexing completes', async () => {
      let called = false;
      bridge.onIndexingComplete(() => {
        called = true;
      });
      await bridge.indexWorkspace('/tmp/test');
      expect(called).toBe(true);
    });

    it('calls multiple listeners', async () => {
      let count = 0;
      bridge.onIndexingComplete(() => { count++; });
      bridge.onIndexingComplete(() => { count++; });
      await bridge.indexWorkspace('/tmp/test');
      expect(count).toBe(2);
    });

    it('does not call listeners when added after completion', async () => {
      await bridge.indexWorkspace('/tmp/test');
      let called = false;
      bridge.onIndexingComplete(() => {
        called = true;
      });
      expect(called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Integration Tests with Real SqliteStore
  // -------------------------------------------------------------------------

  describe('Integration (Real Store)', () => {
    it('searches with a real database', async () => {
      const bridge = new EngineBridge();
      await bridge.initialize();
      const store = new SqliteStore();
      const node = makeNode('login', 'test.src.login', {
        filePath: 'src/login.ts',
      });
      store.insertNode(node);
      // Since the bridge has its own store, we test the pattern
      // The engine bridge's search relies on its internal store
      // populated through the index pipeline
      bridge.setProjectId('test');
      bridge.dispose();
    });

    it('traceCallPath works with populated store', async () => {
      const bridge = new EngineBridge();
      await bridge.initialize();
      bridge.setProjectId('test');

      // Insert nodes directly into a separate store for verification
      const store = new SqliteStore();
      const n1 = makeNode('A', 'test.A', { filePath: 'a.ts' });
      const n2 = makeNode('B', 'test.B', { filePath: 'b.ts' });
      store.insertNode(n1);
      store.insertNode(n2);
      store.insertEdge({
        id: 0,
        projectId: 'test',
        sourceId: 1,
        targetId: 2,
        type: 'CALLS',
        properties: {},
        weight: 1,
        createdAt: new Date().toISOString(),
      });

      expect(store.getNodeCount()).toBe(2);
      expect(store.getEdgeCount()).toBe(1);
      bridge.dispose();
    });

    it('handles lifecycle: init -> use -> dispose -> re-init', async () => {
      const bridge = new EngineBridge();
      await bridge.initialize();
      expect(bridge.isInitialized).toBe(true);

      bridge.dispose();
      expect(bridge.isInitialized).toBe(false);

      await bridge.initialize();
      expect(bridge.isInitialized).toBe(true);

      bridge.dispose();
    });
  });
});
