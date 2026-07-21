// @code-analyzer/analyzer — C# Language Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import {
  lineNumberAt,
  findBlockEnd,
  extractClassLike,
  extractAnnotations,
  extractDocComments,
  extractImportsAsCaptures,
} from './base-c-like.js';

const CSHARP_EXTENSIONS = ['.cs'];
const CSHARP_GLOBS = ['**/*.cs'];

const CSHARP_RESERVED: ReadonlySet<string> = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch',
  'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default',
  'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit',
  'extern', 'false', 'finally', 'fixed', 'float', 'for', 'foreach',
  'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal',
  'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator',
  'out', 'override', 'params', 'private', 'protected', 'public',
  'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof',
  'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe',
  'ushort', 'using', 'var', 'virtual', 'void', 'volatile', 'while',
  'record', 'init', 'required', 'global', 'file', 'nint', 'nuint',
  'dynamic', 'async', 'await', 'nameof', 'when', 'where', 'yield',
]);

export class CSharpProvider implements LanguageProvider {
  readonly language = 'csharp';
  readonly displayName = 'C#';
  readonly extensions = CSHARP_EXTENSIONS;
  readonly globs = CSHARP_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    // Classes, structs, interfaces, enums, records
    extractClassLike(source, filePath, captures, 'class', CAPTURE_TAGS.CLASS_DEF, ['public', 'private', 'internal', 'protected', 'static', 'abstract', 'sealed', 'partial']);
    extractClassLike(source, filePath, captures, 'struct', CAPTURE_TAGS.CLASS_DEF, ['public', 'private', 'internal', 'protected', 'readonly', 'ref']);
    extractClassLike(source, filePath, captures, 'interface', CAPTURE_TAGS.INTERFACE_DEF, ['public', 'private', 'internal', 'protected']);
    extractClassLike(source, filePath, captures, 'enum', CAPTURE_TAGS.ENUM_DEF, ['public', 'private', 'internal', 'protected']);
    this.extractRecords(source, filePath, captures);

    // Methods
    this.extractMethods(source, filePath, captures);

    // Properties
    this.extractProperties(source, filePath, captures);

    // Fields
    this.extractFields(source, filePath, captures);

    // Attributes (using [Attribute] syntax)
    this.extractCSharpAttributes(source, filePath, captures);

    // Method calls
    this.extractCalls(source, filePath, captures);

    // Using directives (imports)
    extractImportsAsCaptures(source, filePath, captures, (s) => this.extractImports(s));

    // Doc comments (///)
    extractDocComments(source, filePath, captures, /\/\/\/\s*<summary>([\s\S]*?)<\/summary>/g);
    extractDocComments(source, filePath, captures, /\/\*\*([\s\S]*?)\*\//g);

    // Sort by line
    captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
    return captures;
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    // using System.Collections.Generic;
    const usingRegex = /using\s+(?:static\s+)?([\w.]+)(?:\s*=\s*[\w.]+)?\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = usingRegex.exec(source)) !== null) {
      const fullPath = match[1]!;
      const parts = fullPath.split('.');
      const name = parts[parts.length - 1]!;

      imports.push({
        source: fullPath,
        names: [name],
        type: 'named',
        lineNumber: lineNumberAt(source, match.index),
      });
    }
    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    const patterns = [
      new RegExp(`public\\s+(?:class|struct|interface|enum|record)\\s+${symbolName}\\b`),
      new RegExp(`public\\s+(?:static\\s+)?(?:virtual\\s+)?(?:override\\s+)?(?:async\\s+)?\\w+(?:<[^>]*>)?\\s+${symbolName}\\s*[({]`),
      new RegExp(`public\\s+(?:static\\s+)?(?:readonly\\s+)?\\w+\\s+${symbolName}\\b`),
    ];
    return patterns.some((p) => p.test(source));
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private extractCSharpAttributes(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // C# attributes: [HttpGet], [Authorize(Roles = "Admin")]
    const attrRegex = /\[(\w+)(?:\([\s\S]*?\))?\]/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: match[0],
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { decorator: name, filePath },
      });
    }
  }

  private extractMethods(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Method declarations: public static async Task<Result> MethodName(...) { }
    const methodRegex = /(?:(?:public|private|internal|protected|static|abstract|virtual|override|async|sealed|partial|unsafe|extern)\s+)*(\w+(?:<[^>]*>)?)\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:where\s+[\s\S]*?)?\s*(?:\{|=>|;)/g;
    let match: RegExpExecArray | null;
    while ((match = methodRegex.exec(source)) !== null) {
      const retType = match[1]!;
      const name = match[2]!;
      if (CSHARP_RESERVED.has(name)) continue;
      if (['if', 'while', 'for', 'foreach', 'switch', 'lock', 'using', 'fixed'].includes(name)) continue;

      const startLine = lineNumberAt(source, match.index);
      const hasBlock = match[0].includes('{');
      const endLine = hasBlock ? findBlockEnd(source, match.index + match[0].indexOf('{')) : startLine;

      // Detect constructor (method name matches class name)
      const precedingText = source.slice(Math.max(0, match.index - 500), match.index);
      const classMatch = precedingText.match(/(?:class|struct|record)\s+(\w+)/g);
      const className = classMatch ? classMatch[classMatch.length - 1]!.split(/\s+/)[1] : undefined;

      const isConstructor = name === className;
      const tag = isConstructor ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF;

      captures.push({
        tag,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        containerName: className,
        properties: {
          returnType: isConstructor ? '' : retType,
          parameterCount: String(match[3] ? match[3].split(',').filter(p => p.trim().length > 0).length : 0),
          static: String(match[0].includes('static')),
          async: String(match[0].includes('async')),
          filePath,
        },
      });
    }
  }

  private extractProperties(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Property declarations: public string Name { get; set; }
    const propRegex = /(?:(?:public|private|internal|protected|static|virtual|override|abstract|required)\s+)*(\w+(?:<[^>]*>)?)\s+(\w+)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = propRegex.exec(source)) !== null) {
      const propType = match[1]!;
      const name = match[2]!;
      if (CSHARP_RESERVED.has(name)) continue;
      if (['get', 'set', 'init', 'add', 'remove'].includes(name)) continue;
      if (name.length < 2) continue;
      const line = lineNumberAt(source, match.index);
      const body = source.slice(match.index, match.index + 200);
      const hasGet = body.includes('get;') || body.includes('get ');
      const hasSet = body.includes('set;') || body.includes('set ');

      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: name,
        startLine: line,
        endLine: line,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { propertyType: propType, hasGet: String(hasGet), hasSet: String(hasSet), filePath },
      });
    }
  }

  private extractFields(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Field declarations: private readonly int _count;
    const fieldRegex = /(?:(?:public|private|internal|protected|static|readonly|const)\s+)*(\w+(?:<[^>]*>)?)\s+(_?\w+)\s*(?:=\s*[^;]+)?\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = fieldRegex.exec(source)) !== null) {
      const fieldType = match[1]!;
      const name = match[2]!;
      if (CSHARP_RESERVED.has(name)) continue;
      if (name.length < 2) continue;
      const line = lineNumberAt(source, match.index);

      captures.push({
        tag: match[0].includes('const') || match[0].includes('readonly') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
        text: name,
        startLine: line,
        endLine: line,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { fieldType, filePath },
      });
    }
  }

  private extractRecords(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // record MyRecord(string Name, int Age);
    // record class MyRecord { }
    // record struct MyStruct { }
    const recordRegex = /(?:public\s+)?(?:sealed\s+)?record\s+(?:class|struct)?\s*(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = recordRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `record ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { isRecord: 'true', filePath },
      });
    }
  }

  private extractCalls(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const callRegex = /(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (CSHARP_RESERVED.has(name)) continue;
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

}
