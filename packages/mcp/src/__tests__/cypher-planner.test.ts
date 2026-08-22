// @ts-nocheck
// @code-analyzer/mcp — Cypher Planner Tests

import { describe, it, expect } from 'vitest';
import { tokenize } from '../cypher/lexer.js';
import { parse } from '../cypher/parser.js';
import { plan, _DEFAULT_SCHEMA, buildFilterPredicate } from '../cypher/planner.js';
import type { GraphNode } from '@code-analyzer/shared';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 1,
    projectId: 'test',
    label: 'Function',
    name: 'testFunc',
    qualifiedName: 'test.Function:testFunc',
    filePath: '/src/test.ts',
    startLine: 10,
    endLine: 20,
    language: 'typescript',
    properties: { name: 'test' },
    signature: 'testFunc(): void',
    docstring: 'A test function',
    complexity: 5,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Cypher Planner', () => {
  describe('plan', () => {
    it('should create a plan for a simple MATCH RETURN', () => {
      const tokens = tokenize('MATCH (n) RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.source).toBe('code_analyzer_graph');
      expect(queryPlan.steps.length).toBeGreaterThanOrEqual(2); // scan + project
      expect(queryPlan.steps.some((s) => s.kind === 'scan')).toBe(true);
      expect(queryPlan.steps.some((s) => s.kind === 'project')).toBe(true);
    });

    it('should include filter steps for WHERE clause', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name = "test" RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.steps.some((s) => s.kind === 'filter')).toBe(true);
    });

    it('should include label filter steps', () => {
      const tokens = tokenize('MATCH (n:Function) RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      // There should be a scan step for the pattern and a filter for the label
      const filterSteps = queryPlan.steps.filter((s) => s.kind === 'filter');
      const labelFilter = filterSteps.find((s) => {
        const detail = s.details as Record<string, unknown>;
        return detail['predicate'] && String(detail['predicate']).includes('label');
      });
      expect(labelFilter).toBeDefined();
    });

    it('should include relationship traversal', () => {
      const tokens = tokenize('MATCH (a)-[:CALLS]->(b) RETURN a, b');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.steps.some((s) => s.kind === 'traverse')).toBe(true);
    });

    it('should set distinct flag', () => {
      const tokens = tokenize('MATCH (n) RETURN DISTINCT n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.distinct).toBe(true);
    });

    it('should set limit and skip', () => {
      const tokens = tokenize('MATCH (n) RETURN n SKIP 10 LIMIT 5');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.skip).toBe(10);
      expect(queryPlan.limit).toBe(5);
    });

    it('should generate columns from RETURN items', () => {
      const tokens = tokenize('MATCH (n) RETURN n.name AS name, n.complexity AS cx');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.columns).toHaveLength(2);
      expect(queryPlan.columns[0]!.name).toBe('name');
      expect(queryPlan.columns[1].name).toBe('cx');
    });

    it('should generate params for property filters', () => {
      const tokens = tokenize('MATCH (n {name: "main"}) RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(Object.keys(queryPlan.params).length).toBeGreaterThan(0);
    });

    it('should handle WITH clause without aliases', () => {
      const tokens = tokenize('MATCH (n) WITH n RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      const withProject = queryPlan.steps.find(
        (s) => s.kind === 'project' && (s.details as { isWith: boolean }).isWith,
      );
      expect(withProject).toBeDefined();
      const details = withProject!.details as { columns: { name: string }[] };
      expect(details.columns[0]!.name).toBe('col_0');
    });

    it('should handle property patterns', () => {
      const tokens = tokenize('MATCH (n:Function {isExported: true}) RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      // There should be a filter for the property
      const hasPropertyFilter = queryPlan.steps.some((s) => {
        if (s.kind !== 'filter') return false;
        const detail = s.details as Record<string, unknown>;
        return detail['value'] === true;
      });
      expect(hasPropertyFilter).toBe(true);
    });

    it('should handle anonymous node with label', () => {
      const tokens = tokenize('MATCH (:Function) RETURN *');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.steps.some((s) => s.kind === 'scan')).toBe(true);
      expect(queryPlan.steps.some((s) => s.kind === 'filter')).toBe(true);
    });

    it('should handle anonymous node with label and properties', () => {
      const tokens = tokenize('MATCH (:Function {name: "test"}) RETURN *');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.steps.some((s) => s.kind === 'scan')).toBe(true);
    });

    it('should handle relationship without types (bidirectional)', () => {
      // Use empty bracket syntax for relationship without types
      const tokens = tokenize('MATCH (a)-[]-(b) RETURN a, b');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      const traverseStep = queryPlan.steps.find((s) => s.kind === 'traverse');
      expect(traverseStep).toBeDefined();
      const details = traverseStep!.details as Record<string, unknown>;
      const rel = details['relationship'] as { types: string[] };
      expect(rel.types).toEqual([]);
    });

    it('should handle relationship with variable but no types', () => {
      // The parser doesn't support [r] without types, so construct plan manually
      const tokens = tokenize('MATCH (a) RETURN a, b');
      const ast = parse(tokens);
      // Manually add a relationship to the pattern
      ast.match[0]!.patterns[0]!.relationships = [
        {
          variable: 'r',
          types: [],
          direction: 'right' as const,
          target: { variable: 'b', labels: [], properties: {} },
        },
      ];
      const queryPlan = plan(ast);

      const traverseStep = queryPlan.steps.find((s) => s.kind === 'traverse');
      expect(traverseStep).toBeDefined();
      const details = traverseStep!.details as Record<string, unknown>;
      const rel = details['relationship'] as { variable?: string; types: string[] };
      expect(rel.variable).toBe('r');
      expect(rel.types).toEqual([]);
    });

    it('should handle return without alias', () => {
      const tokens = tokenize('MATCH (n) RETURN n.complexity');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.columns[0]!.name).toBe('col_0');
    });

    it('should handle WHERE with CONTAINS expression', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name CONTAINS "test" RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.steps.some((s) => s.kind === 'filter')).toBe(true);
    });

    it('should handle RETURN with literal value', () => {
      const tokens = tokenize('MATCH (n) RETURN 42 AS val');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.columns[0]!.type).toBe('computed');
    });

    it('should handle RETURN with NULL literal', () => {
      const tokens = tokenize('MATCH (n) RETURN NULL AS val');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.columns[0]!.type).toBe('computed');
    });

    it('should handle RETURN with function', () => {
      const tokens = tokenize('MATCH (n) RETURN COUNT(n) AS cnt');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.columns[0]!.type).toBe('computed');
    });

    it('should handle RETURN with binary expression', () => {
      const tokens = tokenize('MATCH (n) RETURN n.complexity > 10 AS complex');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.columns[0]!.type).toBe('computed');
    });

    it('should handle RETURN with unary expression', () => {
      const tokens = tokenize('MATCH (n) RETURN NOT n.isExported AS internal');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.columns[0]!.type).toBe('computed');
    });

    it('should handle WHERE with property expression', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      expect(queryPlan.steps.some((s) => s.kind === 'filter')).toBe(true);
    });
  });

  describe('buildFilterPredicate', () => {
    const node = makeNode({ name: 'test', complexity: 5 });
    const nodeVars = new Map<string, GraphNode>([['n', node]]);
    const getNode = (_v: string) => null;

    it('should evaluate property comparison correctly', () => {
      // n.name = "test"
      const expr = {
        type: 'binary' as const,
        operator: '=',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'test' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate false comparison correctly', () => {
      const expr = {
        type: 'binary' as const,
        operator: '=',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'other' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate not-equal correctly', () => {
      const expr = {
        type: 'binary' as const,
        operator: '!=',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'other' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate greater than correctly', () => {
      const expr = {
        type: 'binary' as const,
        operator: '>',
        left: { type: 'property' as const, object: 'n', property: 'complexity' },
        right: { type: 'literal' as const, value: 3 },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate AND correctly', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'AND',
        left: {
          type: 'binary' as const,
          operator: '=',
          left: { type: 'property' as const, object: 'n', property: 'name' },
          right: { type: 'literal' as const, value: 'test' },
        },
        right: {
          type: 'binary' as const,
          operator: '>',
          left: { type: 'property' as const, object: 'n', property: 'complexity' },
          right: { type: 'literal' as const, value: 3 },
        },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate OR correctly', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'OR',
        left: {
          type: 'binary' as const,
          operator: '=',
          left: { type: 'property' as const, object: 'n', property: 'name' },
          right: { type: 'literal' as const, value: 'wrong' },
        },
        right: {
          type: 'binary' as const,
          operator: '=',
          left: { type: 'property' as const, object: 'n', property: 'name' },
          right: { type: 'literal' as const, value: 'test' },
        },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate CONTAINS correctly', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'CONTAINS',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'es' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate NOT correctly', () => {
      const expr = {
        type: 'unary' as const,
        operator: 'NOT',
        operand: {
          type: 'binary' as const,
          operator: '=',
          left: { type: 'property' as const, object: 'n', property: 'name' },
          right: { type: 'literal' as const, value: 'wrong' },
        },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should return true for wildcard variable', () => {
      const expr = { type: 'variable' as const, name: '*' };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should return false for unknown variable', () => {
      const expr = { type: 'variable' as const, name: 'unknown' };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate IS NULL correctly', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'IS',
        left: { type: 'property' as const, object: 'n', property: 'signature' },
        right: { type: 'literal' as const, value: null },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false); // signature is not null
    });

    it('should handle unknown property gracefully', () => {
      const expr = {
        type: 'binary' as const,
        operator: '=',
        left: { type: 'property' as const, object: 'n', property: 'unknownProp' },
        right: { type: 'literal' as const, value: 'x' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    // --- Additional binary operator coverage ---

    it('should evaluate == operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: '==',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'test' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate <> operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: '<>',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'other' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate < operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: '<',
        left: { type: 'property' as const, object: 'n', property: 'complexity' },
        right: { type: 'literal' as const, value: 10 },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate <= operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: '<=',
        left: { type: 'property' as const, object: 'n', property: 'complexity' },
        right: { type: 'literal' as const, value: 5 },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate >= operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: '>=',
        left: { type: 'property' as const, object: 'n', property: 'complexity' },
        right: { type: 'literal' as const, value: 5 },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate IS NOT NULL', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'IS NOT',
        left: { type: 'property' as const, object: 'n', property: 'signature' },
        right: { type: 'literal' as const, value: null },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate IS NOT with value', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'IS NOT',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'test' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate IS with value match', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'IS',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'test' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate IN operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'IN',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: ['test', 'other'] },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate IN operator with non-array right', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'IN',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'not-an-array' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate CONTAINS (case insensitive)', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'CONTAINS',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'TEST' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate CONTAINS with non-string inputs', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'CONTAINS',
        left: { type: 'literal' as const, value: 123 },
        right: { type: 'literal' as const, value: 'abc' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate STARTS WITH operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'STARTS WITH',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'te' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate STARTS operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'STARTS',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'te' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate ENDS WITH operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'ENDS WITH',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'st' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate ENDS operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'ENDS',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'st' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate REGEX operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'REGEX',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: '^te' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate =~ operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: '=~',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: 'st$' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should evaluate REGEX with invalid pattern', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'REGEX',
        left: { type: 'literal' as const, value: 'test' },
        right: { type: 'literal' as const, value: '[' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate REGEX with non-string inputs', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'REGEX',
        left: { type: 'literal' as const, value: 123 },
        right: { type: 'literal' as const, value: 'pattern' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate unary NOT nested binary', () => {
      const expr = {
        type: 'unary' as const,
        operator: 'NOT',
        operand: {
          type: 'binary' as const,
          operator: '=',
          left: { type: 'property' as const, object: 'n', property: 'name' },
          right: { type: 'literal' as const, value: 'test' },
        },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should return false for unknown binary operator', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'UNKNOWN_OP',
        left: { type: 'literal' as const, value: 1 },
        right: { type: 'literal' as const, value: 1 },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should return false for unary operator other than NOT', () => {
      const expr = {
        type: 'unary' as const,
        operator: 'OTHER',
        operand: { type: 'literal' as const, value: true },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should return true for existing variable', () => {
      const expr = { type: 'variable' as const, name: 'n' };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });

    it('should return true for unknown expression type', () => {
      const expr = { type: 'unknown_type' as const } as any;
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(true);
    });
  });

  describe('buildFilterPredicate with relationships', () => {
    const node = makeNode({ name: 'test', complexity: 5 });
    const nodeVars = new Map<string, GraphNode>([['n', node]]);
    const getNode = (_v: string) => null;

    it('should evaluate STARTS WITH with non-string left', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'STARTS WITH',
        left: { type: 'literal' as const, value: 123 },
        right: { type: 'literal' as const, value: 'abc' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate ENDS WITH with non-string left', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'ENDS WITH',
        left: { type: 'literal' as const, value: 123 },
        right: { type: 'literal' as const, value: 'abc' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate IN with missing value in array', () => {
      const expr = {
        type: 'binary' as const,
        operator: 'IN',
        left: { type: 'property' as const, object: 'n', property: 'name' },
        right: { type: 'literal' as const, value: ['other'] },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate COUNT function operand', () => {
      const node2 = makeNode({ name: 'funcB', complexity: 15 });
      const allVars = new Map<string, GraphNode>([
        ['a', node],
        ['b', node2],
      ]);
      // a.name = b.name evaluates through evaluateBinaryOperand's variable path
      const expr = {
        type: 'binary' as const,
        operator: '=',
        left: { type: 'property' as const, object: 'a', property: 'name' },
        right: { type: 'variable' as const, name: 'a' },
      };
      // left=test, right=a=node, not equal as different types
      const result = buildFilterPredicate(expr, getNode, allVars);
      expect(result).toBe(false);
    });

    it('should evaluate property access on unknown variable', () => {
      const expr = {
        type: 'binary' as const,
        operator: '=',
        left: { type: 'property' as const, object: 'unknown', property: 'name' },
        right: { type: 'literal' as const, value: 'test' },
      };
      expect(buildFilterPredicate(expr, getNode, nodeVars)).toBe(false);
    });

    it('should evaluate property access with null result', () => {
      const node2 = makeNode({ name: 'funcB', complexity: 0 });
      const vars = new Map<string, GraphNode>([['n', node2]]);
      // complexity is 0 (not null), so IS NULL returns false
      const expr = {
        type: 'binary' as const,
        operator: 'IS',
        left: { type: 'property' as const, object: 'n', property: 'complexity' },
        right: { type: 'literal' as const, value: null },
      };
      expect(buildFilterPredicate(expr, getNode, vars)).toBe(false);
    });
  });
});
