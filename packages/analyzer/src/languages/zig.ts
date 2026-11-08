// @code-analyzer/analyzer — Zig Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `tree-sitter-zig` package only
// ships `nodeTypeInfo` metadata (no compiled `Language` object), so a
// tree-sitter path is unreachable dead code — `Parser.setLanguage()` throws
// "Invalid language object". The regex parser below is the complete, tested
// implementation.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { OVERLONG_LINE_BUDGET, maskOverlongLines } from './line-index.js';
import { captureRegexCallSites } from './regex-calls.js';
import { captureDocComments, sanitizeSource, lineNumber } from './regex-helpers.js';

import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const ZIG_EXTENSIONS = ['.zig'];
const ZIG_GLOBS = ['**/*.zig'];

/**
 * The names a Zig call scanner must not read as a callee: the control flow that opens a parenthesis, and the builtins
 * the language resolves itself.
 */
const ZIG_CALL_SKIP = new Set([
  'if',
  'while',
  'for',
  'switch',
  'catch',
  'return',
  'orelse',
  'and',
  'or',
  'test',
  'comptime',
  'pub',
]);

export class ZigProvider implements LanguageProvider {
  readonly language = 'zig';
  readonly displayName = 'Zig';
  readonly extensions = ZIG_EXTENSIONS;
  readonly globs = ZIG_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = maskOverlongLines(sanitizeSource(source), OVERLONG_LINE_BUDGET).text;
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Function declarations: [pub] fn name
    const funcRegex = /(?:pub\s+)?fn\s+(\w+)/g;
    while ((m = funcRegex.exec(sanitized)) !== null) {
      const isPub = m[0].startsWith('pub');
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isPublic: String(isPub), filePath },
      });
    }

    // Struct declarations: [pub] const Name = struct
    const structRegex = /(?:pub\s+)?const\s+(\w+)\s*=\s*struct\b/g;
    while ((m = structRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.STRUCT_DEF,
        text: `struct ${m[1]!}`,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Enum declarations: [pub] const Name = enum
    const enumRegex = /(?:pub\s+)?const\s+(\w+)\s*=\s*enum\b/g;
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

    // @import statements: @import("path")
    const importRegex = /@import\s*\(\s*"([^"]+)"\s*\)/g;
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

    // const declarations (immutable variables): const name = ...
    const constRegex = /const\s+(\w+)\s*=/g;
    while ((m = constRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // var declarations (mutable variables): var name [:Type] = ...
    const varRegex = /var\s+(\w+)\s*(?::[^=]+)?\s*=/g;
    while ((m = varRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: lineNumber(sanitized, m.index),
        endLine: lineNumber(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isMutable: 'true', filePath },
      });
    }

    // Doc comments: `///` is the only documentation form the language has.
    captures.push(...captureDocComments(source, filePath, ['///'], captures));

    // Call sites. **`@import` is skipped rather than claimed**: a builtin is not a function the checkout declares, and
    // the scanner is told so by the `@` it finds in front of the callee.
    captures.push(
      ...captureRegexCallSites(sanitized, {
        filePath,
        skip: ZIG_CALL_SKIP,
      }),
    );

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const sanitized = sanitizeSource(source);
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const importRegex = /@import\s*\(\s*"([^"]+)"\s*\)/g;
    while ((m = importRegex.exec(sanitized)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'named',
        lineNumber: lineNumber(sanitized, m.index),
      });
    }
    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`pub\\s+(?:fn|const|var)\\s+${s}\\b`).test(source);
  }
}
