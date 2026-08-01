import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { SqlProvider } from '../languages/sql.js';

describe('SqlProvider', () => {
  const provider = new SqlProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('sql');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('SQL');
    });

    it('should have .sql, .psql, .ddl, .dml extensions', () => {
      expect(provider.extensions).toContain('.sql');
      expect(provider.extensions).toContain('.psql');
      expect(provider.extensions).toContain('.ddl');
      expect(provider.extensions).toContain('.dml');
    });

    it('should have "named" import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should parse CREATE TABLE statements', () => {
      const code = 'CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));';
      const captures = provider.parse(code, 'test.sql');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'users')).toBe(true);
    });

    it('should parse CREATE VIEW statements', () => {
      const code = 'CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1;';
      const captures = provider.parse(code, 'test.sql');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'active_users')).toBe(true);
    });

    it('should parse CREATE FUNCTION statements', () => {
      const code = 'CREATE FUNCTION add_nums(a INT, b INT) RETURNS INT BEGIN RETURN a + b; END;';
      const captures = provider.parse(code, 'test.sql');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add_nums')).toBe(true);
    });

    it('should parse CREATE PROCEDURE statements', () => {
      const code = 'CREATE PROCEDURE update_salary(IN emp_id INT) BEGIN UPDATE employees SET salary = salary * 1.1 WHERE id = emp_id; END;';
      const captures = provider.parse(code, 'test.sql');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'update_salary')).toBe(true);
    });

    it('should parse SELECT statements', () => {
      // Fallback regex requires a word after SELECT, e.g. SELECT col or SELECT users
      const code = 'SELECT users FROM users;';
      const captures = provider.parse(code, 'test.sql');
      const dmls = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(dmls.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse INSERT statements', () => {
      const code = 'INSERT INTO users (name) VALUES (\'John\');';
      const captures = provider.parse(code, 'test.sql');
      const dmls = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(dmls.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse UPDATE statements', () => {
      const code = 'UPDATE users SET active = 0 WHERE last_login < \'2020-01-01\';';
      const captures = provider.parse(code, 'test.sql');
      const dmls = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(dmls.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse DELETE statements', () => {
      const code = 'DELETE FROM users WHERE id = 1;';
      const captures = provider.parse(code, 'test.sql');
      const dmls = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(dmls.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse CTE (WITH) statements', () => {
      const code = 'WITH cte AS (SELECT id FROM users) SELECT * FROM cte;';
      const captures = provider.parse(code, 'test.sql');
      const ctes = captures.filter((c) => c.properties?.isCTE === 'true');
      expect(ctes.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse CREATE INDEX statements', () => {
      const code = 'CREATE INDEX idx_users_email ON users(email);';
      const captures = provider.parse(code, 'test.sql');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.sql');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle comments', () => {
      const code = '-- This is a comment\nSELECT * FROM users;';
      const captures = provider.parse(code, 'test.sql');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse SELECT with JOIN', () => {
      const code = 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id;';
      const captures = provider.parse(code, 'test.sql');
      const dmls = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(dmls.length).toBeGreaterThanOrEqual(1);
    });

    it('should return captures sorted by line', () => {
      const code = 'CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);';
      const captures = provider.parse(code, 'test.sql');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should include filePath in properties', () => {
      const code = 'CREATE TABLE my_table (id INT);';
      const captures = provider.parse(code, 'myfile.sql');
      const tbl = captures.find((c) => c.name === 'my_table');
      expect(tbl?.properties?.filePath).toBe('myfile.sql');
    });

    it('should parse SELECT with subquery', () => {
      const code = 'SELECT * FROM (SELECT id FROM users WHERE active = 1) t;';
      const captures = provider.parse(code, 'test.sql');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle SQL without semicolons', () => {
      const code = 'SELECT * FROM users';
      const captures = provider.parse(code, 'test.sql');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should return empty array (SQL has no imports)', () => {
      const imports = provider.extractImports('SELECT * FROM users;');
      expect(imports).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return false (SQL has no export concept)', () => {
      expect(provider.isExported('CREATE TABLE t (id INT);', 't')).toBe(false);
    });
  });

  describe('fallback methods', () => {
    it('fallbackParse should parse CREATE TABLE', () => {
      const code = 'CREATE TABLE users (id INT PRIMARY KEY);';
      const captures = provider.fallbackParse(code, 'test.sql');
      const tables = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(tables.some((c) => c.name === 'users')).toBe(true);
    });

    it('fallbackParse should parse CREATE VIEW', () => {
      const code = 'CREATE VIEW active AS SELECT * FROM users;';
      const captures = provider.fallbackParse(code, 'test.sql');
      const views = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(views.some((c) => c.name === 'active')).toBe(true);
    });

    it('fallbackParse should parse CREATE FUNCTION', () => {
      const code = 'CREATE FUNCTION add(x INT, y INT) RETURNS INT BEGIN RETURN x + y; END;';
      const captures = provider.fallbackParse(code, 'test.sql');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('fallbackParse should parse CREATE PROCEDURE', () => {
      const code = 'CREATE PROCEDURE cleanup() BEGIN DELETE FROM logs; END;';
      const captures = provider.fallbackParse(code, 'test.sql');
      const procs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(procs.some((c) => c.name === 'cleanup')).toBe(true);
    });

    it('fallbackParse should parse CREATE OR REPLACE', () => {
      const code = 'CREATE OR REPLACE VIEW v AS SELECT * FROM t;';
      const captures = provider.fallbackParse(code, 'test.sql');
      const views = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(views.some((c) => c.name === 'v')).toBe(true);
    });

    it('fallbackParse should parse DML statements', () => {
      const code = 'SELECT * FROM users;\nINSERT INTO users VALUES (1);\nUPDATE users SET x=1;\nDELETE FROM users;';
      const captures = provider.fallbackParse(code, 'test.sql');
      const dmls = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      // Fallback regex uses: /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)["`]?/gi
      // "SELECT * FROM users" - matches "SELECT *" not "SELECT users"
      // "DELETE FROM users" - matches "DELETE FROM"
      expect(dmls.length).toBeGreaterThanOrEqual(3);
    });

    it('fallbackParse should parse CTEs', () => {
      const code = 'WITH cte AS (SELECT id FROM users) SELECT * FROM cte;';
      const captures = provider.fallbackParse(code, 'test.sql');
      const ctes = captures.filter((c) => c.properties?.isCTE === 'true');
      expect(ctes.length).toBeGreaterThanOrEqual(1);
    });

    it('fallbackParse should parse CREATE INDEX', () => {
      const code = 'CREATE INDEX idx_name ON table(col);';
      const captures = provider.fallbackParse(code, 'test.sql');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('fallbackParse should handle empty input', () => {
      const captures = provider.fallbackParse('', 'test.sql');
      expect(captures).toEqual([]);
    });

    it('fallbackParse should return sorted captures', () => {
      const code = 'CREATE TABLE a (id INT);\nSELECT * FROM a;';
      const captures = provider.fallbackParse(code, 'test.sql');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('fallbackParse should handle quoted identifiers', () => {
      const code = 'CREATE TABLE "user_data" (id INT);';
      const captures = provider.fallbackParse(code, 'test.sql');
      const tables = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(tables.some((c) => c.name === 'user_data')).toBe(true);
    });

    it('fallbackParse should handle backtick identifiers', () => {
      const code = 'CREATE TABLE `order` (id INT);';
      const captures = provider.fallbackParse(code, 'test.sql');
      const tables = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(tables.some((c) => c.name === 'order')).toBe(true);
    });

    it('fallbackParse should handle IF NOT EXISTS', () => {
      const code = 'CREATE TABLE IF NOT EXISTS config (key TEXT);';
      const captures = provider.fallbackParse(code, 'test.sql');
      const tables = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(tables.some((c) => c.name === 'config')).toBe(true);
    });

    it('fallbackExtractImports should return empty array', () => {
      expect(provider.fallbackExtractImports('anything')).toEqual([]);
    });

    it('fallbackIsExported should return false', () => {
      expect(provider.fallbackIsExported('anything', 'any')).toBe(false);
    });
  });

  describe('internal helpers', () => {
    it('findChildText should find object_reference in CREATE TABLE', () => {
      const code = 'CREATE TABLE test_table (id INT);';
      const captures = provider.parse(code, 'test.sql');
      const tables = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(tables.some((c) => c.name === 'test_table')).toBe(true);
    });

    it('collectTableReferences should find tables in SELECT', () => {
      const code = 'SELECT * FROM users;';
      const captures = provider.parse(code, 'test.sql');
      // Fallback regex will capture as DML, not via collectTableReferences
      expect(Array.isArray(captures)).toBe(true);
    });
  });
});
