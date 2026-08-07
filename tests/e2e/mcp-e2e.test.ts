// @code-analyzer — MCP Server End-to-End Tests
// Validates full MCP server lifecycle: tool registry, tool execution,
// resource listing/reading, and prompt resolution against real store data.

import { describe, it, expect, beforeEach } from 'vitest';
import { createToolRegistry, ToolRegistry } from '@code-analyzer/mcp';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '@code-analyzer/mcp';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let registry: ToolRegistry;
let store: InMemoryGraphStore;
let toolContext: ToolContextImpl;

function populateStore(): void {
  const now = new Date().toISOString();
  const projectId = 'e2e-mcp-project';

  store.insertNode({
    id: 0, projectId, label: 'Project' as any, name: 'mcp-test-project',
    qualifiedName: 'mcp-test-project', filePath: '/', startLine: 1, endLine: 1,
    language: 'typescript', properties: { version: '2.0.0' },
    signature: null, docstring: null, complexity: null,
    isExported: true, fingerprint: null, createdAt: now, updatedAt: now,
  });

  for (let i = 0; i < 10; i++) {
    store.insertNode({
      id: 0, projectId, label: 'Class' as any,
      name: `Service${i}`, qualifiedName: `Service${i}`,
      filePath: `src/service${i}.ts`, startLine: 1, endLine: 20,
      language: 'typescript', properties: { layer: 'service' },
      signature: `class Service${i}`, docstring: `Service ${i}`,
      complexity: 3 + i, isExported: true, fingerprint: null,
      createdAt: now, updatedAt: now,
    });
  }

  for (let i = 0; i < 5; i++) {
    store.insertNode({
      id: 0, projectId, label: 'Function' as any,
      name: `util${i}`, qualifiedName: `util${i}`,
      filePath: `src/utils${i}.ts`, startLine: 1, endLine: 10,
      language: 'typescript', properties: {},
      signature: `function util${i}`, docstring: null,
      complexity: 1, isExported: true, fingerprint: null,
      createdAt: now, updatedAt: now,
    });
  }
}

beforeEach(() => {
  store = new InMemoryGraphStore(':memory:');
  toolContext = new ToolContextImpl(store);
  registry = createToolRegistry();
});

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

describe('MCP E2E — Tool Registry', () => {
  it('should register at least 39 tools', () => {
    const tools = registry.list();
    expect(tools.length).toBeGreaterThanOrEqual(39);
  });

  it('should have all required core tools', () => {
    const tools = registry.list().map((t) => t.name);
    const required = [
      'analyze_repository', 'list_projects', 'delete_project', 'index_status',
      'search_graph', 'search_code', 'semantic_search', 'trace_call_path',
      'query_graph', 'get_code_snippet', 'get_architecture', 'get_graph_schema',
      'explore_symbol', 'find_implementations',
      'detect_changes', 'impact_analysis', 'route_map', 'check_cycles',
      'review_diff', 'review_file',
      'review_pr', 'check_standards',
      'generate_report', 'export_report', 'get_recommendations',
      'cross_repo_search', 'cross_repo_trace', 'cross_repo_impact',
      'manage_repo_group', 'sync_contracts', 'discover_related_repos', 'cross_repo_review_pr',
      'pdg_query', 'taint_analysis', 'explain_taint',
      'list_standards', 'create_standard',
      'manage_adr', 'install_skills',
      'run_benchmark',
    ];
    for (const name of required) {
      expect(tools).toContain(name);
    }
  });

  it('should list tools by profile', () => {
    const all = registry.listByProfile('all');
    const analysis = registry.listByProfile('analysis');
    const scout = registry.listByProfile('scout');

    expect(all.length).toBeGreaterThanOrEqual(39);
    expect(analysis.length).toBeGreaterThan(0);
    expect(analysis.length).toBeLessThanOrEqual(all.length);
    // scout profile should have at least discover_related_repos
    expect(scout.some((t) => t.name === 'discover_related_repos')).toBe(true);
  });

  it('should return error for unknown tool', async () => {
    const result = await registry.execute('nonexistent_tool_xyz', {}, toolContext);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should return error for missing required args', async () => {
    const result = await registry.execute('search_code', {}, toolContext);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

describe('MCP E2E — Tool Execution', () => {
  beforeEach(() => {
    populateStore();
  });

  it('should execute index_status successfully', async () => {
    const result = await registry.execute('index_status', { projectId: 'e2e-mcp-project' }, toolContext);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBeDefined();
  });

  it('should execute list_projects', async () => {
    const result = await registry.execute('list_projects', {}, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should execute search_code with a query', async () => {
    const result = await registry.execute('search_code', { query: 'Service' }, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should execute get_architecture', async () => {
    const result = await registry.execute('get_architecture', { projectId: 'e2e-mcp-project' }, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should execute explore_symbol', async () => {
    const result = await registry.execute('explore_symbol', { symbolName: 'Service0', projectId: 'e2e-mcp-project' }, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should execute impact_analysis', async () => {
    const result = await registry.execute('impact_analysis', { targetSymbol: 'Service0', projectId: 'e2e-mcp-project', fromRef: 'HEAD~1', toRef: 'HEAD' }, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should execute check_cycles', async () => {
    const result = await registry.execute('check_cycles', { projectId: 'e2e-mcp-project' }, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should execute list_standards', async () => {
    const result = await registry.execute('list_standards', { projectId: 'e2e-mcp-project' }, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should execute delete_project', async () => {
    const result = await registry.execute('delete_project', { projectId: 'e2e-mcp-project' }, toolContext);
    expect(result.isError).toBeFalsy();
  });

  it('should handle empty query for search_code gracefully', async () => {
    const result = await registry.execute('search_code', { query: '' }, toolContext);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Resource & Prompt Integration
// ---------------------------------------------------------------------------

describe('MCP E2E — Resources & Prompts', () => {
  it('should list all resources', async () => {
    const mcp = await import('@code-analyzer/mcp');
    const resources = mcp.registerResources();
    expect(resources.length).toBeGreaterThanOrEqual(15);
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('code-analyzer://resources/projects');
    expect(uris).toContain('code-analyzer://resources/graph');
    expect(uris).toContain('code-analyzer://resources/health');
  });

  it('should list all prompts', async () => {
    const mcp = await import('@code-analyzer/mcp');
    const prompts = mcp.registerPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(5);
    const names = prompts.map((p) => p.name);
    expect(names).toContain('explore-codebase');
    expect(names).toContain('review-changes');
    expect(names).toContain('debug-issue');
    expect(names).toContain('refactor-plan');
    expect(names).toContain('architecture-review');
  });

  it('should have prompts with required arguments', async () => {
    const mcp = await import('@code-analyzer/mcp');
    const prompts = mcp.registerPrompts();
    for (const prompt of prompts) {
      expect(prompt.name).toBeTruthy();
      expect(prompt.description).toBeTruthy();
      if (prompt.arguments) {
        const hasRequired = prompt.arguments.some((a: any) => a.required);
        expect(hasRequired).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Error Handling & Edge Cases
// ---------------------------------------------------------------------------

describe('MCP E2E — Error Handling', () => {
  it('should handle tool execution with null args', async () => {
    const result = await registry.execute('index_status', null as any, toolContext);
    expect(result).toBeDefined();
  });

  it('should handle tool execution with undefined args', async () => {
    const result = await registry.execute('index_status', undefined as any, toolContext);
    expect(result).toBeDefined();
  });

  it('should handle tool execution with extra unknown args', async () => {
    const result = await registry.execute('index_status', { unknownField: 'test', extra: 123 }, toolContext);
    expect(result).toBeDefined();
  });

  it('should prevent duplicate tool registration', () => {
    const r = new ToolRegistry();
    r.register('test_tool', 'desc', { type: 'object', properties: {} }, async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }));
    expect(() => {
      r.register('test_tool', 'dup', { type: 'object', properties: {} }, async () => ({
        content: [{ type: 'text', text: 'dup' }],
      }));
    }).toThrow('already registered');
  });

  it('should unregister a tool', () => {
    const r = new ToolRegistry();
    r.register('temp_tool', 'temp', { type: 'object', properties: {} }, async () => ({
      content: [{ type: 'text', text: 'temp' }],
    }));
    expect(r.get('temp_tool')).toBeDefined();
    expect(r.unregister('temp_tool')).toBe(true);
    expect(r.get('temp_tool')).toBeUndefined();
  });
});
