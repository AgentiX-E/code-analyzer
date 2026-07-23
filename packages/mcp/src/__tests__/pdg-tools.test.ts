// @ts-nocheck
// @code-analyzer/mcp — PDG & Taint Analysis Tools Tests
// Tests for pdgQuery, taintAnalysis, explainTaint

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import { ToolRegistry } from '../tools/registry.js';
import { createToolRegistry } from '../tools/index.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function createPDGGraph(store: InMemoryGraphStore, projectId: string): void {
  const nodes: GraphNode[] = [
    // Main function
    {
      id: 0, projectId, label: 'Function', name: 'processRequest', qualifiedName: 'app.processRequest',
      filePath: '/app/src/process.ts', startLine: 10, endLine: 50, language: 'typescript',
      properties: {}, signature: 'processRequest(input: string): void', docstring: 'Process user input',
      complexity: 12, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Called by processRequest
    {
      id: 0, projectId, label: 'Function', name: 'validateInput', qualifiedName: 'app.validateInput',
      filePath: '/app/src/validate.ts', startLine: 1, endLine: 15, language: 'typescript',
      properties: {}, signature: 'validateInput(data: unknown): boolean', docstring: null,
      complexity: 5, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Called by processRequest
    {
      id: 0, projectId, label: 'Function', name: 'sanitizeData', qualifiedName: 'app.sanitizeData',
      filePath: '/app/src/sanitize.ts', startLine: 1, endLine: 20, language: 'typescript',
      properties: {}, signature: 'sanitizeData(data: string): string', docstring: 'Sanitize input',
      complexity: 3, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Sink-like function
    {
      id: 0, projectId, label: 'Function', name: 'executeSqlQuery', qualifiedName: 'app.executeSqlQuery',
      filePath: '/app/src/db.ts', startLine: 1, endLine: 10, language: 'typescript',
      properties: {}, signature: 'executeSqlQuery(sql: string): void', docstring: null,
      complexity: 2, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Source-like function
    {
      id: 0, projectId, label: 'Function', name: 'readUserInput', qualifiedName: 'app.readUserInput',
      filePath: '/app/src/input.ts', startLine: 1, endLine: 5, language: 'typescript',
      properties: {}, signature: 'readUserInput(): string', docstring: 'Read user input',
      complexity: 1, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // Another function
    {
      id: 0, projectId, label: 'Function', name: 'logResult', qualifiedName: 'app.logResult',
      filePath: '/app/src/log.ts', startLine: 1, endLine: 5, language: 'typescript',
      properties: {}, signature: 'logResult(data: any): void', docstring: null,
      complexity: 1, isExported: false, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // File with user-input in name
    {
      id: 0, projectId, label: 'Function', name: 'handleRequest', qualifiedName: 'app.handleRequest',
      filePath: '/app/src/user-input-handler.ts', startLine: 1, endLine: 30, language: 'typescript',
      properties: {}, signature: 'handleRequest(): void', docstring: null,
      complexity: 8, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    // File with sql-query in file path (for sink matching)
    {
      id: 0, projectId, label: 'Function', name: 'queryDb', qualifiedName: 'app.queryDb',
      filePath: '/app/src/sql-query-executor.ts', startLine: 1, endLine: 10, language: 'typescript',
      properties: {}, signature: 'queryDb(): void', docstring: null,
      complexity: 2, isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ];

  store.insertNodes(nodes);
  const allInserted = store.getAllNodes().filter(n => n.projectId === projectId);

  const processRequest = allInserted.find(n => n.name === 'processRequest');
  const validateInput = allInserted.find(n => n.name === 'validateInput');
  const sanitizeData = allInserted.find(n => n.name === 'sanitizeData');
  const executeSqlQuery = allInserted.find(n => n.name === 'executeSqlQuery');
  const readUserInput = allInserted.find(n => n.name === 'readUserInput');
  const logResult = allInserted.find(n => n.name === 'logResult');
  const handleRequest = allInserted.find(n => n.name === 'handleRequest');
  const queryDb = allInserted.find(n => n.name === 'queryDb');

  // CALLS edges
  if (processRequest && validateInput) {
    store.insertEdge({
      id: 0, projectId, sourceId: processRequest.id, targetId: validateInput.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  if (processRequest && sanitizeData) {
    store.insertEdge({
      id: 0, projectId, sourceId: processRequest.id, targetId: sanitizeData.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  if (processRequest && executeSqlQuery) {
    store.insertEdge({
      id: 0, projectId, sourceId: processRequest.id, targetId: executeSqlQuery.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  if (readUserInput && sanitizeData) {
    store.insertEdge({
      id: 0, projectId, sourceId: readUserInput.id, targetId: sanitizeData.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  // Taint path: readUserInput -> sanitizeData -> executeSqlQuery via processRequest
  // Also make readUserInput call executeSqlQuery for taint detection
  if (readUserInput && executeSqlQuery) {
    store.insertEdge({
      id: 0, projectId, sourceId: readUserInput.id, targetId: executeSqlQuery.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  if (handleRequest && executeSqlQuery) {
    store.insertEdge({
      id: 0, projectId, sourceId: handleRequest.id, targetId: executeSqlQuery.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  if (handleRequest && queryDb) {
    store.insertEdge({
      id: 0, projectId, sourceId: handleRequest.id, targetId: queryDb.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  if (processRequest && logResult) {
    store.insertEdge({
      id: 0, projectId, sourceId: processRequest.id, targetId: logResult.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
  if (validateInput && logResult) {
    store.insertEdge({
      id: 0, projectId, sourceId: validateInput.id, targetId: logResult.id,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });
  }
}

function createTestContext(projectId: string = 'test-pdg'): ToolContextImpl {
  const store = new InMemoryGraphStore();
  createPDGGraph(store, projectId);
  return new ToolContextImpl(store);
}

// ---------------------------------------------------------------------------
// pdgQuery Tests
// ---------------------------------------------------------------------------

describe('pdgQuery', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should return call edges for a function with store data', async () => {
    const result = await registry.execute('pdg_query', {
      functionId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.functionId).toBe('app.processRequest');
    expect(data.projectId).toBe('test-pdg');
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.nodes[0].name).toBe('processRequest');
    expect(data.edges).toBeDefined();
    expect(data.totalEdges).toBeGreaterThan(0);
    expect(data.analysisType).toBe('basic-call-graph');
  });

  it('should return empty results without store', async () => {
    const result = await registry.execute('pdg_query', {
      functionId: 'some.function',
      projectId: 'no-store',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
    expect(data.totalNodes).toBe(0);
    expect(data.totalEdges).toBe(0);
  });

  it('should return empty results for non-existent function', async () => {
    const result = await registry.execute('pdg_query', {
      functionId: 'ghost.nonexistent',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it('should return edge type information', async () => {
    const result = await registry.execute('pdg_query', {
      functionId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    if (data.edges.length > 0) {
      for (const edge of data.edges) {
        expect(edge.type).toBeDefined();
        expect(edge.sourceId).toBeDefined();
        expect(edge.targetId).toBeDefined();
        expect(edge.targetName).toBeDefined();
      }
    }
  });

  it('should include a note about analysis type', async () => {
    const result = await registry.execute('pdg_query', {
      functionId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.note).toBeDefined();
    expect(typeof data.note).toBe('string');
  });

  it('should return node details with file path', async () => {
    const result = await registry.execute('pdg_query', {
      functionId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    if (data.nodes.length > 0) {
      const node = data.nodes[0];
      expect(node.name).toBeDefined();
      expect(node.label).toBeDefined();
      expect(node.filePath).toBeDefined();
      expect(node.startLine).toBeDefined();
    }
  });

  it('should handle function with no call edges', async () => {
    const result = await registry.execute('pdg_query', {
      functionId: 'app.executeSqlQuery',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.nodes.length).toBe(1);
    expect(data.edges).toEqual([]);
    expect(data.totalEdges).toBe(0);
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('pdg_query', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// taintAnalysis Tests
// ---------------------------------------------------------------------------

describe('taintAnalysis', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should detect source-to-sink patterns with store data', async () => {
    // readUserInput -> executeSqlQuery should be detected
    const result = await registry.execute('taint_analysis', {
      projectId: 'test-pdg',
      sourceKind: 'user-input',
      sinkKind: 'sql-query',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-pdg');
    expect(data.sourceKind).toBe('user-input');
    expect(data.sinkKind).toBe('sql-query');
    expect(data.taintPaths).toBeDefined();
    expect(data.vulnerablePaths).toBeDefined();
    expect(data.severity).toBeDefined();
    expect(data.analysisMethod).toBe('pattern-based-heuristic');
  });

  it('should detect taint without specific sourceKind/sinkKind', async () => {
    const result = await registry.execute('taint_analysis', {
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.taintPaths).toBeDefined();
    expect(typeof data.vulnerablePaths).toBe('number');
  });

  it('should return empty results without store', async () => {
    const result = await registry.execute('taint_analysis', {
      projectId: 'no-store',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.taintPaths).toEqual([]);
    expect(data.vulnerablePaths).toBe(0);
    expect(data.severity).toBe('low');
  });

  it('should filter by filePath', async () => {
    const result = await registry.execute('taint_analysis', {
      projectId: 'test-pdg',
      filePath: '/app/src/input.ts',
      sourceKind: 'user-input',
      sinkKind: 'sql-query',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.filePath).toBe('/app/src/input.ts');
  });

  it('should detect severity as high for many vulnerable paths', async () => {
    // Create a store with many source-to-sink connections
    const store = new InMemoryGraphStore();
    const source: GraphNode = {
      id: 0, projectId: 'many-taints', label: 'Function', name: 'userInput', qualifiedName: 'app.userInput',
      filePath: '/app/src/user-input.ts', startLine: 1, endLine: 5, language: 'typescript',
      properties: {}, signature: null, docstring: null, complexity: null,
      isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const sourceId = store.insertNode(source);

    for (let i = 0; i < 6; i++) {
      const sink: GraphNode = {
        id: 0, projectId: 'many-taints', label: 'Function', name: `sqlExec${i}`, qualifiedName: `app.sqlExec${i}`,
        filePath: '/app/src/sql-query.ts', startLine: i * 2, endLine: i * 2 + 1, language: 'typescript',
        properties: {}, signature: null, docstring: null, complexity: null,
        isExported: false, fingerprint: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const sinkId = store.insertNode(sink);
      store.insertEdge({
        id: 0, projectId: 'many-taints', sourceId, targetId: sinkId,
        type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
      });
    }

    const manyCtx = new ToolContextImpl(store);
    const result = await registry.execute('taint_analysis', {
      projectId: 'many-taints',
      sourceKind: 'user-input',
      sinkKind: 'sql-query',
    }, manyCtx);

    const data = JSON.parse(result.content[0].text);
    expect(data.severity).toBe('high');
    expect(data.vulnerablePaths).toBeGreaterThan(5);
  });

  it('should detect file-based source patterns', async () => {
    // handleRequest is in file 'user-input-handler.ts' which matches 'user-input'
    // It calls queryDb which is in file 'sql-query-executor.ts' matching 'sql-query'
    const result = await registry.execute('taint_analysis', {
      projectId: 'test-pdg',
      sourceKind: 'user-input',
      sinkKind: 'sql-query',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    // handleRequest should be detected as a source via its filePath
    expect(data.taintPaths.length).toBeGreaterThan(0);
  });

  it('should include confidence levels in taint paths', async () => {
    const result = await registry.execute('taint_analysis', {
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    for (const path of data.taintPaths) {
      expect(path.source).toBeDefined();
      expect(path.sink).toBeDefined();
      expect(path.confidence).toBeDefined();
      expect(path.source.kind).toBeDefined();
      expect(path.sink.kind).toBeDefined();
    }
  });

  it('should handle network source kind', async () => {
    const result = await registry.execute('taint_analysis', {
      projectId: 'test-pdg',
      sourceKind: 'network',
      sinkKind: 'network-send',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.sourceKind).toBe('network');
    expect(data.sinkKind).toBe('network-send');
    expect(data.taintPaths).toBeDefined();
  });

  it('should handle file-read source kind', async () => {
    const result = await registry.execute('taint_analysis', {
      projectId: 'test-pdg',
      sourceKind: 'file-read',
      sinkKind: 'command-exec',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.sourceKind).toBe('file-read');
    expect(data.sinkKind).toBe('command-exec');
  });

  it('should return severity medium for some vulnerable paths', async () => {
    // With just a few taint paths, severity should be medium
    const store = new InMemoryGraphStore();
    const source: GraphNode = {
      id: 0, projectId: 'few-taints', label: 'Function', name: 'readFromEnv', qualifiedName: 'app.readFromEnv',
      filePath: '/app/src/environment.ts', startLine: 1, endLine: 5, language: 'typescript',
      properties: {}, signature: null, docstring: null, complexity: null,
      isExported: true, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const sourceId = store.insertNode(source);

    const sink: GraphNode = {
      id: 0, projectId: 'few-taints', label: 'Function', name: 'runCommand', qualifiedName: 'app.runCommand',
      filePath: '/app/src/command-exec.ts', startLine: 1, endLine: 5, language: 'typescript',
      properties: {}, signature: null, docstring: null, complexity: null,
      isExported: false, fingerprint: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const sinkId = store.insertNode(sink);
    store.insertEdge({
      id: 0, projectId: 'few-taints', sourceId, targetId: sinkId,
      type: 'CALLS', properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
    });

    const fewCtx = new ToolContextImpl(store);
    const result = await registry.execute('taint_analysis', {
      projectId: 'few-taints',
      sourceKind: 'environment',
      sinkKind: 'command-exec',
    }, fewCtx);

    const data = JSON.parse(result.content[0].text);
    expect(data.vulnerablePaths).toBe(1);
    expect(data.severity).toBe('medium');
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('taint_analysis', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// explainTaint Tests
// ---------------------------------------------------------------------------

describe('explainTaint', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should explain taint path with store data', async () => {
    const result = await registry.execute('explain_taint', {
      taintPathId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.taintPathId).toBe('app.processRequest');
    expect(data.projectId).toBe('test-pdg');
    expect(data.source).toBeDefined();
    expect(data.sink).toBeDefined();
    expect(data.path).toBeDefined();
    expect(Array.isArray(data.path)).toBe(true);
    expect(data.severity).toBeDefined();
    expect(data.remediation).toBeDefined();
  });

  it('should return defaults without store', async () => {
    const result = await registry.execute('explain_taint', {
      taintPathId: 'some.path',
      projectId: 'no-store',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.taintPathId).toBe('some.path');
    expect(data.source.kind).toBe('user-input');
    expect(data.sink.kind).toBe('command-exec');
    expect(data.isVulnerable).toBe(false);
    expect(data.path).toEqual([]);
  });

  it('should resolve source details for known symbols', async () => {
    const result = await registry.execute('explain_taint', {
      taintPathId: 'app.readUserInput',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.source.node).toBe('readUserInput');
    expect(data.source.filePath).toBeDefined();
    expect(data.source.line).toBeGreaterThan(0);
  });

  it('should provide default source for unknown symbol', async () => {
    const result = await registry.execute('explain_taint', {
      taintPathId: 'ghost.unknown',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.source.node).toBe('unknown');
    expect(data.source.filePath).toBe('');
    expect(data.source.line).toBe(0);
  });

  it('should include remediation text', async () => {
    const result = await registry.execute('explain_taint', {
      taintPathId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.remediation).toBeDefined();
    expect(typeof data.remediation).toBe('string');
    expect(data.remediation.length).toBeGreaterThan(0);
  });

  it('should include a note about analysis approach', async () => {
    const result = await registry.execute('explain_taint', {
      taintPathId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    expect(data.note).toBeDefined();
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('explain_taint', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });

  it('should include path steps for known symbol', async () => {
    const result = await registry.execute('explain_taint', {
      taintPathId: 'app.processRequest',
      projectId: 'test-pdg',
    }, ctx);

    const data = JSON.parse(result.content[0].text);
    if (data.path.length > 0) {
      for (const step of data.path) {
        expect(step.nodeId).toBeDefined();
        expect(step.depth).toBeDefined();
      }
    }
  });
});
