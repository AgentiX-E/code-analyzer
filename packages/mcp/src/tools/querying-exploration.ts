// @code-analyzer/mcp — Querying & Exploration Tools

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { tokenize, parse, plan, execute } from '../cypher/index.js';
import { ToolContextImpl, type ToolContext } from './tool-context.js';
import type { NodeLabel } from '@code-analyzer/shared';
import type { ToolResult } from './registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getContext(store?: unknown): ToolContext | null {
  if (ToolContextImpl.isToolContext(store)) return store;
  return null;
}

function getStore(storeOrContext: unknown): InMemoryGraphStore | null {
  if (storeOrContext instanceof InMemoryGraphStore) return storeOrContext;
  if (ToolContextImpl.isToolContext(storeOrContext)) return storeOrContext.store;
  return null;
}

// ---------------------------------------------------------------------------
// search_graph
// ---------------------------------------------------------------------------

interface SearchGraphParams {
  query: string;
  projectId?: string;
  labels?: string[];
  limit?: number;
  offset?: number;
}

export const searchGraphSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query text' },
    projectId: { type: 'string', description: 'Project ID to search in' },
    labels: { type: 'array', items: { type: 'string' }, description: 'Node labels to filter by' },
    limit: { type: 'number', description: 'Maximum results to return (default: 20)' },
    offset: { type: 'number', description: 'Pagination offset' },
  },
  required: ['query'],
};

export async function searchGraph(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as SearchGraphParams;
  const query = params.query;
  const maxLimit = 100;
  const limit = Math.min(params.limit ?? 20, maxLimit);
  const offset = params.offset ?? 0;

  try {
    const graphStore = getStore(store);

    if (graphStore) {
      const results = graphStore.searchFts(query, {
        limit,
        offset,
        labels: (params.labels ?? []) as NodeLabel[],
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            items: results.map(r => ({
              nodeId: r.nodeId,
              name: r.node.name,
              qualifiedName: r.node.qualifiedName,
              label: r.node.label,
              filePath: r.node.filePath,
              rank: r.rank,
              snippet: r.snippet,
            })),
            total: results.length,
            returned: results.length,
            hasMore: results.length >= limit,
          }, null, 2),
        }],
      };
    }

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: `Search error: ${message}`,
      }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// search_code
// ---------------------------------------------------------------------------

interface SearchCodeParams {
  query: string;
  projectId?: string;
  filePath?: string;
  limit?: number;
  offset?: number;
}

export const searchCodeSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Code search query (supports regex)' },
    projectId: { type: 'string', description: 'Project ID to search in' },
    filePath: { type: 'string', description: 'Restrict search to a file pattern' },
    limit: { type: 'number', description: 'Maximum results (default: 20)' },
    offset: { type: 'number', description: 'Pagination offset' },
  },
  required: ['query'],
};

export async function searchCode(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as SearchCodeParams;
  const query = params.query;
  const maxLimit = 100;
  const limit = Math.min(params.limit ?? 20, maxLimit);
  const offset = params.offset ?? 0;

  try {
    const ctx = getContext(store);

    if (ctx) {
      // Use hybrid search (BM25 + vector fallback)
      const searchEngine = ctx.getSearchEngine();
      const results = await searchEngine.search({
        query,
        labels: undefined,
        limit,
        filePath: params.filePath,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            items: results.map(r => ({
              nodeId: r.node.id,
              name: r.node.name,
              qualifiedName: r.node.qualifiedName,
              filePath: r.node.filePath,
              startLine: r.node.startLine,
              endLine: r.node.endLine,
              label: r.node.label,
              signature: r.node.signature,
              bm25Score: r.bm25Score,
              vectorScore: r.vectorScore,
              combinedScore: r.combinedScore,
              searchMethod: r.vectorScore > 0 ? 'hybrid (BM25 + vector)' : 'BM25 text search',
            })),
            total: results.length,
            returned: results.length,
            hasMore: results.length >= limit,
          }, null, 2),
        }],
      };
    }

    // Fallback: use FTS from store
    const graphStore = getStore(store);
    if (graphStore) {
      const results = graphStore.searchFts(query, { limit, offset });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            items: results.map(r => ({
              nodeId: r.nodeId,
              name: r.node.name,
              filePath: r.node.filePath,
              startLine: r.node.startLine,
              endLine: r.node.endLine,
              rank: r.rank,
              snippet: r.snippet,
            })),
            total: results.length,
            returned: results.length,
            hasMore: results.length >= limit,
            searchMethod: 'FTS (basic text search)',
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ items: [], total: 0, returned: 0, hasMore: false, message: 'No store available' }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Search error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// semantic_search
// ---------------------------------------------------------------------------

interface SemanticSearchParams {
  query: string;
  projectId?: string;
  threshold?: number;
  limit?: number;
}

export const semanticSearchSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Natural language query for semantic search' },
    projectId: { type: 'string', description: 'Project ID' },
    threshold: { type: 'number', description: 'Similarity threshold (0-1, default: 0.7)' },
    limit: { type: 'number', description: 'Maximum results (default: 10)' },
  },
  required: ['query'],
};

export async function semanticSearch(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as SemanticSearchParams;
  const query = params.query;
  const threshold = params.threshold ?? 0.7;

  try {
    const ctx = getContext(store);
    if (ctx) {
      // Try vector search via hybrid search engine
      const searchEngine = ctx.getSearchEngine();
      const results = await searchEngine.search({
        query,
        limit: params.limit ?? 10,
      });

      const vectorResults = results.filter(r => r.vectorScore > 0);

      if (vectorResults.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              items: vectorResults.map(r => ({
                nodeId: r.node.id,
                name: r.node.name,
                qualifiedName: r.node.qualifiedName,
                filePath: r.node.filePath,
                vectorScore: r.vectorScore,
              })),
              total: vectorResults.length,
              returned: vectorResults.length,
              hasMore: false,
              query,
              threshold,
              note: 'Vector embeddings available',
            }, null, 2),
          }],
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          items: [],
          total: 0,
          returned: 0,
          hasMore: false,
          query,
          threshold,
          searchMethod: 'BM25 text search (vector embeddings not indexed)',
          note: 'Semantic embeddings not yet indexed for this project. Install an embedding provider for vector search.',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Semantic search error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// trace_call_path
// ---------------------------------------------------------------------------

interface TraceCallPathParams {
  sourceSymbol: string;
  targetSymbol?: string;
  projectId: string;
  maxDepth?: number;
}

export const traceCallPathSchema = {
  type: 'object',
  properties: {
    sourceSymbol: { type: 'string', description: 'Starting symbol (qualified name)' },
    targetSymbol: { type: 'string', description: 'Target symbol to trace to' },
    projectId: { type: 'string', description: 'Project ID' },
    maxDepth: { type: 'number', description: 'Maximum traversal depth (default: 10)' },
  },
  required: ['sourceSymbol', 'projectId'],
};

export async function traceCallPath(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as TraceCallPathParams;
  const sourceSymbol = params.sourceSymbol;
  const targetSymbol = params.targetSymbol;
  const maxDepth = params.maxDepth ?? 10;

  try {
    const result: {
      path: Array<{ symbol: string; depth: number; relationship: string; filePath: string | null }>;
      found: boolean;
      maxDepthReached: boolean;
    } = {
      path: [],
      found: false,
      maxDepthReached: false,
    };

    const graphStore = getStore(store);
    if (graphStore) {
      const node = graphStore.getNodeByQualifiedName(sourceSymbol);
      if (node) {
        const bfs = graphStore.bfs(node.id, maxDepth, ['CALLS', 'IMPLEMENTS', 'EXTENDS']);
        const path = bfs.nodes.map(n => ({
          symbol: n.qualifiedName,
          depth: bfs.pathLengths.get(n.id) ?? 0,
          relationship: 'CALLS',
          filePath: n.filePath,
        }));
        result.path = path;
        result.found = targetSymbol
          ? path.some(p => p.symbol === targetSymbol)
          : path.length > 1;
        result.maxDepthReached = bfs.maxDepthReached >= maxDepth;
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Trace error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// query_graph (Cypher)
// ---------------------------------------------------------------------------

interface QueryGraphParams {
  cypher: string;
  projectId?: string;
  limit?: number;
}

export const queryGraphSchema = {
  type: 'object',
  properties: {
    cypher: { type: 'string', description: 'Cypher query string' },
    projectId: { type: 'string', description: 'Project ID to query' },
    limit: { type: 'number', description: 'Maximum results (default: 20)' },
  },
  required: ['cypher'],
};

export async function queryGraph(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as QueryGraphParams;
  const cypher = params.cypher;
  const projectId = params.projectId;
  const limitH = params.limit ?? 20;

  try {
    const graphStore = getStore(store);

    if (graphStore) {
      const tokens = tokenize(cypher);
      const ast = parse(tokens);
      const queryPlan = plan(ast);
      if (limitH) queryPlan.limit = limitH;
      const result = execute(queryPlan, graphStore, projectId);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            columns: result.columns,
            rows: result.rows.slice(0, limitH),
            rowCount: result.rows.length,
            totalRows: result.rowCount,
            executionTimeMs: result.executionTimeMs,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ columns: [], rows: [], rowCount: 0, error: 'No store available' }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: `Cypher query error: ${message}`,
      }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// get_code_snippet
// ---------------------------------------------------------------------------

interface GetCodeSnippetParams {
  filePath: string;
  startLine?: number;
  endLine?: number;
  projectId: string;
  contextLines?: number;
}

export const getCodeSnippetSchema = {
  type: 'object',
  properties: {
    filePath: { type: 'string', description: 'File path of the code' },
    startLine: { type: 'number', description: 'Starting line number' },
    endLine: { type: 'number', description: 'Ending line number' },
    projectId: { type: 'string', description: 'Project ID' },
    contextLines: { type: 'number', description: 'Number of context lines around the snippet (default: 5)' },
  },
  required: ['filePath', 'projectId'],
};

export async function getCodeSnippet(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as GetCodeSnippetParams;
  const filePath = params.filePath;
  const startLine = params.startLine ?? 1;
  const endLine = params.endLine ?? startLine;
  const contextLines = params.contextLines ?? 5;

  try {
    const graphStore = getStore(store);

    if (graphStore) {
      // Try to find nodes in this file and line range
      const matchingNodes = graphStore.getAllNodes().filter(
        n => n.filePath === filePath && n.projectId === params.projectId,
      );

      if (matchingNodes.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              filePath,
              startLine: Math.max(1, startLine - contextLines),
              endLine: endLine + contextLines,
              symbolsInRange: matchingNodes
                .filter(n => {
                  if (n.startLine === null || n.endLine === null) return false;
                  return n.startLine <= endLine && n.endLine >= startLine;
                })
                .map(n => ({
                  name: n.name,
                  qualifiedName: n.qualifiedName,
                  label: n.label,
                  startLine: n.startLine,
                  endLine: n.endLine,
                  signature: n.signature,
                })),
              totalSymbols: matchingNodes.length,
              note: 'Graph-backed snippet info. Use review_file for code content analysis or read the file directly for full content.',
            }, null, 2),
          }],
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          filePath,
          startLine: Math.max(1, startLine - contextLines),
          endLine: endLine + contextLines,
          language: 'auto-detected',
          code: '// Code snippet not available in current session',
          note: 'File system access required for code retrieval',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Snippet error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// get_architecture
// ---------------------------------------------------------------------------

interface GetArchitectureParams {
  projectId: string;
  detail?: string;
}

export const getArchitectureSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    detail: { type: 'string', description: 'Detail level (overview, detailed, full)', enum: ['overview', 'detailed', 'full'] },
  },
  required: ['projectId'],
};

export async function getArchitecture(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as GetArchitectureParams;
  const projectId = params.projectId;
  const detail = params.detail ?? 'overview';

  try {
    const ctx = getContext(store);
    const graphStore = getStore(store);

    if (ctx) {
      const stats = ctx.getGraphStats(projectId);
      const allNodes = ctx.store.getAllNodes().filter(n => n.projectId === projectId);

      const modules = allNodes.filter(n => n.label === 'Module');
      const classes = allNodes.filter(n => n.label === 'Class');
      const functions = allNodes.filter(n => n.label === 'Function');
      const interfaces = allNodes.filter(n => n.label === 'Interface');
      const routes = allNodes.filter(n => n.label === 'Route');

      const architecture = {
        projectId,
        detail,
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        labelDistribution: stats.labelDistribution,
        layers: [{
          name: 'application',
          components: [
            ...modules.map(m => ({ name: m.name, qualifiedName: m.qualifiedName })),
            ...classes.slice(0, 20).map(c => ({ name: c.name, qualifiedName: c.qualifiedName })),
          ],
        }],
        patterns: [] as string[],
        entryPoints: functions
          .filter(f => f.isExported)
          .slice(0, 20)
          .map(f => ({ name: f.name, qualifiedName: f.qualifiedName, filePath: f.filePath })),
        interfaces: interfaces.slice(0, 10).map(i => ({
          name: i.name,
          qualifiedName: i.qualifiedName,
          filePath: i.filePath,
        })),
        routes: routes.map(r => ({
          path: r.properties.routePath ?? r.name,
          method: r.properties.routeMethod ?? 'GET',
          handler: r.qualifiedName,
        })),
        dependencies: modules.map(m => ({ name: m.name, qualifiedName: m.qualifiedName })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(architecture, null, 2) }],
      };
    }

    if (graphStore) {
      const allNodes = graphStore.getAllNodes().filter(n => n.projectId === projectId);
      const modules = allNodes.filter(n => n.label === 'Module');
      const classes = allNodes.filter(n => n.label === 'Class');
      const functions = allNodes.filter(n => n.label === 'Function');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            detail,
            architecture: {
              layers: [{
                name: 'application',
                components: [
                  ...modules.map(m => m.name),
                  ...classes.slice(0, 10).map(c => c.name),
                ],
              }],
              patterns: [],
              entryPoints: functions
                .filter(f => f.isExported)
                .slice(0, 10)
                .map(f => f.qualifiedName),
              dependencies: modules.map(m => m.qualifiedName),
            },
            nodeCount: allNodes.length,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          detail,
          architecture: { layers: [], patterns: [], entryPoints: [], dependencies: [] },
          nodeCount: 0,
          message: 'No graph store available',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Architecture error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// get_graph_schema
// ---------------------------------------------------------------------------

interface GetGraphSchemaParams {
  projectId: string;
}

export const getGraphSchemaSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
  },
  required: ['projectId'],
};

export async function getGraphSchema(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as GetGraphSchemaParams;
  const projectId = params.projectId;

  try {
    const ctx = getContext(store);
    if (ctx) {
      const stats = ctx.getGraphStats(projectId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            nodeCount: stats.nodeCount,
            edgeCount: stats.edgeCount,
            nodeLabels: stats.labelDistribution,
            relationshipTypes: stats.relationshipDistribution,
          }, null, 2),
        }],
      };
    }

    const graphStore = getStore(store);
    if (graphStore) {
      const nodes = graphStore.getAllNodes().filter(n => n.projectId === projectId);
      const edges = graphStore.getAllEdges().filter(e => e.projectId === projectId);

      const labelCounts = new Map<string, number>();
      for (const node of nodes) {
        labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1);
      }
      const nodeLabels = Array.from(labelCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

      const typeCounts = new Map<string, number>();
      for (const edge of edges) {
        typeCounts.set(edge.type, (typeCounts.get(edge.type) ?? 0) + 1);
      }
      const relationshipTypes = Array.from(typeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            nodeCount: nodes.length,
            edgeCount: edges.length,
            nodeLabels,
            relationshipTypes,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          nodeLabels: [],
          relationshipTypes: [],
          message: 'No graph store available',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Schema error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// explore_symbol
// ---------------------------------------------------------------------------

interface ExploreSymbolParams {
  symbolName: string;
  projectId: string;
  includeRelationships?: boolean;
}

export const exploreSymbolSchema = {
  type: 'object',
  properties: {
    symbolName: { type: 'string', description: 'Symbol name or qualified name to explore' },
    projectId: { type: 'string', description: 'Project ID' },
    includeRelationships: { type: 'boolean', description: 'Include relationships in result' },
  },
  required: ['symbolName', 'projectId'],
};

export async function exploreSymbol(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as ExploreSymbolParams;
  const symbolName = params.symbolName;
  const includeRelationships = Boolean(params.includeRelationships);

  try {
    const result: {
      symbol: Record<string, unknown> | null;
      relationships: unknown[];
      calls: unknown[];
      calledBy: unknown[];
      fileSymbols: unknown[];
    } = {
      symbol: null,
      relationships: [],
      calls: [],
      calledBy: [],
      fileSymbols: [],
    };

    const graphStore = getStore(store);

    if (graphStore) {
      let node = graphStore.getNodeByQualifiedName(symbolName);
      if (!node) {
        const searchResults = graphStore.searchFts(symbolName, { limit: 1 });
        const firstResult = searchResults[0];
        if (firstResult) {
          node = firstResult.node;
        }
      }

      if (node) {
        result.symbol = {
          id: node.id,
          name: node.name,
          qualifiedName: node.qualifiedName,
          label: node.label,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
          language: node.language,
          signature: node.signature,
          docstring: node.docstring,
          complexity: node.complexity,
          isExported: node.isExported,
          properties: node.properties,
        };

        // Get file siblings (all symbols in the same file)
        if (node.filePath) {
          const fileSymbols = graphStore.getAllNodes().filter(
            n => n.filePath === node!.filePath && n.id !== node!.id,
          );
          result.fileSymbols = fileSymbols.slice(0, 50).map(n => ({
            name: n.name,
            qualifiedName: n.qualifiedName,
            label: n.label,
            startLine: n.startLine,
            isExported: n.isExported,
          }));
        }

        if (includeRelationships) {
          const outgoing = graphStore.getEdgesForNode(node.id, undefined, 'out');
          const incoming = graphStore.getEdgesForNode(node.id, undefined, 'in');

          result.relationships = [
            ...outgoing.map(e => {
              const targetNode = graphStore.getNode(e.targetId);
              return {
                direction: 'outgoing',
                type: e.type,
                targetId: e.targetId,
                targetName: targetNode?.qualifiedName ?? `node-${e.targetId}`,
                targetLabel: targetNode?.label,
              };
            }),
            ...incoming.map(e => {
              const sourceNode = graphStore.getNode(e.sourceId);
              return {
                direction: 'incoming',
                type: e.type,
                sourceId: e.sourceId,
                sourceName: sourceNode?.qualifiedName ?? `node-${e.sourceId}`,
                sourceLabel: sourceNode?.label,
              };
            }),
          ];

          result.calls = outgoing
            .filter(e => e.type === 'CALLS')
            .map(e => {
              const targetNode = graphStore.getNode(e.targetId);
              return {
                targetId: e.targetId,
                targetName: targetNode?.qualifiedName,
                targetFile: targetNode?.filePath,
              };
            });

          result.calledBy = incoming
            .filter(e => e.type === 'CALLS')
            .map(e => {
              const sourceNode = graphStore.getNode(e.sourceId);
              return {
                sourceId: e.sourceId,
                callerName: sourceNode?.qualifiedName,
                callerFile: sourceNode?.filePath,
              };
            });
        }
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Explore error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// find_implementations
// ---------------------------------------------------------------------------

interface FindImplementationsParams {
  interfaceName: string;
  projectId: string;
  includeExternal?: boolean;
}

export const findImplementationsSchema = {
  type: 'object',
  properties: {
    interfaceName: { type: 'string', description: 'Interface name or qualified name' },
    projectId: { type: 'string', description: 'Project ID' },
    includeExternal: { type: 'boolean', description: 'Include cross-repo implementations' },
  },
  required: ['interfaceName', 'projectId'],
};

export async function findImplementations(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as FindImplementationsParams;
  const interfaceName = params.interfaceName;

  try {
    const result: {
      interface: Record<string, unknown> | null;
      implementations: Array<{ id: number; name: string; qualifiedName: string; filePath: string | null; methods?: string[] }>;
      methodImplementations: unknown[];
    } = {
      interface: null,
      implementations: [],
      methodImplementations: [],
    };

    const graphStore = getStore(store);

    if (graphStore) {
      let ifaceNode = graphStore.getNodeByQualifiedName(interfaceName);
      if (!ifaceNode) {
        const searchResults = graphStore.searchFts(interfaceName, { limit: 1, labels: ['Interface'] });
        const firstResult = searchResults[0];
        if (firstResult) ifaceNode = firstResult.node;
      }

      if (ifaceNode) {
        result.interface = {
          id: ifaceNode.id,
          name: ifaceNode.name,
          qualifiedName: ifaceNode.qualifiedName,
          filePath: ifaceNode.filePath,
        };

        // Find IMPLEMENTS edges pointing to this interface
        const incoming = graphStore.getEdgesForNode(ifaceNode.id, 'IMPLEMENTS', 'in');
        const implementorIds = new Set<number>();

        result.implementations = incoming
          .map(e => {
            const node = graphStore.getNode(e.sourceId);
            if (node) {
              implementorIds.add(node.id);
              return {
                id: node.id,
                name: node.name,
                qualifiedName: node.qualifiedName,
                filePath: node.filePath,
              };
            }
            return null;
          })
          .filter(Boolean) as Array<{ id: number; name: string; qualifiedName: string; filePath: string | null }>;

        // Find method implementations
        for (const implId of implementorIds) {
          const methods = graphStore.getEdgesForNode(implId, 'HAS_METHOD', 'out');
          for (const methodEdge of methods) {
            const methodNode = graphStore.getNode(methodEdge.targetId);
            if (methodNode) {
              result.methodImplementations.push({
                implementorId: implId,
                methodName: methodNode.name,
                methodQname: methodNode.qualifiedName,
                filePath: methodNode.filePath,
              });
            }
          }
        }
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Implementation search error: ${message}` }],
      isError: true,
    };
  }
}
