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

    it('should have .html and .htm extensions', () => {
      expect(provider.extensions).toContain('.html');
      expect(provider.extensions).toContain('.htm');
    });

    it('should have none import semantics', () => {
      expect(provider.importSemantics).toBe('none');
    });
  });

  describe('parse — elements and tags', () => {
    it('should extract an element with id and class', () => {
      const code = '<div id="main" class="container">Hello</div>';
      const captures = provider.parse(code, 't.html');
      const els = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(els.some((c) => c.name === 'div' && c.properties?.id === 'main' && c.properties?.class === 'container')).toBe(true);
    });

    it('should extract a script src as an import', () => {
      const code = '<script src="https://x.com/a.js"></script>';
      const captures = provider.parse(code, 't.html');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'https://x.com/a.js')).toBe(true);
    });

    it('should extract a link href as an import', () => {
      const code = '<link rel="stylesheet" href="style.css">';
      const captures = provider.parse(code, 't.html');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'style.css')).toBe(true);
    });

    it('should extract an img src as an import', () => {
      const code = '<img src="img.png" alt="x">';
      const captures = provider.parse(code, 't.html');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'img.png')).toBe(true);
    });

    it('should extract a comment', () => {
      const code = '<!-- hello world -->';
      const captures = provider.parse(code, 't.html');
      const comments = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(comments.some((c) => c.name === '[comment]')).toBe(true);
    });

    it('should extract a doctype', () => {
      const code = '<!DOCTYPE html>';
      const captures = provider.parse(code, 't.html');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs.some((c) => c.name === 'doctype')).toBe(true);
    });
  });

  describe('taint sources', () => {
    it('should detect form as user_input', () => {
      const sources = provider.extractTaintSources('<form><input type="text"></form>');
      expect(sources.some((s) => s.name === 'form' && s.sourceType === 'user_input')).toBe(true);
    });

    it('should detect input/textarea/select as user_input', () => {
      const sources = provider.extractTaintSources('<input type="text"><textarea></textarea><select></select>');
      expect(sources.some((s) => s.name === 'input')).toBe(true);
      expect(sources.some((s) => s.name === 'textarea')).toBe(true);
      expect(sources.some((s) => s.name === 'select')).toBe(true);
    });

    it('should detect external script src as external_script', () => {
      const sources = provider.extractTaintSources('<script src="https://evil.com/x.js"></script>');
      expect(sources.some((s) => s.sourceType === 'external_script')).toBe(true);
    });
  });

  describe('taint sinks', () => {
    it('should detect script/style as xss sink', () => {
      const sinks = provider.extractTaintSinks('<script>alert(1)</script>');
      expect(sinks.some((s) => s.name === 'script' && s.sinkType === 'xss')).toBe(true);
    });

    it('should detect event handlers as xss_event_handler', () => {
      const sinks = provider.extractTaintSinks('<div onload="x()"></div>');
      expect(sinks.some((s) => s.name === 'onload' && s.sinkType === 'xss_event_handler')).toBe(true);
    });

    it('should detect innerHTML as xss sink', () => {
      const sinks = provider.extractTaintSinks('<div innerHTML="x"></div>');
      expect(sinks.some((s) => s.name === 'div' && s.sinkType === 'xss')).toBe(true);
    });
  });

  describe('sanitizers', () => {
    it('should detect CSP meta tag as sanitizer', () => {
      const sanitizers = provider.extractSanitizers('<meta http-equiv="Content-Security-Policy" content="default-src self">');
      expect(sanitizers.some((s) => s.name === 'csp' && s.sanitizerType === 'csp_policy')).toBe(true);
    });
  });
});
