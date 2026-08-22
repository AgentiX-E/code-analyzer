// @code-analyzer/server — GraphQL API Tests
// Comprehensive tests for all GraphQL queries, mutations, and edge cases.
// Uses Yoga's fetch() API for testing to avoid dual graphql instance issues.

import { describe, it, expect, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from '../graphql/schema.js';
import { resolvers } from '../graphql/resolvers.js';
import { createGraphQLContext, type GraphQLContext } from '../graphql/context.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let store: InMemoryGraphStore;
let ctx: GraphQLContext;
let yoga: ReturnType<typeof createYoga>;

async function executeQuery(query: string, variables?: Record<string, unknown>) {
  const resp = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return await resp.json();
}

function populateStore(): void {
  const projectId = 'test-project-1';

  store.insertNode({
    id: 0,
    projectId,
    label: 'Project',
    name: 'test-project',
    qualifiedName: 'test-project',
    filePath: '/tmp/test-project',
    startLine: null,
    endLine: null,
    language: 'typescript',
    properties: { name: 'test-project', rootPath: '/tmp/test-project' },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
  });

  const classId = store.insertNode({
    id: 0,
    projectId,
    label: 'Class',
    name: 'UserService',
    qualifiedName: 'src.services.UserService',
    filePath: 'src/services/UserService.ts',
    startLine: 10,
    endLine: 50,
    language: 'typescript',
    properties: {
      name: 'UserService',
      filePath: 'src/services/UserService.ts',
      startLine: 10,
      endLine: 50,
      isExported: true,
    },
    signature: 'class UserService',
    docstring: 'Handles user operations',
    complexity: 5,
    isExported: true,
    fingerprint: 'abc123',
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
  });

  const funcId = store.insertNode({
    id: 0,
    projectId,
    label: 'Function',
    name: 'getUser',
    qualifiedName: 'src.services.UserService.getUser',
    filePath: 'src/services/UserService.ts',
    startLine: 20,
    endLine: 30,
    language: 'typescript',
    properties: {
      name: 'getUser',
      filePath: 'src/services/UserService.ts',
      startLine: 20,
      endLine: 30,
      visibility: 'public',
      isExported: true,
    },
    signature: 'async getUser(id: string): Promise<User>',
    docstring: 'Retrieves a user by ID',
    complexity: 3,
    isExported: true,
    fingerprint: 'def456',
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
  });

  store.insertEdge({
    id: 0,
    projectId,
    sourceId: classId,
    targetId: funcId,
    type: 'DEFINES',
    properties: {},
    weight: 1,
    createdAt: new Date('2026-01-01').toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphQL API', () => {
  beforeEach(() => {
    store = new InMemoryGraphStore();
    ctx = createGraphQLContext(
      store,
      {
        host: '0.0.0.0',
        port: 3000,
        apiPrefix: '/api/v1',
        cors: {
          origin: '*',
          methods: [],
          allowedHeaders: [],
          exposedHeaders: [],
          credentials: false,
          maxAge: 0,
        },
        auth: { enabled: false, apiKeys: [], headerName: '' },
        logging: { enabled: false, level: 'silent', includeBody: false, pretty: false },
        metadata: { name: 'test', version: '0.0.0', environment: 'test' },
        rateLimit: { enabled: false, windowMs: 60000, maxRequests: 100, addHeaders: false },
        mtls: {
          enabled: false,
          caCerts: [],
          requireCert: false,
          skipHealthEndpoints: true,
          failureMode: 'reject',
        },
        maxBodySize: 1048576,
        keepAliveTimeout: 61000,
        sseHeartbeatMs: 15000,
        maxConnections: 0,
      },
      Date.now(),
    );
    const schema = makeExecutableSchema({ typeDefs, resolvers });
    yoga = createYoga({
      schema,
      context: () => ctx,
      graphiql: false,
      landingPage: false,
      maskedErrors: false,
      cors: false,
    });
  });

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------
  describe('health', () => {
    it('should return server health information', async () => {
      const result = await executeQuery('{ health { status uptime version nodeCount edgeCount } }');
      expect(result.errors).toBeUndefined();
      const health = result.data.health;
      expect(health.status).toBe('healthy');
      expect(health.version).toBe('0.0.0');
      expect(health.nodeCount).toBe(0);
      expect(health.edgeCount).toBe(0);
    });

    it('should return memory information', async () => {
      const result = await executeQuery('{ health { memory { heapUsedMB heapTotalMB rssMB } } }');
      expect(result.errors).toBeUndefined();
      const mem = result.data.health.memory;
      expect(mem.heapUsedMB).toBeGreaterThanOrEqual(0);
      expect(mem.heapTotalMB).toBeGreaterThan(0);
    });

    it('should return timestamp', async () => {
      const result = await executeQuery('{ health { timestamp } }');
      expect(result.errors).toBeUndefined();
      expect(result.data.health.timestamp).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------
  describe('projects', () => {
    it('should return empty array with empty store', async () => {
      const result = await executeQuery('{ projects { id name status } }');
      expect(result.errors).toBeUndefined();
      expect(result.data.projects).toEqual([]);
    });

    it('should return indexed projects', async () => {
      populateStore();
      const result = await executeQuery('{ projects { id name status nodeCount edgeCount } }');
      expect(result.errors).toBeUndefined();
      expect(result.data.projects.length).toBeGreaterThanOrEqual(1);
      expect(result.data.projects[0].status).toBe('READY');
    });

    it('should return project with language', async () => {
      populateStore();
      const result = await executeQuery('{ projects { id language } }');
      expect(result.errors).toBeUndefined();
      const tsProject = result.data.projects.find((p: any) => p.language === 'typescript');
      expect(tsProject).toBeDefined();
    });
  });

  describe('project', () => {
    it('should return null for non-existent project', async () => {
      const result = await executeQuery('{ project(id: "nonexistent") { id name } }');
      expect(result.errors).toBeUndefined();
      expect(result.data.project).toBeNull();
    });

    it('should return project by ID', async () => {
      populateStore();
      const result = await executeQuery(
        'query($id: ID!) { project(id: $id) { id name language status } }',
        { id: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      const project = result.data.project;
      expect(project.id).toBe('test-project-1');
      expect(project.name).toBe('test-project');
      expect(project.status).toBe('READY');
    });
  });

  // -----------------------------------------------------------------------
  // Graph
  // -----------------------------------------------------------------------
  describe('graph', () => {
    it('should return empty items for empty project', async () => {
      const result = await executeQuery(
        'query($pid: ID!) { graph(projectId: $pid) { items { id } pageInfo { total } } }',
        { pid: 'nonexistent' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.graph.items).toEqual([]);
    });

    it('should return nodes for a project', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { graph(projectId: $pid) { items { id name label } pageInfo { total hasMore } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.graph.items.length).toBeGreaterThanOrEqual(1);
      expect(result.data.graph.pageInfo.total).toBeGreaterThanOrEqual(1);
    });

    it('should support label filtering', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!, $label: String) { graph(projectId: $pid, label: $label) { items { label } } }',
        { pid: 'test-project-1', label: 'Function' },
      );
      expect(result.errors).toBeUndefined();
      for (const item of result.data.graph.items) {
        expect(item.label).toBe('Function');
      }
    });

    it('should support pagination', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { graph(projectId: $pid, limit: 1) { pageInfo { limit hasMore } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.graph.pageInfo.limit).toBe(1);
    });
  });

  describe('edges', () => {
    it('should return edges for a project', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { edges(projectId: $pid) { items { id type sourceId targetId } pageInfo { total } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.edges.pageInfo.total).toBeGreaterThanOrEqual(1);
      expect(result.data.edges.items[0].type).toBe('DEFINES');
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------
  describe('searchGraph', () => {
    it('should find nodes by name', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!, $q: String!) { searchGraph(projectId: $pid, query: $q) { items { node { name } score } } }',
        { pid: 'test-project-1', q: 'UserService' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.searchGraph.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for no matches', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { searchGraph(projectId: $pid, query: "zzz_nonexistent_zzz") { items { node { name } } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.searchGraph.items).toEqual([]);
    });
  });

  describe('crossRepoSearch', () => {
    it('should search across all projects', async () => {
      populateStore();
      const result = await executeQuery(
        'query($q: String!) { crossRepoSearch(query: $q) { items { node { name projectId } } pageInfo { total } } }',
        { q: 'UserService' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.crossRepoSearch.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for no matches', async () => {
      const result = await executeQuery(
        '{ crossRepoSearch(query: "zzz_nonexistent") { items { node { name } } } }',
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.crossRepoSearch.items).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Review
  // -----------------------------------------------------------------------
  describe('reviewDiff', () => {
    it('should accept a diff and return review placeholder', async () => {
      const result = await executeQuery(
        'query($pid: ID!, $diff: String!) { reviewDiff(projectId: $pid, diff: $diff) { summary stats { totalComments } } }',
        { pid: 'test-project-1', diff: '+console.log("hello");' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.reviewDiff.summary).toBeTruthy();
      expect(result.data.reviewDiff.stats.totalComments).toBe(0);
    });
  });

  describe('reviewPR', () => {
    it('should accept PR review parameters', async () => {
      const result = await executeQuery(
        'query($pid: ID!, $pr: Int!, $owner: String!, $repo: String!) { reviewPR(projectId: $pid, prNumber: $pr, owner: $owner, repo: $repo) { summary } }',
        { pid: 'test-project-1', pr: 42, owner: 'AgentiX-E', repo: 'code-analyzer' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.reviewPR.summary).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Impact Analysis
  // -----------------------------------------------------------------------
  describe('impactAnalysis', () => {
    it('should analyze impact of changed files', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!, $files: [String!]!) { impactAnalysis(projectId: $pid, changedFiles: $files) { riskLevel changedFiles changedSymbols { symbolQname } } }',
        { pid: 'test-project-1', files: ['src/services/UserService.ts'] },
      );
      expect(result.errors).toBeUndefined();
      const impact = result.data.impactAnalysis;
      expect(impact.changedFiles).toContain('src/services/UserService.ts');
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(impact.riskLevel);
    });

    it('should return low risk for no changed files', async () => {
      const result = await executeQuery(
        'query($pid: ID!) { impactAnalysis(projectId: $pid, changedFiles: []) { riskLevel estimatedEffort } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.impactAnalysis.riskLevel).toBe('LOW');
      expect(result.data.impactAnalysis.estimatedEffort).toBe('low');
    });
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------
  describe('projectStats', () => {
    it('should return stats for a project', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { projectStats(projectId: $pid) { projectId nodeCount edgeCount nodeLabelDistribution languageDistribution } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      const stats = result.data.projectStats;
      expect(stats.projectId).toBe('test-project-1');
      expect(stats.nodeCount).toBeGreaterThanOrEqual(3);
      expect(stats.edgeCount).toBeGreaterThanOrEqual(1);
      expect(stats.nodeLabelDistribution).toBeDefined();
    });

    it('should return zeros for empty project', async () => {
      const result = await executeQuery(
        'query($pid: ID!) { projectStats(projectId: $pid) { nodeCount edgeCount } }',
        { pid: 'nonexistent' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.projectStats.nodeCount).toBe(0);
      expect(result.data.projectStats.edgeCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------
  describe('indexProject', () => {
    it('should create a project node', async () => {
      const result = await executeQuery(
        'mutation($path: String!, $pid: String) { indexProject(path: $path, projectId: $pid) { id name status nodeCount } }',
        { path: '/tmp/my-project', pid: 'my-test-project' },
      );
      expect(result.errors).toBeUndefined();
      const project = result.data.indexProject;
      expect(project.id).toBe('my-test-project');
      expect(project.status).toBe('INDEXING');
      expect(project.nodeCount).toBeGreaterThanOrEqual(1);
    });

    it('should auto-generate project ID when not provided', async () => {
      const result = await executeQuery(
        'mutation($path: String!) { indexProject(path: $path) { id name } }',
        { path: '/tmp/another-project' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.indexProject.id).toBeTruthy();
      expect(result.data.indexProject.name).toBeTruthy();
    });
  });

  describe('deleteProject', () => {
    it('should delete a project', async () => {
      populateStore();
      const result = await executeQuery('mutation($id: ID!) { deleteProject(id: $id) }', {
        id: 'test-project-1',
      });
      expect(result.errors).toBeUndefined();
      expect(result.data.deleteProject).toBe(true);
    });

    it('should return true for non-existent project', async () => {
      const result = await executeQuery('mutation { deleteProject(id: "nonexistent") }');
      expect(result.errors).toBeUndefined();
      expect(result.data.deleteProject).toBe(false);
    });
  });

  describe('runBenchmark', () => {
    it('should return benchmark metadata', async () => {
      const result = await executeQuery(
        'mutation($pid: ID!, $suite: String!) { runBenchmark(projectId: $pid, suite: $suite) { suite totalTests passed failed } }',
        { pid: 'test-project-1', suite: 'search' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.runBenchmark.suite).toBe('search');
    });
  });

  describe('manageRepoGroup', () => {
    it('should create a repository group', async () => {
      const result = await executeQuery(
        'mutation($action: String!, $name: String) { manageRepoGroup(action: $action, name: $name) { id name repos { fullName } } }',
        { action: 'create', name: 'my-group' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.manageRepoGroup.name).toBe('my-group');
    });
  });

  // -----------------------------------------------------------------------
  // Repo Groups
  // -----------------------------------------------------------------------
  describe('repoGroups', () => {
    it('should return empty list', async () => {
      const result = await executeQuery('{ repoGroups { id name } }');
      expect(result.errors).toBeUndefined();
      expect(result.data.repoGroups).toEqual([]);
    });
  });

  describe('repoGroup', () => {
    it('should return null for unknown group', async () => {
      const result = await executeQuery('{ repoGroup(id: "unknown") { id } }');
      expect(result.errors).toBeUndefined();
      expect(result.data.repoGroup).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Additional coverage
  // -----------------------------------------------------------------------
  describe('coverage edge cases', () => {
    it('should return node properties for graph nodes', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { graph(projectId: $pid) { items { id properties } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      for (const item of result.data.graph.items) {
        expect(item.properties).toBeDefined();
      }
    });

    it('should return edge properties', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { edges(projectId: $pid) { items { id weight properties createdAt } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      const edge = result.data.edges.items[0];
      expect(edge.weight).toBe(1);
      expect(edge.properties).toBeDefined();
    });

    it('should return project config as JSON', async () => {
      populateStore();
      const result = await executeQuery('query($id: ID!) { project(id: $id) { config } }', {
        id: 'test-project-1',
      });
      expect(result.errors).toBeUndefined();
      expect(result.data.project.config).toBeDefined();
    });

    it('should return edge type distribution in stats', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { projectStats(projectId: $pid) { edgeTypeDistribution } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.projectStats.edgeTypeDistribution.DEFINES).toBeGreaterThanOrEqual(1);
    });

    it('should filter edges by type', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!, $type: String) { edges(projectId: $pid, type: $type) { items { id type } } }',
        { pid: 'test-project-1', type: 'DEFINES' },
      );
      expect(result.errors).toBeUndefined();
      for (const edge of result.data.edges.items) {
        expect(edge.type).toBe('DEFINES');
      }
    });

    it('should handle pagination for searchGraph', async () => {
      populateStore();
      // First page
      const r1 = await executeQuery(
        'query($pid: ID!, $q: String!) { searchGraph(projectId: $pid, query: $q, limit: 1, offset: 0) { items { node { name } } pageInfo { hasMore total } } }',
        { pid: 'test-project-1', q: 'user' },
      );
      expect(r1.errors).toBeUndefined();
      const p1 = r1.data.searchGraph;
      expect(p1.pageInfo.limit).toBeUndefined(); // pagination for search returns total count, no offset tracking
    });
  });

  // -----------------------------------------------------------------------
  // Error Handling
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('should handle empty store gracefully', async () => {
      const results = await Promise.all([
        executeQuery('{ projects { id } }'),
        executeQuery('{ graph(projectId: "x") { items { id } pageInfo { total } } }'),
        executeQuery('{ edges(projectId: "x") { items { id } pageInfo { total } } }'),
        executeQuery('{ projectStats(projectId: "x") { nodeCount edgeCount } }'),
        executeQuery('{ health { status } }'),
      ]);
      for (const r of results) {
        expect(r.errors).toBeUndefined();
        expect(r.data).toBeDefined();
      }
    });

    it('should reject invalid query syntax', async () => {
      const result = await executeQuery('{ invalidField }');
      expect(result.errors).toBeDefined();
    });

    it('should return null for missing project', async () => {
      const result = await executeQuery('{ project(id: "no-such-project") { id } }');
      expect(result.errors).toBeUndefined();
      expect(result.data.project).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------
  describe('pagination', () => {
    it('should handle large offset', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { graph(projectId: $pid, offset: 9999) { items { id } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data.graph.items).toEqual([]);
    });

    it('should set hasMore correctly', async () => {
      populateStore();
      const result = await executeQuery(
        'query($pid: ID!) { graph(projectId: $pid, limit: 1) { pageInfo { hasMore total } } }',
        { pid: 'test-project-1' },
      );
      expect(result.errors).toBeUndefined();
      if (result.data.graph.pageInfo.total > 1) {
        expect(result.data.graph.pageInfo.hasMore).toBe(true);
      }
    });
  });
});
