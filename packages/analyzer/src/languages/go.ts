// @code-analyzer/analyzer — Go Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';


function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

const goExtensions = ['.go'];
const goGlobs = ['**/*.go'];

const GO_RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
  'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import',
  'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
  'switch', 'type', 'var',
]);

export class GoProvider implements LanguageProvider {
  readonly language = 'go';
  readonly displayName = 'Go';
  readonly extensions = goExtensions;
  readonly globs = goGlobs;
  readonly importSemantics = 'wildcard-leaf' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    this.extractFunctions(source, filePath, captures);
    this.extractStructs(source, filePath, captures);
    this.extractInterfaces(source, filePath, captures);
    this.extractImportsAsCaptures(source, filePath, captures);
    this.extractPackages(source, filePath, captures);
    this.extractVariables(source, filePath, captures);

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Single imports: import "path"
    const singleImportRegex = /import\s+"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = singleImportRegex.exec(source)) !== null) {
      imports.push({
        source: match[1]!,
        names: [match[1]!.split('/').pop() ?? match[1]!],
        type: 'named',
        lineNumber: lineNumberAt(source, match.index),
      });
    }

    // Named imports: import alias "path"
    const namedImportRegex = /import\s+(\w+)\s+"([^"]+)"/g;
    while ((match = namedImportRegex.exec(source)) !== null) {
      imports.push({
        source: match[2]!,
        names: [match[1]!],
        type: 'namespace',
        lineNumber: lineNumberAt(source, match.index),
      });
    }

    // Multi-line imports: import ( ... )
    const multiImportRegex = /import\s*\(([\s\S]*?)\)/g;
    while ((match = multiImportRegex.exec(source)) !== null) {
      const body = match[1]!;
      const lineRegex = /(?:(\w+)\s+)?"([^"]+)"/g;
      let innerMatch: RegExpExecArray | null;
      while ((innerMatch = lineRegex.exec(body)) !== null) {
        const alias = innerMatch[1] ?? innerMatch[2]!.split('/').pop() ?? innerMatch[2]!;
        imports.push({
          source: innerMatch[2]!,
          names: [alias],
          type: innerMatch[1] ? 'namespace' : 'named',
          lineNumber: lineNumberAt(source, match.index),
        });
      }
    }

    return imports;
  }

  isExported(_source: string, symbolName: string): boolean {
    // In Go, exported symbols start with uppercase
    if (symbolName.length === 0) return false;
    return symbolName[0] === symbolName[0]!.toUpperCase() && symbolName[0] !== symbolName[0].toLowerCase();
  }

  // --- Private extraction helpers ---

  private extractFunctions(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Regular functions: func Name(...)
    const funcRegex = /func\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (GO_RESERVED_KEYWORDS.has(name)) continue;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { exported: String(this.isExported(source, name)), filePath },
      });
    }

    // Methods: func (r Receiver) Name(...)
    const methodRegex = /func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(/g;
    while ((match = methodRegex.exec(source)) !== null) {
      const receiverName = match[1]!;
      const receiverType = match[2]!;
      const methodName = match[3]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: methodName,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: methodName,
        containerName: receiverType,
        properties: { receiver: receiverName, receiverType, filePath },
      });
    }
  }

  private extractStructs(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const structRegex = /type\s+(\w+)\s+struct\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = structRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.STRUCT_DEF,
        text: `struct ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractInterfaces(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const interfaceRegex = /type\s+(\w+)\s+interface\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = interfaceRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractPackages(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const packageRegex = /^package\s+(\w+)/m;
    const match = packageRegex.exec(source);
    if (match) {
      const name = match[1]!;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `package ${name}`,
        startLine: lineNumberAt(source, match.index),
        endLine: lineNumberAt(source, match.index),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractVariables(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // var declarations at package level
    const varRegex = /var\s+(\w+)\s+/g;
    let match: RegExpExecArray | null;
    while ((match = varRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (GO_RESERVED_KEYWORDS.has(name)) continue;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: name,
        startLine: lineNumberAt(source, match.index),
        endLine: lineNumberAt(source, match.index),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }

    // const declarations
    const constRegex = /const\s+(\w+)\s+/g;
    while ((match = constRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (GO_RESERVED_KEYWORDS.has(name)) continue;
      captures.push({
        tag: CAPTURE_TAGS.CONSTANT_DEF,
        text: name,
        startLine: lineNumberAt(source, match.index),
        endLine: lineNumberAt(source, match.index),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractImportsAsCaptures(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const parsedImports = this.extractImports(source);
    for (const imp of parsedImports) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: imp.source,
        startLine: imp.lineNumber,
        endLine: imp.lineNumber,
        startByte: 0,
        endByte: 0,
        name: imp.source,
        properties: { names: imp.names.join(','), importType: imp.type, filePath },
      });
    }
  }

  private findBlockEnd(source: string, startOffset: number): number {
    const slice = source.slice(startOffset);
    const openPos = slice.indexOf('{');
    if (openPos === -1) return lineNumberAt(source, startOffset);

    let depth = 0;
    let inString: string | null = null;
    let inLineComment = false;

    for (let i = openPos; i < slice.length; i++) {
      const ch = slice[i]!;
      const prev = i > 0 ? slice[i - 1] : '';

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }

      if (inString) {
        if (ch === inString && prev !== '\\') inString = null;
        continue;
      }

      if (prev === '/' && ch === '/') { inLineComment = true; continue; }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0) return lineNumberAt(source, startOffset + i);
        depth--;
      }
    }

    return lineNumberAt(source, source.length);
  }
}
