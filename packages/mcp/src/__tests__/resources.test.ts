// @code-analyzer/mcp — ResourceProvider Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceProvider, registerResources } from '../resources/index.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

function makeStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

function addNodes(store: InMemoryGraphStore): void {
  const nodes: GraphNode[] = [
    {
      projectId: 'test-project',
      label: 'Function',
      name: 'calculateTotal',
      qualifiedName: 'src/utils.ts::calculateTotal',
      filePath: 'src/utils.ts',
      startLine: 10,
      endLine: 25,
      language: 'typescript',
      properties: { clusterId: 'cluster-utils', routeMethod: 'GET', routePath: '/api/total' },
      signature: 'calculateTotal(items: number[]): number',
      docstring: 'Calculates the total sum of items',
      complexity: 5,
      isExported: true,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    },
    {
      projectId: 'test-project',
      label: 'Class',
      name: 'Logger',
      qualifiedName: 'src/logger.ts::Logger',
      filePath: 'src/logger.ts',
      startLine: 1,
      endLine: 50,
      language: 'typescript',
      properties: { clusterId: 'cluster-logging' },
      signature: null,
      docstring: 'Application logger',
      complexity: 3,
      isExported: true,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      label: 'EntryPoint',
      name: 'main',
      qualifiedName: 'src/index.ts::main',
      filePath: 'src/index.ts',
      startLine: 5,
      endLine: 20,
      language: 'typescript',
      properties: { isEntrypoint: 'true' },
      signature: null,
      docstring: null,
      complexity: 2,
      isExported: true,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      label: 'Function',
      name: 'complexAlgorithm',
      qualifiedName: 'src/algo.ts::complexAlgorithm',
      filePath: 'src/algo.ts',
      startLine: 10,
      endLine: 100,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: 20,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      label: 'ADR',
      name: 'ADR-001-Use-PostgreSQL',
      qualifiedName: 'docs/adr/001-postgresql.md',
      filePath: 'docs/adr/001-postgresql.md',
      startLine: 1,
      endLine: 30,
      language: 'markdown',
      properties: { isADR: 'true', status: 'accepted' },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      label: 'Process',
      name: 'UserRegistration',
      qualifiedName: 'process::UserRegistration',
      filePath: null,
      startLine: null,
      endLine: null,
      language: null,
      properties: { isProcess: 'true', stepCount: 3 },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      label: 'Report',
      name: 'Security-Audit-2026Q1',
      qualifiedName: 'reports::Security-Audit-2026Q1',
      filePath: null,
      startLine: null,
      endLine: null,
      language: null,
      properties: { isReport: 'true', reportType: 'security' },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-03-15T00:00:00Z',
      updatedAt: '2026-03-15T00:00:00Z',
    },
  ];
  store.insertNodes(nodes);
}

function addEdges(store: InMemoryGraphStore): void {
  const edges: GraphEdge[] = [
    {
      projectId: 'test-project',
      sourceId: 1,
      targetId: 2,
      type: 'CALLS',
      properties: {},
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      sourceId: 2,
      targetId: 1,
      type: 'CALLS',
      properties: {},
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      sourceId: 1,
      targetId: 3,
      type: 'DEPENDS_ON',
      properties: {},
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      projectId: 'test-project',
      sourceId: 1,
      targetId: 4,
      type: 'CONTRACT',
      properties: { repoGroup: 'main-services' },
      weight: 2,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  store.insertEdges(edges);
}

describe('ResourceProvider', () => {
  let store: InMemoryGraphStore;
  let provider: ResourceProvider;

  beforeEach(() => {
    store = makeStore();
  });

  describe('empty store', () => {
    beforeEach(() => {
      provider = new ResourceProvider(store);
    });

    it('should list all 15 resources', () => {
      const resources = provider.listResources();
      expect(resources).toHaveLength(15);
    });

    it('should return projects with empty list from empty store', async () => {
      const result = await provider.getResource('code-analyzer://resources/projects');
      expect('uri' in result).toBe(true);
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.projects).toEqual([]);
        expect(data.totalProjects).toBe(0);
      }
    });

    it('should return stats with zero counts from empty store', async () => {
      const result = await provider.getResource('code-analyzer://resources/stats');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.overview.totalNodes).toBe(0);
        expect(data.overview.totalEdges).toBe(0);
      }
    });

    it('should return health with uptime information', async () => {
      const result = await provider.getResource('code-analyzer://resources/health');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.status).toBe('ok');
        expect(data.graph.totalNodes).toBe(0);
        expect(data.uptime).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return empty clusters from empty store', async () => {
      const result = await provider.getResource('code-analyzer://resources/clusters');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalClusters).toBe(0);
      }
    });

    it('should return empty routes from empty store', async () => {
      const result = await provider.getResource('code-analyzer://resources/routes');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalRoutes).toBe(0);
      }
    });

    it('should return empty hotspots from empty store', async () => {
      const result = await provider.getResource('code-analyzer://resources/hotspots');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalHotspots).toBe(0);
      }
    });

    it('should return config with server info', async () => {
      const result = await provider.getResource('code-analyzer://resources/config');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.server.name).toBe('code-analyzer');
      }
    });

    it('should return error for unknown URI', async () => {
      const result = await provider.getResource('code-analyzer://resources/nonexistent');
      expect('error' in result).toBe(true);
    });
  });

  describe('populated store', () => {
    beforeEach(() => {
      addNodes(store);
      addEdges(store);
      provider = new ResourceProvider(store);
    });

    it('should list projects with correct counts', async () => {
      const result = await provider.getResource('code-analyzer://resources/projects');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalProjects).toBe(1);
        expect(data.projects[0].projectId).toBe('test-project');
        expect(data.projects[0].nodeCount).toBe(7);
        expect(data.projects[0].edgeCount).toBe(4);
      }
    });

    it('should return project schema with node labels and edge types', async () => {
      const result = await provider.getResource('code-analyzer://resources/project-schema');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.nodeLabels).toContain('Function');
        expect(data.nodeLabels).toContain('Class');
        expect(data.edgeTypes).toContain('CALLS');
        expect(data.edgeTypes).toContain('CONTRACT');
        expect(data.totalNodeTypes).toBeGreaterThan(0);
        expect(data.totalEdgeTypes).toBeGreaterThan(0);
      }
    });

    it('should return clusters with members', async () => {
      const result = await provider.getResource('code-analyzer://resources/clusters');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalClusters).toBe(2); // cluster-utils, cluster-logging
        expect(data.clusters.length).toBe(2);
      }
    });

    it('should return processes', async () => {
      const result = await provider.getResource('code-analyzer://resources/processes');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalProcesses).toBe(1);
        expect(data.processes[0].name).toBe('UserRegistration');
        expect(data.processes[0].stepCount).toBe(3);
      }
    });

    it('should return routes with method and path', async () => {
      const result = await provider.getResource('code-analyzer://resources/routes');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalRoutes).toBe(1);
        expect(data.routes[0].method).toBe('GET');
        expect(data.routes[0].path).toBe('/api/total');
      }
    });

    it('should return entrypoints', async () => {
      const result = await provider.getResource('code-analyzer://resources/entrypoints');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalEntrypoints).toBe(1);
        expect(data.entrypoints[0].kind).toBe('EntryPoint');
      }
    });

    it('should return hotspots sorted by complexity', async () => {
      const result = await provider.getResource('code-analyzer://resources/hotspots');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalHotspots).toBeGreaterThanOrEqual(1);
        // The most complex node (complexAlgorithm, complexity=20) should be first
        expect(data.hotspots[0].complexity).toBe(20);
      }
    });

    it('should return ADRs', async () => {
      const result = await provider.getResource('code-analyzer://resources/adrs');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalADRs).toBe(1);
        expect(data.adrs[0].title).toBe('ADR-001-Use-PostgreSQL');
        expect(data.adrs[0].status).toBe('accepted');
      }
    });

    it('should return stats with distribution data', async () => {
      const result = await provider.getResource('code-analyzer://resources/stats');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.overview.totalNodes).toBe(7);
        expect(data.overview.totalEdges).toBe(4);
        expect(data.nodeLabelDistribution).toBeDefined();
        expect(data.languageDistribution).toBeDefined();
        expect(data.edgeTypeDistribution).toBeDefined();
      }
    });

    it('should return graph with all nodes and edges', async () => {
      const result = await provider.getResource('code-analyzer://resources/graph');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.summary.totalNodes).toBe(7);
        expect(data.summary.totalEdges).toBe(4);
        expect(data.nodes.length).toBe(7);
        expect(data.edges.length).toBe(4);
      }
    });

    it('should return groups from node metadata', async () => {
      // Groups come from nodes with repoGroup/repoName properties
      const nodeWithGroup: GraphNode = {
        projectId: 'test-project',
        label: 'Repository',
        name: 'code-analyzer',
        qualifiedName: 'repo::code-analyzer',
        filePath: null,
        startLine: null,
        endLine: null,
        language: null,
        properties: { repoGroup: 'core-services', repoName: 'code-analyzer' },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: false,
        fingerprint: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      store.insertNode(nodeWithGroup);
      provider = new ResourceProvider(store);

      const result = await provider.getResource('code-analyzer://resources/groups');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalGroups).toBeGreaterThanOrEqual(1);
      }
    });

    it('should return contracts', async () => {
      const result = await provider.getResource('code-analyzer://resources/contracts');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalContracts).toBe(1);
        expect(data.contracts[0].type || data.contracts[0].projectId).toBeDefined();
      }
    });

    it('should return health with node and edge counts', async () => {
      const result = await provider.getResource('code-analyzer://resources/health');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.graph.totalNodes).toBe(7);
        expect(data.graph.totalEdges).toBe(4);
        expect(data.memory).toBeDefined();
      }
    });

    it('should return reports', async () => {
      const result = await provider.getResource('code-analyzer://resources/reports');
      if ('text' in result) {
        const data = JSON.parse(result.text);
        expect(data.totalReports).toBe(1);
        expect(data.reports[0].type).toBe('security');
      }
    });
  });

  describe('getDefinition', () => {
    beforeEach(() => {
      provider = new ResourceProvider(store);
    });

    it('should return definition for valid URI', () => {
      const def = provider.getDefinition('code-analyzer://resources/health');
      expect(def).toBeDefined();
      expect(def!.name).toBe('Health');
      expect(def!.mimeType).toBe('application/json');
    });

    it('should return undefined for unknown URI', () => {
      const def = provider.getDefinition('code-analyzer://resources/nonexistent');
      expect(def).toBeUndefined();
    });
  });
});

describe('registerResources', () => {
  it('should return 15 resource definitions', () => {
    const resources = registerResources();
    expect(resources).toHaveLength(15);
  });

  it('should include expected resource URIs', () => {
    const resources = registerResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('code-analyzer://resources/projects');
    expect(uris).toContain('code-analyzer://resources/health');
    expect(uris).toContain('code-analyzer://resources/stats');
    expect(uris).toContain('code-analyzer://resources/graph');
  });
});
