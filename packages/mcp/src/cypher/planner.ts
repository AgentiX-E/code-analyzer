// @ts-nocheck
// @code-analyzer/mcp — Cypher Planner
// Translates a Cypher AST into a SQL-compatible query plan.

import type {
  CypherExpression,
  MatchClause,
  ReturnItem,
  NodePattern,
  RelationshipPattern,
  NodeLabel,
  GraphNode,
  GraphEdge,
} from '@code-analyzer/shared';
import type { CypherQuery, WithClause } from './parser.js';
import { NODE_LABELS, RELATIONSHIP_TYPES } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Graph Schema
// ---------------------------------------------------------------------------

export interface GraphSchema {
  nodeLabels: readonly string[];
  relationshipTypes: readonly string[];
  nodeProperties: string[];
  edgeProperties: string[];
}

export const DEFAULT_SCHEMA: GraphSchema = {
  nodeLabels: NODE_LABELS as unknown as string[],
  relationshipTypes: RELATIONSHIP_TYPES as unknown as string[],
  nodeProperties: ['name', 'qualifiedName', 'filePath', 'startLine', 'endLine', 'language', 'complexity', 'signature', 'docstring', 'isExported', 'createdAt', 'updatedAt'],
  edgeProperties: ['weight', 'createdAt'],
};

// ---------------------------------------------------------------------------
// Query Plan
// ---------------------------------------------------------------------------

export type StepKind = 'scan' | 'filter' | 'traverse' | 'project' | 'sort' | 'limit' | 'skip';

export interface PlanStep {
  kind: StepKind;
  details: Record<string, unknown>;
}

export interface ColumnDef {
  name: string;
  expression: string;
  type: 'node' | 'edge' | 'property' | 'computed';
}

export interface QueryPlan {
  source: string;
  steps: PlanStep[];
  columns: ColumnDef[];
  params: Record<string, unknown>;
  distinct: boolean;
  limit?: number;
  skip?: number;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/** Translate a Cypher AST into a SQL-like query plan. */
export function plan(ast: CypherQuery, schema: GraphSchema = DEFAULT_SCHEMA): QueryPlan {
  const steps: PlanStep[] = [];
  const params: Record<string, unknown> = {};
  let paramCounter = 0;

  // Process each MATCH clause
  const nodeVars = new Set<string>();
  const edgeVars = new Set<string>();

  for (const matchClause of ast.match) {
    for (const pattern of matchClause.patterns) {
      // Register node variable
      if (pattern.variable) {
        nodeVars.add(pattern.variable);
      }

      steps.push({
        kind: 'scan',
        details: {
          pattern: {
            variable: pattern.variable,
            labels: pattern.labels,
            properties: pattern.properties,
          },
        },
      });

      // Add filters for labels
      if (pattern.labels.length > 0) {
        paramCounter++;
        const paramName = `$label_${paramCounter}`;
        params[`label_${paramCounter}`] = pattern.labels;
        steps.push({
          kind: 'filter',
          details: {
            predicate: `${pattern.variable ? pattern.variable + '.' : ''}label IN (${paramName})`,
            param: paramName,
            value: pattern.labels,
          },
        });
      }

      // Add filters for properties
      for (const [key, exprVal] of Object.entries(pattern.properties)) {
        const value = resolveConcreteValue(exprVal);
        paramCounter++;
        const paramName = `$prop_${paramCounter}`;
        params[`prop_${paramCounter}`] = value;
        steps.push({
          kind: 'filter',
          details: {
            predicate: `${pattern.variable ? pattern.variable + '.' : ''}${key} = ${paramName}`,
            param: paramName,
            value,
          },
        });
      }

      // Process relationships
      if (pattern.relationships) {
        for (const rel of pattern.relationships) {
          if (rel.variable) {
            edgeVars.add(rel.variable);
          }

          steps.push({
            kind: 'traverse',
            details: {
              source: pattern.variable,
              relationship: {
                variable: rel.variable,
                types: rel.types,
                direction: rel.direction,
                minHops: rel.minHops,
                maxHops: rel.maxHops,
              },
              target: rel.target.variable,
            },
          });

          // Filter by relationship type
          if (rel.types.length > 0) {
            paramCounter++;
            const paramName = `$reltype_${paramCounter}`;
            params[`reltype_${paramCounter}`] = rel.types;
            steps.push({
              kind: 'filter',
              details: {
                predicate: `type IN (${paramName})`,
                param: paramName,
                value: rel.types,
              },
            });
          }
        }
      }
    }
  }

  // WHERE clause → filter step
  if (ast.where) {
    steps.push({
      kind: 'filter',
      details: { expression: ast.where.condition },
    });
  }

  // WITH clause → intermediate projection
  if (ast.withClause) {
    const columns: ColumnDef[] = ast.withClause.items.map((item, i) => ({
      name: item.alias ?? `col_${i}`,
      expression: exprToString(item.expression),
      type: inferColumnType(item.expression),
    }));

    steps.push({
      kind: 'project',
      details: { columns, isWith: true },
    });
  }

  // RETURN clause → projection step
  const columns: ColumnDef[] = ast.returnClause.items.map((item, i) => ({
    name: item.alias ?? `col_${i}`,
    expression: exprToString(item.expression),
    type: inferColumnType(item.expression),
  }));

  steps.push({
    kind: 'project',
    details: { columns, isWith: false },
  });

  // ORDER BY / LIMIT / SKIP
  const orderBy = ast.orderBy;
  const limit = ast.limit;
  const skip = ast.skip;
  const distinct = ast.returnClause.distinct;
  const source = 'code_analyzer_graph';

  return {
    source,
    steps,
    columns,
    params,
    distinct,
    limit: limit ?? undefined,
    skip: skip ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a Cypher expression to a string representation. */
function exprToString(expr: CypherExpression): string {
  switch (expr.type) {
    case 'variable':
      return expr.name;
    case 'property':
      return `${expr.object}.${expr.property}`;
    case 'literal':
      return expr.value === null ? 'NULL' : JSON.stringify(expr.value);
    case 'function':
      return `${expr.name}(${expr.args.map(exprToString).join(', ')})`;
    case 'binary': {
      const left = exprToString(expr.left);
      const right = exprToString(expr.right);
      const op = expr.operator;
      if (op === 'CONTAINS') return `${left} CONTAINS ${right}`;
      return `(${left} ${op} ${right})`;
    }
    case 'unary':
      return `${expr.operator} ${exprToString(expr.operand)}`;
    default:
      return '?';
  }
}

/** Infer the column type from a Cypher expression. */
function inferColumnType(expr: CypherExpression): 'node' | 'edge' | 'property' | 'computed' {
  switch (expr.type) {
    case 'variable':
      return expr.name === '*' ? 'computed' : 'node';
    case 'property':
      return 'property';
    case 'literal':
      return 'computed';
    case 'function':
      return 'computed';
    case 'binary':
      return 'computed';
    case 'unary':
      return 'computed';
    default:
      return 'computed';
  }
}

/** Resolve a Cypher expression (possibly from pattern properties) to its concrete value. */
function resolveConcreteValue(expr: unknown): unknown {
  if (typeof expr === 'object' && expr !== null && 'type' in expr) {
    const e = expr as { type: string; value?: unknown; name?: string; object?: string; property?: string };
    if (e.type === 'literal') return e.value;
    if (e.type === 'variable') return e.name;
    if (e.type === 'property') return `${e.object}.${e.property}`;
  }
  return expr;
}

/** Create a filter predicate string from an expression for execution. */
export function buildFilterPredicate(
  expr: CypherExpression,
  getNode: (varName: string) => GraphNode | null,
  nodeVars: Map<string, GraphNode>,
): boolean {
  switch (expr.type) {
    case 'binary': {
      const leftVal = evaluateBinaryOperand(expr.left, getNode, nodeVars);
      const rightVal = evaluateBinaryOperand(expr.right, getNode, nodeVars);
      const op = expr.operator;

      switch (op) {
        case '=':
        case '==':
          return leftVal === rightVal;
        case '!=':
        case '<>':
          return leftVal !== rightVal;
        case '>':
          return Number(leftVal) > Number(rightVal);
        case '<':
          return Number(leftVal) < Number(rightVal);
        case '>=':
          return Number(leftVal) >= Number(rightVal);
        case '<=':
          return Number(leftVal) <= Number(rightVal);
        case 'AND':
          return Boolean(leftVal) && Boolean(rightVal);
        case 'OR':
          return Boolean(leftVal) || Boolean(rightVal);
        case 'IS':
          return rightVal === null ? leftVal === null : leftVal === rightVal;
        case 'IS NOT':
          return rightVal === null ? leftVal !== null : leftVal !== rightVal;
        case 'IN':
          return Array.isArray(rightVal)
            ? rightVal.includes(leftVal)
            : false;
        case 'CONTAINS':
          return typeof leftVal === 'string' && typeof rightVal === 'string'
            ? leftVal.toLowerCase().includes(rightVal.toLowerCase())
            : false;
        case 'STARTS WITH':
        case 'STARTS':
          return typeof leftVal === 'string' && typeof rightVal === 'string'
            ? leftVal.toLowerCase().startsWith(rightVal.toLowerCase())
            : false;
        case 'ENDS WITH':
        case 'ENDS':
          return typeof leftVal === 'string' && typeof rightVal === 'string'
            ? leftVal.toLowerCase().endsWith(rightVal.toLowerCase())
            : false;
        case 'REGEX':
        case '=~':
          if (typeof leftVal === 'string' && typeof rightVal === 'string') {
            try {
              return new RegExp(rightVal).test(leftVal);
            } catch {
              return false;
            }
          }
          return false;
        default:
          return false;
      }
    }
    case 'unary': {
      if (expr.operator === 'NOT') {
        return !buildFilterPredicate(expr.operand, getNode, nodeVars);
      }
      return false;
    }
    case 'variable': {
      if (expr.name === '*') return true;
      const val = nodeVars.get(expr.name);
      return val !== undefined;
    }
    default:
      return true;
  }
}

function evaluateBinaryOperand(
  expr: CypherExpression,
  getNode: (varName: string) => GraphNode | null,
  nodeVars: Map<string, GraphNode>,
): unknown {
  switch (expr.type) {
    case 'binary':
      return buildFilterPredicate(expr, getNode, nodeVars);
    case 'property': {
      const node = nodeVars.get(expr.object);
      if (!node) return null;
      // Map property name to node fields
      const propMap: Record<string, unknown> = {
        name: node.name,
        qualifiedName: node.qualifiedName,
        filePath: node.filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        language: node.language,
        complexity: node.complexity,
        signature: node.signature,
        docstring: node.docstring,
        label: node.label,
        isExported: node.isExported,
        ...node.properties,
      };
      return propMap[expr.property] ?? null;
    }
    case 'variable': {
      if (expr.name === '*') return '*';
      return nodeVars.get(expr.name) ?? null;
    }
    case 'literal':
      return expr.value;
    case 'function': {
      if (expr.name === 'COUNT') return 1;
      return null;
    }
    default:
      return null;
  }
}
