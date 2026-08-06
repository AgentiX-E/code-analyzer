// @code-analyzer/analyzer — Markdown Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, headings, links, code blocks,
// images, tables, lists, blockquotes, frontmatter, inline code, ref links.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class MarkdownProvider extends TreeSitterBaseProvider {
  readonly language = 'markdown';
  readonly displayName = 'Markdown';
  readonly extensions = ['.md', '.mdx', '.markdown'];
  readonly globs = ['**/*.md', '**/*.mdx', '**/*.markdown'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('@tree-sitter-grammars/tree-sitter-markdown') as { language: TreeSitterLanguage } | TreeSitterLanguage;
      return (m as { language: TreeSitterLanguage }).language ?? (m as TreeSitterLanguage);
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'atx_heading', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'setext_heading', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'inline_link', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'link_text' },
      { nodeType: 'full_reference_link', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'link_text' },
      { nodeType: 'shortcut_link', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'link_text' },
      { nodeType: 'image', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'image_description' },
      { nodeType: 'fenced_code_block', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'indented_code_block', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'list_item', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'table', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'block_quote', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'minus_metadata', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'plus_metadata', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'thematic_break', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'inline_code', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'emphasis', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'strong', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'link_destination', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'paragraph', captureTag: CAPTURE_TAGS.DOCSTRING, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'atx_heading') {
      const depth = node.text.match(/^(#+)/)?.[1]?.length ?? 1;
      const text = node.text.replace(/^#+\s*/, '').trim();
      if (text) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, text, text, { level: String(depth), isHeading: 'true' }));
      }
    } else if (nt === 'setext_heading') {
      const text = node.text.split('\n')[0]?.trim();
      if (text) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, text, text, { isHeading: 'true', isSetext: 'true' }));
      }
    } else if (nt === 'inline_link' || nt === 'full_reference_link' || nt === 'shortcut_link') {
      let linkText = '';
      let linkUrl = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        if (node.namedChild(i).type === 'link_text') linkText = node.namedChild(i).text;
      }
      const urlMatch = node.text.match(/\]\(([^)]+)\)/);
      if (urlMatch) linkUrl = urlMatch[1]!;
      if (linkText || linkUrl) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
          linkText || linkUrl, linkText || linkUrl, { url: linkUrl, linkType: 'markdown' }));
      }
    } else if (nt === 'image') {
      const altMatch = node.text.match(/!\[([^\]]*)\]/);
      const urlMatch = node.text.match(/\]\(([^)]+)\)/);
      if (altMatch || urlMatch) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
          `img:${altMatch?.[1] ?? ''}`, node.text, { isImage: 'true', url: urlMatch?.[1] ?? '' }));
      }
    } else if (nt === 'fenced_code_block') {
      let lang = '';
      const firstLine = node.text.split('\n')[0]?.replace(/^```/, '').trim();
      if (firstLine) lang = firstLine;
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        lang || 'code-block', 'code-block', { language: lang, isCodeBlock: 'true' }));
    } else if (nt === 'indented_code_block') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        'indented-code', node.text.substring(0, 60), { isCodeBlock: 'true' }));
    } else if (nt === 'list_item') {
      const firstLine = node.text.split('\n')[0]?.trim();
      if (firstLine) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
          firstLine, firstLine, { isListItem: 'true' }));
      }
    } else if (nt === 'table') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF,
        `table_${node.startPosition.row + 1}`, 'table', { isTable: 'true' }));
    } else if (nt === 'block_quote') {
      const text = node.text.replace(/^>\s?/gm, '').trim();
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        `quote_${node.startPosition.row + 1}`, text.substring(0, 60), { isBlockquote: 'true' }));
    } else if (nt === 'minus_metadata' || nt === 'plus_metadata') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        'frontmatter', 'frontmatter', { isFrontmatter: 'true' }));
    } else if (nt === 'thematic_break') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        'horizontal-rule', '---', { isThematicBreak: 'true' }));
    } else if (nt === 'inline_code') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        `code_${node.startPosition.row + 1}`, node.text, { isInlineCode: 'true' }));
    } else if (nt === 'emphasis' || nt === 'strong') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        node.text, node.text, { isEmphasis: 'true', emphasisType: nt }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    // External links are potential taint sources (phishing/supply chain in docs)
    if (node.type === 'inline_link' || node.type === 'image') {
      const urlMatch = node.text.match(/\]\(([^)]+)\)/);
      if (urlMatch) {
        const url = urlMatch[1]!;
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('ftp://')) {
          sources.push({ name: url, sourceType: 'external_link',
            line: node.startPosition.row + 1, text: node.text, properties: {} });
        }
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(_node: TreeSitterSyntaxNode, _sinks: TaintSink[]): void {}
  protected override walkForSanitizers(_node: TreeSitterSyntaxNode, _sanitizers: TaintSanitizer[]): void {}

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

    const headingRx = /^(#{1,6})\s+(.+)$/gm;
    while ((m = headingRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: m[2]!.trim(), startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!.trim(), properties: { level: String(m[1]!.length), filePath } });
    }
    const linkRx = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = linkRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { url: m[2]!, linkType: 'markdown', filePath } });
    }
    const imgRx = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = imgRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: `img:${m[1] ?? m[2]}`, properties: { url: m[2]!, isImage: 'true', filePath } });
    }
    const codeRx = /^```(\w+)/gm;
    while ((m = codeRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'code-block', startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { language: m[1]!, filePath } });
    }
    const listRx = /^(\s*)(?:-\s+(.+)|(\d+)\.\s+(.+))$/gm;
    while ((m = listRx.exec(source)) !== null) {
      const text = (m[2] ?? m[4])!.trim();
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: text, properties: { isListItem: 'true', filePath } });
    }
    const bqRx = /^>\s+(.+)$/gm;
    while ((m = bqRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!.trim(), startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: `quote:${m[1]!.trim()}`, properties: { isBlockquote: 'true', filePath } });
    }
    if (source.startsWith('---')) {
      const endIdx = source.indexOf('---', 3);
      if (endIdx > 0) {
        captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'frontmatter', startLine: 1, endLine: source.slice(0, endIdx + 3).split('\n').length, startByte: 0, endByte: endIdx + 3, name: 'frontmatter', properties: { isFrontmatter: 'true', filePath } });
      }
    }
    const tblRx = /^\|.+\|.*\n\|[-|: ]+\|/gm;
    while ((m = tblRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: 'table', startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: 'table', properties: { isTable: 'true', filePath } });
    }
    const inlineCodeRx = /`([^`]+)`/g;
    while ((m = inlineCodeRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: `code:${m[1]!}`, properties: { isInlineCode: 'true', filePath } });
    }
    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /\]\((https?:\/\/[^)]+)\)/g;
    while ((m = rx.exec(source)) !== null) {
      sources.push({ name: m[1]!, sourceType: 'external_link', line: ln(m.index), text: m[0], properties: {} });
    }
    return sources;
  }
  protected override fallbackExtractTaintSinks(_source: string): TaintSink[] { return []; }
  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }
}
