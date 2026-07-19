// @ts-nocheck
// @code-analyzer/mcp — Cypher Lexer Tests

import { describe, it, expect } from 'vitest';
import { tokenize } from '../cypher/lexer.js';

describe('Cypher Lexer', () => {
  describe('tokenize', () => {
    it('should tokenize a simple MATCH query', () => {
      const tokens = tokenize('MATCH (n) RETURN n');
      expect(tokens.map((t) => ({ type: t.type, value: t.value }))).toEqual([
        { type: 'KEYWORD', value: 'MATCH' },
        { type: 'PUNCTUATION', value: '(' },
        { type: 'IDENTIFIER', value: 'n' },
        { type: 'PUNCTUATION', value: ')' },
        { type: 'KEYWORD', value: 'RETURN' },
        { type: 'IDENTIFIER', value: 'n' },
      ]);
    });

    it('should tokenize keywords correctly', () => {
      const tokens = tokenize('MATCH WHERE RETURN ORDER BY ASC DESC LIMIT SKIP');
      const values = tokens.map((t) => t.value);
      expect(values).toEqual(['MATCH', 'WHERE', 'RETURN', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'SKIP']);
      expect(tokens.every((t) => t.type === 'KEYWORD')).toBe(true);
    });

    it('should tokenize identifiers', () => {
      const tokens = tokenize('n myVar Thing');
      expect(tokens.map((t) => t.value)).toEqual(['n', 'myVar', 'Thing']);
      expect(tokens.every((t) => t.type === 'IDENTIFIER')).toBe(true);
    });

    it('should tokenize string literals', () => {
      const tokens = tokenize("'hello world' \"double\"");
      const strings = tokens.filter((t) => t.type === 'STRING');
      expect(strings.map((t) => t.value)).toEqual(['hello world', 'double']);
    });

    it('should tokenize numbers', () => {
      const tokens = tokenize('42 3.14 0 100');
      const numbers = tokens.filter((t) => t.type === 'NUMBER');
      expect(numbers.map((t) => t.value)).toEqual(['42', '3.14', '0', '100']);
    });

    it('should tokenize operators', () => {
      const tokens = tokenize('= <> < <= > >=');
      const ops = tokens.filter((t) => t.type === 'OPERATOR');
      expect(ops.map((t) => t.value)).toEqual(['=', '<>', '<', '<=', '>', '>=']);
    });

    it('should tokenize punctuation', () => {
      const tokens = tokenize('( ) [ ] { } , . : ;');
      const puncts = tokens.filter((t) => t.type === 'PUNCTUATION');
      expect(puncts.map((t) => t.value)).toEqual(['(', ')', '[', ']', '{', '}', ',', '.', ':', ';']);
    });

    it('should handle logical operators', () => {
      const tokens = tokenize('AND OR NOT');
      expect(tokens.map((t) => t.value)).toEqual(['AND', 'OR', 'NOT']);
    });

    it('should handle aggregation functions', () => {
      const tokens = tokenize('COUNT SUM AVG MIN MAX');
      expect(tokens.map((t) => t.value)).toEqual(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
    });

    it('should tokenize boolean and null literals as keywords', () => {
      const tokens = tokenize('TRUE FALSE NULL');
      expect(tokens.map((t) => t.value)).toEqual(['TRUE', 'FALSE', 'NULL']);
      expect(tokens.every((t) => t.type === 'KEYWORD')).toBe(true);
    });

    it('should handle dot access in identifiers', () => {
      const tokens = tokenize('n.name n.qualifiedName');
      expect(tokens.map((t) => ({ type: t.type, value: t.value }))).toEqual([
        { type: 'IDENTIFIER', value: 'n' },
        { type: 'PUNCTUATION', value: '.' },
        { type: 'IDENTIFIER', value: 'name' },
        { type: 'IDENTIFIER', value: 'n' },
        { type: 'PUNCTUATION', value: '.' },
        { type: 'IDENTIFIER', value: 'qualifiedName' },
      ]);
    });

    it('should skip single-line comments', () => {
      const tokens = tokenize('// This is a comment\nMATCH (n)');
      expect(tokens[0]!!.value).toBe('MATCH');
    });

    it('should skip block comments', () => {
      const tokens = tokenize('/* block comment */ MATCH (n)');
      expect(tokens[0]!!.value).toBe('MATCH');
    });

    it('should set correct positions', () => {
      const tokens = tokenize('MATCH (n)');
      expect(tokens[0]!!.position).toBe(0);
      expect(tokens[1].position).toBe(6);
    });

    it('should handle UNION keyword', () => {
      const tokens = tokenize('UNION ALL');
      expect(tokens.map((t) => t.value)).toEqual(['UNION', 'ALL']);
    });

    it('should handle DISTINCT keyword', () => {
      const tokens = tokenize('RETURN DISTINCT');
      expect(tokens.map((t) => t.value)).toEqual(['RETURN', 'DISTINCT']);
    });

    it('should tokenize a full Cypher query', () => {
      const query = 'MATCH (n:Function) WHERE n.complexity > 10 RETURN n.name, n.complexity ORDER BY n.complexity DESC LIMIT 5';
      const tokens = tokenize(query);
      expect(tokens.length).toBeGreaterThan(15);
      expect(tokens[0]!!.value).toBe('MATCH');
      expect(tokens[tokens.length - 1].value).toBe('5');
    });

    it('should handle empty queries', () => {
      const tokens = tokenize('');
      expect(tokens).toEqual([]);
    });

    it('should handle whitespace-only queries', () => {
      const tokens = tokenize('   \n\t  ');
      expect(tokens).toEqual([]);
    });

    it('should handle relationship patterns', () => {
      const tokens = tokenize('(a)-[:CALLS]->(b)');
      expect(tokens.some((t) => t.value === 'CALLS')).toBe(true);
    });

    it('should handle CONTAINS keyword', () => {
      const tokens = tokenize('WHERE n.name CONTAINS "test"');
      expect(tokens.find((t) => t.value === 'CONTAINS')?.type).toBe('KEYWORD');
    });

    it('should tokenize wildcard', () => {
      const tokens = tokenize('RETURN *');
      const star = tokens.find((t) => t.value === '*');
      expect(star).toBeDefined();
      expect(star?.type).toBe('KEYWORD');
    });
  });
});
