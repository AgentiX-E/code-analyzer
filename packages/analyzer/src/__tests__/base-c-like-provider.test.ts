// @code-analyzer/analyzer — Tests for Base C-like Language Provider Helpers
// Tests the utility functions exported from packages/analyzer/src/languages/base-c-like.ts
//
// Functions tested:
//   lineNumberAt, escapeRegex, findBlockEnd, extractClassLike, extractFunctions,
//   extractCalls, extractVariables, extractAnnotations, extractDocComments,
//   extractImportsAsCaptures

import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { ParsedImport } from '../languages/provider.js';

import {
  lineNumberAt,
  escapeRegex,
  findBlockEnd,
  extractClassLike,
  extractFunctions,
  extractCalls,
  extractVariables,
  extractAnnotations,
  extractDocComments,
  extractImportsAsCaptures,
} from '../languages/base-c-like.js';

// =========================================================================
// lineNumberAt tests
// =========================================================================

describe('lineNumberAt', () => {
  it('returns 1 for offset 0', () => {
    expect(lineNumberAt('hello world', 0)).toBe(1);
  });

  it('returns 1 for offset within first line', () => {
    expect(lineNumberAt('hello world', 3)).toBe(1);
  });

  it('returns 2 for offset past first newline', () => {
    expect(lineNumberAt('line1\nline2', 7)).toBe(2);
  });

  it('returns correct line for multi-line content', () => {
    const source = 'a\nb\nc\nd\ne\nf\ng';
    expect(lineNumberAt(source, 0)).toBe(1);
    expect(lineNumberAt(source, 2)).toBe(2); // after first \n
    expect(lineNumberAt(source, 4)).toBe(3);
    expect(lineNumberAt(source, 6)).toBe(4);
  });

  it('returns total line count for offset beyond content', () => {
    expect(lineNumberAt('line1\nline2\nline3', 999)).toBe(3);
  });

  it('handles empty string', () => {
    expect(lineNumberAt('', 0)).toBe(1);
  });

  it('handles content with only newlines', () => {
    expect(lineNumberAt('\n\n\n', 2)).toBe(3);
  });
});

// =========================================================================
// escapeRegex tests
// =========================================================================

describe('escapeRegex', () => {
  it('escapes dots', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
  });

  it('escapes asterisks', () => {
    expect(escapeRegex('a*b')).toBe('a\\*b');
  });

  it('escapes plus signs', () => {
    expect(escapeRegex('a+b')).toBe('a\\+b');
  });

  it('escapes question marks', () => {
    expect(escapeRegex('a?b')).toBe('a\\?b');
  });

  it('escapes carets', () => {
    expect(escapeRegex('^start')).toBe('\\^start');
  });

  it('escapes dollar signs', () => {
    expect(escapeRegex('end$')).toBe('end\\$');
  });

  it('escapes parentheses', () => {
    expect(escapeRegex('(group)')).toBe('\\(group\\)');
  });

  it('escapes square brackets', () => {
    expect(escapeRegex('[abc]')).toBe('\\[abc\\]');
  });

  it('escapes pipe character', () => {
    expect(escapeRegex('a|b')).toBe('a\\|b');
  });

  it('escapes backslashes', () => {
    expect(escapeRegex('a\\b')).toBe('a\\\\b');
  });

  it('handles multiple special characters', () => {
    expect(escapeRegex('a.b*c+d?e^f$g(h)i[j]k{l}m|n')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\(h\\)i\\[j\\]k\\{l\\}m\\|n',
    );
  });

  it('does not modify normal strings', () => {
    expect(escapeRegex('hello')).toBe('hello');
  });
});

// =========================================================================
// findBlockEnd tests
// =========================================================================

describe('findBlockEnd', () => {
  it('finds the matching closing brace for a simple block', () => {
    const source = 'function foo() {\n  return 1;\n}';
    const endLine = findBlockEnd(source, 0);
    // The closing brace } is on line 3. The function returns lineNumberAt
    // of startOffset + i where i is the position of '}'. With the newline
    // after '}', it counts the line past it.
    expect(endLine).toBe(3);
  });

  it('handles nested braces', () => {
    const source = 'function foo() {\n  if (true) {\n    return 1;\n  }\n  return 2;\n}';
    const endLine = findBlockEnd(source, 0);
    // The outer function block ends on line 6
    expect(endLine).toBe(6);
  });

  it('returns start line when no opening brace is found', () => {
    const source = 'function foo();\n';
    const endLine = findBlockEnd(source, 0);
    expect(endLine).toBe(1);
  });

  it('handles strings containing braces', () => {
    const source = 'function foo() {\n  const s = "{";\n  return s;\n}';
    const endLine = findBlockEnd(source, 0);
    expect(endLine).toBe(4);
  });

  it('returns the closing brace line even with trailing newlines', () => {
    const source = 'function foo() {\n  return 1;\n}\n\n// trailing comment\n';
    const endLine = findBlockEnd(source, 0);
    expect(endLine).toBe(3);
  });

  it('handles single-line comments containing braces', () => {
    const source = 'function foo() {\n  // This is a { brace\n  return 1;\n}';
    const endLine = findBlockEnd(source, 0);
    expect(endLine).toBe(4);
  });

  it('handles block comments containing braces', () => {
    const source = 'function foo() {\n  /* { nested } */\n  return 1;\n}';
    const endLine = findBlockEnd(source, 0);
    expect(endLine).toBe(4);
  });

  it('handles template literals with braces', () => {
    const source = 'function foo() {\n  const s = `{nested}`;\n  return s;\n}';
    const endLine = findBlockEnd(source, 0);
    expect(endLine).toBe(4);
  });

  it('returns end of source when braces are unmatched', () => {
    const source = 'function foo() {\n  return 1;\n// missing closing brace';
    const endLine = findBlockEnd(source, 0);
    // Since there's no matching close brace, it returns the line number at the end
    expect(endLine).toBeGreaterThanOrEqual(3);
  });

  it('handles offset start position', () => {
    const source = '// comment\nfunction bar() {\n  return 2;\n}';
    const endLine = findBlockEnd(source, 12); // start at "function"
    expect(endLine).toBe(4);
  });
});

// =========================================================================
// extractClassLike tests
// =========================================================================

describe('extractClassLike', () => {
  it('extracts class definition', () => {
    const source = 'class MyClass {\n  // body\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.CLASS_DEF);
    expect(captures[0]!.name).toBe('MyClass');
    expect(captures[0]!.text).toBe('class MyClass');
    expect(captures[0]!.startLine).toBe(1);
  });

  it('extracts a class on the last line without a trailing newline', () => {
    const source = 'class Last {\n  // body\n}';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.name).toBe('Last');
  });

  it('extracts a single-line class with no newline at all', () => {
    const source = 'class SingleLine {}';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.name).toBe('SingleLine');
  });

  it('extracts interface definition', () => {
    const source = 'interface Readable {\n  read(): void;\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'interface', CAPTURE_TAGS.INTERFACE_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.INTERFACE_DEF);
    expect(captures[0]!.name).toBe('Readable');
  });

  it('extracts enum definition', () => {
    const source = 'enum Color {\n  Red,\n  Green,\n  Blue\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'enum', CAPTURE_TAGS.ENUM_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.ENUM_DEF);
    expect(captures[0]!.name).toBe('Color');
  });

  it('extracts struct definition', () => {
    const source = 'struct Point {\n  x: number;\n  y: number;\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.rs', captures, 'struct', CAPTURE_TAGS.STRUCT_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.STRUCT_DEF);
    expect(captures[0]!.name).toBe('Point');
  });

  it('extracts trait definition', () => {
    const source = 'trait Display {\n  fn display(&self);\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.rs', captures, 'trait', CAPTURE_TAGS.TRAIT_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.TRAIT_DEF);
    expect(captures[0]!.name).toBe('Display');
  });

  it('extracts class with extends', () => {
    const source = 'class Dog extends Animal {\n  bark() {}\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties?.baseClasses).toBe('Animal');
  });

  it('extracts class with implements', () => {
    const source = 'class MyComponent implements OnInit, OnDestroy {\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties?.interfaces).toContain('OnInit');
  });

  it('extracts abstract class', () => {
    const source = 'abstract class BaseHandler {\n  abstract handle(): void;\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties?.abstract).toBe('true');
  });

  it('extracts class with modifiers', () => {
    const source = 'public sealed class FinalClass {\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.cs', captures, 'class', CAPTURE_TAGS.CLASS_DEF, [
      'public',
      'private',
      'sealed',
      'static',
    ]);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.name).toBe('FinalClass');
  });

  it('extracts multiple classes', () => {
    const source = 'class A {}\nclass B {}\nclass C {}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(3);
    expect(captures[0]!.name).toBe('A');
    expect(captures[1]!.name).toBe('B');
    expect(captures[2]!.name).toBe('C');
  });

  it('does not extract non-matching keywords', () => {
    const source = 'function test() {}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures).toHaveLength(0);
  });

  it('includes filePath in properties', () => {
    const source = 'class MyClass {}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, '/path/to/file.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures[0]!.properties?.filePath).toBe('/path/to/file.ts');
  });

  it('includes startByte and endByte', () => {
    const source = 'class MyClass {\n}\n';
    const captures: UnifiedCapture[] = [];
    extractClassLike(source, 'test.ts', captures, 'class', CAPTURE_TAGS.CLASS_DEF);

    expect(captures[0]!.startByte).toBe(0);
    expect(captures[0]!.endByte).toBe('class MyClass'.length);
  });
});

// =========================================================================
// extractFunctions tests
// =========================================================================

describe('extractFunctions', () => {
  it('extracts function definition with return type', () => {
    const source = 'int add(int a, int b) {\n  return a + b;\n}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>([
      'int',
      'float',
      'double',
      'char',
      'void',
      'bool',
      'string',
      'var',
      'let',
      'const',
    ]);
    extractFunctions(source, 'test.c', captures, reserved);

    const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(funcs.length).toBeGreaterThanOrEqual(1);
    const addFunc = funcs.find((f) => f.name === 'add');
    expect(addFunc).toBeDefined();
    expect(addFunc!.properties?.returnType).toBe('int');
  });

  it('extracts void function', () => {
    const source = 'void print(const char* msg) {\n  printf("%s", msg);\n}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>([
      'int',
      'float',
      'double',
      'char',
      'void',
      'bool',
      'string',
      'var',
      'let',
      'const',
    ]);
    extractFunctions(source, 'test.c', captures, reserved);

    const printFunc = captures.find(
      (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'print',
    );
    expect(printFunc).toBeDefined();
    expect(printFunc!.properties?.returnType).toBe('void');
  });

  it('extracts a function declaration without a body', () => {
    const source = 'int forward(int a);\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['int', 'void']);
    extractFunctions(source, 'test.c', captures, reserved);

    const fwd = captures.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'forward');
    expect(fwd).toBeDefined();
    expect(fwd!.properties?.returnType).toBe('int');
  });

  it('treats a same-named return type as a constructor (void return)', () => {
    const source = 'Foo Foo() {\n  return;\n}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['void']);
    extractFunctions(source, 'test.cpp', captures, reserved);

    const ctor = captures.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'Foo');
    expect(ctor).toBeDefined();
    expect(ctor!.properties?.returnType).toBe('void');
  });

  it('extracts functions with access modifiers', () => {
    const source = 'public static void init(String[] args) {\n  System.out.println("Hello");\n}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['public', 'static', 'void']);
    extractFunctions(source, 'test.java', captures, reserved);

    // 'init' is not in the skip list, so it should be extracted
    const initFunc = captures.find((c) => c.name === 'init');
    expect(initFunc).toBeDefined();
    expect(initFunc!.properties?.returnType).toBe('void');
  });

  it('skips reserved keywords as function names', () => {
    const source = 'void if(int x) {}';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'void']);
    extractFunctions(source, 'test.c', captures, reserved);

    // 'if' should be skipped
    const ifFunc = captures.find((c) => c.name === 'if');
    expect(ifFunc).toBeUndefined();
  });

  it('skips control flow keywords as function names', () => {
    const source = 'void while(int x) {}';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['void']);
    extractFunctions(source, 'test.c', captures, reserved);

    // 'while' should be skipped by the hardcoded check
    const whileFunc = captures.find((c) => c.name === 'while');
    expect(whileFunc).toBeUndefined();
  });

  it('includes filePath in properties', () => {
    const source = 'int sum(int a, int b) {\n  return a + b;\n}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['int']);
    extractFunctions(source, '/path/to/file.c', captures, reserved);

    const func = captures.find((c) => c.name === 'sum');
    expect(func).toBeDefined();
    expect(func!.properties?.filePath).toBe('/path/to/file.c');
  });

  it('extracts multiple functions', () => {
    const source = 'int add(int a, int b) {}\nint sub(int a, int b) {}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['int']);
    extractFunctions(source, 'test.c', captures, reserved);

    const names = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF).map((c) => c.name);
    expect(names).toContain('add');
    expect(names).toContain('sub');
  });

  it('sets startLine correctly for multi-line functions', () => {
    const source = '\n\nint calc(int x) {\n  return x * 2;\n}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['int']);
    extractFunctions(source, 'test.c', captures, reserved);

    const func = captures.find((c) => c.name === 'calc');
    expect(func).toBeDefined();
    expect(func!.startLine).toBe(3);
  });
});

// =========================================================================
// extractCalls tests
// =========================================================================

describe('extractCalls', () => {
  it('extracts function calls', () => {
    const source = 'foo();\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'while', 'for', 'return']);
    extractCalls(source, 'test.c', captures, reserved);

    const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]!.name).toBe('foo');
  });

  it('extracts multiple function calls', () => {
    const source = 'foo();\nbar();\nbaz();\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'while', 'for', 'return']);
    extractCalls(source, 'test.c', captures, reserved);

    const names = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL).map((c) => c.name);
    expect(names).toContain('foo');
    expect(names).toContain('bar');
    expect(names).toContain('baz');
  });

  it('skips reserved keywords', () => {
    const source = 'if(x) {}\nwhile(y) {}\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'while']);
    extractCalls(source, 'test.c', captures, reserved);

    const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    const ifCall = calls.find((c) => c.name === 'if');
    const whileCall = calls.find((c) => c.name === 'while');
    expect(ifCall).toBeUndefined();
    expect(whileCall).toBeUndefined();
  });

  it('skips ALL_CAPS identifiers (constants)', () => {
    const source = 'MAX_VALUE();\nCONSTANT();\nhello();\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'while']);
    extractCalls(source, 'test.c', captures, reserved);

    const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    const maxCall = calls.find((c) => c.name === 'MAX_VALUE');
    const constantCall = calls.find((c) => c.name === 'CONSTANT');
    const helloCall = calls.find((c) => c.name === 'hello');

    expect(maxCall).toBeUndefined();
    expect(constantCall).toBeUndefined();
    expect(helloCall).toBeDefined();
  });

  it('includes filePath in properties', () => {
    const source = 'foo();\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'while', 'for']);
    extractCalls(source, '/path/to/file.c', captures, reserved);

    const call = captures.find((c) => c.name === 'foo');
    expect(call).toBeDefined();
    expect(call!.properties?.filePath).toBe('/path/to/file.c');
  });

  it('sets startLine correctly', () => {
    const source = '\n\nfoo();\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'while', 'for']);
    extractCalls(source, 'test.c', captures, reserved);

    const call = captures.find((c) => c.name === 'foo');
    expect(call).toBeDefined();
    expect(call!.startLine).toBe(3);
  });

  it('sets endLine same as startLine for calls', () => {
    const source = 'foo();\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'while', 'for']);
    extractCalls(source, 'test.c', captures, reserved);

    const call = captures.find((c) => c.name === 'foo');
    expect(call).toBeDefined();
    expect(call!.endLine).toBe(call!.startLine);
  });
});

// =========================================================================
// extractVariables tests
// =========================================================================

describe('extractVariables', () => {
  it('extracts variable definitions', () => {
    const source = 'var x = 10;\nlet y = 20;\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return']);
    extractVariables(source, 'test.js', captures, ['var', 'let'], reserved);

    expect(captures).toHaveLength(2);
    expect(captures[0]!.name).toBe('x');
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.VARIABLE_DEF);
    expect(captures[1]!.name).toBe('y');
    expect(captures[1]!.tag).toBe(CAPTURE_TAGS.VARIABLE_DEF);
  });

  it('extracts constant definitions with const', () => {
    const source = 'const PI = 3.14;\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return']);
    extractVariables(source, 'test.js', captures, ['const'], reserved);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.name).toBe('PI');
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.CONSTANT_DEF);
  });

  it('extracts final variables as constants', () => {
    const source = 'final x = 10;\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return']);
    extractVariables(source, 'test.java', captures, ['final'], reserved);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.CONSTANT_DEF);
  });

  it('extracts val variables as constants (Kotlin)', () => {
    const source = 'val x = 10;\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return']);
    extractVariables(source, 'test.kt', captures, ['val'], reserved);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.CONSTANT_DEF);
  });

  it('skips reserved keywords', () => {
    const source = 'var if = 10;\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return']);
    extractVariables(source, 'test.js', captures, ['var'], reserved);

    const ifVar = captures.find((c) => c.name === 'if');
    expect(ifVar).toBeUndefined();
  });

  it('includes filePath in properties', () => {
    const source = 'var x = 10;\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return']);
    extractVariables(source, '/path/to/file.js', captures, ['var'], reserved);

    expect(captures[0]!.properties?.filePath).toBe('/path/to/file.js');
  });

  it('extracts variables with type annotations', () => {
    const source = 'var name: string = "hello";\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return', 'string']);
    extractVariables(source, 'test.ts', captures, ['var'], reserved);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.name).toBe('name');
  });

  it('sets startLine and endLine to same line', () => {
    const source = '\n\nvar x = 10;\n';
    const captures: UnifiedCapture[] = [];
    const reserved = new Set<string>(['if', 'else', 'return']);
    extractVariables(source, 'test.js', captures, ['var'], reserved);

    expect(captures[0]!.startLine).toBe(3);
    expect(captures[0]!.endLine).toBe(3);
  });
});

// =========================================================================
// extractAnnotations tests
// =========================================================================

describe('extractAnnotations', () => {
  it('extracts @ annotations (Java-style)', () => {
    const source = '@Override\npublic void run() {}\n';
    const captures: UnifiedCapture[] = [];
    extractAnnotations(source, 'test.java', captures, '@');

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.DECORATOR);
    expect(captures[0]!.name).toBe('Override');
    expect(captures[0]!.text).toBe('@Override');
  });

  it('extracts annotations with arguments', () => {
    const source = '@SuppressWarnings("unchecked")\npublic void test() {}\n';
    const captures: UnifiedCapture[] = [];
    extractAnnotations(source, 'test.java', captures, '@');

    expect(captures).toHaveLength(1);
    expect(captures[0]!.name).toBe('SuppressWarnings');
    expect(captures[0]!.text).toContain('"unchecked"');
  });

  it('extracts #[ attributes (Rust-style)', () => {
    const source = '#[derive(Debug)]\nstruct Point { x: i32, y: i32 }\n';
    const captures: UnifiedCapture[] = [];
    extractAnnotations(source, 'test.rs', captures, '#[');

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.DECORATOR);
    expect(captures[0]!.name).toBe('derive');
  });

  it('extracts multiple annotations', () => {
    const source = '@Override\n@Deprecated\npublic void oldMethod() {}\n';
    const captures: UnifiedCapture[] = [];
    extractAnnotations(source, 'test.java', captures, '@');

    const names = captures.map((c) => c.name);
    expect(names).toContain('Override');
    expect(names).toContain('Deprecated');
  });

  it('includes filePath in properties', () => {
    const source = '@Override\nvoid test() {}\n';
    const captures: UnifiedCapture[] = [];
    extractAnnotations(source, '/path/to/file.java', captures, '@');

    expect(captures[0]!.properties?.filePath).toBe('/path/to/file.java');
  });

  it('sets decorator property', () => {
    const source = '@Autowired\nprivate Service service;\n';
    const captures: UnifiedCapture[] = [];
    extractAnnotations(source, 'test.java', captures, '@');

    expect(captures[0]!.properties?.decorator).toBe('Autowired');
  });
});

// =========================================================================
// extractDocComments tests
// =========================================================================

describe('extractDocComments', () => {
  it('extracts JSDoc-style block comments', () => {
    const source = '/**\n * Adds two numbers\n */\nfunction add(a, b) {}\n';
    const captures: UnifiedCapture[] = [];
    const pattern = /\/\*\*[\s\S]*?\*\//g;
    extractDocComments(source, 'test.js', captures, pattern);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.DOCSTRING);
    expect(captures[0]!.text).toContain('Adds two numbers');
  });

  it('extracts /// comments (Rust/Dart style)', () => {
    const source = '/// Adds two numbers\nfn add(a: i32, b: i32) -> i32 {}\n';
    const captures: UnifiedCapture[] = [];
    const pattern = /\/\/\/.*/g;
    extractDocComments(source, 'test.rs', captures, pattern);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.DOCSTRING);
    expect(captures[0]!.text).toContain('Adds two numbers');
  });

  it('extracts multiple doc comments', () => {
    const source = '/** First */\nfunction a() {}\n/** Second */\nfunction b() {}\n';
    const captures: UnifiedCapture[] = [];
    const pattern = /\/\*\*[\s\S]*?\*\//g;
    extractDocComments(source, 'test.js', captures, pattern);

    expect(captures).toHaveLength(2);
  });

  it('includes filePath in properties', () => {
    const source = '/** Comment */\n';
    const captures: UnifiedCapture[] = [];
    const pattern = /\/\*\*[\s\S]*?\*\//g;
    extractDocComments(source, '/path/to/file.js', captures, pattern);

    expect(captures[0]!.properties?.filePath).toBe('/path/to/file.js');
  });

  it('sets correct startLine and endLine for multi-line comments', () => {
    const source = '/**\n * Line 1\n * Line 2\n */\n';
    const captures: UnifiedCapture[] = [];
    const pattern = /\/\*\*[\s\S]*?\*\//g;
    extractDocComments(source, 'test.js', captures, pattern);

    expect(captures[0]!.startLine).toBe(1);
    // 3 newlines in the comment text = 4 lines total
    expect(captures[0]!.endLine).toBe(4);
  });
});

// =========================================================================
// extractImportsAsCaptures tests
// =========================================================================

describe('extractImportsAsCaptures', () => {
  it('extracts imports as captures', () => {
    const source = 'import * as React from "react";\n';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [
      { source: 'react', names: ['React'], type: 'wildcard', lineNumber: 1 },
    ];

    extractImportsAsCaptures(source, 'test.ts', captures, extractImports);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe(CAPTURE_TAGS.IMPORT);
    expect(captures[0]!.name).toBe('react');
    expect(captures[0]!.text).toBe('react');
  });

  it('extracts named imports', () => {
    const source = 'import { useState, useEffect } from "react";\n';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [
      { source: 'react', names: ['useState', 'useEffect'], type: 'named', lineNumber: 1 },
    ];

    extractImportsAsCaptures(source, 'test.ts', captures, extractImports);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties?.names).toBe('useState,useEffect');
    expect(captures[0]!.properties?.importType).toBe('named');
  });

  it('extracts default imports', () => {
    const source = 'import React from "react";\n';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [
      { source: 'react', names: ['React'], type: 'default', lineNumber: 1 },
    ];

    extractImportsAsCaptures(source, 'test.ts', captures, extractImports);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties?.importType).toBe('default');
  });

  it('extracts namespace imports', () => {
    const source = 'import * as utils from "./utils";\n';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [
      { source: './utils', names: ['utils'], type: 'namespace', lineNumber: 1 },
    ];

    extractImportsAsCaptures(source, 'test.ts', captures, extractImports);

    expect(captures).toHaveLength(1);
    expect(captures[0]!.properties?.importType).toBe('namespace');
  });

  it('extracts multiple imports', () => {
    const source = 'import React from "react";\nimport { render } from "react-dom";\n';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [
      { source: 'react', names: ['React'], type: 'default', lineNumber: 1 },
      { source: 'react-dom', names: ['render'], type: 'named', lineNumber: 2 },
    ];

    extractImportsAsCaptures(source, 'test.ts', captures, extractImports);

    expect(captures).toHaveLength(2);
    expect(captures[0]!.name).toBe('react');
    expect(captures[1]!.name).toBe('react-dom');
  });

  it('includes filePath in properties', () => {
    const source = '';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [
      { source: 'react', names: ['React'], type: 'default', lineNumber: 1 },
    ];

    extractImportsAsCaptures(source, '/path/to/file.tsx', captures, extractImports);

    expect(captures[0]!.properties?.filePath).toBe('/path/to/file.tsx');
  });

  it('sets line number from the import', () => {
    const source = '';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [
      { source: 'lodash', names: ['_'], type: 'default', lineNumber: 5 },
    ];

    extractImportsAsCaptures(source, 'test.ts', captures, extractImports);

    expect(captures[0]!.startLine).toBe(5);
    expect(captures[0]!.endLine).toBe(5);
  });

  it('handles empty imports array', () => {
    const source = '';
    const captures: UnifiedCapture[] = [];

    const extractImports = (_source: string): ParsedImport[] => [];

    extractImportsAsCaptures(source, 'test.ts', captures, extractImports);

    expect(captures).toHaveLength(0);
  });
});
