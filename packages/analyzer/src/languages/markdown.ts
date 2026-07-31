// @code-analyzer/analyzer — Markdown Provider (tree-sitter AST walker with fallback)
// Handles headings, links, code blocks, images, tables, lists, frontmatter.
// Note: tree-sitter-markdown native build may fail; falls back to comprehensive regex parser.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class MarkdownProvider extends TreeSitterBaseProvider {
  readonly language = 'markdown';
  readonly displayName = 'Markdown';
  readonly extensions = ['.md', '.mdx', '.markdown'];
  readonly globs = ['**/*.md', '**/*.mdx', '**/*.markdown'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-markdown') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'atx_heading', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'setext_heading', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'link', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'link_text' },
      { nodeType: 'image', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'image_description' },
      { nodeType: 'code_fence_content', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    // Headings (# Title, ## Title)
    if (nt === 'atx_heading') {
      const depth = node.text.match(/^(#+)/)?.[1]?.length ?? 1;
      const text = node.text.replace(/^#+\s*/, '').trim();
      if (text) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF, text,
          startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          startByte: node.startIndex, endByte: node.endIndex,
          name: text, properties: { level: String(depth), filePath: this.filePath },
        });
      }
    }

    // Links: [text](url)
    if (nt === 'inline_link' || nt === 'full_reference_link' || nt === 'shortcut_link') {
      let linkText = '';
      let linkUrl = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'link_text') linkText = child.text;
      }
      const urlMatch = node.text.match(/\]\(([^)]+)\)/);
      if (urlMatch) linkUrl = urlMatch[1]!;
      if (linkText || linkUrl) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: linkText || linkUrl,
          startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          startByte: node.startIndex, endByte: node.endIndex,
          name: linkText || linkUrl, properties: { url: linkUrl, linkType: 'markdown', filePath: this.filePath },
        });
      }
    }

    // Code blocks
    if (nt === 'fenced_code_block') {
      let lang = '';
      const infoString = node.text.split('\n')[0]?.replace(/^```/, '').trim();
      if (infoString) lang = infoString;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'code-block',
        startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
        startByte: node.startIndex, endByte: node.endIndex,
        name: lang || 'code-block', properties: { language: lang, filePath: this.filePath },
      });
    }

    // YAML frontmatter
    if (nt === 'minus_metadata' || nt === 'plus_metadata') {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'frontmatter',
        startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
        startByte: node.startIndex, endByte: node.endIndex,
        name: 'frontmatter', properties: { isFrontmatter: 'true', filePath: this.filePath },
      });
    }

    // Lists
    if (nt === 'list_item') {
      const firstLine = node.text.split('\n')[0]?.trim();
      if (firstLine) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: firstLine,
          startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          startByte: node.startIndex, endByte: node.endIndex,
          name: firstLine, properties: { isListItem: 'true', filePath: this.filePath },
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

    // Headings: # to ######
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    while ((m = headingRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: m[2]!.trim(), startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!.trim(), properties: { level: String(m[1]!.length), filePath } });
    }

    // Links: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = linkRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { url: m[2]!, linkType: 'markdown', filePath } });
    }

    // Images: ![alt](url)
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = imgRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: `img:${m[1] ?? m[2]}`, properties: { url: m[2]!, isImage: 'true', filePath } });
    }

    // Code blocks: ```language
    const codeBlockRegex = /^```(\w+)/gm;
    while ((m = codeBlockRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'code-block', startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { language: m[1]!, filePath } });
    }

    // Lists
    const listRegex = /^(\s*)(?:-\s+(.+)|(\d+)\.\s+(.+))$/gm;
    while ((m = listRegex.exec(source)) !== null) {
      const text = (m[2] ?? m[4])!.trim();
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: text, properties: { isListItem: 'true', filePath } });
    }

    // YAML frontmatter
    if (source.startsWith('---')) {
      const endIdx = source.indexOf('---', 3);
      if (endIdx > 0) {
        captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'frontmatter', startLine: 1, endLine: source.slice(0, endIdx + 3).split('\n').length, startByte: 0, endByte: endIdx + 3, name: 'frontmatter', properties: { isFrontmatter: 'true', filePath } });
      }
    }

    // Blockquotes
    const bqRegex = /^>\s+(.+)$/gm;
    while ((m = bqRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!.trim(), startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: `quote:${m[1]!.trim()}`, properties: { isBlockquote: 'true', filePath } });
    }

    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
