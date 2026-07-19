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
    properties:  { name: "test" },
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
        return detail["predicate"] && String(detail["predicate"]).includes('label');
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

    it('should handle WITH clause as intermediate projection', () => {
      const tokens = tokenize('MATCH (n) WITH n.name AS name RETURN name');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      const withProject = queryPlan.steps.find(
        (s) => s.kind === 'project' && (s.details as { isWith: boolean }).isWith,
      );
      expect(withProject).toBeDefined();
    });

    it('should handle property patterns', () => {
      const tokens = tokenize('MATCH (n:Function {isExported: true}) RETURN n');
      const ast = parse(tokens);
      const queryPlan = plan(ast);

      // There should be a filter for the property
      const hasPropertyFilter = queryPlan.steps.some((s) => {
        if (s.kind !== 'filter') return false;
        const detail = s.details as Record<string, unknown>;
        return detail["value"] === true;
      });
      expect(hasPropertyFilter).toBe(true);
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
  });
});
