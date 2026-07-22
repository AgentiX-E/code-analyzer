// @code-analyzer/mcp — Change & Impact Analysis Tools

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl, type ToolContext } from './tool-context.js';
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
// detect_changes
// ---------------------------------------------------------------------------

interface DetectChangesParams {
  projectId: string;
  fromRef?: string;
  toRef?: string;
  includeFiles?: boolean;
}

export const detectChangesSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    fromRef: { type: 'string', description: 'Base reference (commit/branch/tag)' },
    toRef: { type: 'string', description: 'Target reference (commit/branch/tag)' },
    includeFiles: { type: 'boolean', description: 'Include changed file list' },
  },
  required: ['projectId'],
};

export async function detectChanges(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as DetectChangesParams;
  const projectId = params.projectId;
  const fromRef = params.fromRef ?? 'HEAD~1';
  const toRef = params.toRef ?? 'HEAD';
  const includeFiles = Boolean(params.includeFiles);

  try {
    const ctx = getContext(store);

    if (ctx) {
      const stats = ctx.getGraphStats(projectId);

      // From the graph, we can list all files and their symbol counts
      const allNodes = ctx.store.getAllNodes().filter(n => n.projectId === projectId);
      const fileMap = new Map<string, { symbols: number; complexity: number }>();
      for (const node of allNodes) {
        if (!node.filePath) continue;
        const entry = fileMap.get(node.filePath) ?? { symbols: 0, complexity: 0 };
        entry.symbols++;
        entry.complexity += node.complexity ?? 0;
        fileMap.set(node.filePath, entry);
      }

      // Find files that are likely to have changed (heuristic: files with high complexity)
      const riskyFiles = Array.from(fileMap.entries())
        .filter(([_, v]) => v.complexity > 10 || v.symbols > 20)
        .map(([path, v]) => ({ filePath: path, symbols: v.symbols, avgComplexity: v.complexity / Math.max(1, v.symbols) }));

      // Find symbols with the most dependents (highly referenced = high risk when changed)
      const highImpactSymbols: unknown[] = [];
      for (const node of allNodes.slice(0, 50)) {
        const degree = ctx.store.getDegree(node.id);
        if (degree > 3) {
          highImpactSymbols.push({
            name: node.name,
            qualifiedName: node.qualifiedName,
            filePath: node.filePath,
            label: node.label,
            dependencyCount: degree,
            isExported: node.isExported,
          });
        }
      }

      highImpactSymbols.sort((a: any, b: any) => b.dependencyCount - a.dependencyCount);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            range: { from: fromRef, to: toRef },
            summary: {
              totalFiles: fileMap.size,
              totalSymbols: stats.nodeCount,
              filesChanged: riskyFiles.length,
              symbolsChanged: highImpactSymbols.length,
              risk: riskyFiles.length > 20 ? 'high' : riskyFiles.length > 10 ? 'medium' : 'low',
            },
            changedFiles: includeFiles ? riskyFiles : undefined,
            changedSymbols: highImpactSymbols.slice(0, 30),
            detectionMethod: 'Graph-based heuristic change detection',
            note: 'For precise change detection, provide git diff content and use review_pr or impact_analysis.',
          }, null, 2),
        }],
      };
    }

    const graphStore = getStore(store);
    if (graphStore) {
      const integrity = graphStore.validateIntegrity(projectId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            range: { from: fromRef, to: toRef },
            summary: {
              filesChanged: 0,
              symbolsChanged: 0,
              risk: 'low',
            },
            changedFiles: includeFiles ? [] : undefined,
            changedSymbols: [],
            graphIntegrity: integrity,
            note: 'No diff data available. Index repository first.',
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          range: { from: fromRef, to: toRef },
          summary: { filesChanged: 0, symbolsChanged: 0, risk: 'low' },
          changedFiles: includeFiles ? [] : undefined,
          changedSymbols: [],
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Change detection error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// impact_analysis
// ---------------------------------------------------------------------------

interface ImpactAnalysisParams {
  projectId: string;
  targetSymbol?: string;
  fromRef: string;
  toRef: string;
  depth?: number;
}

export const impactAnalysisSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    targetSymbol: { type: 'string', description: 'Target symbol to analyze impact of' },
    fromRef: { type: 'string', description: 'Base reference' },
    toRef: { type: 'string', description: 'Target reference' },
    depth: { type: 'number', description: 'Analysis depth (default: 3)' },
  },
  required: ['projectId', 'fromRef', 'toRef'],
};

export async function impactAnalysis(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as ImpactAnalysisParams;
  const targetSymbol = params.targetSymbol;
  const fromRef = params.fromRef;
  const toRef = params.toRef;
  const depth = params.depth ?? 3;

  try {
    const ctx = getContext(store);
    const graphStore = getStore(store);

    const result: {
      range: { from: string; to: string };
      changedFiles: string[];
      changedSymbols: unknown[];
      impactTree: unknown[];
      riskLevel: string;
      processesAffected: unknown[];
      estimatedEffort: string;
      directDependents: number;
      indirectDependents: number;
      totalImpact: number;
    } = {
      range: { from: fromRef, to: toRef },
      changedFiles: [],
      changedSymbols: [],
      impactTree: [],
      riskLevel: 'low',
      processesAffected: [],
      estimatedEffort: 'low',
      directDependents: 0,
      indirectDependents: 0,
      totalImpact: 0,
    };

    if (graphStore && targetSymbol) {
      const node = graphStore.getNodeByQualifiedName(targetSymbol);
      if (node) {
        // BFS traversal for impact analysis
        const bfs = graphStore.bfs(node.id, depth, ['CALLS', 'IMPLEMENTS', 'EXTENDS', 'MEMBER_OF']);

        // Separate direct vs indirect
        const directNodes: unknown[] = [];
        const indirectNodes: unknown[] = [];

        const nodesByDepth: unknown[] = bfs.nodes.map(n => {
          const nodeDepth = bfs.pathLengths.get(n.id) ?? 0;
          const impactNode = {
            symbolQname: n.qualifiedName,
            label: n.label,
            filePath: n.filePath,
            impactType: nodeDepth === 1 ? 'direct' : nodeDepth === 2 ? 'indirect' : 'transitive',
            depth: nodeDepth,
            children: [] as unknown[],
          };

          if (nodeDepth === 1) directNodes.push(impactNode);
          else if (nodeDepth > 1) indirectNodes.push(impactNode);

          return impactNode;
        });

        result.impactTree = nodesByDepth;
        result.directDependents = directNodes.length;
        result.indirectDependents = indirectNodes.length;
        result.totalImpact = bfs.visitedCount;

        // Track unique files
        const files = new Set<string>();
        for (const n of bfs.nodes) {
          if (n.filePath) files.add(n.filePath);
        }
        result.changedFiles = Array.from(files);

        // Determine risk level
        const totalImpacted = bfs.visitedCount;
        if (totalImpacted > 30) {
          result.riskLevel = 'critical';
          result.estimatedEffort = 'high';
        } else if (totalImpacted > 15) {
          result.riskLevel = 'high';
          result.estimatedEffort = totalImpacted > 25 ? 'high' : 'medium';
        } else if (totalImpacted > 5) {
          result.riskLevel = 'medium';
          result.estimatedEffort = 'medium';
        } else {
          result.riskLevel = 'low';
          result.estimatedEffort = 'low';
        }

        result.changedSymbols = directNodes.slice(0, 20);

        // Find processes and routes involved
        const processNodes = bfs.nodes.filter(n => n.label === 'Process');
        const routeNodes = bfs.nodes.filter(n => n.label === 'Route');
        result.processesAffected = [
          ...processNodes.map(p => ({
            processName: p.qualifiedName,
            severity: 'degraded',
          })),
          ...routeNodes.map(r => ({
            routePath: r.properties.routePath ?? r.name,
            routeMethod: r.properties.routeMethod ?? 'GET',
            severity: 'degraded',
          })),
        ];
      }
    } else if (graphStore && !targetSymbol) {
      // Global analysis: find all symbols with no incoming edges (roots)
      const allNodes = graphStore.getAllNodes().filter(n => n.projectId === params.projectId);
      const roots = allNodes.filter(n => {
        const incoming = graphStore.getEdgesForNode(n.id, undefined, 'in');
        return incoming.length === 0;
      });

      result.changedFiles = [...new Set(roots.map(r => r.filePath).filter(Boolean) as string[])];
      result.changedSymbols = roots.slice(0, 20).map(r => ({
        symbolQname: r.qualifiedName,
        label: r.label,
        filePath: r.filePath,
        dependencyCount: graphStore.getDegree(r.id),
      }));

      result.note = 'No target symbol specified. Showing root symbols (no dependencies). Use a specific symbol for detailed impact analysis.';
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Impact analysis error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// route_map
// ---------------------------------------------------------------------------

interface RouteMapParams {
  projectId: string;
  includeHandlers?: boolean;
}

export const routeMapSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    includeHandlers: { type: 'boolean', description: 'Include handler details' },
  },
  required: ['projectId'],
};

export async function routeMap(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as RouteMapParams;
  const projectId = params.projectId;
  const includeHandlers = Boolean(params.includeHandlers);

  try {
    const routes: Array<{
      method: string;
      path: string;
      handler: string | undefined;
      filePath: string | undefined;
    }> = [];

    const graphStore = getStore(store);

    if (graphStore) {
      const routeNodes = graphStore.getAllNodes().filter(
        n => n.projectId === projectId && n.label === 'Route',
      );

      routes.push(...routeNodes.map(n => ({
        method: n.properties.routeMethod ?? 'GET',
        path: n.properties.routePath ?? n.qualifiedName,
        handler: includeHandlers ? n.name : undefined,
        filePath: includeHandlers ? n.filePath ?? undefined : undefined,
      })));
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          routeCount: routes.length,
          routes,
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Route map error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// check_cycles
// ---------------------------------------------------------------------------

interface CheckCyclesParams {
  projectId: string;
  module?: string;
  maxDepth?: number;
}

export const checkCyclesSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    module: { type: 'string', description: 'Specific module to check (optional, all if not provided)' },
    maxDepth: { type: 'number', description: 'Maximum cycle detection depth (default: 10)' },
  },
  required: ['projectId'],
};

export async function checkCycles(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as CheckCyclesParams;
  const projectId = params.projectId;
  const module = params.module;

  try {
    const result: {
      cyclesFound: number;
      cycles: Array<{ nodes: string[]; types: string[] }>;
      warnings: string[];
    } = {
      cyclesFound: 0,
      cycles: [],
      warnings: [],
    };

    const graphStore = getStore(store);

    if (graphStore) {
      const nodes = module
        ? [graphStore.getNodeByQualifiedName(module)].filter(Boolean) as NonNullable<ReturnType<typeof graphStore.getNodeByQualifiedName>>[]
        : graphStore.getAllNodes().filter(n => n.projectId === projectId);

      const visited = new Set<number>();
      const recStack = new Set<number>();

      for (const node of nodes) {
        if (!visited.has(node.id)) {
          detectCycle(node.id, graphStore, visited, recStack, [], result);
        }
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Cycle check error: ${message}` }],
      isError: true,
    };
  }
}

function detectCycle(
  nodeId: number,
  store: InMemoryGraphStore,
  visited: Set<number>,
  recStack: Set<number>,
  path: number[],
  result: { cyclesFound: number; cycles: Array<{ nodes: string[]; types: string[] }>; warnings: string[] },
): void {
  visited.add(nodeId);
  recStack.add(nodeId);
  path.push(nodeId);

  const outgoing = store.getEdgesForNode(nodeId, 'IMPORTS', 'out');
  for (const edge of outgoing) {
    const neighborId = edge.targetId;
    if (!visited.has(neighborId)) {
      detectCycle(neighborId, store, visited, recStack, path, result);
    } else if (recStack.has(neighborId)) {
      const cycleStart = path.indexOf(neighborId);
      if (cycleStart >= 0) {
        const cyclePath = path.slice(cycleStart);
        const cycleNames = cyclePath
          .map(id => store.getNode(id)?.qualifiedName ?? `node_${id}`);
        result.cycles.push({
          nodes: cycleNames,
          types: cyclePath.map(id => store.getNode(id)?.label ?? 'Module'),
        });
        result.cyclesFound++;
      }
    }
  }

  path.pop();
  recStack.delete(nodeId);
}
