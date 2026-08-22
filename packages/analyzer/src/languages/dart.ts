// @code-analyzer/analyzer — Dart Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `tree-sitter-dart` package only
// ships `nodeTypeInfo` metadata (no compiled `Language` object), so a
// tree-sitter path is unreachable dead code — `Parser.setLanguage()` throws
// "Invalid language object". The regex parser below is the complete, tested
// implementation.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import { sanitizeSource, lineNumber } from './regex-helpers.js';

const DART_EXTENSIONS = ['.dart'];
const DART_GLOBS = ['**/*.dart'];

/** Keyword identifiers that a function-definition regex must never match. */
const DART_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return']);

export class DartProvider implements LanguageProvider {
  readonly language = 'dart';
  readonly displayName = 'Dart';
  readonly extensions = DART_EXTENSIONS;
  readonly globs = DART_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = sanitizeSource(source);
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Class definitions: [abstract] class Name
    const classRegex = /(?:abstract\s+)?class\s+(\w+)/g;
    while ((m = classRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Mixin definitions: mixin Name
    const mixinRegex = /mixin\s+(\w+)/g;
    while ((m = mixinRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `mixin ${m[1]!}`,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Enum definitions: enum Name
    const enumRegex = /enum\s+(\w+)/g;
    while ((m = enumRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${m[1]!}`,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Function definitions (block body): [ReturnType] name(params) [async] {
    const funcRegex =
      /(?:(?:void|int|String|bool|double|num|dynamic|Future|Widget|List|Map|Set)\s+)?(\w+)\s*\([^)]*\)\s*(?:async\s*)?\{/g;
    while ((m = funcRegex.exec(sanitized)) !== null) {
      const name = m[1]!;
      if (DART_KEYWORDS.has(name)) continue;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name,
        properties: { filePath },
      });
    }

    // Arrow functions: [ReturnType] name(params) => expression
    const arrowRegex = /(?:\w+(?:<[^>]*>)?\s+)?(\w+)\s*\([^)]*\)\s*=>/g;
    while ((m = arrowRegex.exec(sanitized)) !== null) {
      const name = m[1]!;
      if (DART_KEYWORDS.has(name)) continue;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name,
        properties: { filePath },
      });
    }

    // Import statements: import 'package:...';
    const importRegex = /import\s+['"]([^'"]+)['"]/g;
    while ((m = importRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'named', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const sanitized = sanitizeSource(source);
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const importRegex = /import\s+['"]([^'"]+)['"]/g;
    while ((m = importRegex.exec(sanitized)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!.split('/').pop()!.replace('.dart', '')],
        type: 'named',
        lineNumber: lineNumber(sanitized, m.index),
      });
    }
    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    // Dart symbols starting with an underscore are library-private.
    if (symbolName.startsWith('_')) return false;
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:class|mixin|enum)\\s+${s}\\b|\\b${s}\\s*\\(`).test(source);
  }
}
