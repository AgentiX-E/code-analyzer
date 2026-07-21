// @code-analyzer/analyzer — Java Language Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import {
  lineNumberAt,
  findBlockEnd,
  extractClassLike,
  extractFunctions,
  extractCalls,
  extractVariables,
  extractAnnotations,
  extractDocComments,
  extractImportsAsCaptures,
} from './base-c-like.js';

const JAVA_EXTENSIONS = ['.java'];
const JAVA_GLOBS = ['**/*.java'];

const JAVA_RESERVED: ReadonlySet<string> = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'null', 'package', 'private', 'protected', 'public', 'return',
  'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while',
  'var', 'record', 'sealed', 'permits', 'yield', 'module', 'requires',
  'exports', 'opens', 'to', 'uses', 'provides', 'with', 'transitive',
]);

export class JavaProvider implements LanguageProvider {
  readonly language = 'java';
  readonly displayName = 'Java';
  readonly extensions = JAVA_EXTENSIONS;
  readonly globs = JAVA_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    // Classes, interfaces, enums, records
    extractClassLike(source, filePath, captures, 'class', CAPTURE_TAGS.CLASS_DEF, ['public', 'private', 'protected', 'static', 'final', 'abstract']);
    extractClassLike(source, filePath, captures, 'interface', CAPTURE_TAGS.INTERFACE_DEF, ['public', 'private', 'protected']);
    extractClassLike(source, filePath, captures, 'enum', CAPTURE_TAGS.ENUM_DEF, ['public', 'private', 'protected']);
    this.extractRecords(source, filePath, captures);

    // Methods
    this.extractMethods(source, filePath, captures);

    // Fields
    extractVariables(source, filePath, captures, ['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'String', 'Object', 'List', 'Map', 'Set'], JAVA_RESERVED);

    // Field declarations (private String name;)
    this.extractFields(source, filePath, captures);

    // Annotations
    extractAnnotations(source, filePath, captures, '@');

    // Method calls
    extractCalls(source, filePath, captures, JAVA_RESERVED);

    // Imports
    extractImportsAsCaptures(source, filePath, captures, (s) => this.extractImports(s));

    // Doc comments
    extractDocComments(source, filePath, captures, /\/\*\*([\s\S]*?)\*\//g);

    // Sort by line
    captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
    return captures;
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    // import java.util.List;
    const singleRegex = /import\s+(?:static\s+)?([\w.]+)(?:\.(\*))?\s*;/g;
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
    const patterns = [
      new RegExp(`public\\s+(?:class|interface|enum|record)\\s+${symbolName}\\b`),
      new RegExp(`public\\s+(?:static\\s+)?(?:final\\s+)?\\w+\\s+${symbolName}\\b`),
      new RegExp(`public\\s+(?:static\\s+)?\\w+(?:<[^>]*>)?\\s+${symbolName}\\s*\\(`),
    ];
    return patterns.some((p) => p.test(source));
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private extractMethods(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Method declarations: public static void methodName(...) { }
    const methodRegex = /(?:(?:public|private|protected|static|abstract|final|synchronized|native)\s+)*(\w+(?:<[^>]*>)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w\s,]+)?\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = methodRegex.exec(source)) !== null) {
      const retType = match[1]!;
      const name = match[2]!;
      if (JAVA_RESERVED.has(name)) continue;
      if (['if', 'while', 'for', 'switch', 'catch', 'synchronized'].includes(name)) continue;

      const startLine = lineNumberAt(source, match.index);
      const endLine = findBlockEnd(source, match.index + match[0].indexOf('{'));

      // Check if this is inside a class (constructor detection)
      const precedingText = source.slice(Math.max(0, match.index - 200), match.index);
      const classMatch = precedingText.match(/class\s+(\w+)/);
      const containerName = classMatch ? classMatch[1]! : undefined;

      const tag = name === containerName ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF;

      captures.push({
        tag,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        containerName,
        properties: {
          returnType: retType,
          parameterCount: String(match[3] ? match[3].split(',').filter(p => p.trim().length > 0).length : 0),
          static: String(match[0].includes('static')),
          filePath,
        },
      });
    }
  }

  private extractFields(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Field declarations: private String name;
    const fieldRegex = /(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:final\s+)?(\w+(?:<[^>]*>)?)\s+(\w+)\s*(?:=\s*[^;]+)?\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = fieldRegex.exec(source)) !== null) {
      const fieldType = match[1]!;
      const name = match[2]!;
      if (JAVA_RESERVED.has(name)) continue;
      if (name.length < 2) continue;
      const line = lineNumberAt(source, match.index);

      captures.push({
        tag: match[0].includes('final') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
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
    const recordRegex = /(?:public\s+)?record\s+(\w+)\s*\(/g;
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

}
