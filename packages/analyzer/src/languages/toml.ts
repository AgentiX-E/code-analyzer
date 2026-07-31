// @code-analyzer/analyzer — TOML Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class TomlProvider extends TreeSitterBaseProvider {
  readonly language = 'toml';
  readonly displayName = 'TOML';
  readonly extensions = ['.toml'];
  readonly globs = ['**/*.toml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-toml') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [{ nodeType: 'pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'bare_key' }];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;
    let currentTable = '';

    // Table sections: [section] or [section.subsection]
    const tableRegex = /^\s*\[([^\]]+)\]\s*$/gm;
    while ((m = tableRegex.exec(source)) !== null) {
      currentTable = m[1]!;
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF, text: `[${currentTable}]`,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: currentTable, properties: { isTable: 'true', filePath },
      });
    }

    // Key-value pairs: key = value
    const kvRegex = /^\s*(\w+)\s*=\s*(.+?)\s*$/gm;
    while ((m = kvRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { section: currentTable, filePath },
      });
    }

    // Array of tables: [[array]]
    const arrayTableRegex = /^\s*\[\[([^\]]+)\]\]\s*$/gm;
    while ((m = arrayTableRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: `[[${m[1]}]]`,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { isArrayTable: 'true', filePath },
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
