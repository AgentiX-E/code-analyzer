// @code-analyzer/mcp — Cypher Executor
// Executes a query plan against an InMemoryGraphStore and formats results.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge, NodeLabel, RelationshipType, CypherExpression } from '@code-analyzer/shared';
import type { QueryPlan, ColumnDef, PlanStep } from './planner.js';
import { buildFilterPredicate } from './planner.js';

// ---------------------------------------------------------------------------
// Query Result
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Execution Context
// ---------------------------------------------------------------------------

interface ExecContext {
  nodes: Map<string, GraphNode[]>;
  edges: Map<string, GraphEdge[]>;
  nodeVars: Map<string, GraphNode>;
  store: InMemoryGraphStore;
  projectId: string;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/** Execute a query plan against the store and return formatted results. */
export function execute(plan: QueryPlan, store: InMemoryGraphStore, projectId?: string): QueryResult {
  const startTime = Date.now();

  const ctx: ExecContext = {
    nodes: new Map(),
    edges: new Map(),
    nodeVars: new Map(),
    store,
    projectId: projectId ?? '',
  };

  // Process steps in order
  for (const step of plan.steps) {
    executeStep(step, ctx);
  }

  // Build result rows from the final node variables and column definitions
  const columns = plan.columns.map((c) => c.name);
  const rows = buildResultRows(plan.columns, ctx);

  // Apply DISTINCT
  let finalRows = plan.distinct
    ? deduplicateRows(rows)
    : rows;

  // Apply SKIP
  if (plan.skip && plan.skip > 0) {
    finalRows = finalRows.slice(plan.skip);
  }

  // Apply LIMIT
  if (plan.limit !== undefined && plan.limit > 0) {
    finalRows = finalRows.slice(0, plan.limit);
  }

  const executionTimeMs = Date.now() - startTime;

  return {
    columns,
    rows: finalRows,
    rowCount: finalRows.length,
    executionTimeMs,
  };
}

/** Execute a single plan step against the execution context. */
function executeStep(step: PlanStep, ctx: ExecContext): void {
  switch (step.kind) {
    case 'scan':
      executeScan(step, ctx);
      break;
    case 'filter':
      executeFilter(step, ctx);
      break;
    case 'traverse':
      executeTraverse(step, ctx);
      break;
    case 'project':
      // Projection is handled during row building — no-op here
      break;
    case 'sort':
      executeSort(ctx);
      break;
    case 'limit':
    case 'skip':
      // Limit/skip handled at output building
      break;
  }
}

function executeScan(step: PlanStep, ctx: ExecContext): void {
  const details = step.details;
  const pattern = details['pattern'] as { variable: string; labels: string[]; properties: Record<string, unknown> };
  const varName = pattern.variable;

  // Get all matching nodes from the store
  const labels = pattern.labels.length > 0
    ? (pattern.labels.filter((l) => isNodeLabel(l)) as NodeLabel[])
    : undefined;

  const result = ctx.store.queryNodes({
    projectId: ctx.projectId,
    label: labels,
    limit: 10000,
    offset: 0,
  });

  const nodes = result.items.filter((node) => {
    if (ctx.projectId && node.projectId !== ctx.projectId) return false;

    // Filter by properties
    for (const [key, value] of Object.entries(pattern.properties)) {
      const nodeVal = getNodeProperty(node, key);
      if (nodeVal !== value) return false;
    }
    return true;
  });

  ctx.nodes.set(varName, nodes);
}

function executeFilter(step: PlanStep, ctx: ExecContext): void {
  const details = step.details;

  // Handle expression-based filters
  const rawExpression = details['expression'] as CypherExpression | undefined;
  if (rawExpression) {
    const predicate = rawExpression;
    const nodeVars = ctx.nodeVars;

    // For each bound variable, apply the filter
    const boundVars = Array.from(nodeVars.keys());
    if (boundVars.length === 0) return;

    // Apply predicate to each row combination
    for (const varName of boundVars) {
      const nodes = ctx.nodes.get(varName);
      if (!nodes || nodes.length === 0) continue;

      const filtered = nodes.filter((node) => {
        // Set up node vars with current node
        const localVars = new Map(nodeVars);
        localVars.set(varName, node);
        return buildFilterPredicate(
          predicate,
          (v) => localVars.get(v) ?? null,
          localVars,
        );
      });

      ctx.nodes.set(varName, filtered);
    }
  }

  // Handle label-based filters (already applied during scan)
  const rawLabel = details['label'] as string | undefined;
  if (rawLabel) {
    const nodes = ctx.nodes.get(rawLabel);
    if (nodes) {
      const rawValue = details['value'] as string[] | undefined;
      ctx.nodes.set(rawLabel, nodes.filter((n) =>
        rawValue ? (Array.isArray(rawValue) && rawValue.includes(n.label)) : true,
      ));
    }
  }
}

function executeTraverse(step: PlanStep, ctx: ExecContext): void {
  const details = step.details;
  const sourceVar = details['source'] as string;
  const rel = details['relationship'] as {
    variable?: string;
    types: string[];
    direction: 'left' | 'right' | 'both';
    minHops?: number;
    maxHops?: number;
  };
  const targetVar = details['target'] as string;

  const sourceNodes = ctx.nodes.get(sourceVar);
  if (!sourceNodes || sourceNodes.length === 0) return;

  const targetNodes: GraphNode[] = [];
  const edgeNodes: GraphEdge[] = [];

  for (const sourceNode of sourceNodes) {
    const edgeTypes = rel.types.length > 0
      ? (rel.types.filter((t) => isRelationshipType(t)) as RelationshipType[])
      : undefined;

    // Get outgoing edges
    if (rel.direction === 'right' || rel.direction === 'both') {
      const edges = edgeTypes
        ? edgeTypes.flatMap((t) => ctx.store.getEdgesForNode(sourceNode.id, t, 'out'))
        : ctx.store.getEdgesForNode(sourceNode.id, undefined, 'out');

      for (const edge of edges) {
        const targetNode = ctx.store.getNode(edge.targetId);
        if (targetNode) {
          targetNodes.push(targetNode);
          edgeNodes.push(edge);
        }
      }
    }

    // Get incoming edges
    if (rel.direction === 'left' || rel.direction === 'both') {
      const edges = edgeTypes
        ? edgeTypes.flatMap((t) => ctx.store.getEdgesForNode(sourceNode.id, t, 'in'))
        : ctx.store.getEdgesForNode(sourceNode.id, undefined, 'in');

      for (const edge of edges) {
        const targetNode = ctx.store.getNode(edge.sourceId); // reversed
        if (targetNode) {
          targetNodes.push(targetNode);
          edgeNodes.push(edge);
        }
      }
    }
  }

  if (targetVar) {
    ctx.nodes.set(targetVar, targetNodes);
  }
  if (rel.variable) {
    ctx.edges.set(rel.variable, edgeNodes);
  }

  // Update node vars for found nodes
  if (sourceNodes.length > 0 && sourceNodes[0]) {
    ctx.nodeVars.set(sourceVar, sourceNodes[0]!);
  }
  if (targetNodes.length > 0 && targetVar && targetNodes[0]) {
    ctx.nodeVars.set(targetVar, targetNodes[0]!);
  }
}

function executeSort(_ctx: ExecContext): void {
  // Sort will be applied after row building
  // This would require extracting sort columns from the step details
}

// ---------------------------------------------------------------------------
// Result Building
// ---------------------------------------------------------------------------

function buildResultRows(columns: ColumnDef[], ctx: ExecContext): Record<string, unknown>[] {
  // Find all bound node variables across all variable sets
  const allVarNames = new Set<string>();
  for (const varName of ctx.nodes.keys()) allVarNames.add(varName);
  for (const varName of ctx.edges.keys()) allVarNames.add(varName);

  // Get the set of nodes/edges for each column
  // Build rows by cartesian product of node sets

  if (allVarNames.size === 0) {
    return [];
  }

  // Simple case: project the columns directly from node variables
  // For properties like n.name, extract from the node

  // For a single MATCH, return one row per node
  const varNames = Array.from(allVarNames);
  const primaryVar = varNames[0];
  if (!primaryVar) return [];
  const primaryNodes = ctx.nodes.get(primaryVar) ?? [];
  const primaryEdges = ctx.edges.get(primaryVar) ?? [];

  if (columns.length === 0) {
    return [];
  }

  if (columns[0] && columns[0].expression === '*') {
    // Return all node data
    return [
      ...primaryNodes.map((n) => ({ node: n })),
      ...primaryEdges.map((e) => ({ edge: e })),
    ];
  }

  const rows: Record<string, unknown>[] = [];

  // Determine the data source for building rows
  const dataSource = primaryNodes.length > 0 ? primaryNodes : primaryEdges;

  for (const item of dataSource) {
    const row: Record<string, unknown> = {};

    for (const col of columns) {
      const value = resolveColumnValue(col, item, ctx);
      row[col.name] = value;
    }

    rows.push(row);
  }

  return rows;
}

function resolveColumnValue(
  col: ColumnDef,
  item: GraphNode | GraphEdge,
  ctx: ExecContext,
): unknown {
  const expr = col.expression;

  // Property access: n.propertyName
  if (expr.includes('.')) {
    const parts = expr.split('.');
    const prop = parts[1];
    if (!prop) return null;
    const node = 'id' in item ? (item as GraphNode) : null;

    if (node) {
      return getNodeProperty(node, prop);
    }
  }

  // Function call: COUNT(*), SUM(x), etc.
  if (expr.includes('(') && expr.includes(')')) {
    const match = expr.match(/^(\w+)\(/);
    if (match) {
      const funcName = match[1]!.toUpperCase();
      const allNodes = Array.from(ctx.nodes.values()).flat();
      const allEdges = Array.from(ctx.edges.values()).flat();

      switch (funcName) {
        case 'COUNT':
          return allNodes.length + allEdges.length;
        case 'SUM':
        case 'AVG':
        case 'MIN':
        case 'MAX':
          return 0; // Aggregate placeholder
        default:
          return 0;
      }
    }
  }

  // Direct variable: return the node or edge
  if (expr === '*') {
    return item;
  }

  return item;
}

function getNodeProperty(node: GraphNode, prop: string): unknown {
  const direct = (node as unknown as Record<string, unknown>)[prop];
  if (direct !== undefined) return direct;

  // Check properties bag
  if (node.properties && prop in node.properties) {
    return node.properties[prop];
  }

  return null;
}

function deduplicateRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];

  for (const row of rows) {
    const key = JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

function isNodeLabel(value: string): value is NodeLabel {
  return (['Project', 'Package', 'Folder', 'File', 'Module', 'Class', 'Interface',
    'Function', 'Method', 'Constructor', 'Property', 'Enum', 'TypeAlias', 'Struct',
    'Trait', 'Variable', 'Route', 'Tool', 'Component', 'Test', 'Community', 'Process',
    'Config', 'ADR', 'BasicBlock', 'InfraResource', 'CrossRepoFunction', 'CrossRepoInterface',
    'CrossRepoModule', 'Contract', 'Event', 'DataSource', 'Sink'] as const).includes(value as NodeLabel);
}

function isRelationshipType(value: string): value is RelationshipType {
  return (['CONTAINS', 'DEFINES', 'HAS_METHOD', 'HAS_PROPERTY', 'MEMBER_OF', 'BELONGS_TO',
    'EXTENDS', 'IMPLEMENTS', 'METHOD_OVERRIDES', 'METHOD_IMPLEMENTS', 'CALLS', 'IMPORTS',
    'ACCESSES', 'INSTANTIATES', 'USES_TYPE', 'HANDLES_ROUTE', 'HANDLES_TOOL', 'EXPOSES',
    'INJECTS', 'SIMILAR_TO', 'SEMANTICALLY_RELATED', 'TESTS', 'CHANGES_WITH', 'DATA_FLOWS',
    'STEP_IN_PROCESS', 'CFG', 'REACHING_DEF', 'TAINTED', 'SANITIZES', 'TAINT_PATH',
    'EMITS', 'LISTENS_ON', 'CONFIGURES', 'CROSS_REPO_DEPENDS', 'CROSS_REPO_CALLS',
    'CROSS_REPO_IMPLEMENTS', 'CROSS_REPO_IMPORTS', 'CROSS_REPO_EXPOSES', 'CROSS_REPO_CONTRACT'] as const).includes(value as RelationshipType);
}
