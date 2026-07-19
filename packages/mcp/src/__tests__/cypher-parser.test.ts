// @code-analyzer/mcp — Cypher Parser Tests

import { describe, it, expect } from 'vitest';
import { tokenize } from '../cypher/lexer.js';
import { parse } from '../cypher/parser.js';

describe('Cypher Parser', () => {
  describe('parse', () => {
    it('should parse a simple MATCH RETURN query', () => {
      const tokens = tokenize('MATCH (n) RETURN n');
      const ast = parse(tokens);

      expect(ast.type).toBe('query');
      expect(ast.match).toHaveLength(1);
      expect(ast.match[0]!.patterns[0]!.variable).toBe('n');
      expect(ast.returnClause.items[0]!.expression).toEqual({
        type: 'variable',
        name: 'n',
      });
    });

    it('should parse MATCH with labels', () => {
      const tokens = tokenize('MATCH (n:Function) RETURN n');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.labels).toContain('Function');
    });

    it('should parse MATCH with multiple labels (union)', () => {
      const tokens = tokenize('MATCH (n:Class|Interface) RETURN n');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.labels).toEqual(['Class', 'Interface']);
    });

    it('should parse WHERE clause', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name = "test" RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
      expect(ast.where!.condition.type).toBe('binary');
    });

    it('should parse ORDER BY clause', () => {
      const tokens = tokenize('MATCH (n) RETURN n ORDER BY n.name ASC');
      const ast = parse(tokens);
      expect(ast.orderBy).toBeDefined();
      expect(ast.orderBy![0]!.direction).toBe('asc');
    });

    it('should parse ORDER BY DESC', () => {
      const tokens = tokenize('MATCH (n) RETURN n ORDER BY n.name DESC');
      const ast = parse(tokens);
      expect(ast.orderBy![0]!.direction).toBe('desc');
    });

    it('should parse LIMIT clause', () => {
      const tokens = tokenize('MATCH (n) RETURN n LIMIT 10');
      const ast = parse(tokens);
      expect(ast.limit).toBe(10);
    });

    it('should parse SKIP clause', () => {
      const tokens = tokenize('MATCH (n) RETURN n SKIP 5 LIMIT 10');
      const ast = parse(tokens);
      expect(ast.skip).toBe(5);
      expect(ast.limit).toBe(10);
    });

    it('should parse RETURN with alias', () => {
      const tokens = tokenize('MATCH (n) RETURN n.name AS funcName');
      const ast = parse(tokens);
      expect(ast.returnClause.items[0]!.alias).toBe('funcName');
    });

    it('should parse RETURN DISTINCT', () => {
      const tokens = tokenize('MATCH (n) RETURN DISTINCT n.label');
      const ast = parse(tokens);
      expect(ast.returnClause.distinct).toBe(true);
    });

    it('should parse RETURN with wildcard', () => {
      const tokens = tokenize('MATCH (n) RETURN *');
      const ast = parse(tokens);
      expect(ast.returnClause.items[0]!.expression).toEqual({
        type: 'variable',
        name: '*',
      });
    });

    it('should parse WITH clause', () => {
      const tokens = tokenize('MATCH (n) WITH n.name AS name WHERE name CONTAINS "test" RETURN name');
      const ast = parse(tokens);
      expect(ast.withClause).toBeDefined();
      expect(ast.withClause!.items[0]!.alias).toBe('name');
    });

    it('should parse aggregation functions', () => {
      const tokens = tokenize('MATCH (n) RETURN COUNT(*)');
      const ast = parse(tokens);
      const expr = ast.returnClause.items[0]!.expression;
      expect(expr.type).toBe('function');
      expect((expr as { name: string }).name).toBe('COUNT');
    });

    it('should parse SUM aggregation', () => {
      const tokens = tokenize('MATCH (n) RETURN SUM(n.complexity)');
      const ast = parse(tokens);
      const expr = ast.returnClause.items[0]!.expression;
      expect(expr.type).toBe('function');
      expect((expr as { name: string }).name).toBe('SUM');
    });

    it('should parse comparison operators', () => {
      const tokens = tokenize('MATCH (n) WHERE n.complexity > 10 RETURN n');
      const ast = parse(tokens);
      const condition = ast.where!.condition;
      expect(condition.type).toBe('binary');
      expect((condition as { operator: string }).operator).toBe('>');
    });

    it('should parse AND conditions', () => {
      const tokens = tokenize('MATCH (n) WHERE n.isExported = true AND n.complexity > 5 RETURN n');
      const ast = parse(tokens);
      const condition = ast.where!.condition;
      expect(condition.type).toBe('binary');
      expect((condition as { operator: string }).operator).toBe('AND');
    });

    it('should parse OR conditions', () => {
      const tokens = tokenize('MATCH (n) WHERE n.label = "Class" OR n.label = "Function" RETURN n');
      const ast = parse(tokens);
      const condition = ast.where!.condition;
      expect(condition.type).toBe('binary');
      expect((condition as { operator: string }).operator).toBe('OR');
    });

    it('should parse IS NULL', () => {
      const tokens = tokenize('MATCH (n) WHERE n.filePath IS NULL RETURN n');
      const ast = parse(tokens);
      const condition = ast.where!.condition;
      expect(condition.type).toBe('binary');
      expect((condition as { operator: string }).operator).toBe('IS');
    });

    it('should parse IS NOT NULL', () => {
      const tokens = tokenize('MATCH (n) WHERE n.filePath IS NOT NULL RETURN n');
      const ast = parse(tokens);
      const condition = ast.where!.condition;
      expect(condition.type).toBe('binary');
      expect((condition as { operator: string }).operator).toBe('IS NOT');
    });

    it('should parse pattern with properties', () => {
      const tokens = tokenize('MATCH (n:Function {name: "main"}) RETURN n');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.properties).toHaveProperty('name');
    });

    it('should parse relationship patterns', () => {
      const tokens = tokenize('MATCH (a)-[:CALLS]->(b) RETURN a, b');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.relationships).toBeDefined();
      expect(ast.match[0]!.patterns[0]!.relationships![0]!.types).toContain('CALLS');
    });

    it('should parse bidirectional relationship', () => {
      const tokens = tokenize('MATCH (a)-[:CALLS]-(b) RETURN a');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.relationships![0]!.direction).toBe('both');
    });

    it('should parse reversed relationship', () => {
      const tokens = tokenize('MATCH (a)<-[:CALLS]-(b) RETURN a');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.relationships![0]!.direction).toBe('left');
    });

    it('should parse IN operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.label IN ["Class", "Function"] RETURN n');
      const ast = parse(tokens);
      expect(ast.where!.condition.type).toBe('binary');
      expect((ast.where!.condition as { operator: string }).operator).toBe('IN');
    });

    it('should parse CONTAINS operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name CONTAINS "test" RETURN n');
      const ast = parse(tokens);
      expect((ast.where!.condition as { operator: string }).operator).toBe('CONTAINS');
    });

    it('should parse UNION query', () => {
      const tokens = tokenize('MATCH (n:Class) RETURN n UNION MATCH (n:Function) RETURN n');
      const ast = parse(tokens);
      expect(ast.union).toBeDefined();
      expect(ast.union!.match[0]!.patterns[0]!.labels).toContain('Function');
    });

    it('should parse multiple RETURN items', () => {
      const tokens = tokenize('MATCH (n) RETURN n.name, n.complexity, n.filePath');
      const ast = parse(tokens);
      expect(ast.returnClause.items).toHaveLength(3);
    });

    it('should throw on incomplete MATCH', () => {
      const tokens = tokenize('MATCH (n');
      expect(() => parse(tokens)).toThrow();
    });

    it('should throw when missing RETURN', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name = "x"');
      expect(() => parse(tokens)).toThrow();
    });
  });
});
