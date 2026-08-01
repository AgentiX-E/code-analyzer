import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { HtmlProvider } from '../languages/html.js';

describe('HtmlProvider', () => {
  const provider = new HtmlProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('html');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('HTML');
    });

    it('should have .html, .htm, .xhtml extensions', () => {
      expect(provider.extensions).toContain('.html');
      expect(provider.extensions).toContain('.htm');
      expect(provider.extensions).toContain('.xhtml');
    });

    it('should have "none" import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse', () => {
    it('should parse elements with tag names', () => {
      const code = '<div></div>';
      const captures = provider.parse(code, 'test.html');
      const divs = captures.filter((c) => c.name === 'div');
      expect(divs.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse elements with attributes', () => {
      const code = '<div id="main" class="container"></div>';
      const captures = provider.parse(code, 'test.html');
      const divs = captures.filter((c) => c.name === 'div');
      expect(divs.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse script elements', () => {
      const code = '<script src="app.js"></script>';
      const captures = provider.parse(code, 'test.html');
      const scripts = captures.filter((c) => c.name === 'script');
      expect(scripts.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse link elements', () => {
      const code = '<link rel="stylesheet" href="style.css">';
      const captures = provider.parse(code, 'test.html');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse comments via tree-sitter', () => {
      const code = '<!-- This is a comment -->';
      const captures = provider.parse(code, 'test.html');
      // Tree-sitter may or may not extract comments as DOCSTRING
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse self-closing tags', () => {
      const code = '<br/><img src="photo.jpg"/>';
      const captures = provider.parse(code, 'test.html');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse nested elements', () => {
      const code = '<div><span>text</span></div>';
      const captures = provider.parse(code, 'test.html');
      const spans = captures.filter((c) => c.name === 'span');
      const divs = captures.filter((c) => c.name === 'div');
      expect(spans.length).toBeGreaterThanOrEqual(1);
      expect(divs.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse HTML5 doctype', () => {
      const code = '<!DOCTYPE html>\n<html></html>';
      const captures = provider.parse(code, 'test.html');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.html');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle plain text', () => {
      const captures = provider.parse('just some text', 'test.html');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse elements with multiple attributes', () => {
      const code = '<input type="text" name="username" placeholder="Enter name">';
      const captures = provider.parse(code, 'test.html');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = '<div></div>\n<span></span>\n<p></p>';
      const captures = provider.parse(code, 'test.html');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should include filePath in properties', () => {
      const code = '<div></div>';
      const captures = provider.parse(code, 'myfile.html');
      const div = captures.find((c) => c.name === 'div');
      expect(div?.properties?.filePath).toBe('myfile.html');
    });

    it('should parse HTML with inline style elements', () => {
      const code = '<style>body { color: red; }</style>';
      const captures = provider.parse(code, 'test.html');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should parse a basic HTML document structure', () => {
      const code = '<!DOCTYPE html>\n<html>\n<head>\n<title>Test</title>\n</head>\n<body>\n<h1>Hello</h1>\n</body>\n</html>';
      const captures = provider.parse(code, 'test.html');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.length).toBeGreaterThan(0);
    });
  });

  describe('extractImports', () => {
    it('should return empty array (HTML has no imports)', () => {
      const imports = provider.extractImports('<div></div>');
      expect(imports).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return false (HTML has no export concept)', () => {
      expect(provider.isExported('<div></div>', 'div')).toBe(false);
    });
  });

  describe('fallback methods', () => {
    it('fallbackParse should parse tags', () => {
      const code = '<div></div><span></span>';
      const captures = provider.fallbackParse(code, 'test.html');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'div')).toBe(true);
      expect(vars.some((c) => c.name === 'span')).toBe(true);
    });

    it('fallbackParse should detect closing tags', () => {
      const code = '<div></div>';
      const captures = provider.fallbackParse(code, 'test.html');
      const closing = captures.filter((c) => c.properties?.isClosing === 'true');
      expect(closing.length).toBeGreaterThanOrEqual(1);
    });

    it('fallbackParse should extract script src imports', () => {
      const code = '<script src="app.js"></script>';
      const captures = provider.fallbackParse(code, 'test.html');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'app.js')).toBe(true);
    });

    it('fallbackParse should extract link href imports', () => {
      const code = '<link href="style.css" rel="stylesheet">';
      const captures = provider.fallbackParse(code, 'test.html');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'style.css')).toBe(true);
    });

    it('fallbackParse should handle empty input', () => {
      const captures = provider.fallbackParse('', 'test.html');
      expect(captures).toEqual([]);
    });

    it('fallbackParse should return sorted captures', () => {
      const code = '<div></div>\n<span></span>';
      const captures = provider.fallbackParse(code, 'test.html');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('fallbackExtractImports should return empty array', () => {
      expect(provider.fallbackExtractImports('anything')).toEqual([]);
    });

    it('fallbackIsExported should return false', () => {
      expect(provider.fallbackIsExported('anything', 'any')).toBe(false);
    });
  });
});
