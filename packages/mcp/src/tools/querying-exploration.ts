// @ts-nocheck
// @code-analyzer/mcp — Querying & Exploration Tools

import { SqliteStore } from '@code-analyzer/infra';
import { tokenize, parse, plan, execute } from '../cypher/index.js';
import type { NodeLabel, GraphNode, SearchOptions, SearchResult } from '@code-analyzer/shared';
import type { ToolResult } from './registry.js';

// ---------------------------------------------------------------------------
// search_graph
// ---------------------------------------------------------------------------

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
  const query = args.query as string;
  const projectId = args.projectId as string | undefined;
  const labels = args.labels as string[] | undefined;
  const maxLimit = 100;
  const limit = Math.min((args.limit as number) ?? 20, maxLimit);
  const offset = (args.offset as number) ?? 0;

  if (store instanceof SqliteStore) {
    const results = store.searchFts(query, {
      limit,
      offset,
      labels: labels as NodeLabel[] | undefined,
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
        message: 'No store available',
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// search_code
// ---------------------------------------------------------------------------

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
  const query = args.query as string;
  const maxLimit = 100;
  const limit = Math.min((args.limit as number) ?? 20, maxLimit);
  const offset = (args.offset as number) ?? 0;

  if (store instanceof SqliteStore) {
    const results = store.searchFts(query, { limit, offset });
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
        }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ items: [], total: 0, returned: 0, hasMore: false }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// semantic_search
// ---------------------------------------------------------------------------

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

export async function semanticSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = args.query as string;
  const threshold = (args.threshold as number) ?? 0.7;
  const limit = Math.min((args.limit as number) ?? 10, 50);

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
        note: 'Semantic embeddings not yet indexed for this project',
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// trace_call_path
// ---------------------------------------------------------------------------

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
  const sourceSymbol = args.sourceSymbol as string;
  const targetSymbol = args.targetSymbol as string | undefined;
  const projectId = args.projectId as string;
  const maxDepth = (args.maxDepth as number) ?? 10;

  const result: {
    path: Array<{ symbol: string; depth: number; relationship: string }>;
    found: boolean;
    maxDepthReached: boolean;
  } = {
    path: [],
    found: false,
    maxDepthReached: false,
  };

  if (store instanceof SqliteStore) {
    const node = store.getNodeByQualifiedName(sourceSymbol);
    if (node) {
      const bfs = store.bfs(node.id, maxDepth, ['CALLS']);
      const path = bfs.nodes.map(n => ({
        symbol: n.qualifiedName,
        depth: bfs.pathLengths.get(n.id) ?? 0,
        relationship: 'CALLS',
      }));
      result.path = path;
      result.found = targetSymbol
        ? path.some(p => p.symbol === targetSymbol)
        : path.length > 0;
      result.maxDepthReached = bfs.maxDepthReached >= maxDepth;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// query_graph
// ---------------------------------------------------------------------------

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
  const cypher = args.cypher as string;
  const projectId = args.projectId as string | undefined;
  const limitH = (args.limit as number) ?? 20;

  if (store instanceof SqliteStore) {
    try {
      const tokens = tokenize(cypher);
      const ast = parse(tokens);
      const queryPlan = plan(ast);
      if (limitH) queryPlan.limit = limitH;
      const result = execute(queryPlan, store, projectId);

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
    } catch (error: unknown) {
      return {
        content: [{
          type: 'text',
          text: `Cypher query error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ columns: [], rows: [], rowCount: 0, error: 'No store available' }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// get_code_snippet
// ---------------------------------------------------------------------------

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

export async function getCodeSnippet(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args.filePath as string;
  const startLine = (args.startLine as number) ?? 1;
  const endLine = (args.endLine as number) ?? startLine;
  const contextLines = (args.contextLines as number) ?? 5;

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
}

// ---------------------------------------------------------------------------
// get_architecture
// ---------------------------------------------------------------------------

export const getArchitectureSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    detail: { type: 'string', description: 'Detail level (overview, detailed, full)', enum: ['overview', 'detailed', 'full'] },
  },
  required: ['projectId'],
};

export async function getArchitecture(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const projectId = args.projectId as string;
  const detail = (args.detail as string) ?? 'overview';

  const architecture: {
    layers: Array<{ name: string; components: string[] }>;
    patterns: string[];
    entryPoints: string[];
    dependencies: string[];
  } = {
    layers: [],
    patterns: [],
    entryPoints: [],
    dependencies: [],
  };

  if (store instanceof SqliteStore) {
    // Gather high-level architectural info from the graph
    const allNodes = store.getAllNodes().filter(n => n.projectId === projectId);
    const modules = allNodes.filter(n => n.label === 'Module');
    const classes = allNodes.filter(n => n.label === 'Class');
    const functions = allNodes.filter(n => n.label === 'Function');

    architecture.layers = [{
      name: 'application',
      components: [
        ...modules.map(m => m.name),
        ...classes.slice(0, 10).map(c => c.name),
      ],
    }];

    architecture.entryPoints = functions
      .filter(f => f.isExported)
      .slice(0, 10)
      .map(f => f.qualifiedName);

    architecture.dependencies = modules.map(m => m.qualifiedName);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        projectId,
        detail,
        architecture,
        nodeCount: store instanceof SqliteStore
          ? store.getAllNodes().filter(n => n.projectId === projectId).length
          : 0,
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// get_graph_schema
// ---------------------------------------------------------------------------

export const getGraphSchemaSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
  },
  required: ['projectId'],
};

export async function getGraphSchema(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const projectId = args.projectId as string;

  const schema: {
    nodeLabels: Array<{ label: string; count: number }>;
    relationshipTypes: Array<{ type: string; count: number }>;
  } = {
    nodeLabels: [],
    relationshipTypes: [],
  };

  if (store instanceof SqliteStore) {
    const nodes = store.getAllNodes().filter(n => n.projectId === projectId);
    const edges = store.getAllEdges().filter(e => e.projectId === projectId);

    // Count node labels
    const labelCounts = new Map<string, number>();
    for (const node of nodes) {
      labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1);
    }
    schema.nodeLabels = Array.from(labelCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    // Count relationship types
    const typeCounts = new Map<string, number>();
    for (const edge of edges) {
      typeCounts.set(edge.type, (typeCounts.get(edge.type) ?? 0) + 1);
    }
    schema.relationshipTypes = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// explore_symbol
// ---------------------------------------------------------------------------

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
  const symbolName = args.symbolName as string;
  const projectId = args.projectId as string;
  const includeRelationships = Boolean(args.includeRelationships);

  const result: {
    symbol: Record<string, unknown> | null;
    relationships: unknown[];
    calls: unknown[];
    calledBy: unknown[];
  } = {
    symbol: null,
    relationships: [],
    calls: [],
    calledBy: [],
  };

  if (store instanceof SqliteStore) {
    // Try qualified name first, then search
    let node = store.getNodeByQualifiedName(symbolName);
    if (!node) {
      const searchResults = store.searchFts(symbolName, { limit: 1 });
      if (searchResults.length > 0) {
        node = searchResults[0].node;
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
        complexity: node.complexity,
        isExported: node.isExported,
      };

      if (includeRelationships) {
        const outgoing = store.getEdgesForNode(node.id, undefined, 'out');
        const incoming = store.getEdgesForNode(node.id, undefined, 'in');
        result.relationships = [
          ...outgoing.map(e => ({ direction: 'outgoing', type: e.type, targetId: e.targetId })),
          ...incoming.map(e => ({ direction: 'incoming', type: e.type, sourceId: e.sourceId })),
        ];

        result.calls = outgoing
          .filter(e => e.type === 'CALLS')
          .map(e => ({ targetId: e.targetId, targetName: store.getNode(e.targetId)?.qualifiedName }));

        result.calledBy = incoming
          .filter(e => e.type === 'CALLS')
          .map(e => ({ sourceId: e.sourceId, callerName: store.getNode(e.sourceId)?.qualifiedName }));
      }
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// find_implementations
// ---------------------------------------------------------------------------

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
  const interfaceName = args.interfaceName as string;
  const projectId = args.projectId as string;
  const includeExternal = Boolean(args.includeExternal);

  const result: {
    interface: Record<string, unknown> | null;
    implementations: Array<{ id: number; name: string; qualifiedName: string; filePath: string | null }>;
    methodImplementations: unknown[];
  } = {
    interface: null,
    implementations: [],
    methodImplementations: [],
  };

  if (store instanceof SqliteStore) {
    let ifaceNode = store.getNodeByQualifiedName(interfaceName);
    if (!ifaceNode) {
      const searchResults = store.searchFts(interfaceName, { limit: 1, labels: ['Interface'] });
      if (searchResults.length > 0) ifaceNode = searchResults[0].node;
    }

    if (ifaceNode) {
      result.interface = {
        id: ifaceNode.id,
        name: ifaceNode.name,
        qualifiedName: ifaceNode.qualifiedName,
      };

      // Find IMPLEMENTS edges pointing to this interface
      const incoming = store.getEdgesForNode(ifaceNode.id, 'IMPLEMENTS', 'in');
      result.implementations = incoming
        .map(e => {
          const node = store.getNode(e.sourceId);
          return node ? {
            id: node.id,
            name: node.name,
            qualifiedName: node.qualifiedName,
            filePath: node.filePath,
          } : null;
        })
        .filter(Boolean) as Array<{ id: number; name: string; qualifiedName: string; filePath: string | null }>;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
