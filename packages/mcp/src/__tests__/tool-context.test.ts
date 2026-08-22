// @ts-nocheck
// @code-analyzer/mcp — ToolContext Tests

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';

describe('ToolContextImpl', () => {
  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  describe('isToolContext', () => {
    it('should return true for ToolContextImpl instances', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      expect(ToolContextImpl.isToolContext(ctx)).toBe(true);
    });

    it('should return false for non-object values', () => {
      expect(ToolContextImpl.isToolContext(null)).toBe(false);
      expect(ToolContextImpl.isToolContext(undefined)).toBe(false);
      expect(ToolContextImpl.isToolContext(42)).toBe(false);
      expect(ToolContextImpl.isToolContext('string')).toBe(false);
    });

    it('should return false for objects without store/getSearchEngine', () => {
      expect(ToolContextImpl.isToolContext({})).toBe(false);
      expect(ToolContextImpl.isToolContext({ store: 'fake' })).toBe(false);
    });

    it('should return false when getSearchEngine is not a function', () => {
      expect(
        ToolContextImpl.isToolContext({
          store: {},
          getSearchEngine: 'not-a-function',
        }),
      ).toBe(false);
    });
  });

  describe('getStore', () => {
    it('should return store when passed InMemoryGraphStore directly', () => {
      const store = new InMemoryGraphStore();
      expect(ToolContextImpl.getStore(store)).toBe(store);
    });

    it('should return store from ToolContext', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      expect(ToolContextImpl.getStore(ctx)).toBe(store);
    });

    it('should return null for unknown values', () => {
      expect(ToolContextImpl.getStore(null)).toBeNull();
      expect(ToolContextImpl.getStore(undefined)).toBeNull();
      expect(ToolContextImpl.getStore({})).toBeNull();
      expect(ToolContextImpl.getStore(42)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Graph stats
  // -------------------------------------------------------------------------

  describe('getGraphStats', () => {
    it('should return stats with label and edge distributions', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const stats = ctx.getGraphStats('empty-project');
      expect(stats.projectId).toBe('empty-project');
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.labelDistribution).toEqual([]);
      expect(stats.relationshipDistribution).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // File symbols
  // -------------------------------------------------------------------------

  describe('getFileSymbols', () => {
    it('should return empty array for non-existent project/file', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const symbols = ctx.getFileSymbols('unknown', '/nonexistent.ts');
      expect(symbols).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Find references
  // -------------------------------------------------------------------------

  describe('findReferences', () => {
    it('should return empty array for non-existent symbol', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const refs = ctx.findReferences('test', 'nonexistent.Symbol');
      expect(refs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Dependency tree
  // -------------------------------------------------------------------------

  describe('getDependencyTree', () => {
    it('should return null for non-existent symbol', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const tree = ctx.getDependencyTree('test', 'nonexistent.Symbol');
      expect(tree).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Lazy initialization getters
  // -------------------------------------------------------------------------

  describe('lazy getters', () => {
    it('should lazily initialize search engine', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const engine = ctx.getSearchEngine();
      expect(engine).toBeDefined();
      // Second call returns cached instance
      expect(ctx.getSearchEngine()).toBe(engine);
    });

    it('should lazily initialize review engine', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const engine = ctx.getReviewEngine();
      expect(engine).toBeDefined();
      expect(ctx.getReviewEngine()).toBe(engine);
    });

    it('should lazily initialize PR review engine', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const engine = ctx.getPRReviewEngine();
      expect(engine).toBeDefined();
    });

    it('should lazily initialize impact analyzer', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const analyzer = ctx.getImpactAnalyzer();
      expect(analyzer).toBeDefined();
    });

    it('should lazily initialize repo group manager', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const manager = ctx.getRepoGroupManager();
      expect(manager).toBeDefined();
      expect(ctx.getRepoGroupManager()).toBe(manager);
    });

    it('should lazily initialize federated search', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const search = ctx.getFederatedSearch();
      expect(search).toBeDefined();
    });

    it('should lazily initialize cross-repo indexer', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const indexer = ctx.getCrossRepoIndexer();
      expect(indexer).toBeDefined();
    });

    it('should lazily initialize cross-repo PR review engine', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const engine = ctx.getCrossRepoPRReviewEngine();
      expect(engine).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // currentAnalysis property
  // -------------------------------------------------------------------------

  describe('currentAnalysis', () => {
    it('should be undefined by default', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      expect(ctx.currentAnalysis).toBeUndefined();
    });

    it('should be assignable', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const mockResult = { success: true, duration: 100 } as any;
      ctx.currentAnalysis = mockResult;
      expect(ctx.currentAnalysis).toBe(mockResult);
    });
  });

  // -------------------------------------------------------------------------
  // store property
  // -------------------------------------------------------------------------

  describe('store property', () => {
    it('should expose the store passed to constructor', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      expect(ctx.store).toBe(store);
    });
  });
});
