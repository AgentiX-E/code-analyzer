import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { JsonProvider } from '../languages/json.js';

describe('JsonProvider', () => {
  const provider = new JsonProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('json');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('JSON');
    });

    it('should have .json, .jsonc, .json5 extensions', () => {
      expect(provider.extensions).toContain('.json');
      expect(provider.extensions).toContain('.jsonc');
      expect(provider.extensions).toContain('.json5');
    });

    it('should have "none" import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse', () => {
    it('should parse a simple object with string values', () => {
      const code = JSON.stringify({ name: 'John', age: 30 });
      const captures = provider.parse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
      expect(vars.some((c) => c.name === 'age')).toBe(true);
    });

    it('should parse an object with boolean and null values', () => {
      const code = JSON.stringify({ active: true, deleted: false, meta: null });
      const captures = provider.parse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'active')).toBe(true);
      expect(vars.some((c) => c.name === 'deleted')).toBe(true);
      expect(vars.some((c) => c.name === 'meta')).toBe(true);
    });

    it('should parse an object with array value', () => {
      const code = JSON.stringify({ items: [1, 2, 3] });
      const captures = provider.parse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      const items = vars.find((c) => c.name === 'items');
      expect(items).toBeDefined();
      expect(items?.properties?.valueType).toBe('array');
    });

    it('should parse nested objects', () => {
      const code = JSON.stringify({ user: { name: 'Alice', address: { city: 'NYC' } } });
      const captures = provider.parse(code, 'test.json');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract object definitions', () => {
      const code = JSON.stringify({ config: { host: 'localhost', port: 8080 } });
      const captures = provider.parse(code, 'test.json');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.length).toBeGreaterThanOrEqual(1);
      // Each object capture should have keyCount property
      expect(classDefs[0]?.properties?.keyCount).toBeDefined();
    });

    it('should handle empty object', () => {
      const code = '{}';
      const captures = provider.parse(code, 'test.json');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle empty array', () => {
      const code = '[]';
      const captures = provider.parse(code, 'test.json');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle arrays of primitives', () => {
      const code = JSON.stringify([1, 'two', true, null]);
      const captures = provider.parse(code, 'test.json');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle invalid JSON gracefully', () => {
      const captures = provider.parse('{invalid json}', 'test.json');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = '{\n  "a": 1,\n  "b": 2\n}';
      const captures = provider.parse(code, 'test.json');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should handle empty input', () => {
      const captures = provider.parse('', 'empty.json');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse a large nested object', () => {
      const code = JSON.stringify({
        app: {
          name: 'MyApp',
          version: '1.0.0',
          settings: {
            debug: true,
            timeout: 5000,
          },
        },
      });
      const captures = provider.parse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.length).toBeGreaterThanOrEqual(3);
    });

    it('should parse JSON with numeric values of different types', () => {
      const code = JSON.stringify({ int: 42, float: 3.14, neg: -7, sci: 1e10 });
      const captures = provider.parse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'int')).toBe(true);
      expect(vars.some((c) => c.name === 'float')).toBe(true);
    });

    it('should extract value types in properties', () => {
      const code = JSON.stringify({ name: 'test', count: 42, flag: true });
      const captures = provider.parse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      const name = vars.find((c) => c.name === 'name');
      const count = vars.find((c) => c.name === 'count');
      const flag = vars.find((c) => c.name === 'flag');
      expect(name?.properties?.valueType).toBe('string');
      expect(count?.properties?.valueType).toBe('number');
      expect(flag?.properties?.valueType).toBe('boolean');
    });

    it('should include filePath in properties', () => {
      const code = JSON.stringify({ key: 'value' });
      const captures = provider.parse(code, 'myfile.json');
      const v = captures.find((c) => c.name === 'key');
      expect(v?.properties?.filePath).toBe('myfile.json');
    });
  });

  describe('extractImports', () => {
    it('should return empty array (JSON has no imports)', () => {
      const imports = provider.extractImports('{"key": "value"}');
      expect(imports).toEqual([]);
    });

    it('should return empty array for any JSON content', () => {
      const imports = provider.extractImports('[]');
      expect(imports).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return false (JSON has no export concept)', () => {
      expect(provider.isExported('{"key": "value"}', 'key')).toBe(false);
    });
  });

  describe('fallback methods', () => {
    it('fallbackParse should extract objects from valid JSON', () => {
      const code = JSON.stringify({ hello: 'world' });
      const captures = provider.fallbackParse(code, 'test.json');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.length).toBeGreaterThanOrEqual(1);
    });

    it('fallbackParse should extract variables from valid JSON', () => {
      const code = JSON.stringify({ name: 'test', value: 123 });
      const captures = provider.fallbackParse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
    });

    it('fallbackParse should handle nested objects', () => {
      const code = JSON.stringify({ outer: { inner: { key: 'val' } } });
      const captures = provider.fallbackParse(code, 'test.json');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.length).toBeGreaterThanOrEqual(2);
    });

    it('fallbackParse should handle arrays', () => {
      const code = JSON.stringify({ items: [1, 2, 3] });
      const captures = provider.fallbackParse(code, 'test.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      const items = vars.find((c) => c.name === 'items');
      expect(items?.properties?.valueType).toBe('array');
    });

    it('fallbackParse should return empty for invalid JSON', () => {
      const captures = provider.fallbackParse('not json', 'test.json');
      expect(captures).toEqual([]);
    });

    it('fallbackParse should return empty for empty input', () => {
      const captures = provider.fallbackParse('', 'test.json');
      expect(captures).toEqual([]);
    });

    it('fallbackExtractImports should return empty array', () => {
      expect(provider.fallbackExtractImports('anything')).toEqual([]);
    });

    it('fallbackIsExported should return false', () => {
      expect(provider.fallbackIsExported('anything', 'any')).toBe(false);
    });
  });

  describe('internal helpers', () => {
    it('countChildren should work via parse', () => {
      // Verify the countChildren method works by checking object key counts
      const code = JSON.stringify({ a: 1, b: 2, c: 3 });
      const captures = provider.parse(code, 'test.json');
      const obj = captures.find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.keyCount === '3');
      expect(obj).toBeDefined();
    });
  });
});
