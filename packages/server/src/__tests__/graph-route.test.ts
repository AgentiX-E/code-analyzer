// @code-analyzer/server — Graph Route Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerGraphRoutes } from '../routes/graph.js';
import { resolveConfig } from '../server-config.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStoreWithData(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();

  // Insert nodes
  const node1Id = store.insertNode({
    id: 0,
    projectId: 'org/repo-a',
    label: 'Class',
    name: 'UserService',
    qualifiedName: 'org.repo-a.UserService',
    filePath: 'src/services/user.ts',
    startLine: 10,
    endLine: 50,
    language: 'typescript',
    properties: {},
    signature: 'class UserService',
    docstring: 'Handles user operations',
    complexity: 12,
    isExported: true,
    fingerprint: 'abc123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const node2Id = store.insertNode({
    id: 0,
    projectId: 'org/repo-a',
    label: 'Function',
    name: 'getUserById',
    qualifiedName: 'org.repo-a.getUserById',
    filePath: 'src/services/user.ts',
    startLine: 20,
    endLine: 30,
    language: 'typescript',
    properties: {},
    signature: 'function getUserById(id: string): User',
    docstring: 'Fetches a user by ID',
    complexity: 5,
    isExported: true,
    fingerprint: 'def456',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const node3Id = store.insertNode({
    id: 0,
    projectId: 'org/repo-a',
    label: 'Interface',
    name: 'IUserRepository',
    qualifiedName: 'org.repo-a.IUserRepository',
    filePath: 'src/repositories/user.ts',
    startLine: 1,
    endLine: 15,
    language: 'typescript',
    properties: {},
    signature: 'interface IUserRepository',
    docstring: 'User repository contract',
    complexity: null,
    isExported: true,
    fingerprint: 'ghi789',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Insert node in a different project
  store.insertNode({
    id: 0,
    projectId: 'org/repo-b',
    label: 'Class',
    name: 'OrderService',
    qualifiedName: 'org.repo-b.OrderService',
    filePath: 'src/order.ts',
    startLine: 5,
    endLine: 40,
    language: 'typescript',
    properties: {},
    signature: 'class OrderService',
    docstring: null,
    complexity: 8,
    isExported: true,
    fingerprint: 'jkl012',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Insert edges
  store.insertEdge({
    id: 0,
    projectId: 'org/repo-a',
    sourceId: node1Id,
    targetId: node2Id,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  });

  store.insertEdge({
    id: 0,
    projectId: 'org/repo-a',
    sourceId: node2Id,
    targetId: node3Id,
    type: 'IMPLEMENTS',
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  });

  // Cross-repo edge
  store.insertEdge({
    id: 0,
    projectId: 'org/repo-a',
    sourceId: node1Id,
    targetId: node3Id,
    type: 'CROSS_REPO_CALLS',
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  });

  return store;
}

function createEmptyStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerGraphRoutes', () => {
  let app: FastifyInstance;
  let store: InMemoryGraphStore;
  const config = resolveConfig();

  describe('with data', () => {
    beforeEach(async () => {
      app = Fastify({ logger: false });
      store = createStoreWithData();
      registerGraphRoutes(app, config, () => store);
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    // ── Graph HTML page ──

    it('GET /graph should return HTML with status 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/graph' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('GET /graph HTML should contain D3.js and visualization elements', async () => {
      const res = await app.inject({ method: 'GET', url: '/graph' });
      expect(res.body).toContain('d3js.org');
      expect(res.body).toContain('forceSimulation');
      expect(res.body).toContain('graph-container');
      expect(res.body).toContain('filter-panel');
      expect(res.body).toContain('legend');
    });

    it('GET /graph HTML should be self-contained (no external CSS/JS files)', async () => {
      const res = await app.inject({ method: 'GET', url: '/graph' });
      // Only D3 from CDN should be present
      const externalScripts = res.body.match(/src="(?!https:\/\/d3js\.org)[^"]+"/g) ?? [];
      expect(externalScripts.length).toBe(0);
      const externalStyles = res.body.match(/href="[^"]+\.css"/g) ?? [];
      expect(externalStyles.length).toBe(0);
    });

    // ── Graph data endpoint — basic ──

    it('GET /graph/data should return valid JSON with nodes and edges', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.nodes).toBeDefined();
      expect(body.edges).toBeDefined();
      expect(body.stats).toBeDefined();
      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.edges)).toBe(true);
    });

    it('GET /graph/data should return correct structure for nodes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const body = JSON.parse(res.body);
      expect(body.nodes.length).toBeGreaterThan(0);
      const node = body.nodes[0];
      expect(node.id).toBeDefined();
      expect(node.name).toBeDefined();
      expect(node.label).toBeDefined();
      expect(node.projectId).toBeDefined();
      expect(node.filePath).toBeDefined();
      expect(node.complexity !== undefined).toBe(true);
    });

    it('GET /graph/data should return correct structure for edges', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const body = JSON.parse(res.body);
      expect(body.edges.length).toBeGreaterThan(0);
      const edge = body.edges[0];
      expect(edge.id).toBeDefined();
      expect(edge.sourceId).toBeDefined();
      expect(edge.targetId).toBeDefined();
      expect(edge.type).toBeDefined();
    });

    it('GET /graph/data should return stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const body = JSON.parse(res.body);
      expect(body.stats.totalNodes).toBeGreaterThan(0);
      expect(body.stats.totalEdges).toBeGreaterThan(0);
      expect(body.stats.filteredNodes).toBeGreaterThan(0);
    });

    // ── Filter by projectId ──

    it('GET /graph/data should filter by projectId', async () => {
      const resA = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const bodyA = JSON.parse(resA.body);
      const resB = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-b',
      });
      const bodyB = JSON.parse(resB.body);

      // repo-a should have more nodes than repo-b
      expect(bodyA.nodes.length).toBeGreaterThan(bodyB.nodes.length);
      // All nodes should belong to the correct project
      expect(bodyA.nodes.every((n: { projectId: string }) => n.projectId === 'org/repo-a')).toBe(
        true,
      );
      expect(bodyB.nodes.every((n: { projectId: string }) => n.projectId === 'org/repo-b')).toBe(
        true,
      );
    });

    it('GET /graph/data should return empty nodes for non-existent project', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/nonexistent',
      });
      const body = JSON.parse(res.body);
      expect(body.nodes).toHaveLength(0);
      expect(body.edges).toHaveLength(0);
    });

    // ── Filter by label ──

    it('GET /graph/data should filter by single label', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&label=Class',
      });
      const body = JSON.parse(res.body);
      expect(body.nodes.length).toBeGreaterThan(0);
      expect(body.nodes.every((n: { label: string }) => n.label === 'Class')).toBe(true);
    });

    it('GET /graph/data should filter by multiple labels (comma-separated)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&label=Class,Function',
      });
      const body = JSON.parse(res.body);
      expect(body.nodes.length).toBeGreaterThan(0);
      expect(
        body.nodes.every((n: { label: string }) => n.label === 'Class' || n.label === 'Function'),
      ).toBe(true);
    });

    it('GET /graph/data should handle empty label parameter gracefully', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&label=,',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Empty labels after trimming should return all nodes
      expect(body.nodes.length).toBeGreaterThan(0);
    });

    // ── Search ──

    it('GET /graph/data should filter by search term', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&search=User',
      });
      const body = JSON.parse(res.body);
      expect(body.nodes.length).toBeGreaterThan(0);
      expect(body.nodes.every((n: { name: string }) => n.name.toLowerCase().includes('user'))).toBe(
        true,
      );
    });

    it('GET /graph/data should return empty when search has no match', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&search=ZZZNOTFOUND',
      });
      const body = JSON.parse(res.body);
      expect(body.nodes).toHaveLength(0);
      expect(body.stats.filteredNodes).toBe(0);
    });

    // ── Limit ──

    it('GET /graph/data should respect limit parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&limit=1',
      });
      const body = JSON.parse(res.body);
      expect(body.nodes.length).toBeLessThanOrEqual(1);
      expect(body.stats.filteredNodes).toBeLessThanOrEqual(1);
    });

    it('GET /graph/data should default to 500 when limit is not provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const body = JSON.parse(res.body);
      // With our test data having fewer than 500 nodes, all should be returned
      expect(body.nodes.length).toBeGreaterThan(0);
      expect(body.nodes.length).toBeLessThanOrEqual(500);
    });

    it('GET /graph/data should clamp limit to 5000 max', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&limit=99999',
      });
      // Should not error — limit should be clamped
      expect(res.statusCode).toBe(200);
    });

    it('GET /graph/data should handle invalid limit gracefully', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a&limit=abc',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.nodes.length).toBeGreaterThan(0);
    });

    // ── Project ID required ──

    it('GET /graph/data without projectId should return empty results', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.nodes).toHaveLength(0);
      expect(body.edges).toHaveLength(0);
      expect(body.stats.filteredNodes).toBe(0);
    });

    // ── Cross-repo edges ──

    it('GET /graph/data should mark cross-repo edges as CROSS_REPO', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const body = JSON.parse(res.body);
      const crossRepoEdges = body.edges.filter((e: { type: string }) => e.type === 'CROSS_REPO');
      expect(crossRepoEdges.length).toBeGreaterThan(0);
    });

    // ── Edge connectivity ──

    it('GET /graph/data edges should only connect nodes present in the response', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const body = JSON.parse(res.body);
      const nodeIds = new Set(body.nodes.map((n: { id: string }) => n.id));
      for (const edge of body.edges) {
        expect(nodeIds.has(edge.sourceId)).toBe(true);
        expect(nodeIds.has(edge.targetId)).toBe(true);
      }
    });
  });

  // ── Empty store tests ──

  describe('with empty store', () => {
    beforeEach(async () => {
      app = Fastify({ logger: false });
      store = createEmptyStore();
      registerGraphRoutes(app, config, () => store);
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /graph should still return HTML with status 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/graph' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('GET /graph/data should return empty nodes and edges', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.nodes).toHaveLength(0);
      expect(body.edges).toHaveLength(0);
    });

    it('GET /graph/data should have zero stats with empty store', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      const body = JSON.parse(res.body);
      expect(body.stats.totalNodes).toBe(0);
      expect(body.stats.totalEdges).toBe(0);
      expect(body.stats.filteredNodes).toBe(0);
    });
  });

  // ── Content-type validation ──

  describe('content types', () => {
    beforeEach(async () => {
      app = Fastify({ logger: false });
      store = createStoreWithData();
      registerGraphRoutes(app, config, () => store);
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /graph should return text/html content type', async () => {
      const res = await app.inject({ method: 'GET', url: '/graph' });
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('GET /graph/data should return application/json content type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/graph/data?projectId=org/repo-a',
      });
      expect(res.headers['content-type']).toContain('application/json');
    });
  });
});
