// @code-analyzer/analyzer — Lua Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `tree-sitter-lua` package only
// ships `nodeTypeInfo` metadata (no compiled `Language` object), so a
// tree-sitter path is unreachable dead code — `Parser.setLanguage()` throws
// "Invalid language object". The regex parser below is the complete, tested
// implementation.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { captureRegexCallSites } from './regex-calls.js';
import { captureDocComments } from './regex-helpers.js';

import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const LUA_EXTENSIONS = ['.lua'];
const LUA_GLOBS = ['**/*.lua'];

/**
 * The names a Lua call scanner must not read as a callee.
 *
 * **`function` is the one that matters**: Lua writes a method as `function Widget.draw(self)`, and a scanner that took
 * the parenthesis would file every declaration as a call to the last segment of its own name.
 */
const LUA_CALL_SKIP = new Set([
  'if',
  'elseif',
  'while',
  'for',
  'return',
  'local',
  'repeat',
  'until',
  'do',
  'then',
  'end',
  'and',
  'or',
  'not',
  'print',
]);

export class LuaProvider implements LanguageProvider {
  readonly language = 'lua';
  readonly displayName = 'Lua';
  readonly extensions = LUA_EXTENSIONS;
  readonly globs = LUA_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = sanitizeSource(source);
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Function definitions: function name(...) or local function name(...)
    const funcRegex = /(?:local\s+)?function\s+([\w:.]+)\s*\(/g;
    while ((m = funcRegex.exec(sanitized)) !== null) {
      const isLocal = sanitized.slice(m.index, m.index + m[0].length).includes('local');
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: ln(sanitized, m.index),
        endLine: ln(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isLocal: String(isLocal), filePath },
      });
    }

    // Table-based function: function table.method(...) or function table:method(...)
    const tableFuncRegex = /function\s+([\w.]+)[.:](\w+)\s*\(/g;
    while ((m = tableFuncRegex.exec(sanitized)) !== null) {
      const fullName = `${m[1]!}.${m[2]!}`;
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: fullName,
        startLine: ln(sanitized, m.index),
        endLine: ln(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: fullName,
        containerName: m[1]!,
        properties: { filePath },
      });
    }

    // Require statements
    const requireRegex = /require\s*\(?\s*["']([^"']+)["']\s*\)?/g;
    while ((m = requireRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: ln(sanitized, m.index),
        endLine: ln(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'named', filePath },
      });
    }

    // Variable assignments: local name = value
    const localVarRegex = /local\s+(\w+)\s*=/g;
    while ((m = localVarRegex.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: ln(sanitized, m.index),
        endLine: ln(sanitized, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isLocal: 'true', filePath },
      });
    }

    // Doc comments: `--` above a declaration is how Lua documents itself, and it is the only comment form there is.
    captures.push(...captureDocComments(source, filePath, ['--'], captures));

    // Call sites, which this provider emitted none of while the matrix claimed the row.
    captures.push(
      ...captureRegexCallSites(sanitized, {
        filePath,
        skip: LUA_CALL_SKIP,
      }),
    );

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const sanitized = sanitizeSource(source);
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const requireRegex = /require\s*\(?\s*["']([^"']+)["']\s*\)?/g;
    while ((m = requireRegex.exec(sanitized)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'named',
        lineNumber: ln(sanitized, m.index),
      });
    }
    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`local\\s+function\\s+${s}\\b`).test(source)) return false;
    return new RegExp(`function\\s+${s}\\b`).test(source);
  }
}

/** Normalize input: strip BOM + zero-width chars, normalize line endings to LF. */
function sanitizeSource(source: string): string {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B\u200C\u200D]/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/** 1-based line number for a byte offset. */
function ln(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}
