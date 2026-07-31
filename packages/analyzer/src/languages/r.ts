// @code-analyzer/analyzer — R Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class RProvider extends TreeSitterBaseProvider {
  readonly language = 'r';
  readonly displayName = 'R';
  readonly extensions = ['.r', '.R', '.Rprofile', '.Renviron'];
  readonly globs = ['**/*.r', '**/*.R', '**/.Rprofile', '**/.Renviron'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-r') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Function definitions: name <- function(params) { ... }
    const funcRegex = /(\w+)\s*<-\s*function\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // Variable assignments: name <- value or name = value
    const varRegex = /(\w+)\s*<-\s*[^(]/g;
    while ((m = varRegex.exec(source)) !== null) {
      if (['if', 'else', 'for', 'while', 'function', 'return'].includes(m[1]!)) continue;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // S3/S4 class definitions: setClass("Name", ...)
    const classRegex = /setClass\s*\(\s*["'](\w+)["']/g;
    while ((m = classRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // library() and require() imports
    const libRegex = /(?:library|require)\s*\(\s*["']?(\w+)["']?\s*\)/g;
    while ((m = libRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { importType: 'library', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const libRegex = /(?:library|require)\s*\(\s*["']?(\w+)["']?\s*\)/g;
    while ((m = libRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: this.ln(source, m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true; // R functions are globally visible by default
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
