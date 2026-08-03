// @ts-nocheck
// @code-analyzer/mcp — MCP Server Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';
import { ResourceProvider } from '../resources/index.js';
import { PromptProvider } from '../prompts/index.js';
import { AuthMiddleware, RateLimiter, ToolPolicy, RequestLogger } from '../middleware/index.js';

describe('CodeAnalyzerMCPServer', () => {
  let server: CodeAnalyzerMCPServer;

  afterEach(async () => {
    if (server) {
      await server.shutdown();
    }
  });

  describe('constructor', () => {
    it('should create a server with default config', () => {
      server = new CodeAnalyzerMCPServer();
      expect(server).toBeDefined();
      expect(server.getConfig().name).toBe('code-analyzer');
      expect(server.getConfig().version).toBe('0.1.0');
    });

    it('should create a server with custom config', () => {
      server = new CodeAnalyzerMCPServer({
        name: 'custom-analyzer',
        version: '1.0.0',
        toolProfile: 'analysis',
        maxResults: 50,
      });

      const config = server.getConfig();
      expect(config.name).toBe('custom-analyzer');
      expect(config.version).toBe('1.0.0');
      expect(config.toolProfile).toBe('analysis');
      expect(config.maxResults).toBe(50);
    });

    it('should have a tool registry', () => {
      server = new CodeAnalyzerMCPServer();
      expect(server.getRegistry()).toBeDefined();
      expect(server.getRegistry().size).toBeGreaterThan(0);
    });

    it('should have a store', () => {
      server = new CodeAnalyzerMCPServer();
      expect(server.getStore()).toBeDefined();
    });

    it('should have a resource provider', () => {
      server = new CodeAnalyzerMCPServer();
      const rp = server.getResourceProvider();
      expect(rp).toBeDefined();
      expect(rp).toBeInstanceOf(ResourceProvider);
      expect(rp.listResources()).toHaveLength(15);
    });

    it('should have a prompt provider', () => {
      server = new CodeAnalyzerMCPServer();
      const pp = server.getPromptProvider();
      expect(pp).toBeDefined();
      expect(pp).toBeInstanceOf(PromptProvider);
      expect(pp.listPrompts()).toHaveLength(5);
    });
  });

  describe('server lifecycle', () => {
    it('should support shutdown', async () => {
      server = new CodeAnalyzerMCPServer();
      await expect(server.shutdown()).resolves.not.toThrow();
    });

    it('should be idempotent on shutdown', async () => {
      server = new CodeAnalyzerMCPServer();
      await server.shutdown();
      await expect(server.shutdown()).resolves.not.toThrow();
    });
  });

  describe('tool dispatch', () => {
    it('should have all 45 tools registered', () => {
      server = new CodeAnalyzerMCPServer();
      const tools = server.getRegistry().list();
      expect(tools.length).toBe(45);
    });

    it('should have expected tool names', () => {
      server = new CodeAnalyzerMCPServer();
      const toolNames = server.getRegistry().list().map((t) => t.name);

      // Indexing & Lifecycle
      expect(toolNames).toContain('analyze_repository');
      expect(toolNames).toContain('list_projects');
      expect(toolNames).toContain('delete_project');
      expect(toolNames).toContain('index_status');

      // Querying & Exploration
      expect(toolNames).toContain('search_graph');
      expect(toolNames).toContain('search_code');
      expect(toolNames).toContain('query_graph');
      expect(toolNames).toContain('trace_call_path');
      expect(toolNames).toContain('explore_symbol');
      expect(toolNames).toContain('find_implementations');
      expect(toolNames).toContain('get_architecture');
      expect(toolNames).toContain('get_graph_schema');

      // Change & Impact
      expect(toolNames).toContain('impact_analysis');
      expect(toolNames).toContain('check_cycles');
      expect(toolNames).toContain('route_map');

      // PDG
      expect(toolNames).toContain('pdg_query');
      expect(toolNames).toContain('taint_analysis');
      expect(toolNames).toContain('explain_taint');

      // Cross-Repo
      expect(toolNames).toContain('cross_repo_search');
      expect(toolNames).toContain('cross_repo_trace');

      // Standards/ADR/Agent
      expect(toolNames).toContain('list_standards');
      expect(toolNames).toContain('create_standard');
      expect(toolNames).toContain('manage_adr');
      expect(toolNames).toContain('install_skills');
    });

    it('should execute search_graph tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('search_graph', { query: 'test' }, server.getStore());
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('should execute get_architecture tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('get_architecture', { projectId: 'test-project' }, server.getStore());
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('test-project');
    });

    it('should return error for unknown tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('nonexistent_tool', {});
      expect(result.isError).toBe(true);
    });

    it('should return error for missing required arguments', async () => {
      server = new CodeAnalyzerMCPServer();
      // analyze_repository requires 'path'
      const result = await server.getRegistry().execute('analyze_repository', {});
      expect(result.isError).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      server = new CodeAnalyzerMCPServer();
      // query_graph with invalid Cypher should return error
      const result = await server.getRegistry().execute('query_graph', {
        cypher: 'INVALID QUERY !!!',
      }, server.getStore());
      expect(result).toBeDefined();
    });
  });
});

describe('Middleware', () => {
  describe('AuthMiddleware', () => {
    it('should allow requests when no keys are configured', () => {
      const auth = new AuthMiddleware();
      expect(auth.validate({}).allowed).toBe(true);
    });

    it('should deny requests without API key when keys are configured', () => {
      const auth = new AuthMiddleware(['secret-key']);
      expect(auth.validate({}).allowed).toBe(false);
    });

    it('should allow requests with valid API key', () => {
      const auth = new AuthMiddleware(['secret-key']);
      expect(
        auth.validate({ headers: { 'x-api-key': 'secret-key' } }).allowed,
      ).toBe(true);
    });

    it('should deny requests with invalid API key', () => {
      const auth = new AuthMiddleware(['secret-key']);
      expect(
        auth.validate({ headers: { 'x-api-key': 'wrong-key' } }).allowed,
      ).toBe(false);
    });

    it('should support Bearer token in authorization header', () => {
      const auth = new AuthMiddleware(['bearer-token']);
      expect(
        auth.validate({ headers: { authorization: 'Bearer bearer-token' } }).allowed,
      ).toBe(true);
    });

    it('should add and remove keys', () => {
      const auth = new AuthMiddleware();
      auth.addKey('new-key');
      expect(
        auth.validate({ headers: { 'x-api-key': 'new-key' } }).allowed,
      ).toBe(true);

      auth.removeKey('new-key');
      expect(
        auth.validate({ headers: { 'x-api-key': 'new-key' } }).allowed,
      ).toBe(true); // no keys configured
    });
  });

  describe('RateLimiter', () => {
    it('should allow requests within capacity', () => {
      const limiter = new RateLimiter(10);
      for (let i = 0; i < 10; i++) {
        expect(limiter.check('test').allowed).toBe(true);
      }
    });

    it('should deny requests exceeding capacity', () => {
      const limiter = new RateLimiter(1);
      expect(limiter.check('test').allowed).toBe(true);
      const result = limiter.check('test');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeDefined();
    });

    it('should track per-tool separately', () => {
      const limiter = new RateLimiter(1);
      expect(limiter.check('tool1').allowed).toBe(true);
      expect(limiter.check('tool2').allowed).toBe(true);
    });

    it('should reset all buckets', () => {
      const limiter = new RateLimiter(1);
      limiter.check('test');
      limiter.check('test'); // exhausted
      limiter.reset();
      expect(limiter.check('test').allowed).toBe(true);
    });
  });

  describe('ToolPolicy', () => {
    it('should allow all tools for "all" profile', () => {
      const policy = new ToolPolicy('all');
      expect(policy.isAllowed('any_tool', 'analysis')).toBe(true);
      expect(policy.isAllowed('any_tool', 'scout')).toBe(true);
    });

    it('should filter by profile', () => {
      const policy = new ToolPolicy('analysis');
      expect(policy.isAllowed('tool', 'analysis')).toBe(true);
      expect(policy.isAllowed('tool', 'all')).toBe(true);
      expect(policy.isAllowed('tool', 'scout')).toBe(false);
    });

    it('should update profile', () => {
      const policy = new ToolPolicy('analysis');
      policy.setProfile('scout');
      expect(policy.isAllowed('tool', 'analysis')).toBe(false);
      expect(policy.isAllowed('tool', 'scout')).toBe(true);
    });
  });

  describe('RequestLogger', () => {
    it('should log requests and retrieve them', () => {
      const logger = new RequestLogger(10);
      logger.log({ toolName: 'test', args: { x: 1 }, duration: 100, error: false });

      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].toolName).toBe('test');
      expect(logs[0].duration).toBe(100);
    });

    it('should track error entries', () => {
      const logger = new RequestLogger(10);
      logger.log({ toolName: 'ok', args: {}, duration: 10, error: false });
      logger.log({ toolName: 'fail', args: {}, duration: 5, error: true });

      const stats = logger.getStats();
      expect(stats.total).toBe(2);
      expect(stats.errors).toBe(1);
      expect(stats.avgDuration).toBe(7.5);
    });

    it('should trim old logs', () => {
      const logger = new RequestLogger(2);
      logger.log({ toolName: 'a', args: {}, duration: 1, error: false });
      logger.log({ toolName: 'b', args: {}, duration: 1, error: false });
      logger.log({ toolName: 'c', args: {}, duration: 1, error: false });

      expect(logger.getLogs()).toHaveLength(2);
      expect(logger.getLogs()[0].toolName).toBe('b');
    });

    it('should clear logs', () => {
      const logger = new RequestLogger(10);
      logger.log({ toolName: 'test', args: {}, duration: 1, error: false });
      logger.clear();
      expect(logger.getLogs()).toHaveLength(0);
    });
  });
});

describe('MCP Server Integration Tests', () => {
  let server: CodeAnalyzerMCPServer;

  afterEach(async () => {
    if (server) {
      await server.shutdown();
    }
  });

  describe('tool listing and invocation', () => {
    it('should list all 45 tools via registry', () => {
      server = new CodeAnalyzerMCPServer();
      const tools = server.getRegistry().list();
      expect(tools.length).toBe(45);
    });

    it('should list tools filtered by analysis profile', () => {
      server = new CodeAnalyzerMCPServer({ toolProfile: 'analysis' });
      const tools = server.getRegistry().listByProfile('analysis');
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should list all tools with "all" profile', () => {
      server = new CodeAnalyzerMCPServer({ toolProfile: 'all' });
      const tools = server.getRegistry().listByProfile('all');
      expect(tools.length).toBe(45);
    });

    it('should list tools filtered by scout profile', () => {
      server = new CodeAnalyzerMCPServer({ toolProfile: 'scout' });
      const tools = server.getRegistry().listByProfile('scout');
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should execute search_graph with valid arguments', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'search_graph',
        { query: 'getUser' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('should execute list_projects tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('list_projects', {}, server.getToolContext());
      expect(result).toBeDefined();
    });

    it('should execute index_status tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('index_status', {}, server.getToolContext());
      expect(result).toBeDefined();
    });

    it('should execute search_code tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('search_code', { query: 'test' }, server.getToolContext());
      expect(result).toBeDefined();
    });

    it('should execute trace_call_path tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'trace_call_path',
        { symbol: 'test', projectId: 'test-project' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute find_implementations tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'find_implementations',
        { symbol: 'test', projectId: 'test-project' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute explore_symbol tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'explore_symbol',
        { symbol: 'test', projectId: 'test-project' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute check_cycles tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'check_cycles',
        { projectId: 'test-project' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute route_map tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'route_map',
        { projectId: 'test-project' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute list_standards tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('list_standards', {}, server.getToolContext());
      expect(result).toBeDefined();
    });

    it('should execute cross_repo_search tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'cross_repo_search',
        { query: 'test', groupId: 'test-group' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute cross_repo_trace tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'cross_repo_trace',
        { symbol: 'test', groupId: 'test-group', sourceRepo: 'org/repo-a' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute manage_adr tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'manage_adr',
        { action: 'list', projectId: 'test-project' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should execute install_skills tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute(
        'install_skills',
        { action: 'list' },
        server.getToolContext(),
      );
      expect(result).toBeDefined();
    });

    it('should handle tool execution with empty args', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('search_graph', {}, server.getToolContext());
      expect(result.isError).toBe(true);
    });

    it('should return error for nonexistent tool', async () => {
      server = new CodeAnalyzerMCPServer();
      const result = await server.getRegistry().execute('made_up_tool_xyz', {}, server.getToolContext());
      expect(result.isError).toBe(true);
    });
  });

  describe('resource and prompt providers', () => {
    it('should list all 15 resources', () => {
      server = new CodeAnalyzerMCPServer();
      const rp = server.getResourceProvider();
      const resources = rp.listResources();
      expect(resources).toHaveLength(15);
    });

    it('should have expected resource URIs', () => {
      server = new CodeAnalyzerMCPServer();
      const rp = server.getResourceProvider();
      const resources = rp.listResources();
      const uris = resources.map(r => r.uri);

      // Verify at least the expected resource URI patterns exist
      expect(uris.some(uri => uri.includes('graph'))).toBe(true);
      expect(uris.some(uri => uri.includes('project'))).toBe(true);
      expect(uris.some(uri => uri.includes('stat'))).toBe(true);
    });

    it('should list all 5 prompts', () => {
      server = new CodeAnalyzerMCPServer();
      const pp = server.getPromptProvider();
      const prompts = pp.listPrompts();
      expect(prompts).toHaveLength(5);
    });

    it('should get a specific prompt by name', async () => {
      server = new CodeAnalyzerMCPServer();
      const pp = server.getPromptProvider();
      const prompts = pp.listPrompts();
      if (prompts.length > 0) {
        const result = await pp.getPrompt(prompts[0]!.name, {});
        expect(result).toBeDefined();
        expect(Array.isArray(result.messages)).toBe(true);
      }
    });

    it('should get resource by URI', async () => {
      server = new CodeAnalyzerMCPServer();
      const rp = server.getResourceProvider();
      const result = await rp.getResource('code-analyzer://stats/summary');
      expect(result).toBeDefined();
    });
  });

  describe('store integration', () => {
    it('should support inserting and querying nodes', () => {
      server = new CodeAnalyzerMCPServer();
      const store = server.getStore();

      const nodeId = store.insertNode({
        projectId: 'test-integration',
        name: 'TestService',
        qualifiedName: 'TestService',
        label: 'Class',
        filePath: 'src/service.ts',
        startLine: 1,
        endLine: 10,
        language: 'typescript',
        isExported: true,
        complexity: 5,
        properties: {},
      });

      expect(nodeId).toBeGreaterThan(0);

      const nodes = store.queryNodes({ projectId: 'test-integration', limit: 100, offset: 0 });
      expect(nodes.items.length).toBe(1);
      expect(nodes.items[0]!.name).toBe('TestService');
    });

    it('should support edge insertion between project nodes', () => {
      server = new CodeAnalyzerMCPServer();
      const store = server.getStore();

      const id1 = store.insertNode({
        projectId: 'test-edges', name: 'ClassA', qualifiedName: 'ClassA',
        label: 'Class', filePath: 'src/a.ts', startLine: 1, endLine: 10,
        language: 'typescript', isExported: true, complexity: 3, properties: {},
      });
      const id2 = store.insertNode({
        projectId: 'test-edges', name: 'methodB', qualifiedName: 'ClassA.methodB',
        label: 'Method', filePath: 'src/a.ts', startLine: 3, endLine: 7,
        language: 'typescript', isExported: false, complexity: 2, properties: {},
      });

      store.insertEdge({
        sourceId: id1, targetId: id2, type: 'HAS_METHOD',
        projectId: 'test-edges', properties: {}, weight: 1,
      });

      const edges = store.getEdgesForNode(id1);
      expect(edges.length).toBeGreaterThan(0);
      expect(edges[0]!.type).toBe('HAS_METHOD');
    });

    it('should support store lifecycle', () => {
      server = new CodeAnalyzerMCPServer();
      const store = server.getStore();

      store.insertNode({
        projectId: 'lifecycle-test', name: 'fn', qualifiedName: 'fn',
        label: 'Function', filePath: 'src/fn.ts', startLine: 1, endLine: 5,
        language: 'typescript', isExported: false, complexity: 1, properties: {},
      });

      const nodes = store.queryNodes({ projectId: 'lifecycle-test', limit: 100, offset: 0 });
      expect(nodes.items.length).toBe(1);

      store.close();
    });
  });

  describe('server config', () => {
    it('should disable resources when configured', () => {
      server = new CodeAnalyzerMCPServer({ enableResources: false });
      const config = server.getConfig();
      expect(config.enableResources).toBe(false);
    });

    it('should disable prompts when configured', () => {
      server = new CodeAnalyzerMCPServer({ enablePrompts: false });
      const config = server.getConfig();
      expect(config.enablePrompts).toBe(false);
    });

    it('should configure maxResults', () => {
      server = new CodeAnalyzerMCPServer({ maxResults: 50 });
      const config = server.getConfig();
      expect(config.maxResults).toBe(50);
    });

    it('should configure enableStreaming', () => {
      server = new CodeAnalyzerMCPServer({ enableStreaming: true });
      const config = server.getConfig();
      expect(config.enableStreaming).toBe(true);
    });
  });

  describe('auto-indexer', () => {
    it('should have auto-indexer initialized', () => {
      server = new CodeAnalyzerMCPServer();
      const autoIndexer = server.getAutoIndexer();
      expect(autoIndexer).toBeDefined();
    });
  });

  describe('server accessors', () => {
    it('should return underlying Server instance', () => {
      server = new CodeAnalyzerMCPServer();
      expect(server.getServer()).toBeDefined();
    });

    it('should return SSE transport (undefined when not started)', () => {
      server = new CodeAnalyzerMCPServer();
      expect(server.getSSETransport()).toBeUndefined();
    });
  });
});
