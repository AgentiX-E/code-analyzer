// @code-analyzer/mcp — Indexing & Lifecycle Tools

import { existsSync } from 'node:fs';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl, type ToolContext } from './tool-context.js';
import type { ToolResult } from './registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToolContext(store?: unknown): ToolContext | null {
  if (ToolContextImpl.isToolContext(store)) return store;
  return null;
}

function getStore(storeOrContext: unknown): InMemoryGraphStore | null {
  if (storeOrContext instanceof InMemoryGraphStore) return storeOrContext;
  if (ToolContextImpl.isToolContext(storeOrContext)) return storeOrContext.store;
  return null;
}

// ---------------------------------------------------------------------------
// analyze_repository
// ---------------------------------------------------------------------------

interface AnalyzeRepositoryParams {
  path: string;
  projectId?: string;
  language?: string;
  force?: boolean;
}

export const analyzeRepositorySchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the repository to analyze' },
    projectId: { type: 'string', description: 'Project identifier (auto-generated if not provided)' },
    language: { type: 'string', description: 'Programming language (auto-detected if not provided)' },
    force: { type: 'boolean', description: 'Force re-index even if already indexed' },
  },
  required: ['path'],
};

export async function analyzeRepository(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as AnalyzeRepositoryParams;
  const path = params.path;
  const projectId = params.projectId ?? `project_${Date.now()}`;
  const language = params.language;
  const force = Boolean(params.force);

  try {
    // Validate path exists
    if (!existsSync(path)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          projectId,
          path,
          status: 'failed',
          error: `Path does not exist: ${path}`,
        }, null, 2) }],
        isError: true,
      };
    }

    // Run pipeline analysis if ToolContext is available
    const ctx = getToolContext(store);

    if (ctx) {
      const pipeline = await ctx.getPipeline();

      const pipelineCtx = {
        projectId,
        rootPath: path,
        phaseData: new Map<string, unknown>(),
        config: {
          projectId,
          rootPath: path,
          language: language ?? undefined,
          excludePatterns: [],
          includePatterns: [],
          maxFileSize: 10 * 1024 * 1024, // 10 MB
          maxFiles: 10000,
          parseWorkers: 4,
          ignorePaths: [],
        },
        graph: {
          projectId,
          nodes: new Map(),
          edges: new Map(),
          qnameIndex: new Map(),
          fileIndex: new Map(),
        },
      };

      const result = await pipeline.execute(pipelineCtx);
      ctx.currentAnalysis = result;

      const nodeCount = result.graph.nodes.size;
      const edgeCount = result.graph.edges.size;
      const phaseStatuses = result.phases.map((p) => ({
        phaseId: p.phaseId,
        status: p.status,
        duration: p.duration,
        error: p.error,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            path,
            language: language ?? result.graph.nodes.size > 0 ? 'auto-detected' : 'unknown',
            status: result.status,
            force,
            nodeCount,
            edgeCount,
            phaseCount: result.phases.length,
            phases: phaseStatuses,
            errors: result.errors,
            duration: result.duration,
            message: `Analysis ${result.status}: ${nodeCount} nodes, ${edgeCount} edges in ${result.duration}ms`,
          }, null, 2),
        }],
      };
    }

    // Fallback: basic analysis without pipeline (store-only)
    const graphStore = getStore(store);
    if (graphStore && force) {
      const integrity = graphStore.validateIntegrity(projectId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            path,
            language: language ?? 'auto-detected',
            status: force ? 're-indexed' : 'indexed',
            force,
            nodeCount: integrity.nodeCount,
            edgeCount: integrity.edgeCount,
            message: `Store-based analysis: ${integrity.nodeCount} nodes, ${integrity.edgeCount} edges`,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          path,
          language: language ?? 'auto-detected',
          status: 'indexing',
          force,
          message: `Repository analysis started for ${path}. Use get_graph_schema or cypher_query to inspect results after indexing.`,
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        projectId,
        path,
        status: 'failed',
        error: `Analysis failed: ${message}`,
      }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------

export const listProjectsSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', description: 'Filter by status (idle, indexing, ready, error)' },
    limit: { type: 'number', description: 'Maximum number of projects to return' },
    offset: { type: 'number', description: 'Offset for pagination' },
  },
};

export async function listProjects(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as Record<string, unknown>;
  const limit = (params.limit as number) ?? 50;
  const offset = (params.offset as number) ?? 0;

  try {
    const graphStore = getStore(store);
    if (!graphStore) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            items: [],
            total: 0,
            returned: 0,
            hasMore: false,
            message: 'No graph store available',
          }, null, 2),
        }],
      };
    }

    // Extract unique project IDs from all nodes
    const allNodes = graphStore.getAllNodes();
    const projectIds = new Set<string>();
    for (const node of allNodes) {
      projectIds.add(node.projectId);
    }

    const projects = Array.from(projectIds)
      .slice(offset, offset + limit)
      .map((id) => {
        const nodeCount = allNodes.filter((n) => n.projectId === id).length;
        const edgeCount = graphStore.getAllEdges().filter((e) => e.projectId === id).length;
        return {
          projectId: id,
          nodeCount,
          edgeCount,
          status: 'ready',
        };
      });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          items: projects,
          total: projectIds.size,
          returned: projects.length,
          hasMore: offset + limit < projectIds.size,
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error listing projects: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// delete_project
// ---------------------------------------------------------------------------

interface DeleteProjectParams {
  projectId: string;
  force?: boolean;
}

export const deleteProjectSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID to delete' },
    force: { type: 'boolean', description: 'Force deletion without confirmation' },
  },
  required: ['projectId'],
};

export async function deleteProject(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as DeleteProjectParams;
  const projectId = params.projectId;
  const force = Boolean(params.force);

  try {
    const graphStore = getStore(store);
    let deletedNodes = 0;
    let deletedEdges = 0;

    if (graphStore) {
      // Count edges before deleting nodes (deleteNode also removes edges)
      const projectEdges = graphStore.getAllEdges().filter((e) => e.projectId === projectId);
      deletedEdges = projectEdges.length;

      // Delete all nodes for this project
      const projectNodes = graphStore.getAllNodes().filter((n) => n.projectId === projectId);
      for (const node of projectNodes) {
        graphStore.deleteNode(node.id);
        deletedNodes++;
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          deleted: true,
          force,
          deletedNodes,
          deletedEdges,
          message: `Project "${projectId}" deleted: ${deletedNodes} nodes, ${deletedEdges} edges removed`,
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        projectId,
        deleted: false,
        error: message,
      }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// index_status
// ---------------------------------------------------------------------------

interface IndexStatusParams {
  projectId: string;
}

export const indexStatusSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID to check' },
  },
  required: ['projectId'],
};

export async function indexStatus(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as IndexStatusParams;
  const projectId = params.projectId;

  try {
    const ctx = getToolContext(store);

    if (ctx) {
      const stats = ctx.getGraphStats(projectId);
      const integrity = ctx.store.validateIntegrity(projectId);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            status: stats.nodeCount > 0 ? 'ready' : 'empty',
            nodeCount: stats.nodeCount,
            edgeCount: stats.edgeCount,
            labelDistribution: stats.labelDistribution,
            relationshipDistribution: stats.relationshipDistribution,
            valid: integrity.valid,
            issues: integrity.issues.length > 0 ? integrity.issues : undefined,
            indexedAt: integrity.checkedAt,
            message: `${stats.nodeCount} nodes, ${stats.edgeCount} edges indexed for project "${projectId}"`,
          }, null, 2),
        }],
      };
    }

    // Fallback: just query the store directly
    const graphStore = getStore(store);
    if (graphStore) {
      const integrity = graphStore.validateIntegrity(projectId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            status: integrity.nodeCount > 0 ? 'ready' : 'empty',
            nodeCount: integrity.nodeCount,
            edgeCount: integrity.edgeCount,
            valid: integrity.valid,
            issues: integrity.issues.length > 0 ? integrity.issues : undefined,
            indexedAt: integrity.checkedAt,
            message: `${integrity.nodeCount} nodes, ${integrity.edgeCount} edges indexed for project "${projectId}"`,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          status: 'unknown',
          nodeCount: 0,
          edgeCount: 0,
          indexedAt: null,
          message: `No store available to check index status for "${projectId}"`,
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        projectId,
        status: 'error',
        error: message,
      }, null, 2) }],
      isError: true,
    };
  }
}
