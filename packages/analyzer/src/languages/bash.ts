// @code-analyzer/analyzer — Bash/Shell Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class BashProvider extends TreeSitterBaseProvider {
  readonly language = 'bash';
  readonly displayName = 'Bash/Shell';
  readonly extensions = ['.sh', '.bash', '.zsh', '.ksh'];
  readonly globs = ['**/*.sh', '**/*.bash', '**/*.zsh', '**/*.ksh'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-bash') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'word' },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Function definitions: function_name() { ... } or function name { ... }
    const funcRegex = /(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // Variable assignments: NAME=VALUE or export NAME=VALUE
    const varRegex = /(?:export\s+|local\s+|readonly\s+)?(\w+)=/g;
    while ((m = varRegex.exec(source)) !== null) {
      if (['if', 'for', 'while', 'case', 'select'].includes(m[1]!)) continue;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // Source/import: source file.sh or . file.sh
    const srcRegex = /(?:source|\.)\s+["']?([\w./-]+)["']?/g;
    while ((m = srcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { importType: 'source', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const srcRegex = /(?:source|\.)\s+["']?([\w./-]+)["']?/g;
    while ((m = srcRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: this.ln(source, m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true; // Shell functions are globally visible by default
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
