// @code-analyzer/analyzer — HTML Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: elements, attributes, scripts, styles, comments, imports.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class HtmlProvider extends TreeSitterBaseProvider {
  readonly language = 'html';
  readonly displayName = 'HTML';
  readonly extensions = ['.html', '.htm', '.xhtml'];
  readonly globs = ['**/*.html', '**/*.htm', '**/*.xhtml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-html') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'element', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'tag_name' },
      { nodeType: 'script_element', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'tag_name' },
      { nodeType: 'style_element', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'tag_name' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'element' || nt === 'script_element' || nt === 'style_element') {
      // Get tag name from start_tag → tag_name
      let tagName = '';
      let id = '';
      let cls = '';
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'start_tag' || child.type === 'self_closing_tag') {
          for (let j = 0; j < child.childCount; j++) {
            const sub = child.child(j);
            if (sub.type === 'tag_name') { tagName = sub.text; }
            if (sub.type === 'attribute') {
              const attrName = this.getAttrName(sub);
              const attrVal = this.getAttrValue(sub);
              if (attrName === 'id') { id = attrVal ?? ''; }
              if (attrName === 'class') { cls = attrVal ?? ''; }
            }
          }
        }
      }
      if (tagName) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: `<${tagName}${id ? ` id="${id}"` : ''}${cls ? ` class="${cls}"` : ''}>`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: tagName,
          properties: { id, class: cls, filePath: this.filePath },
        });
      }
    }

    // Inline scripts (src attribute) and link (stylesheet)
    if (nt === 'start_tag' || nt === 'self_closing_tag') {
      const tagNameNode = this.findChildOfType(node, 'tag_name');
      if (tagNameNode) {
        const tagText = tagNameNode.text;
        if (tagText === 'script') {
          const srcAttr = this.findAttribute(node, 'src');
          if (srcAttr) {
            captures.push({
              tag: CAPTURE_TAGS.IMPORT, text: srcAttr,
              startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
              startByte: node.startIndex, endByte: node.endIndex,
              name: srcAttr, properties: { importType: 'script', filePath: this.filePath },
            });
          }
        }
        if (tagText === 'link') {
          const hrefAttr = this.findAttribute(node, 'href');
          if (hrefAttr) {
            captures.push({
              tag: CAPTURE_TAGS.IMPORT, text: hrefAttr,
              startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
              startByte: node.startIndex, endByte: node.endIndex,
              name: hrefAttr, properties: { importType: 'link', filePath: this.filePath },
            });
          }
        }
      }
    }

    // Comment
    if (nt === 'comment') {
      const text = node.text.replace('<!--', '').replace('-->', '').trim();
      if (text) {
        captures.push({
          tag: CAPTURE_TAGS.DOCSTRING, text,
          startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          startByte: node.startIndex, endByte: node.endIndex,
          name: '[comment]', properties: { filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private getAttrName(attrNode: TreeSitterSyntaxNode): string {
    for (let i = 0; i < attrNode.childCount; i++) {
      const child = attrNode.child(i);
      if (child.type === 'attribute_name') return child.text;
    }
    return '';
  }

  private getAttrValue(attrNode: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < attrNode.childCount; i++) {
      const child = attrNode.child(i);
      if (child.type === 'attribute_value') {
        let val = child.text;
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val;
      }
    }
    return undefined;
  }

  private findChildOfType(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === type) return node.child(i);
    }
    return null;
  }

  private findAttribute(node: TreeSitterSyntaxNode, name: string): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'attribute') {
        if (this.getAttrName(child) === name) return this.getAttrValue(child);
      }
    }
    return undefined;
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const tagRegex = /<\/?(\w+)[^>]*>/g;
    while ((m = tagRegex.exec(source)) !== null) {
      const isClosing = m[0]!.startsWith('</');
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isClosing: String(isClosing), filePath } });
    }
    const srcRegex = /<script[^>]+src=["']([^"']+)["']/g;
    while ((m = srcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'script', filePath } });
    }
    const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/g;
    while ((m = linkRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'link', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
