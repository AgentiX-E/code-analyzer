// @code-analyzer/analyzer — CSS Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, selectors, declarations,
// at-rules, imports, CSS injection taint sinks. Falls back to regex on ESM errors.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class CssProvider extends TreeSitterBaseProvider {
  readonly language = 'css';
  readonly displayName = 'CSS';
  readonly extensions = ['.css', '.scss', '.less'];
  readonly globs = ['**/*.css', '**/*.scss', '**/*.less'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('tree-sitter-css') as TreeSitterLanguage;
      return m;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'rule_set', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'selectors' },
      { nodeType: 'declaration', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'property_name' },
      { nodeType: 'at_rule', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'at_keyword' },
      { nodeType: 'selectors', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'class_selector', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'id_selector', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'tag_name', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'property_name', captureTag: CAPTURE_TAGS.PROPERTY_DEF, useFirstNamedChild: true },
      { nodeType: 'plain_value', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'string_value', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'integer_value', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'float_value', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'import_statement', captureTag: CAPTURE_TAGS.IMPORT, useFirstNamedChild: true },
      { nodeType: 'media_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'keyframes_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'supports_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'font_face_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.COMMENT, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'rule_set') {
      let selectorText = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'selectors') selectorText = child.text.trim();
      }
      if (selectorText) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, selectorText, selectorText));
      }
    } else if (nt === 'declaration') {
      let propName = '';
      let propVal = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'property_name') propName = child.text;
        if (child.type === 'plain_value' || child.type === 'string_value' ||
            child.type === 'integer_value' || child.type === 'float_value') propVal = child.text;
      }
      if (propName) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF, propName,
          `${propName}: ${propVal}`, { value: propVal }));
      }
    } else if (nt === 'at_rule') {
      let atKeyword = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'at_keyword') atKeyword = child.text.slice(1);
      }
      const params = node.text.split(' ').slice(1).join(' ').split('{')[0]?.trim() ?? '';
      captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, atKeyword,
        `@${atKeyword}${params ? ' ' + params : ''}`, { atRuleType: atKeyword, params }));
    } else if (nt === 'import_statement') {
      let url = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'string_value') url = child.text.slice(1, -1);
      }
      if (url) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.IMPORT, url, url, { importType: 'css' }));
      }
    } else if (nt === 'media_statement') {
      const params = node.text.replace(/^@media\s+/, '').split('{')[0]?.trim() ?? '';
      captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, '@media', `@media ${params}`,
        { atRuleType: 'media', params }));
    } else if (nt === 'keyframes_statement') {
      const name = node.text.match(/@keyframes\s+(\w+)/)?.[1] ?? 'keyframes';
      captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, name, `@keyframes ${name}`,
        { atRuleType: 'keyframes' }));
    } else if (nt === 'comment') {
      const text = node.text.replace(/\/\*/, '').replace(/\*\//, '').trim();
      captures.push(this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', text, { isComment: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'declaration') {
      const text = node.text.toLowerCase();
      // CSS url() references are taint sources if external
      if (text.includes('url(') && (text.includes('http://') || text.includes('https://'))) {
        sources.push({ name: 'external_url', sourceType: 'external_resource',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    if (node.type === 'declaration') {
      const propLower = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'property_name') {
          const prop = child.text.toLowerCase();
          // expression() and javascript: in CSS are sinks
          if (prop === 'expression' || prop.includes('behavior')) {
            sinks.push({ name: prop, sinkType: 'css_injection',
              line: node.startPosition.row + 1, text: node.text, properties: {} });
            return;
          }
          // css variables with url() are sinks
          if (prop.startsWith('--') && node.text.includes('url(')) {
            sinks.push({ name: prop, sinkType: 'css_injection',
              line: node.startPosition.row + 1, text: node.text, properties: {} });
            return;
          }
        }
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    if (node.type === 'declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'property_name') {
          const prop = child.text.toLowerCase();
          // content-security-policy sanitizes CSS
          if (prop === 'nonce' || prop.includes('csp')) {
            sanitizers.push({ name: prop, sanitizerType: 'csp',
              line: node.startPosition.row + 1, text: node.text, properties: {} });
            return;
          }
        }
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
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

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const ruleRx = /([.#]?[\w\s,.:#>~+[\]="'-]+?)\s*\{/g;
    while ((m = ruleRx.exec(source)) !== null) {
      const selector = m[1]!.trim();
      if (selector.length > 0 && selector !== '}' && !selector.startsWith('@')) {
        captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: selector, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: selector, properties: { filePath } });
      }
    }
    const propRx = /\s+([\w-]+)\s*:\s*([^;]+);/g;
    while ((m = propRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${m[1]!}: ${m[2]?.trim()}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { value: m[2]?.trim() ?? '', filePath } });
    }
    const importRx = /@import\s+(?:url\(["']?)?([^"')]+)(?:["']?\))?/g;
    while ((m = importRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'css', filePath } });
    }
    const atRuleRx = /@(keyframes|media|font-face|supports|container|page|charset|namespace)\s+(.+?)\s*\{/g;
    while ((m = atRuleRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `@${m[1]!} ${m[2]?.trim()}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { atRuleType: m[1]!, filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /url\((https?:\/\/[^)]+)\)/g;
    while ((m = rx.exec(source)) !== null) {
      sources.push({ name: m[1]!, sourceType: 'external_resource', line: ln(m.index), text: m[0], properties: {} });
    }
    return sources;
  }
  protected override fallbackExtractTaintSinks(_source: string): TaintSink[] { return []; }
  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }
}
