import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';

import { HtmlProvider } from '../languages/html.js';
import type {
  TreeSitterSyntaxNode,
  TreeSitterLanguage,
  TaintSource,
  TaintSink,
  TaintSanitizer,
} from '../languages/tree-sitter-base.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// A minimal in-memory TreeSitterSyntaxNode. Used to exercise defensive
// branches that real tree-sitter HTML cannot produce from valid input (an
// element without a tag_name, an attribute without an attribute_name, etc.).
function makeNode(
  type: string,
  children: TreeSitterSyntaxNode[] = [],
  text?: string,
): TreeSitterSyntaxNode {
  return {
    type,
    text: text ?? children.map((c) => c.text).join(''),
    startIndex: 0,
    endIndex: 0,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    childCount: children.length,
    namedChildCount: children.length,
    hasError: false,
    child: (i: number) => children[i],
    namedChild: (i: number) => children[i],
    childForFieldName: () => null,
    parent: null,
    walk: () => ({
      nodeType: type,
      startIndex: 0,
      endIndex: 0,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      gotoFirstChild: () => false,
      gotoNextSibling: () => false,
      gotoParent: () => false,
    }),
  };
}

// Exposes the protected AST-walk methods so their defensive branches can be
// exercised directly with synthetic nodes.
class TestableHtmlProvider extends HtmlProvider {
  public walkAndCaptureForTest(node: TreeSitterSyntaxNode): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    this.walkAndCapture(node, captures);
    return captures;
  }

  public walkForTaintSourcesForTest(node: TreeSitterSyntaxNode): TaintSource[] {
    const sources: TaintSource[] = [];
    this.walkForTaintSources(node, sources);
    return sources;
  }

  public walkForTaintSinksForTest(node: TreeSitterSyntaxNode): TaintSink[] {
    const sinks: TaintSink[] = [];
    this.walkForTaintSinks(node, sinks);
    return sinks;
  }

  public walkForSanitizersForTest(node: TreeSitterSyntaxNode): TaintSanitizer[] {
    const sanitizers: TaintSanitizer[] = [];
    this.walkForSanitizers(node, sanitizers);
    return sanitizers;
  }
}

// Simulates a runtime where the tree-sitter grammar is unavailable, forcing
// the provider onto its regex-based fallback methods.
class NoGrammarHtmlProvider extends HtmlProvider {
  protected override loadGrammar(): TreeSitterLanguage | null {
    return null;
  }
}

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
      expect(
        els.some(
          (c) =>
            c.name === 'div' && c.properties?.id === 'main' && c.properties?.class === 'container',
        ),
      ).toBe(true);
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
      const sources = provider.extractTaintSources(
        '<input type="text"><textarea></textarea><select></select>',
      );
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
      expect(sinks.some((s) => s.name === 'onload' && s.sinkType === 'xss_event_handler')).toBe(
        true,
      );
    });

    it('should detect innerHTML as xss sink', () => {
      const sinks = provider.extractTaintSinks('<div innerHTML="x"></div>');
      expect(sinks.some((s) => s.name === 'div' && s.sinkType === 'xss')).toBe(true);
    });
  });

  describe('sanitizers', () => {
    it('should detect CSP meta tag as sanitizer', () => {
      const sanitizers = provider.extractSanitizers(
        '<meta http-equiv="Content-Security-Policy" content="default-src self">',
      );
      expect(sanitizers.some((s) => s.name === 'csp' && s.sanitizerType === 'csp_policy')).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Attribute value edge cases (valid HTML)
  // -------------------------------------------------------------------------

  it('handles an id attribute without a value', () => {
    const captures = provider.parse('<div id>x</div>', 't.html');
    const els = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(els.some((c) => c.name === 'div' && c.properties?.id === '')).toBe(true);
  });

  it('handles a class attribute without a value', () => {
    const captures = provider.parse('<div class>x</div>', 't.html');
    const els = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(els.some((c) => c.name === 'div' && c.properties?.class === '')).toBe(true);
  });

  it('handles an unquoted attribute value', () => {
    const captures = provider.parse('<div id=foo>x</div>', 't.html');
    const els = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(els.some((c) => c.name === 'div' && c.properties?.id === 'foo')).toBe(true);
  });

  it('handles a single-quoted attribute value', () => {
    const captures = provider.parse("<div id='foo'>x</div>", 't.html');
    const els = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(els.some((c) => c.name === 'div' && c.properties?.id === 'foo')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Tag import edge cases (missing src/href)
  // -------------------------------------------------------------------------

  it('emits no import for a script without src', () => {
    const captures = provider.parse('<script>alert(1)</script>', 't.html');
    const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports).toEqual([]);
  });

  it('emits no import for a link without href', () => {
    const captures = provider.parse('<link rel="stylesheet">', 't.html');
    const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports).toEqual([]);
  });

  it('emits no import for an img without src', () => {
    const captures = provider.parse('<img alt="x">', 't.html');
    const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports).toEqual([]);
  });

  it('emits no docstring for an empty comment', () => {
    const captures = provider.parse('<!---->', 't.html');
    const comments = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
    expect(comments).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Taint walk branch coverage (valid HTML)
  // -------------------------------------------------------------------------

  it('returns no sources for a plain element', () => {
    const sources = provider.extractTaintSources('<div>foo</div>');
    expect(sources).toEqual([]);
  });

  it('ignores a script with a non-http src as an external source', () => {
    const sources = provider.extractTaintSources('<script src="local.js"></script>');
    expect(sources.some((s) => s.sourceType === 'external_script')).toBe(false);
  });

  it('treats a span as a non-xss sink without dangerous attributes', () => {
    const sinks = provider.extractTaintSinks('<span>plain</span>');
    expect(sinks).toEqual([]);
  });

  it('returns no sinks for a non-div/span element', () => {
    const sinks = provider.extractTaintSinks('<p>paragraph</p>');
    expect(sinks).toEqual([]);
  });

  it('recognizes a style element as a taint sink', () => {
    const sinks = provider.extractTaintSinks('<style>body{}</style>');
    expect(sinks.some((s) => s.name === 'style' && s.sinkType === 'xss')).toBe(true);
  });

  it('returns no sanitizers for a meta tag without a CSP http-equiv', () => {
    const sanitizers = provider.extractSanitizers('<meta name="description" content="x">');
    expect(sanitizers).toEqual([]);
  });

  it('returns no sanitizers for a non-meta element', () => {
    const sanitizers = provider.extractSanitizers('<div>foo</div>');
    expect(sanitizers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fallback methods (grammar unavailable)
// ---------------------------------------------------------------------------

describe('HtmlProvider fallback (grammar unavailable)', () => {
  const provider = new NoGrammarHtmlProvider();

  it('extracts tags via the regex fallback', () => {
    const captures = provider.parse('<div>foo</div>', 'f.html');
    const els = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(els.some((c) => c.name === 'div' && c.properties?.isClosing === 'false')).toBe(true);
    expect(els.some((c) => c.name === 'div' && c.properties?.isClosing === 'true')).toBe(true);
  });

  it('extracts script/link/img imports via the regex fallback', () => {
    const captures = provider.parse(
      '<script src="a.js"></script><link rel="x" href="b.css"><img src="c.png">',
      'f.html',
    );
    const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports.some((c) => c.name === 'a.js')).toBe(true);
    expect(imports.some((c) => c.name === 'b.css')).toBe(true);
    expect(imports.some((c) => c.name === 'c.png')).toBe(true);
  });

  it('returns no imports from the fallback', () => {
    expect(provider.extractImports('<div>x</div>')).toEqual([]);
  });

  it('reports nothing as exported in the fallback', () => {
    expect(provider.isExported('<div>x</div>', 'x')).toBe(false);
  });

  it('extracts form controls via the fallback taint source regex', () => {
    const sources = provider.extractTaintSources(
      '<form><input><textarea></textarea><select></select></form>',
    );
    expect(sources.some((s) => s.name === 'form')).toBe(true);
    expect(sources.some((s) => s.name === 'input')).toBe(true);
    expect(sources.some((s) => s.name === 'textarea')).toBe(true);
    expect(sources.some((s) => s.name === 'select')).toBe(true);
  });

  it('extracts script/style via the fallback taint sink regex', () => {
    const sinks = provider.extractTaintSinks('<script>x</script><style>y</style>');
    expect(sinks.some((s) => s.name === 'script' && s.sinkType === 'xss')).toBe(true);
    expect(sinks.some((s) => s.name === 'style' && s.sinkType === 'xss')).toBe(true);
  });

  it('returns no sanitizers from the fallback', () => {
    expect(provider.extractSanitizers('<meta http-equiv="x">')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Defensive branches exercised with synthetic AST nodes
// ---------------------------------------------------------------------------

describe('HtmlProvider defensive branches (synthetic nodes)', () => {
  const provider = new TestableHtmlProvider();

  it('emits no capture for an element whose start tag has no tag_name', () => {
    const element = makeNode('element', [makeNode('start_tag', [])]);
    const captures = provider.walkAndCaptureForTest(element);
    expect(captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF)).toEqual([]);
  });

  it('skips a start_tag that has no tag_name', () => {
    const startTag = makeNode('start_tag', []);
    const captures = provider.walkAndCaptureForTest(startTag);
    expect(captures).toEqual([]);
  });

  it('returns an empty name for an attribute without an attribute_name', () => {
    // element → start_tag → [tag_name 'div', attribute(has a value but no name)]
    const element = makeNode('element', [
      makeNode('start_tag', [
        makeNode('tag_name', [], 'div'),
        makeNode('attribute', [makeNode('attribute_value', [], 'foo')]),
      ]),
    ]);
    const captures = provider.walkAndCaptureForTest(element);
    const els = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(els.some((c) => c.name === 'div')).toBe(true);
  });

  it('recurses when a taint-source element has no tag_name', () => {
    const element = makeNode('element', [makeNode('text', [], 'foo')]);
    const sources = provider.walkForTaintSourcesForTest(element);
    expect(sources).toEqual([]);
  });

  it('recurses when a taint-sink element has no tag_name', () => {
    const element = makeNode('element', [makeNode('text', [], 'foo')]);
    const sinks = provider.walkForTaintSinksForTest(element);
    expect(sinks).toEqual([]);
  });

  it('recurses when a sanitizer element has no tag_name', () => {
    const element = makeNode('element', [makeNode('text', [], 'foo')]);
    const sanitizers = provider.walkForSanitizersForTest(element);
    expect(sanitizers).toEqual([]);
  });
});
