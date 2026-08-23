// @code-analyzer/intelligence — AST-Aware Rule Checker Infrastructure
// Provides tree-sitter AST context for rule checkers, with transparent
// fallback to text-based analysis when grammar is unavailable.

import type { RuleCheckResult, RuleChecker } from './rule-runner.js';

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

  // Attempt tree-sitter parsing for structured extraction
  let hasAst = false;
  let calls: AstCallSite[] = [];
  let strings: AstStringLiteral[] = [];
  let imports: AstImport[] = [];
  let assignments: AstAssignment[] = [];
  let functions: AstFunctionBounds[] = [];

  const tsResult = tryParseWithTreeSitter(source, language);
  if (tsResult) {
    hasAst = true;
    calls = tsResult.calls;
    strings = tsResult.strings;
    imports = tsResult.imports;
    assignments = tsResult.assignments;
    functions = tsResult.functions;
  } else {
    // Fall back to regex-based extraction
    calls = extractCallsRegex(src, language);
    strings = extractStringsRegex(src);
    imports = extractImportsRegex(src, language);
    assignments = extractAssignmentsRegex(src, language);
    functions = extractFunctionBoundsRegex(src, language);
  }

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
// Tree-Sitter Based Extraction (preferred when grammar is available)
// ---------------------------------------------------------------------------

/** Cached grammar modules: languageName → grammar. */
const grammarCache = new Map<string, unknown>();

/** Map language names to their tree-sitter npm package names. */
const GRAMMAR_PACKAGES: Record<string, string> = {
  typescript: 'tree-sitter-typescript',
  tsx: 'tree-sitter-typescript',
  javascript: 'tree-sitter-typescript',
  jsx: 'tree-sitter-typescript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  java: 'tree-sitter-java',
  kotlin: 'tree-sitter-kotlin',
  rust: 'tree-sitter-rust',
  php: 'tree-sitter-php',
  ruby: 'tree-sitter-ruby',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  csharp: 'tree-sitter-c-sharp',
  swift: 'tree-sitter-swift',
  json: 'tree-sitter-json',
  yaml: 'tree-sitter-yaml',
  toml: 'tree-sitter-toml',
  sql: 'tree-sitter-sql',
  bash: 'tree-sitter-bash',
  html: 'tree-sitter-html',
  css: 'tree-sitter-css',
  dart: 'tree-sitter-dart',
  lua: 'tree-sitter-lua',
  scala: 'tree-sitter-scala',
  elixir: 'tree-sitter-elixir',
  groovy: 'tree-sitter-groovy',
  zig: 'tree-sitter-zig',
};

function loadGrammar(lang: string): unknown | null {
  const key = lang.toLowerCase();
  const c = grammarCache.get(key);
  if (c !== undefined) return c;
  const pkg = GRAMMAR_PACKAGES[key];
  if (!pkg) {
    grammarCache.set(key, null);
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const g = require(pkg) as Record<string, unknown>;
    // Handle compound exports: tree-sitter-typescript → .typescript / .tsx
    if (key === 'typescript' || key === 'javascript' || key === 'jsx') {
      grammarCache.set(key, g['typescript'] ?? g);
      return g['typescript'] ?? g;
    }
    if (key === 'tsx' && g['tsx']) {
      grammarCache.set(key, g['tsx']);
      return g['tsx'];
    }
    if (key === 'python' && g['python']) {
      grammarCache.set(key, g['python']);
      return g['python'];
    }
    if (key === 'cpp' && g['cpp']) {
      grammarCache.set(key, g['cpp']);
      return g['cpp'];
    }
    grammarCache.set(key, g);
    return g;
  } catch {
    grammarCache.set(key, null);
    return null;
  }
}

function tryParseWithTreeSitter(
  source: string,
  language: string,
): {
  calls: AstCallSite[];
  strings: AstStringLiteral[];
  imports: AstImport[];
  assignments: AstAssignment[];
  functions: AstFunctionBounds[];
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Parser = require('tree-sitter') as new () => {
      setLanguage(g: unknown): void;
      parse(src: string): { rootNode: TsNode };
    };
    if (!Parser) return null;
    const grammar = loadGrammar(language);
    if (!grammar) return null;

    const parser = new Parser();
    parser.setLanguage(grammar);
    const tree = parser.parse(source);
    const root = tree.rootNode;
    if ((root as { hasError?: boolean }).hasError) return null;

    const calls: AstCallSite[] = [];
    const strings: AstStringLiteral[] = [];
    const imports: AstImport[] = [];
    const assignments: AstAssignment[] = [];
    const functions: AstFunctionBounds[] = [];

    walkTsTree(root, source, { calls, strings, imports, assignments, functions });
    return { calls, strings, imports, assignments, functions };
  } catch {
    return null;
  }
}

interface TsNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  child(i: number): TsNode;
  namedChildCount: number;
  namedChild(i: number): TsNode;
}

const CALL_TYPES = new Set([
  'call_expression',
  'method_invocation',
  'function_call',
  'call',
  'invocation',
  'function_application',
  'member_call_expression',
]);
// Top-level string literal node types only. Child nodes that live *inside* a
// string (tree-sitter's `string_fragment`) and template-literal interpolation
// nodes (`template_substitution`, `interpolation`) must NOT be listed here, or
// every literal is extracted twice — once as the parent `string` node and again
// as its `string_fragment` child — producing duplicate findings from rules that
// scan `ctx.strings` (e.g. no-hardcoded-secrets high-entropy check).
const STR_TYPES = new Set([
  'string',
  'template_string',
  'template_literal',
  'string_literal',
  'raw_string',
  'triple_string',
]);
const IMP_TYPES = new Set([
  'import_statement',
  'import_declaration',
  'import_from_statement',
  'import_specification',
]);
const ASN_TYPES = new Set([
  'variable_declaration',
  'assignment_expression',
  'assignment',
  'let_declaration',
  'const_declaration',
  'var_declaration',
  'local_variable_declaration',
  'lexical_declaration',
]);
const FN_TYPES = new Set([
  'function_declaration',
  'method_definition',
  'function_definition',
  'arrow_function',
  'function',
  'method_declaration',
  'constructor',
]);

function walkTsTree(
  node: TsNode,
  _src: string,
  ctx: {
    calls: AstCallSite[];
    strings: AstStringLiteral[];
    imports: AstImport[];
    assignments: AstAssignment[];
    functions: AstFunctionBounds[];
  },
): void {
  const t = node.type;
  // Calls
  if (CALL_TYPES.has(t)) {
    // Extract function name and object from call_expression
    let fnName: string | null = null;
    let fnObj: string | null = null;

    // Check for member_expression child (e.g., console.log, logger.info)
    const memberExpr = findChild(node, ['member_expression']);
    if (memberExpr) {
      const propId = findChild(memberExpr, ['property_identifier']);
      const objId = findChild(memberExpr, ['identifier']);
      if (propId) fnName = propId.text;
      if (objId) fnObj = objId.text;
    }

    // Check for direct identifier / import / super
    if (!fnName) {
      const directFn = findChild(node, ['identifier', 'import', 'super', 'this', 'new_expression']);
      if (directFn) fnName = directFn.text;
    }

    if (fnName) {
      const argsNode = findChild(node, ['arguments', 'argument_list']);
      const argTexts: string[] = [];
      if (argsNode) {
        for (let j = 0; j < argsNode.namedChildCount; j++) {
          argTexts.push(argsNode.namedChild(j)!.text);
        }
      }
      ctx.calls.push({
        name: fnName,
        object: fnObj,
        text: node.text,
        line: node.startPosition.row + 1,
        arguments: argTexts,
      });
    }
  }
  // Strings
  if (STR_TYPES.has(t)) {
    const v = node.text;
    const stripped =
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith('`') && v.endsWith('`'))
        ? v.slice(1, -1)
        : v;
    ctx.strings.push({ value: stripped, text: v, line: node.startPosition.row + 1 });
  }
  // Imports
  if (IMP_TYPES.has(t)) {
    const src = findChild(node, ['string', 'string_fragment']);
    if (src)
      ctx.imports.push({
        moduleSpecifier: src.text.replace(/['"]/g, ''),
        symbols: [],
        line: node.startPosition.row + 1,
        isType: t.includes('type'),
      });
  }
  // Assignments
  if (ASN_TYPES.has(t)) {
    const vd = findChild(node, ['variable_declarator']);
    const id = vd ? findChild(vd, ['identifier'])?.text : null;
    // Extract the actual value (RHS of =) rather than entire declaration
    let val = node.text;
    if (vd) {
      const stringVal = findChild(vd, [
        'string',
        'string_fragment',
        'template_string',
        'number',
        'true',
        'false',
        'null',
      ]);
      if (stringVal) val = stringVal.text;
    }
    const name = id;
    if (name) ctx.assignments.push({ name, value: val, line: node.startPosition.row + 1 });
  }
  // Functions
  if (FN_TYPES.has(t)) {
    const id = findChild(node, ['identifier', 'property_identifier']);
    const params = findChild(node, ['parameters', 'formal_parameters', 'parameter_list']);
    ctx.functions.push({
      name: id?.text ?? '<anonymous>',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      paramCount: params ? params.namedChildCount : 0,
    });
  }
  for (let i = 0; i < node.childCount; i++) walkTsTree(node.child(i), _src, ctx);
}

function findChild(node: TsNode, types: string[]): TsNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (types.includes(c.type)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regex-based Extractors (fallback when tree-sitter is unavailable)
// ---------------------------------------------------------------------------

function extractCallsRegex(lines: string[], _language: string): AstCallSite[] {
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
      const args = argsText ? argsText.split(',').map((a) => a.trim()) : [];

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
    importPatterns.push(
      /^import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/,
    );
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

function extractAssignmentsRegex(lines: string[], _language: string): AstAssignment[] {
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
  const methodPattern =
    /^\s*(?:public|private|protected|static|async\s+)*(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*\{/;

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
  return ctx.calls.some((c) => c.name === name && (object === undefined || c.object === object));
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
