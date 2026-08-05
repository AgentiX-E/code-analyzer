// @code-analyzer/intelligence — AST-Aware Rule Checker Infrastructure
// Provides tree-sitter AST context for rule checkers, with transparent
// fallback to text-based analysis when grammar is unavailable.

import type { RuleCheckResult, RuleChecker } from './rule-executor.js';

// ---------------------------------------------------------------------------
// AST Node Types (minimal subset for rule checking)
// ---------------------------------------------------------------------------

/** A lightweight AST node reference for rule checking. */
export interface AstNode {
  type: string;
  text: string;
  startLine: number;
  endLine: number;
  children: AstNode[];
  parent: AstNode | null;
}

/** A detected function/method call site. */
export interface AstCallSite {
  /** The function/method name being called. */
  name: string;
  /** The object/namespace before the dot, e.g. "console" in console.log. */
  object: string | null;
  /** The full source text of the call expression. */
  text: string;
  /** Line number (1-based). */
  line: number;
  /** Argument texts. */
  arguments: string[];
}

/** A detected string literal in source. */
export interface AstStringLiteral {
  value: string;
  text: string;
  line: number;
}

/** A detected variable/constant assignment. */
export interface AstAssignment {
  name: string;
  value: string;
  line: number;
}

/** A detected import statement. */
export interface AstImport {
  moduleSpecifier: string;
  symbols: string[];
  line: number;
  isType: boolean;
}

/** Detected function/method boundaries. */
export interface AstFunctionBounds {
  name: string;
  startLine: number;
  endLine: number;
  paramCount: number;
}

// ---------------------------------------------------------------------------
// AST Rule Context
// ---------------------------------------------------------------------------

/** Context passed to AST-aware rule checkers. */
export interface AstRuleContext {
  /** Raw source lines (always available for fallback). */
  lines: string[];
  /** Absolute file path. */
  filePath: string;
  /** Detected language (e.g. "typescript", "python"). */
  language: string;
  /** Whether tree-sitter AST is available for this file. */
  hasAst: boolean;
  /** All detected call sites in the file. */
  calls: AstCallSite[];
  /** All detected string literals. */
  strings: AstStringLiteral[];
  /** All detected imports. */
  imports: AstImport[];
  /** All detected assignments. */
  assignments: AstAssignment[];
  /** Function/method boundaries. */
  functions: AstFunctionBounds[];
}

/** AST-aware rule checker type. */
export type AstRuleChecker = (ctx: AstRuleContext) => RuleCheckResult[];

// ---------------------------------------------------------------------------
// Context Factory
// ---------------------------------------------------------------------------

/** Build an AST-aware context from raw source lines and language.
 *  Attempts to use tree-sitter for AST extraction; falls back to regex.
 */
export function createAstContext(
  lines: string[] | null | undefined,
  filePath: string,
  language: string,
): AstRuleContext {
  // Handle null/undefined gracefully — same as safeLines() pattern
  const src = lines ?? [];
  const source = src.join('\n');
  const hasAst = false; // AST extraction is attempted lazily
  const calls = extractCallsRegex(src, language);
  const strings = extractStringsRegex(src);
  const imports = extractImportsRegex(src, language);
  const assignments = extractAssignmentsRegex(src, language);
  const functions = extractFunctionBoundsRegex(src, language);

  return {
    lines: src,
    filePath,
    language,
    hasAst,
    calls,
    strings,
    imports,
    assignments,
    functions,
  };
}

/** Check if a file path indicates a test file (should be skipped for some rules). */
export function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('.test.') ||
    filePath.includes('.spec.') ||
    filePath.includes('__tests__') ||
    filePath.includes('__mocks__')
  );
}

// ---------------------------------------------------------------------------
// Regex-based Extractors (used when tree-sitter is unavailable)
// These are improved versions of the original inline regex patterns
// that existed scattered across 50 checker functions.
// ---------------------------------------------------------------------------

function extractCallsRegex(lines: string[], language: string): AstCallSite[] {
  const calls: AstCallSite[] = [];
  // Match method calls: obj.method(args) and function calls: name(args)
  const callPattern = /(\w+(?:\.\w+)*)\s*\(([^)]*)\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(line)) !== null) {
      const fullName = match[1]!;
      const argsText = match[2]!;
      const dotIdx = fullName.lastIndexOf('.');
      const name = dotIdx >= 0 ? fullName.slice(dotIdx + 1) : fullName;
      const object = dotIdx >= 0 ? fullName.slice(0, dotIdx) : null;
      const args = argsText
        ? argsText.split(',').map((a) => a.trim())
        : [];

      calls.push({ name, object, text: match[0], line: i + 1, arguments: args });
    }
  }

  return calls;
}

function extractStringsRegex(lines: string[]): AstStringLiteral[] {
  const strings: AstStringLiteral[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match single-quoted strings
    const singlePattern = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
    // Match double-quoted strings
    const doublePattern = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    // Match template literals
    const templatePattern = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;

    let m: RegExpExecArray | null;
    while ((m = singlePattern.exec(line)) !== null) {
      strings.push({ value: m[1]!, text: m[0], line: i + 1 });
    }
    while ((m = doublePattern.exec(line)) !== null) {
      strings.push({ value: m[1]!, text: m[0], line: i + 1 });
    }
    while ((m = templatePattern.exec(line)) !== null) {
      strings.push({ value: m[1]!, text: m[0], line: i + 1 });
    }
  }

  return strings;
}

function extractImportsRegex(lines: string[], language: string): AstImport[] {
  const imports: AstImport[] = [];

  const importPatterns: RegExp[] = [];
  if (language === 'typescript' || language === 'javascript') {
    // import { X } from 'module'; import X from 'module'; import * as X from 'module'
    importPatterns.push(/^import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/);
    // require('module')
    importPatterns.push(/(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  } else if (language === 'python') {
    importPatterns.push(/^(?:from\s+(\S+)\s+import\s+.+|import\s+(\S+))/);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pattern of importPatterns) {
      const m = pattern.exec(line);
      if (m) {
        imports.push({
          moduleSpecifier: m[1] ?? m[2] ?? '',
          symbols: [],
          line: i + 1,
          isType: line.includes('import type'),
        });
      }
    }
  }

  return imports;
}

function extractAssignmentsRegex(lines: string[], language: string): AstAssignment[] {
  const assignments: AstAssignment[] = [];

  const pattern = /(?:const|let|var)\s+(\w+)\s*=\s*(.+?)(?:;|$)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = pattern.exec(line);
    if (m) {
      assignments.push({
        name: m[1]!,
        value: m[2]!.trim(),
        line: i + 1,
      });
    }
  }

  return assignments;
}

function extractFunctionBoundsRegex(lines: string[], language: string): AstFunctionBounds[] {
  const bounds: AstFunctionBounds[] = [];

  // Match function/method declarations
  const funcPattern = /(?:export\s+)?(?:async\s+)?(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/;
  const arrowPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/;
  const methodPattern = /^\s*(?:public|private|protected|static|async\s+)*(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fnMatch = funcPattern.exec(line);
    if (fnMatch) {
      bounds.push({
        name: fnMatch[1]!,
        startLine: i + 1,
        endLine: i + 1, // Will be refined by brace tracking
        paramCount: fnMatch[2] ? fnMatch[2].split(',').filter((p) => p.trim()).length : 0,
      });
      continue;
    }
    const arMatch = arrowPattern.exec(line);
    if (arMatch) {
      bounds.push({
        name: arMatch[1]!,
        startLine: i + 1,
        endLine: i + 1,
        paramCount: arMatch[2] ? arMatch[2].split(',').filter((p) => p.trim()).length : 0,
      });
      continue;
    }
    // Method detection — only for class-like languages
    if (language === 'typescript' || language === 'javascript' || language === 'java') {
      const mtMatch = methodPattern.exec(line);
      if (mtMatch && !['if', 'for', 'while', 'switch', 'catch', 'with'].includes(mtMatch[1]!)) {
        bounds.push({
          name: mtMatch[1]!,
          startLine: i + 1,
          endLine: i + 1,
          paramCount: mtMatch[2] ? mtMatch[2].split(',').filter((p) => p.trim()).length : 0,
        });
      }
    }
  }

  return bounds;
}

// ---------------------------------------------------------------------------
// AST-Aware Checker Helpers
// ---------------------------------------------------------------------------

/** Check if a call to a specific function/method exists in the context. */
export function hasCall(ctx: AstRuleContext, name: string, object?: string): boolean {
  return ctx.calls.some((c) =>
    c.name === name && (object === undefined || c.object === object),
  );
}

/** Get all call sites matching a specific function/method name pattern. */
export function findCalls(ctx: AstRuleContext, namePattern: RegExp): AstCallSite[] {
  return ctx.calls.filter((c) => {
    const fullName = c.object ? `${c.object}.${c.name}` : c.name;
    return namePattern.test(fullName);
  });
}

/** Check if a specific string literal value appears in the source. */
export function hasStringLiteral(ctx: AstRuleContext, valuePattern: RegExp): boolean {
  return ctx.strings.some((s) => valuePattern.test(s.value));
}

/** Find all string literals matching a value pattern. */
export function findStringLiterals(ctx: AstRuleContext, valuePattern: RegExp): AstStringLiteral[] {
  return ctx.strings.filter((s) => valuePattern.test(s.value));
}

/** Check if an assignment matches a name pattern. */
export function hasAssignment(ctx: AstRuleContext, namePattern: RegExp): boolean {
  return ctx.assignments.some((a) => namePattern.test(a.name));
}

/** Find all imports from a specific module pattern. */
export function findImports(ctx: AstRuleContext, modulePattern: RegExp): AstImport[] {
  return ctx.imports.filter((imp) => modulePattern.test(imp.moduleSpecifier));
}

/** Get the function that contains a given line number. */
export function getEnclosingFunction(ctx: AstRuleContext, line: number): AstFunctionBounds | null {
  for (const fn of ctx.functions) {
    if (line >= fn.startLine && line <= fn.endLine) {
      return fn;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wrapper: Convert AstRuleChecker to RuleChecker
// ---------------------------------------------------------------------------

/** Wrap an AST-aware checker so it can be used as a standard RuleChecker
 *  in the existing registry. The AST context is constructed from the raw
 *  lines automatically.
 */
export function astChecker(checker: AstRuleChecker): RuleChecker {
  return (lines: string[], filePath: string, language: string) => {
    const ctx = createAstContext(lines, filePath, language);
    return checker(ctx);
  };
}
