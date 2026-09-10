import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { JsonProvider } from '../languages/json.js';
import type { TreeSitterLanguage } from '../languages/tree-sitter-base.js';

// A provider with no grammar, forcing every method onto its regex-based
// fallback implementation.
class NoGrammarJsonProvider extends JsonProvider {
  protected override loadGrammar(): TreeSitterLanguage | null {
    return null;
  }
}

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
      expect(vars.some((c) => c.name === 'name' && c.properties?.valueType === 'string')).toBe(
        true,
      );
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
      expect(vars.some((c) => c.name === 'active' && c.properties?.valueType === 'boolean')).toBe(
        true,
      );
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
      expect(vars.some((c) => c.name === 'user' && c.properties?.valueType === 'object')).toBe(
        true,
      );
    });

    it('should extract an array value', () => {
      const code = '{"items": [1, 2]}';
      const captures = provider.parse(code, 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'items' && c.properties?.valueType === 'array')).toBe(
        true,
      );
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
      expect(sources.some((s) => s.name === 'password' && s.sourceType === 'config_secret')).toBe(
        true,
      );
    });

    it('should detect api_key as config_secret source', () => {
      const sources = provider.extractTaintSources('{"api_key": "abc"}');
      expect(sources.some((s) => s.sourceType === 'config_secret')).toBe(true);
    });

    it('should detect allowed list as config_validation sanitizer', () => {
      const sanitizers = provider.extractSanitizers('{"allowed_ips": ["1.2.3.4"]}');
      expect(
        sanitizers.some((s) => s.name === 'allowed_ips' && s.sanitizerType === 'config_validation'),
      ).toBe(true);
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

  describe('parse — defensive branches', () => {
    it('should not emit a capture for an empty-key pair', () => {
      const captures = provider.parse('{"": 1}', 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(0);
    });

    it('should emit key-only text for an empty-string value', () => {
      const captures = provider.parse('{"name": ""}', 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(1);
      expect(vars[0]!.name).toBe('name');
      expect(vars[0]!.text).toBe('name');
      expect(vars[0]!.properties?.valueType).toBe('string');
    });

    it('should count only pairs when an object has inline comments', () => {
      const captures = provider.parse('{"a": 1, /* c */ "b": 2}', 't.jsonc');
      const objects = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(objects).toHaveLength(1);
      expect(objects[0]!.properties?.keyCount).toBe('2');
    });
  });

  describe('taint — defensive branches', () => {
    it('should not flag an empty-key pair as a secret source', () => {
      expect(provider.extractTaintSources('{"": "secret"}')).toEqual([]);
    });

    it('should not flag a non-secret key as a secret source', () => {
      expect(provider.extractTaintSources('{"name": "alice"}')).toEqual([]);
    });

    it('should detect whitelist/validation/pattern keys as sanitizers', () => {
      expect(
        provider.extractSanitizers('{"whitelist_ips": []}').some((s) => s.name === 'whitelist_ips'),
      ).toBe(true);
      expect(
        provider
          .extractSanitizers('{"validation_rules": []}')
          .some((s) => s.name === 'validation_rules'),
      ).toBe(true);
      expect(
        provider
          .extractSanitizers('{"pattern_regex": "x"}')
          .some((s) => s.name === 'pattern_regex'),
      ).toBe(true);
    });

    it('should not flag a non-matching key as a sanitizer', () => {
      expect(provider.extractSanitizers('{"name": "x"}')).toEqual([]);
    });
  });

  describe('fallback (grammar unavailable)', () => {
    const fb = new NoGrammarJsonProvider();

    it('fallbackParse extracts root object and variable captures', () => {
      const captures = fb.parse('{"name": "Alice", "age": 30}', 't.json');
      const objects = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(objects.some((c) => c.name === 'root')).toBe(true);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
      expect(vars.some((c) => c.name === 'age')).toBe(true);
    });

    it('fallbackParse recurses into nested objects with dotted paths', () => {
      const captures = fb.parse('{"user": {"profile": {"id": 1}}}', 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      // The innermost key is reached through two levels of recursion.
      expect(vars.find((c) => c.name === 'id')).toBeDefined();
      // The second-level object carries a dot-joined path with no leading dot.
      const nestedObj = captures.find(
        (c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'user.profile',
      );
      expect(nestedObj).toBeDefined();
    });

    it('fallbackParse labels array, object, and null values', () => {
      const captures = fb.parse('{"items": [1], "obj": {"a": 1}, "n": null}', 't.json');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.find((c) => c.name === 'items')?.properties?.valueType).toBe('array');
      expect(vars.find((c) => c.name === 'obj')?.properties?.valueType).toBe('object');
      expect(vars.find((c) => c.name === 'n')?.properties?.valueType).toBe('null');
    });

    it('fallbackParse ignores top-level array, primitive, and null', () => {
      expect(fb.parse('[1, 2]', 't.json')).toEqual([]);
      expect(fb.parse('"hello"', 't.json')).toEqual([]);
      expect(fb.parse('null', 't.json')).toEqual([]);
    });

    it('fallbackParse returns empty on invalid JSON', () => {
      expect(fb.parse('{invalid', 't.json')).toEqual([]);
    });

    it('fallbackExtractImports returns empty', () => {
      expect(fb.extractImports('{"a": 1}')).toEqual([]);
    });

    it('fallbackIsExported returns false', () => {
      expect(fb.isExported('{"a": 1}', 'a')).toBe(false);
    });

    it('fallbackExtractTaintSources detects nested secret keys', () => {
      const sources = fb.extractTaintSources('{"config": {"password": "x"}}');
      expect(sources.some((s) => s.name === 'password' && s.sourceType === 'config_secret')).toBe(
        true,
      );
    });

    it('fallbackExtractTaintSources ignores non-secret keys', () => {
      expect(fb.extractTaintSources('{"name": "x"}')).toEqual([]);
    });

    it('fallbackExtractTaintSources ignores non-object top-level values', () => {
      expect(fb.extractTaintSources('[1]')).toEqual([]);
      expect(fb.extractTaintSources('"hello"')).toEqual([]);
      expect(fb.extractTaintSources('null')).toEqual([]);
    });

    it('fallbackExtractTaintSources returns empty on invalid JSON', () => {
      expect(fb.extractTaintSources('{bad')).toEqual([]);
    });

    it('fallbackExtractTaintSinks returns empty', () => {
      expect(fb.extractTaintSinks('{"a": 1}')).toEqual([]);
    });

    it('fallbackExtractSanitizers returns empty', () => {
      expect(fb.extractSanitizers('{"a": 1}')).toEqual([]);
    });
  });
});
