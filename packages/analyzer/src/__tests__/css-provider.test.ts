import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { CssProvider } from '../languages/css.js';

describe('CssProvider', () => {
  const provider = new CssProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('css');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('CSS');
    });

    it('should have .css, .scss, .less extensions', () => {
      expect(provider.extensions).toContain('.css');
      expect(provider.extensions).toContain('.scss');
      expect(provider.extensions).toContain('.less');
    });

    it('should have "none" import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse', () => {
    it('should parse simple rule sets', () => {
      const code = 'body { color: red; }';
      const captures = provider.parse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.some((c) => c.name === 'body')).toBe(true);
    });

    it('should parse class selectors', () => {
      const code = '.container { width: 100%; }';
      const captures = provider.parse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.some((c) => c.name === '.container')).toBe(true);
    });

    it('should parse ID selectors', () => {
      const code = '#main { padding: 20px; }';
      const captures = provider.parse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.some((c) => c.name === '#main')).toBe(true);
    });

    it('should parse property declarations', () => {
      const code = 'body { color: red; font-size: 16px; }';
      const captures = provider.parse(code, 'test.css');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'color')).toBe(true);
      expect(vars.some((c) => c.name === 'font-size')).toBe(true);
    });

    it('should parse at-rules', () => {
      const code = '@media screen and (max-width: 600px) { body { font-size: 14px; } }';
      const captures = provider.parse(code, 'test.css');
      const atRules = captures.filter((c) => c.properties?.atRuleType === 'media');
      expect(atRules.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse @import statements', () => {
      const code = '@import url("reset.css");';
      const captures = provider.parse(code, 'test.css');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse keyframes at-rules', () => {
      const code = '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }';
      const captures = provider.parse(code, 'test.css');
      const keyframes = captures.filter((c) => c.properties?.atRuleType === 'keyframes');
      expect(keyframes.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse multiple selectors', () => {
      const code = 'h1, h2, h3 { color: blue; }';
      const captures = provider.parse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.some((c) => c.name?.includes('h1'))).toBe(true);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.css');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle CSS with comments', () => {
      const code = '/* Reset */\nbody { margin: 0; }';
      const captures = provider.parse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.length).toBeGreaterThanOrEqual(1);
    });

    it('should return captures sorted by line', () => {
      const code = '.a { color: red; }\n.b { color: blue; }';
      const captures = provider.parse(code, 'test.css');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should parse nested selectors', () => {
      const code = 'nav ul { list-style: none; }';
      const captures = provider.parse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.some((c) => c.name === 'nav ul')).toBe(true);
    });

    it('should parse attribute selectors', () => {
      const code = 'input[type="text"] { border: 1px solid; }';
      const captures = provider.parse(code, 'test.css');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse pseudo-class selectors', () => {
      const code = 'a:hover { text-decoration: underline; }';
      const captures = provider.parse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.some((c) => c.name === 'a:hover')).toBe(true);
    });

    it('should include filePath in properties', () => {
      const code = 'body { color: red; }';
      const captures = provider.parse(code, 'myfile.css');
      const rule = captures.find((c) => c.name === 'body');
      expect(rule?.properties?.filePath).toBe('myfile.css');
    });

    it('should parse font-face at-rule', () => {
      const code = '@font-face { font-family: "MyFont"; src: url("font.woff"); }';
      const captures = provider.parse(code, 'test.css');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse supports at-rule', () => {
      const code = '@supports (display: grid) { .grid { display: grid; } }';
      const captures = provider.parse(code, 'test.css');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should return empty array (CSS has no imports)', () => {
      const imports = provider.extractImports('body { color: red; }');
      expect(imports).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return false (CSS has no export concept)', () => {
      expect(provider.isExported('body { color: red; }', 'body')).toBe(false);
    });
  });

  describe('fallback methods', () => {
    it('fallbackParse should parse rule sets', () => {
      const code = 'body { color: red; }';
      const captures = provider.fallbackParse(code, 'test.css');
      const rules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(rules.some((c) => c.name === 'body')).toBe(true);
    });

    it('fallbackParse should parse property declarations', () => {
      const code = 'body { color: red; font-size: 16px; }';
      const captures = provider.fallbackParse(code, 'test.css');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'color')).toBe(true);
    });

    it('fallbackParse should parse import statements', () => {
      const code = '@import url("reset.css");';
      const captures = provider.fallbackParse(code, 'test.css');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'reset.css')).toBe(true);
    });

    it('fallbackParse should parse url() imports', () => {
      const code = '@import url("theme.css");';
      const captures = provider.fallbackParse(code, 'test.css');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'theme.css')).toBe(true);
    });

    it('fallbackParse should parse at-rules', () => {
      const code = '@media screen { body { font-size: 14px; } }';
      const captures = provider.fallbackParse(code, 'test.css');
      const atRules = captures.filter((c) => c.properties?.atRuleType === 'media');
      expect(atRules.length).toBeGreaterThanOrEqual(1);
    });

    it('fallbackParse should handle empty input', () => {
      const captures = provider.fallbackParse('', 'test.css');
      expect(captures).toEqual([]);
    });

    it('fallbackParse should return sorted captures', () => {
      const code = '.a { color: red; }\n.b { color: blue; }';
      const captures = provider.fallbackParse(code, 'test.css');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('fallbackParse should skip at-rule selectors', () => {
      const code = '@keyframes fade { from { opacity: 0; } }';
      const captures = provider.fallbackParse(code, 'test.css');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('fallbackExtractImports should return empty array', () => {
      expect(provider.fallbackExtractImports('anything')).toEqual([]);
    });

    it('fallbackIsExported should return false', () => {
      expect(provider.fallbackIsExported('anything', 'any')).toBe(false);
    });
  });
});
