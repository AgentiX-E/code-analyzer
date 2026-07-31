// @code-analyzer/analyzer — JSON Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class JsonProvider extends TreeSitterBaseProvider {
  readonly language = 'json';
  readonly displayName = 'JSON';
  readonly extensions = ['.json', '.jsonc', '.json5'];
  readonly globs = ['**/*.json', '**/*.jsonc', '**/*.json5'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-json') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [{ nodeType: 'pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'string' }];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    // Parse top-level and nested key-value pairs
    const pairRegex = /"([^"]+)"\s*:\s*("[^"]*"|\d+(?:\.\d+)?|true|false|null|\{.*?\}|\[.*?\])/g;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(source)) !== null) {
      const preNewlines = source.slice(0, m.index).split('\n').length;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${m[1]}: ${m[2]}`,
        startLine: preNewlines, endLine: preNewlines,
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }
    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
