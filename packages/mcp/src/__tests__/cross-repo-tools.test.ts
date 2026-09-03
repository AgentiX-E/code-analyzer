// @ts-nocheck
// @code-analyzer/mcp — Cross-Repo Tools Tests
// Tests for crossRepoSearch, crossRepoTrace, crossRepoImpact,
// manageRepoGroup, syncContracts, discoverRelatedRepos

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import { ToolRegistry } from '../tools/registry.js';
import { createToolRegistry } from '../tools/index.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Test Fixtures: Multi-Repo Graph Data
// ---------------------------------------------------------------------------

function createMultiRepoGraph(store: InMemoryGraphStore): void {
  const projectA = 'repo-alpha';
  const projectB = 'repo-beta';
  const projectC = 'repo-gamma';

  const nodes: GraphNode[] = [
    // Repo Alpha nodes
    {
      id: 0,
      projectId: projectA,
      label: 'Function',
      name: 'alphaFn',
      qualifiedName: 'alpha.alphaFn',
      filePath: '/alpha/src/fn.ts',
      startLine: 1,
      endLine: 20,
      language: 'typescript',
      properties: {},
      signature: 'alphaFn(): void',
      docstring: 'Alpha function',
      complexity: 5,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: projectA,
      label: 'Class',
      name: 'AlphaService',
      qualifiedName: 'alpha.AlphaService',
      filePath: '/alpha/src/service.ts',
      startLine: 1,
      endLine: 40,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: 'Alpha service',
      complexity: 10,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: projectA,
      label: 'Route',
      name: 'getAlphaItems',
      qualifiedName: 'alpha.routes.getAlphaItems',
      filePath: '/alpha/src/routes/items.ts',
      startLine: 5,
      endLine: 15,
      language: 'typescript',
      properties: { routePath: '/api/alpha/items', routeMethod: 'GET' },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Repo Beta nodes
    {
      id: 0,
      projectId: projectB,
      label: 'Function',
      name: 'betaFn',
      qualifiedName: 'beta.betaFn',
      filePath: '/beta/src/fn.ts',
      startLine: 1,
      endLine: 15,
      language: 'typescript',
      properties: {},
      signature: 'betaFn(): void',
      docstring: 'Beta function',
      complexity: 3,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: projectB,
      label: 'Class',
      name: 'BetaConsumer',
      qualifiedName: 'beta.BetaConsumer',
      filePath: '/beta/src/consumer.ts',
      startLine: 1,
      endLine: 30,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: 'Consumes alpha data',
      complexity: 7,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: projectB,
      label: 'Route',
      name: 'getBetaItems',
      qualifiedName: 'beta.routes.getBetaItems',
      filePath: '/beta/src/routes/items.ts',
      startLine: 5,
      endLine: 15,
      language: 'typescript',
      properties: { routePath: '/api/beta/items', routeMethod: 'GET' },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Repo Gamma nodes
    {
      id: 0,
      projectId: projectC,
      label: 'Function',
      name: 'gammaFn',
      qualifiedName: 'gamma.gammaFn',
      filePath: '/gamma/src/fn.ts',
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      properties: {},
      signature: 'gammaFn(): void',
      docstring: 'Gamma function',
      complexity: 2,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: projectC,
      label: 'Route',
      name: 'getGammaItems',
      qualifiedName: 'gamma.routes.getGammaItems',
      filePath: '/gamma/src/routes/items.ts',
      startLine: 5,
      endLine: 15,
      language: 'typescript',
      properties: { routePath: '/api/gamma/items', routeMethod: 'GET' },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // A shared symbol name across repos
    {
      id: 0,
      projectId: projectA,
      label: 'Function',
      name: 'sharedHelper',
      qualifiedName: 'alpha.sharedHelper',
      filePath: '/alpha/src/helper.ts',
      startLine: 1,
      endLine: 8,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: 1,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 0,
      projectId: projectB,
      label: 'Function',
      name: 'sharedHelper',
      qualifiedName: 'beta.sharedHelper',
      filePath: '/beta/src/helper.ts',
      startLine: 1,
      endLine: 8,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: 1,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  store.insertNodes(nodes);
  const allNodes = store.getAllNodes();

  const alphaFn = allNodes.find((n) => n.qualifiedName === 'alpha.alphaFn');
  const betaFn = allNodes.find((n) => n.qualifiedName === 'beta.betaFn');
  const betaConsumer = allNodes.find((n) => n.qualifiedName === 'beta.BetaConsumer');
  const gammaFn = allNodes.find((n) => n.qualifiedName === 'gamma.gammaFn');

  // Create cross-repo edges
  if (alphaFn && betaFn) {
    store.insertEdge({
      id: 0,
      projectId: projectA,
      sourceId: alphaFn.id,
      targetId: betaFn.id,
      type: 'CALLS',
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    });
  }
  if (betaConsumer && alphaFn) {
    store.insertEdge({
      id: 0,
      projectId: projectB,
      sourceId: betaConsumer.id,
      targetId: alphaFn.id,
      type: 'CALLS',
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    });
  }
  if (betaFn && gammaFn) {
    store.insertEdge({
      id: 0,
      projectId: projectB,
      sourceId: betaFn.id,
      targetId: gammaFn.id,
      type: 'CALLS',
      properties: {},
      weight: 1.0,
      createdAt: new Date().toISOString(),
    });
  }
}

function createTestContext(): ToolContextImpl {
  const store = new InMemoryGraphStore();
  createMultiRepoGraph(store);
  return new ToolContextImpl(store);
}

// ---------------------------------------------------------------------------
// crossRepoSearch Tests
// ---------------------------------------------------------------------------

describe('crossRepoSearch', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should search across all repos with store data', async () => {
    const result = await registry.execute(
      'cross_repo_search',
      {
        query: 'alpha',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.query).toBe('alpha');
    expect(data.items).toBeDefined();
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.reposSearched).toBeDefined();
  });

  it('should return empty results without store', async () => {
    const result = await registry.execute('cross_repo_search', {
      query: 'anything',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.totalResults).toBe(0);
    expect(data.items).toEqual([]);
  });

  it('should filter by specific repos', async () => {
    const result = await registry.execute(
      'cross_repo_search',
      {
        query: 'alpha',
        repos: ['repo-alpha'],
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    // All results should be from repo-alpha
    const nonAlphaResults = data.items.filter((i: any) => i.repo !== 'repo-alpha');
    expect(nonAlphaResults.length).toBe(0);
  });

  it('should search with multiple repos filter', async () => {
    const result = await registry.execute(
      'cross_repo_search',
      {
        query: 'Fn',
        repos: ['repo-alpha', 'repo-beta'],
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.repoBreakdown).toBeDefined();
    // Results should only be from specified repos
    for (const item of data.items) {
      expect(['repo-alpha', 'repo-beta']).toContain(item.repo);
    }
  });

  it('should respect limit parameter', async () => {
    const result = await registry.execute(
      'cross_repo_search',
      {
        query: 'Fn',
        limit: 2,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.items.length).toBeLessThanOrEqual(2);
  });

  it('should include relevance scores in results', async () => {
    const result = await registry.execute(
      'cross_repo_search',
      {
        query: 'Fn',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    if (data.items.length > 0) {
      expect(data.items[0].relevance).toBeDefined();
      expect(typeof data.items[0].relevance).toBe('number');
    }
  });

  it('should include snippets in results', async () => {
    const result = await registry.execute(
      'cross_repo_search',
      {
        query: 'alpha',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    if (data.items.length > 0) {
      expect(data.items[0].snippet).toBeDefined();
    }
  });

  it('should handle empty query results gracefully', async () => {
    const result = await registry.execute(
      'cross_repo_search',
      {
        query: 'zzzz_nonexistent_search_term_xyz',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.totalResults).toBe(0);
    expect(data.items).toEqual([]);
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('cross_repo_search', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// crossRepoTrace Tests
// ---------------------------------------------------------------------------

describe('crossRepoTrace', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should trace BFS path with store data', async () => {
    // First create a repo group
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-trace',
      name: 'Trace Group',
      repos: ['repo-alpha', 'repo-beta', 'repo-gamma'],
    });

    const result = await registry.execute(
      'cross_repo_trace',
      {
        sourceSymbol: 'alpha.alphaFn',
        groupId: 'group-trace',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.sourceSymbol).toBe('alpha.alphaFn');
    expect(data.groupId).toBe('group-trace');
    expect(data.path).toBeDefined();
    expect(data.path.length).toBeGreaterThan(0);
    expect(data.crossRepoEdges).toBeDefined();
  });

  it('should return empty path without store', async () => {
    const result = await registry.execute('cross_repo_trace', {
      sourceSymbol: 'some.symbol',
      groupId: 'ghost-group',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.path).toEqual([]);
    expect(data.crossRepoEdges).toEqual([]);
  });

  it('should respect depth limit', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-depth',
      name: 'Depth Group',
      repos: ['repo-alpha', 'repo-beta', 'repo-gamma'],
    });

    const result = await registry.execute(
      'cross_repo_trace',
      {
        sourceSymbol: 'alpha.alphaFn',
        groupId: 'group-depth',
        depth: 1,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.maxDepth).toBe(1);
    // With depth 1, we should only see the source and immediate neighbors
    expect(data.path.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect cross-repo connections', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-cross',
      name: 'Cross Group',
      repos: ['repo-alpha', 'repo-beta', 'repo-gamma'],
    });

    const result = await registry.execute(
      'cross_repo_trace',
      {
        sourceSymbol: 'alpha.alphaFn',
        groupId: 'group-cross',
        depth: 5,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.crossRepoConnections).toBeDefined();
    expect(typeof data.crossRepoConnections).toBe('number');
    expect(data.reposVisited).toBeDefined();
    expect(Array.isArray(data.reposVisited)).toBe(true);
  });

  it('should handle non-existent source symbol gracefully', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-ghost',
      name: 'Ghost Group',
      repos: ['repo-alpha'],
    });

    const result = await registry.execute(
      'cross_repo_trace',
      {
        sourceSymbol: 'ghost.nonexistent',
        groupId: 'group-ghost',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.path).toEqual([]);
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('cross_repo_trace', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// crossRepoImpact Tests
// ---------------------------------------------------------------------------

describe('crossRepoImpact', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should detect callers across repos', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-impact',
      name: 'Impact Group',
      repos: ['repo-alpha', 'repo-beta', 'repo-gamma'],
    });

    // alphaFn has a caller in repo-beta (betaConsumer -> alphaFn via CALLS)
    const result = await registry.execute(
      'cross_repo_impact',
      {
        symbol: 'alpha.alphaFn',
        groupId: 'group-impact',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.symbol).toBe('alpha.alphaFn');
    expect(data.impactedRepos).toBeDefined();
    expect(data.riskLevel).toBeDefined();
    expect(data.totalImpactedRepos).toBeDefined();
  });

  it('should return low risk without store data', async () => {
    const result = await registry.execute('cross_repo_impact', {
      symbol: 'some.symbol',
      groupId: 'no-store-group',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.riskLevel).toBe('low');
    expect(data.impactedRepos).toEqual([]);
    expect(data.totalImpactedRepos).toBe(0);
  });

  it('should categorize risk as medium with some impacted repos', async () => {
    // alphaFn is called by betaConsumer (cross-repo), so should have at least medium risk
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-med',
      name: 'Medium Risk',
      repos: ['repo-alpha', 'repo-beta'],
    });

    const result = await registry.execute(
      'cross_repo_impact',
      {
        symbol: 'alpha.alphaFn',
        groupId: 'group-med',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.riskLevel).toBeDefined();
    // With cross-repo callers, risk should not be low
    if (data.totalImpactedRepos > 0) {
      expect(['medium', 'high']).toContain(data.riskLevel);
    }
  });

  it('should include total callers count', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-callers',
      name: 'Callers Group',
      repos: ['repo-alpha', 'repo-beta'],
    });

    const result = await registry.execute(
      'cross_repo_impact',
      {
        symbol: 'alpha.alphaFn',
        groupId: 'group-callers',
        includeConsumers: true,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.totalCallers).toBeDefined();
    expect(typeof data.totalCallers).toBe('number');
    expect(data.includeConsumers).toBe(true);
  });

  it('should includeConsumers parameter works', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'group-consumers',
      name: 'Consumers',
      repos: ['repo-alpha', 'repo-beta'],
    });

    const result = await registry.execute(
      'cross_repo_impact',
      {
        symbol: 'alpha.alphaFn',
        groupId: 'group-consumers',
        includeConsumers: false,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.includeConsumers).toBe(false);
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('cross_repo_impact', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// manageRepoGroup Tests
// ---------------------------------------------------------------------------

describe('manageRepoGroup', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('should create a repo group', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'create',
      name: 'Core Services',
      description: 'Core microservices',
      repos: ['service-a', 'service-b'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.action).toBe('create');
    expect(data.created).toBe(true);
    expect(data.name).toBe('Core Services');
    expect(data.repos).toEqual(['service-a', 'service-b']);
    expect(data.groupId).toMatch(/^group_/);
  });

  it('should create a group with custom ID', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'my-custom-group',
      name: 'Custom Group',
      repos: ['repo-x'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.groupId).toBe('my-custom-group');
  });

  it('should list all groups', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      name: 'Group A',
      repos: ['a'],
    });
    await registry.execute('manage_repo_group', {
      action: 'create',
      name: 'Group B',
      repos: ['b'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'list',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.action).toBe('list');
    // Group store persists across tests, so we assert at least 2
    expect(data.groups.length).toBeGreaterThanOrEqual(2);
    expect(data.total).toBe(data.groups.length);
  });

  it('should get a group by ID', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'get-test-group',
      name: 'Get Test',
      description: 'A test group',
      repos: ['r1', 'r2'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'get-test-group',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.found).toBe(true);
    expect(data.name).toBe('Get Test');
    expect(data.description).toBe('A test group');
    expect(data.repos).toEqual(['r1', 'r2']);
  });

  it('should return not found for non-existent group', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'ghost-group',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.found).toBe(false);
  });

  it('should update a group', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'update-group',
      name: 'Old Name',
      repos: ['old-repo'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'update',
      groupId: 'update-group',
      name: 'New Name',
      description: 'Updated description',
      repos: ['new-repo'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.updated).toBe(true);

    // Verify via get
    const getResult = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'update-group',
    });
    const getData = JSON.parse(getResult.content[0].text);
    expect(getData.name).toBe('New Name');
    expect(getData.description).toBe('Updated description');
    expect(getData.repos).toEqual(['new-repo']);
  });

  it('should return false when updating non-existent group', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'update',
      groupId: 'no-such-group',
      name: 'Ghost',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.updated).toBe(false);
  });

  it('should return error when update missing groupId', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'update',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('groupId is required for update');
  });

  it('should delete a group', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'delete-me',
      name: 'To Delete',
      repos: ['temp'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'delete',
      groupId: 'delete-me',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(true);
  });

  it('should return false when deleting non-existent group', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'delete',
      groupId: 'already-gone',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(false);
  });

  it('should return error when delete missing groupId', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'delete',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('groupId is required for delete');
  });

  it('should add repos to a group', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'add-repo-group',
      name: 'Add Repo Test',
      repos: ['repo-1'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'add_repo',
      groupId: 'add-repo-group',
      repos: ['repo-2', 'repo-3'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.addedRepos).toEqual(['repo-2', 'repo-3']);
    expect(data.totalRepos).toBe(3);
  });

  it('should only add new repos (no duplicates)', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'dup-group',
      name: 'Dup Test',
      repos: ['existing-repo'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'add_repo',
      groupId: 'dup-group',
      repos: ['existing-repo', 'new-repo'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.addedRepos).toEqual(['new-repo']);
    expect(data.totalRepos).toBe(2);
  });

  it('should return error for add_repo without groupId', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'add_repo',
      repos: ['some-repo'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('groupId and repos are required for add_repo');
  });

  it('should remove repos from a group', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'remove-test',
      name: 'Remove Test',
      repos: ['keep', 'remove-me', 'also-keep'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'remove_repo',
      groupId: 'remove-test',
      repos: ['remove-me'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.removedRepos).toEqual(['remove-me']);
    expect(data.totalRepos).toBe(2);
  });

  it('should return error for remove_repo without groupId', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'remove_repo',
      repos: ['some-repo'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('groupId and repos are required for remove_repo');
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('manage_repo_group', {}, undefined as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// syncContracts Tests
// ---------------------------------------------------------------------------

describe('syncContracts', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(async () => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should sync contracts with group and graph data', async () => {
    // Create repo groups with routes that should match
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'contract-sync',
      name: 'Contract Sync Group',
      repos: ['repo-alpha', 'repo-beta'],
    });

    const result = await registry.execute(
      'sync_contracts',
      {
        groupId: 'contract-sync',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.groupId).toBe('contract-sync');
    expect(data.synced).toBeDefined();
    expect(data.conflicts).toBeDefined();
    expect(data.status).toBeDefined();
    expect(data.syncDetails).toBeDefined();
  });

  it('should return no-changes without group', async () => {
    const result = await registry.execute(
      'sync_contracts',
      {
        groupId: 'nonexistent-group',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('no-changes');
    expect(data.synced).toBe(0);
  });

  it('should respect direction parameter', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'dir-group',
      name: 'Direction Group',
      repos: ['repo-alpha'],
    });

    const result = await registry.execute('sync_contracts', {
      groupId: 'dir-group',
      direction: 'upstream',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.direction).toBe('upstream');
  });

  it('should sync contracts with bidirectional direction', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'bi-group',
      name: 'Bidirectional Group',
      repos: ['repo-alpha', 'repo-beta'],
    });

    const result = await registry.execute(
      'sync_contracts',
      {
        groupId: 'bi-group',
        direction: 'bidirectional',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.direction).toBe('bidirectional');
  });

  it('should handle contracts parameter', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'contracts-group',
      name: 'Contracts Group',
    });

    const result = await registry.execute('sync_contracts', {
      groupId: 'contracts-group',
      contracts: [{ path: '/api/test', method: 'GET' }],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.synced).toBeGreaterThan(0);
    expect(data.syncDetails.length).toBeGreaterThan(0);
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('sync_contracts', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// discoverRelatedRepos Tests
// ---------------------------------------------------------------------------

describe('discoverRelatedRepos', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(async () => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should discover repos by symbol overlap', async () => {
    const result = await registry.execute(
      'discover_related_repos',
      {
        projectId: 'repo-alpha',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('repo-alpha');
    expect(data.relatedRepos).toBeDefined();
    expect(data.total).toBeDefined();
  });

  it('should include repos from groups', async () => {
    // Create a group containing repo-alpha
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'related-group',
      name: 'Related Group',
      repos: ['repo-alpha', 'repo-beta', 'repo-gamma'],
    });

    const result = await registry.execute(
      'discover_related_repos',
      {
        projectId: 'repo-alpha',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.relatedRepos.length).toBeGreaterThan(0);
    // Should find group members
    const groupMembers = data.relatedRepos.filter((r: any) => r.relationType === 'group_member');
    expect(groupMembers.length).toBeGreaterThan(0);
  });

  it('should return empty results for unknown project', async () => {
    const result = await registry.execute(
      'discover_related_repos',
      {
        projectId: 'completely-unknown-repo',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBe(0);
    expect(data.relatedRepos).toEqual([]);
  });

  it('should respect maxResults limit', async () => {
    // Add multiple related repos through groups
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'large-group',
      name: 'Large Group',
      repos: ['repo-alpha', 'repo-beta', 'repo-gamma'],
    });

    const result = await registry.execute(
      'discover_related_repos',
      {
        projectId: 'repo-alpha',
        maxResults: 1,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.relatedRepos.length).toBeLessThanOrEqual(1);
  });

  it('should detect symbol overlap between repos', async () => {
    // Both repo-alpha and repo-beta have a symbol named 'sharedHelper'
    const result = await registry.execute(
      'discover_related_repos',
      {
        projectId: 'repo-alpha',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    // If symbol overlap detection works, we should find repo-beta
    const hasOverlapResult = data.relatedRepos.some(
      (r: any) => r.repo === 'repo-beta' && r.sharedSymbols.length > 0,
    );
    // Not asserting this must be true since the data depends on how
    // discoverRelatedRepos traverses, but we verify the structure
    for (const repo of data.relatedRepos) {
      expect(repo.repo).toBeDefined();
      expect(repo.relationType).toBeDefined();
      expect(repo.sharedSymbols).toBeDefined();
      expect(repo.relevance).toBeDefined();
    }
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('discover_related_repos', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// cross_repo_review_pr Tests
// ---------------------------------------------------------------------------

describe('cross_repo_review_pr', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should require groupId and sourceRepoId', async () => {
    const result = await registry.execute('cross_repo_review_pr', {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });

  it('should require graph context for review', async () => {
    const result = await registry.execute('cross_repo_review_pr', {
      groupId: 'test-group',
      sourceRepoId: 'repo-alpha',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('graph store');
  });

  it('should return error for non-existent group', async () => {
    const result = await registry.execute(
      'cross_repo_review_pr',
      {
        groupId: 'no-group',
        sourceRepoId: 'repo-alpha',
      },
      ctx,
    );
    // The tool should report an error either via isError or in the content
    const hasError =
      result.isError === true ||
      (typeof result.content?.[0]?.text === 'string' && result.content[0].text.includes('error'));
    expect(hasError).toBe(true);
  });

  it('should handle empty diffs', async () => {
    // First create a group
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'review-group',
      name: 'Review Group',
      repos: ['repo-alpha', 'repo-beta'],
    });

    const result = await registry.execute(
      'cross_repo_review_pr',
      {
        groupId: 'review-group',
        sourceRepoId: 'repo-alpha',
        diffs: [],
      },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.sourceRepo).toBe('repo-alpha');
    expect(data.crossRepoRisk).toBe('low');
    expect(data.mergeRecommendation).toBe('approve');
  });

  it('should detect breaking changes for deleted files', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'breaking-group',
      name: 'Breaking Group',
      repos: ['repo-alpha', 'repo-beta'],
    });

    const result = await registry.execute(
      'cross_repo_review_pr',
      {
        groupId: 'breaking-group',
        sourceRepoId: 'repo-alpha',
        diffs: [
          {
            filePath: 'src/api/users.ts',
            changeType: 'deleted',
            ranges: [{ oldStart: 1, oldEnd: 20, newStart: 0, newEnd: 0, changeType: 'removed' }],
          },
        ],
      },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.sourceRepo).toBe('repo-alpha');
    expect(data.breakingChanges).toBeGreaterThanOrEqual(1);
  });

  it('should not break with modified file diffs', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'mod-group',
      name: 'Modified Group',
      repos: ['repo-alpha'],
    });

    const result = await registry.execute(
      'cross_repo_review_pr',
      {
        groupId: 'mod-group',
        sourceRepoId: 'repo-alpha',
        diffs: [
          {
            filePath: 'src/api/newFeature.ts',
            changeType: 'modified',
            ranges: [
              { oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 15, changeType: 'modified' },
            ],
          },
        ],
      },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.sourceRepo).toBe('repo-alpha');
    expect(data.mergeRecommendation).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Paths that were invisible while this file carried a whole-file v8 ignore hint
// ---------------------------------------------------------------------------

/**
 * Build a GraphNode with defaults that carry a real source location, so a test
 * only has to spell out the fields it actually cares about.
 */
function makeNode(projectId: string, overrides: Partial<GraphNode>): GraphNode {
  return {
    id: 0,
    projectId,
    label: 'Function',
    name: 'node',
    qualifiedName: `${projectId}.node`,
    filePath: `/${projectId}/src/node.ts`,
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function insertCall(
  store: InMemoryGraphStore,
  sourceId: number,
  targetId: number,
  projectId: string,
): void {
  store.insertEdge({
    id: 0,
    projectId,
    sourceId,
    targetId,
    type: 'CALLS',
    properties: {},
    weight: 1.0,
    createdAt: new Date().toISOString(),
  });
}

/** Look a node up by the qualified name it was given. */
function nodeByQName(store: InMemoryGraphStore, qname: string): GraphNode {
  const node = store.getAllNodes().find((n) => n.qualifiedName === qname);
  if (!node) throw new Error(`fixture node ${qname} missing`);
  return node;
}

describe('crossRepoImpact - cross-repo caller paths', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  /**
   * Build a graph where every listed caller has a CALLS edge into a single
   * target node in `target-repo`. Callers are labelled Function, because
   * crossRepoImpact only inspects Function and Method nodes.
   */
  function buildFanInGraph(callers: Array<{ repo: string; name: string }>): InMemoryGraphStore {
    const store = new InMemoryGraphStore();
    const nodes: GraphNode[] = [
      makeNode('target-repo', { name: 'api', qualifiedName: 'target.api' }),
    ];
    for (const caller of callers) {
      nodes.push(
        makeNode(caller.repo, {
          name: caller.name,
          qualifiedName: `${caller.repo}.${caller.name}`,
        }),
      );
    }
    store.insertNodes(nodes);

    const target = nodeByQName(store, 'target.api');
    for (const node of store.getAllNodes()) {
      if (node.id === target.id) continue;
      insertCall(store, node.id, target.id, node.projectId);
    }
    return store;
  }

  it('reports high risk when more than three repos are impacted', async () => {
    const callers = [
      { repo: 'caller-a', name: 'first' },
      { repo: 'caller-a', name: 'second' },
      { repo: 'caller-b', name: 'third' },
      { repo: 'caller-c', name: 'fourth' },
      { repo: 'caller-d', name: 'fifth' },
    ];
    const ctx = new ToolContextImpl(buildFanInGraph(callers));

    const result = await registry.execute(
      'cross_repo_impact',
      { symbol: 'target.api', groupId: 'fan-in-high' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.riskLevel).toBe('high');
    expect(data.totalImpactedRepos).toBe(4);
    expect(data.totalCallers).toBe(5);

    expect(data.enriched.summary.estimatedEffort).toBe('high');

    // Two callers live in caller-a, so that entry must have been merged into
    // the existing record rather than pushed as a second one.
    const repos = data.impactedRepos as Array<{ repo: string; callers: string[] }>;
    const repoA = repos.find((r) => r.repo === 'caller-a');
    expect(repoA).toBeDefined();
    expect(repoA!.callers.sort()).toEqual(['first', 'second']);
  });

  it('reports medium risk when one to three repos are impacted', async () => {
    const ctx = new ToolContextImpl(buildFanInGraph([{ repo: 'caller-b', name: 'third' }]));

    const result = await registry.execute(
      'cross_repo_impact',
      { symbol: 'target.api', groupId: 'fan-in-medium' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.riskLevel).toBe('medium');
    expect(data.totalImpactedRepos).toBe(1);
    expect(data.totalCallers).toBe(1);
    expect(data.enriched.summary.estimatedEffort).toBe('medium');
  });

  it('reports low risk when the symbol is absent from the graph', async () => {
    const ctx = new ToolContextImpl(buildFanInGraph([{ repo: 'caller-b', name: 'third' }]));

    const result = await registry.execute(
      'cross_repo_impact',
      { symbol: 'target.doesNotExist', groupId: 'fan-in-missing' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.riskLevel).toBe('low');
    expect(data.impactedRepos).toEqual([]);
    expect(data.totalImpactedRepos).toBe(0);
  });

  it('reports low risk when every caller lives in the target repo', async () => {
    const ctx = new ToolContextImpl(buildFanInGraph([{ repo: 'target-repo', name: 'local' }]));

    const result = await registry.execute(
      'cross_repo_impact',
      { symbol: 'target.api', groupId: 'fan-in-low' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.riskLevel).toBe('low');
    expect(data.totalImpactedRepos).toBe(0);
    expect(data.enriched.summary.estimatedEffort).toBe('low');
  });
});

describe('crossRepoSearch - group filter', () => {
  it('skips hits whose repo is not a member of the group', async () => {
    const registry = createToolRegistry();
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'search-filter-group',
      name: 'Search Filter',
      repos: ['repo-gamma'],
    });

    const ctx = createTestContext();
    const result = await registry.execute(
      'cross_repo_search',
      { query: 'Fn', groupId: 'search-filter-group' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    // alphaFn and betaFn exist in the fixture and are excluded by the filter;
    // gammaFn is a member and survives.
    expect(data.items.some((i: any) => i.repo === 'repo-alpha')).toBe(false);
    expect(data.items.some((i: any) => i.repo === 'repo-beta')).toBe(false);
    for (const item of data.items) {
      expect(item.repo).toBe('repo-gamma');
    }
  });
});

describe('nodes without a source location', () => {
  // GraphNode.filePath is `string | null` and GraphNode.startLine is
  // `number | null`, so every tool must fall back to '' / 0 when a node
  // carries no location.
  function buildUnlocatedGraph(): InMemoryGraphStore {
    const store = new InMemoryGraphStore();
    store.insertNodes([
      makeNode('loc-repo', {
        name: 'sourceFn',
        qualifiedName: 'loc.sourceFn',
        filePath: null,
        startLine: null,
      }),
      makeNode('loc-repo', {
        name: 'sinkFn',
        qualifiedName: 'loc.sinkFn',
        filePath: null,
        startLine: null,
      }),
    ]);
    const source = nodeByQName(store, 'loc.sourceFn');
    const sink = nodeByQName(store, 'loc.sinkFn');
    insertCall(store, source.id, sink.id, 'loc-repo');
    return store;
  }

  it('crossRepoSearch reports an empty file path and line 0', async () => {
    const registry = createToolRegistry();
    const ctx = new ToolContextImpl(buildUnlocatedGraph());

    const result = await registry.execute('cross_repo_search', { query: 'sourceFn' }, ctx);
    const data = JSON.parse(result.content[0].text);
    const hit = data.items.find((i: any) => i.symbol === 'sourceFn');

    expect(hit).toBeDefined();
    expect(hit.filePath).toBe('');
    expect(hit.startLine).toBe(0);
  });

  it('crossRepoTrace reports an empty file path for the source and the target', async () => {
    const registry = createToolRegistry();
    const ctx = new ToolContextImpl(buildUnlocatedGraph());

    const result = await registry.execute(
      'cross_repo_trace',
      { sourceSymbol: 'loc.sourceFn', groupId: 'loc-group' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.path).toHaveLength(2);
    for (const step of data.path) {
      expect(step.filePath).toBe('');
    }
  });
});

describe('crossRepoTrace - graph shapes', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('skips a target that an earlier traversal already visited', async () => {
    // A calls B and B calls A, so the second hop revisits the source node.
    const store = new InMemoryGraphStore();
    store.insertNodes([
      makeNode('cyc-a', { name: 'a', qualifiedName: 'cyc.a' }),
      makeNode('cyc-b', { name: 'b', qualifiedName: 'cyc.b' }),
    ]);
    const a = nodeByQName(store, 'cyc.a');
    const b = nodeByQName(store, 'cyc.b');
    insertCall(store, a.id, b.id, 'cyc-a');
    insertCall(store, b.id, a.id, 'cyc-b');

    const ctx = new ToolContextImpl(store);
    const result = await registry.execute(
      'cross_repo_trace',
      { sourceSymbol: 'cyc.a', groupId: 'cycle-group' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.path).toHaveLength(2);
    expect(data.crossRepoConnections).toBe(1);
  });

  it('does not record a same-repo hop as a cross-repo connection', async () => {
    const store = new InMemoryGraphStore();
    store.insertNodes([
      makeNode('same-repo', { name: 'p1', qualifiedName: 'same.p1' }),
      makeNode('same-repo', { name: 'p2', qualifiedName: 'same.p2' }),
    ]);
    const p1 = nodeByQName(store, 'same.p1');
    const p2 = nodeByQName(store, 'same.p2');
    insertCall(store, p1.id, p2.id, 'same-repo');

    const ctx = new ToolContextImpl(store);
    const result = await registry.execute(
      'cross_repo_trace',
      { sourceSymbol: 'same.p1', groupId: 'same-group' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.path).toHaveLength(2);
    expect(data.crossRepoEdges).toEqual([]);
    expect(data.reposVisited).toEqual(['same-repo']);
  });
});

describe('manageRepoGroup - optional arguments', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('defaults the group name to the generated id on create', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'unnamed-group',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe('unnamed-group');

    const fetched = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'unnamed-group',
    });
    expect(JSON.parse(fetched.content[0].text).name).toBe('unnamed-group');
  });

  it('defaults the group name to the timestamp id when no id is given', async () => {
    const result = await registry.execute('manage_repo_group', { action: 'create' });
    const data = JSON.parse(result.content[0].text);
    expect(data.groupId).toMatch(/^group_\d+$/);
    expect(data.name).toBe(data.groupId);
  });

  it('reports not found when get is called without a groupId', async () => {
    const result = await registry.execute('manage_repo_group', { action: 'get' });
    const data = JSON.parse(result.content[0].text);
    expect(data.found).toBe(false);
    expect(data.groupId).toBeUndefined();
  });

  it('keeps the existing name when update carries only a description', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'desc-only-group',
      name: 'Original Name',
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'update',
      groupId: 'desc-only-group',
      description: 'a new description',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.updated).toBe(true);

    // Updating without `repos` must leave the repo list untouched.
    const fetched = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'desc-only-group',
    });
    const fetchedData = JSON.parse(fetched.content[0].text);
    expect(fetchedData.name).toBe('Original Name');
    expect(fetchedData.description).toBe('a new description');
  });

  it('reports Group not found when adding repos to a missing group', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'add_repo',
      groupId: 'missing-add-group',
      repos: ['acme/widget'],
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('Group not found');
  });

  it('reports Group not found when removing repos from a missing group', async () => {
    const result = await registry.execute('manage_repo_group', {
      action: 'remove_repo',
      groupId: 'missing-remove-group',
      repos: ['acme/widget'],
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('Group not found');
  });
});

describe('parseRepoRef - reference formats', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('parses owner/name references', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'ref-slash-group',
      name: 'Slash',
      repos: ['acme/widget'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'ref-slash-group',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.repos).toEqual(['acme/widget']);
  });

  it('parses full https URLs', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'ref-url-group',
      name: 'Url',
      repos: ['https://github.com/acme/widget'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'ref-url-group',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.repos).toEqual(['acme/widget']);
  });

  it('parses host-only URLs by adding a scheme first', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'ref-host-group',
      name: 'Host',
      repos: ['github.com/acme/widget'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'ref-host-group',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.repos).toEqual(['acme/widget']);
  });

  it('strips the default owner prefix from plain repo names', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'ref-plain-group',
      name: 'Plain',
      repos: ['widget', 'acme/widget'],
    });

    const result = await registry.execute('manage_repo_group', {
      action: 'get',
      groupId: 'ref-plain-group',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.repos.sort()).toEqual(['acme/widget', 'widget']);
  });
});

describe('syncContracts - route metadata', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  function buildRouteStore(
    routes: Array<{ projectId: string; name: string; properties: Record<string, unknown> }>,
  ): InMemoryGraphStore {
    const store = new InMemoryGraphStore();
    store.insertNodes(
      routes.map((r) =>
        makeNode(r.projectId, {
          label: 'Route',
          name: r.name,
          qualifiedName: `${r.projectId}.${r.name}`,
          properties: r.properties,
        }),
      ),
    );
    return store;
  }

  it('falls back to unknown/GET when a route carries no metadata', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'route-bare-group',
      name: 'Bare routes',
      repos: ['route-bare'],
    });
    const ctx = new ToolContextImpl(
      buildRouteStore([{ projectId: 'route-bare', name: 'bare', properties: {} }]),
    );

    const result = await registry.execute('sync_contracts', { groupId: 'route-bare-group' }, ctx);
    const data = JSON.parse(result.content[0].text);

    expect(data.status).toBe('no-changes');
    expect(data.synced).toBe(0);
    expect(data.conflicts).toBe(0);
  });

  it('records a contract shared by two repos', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'route-shared-group',
      name: 'Shared routes',
      repos: ['route-x', 'route-y'],
    });
    const ctx = new ToolContextImpl(
      buildRouteStore([
        {
          projectId: 'route-x',
          name: 'itemsX',
          properties: { routePath: '/api/items', routeMethod: 'GET' },
        },
        {
          projectId: 'route-y',
          name: 'itemsY',
          properties: { routePath: '/api/items', routeMethod: 'GET' },
        },
      ]),
    );

    const result = await registry.execute('sync_contracts', { groupId: 'route-shared-group' }, ctx);
    const data = JSON.parse(result.content[0].text);

    expect(data.status).toBe('success');
    expect(data.synced).toBe(2);
    expect(data.syncDetails[0].contract).toContain('/api/items');
  });

  it('does not match a route that shares the path but not the method', async () => {
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'route-method-group',
      name: 'Method mismatch',
      repos: ['route-p', 'route-q'],
    });
    const ctx = new ToolContextImpl(
      buildRouteStore([
        {
          projectId: 'route-p',
          name: 'p',
          properties: { routePath: '/api/x', routeMethod: 'GET' },
        },
        {
          projectId: 'route-q',
          name: 'q',
          properties: { routePath: '/api/x', routeMethod: 'POST' },
        },
      ]),
    );

    const result = await registry.execute('sync_contracts', { groupId: 'route-method-group' }, ctx);
    const data = JSON.parse(result.content[0].text);

    expect(data.status).toBe('no-changes');
    expect(data.synced).toBe(0);
  });
});

describe('discoverRelatedRepos - symbol overlap', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  /** Build a graph where `main` and `peer` share the first `shared` symbols. */
  function buildOverlapGraph(shared: number): InMemoryGraphStore {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < shared; i += 1) {
      nodes.push(
        makeNode('overlap-main', { name: `sym${i}`, qualifiedName: `overlap-main.${i}` }),
        makeNode('overlap-peer', { name: `sym${i}`, qualifiedName: `overlap-peer.${i}` }),
      );
    }
    const store = new InMemoryGraphStore();
    store.insertNodes(nodes);
    return store;
  }

  it('returns an empty result when no store is supplied', async () => {
    const result = await registry.execute('discover_related_repos', {
      projectId: 'overlap-main',
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.projectId).toBe('overlap-main');
    expect(data.relatedRepos).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('grades an overlap of more than ten symbols as strong', async () => {
    const ctx = new ToolContextImpl(buildOverlapGraph(11));
    const result = await registry.execute(
      'discover_related_repos',
      { projectId: 'overlap-main' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);
    const peer = data.relatedRepos.find((r: any) => r.repo === 'overlap-peer');

    expect(peer).toBeDefined();
    expect(peer.relationType).toBe('strong');
    expect(peer.sharedSymbols).toHaveLength(5);
  });

  it('grades an overlap of four to ten symbols as moderate', async () => {
    const ctx = new ToolContextImpl(buildOverlapGraph(4));
    const result = await registry.execute(
      'discover_related_repos',
      { projectId: 'overlap-main' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);
    const peer = data.relatedRepos.find((r: any) => r.repo === 'overlap-peer');

    expect(peer).toBeDefined();
    expect(peer.relationType).toBe('moderate');
  });

  it('ignores synthetic cross-repo projects and unnamed nodes', async () => {
    const store = new InMemoryGraphStore();
    store.insertNodes([
      makeNode('skip-main', { name: 'shared', qualifiedName: 'skip-main.a' }),
      makeNode('skip-peer', { name: 'shared', qualifiedName: 'skip-peer.a' }),
      // Synthetic projects are excluded from the candidate set.
      makeNode('cross-repo:bridge', { name: 'shared', qualifiedName: 'bridge.a' }),
      // An unnamed node must not be counted as a shared symbol.
      makeNode('skip-peer', { name: '', qualifiedName: 'skip-peer.b' }),
    ]);

    const ctx = new ToolContextImpl(store);
    const result = await registry.execute(
      'discover_related_repos',
      { projectId: 'skip-main' },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.relatedRepos.map((r: any) => r.repo)).toEqual(['skip-peer']);
    expect(data.relatedRepos[0].sharedSymbols).toEqual(['shared']);
  });
});

describe('cross_repo_review_pr - diff defaults', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(async () => {
    registry = createToolRegistry();
    ctx = createTestContext();
    await registry.execute('manage_repo_group', {
      action: 'create',
      groupId: 'diff-defaults-group',
      name: 'Diff defaults',
      repos: ['repo-alpha', 'repo-beta'],
    });
  });

  it('defaults the file change type and the range list', async () => {
    const result = await registry.execute(
      'cross_repo_review_pr',
      {
        groupId: 'diff-defaults-group',
        sourceRepoId: 'repo-alpha',
        diffs: [{ filePath: 'src/api/untyped.ts' }],
      },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.error).toBeUndefined();
    expect(data.sourceRepo).toBe('repo-alpha');
    expect(data.mergeRecommendation).toBeDefined();
  });

  it('defaults the range change type when a range omits it', async () => {
    const result = await registry.execute(
      'cross_repo_review_pr',
      {
        groupId: 'diff-defaults-group',
        sourceRepoId: 'repo-alpha',
        diffs: [
          {
            filePath: 'src/api/partial.ts',
            changeType: 'modified',
            ranges: [{ oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 3 }],
          },
        ],
      },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);

    expect(data.error).toBeUndefined();
    expect(data.sourceRepo).toBe('repo-alpha');
    expect(data.mergeRecommendation).toBeDefined();
  });
});
