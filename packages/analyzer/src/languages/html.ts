// @code-analyzer/analyzer — HTML Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class HtmlProvider extends TreeSitterBaseProvider {
  readonly language = 'html';
  readonly displayName = 'HTML';
  readonly extensions = ['.html', '.htm', '.xhtml'];
  readonly globs = ['**/*.html', '**/*.htm', '**/*.xhtml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-html') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'element', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'start_tag' },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // HTML elements: <tagname ...>
    const tagRegex = /<\/?(\w+)[^>]*>/g;
    while ((m = tagRegex.exec(source)) !== null) {
      const isClosing = m[0]!.startsWith('</');
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { isClosing: String(isClosing), filePath },
      });
    }

    // HTML comments
    const commentRegex = /<!--(.+?)-->/gs;
    while ((m = commentRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: 'comment',
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: '[comment]', properties: { filePath },
      });
    }

    // Script and style references
    const srcRegex = /<script[^>]+src=["']([^"']+)["']/g;
    while ((m = srcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { importType: 'script', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
