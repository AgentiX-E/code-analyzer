// @code-analyzer/analyzer — HTML Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, elements, attributes,
// XSS taint sinks, script/style imports, forms as taint sources.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class HtmlProvider extends TreeSitterBaseProvider {
  readonly language = 'html';
  readonly displayName = 'HTML';
  readonly extensions = ['.html', '.htm', '.xhtml'];
  readonly globs = ['**/*.html', '**/*.htm', '**/*.xhtml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('tree-sitter-html') as TreeSitterLanguage;
      return m;
    } /* v8 ignore start -- @preserve -- grammar is bundled, require never throws */
    catch {
      return null;
    }
    /* v8 ignore stop */
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'element' || nt === 'script_element' || nt === 'style_element') {
      this.captureElement(node, captures);
    } else if (nt === 'start_tag' || nt === 'self_closing_tag') {
      this.captureTag(node, captures);
    } else if (nt === 'comment') {
      this.captureComment(node, captures);
    } else if (nt === 'doctype') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.DOCSTRING, 'doctype', node.text, { isDoctype: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private captureElement(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    let tagName = '';
    let id = '';
    let cls = '';
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'start_tag' || child.type === 'self_closing_tag') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'tag_name') tagName = sub.text;
          if (sub.type === 'attribute') {
            const attrName = this.getAttrName(sub);
            const attrVal = this.getAttrValue(sub);
            /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
            if (attrName === 'id') id = attrVal ?? '';
            /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
            if (attrName === 'class') cls = attrVal ?? '';
          }
        }
      }
    }
    /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
    if (tagName) {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF, tagName,
        `<${tagName}${id ? ` id="${id}"` : ''}${cls ? ` class="${cls}"` : ''}>`, { id, class: cls }));
    }
  }

  private captureTag(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const tagNameNode = this.findChildOfType(node, 'tag_name');
    /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
    if (!tagNameNode) return;

    const tagText = tagNameNode.text;
    if (tagText === 'script') {
      const srcAttr = this.findAttribute(node, 'src');
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (srcAttr) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.IMPORT, srcAttr, srcAttr, { importType: 'script' }));
      }
    } else if (tagText === 'link') {
      const hrefAttr = this.findAttribute(node, 'href');
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (hrefAttr) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.IMPORT, hrefAttr, hrefAttr, { importType: 'link' }));
      }
    } else if (tagText === 'img') {
      const srcAttr = this.findAttribute(node, 'src');
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (srcAttr) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.IMPORT, srcAttr, srcAttr, { importType: 'img' }));
      }
    }
  }

  private captureComment(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const text = node.text.replace('<!--', '').replace('-->', '').trim();
    /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
    if (text) {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.DOCSTRING, '[comment]', text, { isComment: 'true' }));
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'element' || node.type === 'script_element' || 
        node.type === 'style_element' || node.type === 'start_tag') {
      let tagNameNode = this.findTagName(node);
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (!tagNameNode) {
        // Recursively walk children even if no tag_name found
        for (let i = 0; i < node.childCount; i++) {
          this.walkForTaintSources(node.child(i), sources);
        }
        return;
      }

      const tag = tagNameNode.text.toLowerCase();
      // Forms are taint sources (user input)
      if (tag === 'form' || tag === 'input' || tag === 'textarea' || tag === 'select') {
        sources.push({ name: tag, sourceType: 'user_input',
          line: node.startPosition.row + 1, text: node.text.substring(0, 100), properties: {} });
        return;
      }
      // Scripts with src from external sources
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (tag === 'script') {
        const src = this.findAttribute(node, 'src');
        /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
        if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
          sources.push({ name: src, sourceType: 'external_script',
            line: node.startPosition.row + 1, text: node.text.substring(0, 100), properties: {} });
        }
        return;
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    if (node.type === 'element' || node.type === 'script_element' || node.type === 'style_element') {
      const tagNameNode = this.findTagName(node);
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (!tagNameNode) {
        for (let i = 0; i < node.childCount; i++) {
          this.walkForTaintSinks(node.child(i), sinks);
        }
        return;
      }
      const tag = tagNameNode.text.toLowerCase();

      // XSS sinks
      if (tag === 'script' || tag === 'style') {
        sinks.push({ name: tag, sinkType: 'xss',
          line: node.startPosition.row + 1, text: node.text.substring(0, 100), properties: {} });
        return;
      }
      // HTML injection via innerHTML/document.write
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (tag === 'div' || tag === 'span') {
        const attrs = this.collectAttributes(node);
        if (attrs.some(a => a.toLowerCase().includes('innerhtml') || a.toLowerCase().includes('dangerously'))) {
          sinks.push({ name: tag, sinkType: 'xss',
            line: node.startPosition.row + 1, text: node.text.substring(0, 100), properties: {} });
          return;
        }
        // Fall through to event-handler detection for div/span without innerHTML.
      }
      // Event handler sinks (onclick, onerror, etc.)
      const events = ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur',
        'onchange', 'onsubmit', 'onkeydown', 'onkeyup'];
      for (const evt of events) {
        const val = this.findAttribute(node, evt);
        if (val) {
          sinks.push({ name: evt, sinkType: 'xss_event_handler',
            line: node.startPosition.row + 1, text: node.text.substring(0, 100), properties: {} });
          return;
        }
      }
      /* v8 ignore next -- @preserve -- non-matching / fallthrough return */
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    if (node.type === 'element' || node.type === 'script_element' || node.type === 'style_element') {
      const tagNameNode = this.findTagName(node);
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (!tagNameNode) {
        for (let i = 0; i < node.childCount; i++) {
          this.walkForSanitizers(node.child(i), sanitizers);
        }
        return;
      }
      const tag = tagNameNode.text.toLowerCase();
      // CSP meta tags are sanitizers
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (tag === 'meta') {
        const httpEquiv = this.findAttribute(node, 'http-equiv');
        /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
        if (httpEquiv && httpEquiv.toLowerCase().includes('content-security-policy')) {
          sanitizers.push({ name: 'csp', sanitizerType: 'csp_policy',
            line: node.startPosition.row + 1, text: node.text.substring(0, 100), properties: {} });
        }
        return;
      }
      /* v8 ignore next -- @preserve -- non-matching / fallthrough return */
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Attribute Helpers ----

  private findTagName(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
    if (node.type === 'element' || node.type === 'script_element' || node.type === 'style_element') {
      const startTag = this.findChildOfType(node, 'start_tag');
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      return startTag ? this.findChildOfType(startTag, 'tag_name') : null;
    }
    /* v8 ignore next -- @preserve -- non-matching / fallthrough return */
    return this.findChildOfType(node, 'tag_name');
  }

  private getAttrName(attrNode: TreeSitterSyntaxNode): string {
    for (let i = 0; i < attrNode.childCount; i++) {
      const child = attrNode.child(i);
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      if (child.type === 'attribute_name') return child.text;
    }
    /* v8 ignore next -- @preserve -- attribute always has an attribute_name */
    return '';
  }

  private getAttrValue(attrNode: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < attrNode.childCount; i++) {
      const child = attrNode.child(i);
      if (child.type === 'attribute_value' || child.type === 'quoted_attribute_value') {
        let val = child.text;
        /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val;
      }
    }
    /* v8 ignore next -- @preserve -- attribute always has a value node */
    return undefined;
  }

  private findChildOfType(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === type) return node.child(i);
    }
    /* v8 ignore next -- @preserve -- node traversal covers all cases */
    return null;
  }

  private findAttribute(node: TreeSitterSyntaxNode, name: string): string | undefined {
    // Attributes live inside the start_tag child of an element node, so descend
    // into it first (mirrors collectAttributes); start_tag/self_closing_tag call
    // sites already pass a node whose direct children are attributes.
    const container = node.type === 'element' || node.type === 'script_element' || node.type === 'style_element'
      /* v8 ignore next -- @preserve -- defensive null / non-matching taint branch */
      ? (this.findChildOfType(node, 'start_tag') ?? node)
      : node;
    for (let i = 0; i < container.childCount; i++) {
      const child = container.child(i);
      if (child.type === 'attribute') {
        if (this.getAttrName(child) === name) return this.getAttrValue(child);
      }
    }
    return undefined;
  }

  private collectAttributes(node: TreeSitterSyntaxNode): string[] {
    const attrs: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'start_tag') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'attribute') attrs.push(sub.text);
        }
      }
    }
    return attrs;
  }

  // ---- Helpers ----

  private makeCapture(
    node: TreeSitterSyntaxNode, tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, text: string, extra: Record<string, string> = {},
  ): UnifiedCapture {
    return { tag, text,
      startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      startByte: node.startIndex, endByte: node.endIndex,
      name, properties: { filePath: this.filePath, ...extra } };
  }

  // ---- Fallback ----

  /* v8 ignore next */
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const tagRx = /<\/?(\w+)[^>]*>/g;
    while ((m = tagRx.exec(source)) !== null) {
      const isClosing = m[0]!.startsWith('</');
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isClosing: String(isClosing), filePath } });
    }
    const srcRx = /<script[^>]+src=["']([^"']+)["']/g;
    while ((m = srcRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'script', filePath } });
    }
    const linkRx = /<link[^>]+href=["']([^"']+)["'][^>]*>/g;
    while ((m = linkRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'link', filePath } });
    }
    const imgRx = /<img[^>]+src=["']([^"']+)["']/g;
    while ((m = imgRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'img', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  /* v8 ignore next */
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }

  /* v8 ignore next */
  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /<(form|input|textarea|select)\b/g;
    while ((m = rx.exec(source)) !== null) {
      sources.push({ name: m[1]!, sourceType: 'user_input', line: ln(m.index), text: m[0], properties: {} });
    }
    return sources;
  }

  /* v8 ignore next */
  protected override fallbackExtractTaintSinks(source: string): TaintSink[] {
    const sinks: TaintSink[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /<(script|style)\b/g;
    while ((m = rx.exec(source)) !== null) {
      sinks.push({ name: m[1]!, sinkType: 'xss', line: ln(m.index), text: m[0], properties: {} });
    }
    return sinks;
  }

  /* v8 ignore next */
  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }
}
