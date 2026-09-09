// @code-analyzer/mcp — Cypher Executor
// Executes a query plan against an InMemoryGraphStore and formats results.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  GraphNode,
  GraphEdge,
  NodeLabel,
  RelationshipType,
  CypherExpression,
} from '@code-analyzer/shared';
import { NODE_LABELS, RELATIONSHIP_TYPES } from '@code-analyzer/shared';
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
export function execute(
  plan: QueryPlan,
  store: InMemoryGraphStore,
  projectId?: string,
): QueryResult {
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

  // Apply ORDER BY
  let finalRows = rows;
  if (plan.orderBy && plan.orderBy.length > 0) {
    finalRows = applySort(rows, plan.orderBy);
  }

  // Apply DISTINCT
  finalRows = plan.distinct ? deduplicateRows(finalRows) : finalRows;

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
  const pattern = details['pattern'] as {
    variable: string;
    labels: string[];
    properties: Record<string, unknown>;
  };
  const varName = pattern.variable;

  // Get all matching nodes from the store
  const labels =
    pattern.labels.length > 0
      ? (pattern.labels.filter((l) => isNodeLabel(l)) as NodeLabel[])
      : undefined;

  const result = ctx.store.queryNodes({
    projectId: ctx.projectId,
    label: labels,
    limit: 10000,
    offset: 0,
  });

  // The store's queryNodes already filters by projectId, so re-checking the
  // project on every node here is redundant.
  const nodes = result.items.filter((node) => {
    // Filter by properties
    for (const [key, value] of Object.entries(pattern.properties)) {
      const nodeVal = getProperty(node, key);
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
        return buildFilterPredicate(predicate, localVars);
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
      ctx.nodes.set(
        rawLabel,
        nodes.filter((n) =>
          rawValue ? Array.isArray(rawValue) && rawValue.includes(n.label) : true,
        ),
      );
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
    const edgeTypes =
      rel.types.length > 0
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

  // Update node vars for found nodes.
  // Invariant: sourceNodes is non-empty — guarded by the early return above.
  ctx.nodeVars.set(sourceVar, sourceNodes[0]!);
  if (targetNodes.length > 0 && targetVar && targetNodes[0]) {
    ctx.nodeVars.set(targetVar, targetNodes[0]!);
  }
}

function executeSort(_ctx: ExecContext): void {
  // Sort is applied after row building in applySort().
  // The PlanStep carries sort details that are consumed
  // during the execute() phase via plan.orderBy.
}

// ---------------------------------------------------------------------------
// Sort Implementation
// ---------------------------------------------------------------------------

interface SortColumn {
  expression: string;
  direction: 'asc' | 'desc';
}

/** Sort result rows by one or more columns with direction support. */
function applySort(
  rows: Record<string, unknown>[],
  orderBy: SortColumn[],
): Record<string, unknown>[] {
  if (rows.length === 0 || orderBy.length === 0) return rows;

  const sorted = [...rows];

  sorted.sort((a, b) => {
    for (const col of orderBy) {
      // Invariant: when the expression contains '.', split('.') yields at
      // least two parts, so the part after the first '.' is always defined.
      const colName = col.expression.includes('.') ? col.expression.split('.')[1]! : col.expression;

      const aVal = a[colName] ?? a[col.expression];
      const bVal = b[colName] ?? b[col.expression];

      const cmp = compareValues(aVal, bVal);
      if (cmp !== 0) {
        return col.direction === 'desc' ? -cmp : cmp;
      }
    }
    return 0;
  });

  return sorted;
}

/** Compare two values of potentially different types for sorting. */
function compareValues(a: unknown, b: unknown): number {
  // Handle null/undefined — nulls sort last
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  // Number comparison
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  // String comparison (case-insensitive)
  const aStr = String(a);
  const bStr = String(b);
  return aStr.localeCompare(bStr, undefined, { sensitivity: 'base', numeric: true });
}

// ---------------------------------------------------------------------------
// Result Building
// ---------------------------------------------------------------------------

function buildResultRows(columns: ColumnDef[], ctx: ExecContext): Record<string, unknown>[] {
  // Invariant: node variables are always bound before any edge (relationship)
  // variable. A traverse step requires a prior scan to bind its source node, so
  // the first bound variable is always a node variable. Edge variables are only
  // produced by traverse and therefore never precede the source node variable.
  const varNames = Array.from(ctx.nodes.keys());
  if (varNames.length === 0) {
    return [];
  }

  // Simple case: project the columns directly from node variables
  // For properties like n.name, extract from the node

  // For a single MATCH, return one row per node
  const primaryVar = varNames[0]!;
  const primaryNodes = ctx.nodes.get(primaryVar)!;

  if (columns.length === 0) {
    return [];
  }

  if (columns[0] && columns[0].expression === '*') {
    // Return all node data
    return primaryNodes.map((n) => ({ node: n }));
  }

  const rows: Record<string, unknown>[] = [];

  for (const item of primaryNodes) {
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

  // Function call: COUNT(*), SUM(x), etc. — checked before property access
  // because aggregate arguments (e.g. SUM(n.complexity)) contain a '.', which
  // must not be mistaken for a property access on the item itself.
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

  // Property access: n.propertyName
  if (expr.includes('.')) {
    const parts = expr.split('.');
    const prop = parts[1];
    if (!prop) return null;
    // getProperty handles both nodes and edges (both expose a `properties` bag
    // and direct fields), so no node/edge discrimination is required here.
    return getProperty(item, prop);
  }

  // Direct variable: return the node or edge
  if (expr === '*') {
    return item;
  }

  return item;
}

/** Extract a property from a node or edge by checking direct fields first, then the properties bag. */
function getProperty(item: GraphNode | GraphEdge, prop: string): unknown {
  const direct = (item as unknown as Record<string, unknown>)[prop];
  if (direct !== undefined) return direct;

  // Check properties bag
  if (item.properties && prop in item.properties) {
    return item.properties[prop];
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
  return (NODE_LABELS as readonly string[]).includes(value);
}

function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}
