// @code-analyzer/analyzer — Groovy Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class GroovyProvider extends TreeSitterBaseProvider {
  readonly language = 'groovy';
  readonly displayName = 'Groovy';
  readonly extensions = ['.groovy', '.gvy', '.gy', '.gsh'];
  readonly globs = ['**/*.groovy', '**/*.gvy', '**/*.gy', '**/*.gsh'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-groovy') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'method_declaration', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'identifier' },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Class definitions: class Name { ... }
    const classRegex = /(?:abstract\s+)?class\s+(\w+)/g;
    while ((m = classRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]}`,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // Groovy trait definitions
    const traitRegex = /trait\s+(\w+)/g;
    while ((m = traitRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.TRAIT_DEF, text: `trait ${m[1]}`,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // Method/function definitions: def name(params) or returnType name(params)
    const funcRegex = /(?:def\s+|(?:void|int|String|boolean|def|Object)\s+)(\w+)\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { filePath },
      });
    }

    // Closures: { param -> ... }
    const closureRegex = /\{\s*(?:\w+\s*(?:,\s*\w+)*\s*->)?/g;
    let closureCount = 0;
    while ((m = closureRegex.exec(source)) !== null) {
      closureCount++;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF, text: `closure_${closureCount}`,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: `closure_${closureCount}`, properties: { isClosure: 'true', filePath },
      });
    }

    // Import statements
    const importRegex = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { importType: 'named', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const importRegex = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!.split('.').pop()!], type: 'named', lineNumber: this.ln(source, m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true; // Groovy uses def/class at top level = visible
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
