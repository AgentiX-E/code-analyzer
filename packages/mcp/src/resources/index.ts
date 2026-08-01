// @code-analyzer/mcp — MCP Resources
// 15 resource definitions with graph-backed data retrieval for the MCP server.
// ResourceProvider queries the InMemoryGraphStore and returns structured JSON.
// registerResources() is kept for backward compatibility as a static list.

import type { ResourceDefinition } from '@code-analyzer/shared';
import type { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Resource Content Types
// ---------------------------------------------------------------------------

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ResourceError {
  uri: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Resource Definitions (static list)
// ---------------------------------------------------------------------------

const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  { uri: 'code-analyzer://resources/projects', name: 'Projects', description: 'List of all indexed projects', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/project-schema', name: 'Project Schema', description: 'Schema definition for project data', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/clusters', name: 'Clusters', description: 'Community clusters detected in the codebase', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/processes', name: 'Processes', description: 'Business processes modeled in the codebase', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/routes', name: 'Routes', description: 'HTTP routes and API endpoints', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/entrypoints', name: 'Entry Points', description: 'Application entry points', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/hotspots', name: 'Hotspots', description: 'Code hotspots with high complexity or churn', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/adrs', name: 'ADRs', description: 'Architecture Decision Records', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/stats', name: 'Stats', description: 'Project statistics and metrics', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/graph', name: 'Graph', description: 'Complete knowledge graph for a project', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/groups', name: 'Groups', description: 'Repository groups', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/contracts', name: 'Contracts', description: 'Cross-repo contracts', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/config', name: 'Config', description: 'Server configuration', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/health', name: 'Health', description: 'Server health and status', mimeType: 'application/json' },
  { uri: 'code-analyzer://resources/reports', name: 'Reports', description: 'Generated analysis reports', mimeType: 'application/json' },
];

/** Register all 15 MCP resources (backward compatible static list). */
export function registerResources(): ResourceDefinition[] {
  return [...RESOURCE_DEFINITIONS];
}

// ---------------------------------------------------------------------------
// Resource URI Path Helpers
// ---------------------------------------------------------------------------

const URI_PREFIX = 'code-analyzer://resources/';

function resourceName(uri: string): string {
  if (!uri.startsWith(URI_PREFIX)) return '';
  return uri.slice(URI_PREFIX.length);
}

// ---------------------------------------------------------------------------
// ResourceProvider
// ---------------------------------------------------------------------------

export class ResourceProvider {
  private store: InMemoryGraphStore;
  private startTime: number;
  private resourceHandlers: Map<string, () => Promise<unknown>>;

  constructor(store: InMemoryGraphStore) {
    this.store = store;
    this.startTime = Date.now();
    this.resourceHandlers = this.buildHandlerMap();
  }

  /** List all resource definitions. */
  listResources(): ResourceDefinition[] {
    return [...RESOURCE_DEFINITIONS];
  }

  /** Get a single resource definition by URI. */
  getDefinition(uri: string): ResourceDefinition | undefined {
    return RESOURCE_DEFINITIONS.find((r) => r.uri === uri);
  }

  /** Read a resource by URI, returning structured content. */
  async getResource(uri: string): Promise<ResourceContent | ResourceError> {
    const definition = this.getDefinition(uri);
    if (!definition) {
      return { uri, error: `Resource not found: ${uri}` };
    }

    const handler = this.resourceHandlers.get(uri);
    if (!handler) {
      return { uri, error: `No handler defined for resource: ${uri}` };
    }

    try {
      const data = await handler();
      return {
        uri,
        mimeType: definition.mimeType ?? 'application/json',
        text: JSON.stringify(data, null, 2),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { uri, error: `Failed to read resource: ${message}` };
    }
  }

  // -------------------------------------------------------------------------
  // Handler Registry
  // -------------------------------------------------------------------------

  private buildHandlerMap(): Map<string, () => Promise<unknown>> {
    const map = new Map<string, () => Promise<unknown>>();

    map.set('code-analyzer://resources/projects', () => this.getProjects());
    map.set('code-analyzer://resources/project-schema', () => this.getProjectSchema());
    map.set('code-analyzer://resources/clusters', () => this.getClusters());
    map.set('code-analyzer://resources/processes', () => this.getProcesses());
    map.set('code-analyzer://resources/routes', () => this.getRoutes());
    map.set('code-analyzer://resources/entrypoints', () => this.getEntrypoints());
    map.set('code-analyzer://resources/hotspots', () => this.getHotspots());
    map.set('code-analyzer://resources/adrs', () => this.getADRs());
    map.set('code-analyzer://resources/stats', () => this.getStats());
    map.set('code-analyzer://resources/graph', () => this.getGraph());
    map.set('code-analyzer://resources/groups', () => this.getGroups());
    map.set('code-analyzer://resources/contracts', () => this.getContracts());
    map.set('code-analyzer://resources/config', () => this.getConfig());
    map.set('code-analyzer://resources/health', () => this.getHealth());
    map.set('code-analyzer://resources/reports', () => this.getReports());

    return map;
  }

  // -------------------------------------------------------------------------
  // Individual Resource Handlers
  // -------------------------------------------------------------------------

  /** List all indexed projects with their statistics. */
  private async getProjects(): Promise<unknown> {
    const projectMap = new Map<string, { nodeCount: number; edgeCount: number; firstSeen: string; lastUpdated: string }>();

    for (const node of this.store.nodes.values()) {
      const pid = node.projectId;
      if (!projectMap.has(pid)) {
        projectMap.set(pid, { nodeCount: 0, edgeCount: 0, firstSeen: node.createdAt, lastUpdated: node.updatedAt });
      }
      const proj = projectMap.get(pid)!;
      proj.nodeCount++;
      if (node.updatedAt > proj.lastUpdated) proj.lastUpdated = node.updatedAt;
      if (node.createdAt < proj.firstSeen) proj.firstSeen = node.createdAt;
    }

    for (const edge of this.store.edges.values()) {
      const pid = edge.projectId;
      if (projectMap.has(pid)) {
        projectMap.get(pid)!.edgeCount++;
      }
    }

    return {
      projects: Array.from(projectMap.entries()).map(([projectId, stats]) => ({
        projectId,
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        firstSeen: stats.firstSeen,
        lastUpdated: stats.lastUpdated,
      })),
      totalProjects: projectMap.size,
    };
  }

  /** Return the node and edge type schemas observed in the graph. */
  private async getProjectSchema(): Promise<unknown> {
    const nodeLabels = new Set<string>();
    const edgeTypes = new Set<string>();

    for (const node of this.store.nodes.values()) {
      nodeLabels.add(node.label);
    }
    for (const edge of this.store.edges.values()) {
      edgeTypes.add(edge.type);
    }

    return {
      nodeLabels: Array.from(nodeLabels).sort(),
      edgeTypes: Array.from(edgeTypes).sort(),
      totalNodeTypes: nodeLabels.size,
      totalEdgeTypes: edgeTypes.size,
      nodeCount: this.store.nodes.size,
      edgeCount: this.store.edges.size,
    };
  }

  /** Get community clusters from nodes with cluster metadata. */
  private async getClusters(): Promise<unknown> {
    const clusterMap = new Map<string, { name: string; memberCount: number; primaryLanguage: string | null }>();

    for (const node of this.store.nodes.values()) {
      const clusterId = node.properties.clusterId as string | undefined;
      if (!clusterId) continue;
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, { name: clusterId, memberCount: 0, primaryLanguage: null });
      }
      const cluster = clusterMap.get(clusterId)!;
      cluster.memberCount++;
      if (node.language && !cluster.primaryLanguage) {
        cluster.primaryLanguage = node.language;
      }
    }

    return {
      clusters: Array.from(clusterMap.values()),
      totalClusters: clusterMap.size,
    };
  }

  /** Get business processes from nodes with process metadata. */
  private async getProcesses(): Promise<unknown> {
    const processes: Array<{ name: string; nodeId: number; stepCount: number }> = [];

    for (const node of this.store.nodes.values()) {
      const isProcess = node.label === 'Process' || node.properties.isProcess === 'true';
      if (!isProcess) continue;

      processes.push({
        name: node.name,
        nodeId: node.id,
        stepCount: typeof node.properties.stepCount === 'number' ? node.properties.stepCount : 0,
      });
    }

    return {
      processes,
      totalProcesses: processes.length,
    };
  }

  /** Get HTTP routes from nodes with route metadata. */
  private async getRoutes(): Promise<unknown> {
    const routes: Array<{ method: string; path: string; handler: string; filePath: string | null }> = [];

    for (const node of this.store.nodes.values()) {
      const routeMethod = node.properties.routeMethod as string | undefined;
      const routePath = node.properties.routePath as string | undefined;
      if (!routeMethod && !routePath) continue;

      routes.push({
        method: routeMethod ?? 'UNKNOWN',
        path: routePath ?? '/',
        handler: node.qualifiedName || node.name,
        filePath: node.filePath,
      });
    }

    return {
      routes: routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
      totalRoutes: routes.length,
    };
  }

  /** Get application entry points. */
  private async getEntrypoints(): Promise<unknown> {
    const entrypoints: Array<{ name: string; kind: string; filePath: string | null; line: number | null }> = [];

    for (const node of this.store.nodes.values()) {
      const isEntrypoint =
        node.label === 'EntryPoint' ||
        node.properties.isEntrypoint === 'true' ||
        (node.name === 'main' && node.isExported);
      if (!isEntrypoint) continue;

      entrypoints.push({
        name: node.qualifiedName || node.name,
        kind: node.label,
        filePath: node.filePath,
        line: node.startLine,
      });
    }

    return {
      entrypoints,
      totalEntrypoints: entrypoints.length,
    };
  }

  /** Get code hotspots — nodes with high complexity or high edge degree. */
  private async getHotspots(): Promise<unknown> {
    const hotspotThreshold = 10;
    const hotspots: Array<{
      name: string;
      complexity: number | null;
      degree: number;
      filePath: string | null;
      language: string | null;
    }> = [];

    for (const node of this.store.nodes.values()) {
      const degree = this.store.getDegree(node.id);
      const complexity = node.complexity;
      if ((complexity !== null && complexity > hotspotThreshold) || degree > hotspotThreshold) {
        hotspots.push({
          name: node.qualifiedName || node.name,
          complexity,
          degree,
          filePath: node.filePath,
          language: node.language,
        });
      }
    }

    // Sort by complexity descending, then degree
    hotspots.sort((a, b) => (b.complexity ?? 0) - (a.complexity ?? 0) || b.degree - a.degree);

    return {
      hotspots: hotspots.slice(0, 50),
      totalHotspots: hotspots.length,
      threshold: hotspotThreshold,
    };
  }

  /** Get Architecture Decision Records from nodes with ADR metadata. */
  private async getADRs(): Promise<unknown> {
    const adrs: Array<{ title: string; nodeId: number; filePath: string | null; status: string }> = [];

    for (const node of this.store.nodes.values()) {
      const isADR = node.label === 'ADR' || node.properties.isADR === 'true';
      if (!isADR) continue;

      adrs.push({
        title: node.name,
        nodeId: node.id,
        filePath: node.filePath,
        status: (node.properties.status as string) ?? 'proposed',
      });
    }

    return {
      adrs,
      totalADRs: adrs.length,
    };
  }

  /** Get aggregated project statistics. */
  private async getStats(): Promise<unknown> {
    const totalNodes = this.store.nodes.size;
    const totalEdges = this.store.edges.size;

    // Count by label
    const labelCounts: Record<string, number> = {};
    for (const node of this.store.nodes.values()) {
      labelCounts[node.label] = (labelCounts[node.label] ?? 0) + 1;
    }

    // Count by language
    const languageCounts: Record<string, number> = {};
    for (const node of this.store.nodes.values()) {
      if (node.language) {
        languageCounts[node.language] = (languageCounts[node.language] ?? 0) + 1;
      }
    }

    // Edge type distribution
    const edgeTypeCounts: Record<string, number> = {};
    for (const edge of this.store.edges.values()) {
      edgeTypeCounts[edge.type] = (edgeTypeCounts[edge.type] ?? 0) + 1;
    }

    // Complexity stats
    const complexities: number[] = [];
    for (const node of this.store.nodes.values()) {
      if (node.complexity !== null && node.complexity > 0) {
        complexities.push(node.complexity);
      }
    }
    complexities.sort((a, b) => a - b);

    return {
      overview: {
        totalNodes,
        totalEdges,
        graphDensity: totalNodes > 0 ? totalEdges / totalNodes : 0,
      },
      nodeLabelDistribution: labelCounts,
      languageDistribution: languageCounts,
      edgeTypeDistribution: edgeTypeCounts,
      complexity: {
        nodesWithComplexity: complexities.length,
        min: complexities[0] ?? 0,
        max: complexities[complexities.length - 1] ?? 0,
        median: complexities.length > 0 ? complexities[Math.floor(complexities.length / 2)]! : 0,
        average: complexities.length > 0 ? complexities.reduce((s, v) => s + v, 0) / complexities.length : 0,
      },
    };
  }

  /** Get a complete graph summary. */
  private async getGraph(): Promise<unknown> {
    const nodes = Array.from(this.store.nodes.values()).map((n) => ({
      id: n.id,
      projectId: n.projectId,
      label: n.label,
      name: n.name,
      qualifiedName: n.qualifiedName,
      filePath: n.filePath,
      language: n.language,
      complexity: n.complexity,
      isExported: n.isExported,
    }));

    const edges = Array.from(this.store.edges.values()).map((e) => ({
      id: e.id,
      projectId: e.projectId,
      sourceId: e.sourceId,
      targetId: e.targetId,
      type: e.type,
      weight: e.weight,
    }));

    return {
      summary: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
      },
      nodes,
      edges,
    };
  }

  /** Get repository groups from cross-repo metadata. */
  private async getGroups(): Promise<unknown> {
    const groupMap = new Map<string, { name: string; repos: string[]; description?: string }>();

    for (const node of this.store.nodes.values()) {
      const groupName = node.properties.repoGroup as string | undefined;
      const repoName = node.properties.repoName as string | undefined;
      if (!groupName || !repoName) continue;
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, { name: groupName, repos: [] });
      }
      const group = groupMap.get(groupName)!;
      if (!group.repos.includes(repoName)) {
        group.repos.push(repoName);
      }
    }

    return {
      groups: Array.from(groupMap.values()).map((g) => ({
        ...g,
        repoCount: g.repos.length,
      })),
      totalGroups: groupMap.size,
    };
  }

  /** Get cross-repo contracts from contract-type edges. */
  private async getContracts(): Promise<unknown> {
    const contracts: Array<{ id: number; sourceId: number; targetId: number; projectId: string; weight: number }> = [];

    for (const edge of this.store.edges.values()) {
      if (edge.type === 'CONTRACT' || edge.type === 'DEPENDS_ON_CROSS_REPO') {
        contracts.push({
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          projectId: edge.projectId,
          weight: edge.weight,
        });
      }
    }

    return {
      contracts,
      totalContracts: contracts.length,
    };
  }

  /** Get server configuration. */
  private async getConfig(): Promise<unknown> {
    return {
      server: {
        name: 'code-analyzer',
        version: '0.1.0',
        transport: 'stdio',
      },
      graph: {
        totalNodes: this.store.nodes.size,
        totalEdges: this.store.edges.size,
      },
      uptime: Date.now() - this.startTime,
      startedAt: new Date(this.startTime).toISOString(),
    };
  }

  /** Get health status of the server and graph. */
  private async getHealth(): Promise<unknown> {
    const memUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime,
      startedAt: new Date(this.startTime).toISOString(),
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
      },
      graph: {
        totalNodes: this.store.nodes.size,
        totalEdges: this.store.edges.size,
      },
    };
  }

  /** List generated reports from nodes with report metadata. */
  private async getReports(): Promise<unknown> {
    const reports: Array<{ name: string; nodeId: number; createdAt: string; type: string }> = [];

    for (const node of this.store.nodes.values()) {
      const isReport = node.label === 'Report' || node.properties.isReport === 'true';
      if (!isReport) continue;

      reports.push({
        name: node.name,
        nodeId: node.id,
        createdAt: node.createdAt,
        type: (node.properties.reportType as string) ?? 'analysis',
      });
    }

    return {
      reports: reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      totalReports: reports.length,
    };
  }
}
