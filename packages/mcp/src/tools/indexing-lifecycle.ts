// @code-analyzer/mcp — Indexing & Lifecycle Tools

import { existsSync } from 'node:fs';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { analyzeInterproceduralTaint } from '@code-analyzer/intelligence';

import { ToolContextImpl, type ToolContext } from './tool-context.js';

import type { ToolResult } from './registry.js';
import type { PipelineResult } from '@code-analyzer/analyzer';
import type { ParsedFile, SupportedLanguage } from '@code-analyzer/shared';

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

/** What happened when the analysis graph was written to the store. */
interface PersistenceReport {
  /** Whether a store was reachable at all. **`false` means the nodes went out of scope with the pipeline result.** */
  readonly persisted: boolean;
  readonly nodes: number;
  readonly edges: number;
  /** Nodes whose qualified name already existed — the graph is stored as far as the store would take it. */
  readonly duplicateNodes: number;
  /** Edges whose endpoints were dropped, so they could not be remapped. */
  readonly orphanEdges: number;
  /** The first defect, in one sentence, or `null` when every node and edge was taken. */
  readonly reason: string | null;
}

/**
 * The report for a call that never ran a pipeline, so it had nothing to store.
 *
 * **`persisted: false` is on every response, and this is why.** The field spent a round as a property of the
 * pipeline path only, which meant two of the three return paths omitted it — and a caller reading
 * `payload.persisted.persisted` from those got `undefined`, which is falsy but reads as "no answer" rather than
 * "nothing was stored". The distinction a caller needs is *did the graph reach the store*, and a response that
 * does not carry the answer is the defect this whole file exists for.
 */
function nothingStored(reason: string): PersistenceReport {
  return { persisted: false, nodes: 0, edges: 0, duplicateNodes: 0, orphanEdges: 0, reason };
}

/**
 * Write a pipeline result into the graph store, remapping node ids as it goes.
 *
 * **The store is a parameter of type `InMemoryGraphStore`, not `InMemoryGraphStore | null`.** It was nullable,
 * for a caller that could not supply one — and the only caller supplies `ctx.store`, which the context guarantees,
 * so the null arm was a branch no test and no deployment could take. Covering it would have meant writing a test
 * for a state the code cannot be in; removing it means the type says what the function needs.
 *
 * **This function exists because the tool that indexes did not index.** `analyze_repository` ran the full pipeline,
 * reported `nodeCount`, and dropped `result.graph` when the handler returned: `currentAnalysis` was assigned on the tool
 * context and read by nothing, so after "indexing" a project the store held zero nodes and every query tool answered
 * about an empty graph. The unit tests did not see it because they insert nodes by hand, and the L4 harness saw it on its
 * first run — a tool that reports 805 nodes and leaves the store empty is the exact defect an end-to-end measurement
 * exists to find.
 *
 * **Ids are remapped, not copied.** The pipeline numbers its own nodes from zero and the store allocates its own ids, so
 * an edge inserted with the pipeline's ids either fails the store's existence check or - worse - attaches to whatever
 * node happened to take that id. The map is built as the nodes go in, and an edge with a missing endpoint is counted
 * rather than silently dropped.
 */
function persistGraph(
  graphStore: InMemoryGraphStore,
  result: PipelineResult,
  projectId: string,
  force: boolean,
): PersistenceReport {
  // **`force` is the promise that a re-index replaces the old one**, and a promise the store would otherwise keep by
  // throwing on the first node whose qualified name already exists — leaving the project half old and half new.
  if (force) {
    for (const edge of graphStore.getAllEdges()) {
      if (edge.projectId === projectId) graphStore.deleteEdge(edge.id);
    }
    for (const node of graphStore.getAllNodes()) {
      if (node.projectId === projectId) graphStore.deleteNode(node.id);
    }
  }

  const idMap = new Map<number, number>();
  let nodes = 0;
  let duplicateNodes = 0;
  let reason: string | null = null;
  for (const [pipelineId, node] of result.graph.nodes) {
    const { id: _pipelineId, ...rest } = node;
    try {
      idMap.set(pipelineId, graphStore.insertNode(rest));
      nodes += 1;
    } catch (error) {
      duplicateNodes += 1;
      reason ??= `node "${node.qualifiedName}" was not stored: ${String((error as Error).message)}`;
    }
  }

  let edges = 0;
  let orphanEdges = 0;
  for (const edge of result.graph.edges.values()) {
    const sourceId = idMap.get(edge.sourceId);
    const targetId = idMap.get(edge.targetId);
    if (sourceId === undefined || targetId === undefined) {
      orphanEdges += 1;
      continue;
    }
    try {
      graphStore.insertEdge({
        projectId: edge.projectId,
        type: edge.type,
        sourceId,
        targetId,
        properties: edge.properties,
        weight: edge.weight,
      });
      edges += 1;
    } catch (error) {
      orphanEdges += 1;
      reason ??= `edge ${edge.type} was not stored: ${String((error as Error).message)}`;
    }
  }

  return { persisted: true, nodes, edges, duplicateNodes, orphanEdges, reason };
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
    projectId: {
      type: 'string',
      description: 'Project identifier (auto-generated if not provided)',
    },
    language: {
      type: 'string',
      description: 'Programming language (auto-detected if not provided)',
    },
    force: { type: 'boolean', description: 'Force re-index even if already indexed' },
  },
  required: ['path'],
};

export async function analyzeRepository(
  args: Record<string, unknown>,
  store?: unknown,
): Promise<ToolResult> {
  const params = args as unknown as AnalyzeRepositoryParams;
  const path = params.path;
  const projectId = params.projectId ?? `project_${Date.now()}`;
  const language = params.language;
  const force = Boolean(params.force);

  try {
    // Validate path exists
    if (!existsSync(path)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                projectId,
                path,
                status: 'failed',
                error: `Path does not exist: ${path}`,
              },
              null,
              2,
            ),
          },
        ],
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
          language: language as SupportedLanguage | undefined,
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

      // Inter-procedural taint, run here because this is the only place that holds all three of its inputs at once:
      // the parse phase's parsed files and extraction, and the scope-resolution phase's call sites. They live in the
      // context above for exactly this call and then go out of scope, so the findings are kept on the tool context.
      const parseData = pipelineCtx.phaseData.get('parse') as
        { parsedFiles: ParsedFile[]; taintExtraction: Map<string, never> } | undefined;
      const scopeData = pipelineCtx.phaseData.get('scopeResolution') as
        { callSites: Map<string, never> } | undefined;
      if (parseData && scopeData) {
        try {
          const taint = analyzeInterproceduralTaint(
            parseData.parsedFiles,
            scopeData.callSites,
            parseData.taintExtraction,
          );
          ctx.taintFindings = taint.findings;
        } catch (error) {
          // A failing analysis must not fail indexing — the graph is still useful without taint findings.
          //
          // **And it must not be silent either.** This catch produced an empty array on failure, which is
          // indistinguishable from an analysis that ran and found nothing - the shape that hid five defects in this
          // subsystem. The findings are still empty and the indexing still succeeds; what changes is that a failure
          // now says so.
          console.warn('taint analysis failed; continuing without its findings', error);
          ctx.taintFindings = [];
        }
      }

      const nodeCount = result.graph.nodes.size;
      const edgeCount = result.graph.edges.size;
      const persisted = persistGraph(ctx.store, result, projectId, force);
      const phaseStatuses = result.phases.map((p) => ({
        phaseId: p.phaseId,
        status: p.status,
        duration: p.duration,
        error: p.error,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                projectId,
                path,
                // `??` binds looser than `>`, so the coalesce must be parenthesized
                // first — otherwise a provided `language` (a truthy string) is
                // discarded in favor of the literal 'auto-detected'.
                language: language ?? (result.graph.nodes.size > 0 ? 'auto-detected' : 'unknown'),
                status: result.status,
                force,
                nodeCount,
                edgeCount,
                // **What the store actually took**, beside what the pipeline computed. The two numbers were one number
                // until the graph was discarded, and a caller had no way to tell a stored project from a discarded one.
                persisted,
                phaseCount: result.phases.length,
                phases: phaseStatuses,
                errors: result.errors,
                duration: result.duration,
                message: `Analysis ${result.status}: ${nodeCount} nodes, ${edgeCount} edges in ${result.duration}ms`,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Fallback: basic analysis without pipeline (store-only)
    const graphStore = getStore(store);
    if (graphStore && force) {
      const integrity = graphStore.validateIntegrity(projectId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                projectId,
                path,
                language: language ?? 'auto-detected',
                // `force` is guaranteed truthy by the enclosing `if (graphStore && force)`
                // guard, so the 'indexed' arm of the old ternary was provably dead.
                status: 're-indexed',
                force,
                nodeCount: integrity.nodeCount,
                edgeCount: integrity.edgeCount,
                // The store was read, not written: no pipeline ran, so there was nothing to persist.
                persisted: nothingStored(
                  'no pipeline context was attached, so the store was inspected rather than written',
                ),
                message: `Store-based analysis: ${integrity.nodeCount} nodes, ${integrity.edgeCount} edges`,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId,
              path,
              language: language ?? 'auto-detected',
              status: 'indexing',
              force,
              persisted: nothingStored(
                'no pipeline context and no graph store were attached, so nothing was analysed and nothing was stored',
              ),
              message: `Repository analysis started for ${path}. Use get_graph_schema or cypher_query to inspect results after indexing.`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId,
              path,
              status: 'failed',
              error: `Analysis failed: ${message}`,
            },
            null,
            2,
          ),
        },
      ],
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

export async function listProjects(
  args: Record<string, unknown>,
  store?: unknown,
): Promise<ToolResult> {
  const params = args;
  const limit = (params['limit'] as number) ?? 50;
  const offset = (params['offset'] as number) ?? 0;

  try {
    const graphStore = getStore(store);
    if (!graphStore) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: [],
                total: 0,
                returned: 0,
                hasMore: false,
                message: 'No graph store available',
              },
              null,
              2,
            ),
          },
        ],
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
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              items: projects,
              total: projectIds.size,
              returned: projects.length,
              hasMore: offset + limit < projectIds.size,
            },
            null,
            2,
          ),
        },
      ],
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

export async function deleteProject(
  args: Record<string, unknown>,
  store?: unknown,
): Promise<ToolResult> {
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
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId,
              deleted: true,
              force,
              deletedNodes,
              deletedEdges,
              message: `Project "${projectId}" deleted: ${deletedNodes} nodes, ${deletedEdges} edges removed`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId,
              deleted: false,
              error: message,
            },
            null,
            2,
          ),
        },
      ],
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

export async function indexStatus(
  args: Record<string, unknown>,
  store?: unknown,
): Promise<ToolResult> {
  const params = args as unknown as IndexStatusParams;
  const projectId = params.projectId;

  try {
    const ctx = getToolContext(store);

    if (ctx) {
      const stats = ctx.getGraphStats(projectId);
      const integrity = ctx.store.validateIntegrity(projectId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
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
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Fallback: just query the store directly
    const graphStore = getStore(store);
    if (graphStore) {
      const integrity = graphStore.validateIntegrity(projectId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                projectId,
                status: integrity.nodeCount > 0 ? 'ready' : 'empty',
                nodeCount: integrity.nodeCount,
                edgeCount: integrity.edgeCount,
                valid: integrity.valid,
                issues: integrity.issues.length > 0 ? integrity.issues : undefined,
                indexedAt: integrity.checkedAt,
                message: `${integrity.nodeCount} nodes, ${integrity.edgeCount} edges indexed for project "${projectId}"`,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId,
              status: 'unknown',
              nodeCount: 0,
              edgeCount: 0,
              indexedAt: null,
              message: `No store available to check index status for "${projectId}"`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId,
              status: 'error',
              error: message,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// auto_index
// ---------------------------------------------------------------------------

interface AutoIndexParams {
  path: string;
  indexOnConnect?: boolean;
  projectIdPrefix?: string;
}

export const autoIndexSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the project to auto-index' },
    indexOnConnect: {
      type: 'boolean',
      description: 'Whether to run indexing immediately (default: true)',
    },
    projectIdPrefix: { type: 'string', description: 'Project ID prefix (default: "project")' },
  },
  required: ['path'],
};

export async function autoIndex(
  args: Record<string, unknown>,
  store?: unknown,
): Promise<ToolResult> {
  const params = args as unknown as AutoIndexParams;
  const path = params.path;
  const indexOnConnect = params.indexOnConnect ?? true;
  const projectIdPrefix = params.projectIdPrefix ?? 'project';

  try {
    // Validate path exists
    if (!existsSync(path)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                path,
                status: 'failed',
                error: `Path does not exist: ${path}`,
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    const graphStore = getStore(store);
    if (!graphStore) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                path,
                status: 'failed',
                error: 'No graph store available for auto-indexing',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    // Lazily import AutoIndexer and FileDiscoverer
    const { AutoIndexer } = await import('@code-analyzer/infra');
    const { createFileDiscoverer } = await import('@code-analyzer/infra');

    const discoverer = createFileDiscoverer();
    const indexer = new AutoIndexer(discoverer, graphStore, {
      indexOnConnect,
      projectIdPrefix,
    });

    const result = await indexer.onProjectOpen(path);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId: result.projectId,
              path: result.rootPath,
              status: 'indexed',
              type: result.projectInfo.type,
              languages: result.projectInfo.languages,
              hasDocker: result.projectInfo.hasDocker,
              hasK8s: result.projectInfo.hasK8s,
              packageManager: result.projectInfo.packageManager,
              filesDiscovered: result.filesDiscovered,
              nodesIndexed: result.nodesIndexed,
              durationMs: result.durationMs,
              message: `Auto-indexed ${result.nodesIndexed} nodes from ${result.filesDiscovered} files in ${result.durationMs}ms`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              path,
              status: 'failed',
              error: `Auto-index failed: ${message}`,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}
