// @code-analyzer/analyzer — Kotlin Language Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import {
  lineNumberAt,
  findBlockEnd,
  extractClassLike,
  extractAnnotations,
  extractDocComments,
} from './base-c-like.js';

const KOTLIN_EXTENSIONS = ['.kt', '.kts'];
const KOTLIN_GLOBS = ['**/*.kt', '**/*.kts'];

const KOTLIN_RESERVED: ReadonlySet<string> = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun',
  'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return',
  'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val',
  'var', 'when', 'while', 'by', 'catch', 'constructor', 'delegate',
  'dynamic', 'field', 'file', 'finally', 'get', 'import', 'init', 'param',
  'property', 'receiver', 'set', 'setparam', 'where', 'actual', 'expect',
  'abstract', 'annotation', 'companion', 'const', 'crossinline', 'data',
  'enum', 'external', 'final', 'infix', 'inline', 'inner', 'internal',
  'lateinit', 'noinline', 'open', 'operator', 'out', 'override', 'private',
  'protected', 'public', 'reified', 'sealed', 'suspend', 'tailrec',
  'vararg', 'it',
]);

export class KotlinProvider implements LanguageProvider {
  readonly language = 'kotlin';
  readonly displayName = 'Kotlin';
  readonly extensions = KOTLIN_EXTENSIONS;
  readonly globs = KOTLIN_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    // Classes, interfaces, objects, data classes, sealed classes, enums
    extractClassLike(source, filePath, captures, 'class', CAPTURE_TAGS.CLASS_DEF, ['data', 'sealed', 'abstract', 'open', 'inner', 'private', 'internal']);
    extractClassLike(source, filePath, captures, 'interface', CAPTURE_TAGS.INTERFACE_DEF);
    this.extractObjects(source, filePath, captures);
    extractClassLike(source, filePath, captures, 'enum class', CAPTURE_TAGS.ENUM_DEF);

    // Functions
    this.extractKotlinFunctions(source, filePath, captures);

    // Properties (val/var)
    this.extractProperties(source, filePath, captures);

    // Function calls
    this.extractKotlinCalls(source, filePath, captures);

    // Annotations
    extractAnnotations(source, filePath, captures, '@');

    // Imports
    this.extractImportsAsCaptures(source, filePath, captures);

    // Doc comments (KDoc)
    extractDocComments(source, filePath, captures, /\/\*\*([\s\S]*?)\*\//g);

    // Sort by line
    captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
    return captures;
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    // import kotlin.collections.List
    const singleRegex = /import\s+([\w.]+)(?:\.(\*))?\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = singleRegex.exec(source)) !== null) {
      const fullPath = match[1]!;
      const isWildcard = match[2] === '*';
      const parts = fullPath.split('.');
      const name = parts[parts.length - 1]!;

      imports.push({
        source: fullPath,
        names: isWildcard ? [] : [name],
        type: isWildcard ? 'wildcard' : 'named',
        lineNumber: lineNumberAt(source, match.index),
      });
    }
    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    // In Kotlin, top-level declarations are public by default
    const patterns = [
      new RegExp(`(?:class|interface|object|fun|val|var)\\s+${symbolName}\\b`),
    ];
    return patterns.some((p) => p.test(source));
  }

  // ── Private Helpers ──

  private extractKotlinFunctions(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // fun functionName(...): ReturnType { }
    // fun ReceiverType.functionName(...): ReturnType { } — extension function
    const funcRegex = /(?:(?:private|internal|protected|public|override|open|abstract|suspend|inline|operator|infix|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w+(?:<[^>]*>)?))?\s*(?:\{|$)/gm;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (KOTLIN_RESERVED.has(name)) continue;

      const startLine = lineNumberAt(source, match.index);
      const hasBlock = match[0].includes('{');
      const endLine = hasBlock ? findBlockEnd(source, match.index + match[0].indexOf('{')) : startLine;

      // Detect container (class/object context)
      const precedingText = source.slice(Math.max(0, match.index - 500), match.index);
      const classMatch = precedingText.match(/(?:class|object)\s+(\w+)/g);
      const containerName = classMatch ? classMatch[classMatch.length - 1]!.split(/\s+/)[1] : undefined;

      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        containerName,
        properties: {
          returnType: match[3] ?? 'Unit',
          parameterCount: String(match[2] ? match[2].split(',').filter(p => p.trim().length > 0).length : 0),
          suspend: String(match[0].includes('suspend')),
          filePath,
        },
      });
    }
  }

  private extractProperties(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // val/var propertyName: Type = value
    const propRegex = /(?:(?:private|internal|protected|public|override|open|abstract|lateinit|const)\s+)*(val|var)\s+(\w+)\s*(?::\s*(\w+(?:<[^>]*>)?))?\s*(?:=\s*[^\n]+)?\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = propRegex.exec(source)) !== null) {
      const kind = match[1]!; // val or var
      const name = match[2]!;
      if (KOTLIN_RESERVED.has(name)) continue;
      if (name.length < 2) continue;
      const line = lineNumberAt(source, match.index);

      captures.push({
        tag: kind === 'val' ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
        text: name,
        startLine: line,
        endLine: line,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { propertyType: match[3] ?? 'Any', mutable: String(kind === 'var'), filePath },
      });
    }
  }

  private extractKotlinCalls(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Function/method calls: name(...) or obj.name(...)
    const callRegex = /(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (KOTLIN_RESERVED.has(name)) continue;
      if (/^[A-Z]/.test(name) && name === name.toUpperCase()) continue;
      const startLine = lineNumberAt(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: name,
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractObjects(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // object MyObject { }, companion object { }
    const objRegex = /(?:companion\s+)?object\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = objRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `object ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { isObject: 'true', isCompanion: String(match[0].includes('companion')), filePath },
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
}
