// @code-analyzer/server — GraphQL Resolvers
// Resolver implementations for all queries, mutations, and subscriptions.
// Delegates all data access to the InMemoryGraphStore and analysis engine.

import type { GraphQLContext } from './context.js';
import type {
  GraphEdge,
  GraphNode,
  InMemoryGraphStore,
} from '@code-analyzer/infra';
import type { NodeQuery, EdgeQuery, FtsSearchResult } from '@code-analyzer/infra';
import type { NodeLabel, RelationshipType } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_IMPORTS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Resolver types
// ---------------------------------------------------------------------------

interface PaginationArgs {
  limit?: number | null;
  offset?: number | null;
}

interface GraphQueryArgs extends PaginationArgs {
  projectId: string;
  label?: string | null;
}

interface EdgesQueryArgs extends PaginationArgs {
  projectId: string;
  sourceId?: number | null;
  targetId?: number | null;
  type?: string | null;
}

interface SearchGraphArgs extends PaginationArgs {
  projectId: string;
  query: string;
}

interface ReviewDiffArgs {
  projectId: string;
  diff: string;
  fileContext?: string | null;
}

interface ReviewPRArgs {
  projectId: string;
  prNumber: number;
  owner: string;
  repo: string;
}

interface CrossRepoSearchArgs extends PaginationArgs {
  query: string;
}

interface ImpactAnalysisArgs {
  projectId: string;
  changedFiles: string[];
}

interface IndexProjectArgs {
  path: string;
  projectId?: string | null;
  language?: string | null;
}

interface RunBenchmarkArgs {
  projectId: string;
  suite: string;
}

interface ManageRepoGroupArgs {
  action: string;
  groupId?: string | null;
  name?: string | null;
  description?: string | null;
  repos?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pageInfo(total: number, offset: number, limit: number) {
  return {
    hasMore: offset + limit < total,
    total,
    offset,
    limit,
  };
}

function nodeToGraphQL(n: GraphNode) {
  return {
    ...n,
    properties: n.properties as Record<string, unknown>,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

function edgeToGraphQL(e: GraphEdge) {
  return {
    ...e,
    properties: e.properties,
    createdAt: e.createdAt,
  };
}

function searchResultToGraphQL(r: FtsSearchResult) {
  return {
    node: nodeToGraphQL(r.node),
    score: r.rank,
    matchedField: r.matchedColumn,
    matchedValue: r.snippet,
  };
}

/**
 * Get all nodes across all projects in the store.
 * Used for cross-repo operations that don't filter by projectId.
 */
function getAllNodesFromStore(store: InMemoryGraphStore): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const node of store.nodes.values()) {
    nodes.push({
      id: node.id,
      projectId: node.projectId,
      label: node.label,
      name: node.name,
      qualifiedName: node.qualifiedName,
      filePath: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
      language: node.language,
      properties: node.properties,
      signature: node.signature,
      docstring: node.docstring,
      complexity: node.complexity,
      isExported: node.isExported,
      fingerprint: node.fingerprint,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    });
  }
  return nodes;
}

/**
 * Collect all unique project IDs from the store's nodes.
 */
function getProjectIds(store: InMemoryGraphStore): string[] {
  const ids = new Set<string>();
  for (const node of store.nodes.values()) {
    ids.add(node.projectId);
  }
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export const resolvers = {
  // -----------------------------------------------------------------------
  // Scalars
  // -----------------------------------------------------------------------

  JSON: {
    serialize(value: unknown): unknown {
      return value;
    },
    parseValue(value: unknown): unknown {
      return value;
    },
  },

  DateTime: {
    serialize(value: unknown): string {
      if (value instanceof Date) return value.toISOString();
      return String(value);
    },
    parseValue(value: unknown): Date {
      return new Date(String(value));
    },
  },

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  Query: {
    project: (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const projectNodes = getAllNodesFromStore(store);
      const projectNode = projectNodes.find((n) => n.projectId === args.id && n.label === 'Project');
      if (!projectNode) return null;

      const projectNodesCount = projectNodes.filter((n) => n.projectId === args.id).length;
      const projectEdges = Array.from(store.edges.values()).filter((e) => e.projectId === args.id);

      return {
        id: args.id,
        rootPath: projectNode.filePath ?? args.id,
        name: projectNode.name,
        language: projectNode.language,
        indexedAt: projectNode.createdAt,
        lastCommit: null,
        nodeCount: projectNodesCount,
        edgeCount: projectEdges.length,
        status: 'READY',
        config: projectNode.properties,
      };
    },

    projects: (
      _root: unknown,
      args: { status?: string | null },
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const ids = getProjectIds(store);
      const result: Record<string, unknown>[] = [];

      for (const id of ids) {
        const projectNodes = Array.from(store.nodes.values()).filter(
          (n) => n.projectId === id && n.label === 'Project',
        );
        const allProjectNodes = Array.from(store.nodes.values()).filter((n) => n.projectId === id);
        const projectEdges = Array.from(store.edges.values()).filter((e) => e.projectId === id);

        const status = projectNodes.length > 0 ? 'READY' : 'INDEXING';
        if (args.status && args.status !== status) continue;

        result.push({
          id,
          rootPath: projectNodes[0]?.filePath ?? id,
          name: projectNodes[0]?.name ?? id,
          language: projectNodes[0]?.language ?? null,
          indexedAt: projectNodes[0]?.createdAt ?? null,
          lastCommit: null,
          nodeCount: allProjectNodes.length,
          edgeCount: projectEdges.length,
          status,
          config: projectNodes[0]?.properties ?? {},
        });
      }

      return result;
    },

    graph: (
      _root: unknown,
      args: GraphQueryArgs,
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const limit = args.limit ?? 100;
      const offset = args.offset ?? 0;

      const query: NodeQuery = {
        projectId: args.projectId,
        limit,
        offset,
      };
      if (args.label) {
        query.label = args.label as NodeLabel;
      }

      const result = store.queryNodes(query);
      return {
        items: result.items.map(nodeToGraphQL),
        pageInfo: pageInfo(result.total, result.offset, result.limit),
      };
    },

    edges: (
      _root: unknown,
      args: EdgesQueryArgs,
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const limit = args.limit ?? 100;
      const offset = args.offset ?? 0;

      const query: EdgeQuery = {
        projectId: args.projectId,
        limit,
        offset,
      };
      if (args.sourceId != null) query.sourceId = args.sourceId;
      if (args.targetId != null) query.targetId = args.targetId;
      if (args.type) query.type = args.type as RelationshipType;

      const result = store.queryEdges(query);
      return {
        items: result.items.map(edgeToGraphQL),
        pageInfo: pageInfo(result.total, result.offset, result.limit),
      };
    },

    searchGraph: (
      _root: unknown,
      args: SearchGraphArgs,
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;

      const results = store.searchFts(args.query, { limit, offset });
      // Filter by projectId post-search
      const filtered = results.filter((r) => r.node.projectId === args.projectId);

      return {
        items: filtered.map(searchResultToGraphQL),
        pageInfo: pageInfo(filtered.length, 0, limit),
      };
    },

    reviewDiff: (
      _root: unknown,
      args: ReviewDiffArgs,
      _ctx: GraphQLContext,
    ) => {
      // Review is delegated to the analysis engine at the tool layer.
      // GraphQL provides a thin wrapper returning stub + metadata.
      const lines = args.diff.split('\n').length;

      return {
        comments: [],
        summary: `Review requested for diff (${lines} lines) in project ${args.projectId}. Use MCP tool 'review_diff' for detailed analysis.`,
        stats: {
          totalComments: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
          filesReviewed: 0,
        },
      };
    },

    reviewPR: (
      _root: unknown,
      args: ReviewPRArgs,
      _ctx: GraphQLContext,
    ) => {
      return {
        comments: [],
        summary: `PR #${args.prNumber} review requested for ${args.owner}/${args.repo} (project ${args.projectId}). Use MCP tool 'review_pr' for detailed analysis.`,
        stats: {
          totalComments: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
          filesReviewed: 0,
        },
      };
    },

    crossRepoSearch: (
      _root: unknown,
      args: CrossRepoSearchArgs,
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;

      const results = store.searchFts(args.query, { limit, offset });

      return {
        items: results.map(searchResultToGraphQL),
        pageInfo: pageInfo(results.length, 0, limit),
      };
    },

    impactAnalysis: (
      _root: unknown,
      args: ImpactAnalysisArgs,
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const projectId = args.projectId;
      const changedFiles = args.changedFiles;

      // Find nodes in the changed files
      const affectedNodes: GraphNode[] = [];
      for (const file of changedFiles) {
        const fileNodes = Array.from(store.nodes.values()).filter(
          (n) => n.projectId === projectId && n.filePath === file,
        );
        affectedNodes.push(...fileNodes.map((n) => ({
          id: n.id,
          projectId: n.projectId,
          label: n.label,
          name: n.name,
          qualifiedName: n.qualifiedName,
          filePath: n.filePath,
          startLine: n.startLine,
          endLine: n.endLine,
          language: n.language,
          properties: n.properties,
          signature: n.signature,
          docstring: n.docstring,
          complexity: n.complexity,
          isExported: n.isExported,
          fingerprint: n.fingerprint,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        })));
      }

      const changedSymbols = affectedNodes.map((n) => ({
        symbolQname: n.qualifiedName,
        filePath: n.filePath ?? '',
        changeType: 'modified',
        startLine: n.startLine ?? 0,
        endLine: n.endLine ?? 0,
      }));

      const impactTree = affectedNodes.slice(0, 10).map((n) => ({
        symbolQname: n.qualifiedName,
        label: n.label,
        filePath: n.filePath ?? '',
        impactType: 'direct',
        depth: 0,
        children: [],
      }));

      const riskLevel = affectedNodes.length > 20 ? 'HIGH' : affectedNodes.length > 5 ? 'MEDIUM' : 'LOW';

      return {
        changedFiles,
        changedSymbols,
        impactTree,
        riskLevel,
        estimatedEffort: affectedNodes.length > 20 ? 'high' : affectedNodes.length > 10 ? 'medium' : 'low',
      };
    },

    projectStats: (
      _root: unknown,
      args: { projectId: string },
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const projectId = args.projectId;

      const projectNodes = Array.from(store.nodes.values()).filter((n) => n.projectId === projectId);
      const projectEdges = Array.from(store.edges.values()).filter((e) => e.projectId === projectId);

      // Node label distribution
      const labelDist: Record<string, number> = {};
      for (const n of projectNodes) {
        labelDist[n.label] = (labelDist[n.label] ?? 0) + 1;
      }

      // Edge type distribution
      const edgeTypeDist: Record<string, number> = {};
      for (const e of projectEdges) {
        edgeTypeDist[e.type] = (edgeTypeDist[e.type] ?? 0) + 1;
      }

      // Language distribution
      const langDist: Record<string, number> = {};
      for (const n of projectNodes) {
        if (n.language) {
          langDist[n.language] = (langDist[n.language] ?? 0) + 1;
        }
      }

      return {
        projectId,
        nodeCount: projectNodes.length,
        edgeCount: projectEdges.length,
        nodeLabelDistribution: labelDist,
        edgeTypeDistribution: edgeTypeDist,
        languageDistribution: langDist,
      };
    },

    health: (
      _root: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      const mem = process.memoryUsage();
      return {
        status: 'ok',
        uptime: Date.now() - ctx.startTime,
        timestamp: new Date().toISOString(),
        version: ctx.config.metadata.version,
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rssMB: Math.round(mem.rss / 1024 / 1024),
        },
        nodeCount: ctx.store.getNodeCount(),
        edgeCount: ctx.store.getEdgeCount(),
      };
    },

    repoGroups: (
      _root: unknown,
      _args: unknown,
      _ctx: GraphQLContext,
    ) => {
      // Groups managed via manageRepoGroup mutation
      return [];
    },

    repoGroup: (
      _root: unknown,
      _args: { id: string },
      _ctx: GraphQLContext,
    ) => {
      return null; // Groups managed via manageRepoGroup mutation
    },

    symbolUsage: (
      _root: unknown,
      args: { projectId: string; symbolName: string; limit?: number | null },
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const limit = args.limit ?? 50;

      const results: Record<string, unknown>[] = [];
      const nodes = Array.from(store.nodes.values()).filter(
        (n) => n.projectId === args.projectId &&
          (n.name === args.symbolName || n.qualifiedName.includes(args.symbolName)),
      );

      for (const node of nodes.slice(0, limit)) {
        // Find callers (edges pointing to this node)
        const edges = Array.from(store.edges.values()).filter((e) => e.targetId === node.id);
        const callers: string[] = [];
        const referencedBy: string[] = [];
        for (const edge of edges) {
          const caller = store.nodes.get(edge.sourceId);
          if (caller) {
            callers.push(caller.qualifiedName ?? caller.name);
            if (caller.filePath) referencedBy.push(caller.filePath);
          }
        }

        results.push({
          symbolName: node.name,
          qualifiedName: node.qualifiedName,
          language: node.language,
          filePath: node.filePath ?? '',
          line: node.startLine ?? 0,
          kind: node.label,
          referenceCount: edges.length,
          referencedBy: [...new Set(referencedBy)],
          callers: [...new Set(callers)],
        });
      }

      return results;
    },

    dependencyGraph: (
      _root: unknown,
      args: { projectId: string },
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const projectId = args.projectId;

      // Build dependency graph from import edges
      const packages = new Set<string>();
      const adjacency: Record<string, string[]> = {};
      const circularDeps: string[] = [];

      const nodes = Array.from(store.nodes.values()).filter((n) => n.projectId === projectId);
      const edges = Array.from(store.edges.values()).filter((e) => e.projectId === projectId);

      // Collect all file-level packages (top-level dirs)
      for (const node of nodes) {
        if (node.filePath) {
          const parts = node.filePath.split('/');
          if (parts.length > 1) packages.add(parts[0]!);
          else packages.add('.');
        }
      }

      // Build adjacency from IMPORT edges
      for (const edge of edges) {
        if (edge.type === EDGE_IMPORTS || edge.type === EDGE_CALLS) {
          const source = store.nodes.get(edge.sourceId);
          const target = store.nodes.get(edge.targetId);
          if (source?.filePath && target?.filePath) {
            const srcPkg = source.filePath.split('/')[0] ?? '.';
            const tgtPkg = target.filePath.split('/')[0] ?? '.';
            if (srcPkg !== tgtPkg) {
              if (!adjacency[srcPkg]) adjacency[srcPkg] = [];
              if (!adjacency[srcPkg]!.includes(tgtPkg)) {
                adjacency[srcPkg]!.push(tgtPkg);
              }
              // Check for circular dependency
              if (adjacency[tgtPkg]?.includes(srcPkg)) {
                if (!circularDeps.includes(`${srcPkg} ⇄ ${tgtPkg}`)) {
                  circularDeps.push(`${srcPkg} ⇄ ${tgtPkg}`);
                }
              }
            }
          }
        }
      }

      // Count nodes and edges
      const graphNodes = Object.keys(adjacency).length;
      const graphEdges = Object.values(adjacency).reduce((sum, deps) => sum + deps.length, 0);

      return {
        projectId,
        nodeCount: graphNodes + packages.size - graphNodes,
        edgeCount: graphEdges,
        packages: [...packages],
        circularDeps,
        adjacencyList: adjacency,
      };
    },
  },

  // -----------------------------------------------------------------------
  // Mutation
  // -----------------------------------------------------------------------

  Mutation: {
    indexProject: (
      _root: unknown,
      args: IndexProjectArgs,
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      const projectId = args.projectId ?? `proj_${Date.now().toString(36)}`;
      const language = args.language ?? null;

      // Create a project node to represent the indexing request
      store.insertNode({
        id: 0,
        projectId,
        label: 'Project',
        name: args.path.split('/').pop() ?? projectId,
        qualifiedName: projectId,
        filePath: args.path,
        startLine: null,
        endLine: null,
        language,
        properties: {
          name: args.path.split('/').pop() ?? projectId,
          rootPath: args.path,
        },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: false,
        fingerprint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return {
        id: projectId,
        rootPath: args.path,
        name: args.path.split('/').pop() ?? projectId,
        language,
        indexedAt: new Date().toISOString(),
        lastCommit: null,
        nodeCount: store.getNodeCount(),
        edgeCount: store.getEdgeCount(),
        status: 'INDEXING',
        config: { rootPath: args.path },
      };
    },

    deleteProject: (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      const store = ctx.store;
      // Remove all nodes and edges for this project
      const nodeIds: number[] = [];
      for (const [id, node] of store.nodes) {
        if (node.projectId === args.id) nodeIds.push(id);
      }
      const edgeIds: number[] = [];
      for (const [id, edge] of store.edges) {
        if (edge.projectId === args.id) edgeIds.push(id);
      }

      for (const nid of nodeIds) store.deleteNode(nid);
      for (const eid of edgeIds) store.deleteEdge(eid);

      return true;
    },

    runBenchmark: (
      _root: unknown,
      args: RunBenchmarkArgs,
      _ctx: GraphQLContext,
    ) => {
      return {
        suite: args.suite,
        totalTests: 0,
        passed: 0,
        failed: 0,
        duration: 0,
        metrics: { note: 'Use MCP tool run_benchmark for detailed benchmarks' },
      };
    },

    manageRepoGroup: (
      _root: unknown,
      args: ManageRepoGroupArgs,
      _ctx: GraphQLContext,
    ) => {
      return {
        id: args.groupId ?? `group_${Date.now().toString(36)}`,
        name: args.name ?? 'Unnamed Group',
        description: args.description ?? '',
        repos: (args.repos as GroupRepo[]) ?? [],
        indexedAt: null,
      };
    },
  },

  // -----------------------------------------------------------------------
  // Subscription (stub — resolves immediately with empty data)
  // -----------------------------------------------------------------------

  Subscription: {
    projectIndexed: {
      subscribe: async function* () {
        // Subscriptions are best-effort in this implementation
        // Real-time updates are handled via SSE transport in the MCP server
      },
      resolve: (payload: unknown) => payload,
    },
    reviewCompleted: {
      subscribe: async function* () {
        // Subscriptions are best-effort
      },
      resolve: (payload: unknown) => payload,
    },
    healthChanged: {
      subscribe: async function* () {
        // Subscriptions are best-effort
      },
      resolve: (payload: unknown) => payload,
    },
  },
};

interface GroupRepo {
  owner: string;
  repo: string;
  fullName: string;
  localPath: string;
  projectId: string | null;
  role: string;
  autoIndex: boolean;
}

export type { PaginationArgs };