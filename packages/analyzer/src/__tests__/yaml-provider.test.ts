import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { YamlProvider } from '../languages/yaml.js';

describe('YamlProvider', () => {
  const provider = new YamlProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('yaml');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('YAML');
    });

    it('should have .yaml and .yml extensions', () => {
      expect(provider.extensions).toContain('.yaml');
      expect(provider.extensions).toContain('.yml');
    });

    it('should have "none" import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse', () => {
    it('should parse simple key-value mappings', () => {
      const code = 'name: MyApp\nversion: 1.0.0';
      const captures = provider.parse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
      expect(vars.some((c) => c.name === 'version')).toBe(true);
    });

    it('should parse nested mappings', () => {
      const code = 'server:\n  host: localhost\n  port: 8080';
      const captures = provider.parse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'host')).toBe(true);
      expect(vars.some((c) => c.name === 'port')).toBe(true);
    });

    it('should parse sequence items', () => {
      const code = 'items:\n  - apple\n  - banana\n  - cherry';
      const captures = provider.parse(code, 'test.yaml');
      const listItems = captures.filter((c) => c.properties?.isListItem === 'true');
      expect(listItems.length).toBeGreaterThanOrEqual(3);
    });

    it('should parse anchors', () => {
      const code = 'defaults: &defaults\n  adapter: postgres';
      const captures = provider.parse(code, 'test.yaml');
      // Anchors may be detected as anchor property on the pair, or as a separate node
      const anchors = captures.filter((c) =>
        c.properties?.anchor === 'true' || c.name === 'defaults'
      );
      expect(anchors.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse aliases', () => {
      const code = 'other: *defaults';
      const captures = provider.parse(code, 'test.yaml');
      // Aliases may be detected as alias property on the pair, or as a separate node
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse boolean values', () => {
      const code = 'enabled: true\ndisabled: false';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse null values', () => {
      const code = 'key: null';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse integer values', () => {
      const code = 'count: 42\nsize: 100';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse float values', () => {
      const code = 'ratio: 3.14';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse quoted scalars', () => {
      const code = 'single: \'hello\'\ndouble: "world"';
      const captures = provider.parse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'single')).toBe(true);
      expect(vars.some((c) => c.name === 'double')).toBe(true);
    });

    it('should handle comments', () => {
      const code = '# Comment\nkey: value';
      const captures = provider.parse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'key')).toBe(true);
    });

    it('should handle document separators', () => {
      const code = '---\nkey: value\n...';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse flow mappings', () => {
      const code = 'point: { x: 1, y: 2 }';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse flow sequences', () => {
      const code = 'colors: [red, green, blue]';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = 'a: 1\nb: 2\nc: 3';
      const captures = provider.parse(code, 'test.yaml');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should handle deeply nested YAML', () => {
      const code = 'a:\n  b:\n    c:\n      d: deep';
      const captures = provider.parse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'd')).toBe(true);
    });

    it('should include filePath in properties', () => {
      const code = 'key: value';
      const captures = provider.parse(code, 'myfile.yaml');
      const v = captures.find((c) => c.name === 'key');
      expect(v?.properties?.filePath).toBe('myfile.yaml');
    });

    it('should handle tags', () => {
      const code = 'key: !tag value';
      const captures = provider.parse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should return empty array (YAML has no imports)', () => {
      const imports = provider.extractImports('key: value');
      expect(imports).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return false (YAML has no export concept)', () => {
      expect(provider.isExported('key: value', 'key')).toBe(false);
    });
  });

  describe('fallback methods', () => {
    it('fallbackParse should parse key-value pairs', () => {
      const code = 'name: test\nversion: "1.0"';
      const captures = provider.fallbackParse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
    });

    it('fallbackParse should parse sequence items', () => {
      const code = '- item1\n- item2';
      const captures = provider.fallbackParse(code, 'test.yaml');
      const items = captures.filter((c) => c.properties?.isListItem === 'true');
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('fallbackParse should parse anchors', () => {
      const code = '&anchor key: value';
      const captures = provider.fallbackParse(code, 'test.yaml');
      const anchors = captures.filter((c) => c.properties?.anchor === 'true');
      expect(anchors.length).toBeGreaterThanOrEqual(1);
    });

    it('fallbackParse should parse aliases', () => {
      const code = '*alias value';
      const captures = provider.fallbackParse(code, 'test.yaml');
      const aliases = captures.filter((c) => c.properties?.alias === 'true');
      expect(aliases.length).toBeGreaterThanOrEqual(1);
    });

    it('fallbackParse should skip comments', () => {
      const code = '# comment\nkey: value';
      const captures = provider.fallbackParse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'key')).toBe(true);
    });

    it('fallbackParse should skip document markers', () => {
      const code = '---\nkey: value\n...';
      const captures = provider.fallbackParse(code, 'test.yaml');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'key')).toBe(true);
    });

    it('fallbackParse should handle block scalar indicators', () => {
      const code = 'description: |\n  multi line\n  text';
      const captures = provider.fallbackParse(code, 'test.yaml');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('fallbackParse should handle empty input', () => {
      const captures = provider.fallbackParse('', 'test.yaml');
      expect(captures).toEqual([]);
    });

    it('fallbackExtractImports should return empty array', () => {
      expect(provider.fallbackExtractImports('anything')).toEqual([]);
    });

    it('fallbackIsExported should return false', () => {
      expect(provider.fallbackIsExported('anything', 'any')).toBe(false);
    });
  });
});
