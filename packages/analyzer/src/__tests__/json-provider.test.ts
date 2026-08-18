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

    it('should have .json and .jsonc extensions', () => {
      expect(provider.extensions).toContain('.json');
      expect(provider.extensions).toContain('.jsonc');
    });

    it('should have none import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse — objects and pairs', () => {
    it('should extract an object with key count', () => {
      const code = '{"name": "Alice", "age": 30}';
      const captures = provider.parse(code, 't.json');
      const objects = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(objects.some((c) => c.name.startsWith('object_'))).toBe(true);
    });

    it('should extract a string value', () => {
      const code = '{"name": "Alice"}';
      const captures = provider.parse(code, 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name' && c.properties?.valueType === 'string')).toBe(true);
    });

    it('should extract a number value', () => {
      const code = '{"age": 30}';
      const captures = provider.parse(code, 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'age' && c.properties?.valueType === 'number')).toBe(true);
    });

    it('should extract a boolean value', () => {
      const code = '{"active": true, "deleted": false}';
      const captures = provider.parse(code, 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'active' && c.properties?.valueType === 'boolean')).toBe(true);
    });

    it('should extract a null value', () => {
      const code = '{"data": null}';
      const captures = provider.parse(code, 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'data' && c.properties?.valueType === 'null')).toBe(true);
    });

    it('should extract a nested object value', () => {
      const code = '{"user": {"id": 1}}';
      const captures = provider.parse(code, 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'user' && c.properties?.valueType === 'object')).toBe(true);
    });

    it('should extract an array value', () => {
      const code = '{"items": [1, 2]}';
      const captures = provider.parse(code, 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'items' && c.properties?.valueType === 'array')).toBe(true);
    });
  });

  describe('parse — arrays and comments', () => {
    it('should extract an array with item count', () => {
      const code = '[1, 2, 3]';
      const captures = provider.parse(code, 't.json');
      const arrays = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(arrays.some((c) => c.name.startsWith('array_'))).toBe(true);
    });

    it('should extract a comment', () => {
      const code = '// a comment\n{"a": 1}';
      const captures = provider.parse(code, 't.jsonc');
      const comments = captures.filter((c) => c.tag === CAPTURE_TAGS.COMMENT);
      expect(comments.some((c) => c.name === '[comment]')).toBe(true);
    });
  });

  describe('taint analysis', () => {
    it('should detect password as config_secret source', () => {
      const sources = provider.extractTaintSources('{"password": "secret123"}');
      expect(sources.some((s) => s.name === 'password' && s.sourceType === 'config_secret')).toBe(true);
    });

    it('should detect api_key as config_secret source', () => {
      const sources = provider.extractTaintSources('{"api_key": "abc"}');
      expect(sources.some((s) => s.sourceType === 'config_secret')).toBe(true);
    });

    it('should detect allowed list as config_validation sanitizer', () => {
      const sanitizers = provider.extractSanitizers('{"allowed_ips": ["1.2.3.4"]}');
      expect(sanitizers.some((s) => s.name === 'allowed_ips' && s.sanitizerType === 'config_validation')).toBe(true);
    });

    it('should return no taint sinks (JSON has no code-execution sinks)', () => {
      expect(provider.extractTaintSinks('{"a": 1}')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should report JSON keys as not exported', () => {
      expect(provider.isExported('{"a": 1}', 'a')).toBe(false);
    });
  });
});
