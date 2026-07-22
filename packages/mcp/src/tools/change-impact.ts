// @code-analyzer/mcp — Change & Impact Analysis Tools

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { ToolResult } from './registry.js';

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

export async function detectChanges(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as DetectChangesParams;
  const projectId = params.projectId;
  const fromRef = params.fromRef ?? 'HEAD~1';
  const toRef = params.toRef ?? 'HEAD';
  const includeFiles = Boolean(params.includeFiles);

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
      }, null, 2),
    }],
  };
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

  const result: {
    range: { from: string; to: string };
    changedFiles: string[];
    changedSymbols: unknown[];
    impactTree: unknown[];
    riskLevel: string;
    processesAffected: unknown[];
    estimatedEffort: string;
  } = {
    range: { from: fromRef, to: toRef },
    changedFiles: [],
    changedSymbols: [],
    impactTree: [],
    riskLevel: 'low',
    processesAffected: [],
    estimatedEffort: 'low',
  };

  if (store instanceof InMemoryGraphStore && targetSymbol) {
    const node = store.getNodeByQualifiedName(targetSymbol);
    if (node) {
      const bfs = store.bfs(node.id, depth, ['CALLS', 'IMPLEMENTS', 'EXTENDS']);
      result.impactTree = bfs.nodes.map(n => ({
        symbolQname: n.qualifiedName,
        label: n.label,
        filePath: n.filePath,
        impactType: bfs.pathLengths.get(n.id) === 1 ? 'direct' : 'indirect',
        depth: bfs.pathLengths.get(n.id) ?? 0,
        children: [],
      }));

      result.riskLevel = bfs.visitedCount > 20 ? 'high' : bfs.visitedCount > 10 ? 'medium' : 'low';
      result.estimatedEffort = bfs.visitedCount > 30 ? 'high' : bfs.visitedCount > 15 ? 'medium' : 'low';
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
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

  const routes: Array<{
    method: string;
    path: string;
    handler: string | undefined;
    filePath: string | undefined;
  }> = [];

  if (store instanceof InMemoryGraphStore) {
    const routeNodes = store.getAllNodes().filter(
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

  const result: {
    cyclesFound: number;
    cycles: Array<{ nodes: string[]; types: string[] }>;
    warnings: string[];
  } = {
    cyclesFound: 0,
    cycles: [],
    warnings: [],
  };

  if (store instanceof InMemoryGraphStore) {
    // Simple cycle detection using DFS for IMPORTS edges
    const nodes = module
      ? [store.getNodeByQualifiedName(module)].filter(Boolean) as NonNullable<ReturnType<typeof store.getNodeByQualifiedName>>[]
      : store.getAllNodes().filter(n => n.projectId === projectId && n.label === 'Module');

    const visited = new Set<number>();
    const recStack = new Set<number>();

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        detectCycle(node.id, store, visited, recStack, [], result);
      }
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
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
      // Cycle found
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
