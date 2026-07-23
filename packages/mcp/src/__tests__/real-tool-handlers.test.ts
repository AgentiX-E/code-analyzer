// @ts-nocheck
// @code-analyzer/mcp — Real Tool Handler Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import { ToolRegistry } from '../tools/registry.js';
import { createToolRegistry } from '../tools/index.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Test Fixtures: Sample Graph Data
// ---------------------------------------------------------------------------

function createSampleGraph(store: InMemoryGraphStore, projectId: string): void {
  // Create sample nodes
  const nodes: GraphNode[] = [
    // File and Module nodes
    {
      id: 0, projectId, label: 'Module', name: 'core', qualifiedName: 'core',
      filePath: '/app/src/core', startLine: null, endLine: null, language: null,
      properties: {}, signature: null, docstring: null, complexity: null,
      isExported: true, fingerprint: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Interface
    {
      id: 0, projectId, label: 'Interface', name: 'IService', qualifiedName: 'core.IService',
      filePath: '/app/src/core/service.ts', startLine: 1, endLine: 10, language: 'typescript',
      properties: {}, signature: null, docstring: 'Service interface', complexity: null,
      isExported: true, fingerprint: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Class implementing interface
    {
      id: 0, projectId, label: 'Class', name: 'MyService', qualifiedName: 'core.MyService',
      filePath: '/app/src/core/my-service.ts', startLine: 1, endLine: 50, language: 'typescript',
      properties: { baseClasses: 'ServiceBase' }, signature: null, docstring: 'Main service',
      complexity: 15, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Method
    {
      id: 0, projectId, label: 'Method', name: 'doWork', qualifiedName: 'core.MyService.doWork',
      filePath: '/app/src/core/my-service.ts', startLine: 10, endLine: 30, language: 'typescript',
      properties: { signature: 'doWork(input: string): Promise<Result>' },
      signature: 'doWork(input: string): Promise<Result>', docstring: 'Processes work items',
      complexity: 8, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Another method
    {
      id: 0, projectId, label: 'Method', name: 'validate', qualifiedName: 'core.MyService.validate',
      filePath: '/app/src/core/my-service.ts', startLine: 32, endLine: 48, language: 'typescript',
      properties: {}, signature: 'validate(data: unknown): boolean', docstring: null,
      complexity: 4, isExported: false, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Standalone function
    {
      id: 0, projectId, label: 'Function', name: 'fetchData', qualifiedName: 'core.fetchData',
      filePath: '/app/src/core/data.ts', startLine: 1, endLine: 25, language: 'typescript',
      properties: {}, signature: 'fetchData(url: string): Promise<Data>', docstring: 'Fetches data from API',
      complexity: 5, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Test node
    {
      id: 0, projectId, label: 'Test', name: 'testDoWork', qualifiedName: 'core.testDoWork',
      filePath: '/app/src/core/__tests__/my-service.test.ts', startLine: 1, endLine: 20, language: 'typescript',
      properties: {}, signature: null, docstring: null, complexity: null,
      isExported: false, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // High complexity function
    {
      id: 0, projectId, label: 'Function', name: 'complexFn', qualifiedName: 'core.complexFn',
      filePath: '/app/src/core/complex.ts', startLine: 1, endLine: 120, language: 'typescript',
      properties: {}, signature: 'complexFn(): void', docstring: null,
      complexity: 35, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Route node
    {
      id: 0, projectId, label: 'Route', name: 'getItems', qualifiedName: 'routes.getItems',
      filePath: '/app/src/routes/items.ts', startLine: 5, endLine: 15, language: 'typescript',
      properties: { routePath: '/api/items', routeMethod: 'GET' }, signature: null,
      docstring: 'Get items endpoint', complexity: null, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Folder node
    {
      id: 0, projectId, label: 'Folder', name: 'src', qualifiedName: 'src',
      filePath: '/app/src', startLine: null, endLine: null, language: null,
      properties: {}, signature: null, docstring: null, complexity: null,
      isExported: false, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ];

  store.insertNodes(nodes);

  // Get the actual IDs that were assigned
  const allInserted = store.getAllNodes().filter(n => n.projectId === projectId);

  const modules = allInserted.filter(n => n.label === 'Module');
  const interfaces = allInserted.filter(n => n.label === 'Interface');
  const classes = allInserted.filter(n => n.label === 'Class');
  const methods = allInserted.filter(n => n.label === 'Method');
  const functions = allInserted.filter(n => n.label === 'Function');
  const tests = allInserted.filter(n => n.label === 'Test');
  const routes = allInserted.filter(n => n.label === 'Route');

  const moduleNode = modules[0];
  const ifaceNode = interfaces[0];
  const classNode = classes[0];
  const doWorkMethod = methods.find(n => n.name === 'doWork');
  const validateMethod = methods.find(n => n.name === 'validate');
  const fetchDataFn = functions.find(n => n.name === 'fetchData');
  const complexFn = functions.find(n => n.name === 'complexFn');
  const testNode = tests[0];
  const routeNode = routes[0];

  // Create edges
  if (moduleNode && classNode) {
    store.insertEdge({
      id: 0, projectId, sourceId: moduleNode.id, targetId: classNode.id,
      type: 'DEFINES', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  if (classNode && ifaceNode) {
    store.insertEdge({
      id: 0, projectId, sourceId: classNode.id, targetId: ifaceNode.id,
      type: 'IMPLEMENTS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  if (classNode && doWorkMethod) {
    store.insertEdge({
      id: 0, projectId, sourceId: classNode.id, targetId: doWorkMethod.id,
      type: 'HAS_METHOD', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  if (classNode && validateMethod) {
    store.insertEdge({
      id: 0, projectId, sourceId: classNode.id, targetId: validateMethod.id,
      type: 'HAS_METHOD', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  if (doWorkMethod && fetchDataFn) {
    store.insertEdge({
      id: 0, projectId, sourceId: doWorkMethod.id, targetId: fetchDataFn.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  if (validateMethod && doWorkMethod) {
    store.insertEdge({
      id: 0, projectId, sourceId: validateMethod.id, targetId: doWorkMethod.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  if (testNode && doWorkMethod) {
    store.insertEdge({
      id: 0, projectId, sourceId: testNode.id, targetId: doWorkMethod.id,
      type: 'TESTS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  // FetchData also calls the route handler
  if (fetchDataFn && routeNode && doWorkMethod) {
    // Route handled by doWork and called by fetchData
    store.insertEdge({
      id: 0, projectId, sourceId: doWorkMethod.id, targetId: routeNode.id,
      type: 'HANDLES_ROUTE', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }

  if (moduleNode && fetchDataFn) {
    store.insertEdge({
      id: 0, projectId, sourceId: moduleNode.id, targetId: fetchDataFn.id,
      type: 'DEFINES', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
}

function createTestContext(projectId: string = 'test-project'): ToolContextImpl {
  const store = new InMemoryGraphStore();
  createSampleGraph(store, projectId);
  return new ToolContextImpl(store);
}

// ---------------------------------------------------------------------------
// Tests: ToolContext
// ---------------------------------------------------------------------------

describe('ToolContext', () => {
  describe('ToolContextImpl', () => {
    it('should create a context with a store', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      expect(ctx.store).toBe(store);
    });

    it('should lazily initialize search engine', () => {
      const store = new InMemoryGraphStore();
      const ctx = new ToolContextImpl(store);
      const engine = ctx.getSearchEngine();
      expect(engine).toBeDefined();
      expect(engine.documentCount).toBe(0);

      // Add a document and verify it's indexed in the cached engine
      store.insertNode({
        id: 0, projectId: 'test', label: 'Function', name: 'foo',
        qualifiedName: 'foo', filePath: '/foo.ts', startLine: 1, endLine: 10,
        language: 'typescript', properties: {}, signature: null, docstring: null,
        complexity: null, isExported: false, fingerprint: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });

      const engine2 = ctx.getSearchEngine(); // Should return same instance
      expect(engine).toBe(engine2); // Lazy singletons

      // Re-initialize to re-index
      engine2.initialize();
      expect(engine2.documentCount).toBeGreaterThan(0);
    });

    it('should lazily initialize review engine', () => {
      const ctx = createTestContext();
      const reviewEngine = ctx.getReviewEngine();
      expect(reviewEngine).toBeDefined();

      // Same instance on second call
      expect(ctx.getReviewEngine()).toBe(reviewEngine);
    });

    it('should lazily initialize impact analyzer', () => {
      const ctx = createTestContext();
      const analyzer = ctx.getImpactAnalyzer();
      expect(analyzer).toBeDefined();
      expect(ctx.getImpactAnalyzer()).toBe(analyzer);
    });

    it('should lazily initialize pipeline orchestrator', async () => {
      const ctx = createTestContext();
      const pipeline = await ctx.getPipeline();
      expect(pipeline).toBeDefined();

      // Same instance on second call
      expect(await ctx.getPipeline()).toBe(pipeline);
    });

    it('should get graph stats', () => {
      const ctx = createTestContext();
      const stats = ctx.getGraphStats('test-project');

      expect(stats.nodeCount).toBeGreaterThan(0);
      expect(stats.edgeCount).toBeGreaterThan(0);
      expect(stats.labelDistribution.length).toBeGreaterThan(0);
      expect(stats.relationshipDistribution.length).toBeGreaterThan(0);
      expect(stats.projectId).toBe('test-project');
    });

    it('should get file symbols', () => {
      const ctx = createTestContext();
      const symbols = ctx.getFileSymbols('test-project', '/app/src/core/my-service.ts');
      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols.every(s => s.filePath === '/app/src/core/my-service.ts')).toBe(true);
    });

    it('should return empty array for unknown file', () => {
      const ctx = createTestContext();
      const symbols = ctx.getFileSymbols('test-project', '/nonexistent.ts');
      expect(symbols).toEqual([]);
    });

    it('should find references for a symbol', () => {
      const ctx = createTestContext();
      const refs = ctx.findReferences('test-project', 'core.MyService.doWork');
      expect(refs.length).toBeGreaterThan(0);
    });

    it('should return empty references for unknown symbol', () => {
      const ctx = createTestContext();
      const refs = ctx.findReferences('test-project', 'nonexistent.symbol');
      expect(refs).toEqual([]);
    });

    it('should get dependency tree', () => {
      const ctx = createTestContext();
      const tree = ctx.getDependencyTree('test-project', 'core.MyService.doWork', 3);
      expect(tree).toBeDefined();
      expect(tree!.node.name).toBe('doWork');
      expect(tree!.depth).toBe(0);
    });

    it('should return null for unknown symbol in dependency tree', () => {
      const ctx = createTestContext();
      const tree = ctx.getDependencyTree('test-project', 'nonexistent.symbol');
      expect(tree).toBeNull();
    });

    it('should detect ToolContext', () => {
      const ctx = createTestContext();
      expect(ToolContextImpl.isToolContext(ctx)).toBe(true);
      expect(ToolContextImpl.isToolContext({})).toBe(false);
      expect(ToolContextImpl.isToolContext(null)).toBe(false);

      const store = new InMemoryGraphStore();
      expect(ToolContextImpl.isToolContext(store)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Codebase Analysis Tools
// ---------------------------------------------------------------------------

describe('Codebase Analysis Tools', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('index_status returns real data from graph store', async () => {
    const result = await registry.execute('index_status', {
      projectId: 'test-project',
    }, ctx);

    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.nodeCount).toBeGreaterThan(0);
    expect(data.edgeCount).toBeGreaterThan(0);
    expect(data.status).toBe('ready');
    expect(data.labelDistribution).toBeDefined();
    expect(data.labelDistribution.length).toBeGreaterThan(0);
  });

  it('index_status handles empty project gracefully', async () => {
    const emptyCtx = new ToolContextImpl(new InMemoryGraphStore());
    const result = await registry.execute('index_status', {
      projectId: 'nonexistent',
    }, emptyCtx);

    const data = JSON.parse(result.content[0].text);
    expect(data.nodeCount).toBe(0);
    expect(data.edgeCount).toBe(0);
    expect(data.status).toBe('empty');
  });

  it('get_graph_schema returns label distribution', async () => {
    const result = await registry.execute('get_graph_schema', {
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.nodeLabels).toBeDefined();
    expect(data.nodeLabels.length).toBeGreaterThan(0);

    // Class should be one of the labels
    const hasClassLabel = data.nodeLabels.some((l: any) => l.label === 'Class');
    expect(hasClassLabel).toBe(true);

    // IMPLEMENTS should be a relationship type
    expect(data.relationshipTypes).toBeDefined();
    expect(data.relationshipTypes.length).toBeGreaterThan(0);
  });

  it('get_architecture returns project overview', async () => {
    const result = await registry.execute('get_architecture', {
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.nodeCount).toBeGreaterThan(0);
    expect(data.entryPoints).toBeDefined();
  });

  it('analyze_repository runs pipeline with path', async () => {
    const result = await registry.execute('analyze_repository', {
      path: '/app',
      projectId: 'test-analyze',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-analyze');
    expect(data.status).toBeDefined();
  });

  it('analyze_repository returns error for non-existent path', async () => {
    const result = await registry.execute('analyze_repository', {
      path: '/nonexistent/path/12345',
      projectId: 'test-bad',
    }, ctx);

    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Querying & Exploration Tools
// ---------------------------------------------------------------------------

describe('Querying & Exploration Tools', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('search_graph finds nodes by name', async () => {
    const result = await registry.execute('search_graph', {
      query: 'MyService',
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.some((item: any) => item.name === 'MyService')).toBe(true);
  });

  it('search_graph returns empty for no-match query', async () => {
    const result = await registry.execute('search_graph', {
      query: 'zzzz_nonexistent_query',
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('search_code uses hybrid search engine', async () => {
    const result = await registry.execute('search_code', {
      query: 'doWork',
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.items.length).toBeGreaterThan(0);
    const firstItem = data.items[0];
    expect(firstItem.searchMethod).toBeDefined();
    expect(typeof firstItem.searchMethod).toBe('string');
    expect(firstItem.searchMethod).toContain('search');
  });

  it('explore_symbol finds symbol with relationships', async () => {
    const result = await registry.execute('explore_symbol', {
      symbolName: 'core.MyService.doWork',
      projectId: 'test-project',
      includeRelationships: true,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.symbol).toBeDefined();
    expect(data.symbol!.name).toBe('doWork');
    expect(data.relationships.length).toBeGreaterThan(0);
    expect(data.calls.length).toBeGreaterThan(0);
  });

  it('explore_symbol returns file siblings', async () => {
    const result = await registry.execute('explore_symbol', {
      symbolName: 'core.MyService',
      projectId: 'test-project',
      includeRelationships: false,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.symbol).toBeDefined();
    expect(data.fileSymbols.length).toBeGreaterThan(0);
  });

  it('find_implementations finds interface implementations', async () => {
    const result = await registry.execute('find_implementations', {
      interfaceName: 'core.IService',
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.interface).toBeDefined();
    expect(data.interface!.name).toBe('IService');
    expect(data.implementations.length).toBeGreaterThan(0);
  });

  it('trace_call_path traces BFS path', async () => {
    const result = await registry.execute('trace_call_path', {
      sourceSymbol: 'core.MyService.doWork',
      projectId: 'test-project',
      maxDepth: 5,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.path.length).toBeGreaterThan(0);
    expect(data.found).toBe(true);
  });

  it('query_graph executes cypher queries', async () => {
    const result = await registry.execute('query_graph', {
      cypher: 'MATCH (n) RETURN n',
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.columns).toBeDefined();
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.executionTimeMs).toBeDefined();
  });

  it('query_graph returns error for invalid cypher', async () => {
    const result = await registry.execute('query_graph', {
      cypher: 'INVALID QUERY !!!',
    }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cypher query error');
  });
});

// ---------------------------------------------------------------------------
// Tests: Code Review Tools
// ---------------------------------------------------------------------------

describe('Code Review Tools', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('review_file returns graph-based analysis without content', async () => {
    const result = await registry.execute('review_file', {
      projectId: 'test-project',
      filePath: '/app/src/core/my-service.ts',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.filePath).toBe('/app/src/core/my-service.ts');
    expect(data.symbolsInFile).toBeGreaterThan(0);
  });

  it('review_file runs heuristics with content', async () => {
    const code = `
export class BadClass {
  doSomething() {}
  async fetch() {
    const response = await fetch('/api/data');
    const data = response.json();
  }
  processItems(items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i]) {
        if (items[i].valid) {
          if (items[i].nested) {
            if (items[i].nested.deep) {
              if (items[i].nested.deep.very_deep) {
                console.log(items[i]);
              }
            }
          }
        }
      }
    }
  }
}
`;

    const result = await registry.execute('review_file', {
      projectId: 'test-project',
      filePath: '/app/src/test.ts',
      content: code,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.hasContent).toBe(true);
    expect(data.comments).toBeDefined();
    expect(data.reviewMethod).toContain('Heuristics');
  });

  it('review_diff handles empty diff gracefully', async () => {
    const result = await registry.execute('review_diff', {
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);

    expect(data.projectId).toBe('test-project');
    expect(data.hasDiff).toBe(false);
  });

  it('review_diff analyzes complex functions from graph', async () => {
    // complexFn has complexity 35 > threshold
    const result = await registry.execute('review_diff', {
      projectId: 'test-project',
      severity: 'medium',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    // Should find the complex function
    const hasComplexityIssue = data.comments.some(
      (c: any) => c.path === '/app/src/core/complex.ts',
    );
    expect(hasComplexityIssue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: PR Review Tools
// ---------------------------------------------------------------------------

describe('PR Review Tools', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('review_pr returns graph-based analysis', async () => {
    const result = await registry.execute('review_pr', {
      projectId: 'test-project',
      prNumber: 42,
      baseRef: 'main',
      headRef: 'feature',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.prNumber).toBe(42);
    expect(data.summary).toBeDefined();
    expect(data.summary.riskLevel).toBeDefined();
    expect(data.metrics).toBeDefined();
    expect(data.reviewMethod).toContain('Graph-backed');
  });

  it('review_pr analyzes PR diff content', async () => {
    const diffContent = `diff --git a/src/core/complex.ts b/src/core/complex.ts
index abc123..def456 100644
--- a/src/core/complex.ts
+++ b/src/core/complex.ts
@@ -1,5 +1,15 @@
-export function complexFn(): void {
-  // simplified
+export function complexFn(): void {
+  // add risky change
+  const data = await fetch('/api/secret');
+  const result = eval(data);
+  console.log(result);
 }`;

    const result = await registry.execute('review_pr', {
      projectId: 'test-project',
      diff: diffContent,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.metrics.filesChanged).toBeGreaterThan(0);
  });

  it('check_standards validates project standards', async () => {
    const result = await registry.execute('check_standards', {
      projectId: 'test-project',
      filePath: '/app/src/core/my-service.ts',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.summary).toBeDefined();
    expect(data.results).toBeDefined();
    expect(data.complianceScore).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Change & Impact Tools
// ---------------------------------------------------------------------------

describe('Change & Impact Tools', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('impact_analysis with target symbol returns full impact tree', async () => {
    const result = await registry.execute('impact_analysis', {
      projectId: 'test-project',
      targetSymbol: 'core.MyService.doWork',
      fromRef: 'HEAD~1',
      toRef: 'HEAD',
      depth: 3,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.range).toBeDefined();
    expect(data.impactTree.length).toBeGreaterThan(0);
    expect(data.riskLevel).toBeDefined();
    expect(data.directDependents).toBeDefined();
    expect(data.indirectDependents).toBeDefined();
  });

  it('impact_analysis without target shows root symbols', async () => {
    const result = await registry.execute('impact_analysis', {
      projectId: 'test-project',
      fromRef: 'HEAD~1',
      toRef: 'HEAD',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.range).toBeDefined();
  });

  it('detect_changes returns graph-based change hints', async () => {
    const result = await registry.execute('detect_changes', {
      projectId: 'test-project',
      includeFiles: true,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.summary).toBeDefined();
    expect(data.detectionMethod).toContain('Graph-based');
  });

  it('route_map lists routes from the graph', async () => {
    const result = await registry.execute('route_map', {
      projectId: 'test-project',
      includeHandlers: true,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.routeCount).toBeGreaterThan(0);
    expect(data.routes.length).toBeGreaterThan(0);
    data.routes.forEach((r: any) => {
      expect(r.method).toBeDefined();
      expect(r.path).toBeDefined();
    });
  });

  it('check_cycles detects circular dependencies', async () => {
    const result = await registry.execute('check_cycles', {
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.cyclesFound).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Error Handling
// ---------------------------------------------------------------------------

describe('Error Handling', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('tools handle missing required arguments gracefully', async () => {
    const result = await registry.execute('analyze_repository', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });

  it('tools handle invalid cypher gracefully', async () => {
    const result = await registry.execute('query_graph', {
      cypher: 'INVALID SYNTAX !!!',
    }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cypher query error');
  });

  it('tools work with empty store (no graph data)', async () => {
    const emptyCtx = new ToolContextImpl(new InMemoryGraphStore());
    const result = await registry.execute('search_graph', {
      query: 'anything',
      projectId: 'empty',
    }, emptyCtx);

    const data = JSON.parse(result.content[0].text);
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
    expect(result.isError).toBeFalsy();
  });

  it('tools work with raw InMemoryGraphStore (no ToolContext)', async () => {
    const store = new InMemoryGraphStore();
    createSampleGraph(store, 'test-raw');

    const result = await registry.execute('search_graph', {
      query: 'MyService',
      projectId: 'test-raw',
    }, store);

    const data = JSON.parse(result.content[0].text);
    expect(data.items.length).toBeGreaterThan(0);
  });

  it('tools return helpful messages without any store', async () => {
    const result = await registry.execute('index_status', {
      projectId: 'test',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.nodeCount).toBe(0);
    expect(data.message).toContain('No store');
  });
});

// ---------------------------------------------------------------------------
// Tests: Lifecycle Tools
// ---------------------------------------------------------------------------

describe('Lifecycle Tools', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('list_projects returns projects from store', async () => {
    const result = await registry.execute('list_projects', {
      limit: 10,
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.items).toBeDefined();
    expect(data.total).toBeGreaterThan(0);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0].projectId).toBe('test-project');
  });

  it('delete_project removes project data', async () => {
    const result = await registry.execute('delete_project', {
      projectId: 'test-project',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(true);
    expect(data.deletedNodes).toBeGreaterThan(0);
    expect(data.deletedEdges).toBeGreaterThan(0);

    // Verify project is actually deleted
    const stats = ctx.getGraphStats('test-project');
    expect(stats.nodeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: MCP Server Integration
// ---------------------------------------------------------------------------

describe('MCP Server Integration', () => {
  let server: CodeAnalyzerMCPServer;

  afterEach(async () => {
    if (server) await server.shutdown();
  });

  it('should create server with ToolContext', () => {
    server = new CodeAnalyzerMCPServer();
    expect(server.getToolContext()).toBeDefined();
    expect(server.getStore()).toBeDefined();
    expect(server.getRegistry().size).toBe(38);
  });

  it('should execute tools through ToolContext', async () => {
    server = new CodeAnalyzerMCPServer();
    const store = server.getStore();

    // Add sample data
    createSampleGraph(store, 'integration-test');

    // Execute through registry with toolContext
    const result = await server.getRegistry().execute(
      'search_graph',
      { query: 'MyService', projectId: 'integration-test' },
      server.getToolContext(),
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.items.length).toBeGreaterThan(0);
  });
});
