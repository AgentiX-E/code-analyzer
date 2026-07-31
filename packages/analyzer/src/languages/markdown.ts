// @code-analyzer/analyzer — Markdown Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class MarkdownProvider extends TreeSitterBaseProvider {
  readonly language = 'markdown';
  readonly displayName = 'Markdown';
  readonly extensions = ['.md', '.mdx', '.markdown'];
  readonly globs = ['**/*.md', '**/*.mdx', '**/*.markdown'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-markdown') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'atx_heading', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Headings: # to ######
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    while ((m = headingRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF, text: m[2]!.trim(),
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[2]!.trim(), properties: { level: String(m[1]!.length), filePath },
      });
    }

    // Links: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = linkRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { url: m[2]!, linkType: 'markdown', filePath },
      });
    }

    // Code blocks: ```language
    const codeBlockRegex = /^```(\w+)/gm;
    while ((m = codeBlockRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'code-block',
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { language: m[1]!, filePath },
      });
    }

    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
