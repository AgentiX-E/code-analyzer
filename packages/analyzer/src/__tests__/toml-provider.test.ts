import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { TomlProvider } from '../languages/toml.js';

describe('TomlProvider', () => {
  const provider = new TomlProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('toml');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('TOML');
    });

    it('should have .toml extension', () => {
      expect(provider.extensions).toContain('.toml');
    });

    it('should have "none" import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse', () => {
    it('should parse simple key-value pairs', () => {
      const code = 'name = "MyApp"\nversion = "1.0.0"';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
      expect(vars.some((c) => c.name === 'version')).toBe(true);
    });

    it('should parse integer and float values', () => {
      const code = 'port = 8080\ntimeout = 30.5';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'port')).toBe(true);
      expect(vars.some((c) => c.name === 'timeout')).toBe(true);
    });

    it('should parse boolean values', () => {
      const code = 'enabled = true\ndisabled = false';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'enabled')).toBe(true);
      expect(vars.some((c) => c.name === 'disabled')).toBe(true);
    });

    it('should parse table sections', () => {
      const code = '[server]\nhost = "localhost"\nport = 8080';
      const captures = provider.parse(code, 'test.toml');
      const tables = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.isTable === 'true',
      );
      expect(tables.some((c) => c.name === 'server')).toBe(true);
    });

    it('should parse array of tables', () => {
      const code = '[[products]]\nname = "Hammer"\n[[products]]\nname = "Nail"';
      const captures = provider.parse(code, 'test.toml');
      // Array tables are emitted as CLASS_DEF with isArrayTable='true'.
      const arrTables = captures.filter((c) => c.properties?.isArrayTable === 'true');
      expect(arrTables.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse dotted keys', () => {
      const code = 'database.host = "localhost"\ndatabase.port = 5432';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name?.includes('database'))).toBe(true);
    });

    it('should parse inline tables', () => {
      const code = 'point = { x = 1, y = 2 }';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'point')).toBe(true);
    });

    it('should parse array values', () => {
      const code = 'colors = ["red", "green", "blue"]';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'colors')).toBe(true);
    });

    it('should handle comments', () => {
      const code = '# This is a comment\nname = "test"';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.toml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle files with only comments', () => {
      const code = '# Only a comment\n# Another comment';
      const captures = provider.parse(code, 'test.toml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle nested tables', () => {
      const code = '[server]\nhost = "localhost"\n[server.database]\nname = "mydb"';
      const captures = provider.parse(code, 'test.toml');
      const tables = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.isTable === 'true',
      );
      expect(tables.length).toBeGreaterThanOrEqual(2);
    });

    it('should return captures sorted by line', () => {
      const code = '[a]\nx = 1\n[b]\ny = 2';
      const captures = provider.parse(code, 'test.toml');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should parse date/time values', () => {
      const code = 'birthday = 1979-05-27';
      const captures = provider.parse(code, 'test.toml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should include filePath in properties', () => {
      const code = 'key = "value"';
      const captures = provider.parse(code, 'myfile.toml');
      const v = captures.find((c) => c.name === 'key');
      expect(v?.properties?.filePath).toBe('myfile.toml');
    });
  });

  describe('extractImports', () => {
    it('should return empty array (TOML has no imports)', () => {
      const imports = provider.extractImports('key = "value"');
      expect(imports).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return false (TOML has no export concept)', () => {
      expect(provider.isExported('key = "value"', 'key')).toBe(false);
    });
  });

  describe('regex parsing (via parse)', () => {
    it('parse should parse key-value pairs', () => {
      const code = 'name = "test"\nversion = "1.0"';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
    });

    it('parse should parse table sections', () => {
      const code = '[server]\nhost = "localhost"';
      const captures = provider.parse(code, 'test.toml');
      const tables = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.isTable === 'true',
      );
      expect(tables.some((c) => c.name === 'server')).toBe(true);
    });

    it('parse should parse array of tables', () => {
      const code = '[[items]]\nname = "item1"';
      const captures = provider.parse(code, 'test.toml');
      const arrTables = captures.filter((c) => c.properties?.isArrayTable === 'true');
      expect(arrTables.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should skip comments', () => {
      const code = '# comment\nkey = "value"';
      const captures = provider.parse(code, 'test.toml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'key')).toBe(true);
    });

    it('parse should handle empty input', () => {
      const captures = provider.parse('', 'test.toml');
      expect(captures).toEqual([]);
    });

    it('extractImports should return empty array', () => {
      expect(provider.extractImports('anything')).toEqual([]);
    });

    it('isExported should return false', () => {
      expect(provider.isExported('anything', 'any')).toBe(false);
    });
  });
});
