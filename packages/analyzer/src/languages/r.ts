// @code-analyzer/analyzer — R Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `@eagleoutice/tree-sitter-r`
// package fails to load a usable `Language` object, so a tree-sitter path is
// unreachable dead code. The regex parser below handles function/assignment/
// S4-class/library constructs, plus file-read/environment taint sources and
// os-command/code-injection taint sinks.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TaintSource, TaintSink, TaintSanitizer } from './tree-sitter-base.js';
import { sanitizeSource, lineNumber } from './regex-helpers.js';

const R_EXTENSIONS = ['.r', '.R', '.Rprofile', '.Renviron'];
const R_GLOBS = ['**/*.r', '**/*.R', '**/.Rprofile', '**/.Renviron'];

/** Keywords that must never be emitted as variable-definition captures. */
const R_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'function', 'return', 'library', 'require']);

/** Calls handled by dedicated captures (import/class) that must not also emit FUNCTION_CALL. */
const R_CALL_EXCLUSIONS = new Set(['source', 'setClass', 'setRefClass']);

export class RProvider implements LanguageProvider {
  readonly language = 'r';
  readonly displayName = 'R';
  readonly extensions = R_EXTENSIONS;
  readonly globs = R_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = sanitizeSource(source);
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => lineNumber(sanitized, off);
    let m: RegExpExecArray | null;

    // Function definitions: name <- function(
    const funcRx = /(\w+)\s*<-\s*function\s*\(/g;
    while ((m = funcRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Variable assignments: name <- value
    const varRx = /(\w+)\s*<-\s*[^(]/g;
    while ((m = varRx.exec(sanitized)) !== null) {
      if (R_KEYWORDS.has(m[1]!)) continue;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // S4 class definitions: setClass("Name", ...) / setRefClass("Name", ...)
    const classRx = /set(?:Ref)?Class\s*\(\s*["'](\w+)["']/g;
    while ((m = classRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Imports: library(pkg) / require(pkg)
    const libRx = /(?:library|require)\s*\(\s*["']?(\w+)["']?\s*\)/g;
    while ((m = libRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'library', filePath },
      });
    }

    // Function calls: name(args), excluding keywords and dedicated R constructors
    const callRx = /(\w+)\s*\(/g;
    while ((m = callRx.exec(sanitized)) !== null) {
      const name = m[1]!;
      if (R_KEYWORDS.has(name) || R_CALL_EXCLUSIONS.has(name)) continue;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: name,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name,
        properties: { filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const sanitized = sanitizeSource(source);
    const imports: ParsedImport[] = [];
    const libRx = /(?:library|require|source)\s*\(\s*["']?(\w+(?:\.\w+)*)["']?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = libRx.exec(sanitized)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'named',
        lineNumber: lineNumber(sanitized, m.index),
      });
    }
    return imports;
  }

  isExported(_source: string, _symbolName: string): boolean {
    // R functions are globally visible by default.
    return true;
  }

  /** Flag file-read calls (read.*, Sys.getenv, commandArgs) as taint sources. */
  extractTaintSources(source: string): TaintSource[] {
    const sanitized = sanitizeSource(source);
    const sources: TaintSource[] = [];
    const rx = /(read\.\w+|Sys\.getenv|commandArgs)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(sanitized)) !== null) {
      sources.push({
        name: m[1]!,
        sourceType: 'file_read',
        line: lineNumber(sanitized, m.index),
        text: m[0],
        properties: {},
      });
    }
    return sources;
  }

  /** Flag system/eval/parse calls as os_command or code_injection taint sinks. */
  extractTaintSinks(source: string): TaintSink[] {
    const sanitized = sanitizeSource(source);
    const sinks: TaintSink[] = [];
    const rx = /(system|system2|shell|shell\.exec|eval|parse)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(sanitized)) !== null) {
      const sinkType = ['eval', 'parse'].includes(m[1]!) ? 'code_injection' : 'os_command';
      sinks.push({
        name: m[1]!,
        sinkType,
        line: lineNumber(sanitized, m.index),
        text: m[0],
        properties: {},
      });
    }
    return sinks;
  }

  extractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }
}
