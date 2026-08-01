// @code-analyzer/analyzer — CSS Provider (tree-sitter AST walker with regex fallback)
// Full tree-sitter AST walker: rulesets, selectors, at-rules, declarations, imports.
// Note: tree-sitter-css has ESM-only exports; falls back to comprehensive regex on load failure.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class CssProvider extends TreeSitterBaseProvider {
  readonly language = 'css';
  readonly displayName = 'CSS';
  readonly extensions = ['.css', '.scss', '.less'];
  readonly globs = ['**/*.css', '**/*.scss', '**/*.less'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-css') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'rule_set', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'selectors' },
      { nodeType: 'declaration', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'property_name' },
      { nodeType: 'at_rule', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'at_keyword' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'rule_set') {
      let selectorText = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'selectors') selectorText = child.text.trim();
      }
      if (selectorText) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF, text: selectorText,
          startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          startByte: node.startIndex, endByte: node.endIndex,
          name: selectorText, properties: { filePath: this.filePath },
        });
      }
    }

    if (nt === 'declaration') {
      let propName = '';
      let propVal = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'property_name') propName = child.text;
        if (child.type === 'plain_value' || child.type === 'string_value') propVal = child.text;
      }
      if (propName) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${propName}: ${propVal}`,
          startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          startByte: node.startIndex, endByte: node.endIndex,
          name: propName, properties: { value: propVal, filePath: this.filePath },
        });
      }
    }

    if (nt === 'at_rule') {
      let atKeyword = '';
      let params = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'at_keyword') atKeyword = child.text.slice(1); // remove @
      }
      params = node.text.split(' ').slice(1).join(' ').split('{')[0]?.trim() ?? '';
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF, text: `@${atKeyword}${params ? ' ' + params : ''}`,
        startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
        startByte: node.startIndex, endByte: node.endIndex,
        name: atKeyword, properties: { atRuleType: atKeyword, params, filePath: this.filePath },
      });
    }

    if (nt === 'import_statement') {
      let url = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'string_value') url = child.text.slice(1, -1);
      }
      if (url) {
        captures.push({
          tag: CAPTURE_TAGS.IMPORT, text: url,
          startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          startByte: node.startIndex, endByte: node.endIndex,
          name: url, properties: { importType: 'css', filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    // CSS rules: selector { ... }
    const ruleRegex = /([.#]?[\w\s,.:#>~+[\]="'-]+?)\s*\{/g;
    while ((m = ruleRegex.exec(source)) !== null) {
      const selector = m[1]!.trim();
      if (selector.length > 0 && selector !== '}' && !selector.startsWith('@')) {
        captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: selector, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: selector, properties: { filePath } });
      }
    }
    // CSS properties: property: value;
    const propRegex = /\s+([\w-]+)\s*:\s*([^;]+);/g;
    while ((m = propRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${m[1]}: ${m[2]?.trim()}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { value: m[2]?.trim() ?? '', filePath } });
    }
    // @import
    const importRegex = /@import\s+(?:url\(["']?)?([^"')]+)(?:["']?\))?/g;
    while ((m = importRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'css', filePath } });
    }
    // @at-rules
    const atRuleRegex = /@(keyframes|media|font-face|supports|container|page|charset|namespace)\s+(.+?)\s*\{/g;
    while ((m = atRuleRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `@${m[1]!} ${m[2]?.trim()}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { atRuleType: m[1]!, filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
