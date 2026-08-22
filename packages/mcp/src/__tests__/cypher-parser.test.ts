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
      const tokens = tokenize(
        'MATCH (n) WITH n.name AS name WHERE name CONTAINS "test" RETURN name',
      );
      const ast = parse(tokens);
      expect(ast.withClause).toBeDefined();
      expect(ast.withClause!.items[0]!.alias).toBe('name');
    });

    it('should parse aggregation function with no arguments', () => {
      const tokens = tokenize('MATCH (n) RETURN COUNT()');
      const ast = parse(tokens);
      const expr = ast.returnClause.items[0]!.expression;
      expect(expr.type).toBe('function');
      expect((expr as { name: string; args: unknown[] }).args).toHaveLength(0);
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

    it('should parse pattern with multiple properties', () => {
      const tokens = tokenize('MATCH (n:Function {name: "main", complexity: 5}) RETURN n');
      const ast = parse(tokens);
      const props = ast.match[0]!.patterns[0]!.properties;
      expect(props).toHaveProperty('name');
      expect(props).toHaveProperty('complexity');
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

    it('should parse UNION ALL query', () => {
      const tokens = tokenize('MATCH (n:Class) RETURN n UNION ALL MATCH (n:Function) RETURN n');
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

    it('should parse WITH clause followed by WHERE but no RETURN keyword (isKeyword false branch)', () => {
      // After parsing MATCH and WITH, isKeyword('WHERE') returns true,
      // but isKeyword('ORDER') returns false (current token is not ORDER),
      // exercising the false branch of the second && in isKeyword.
      const tokens = tokenize(
        'MATCH (n) WITH n.name AS name WHERE name CONTAINS "test" RETURN name',
      );
      const ast = parse(tokens);
      expect(ast.withClause?.where).toBeDefined();
    });

    it('should throw on unexpected dot at start of expression', () => {
      // A bare "." as the first token of an expression triggers the error at line 687-689
      const tokens = tokenize('MATCH (n) WHERE .name = "test" RETURN n');
      expect(() => parse(tokens)).toThrow('Unexpected "."');
    });

    it('should throw when parseNumber receives non-NUMBER token', () => {
      // LIMIT followed by a non-number token triggers the error at line 700
      const tokens = tokenize('MATCH (n) RETURN n LIMIT abc');
      expect(() => parse(tokens)).toThrow('Expected NUMBER');
    });

    it('should parse parenthesized expression in WHERE', () => {
      const tokens = tokenize('MATCH (n) WHERE (n.name = "test") RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should parse array literal with number items', () => {
      const tokens = tokenize('MATCH (n) WHERE n.id IN [1, 2, 3] RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
      const right = (ast.where!.condition as { right: { value: unknown } }).right;
      expect((right as { value: unknown[] }).value).toEqual([1, 2, 3]);
    });

    it('should parse array literal with boolean items', () => {
      const tokens = tokenize('MATCH (n) WHERE n.flag IN [TRUE, FALSE] RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should parse array literal with fallback item', () => {
      const tokens = tokenize('MATCH (n) WHERE n.type IN [n, m] RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should throw on unexpected token in expression', () => {
      // A token that is not a number, string, bool, null, function, paren, identifier,
      // wildcard, array, or dot — triggers the final throw at line 691
      const tokens = tokenize('MATCH (n) WHERE n = ) RETURN n');
      expect(() => parse(tokens)).toThrow('Unexpected token');
    });

    it('should parse FALSE literal in expression', () => {
      const tokens = tokenize('MATCH (n) WHERE n.isExported = FALSE RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should parse NULL literal in expression', () => {
      // NULL as a standalone expression value (not via IS NULL operator)
      const tokens = tokenize('MATCH (n) WHERE n.parent = NULL RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should parse NOT unary expression', () => {
      const tokens = tokenize('MATCH (n) WHERE NOT n.isExported RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
      expect(ast.where!.condition.type).toBe('unary');
    });

    it('should parse STARTS WITH operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name STARTS WITH "test" RETURN n');
      const ast = parse(tokens);
      expect((ast.where!.condition as { operator: string }).operator).toBe('STARTS WITH');
    });

    it('should parse ENDS WITH operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.name ENDS WITH "test" RETURN n');
      const ast = parse(tokens);
      expect((ast.where!.condition as { operator: string }).operator).toBe('ENDS WITH');
    });

    it('should parse addition operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.complexity + 1 > 5 RETURN n');
      const ast = parse(tokens);
      const condition = ast.where!.condition;
      expect(condition.type).toBe('binary');
      expect((condition as { operator: string }).operator).toBe('>');
    });

    it('should parse subtraction operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.complexity - 1 > 5 RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should parse division operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.complexity / 2 > 5 RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should parse modulo operator', () => {
      const tokens = tokenize('MATCH (n) WHERE n.complexity % 2 = 0 RETURN n');
      const ast = parse(tokens);
      expect(ast.where).toBeDefined();
    });

    it('should parse WITH clause with multiple items', () => {
      const tokens = tokenize(
        'MATCH (n) WITH n.name AS name, n.complexity AS complexity RETURN name, complexity',
      );
      const ast = parse(tokens);
      expect(ast.withClause).toBeDefined();
      expect(ast.withClause!.items).toHaveLength(2);
    });

    it('should parse ORDER BY with multiple items', () => {
      const tokens = tokenize('MATCH (n) RETURN n ORDER BY n.name ASC, n.complexity DESC');
      const ast = parse(tokens);
      expect(ast.orderBy).toHaveLength(2);
    });

    it('should parse relationship with properties', () => {
      const tokens = tokenize('MATCH (a)-[:CALLS {weight: 1}]->(b) RETURN a');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.relationships).toBeDefined();
    });

    it('should parse relationship with multiple types (union)', () => {
      const tokens = tokenize('MATCH (a)-[:CALLS|IMPLEMENTS]->(b) RETURN a');
      const ast = parse(tokens);
      const rel = ast.match[0]!.patterns[0]!.relationships![0]!;
      expect(rel.types).toContain('CALLS');
      expect(rel.types).toContain('IMPLEMENTS');
    });

    it('should parse simple reversed relationship without brackets', () => {
      const tokens = tokenize('MATCH (a)<-(b) RETURN a, b');
      const ast = parse(tokens);
      const rel = ast.match[0]!.patterns[0]!.relationships![0]!;
      expect(rel.direction).toBe('left');
      expect(rel.types).toEqual([]);
    });

    it('should parse MATCH with multiple comma-separated patterns', () => {
      const tokens = tokenize('MATCH (a), (b) RETURN a, b');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns).toHaveLength(2);
    });

    it('should parse node with multiple labels separated by colon', () => {
      const tokens = tokenize('MATCH (n:Class:Serializable) RETURN n');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.labels).toContain('Class');
      expect(ast.match[0]!.patterns[0]!.labels).toContain('Serializable');
    });

    it('should parse anonymous node with label', () => {
      const tokens = tokenize('MATCH (:Function) RETURN *');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.variable).toBe('');
      expect(ast.match[0]!.patterns[0]!.labels).toContain('Function');
    });

    it('should parse anonymous node with multiple labels', () => {
      const tokens = tokenize('MATCH (:Class|Interface) RETURN *');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.labels).toEqual(['Class', 'Interface']);
    });

    it('should parse anonymous node with multiple colon-separated labels', () => {
      const tokens = tokenize('MATCH (:Class:Serializable) RETURN *');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.labels).toContain('Class');
      expect(ast.match[0]!.patterns[0]!.labels).toContain('Serializable');
    });

    it('should parse anonymous node with properties', () => {
      const tokens = tokenize('MATCH (:Function {name: "main"}) RETURN *');
      const ast = parse(tokens);
      expect(ast.match[0]!.patterns[0]!.properties).toHaveProperty('name');
    });

    it('should throw when expected token type does not match', () => {
      // Missing ) after node variable — expect('PUNCTUATION', ')') gets KEYWORD 'RETURN'
      const tokens = tokenize('MATCH (n RETURN n');
      expect(() => parse(tokens)).toThrow('Expected PUNCTUATION but got KEYWORD');
    });

    it('should throw when expected token value does not match', () => {
      // Use OPTIONAL followed by a keyword that is not MATCH — the parser
      // calls expect('KEYWORD', 'MATCH') and the token is OPTIONAL's next token
      // which would need to be MATCH.
      // Instead, a simpler case: MATCH requires ( after it, but if we put a keyword...
      // Actually, the simplest way is to test parseMatch directly.
      // MATCH must be followed by (. If we put WHERE instead, it won't reach expect.
      // Let's use: OPTIONAL MATCH — if we just have OPTIONAL without MATCH,
      // parseMatch consumes OPTIONAL then expects MATCH. But OPTIONAL alone won't parse.
      // The expect with value check is reached when parseMatch sees OPTIONAL, advances,
      // then calls expect('KEYWORD', 'MATCH'). If the token after OPTIONAL is not MATCH...
      // But OPTIONAL is a keyword, so 'OPTIONAL RETURN' would: advance past OPTIONAL,
      // then expect MATCH but get RETURN.
      const tokens = tokenize('OPTIONAL RETURN (n) RETURN n');
      expect(() => parse(tokens)).toThrow('Expected "MATCH"');
    });

    it('should parse IS operator with non-NULL value', () => {
      const tokens = tokenize('MATCH (n) WHERE n.active IS TRUE RETURN n');
      const ast = parse(tokens);
      const condition = ast.where!.condition;
      expect(condition.type).toBe('binary');
      expect((condition as { operator: string }).operator).toBe('IS');
    });
  });
});
