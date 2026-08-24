// @ts-nocheck
// @code-analyzer/intelligence — AST context factory branch coverage: the regex
// fallback extractors (exercised when tree-sitter reports a syntax error) and
// grammar-loading branches for tsx/python/cpp.

import { describe, it, expect } from 'vitest';
import { createAstContext, hasCall, getEnclosingFunction } from '../rules/ast-rule-checker.js';

// A malformed line forces tree-sitter to report a syntax error, which routes
// createAstContext into the regex-based fallback extractors.
const MALFORMED = 'const = ;';

describe('createAstContext — regex fallback (syntax error)', () => {
  it('extracts dotted and bare calls via regex', () => {
    const ctx = createAstContext(['foo.bar(1, 2)', 'baz()', MALFORMED], 'x.ts', 'typescript');
    expect(ctx.hasAst).toBe(false);
    const dotted = ctx.calls.find((c) => c.name === 'bar');
    expect(dotted).toBeDefined();
    expect(dotted!.object).toBe('foo');
    expect(dotted!.arguments).toEqual(['1', '2']);
    const bare = ctx.calls.find((c) => c.name === 'baz');
    expect(bare!.object).toBeNull();
    expect(bare!.arguments).toEqual([]);
  });

  it('extracts single/double/template strings via regex', () => {
    const ctx = createAstContext(
      ["a = 'one'", 'b = "two"', 'c = `three`', MALFORMED],
      'x.ts',
      'typescript',
    );
    expect(ctx.hasAst).toBe(false);
    expect(ctx.strings.map((s) => s.value)).toEqual(['one', 'two', 'three']);
  });

  it('extracts assignments and function bounds via regex', () => {
    const ctx = createAstContext(
      ['const a = 1;', 'function f(x, y) {}', 'const g = (z) => {}', MALFORMED],
      'x.ts',
      'typescript',
    );
    expect(ctx.hasAst).toBe(false);
    expect(ctx.assignments.map((a) => a.name)).toEqual(['a', 'g']);
    expect(ctx.functions.map((f) => f.name)).toEqual(['f', 'g']);
  });

  it('extracts typescript imports via regex when the source is malformed', () => {
    const ctx = createAstContext(['import { X } from "y";', MALFORMED], 'x.ts', 'typescript');
    expect(ctx.hasAst).toBe(false);
    expect(ctx.imports.length).toBe(1);
    expect(ctx.imports[0].moduleSpecifier).toBe('y');
  });
});

describe('createAstContext — grammar loading for other languages', () => {
  it('loads the tsx grammar from the typescript package', () => {
    const ctx = createAstContext(['const x = <div />;'], 'x.tsx', 'tsx');
    expect(ctx.hasAst).toBe(true);
  });

  it('loads the python grammar', () => {
    const ctx = createAstContext(['def f():\n    pass'], 'x.py', 'python');
    expect(ctx.hasAst).toBe(true);
    expect(ctx.functions.length).toBe(1);
  });

  it('loads the cpp grammar', () => {
    const ctx = createAstContext(['int main() { return 0; }'], 'x.cpp', 'cpp');
    expect(ctx.hasAst).toBe(true);
  });
});

describe('createAstContext — tree-sitter walk edge cases', () => {
  it('ignores a call whose callee is a computed member access', () => {
    const ctx = createAstContext(['arr[0]();'], 'x.ts', 'typescript');
    expect(ctx.hasAst).toBe(true);
    // `arr[0]` has no property_identifier, so the call has no usable name.
    expect(ctx.calls).toEqual([]);
  });

  it('keeps a raw-string literal untouched when stripping quotes', () => {
    const ctx = createAstContext(['p = r"raw\\path"'], 'x.py', 'python');
    expect(ctx.hasAst).toBe(true);
    const raw = ctx.strings.find((s) => s.value.includes('raw'));
    expect(raw).toBeDefined();
  });

  it('extracts a zero-parameter function bound via regex fallback', () => {
    const ctx = createAstContext(['function empty() {}', 'const = ;'], 'x.ts', 'typescript');
    expect(ctx.hasAst).toBe(false);
    expect(ctx.functions.length).toBe(1);
    expect(ctx.functions[0].paramCount).toBe(0);
  });
});

describe('AST helper edge cases', () => {
  it('matches hasCall without an object filter', () => {
    const ctx = createAstContext(['console.log(1)'], 'x.ts', 'typescript');
    expect(hasCall(ctx, 'log')).toBe(true);
    expect(hasCall(ctx, 'log', 'console')).toBe(true);
    expect(hasCall(ctx, 'log', 'other')).toBe(false);
  });

  it('resolves the enclosing function for a line in range', () => {
    const ctx = createAstContext(['function f() {\n  x();\n}'], 'x.ts', 'typescript');
    const fn = getEnclosingFunction(ctx, 2);
    expect(fn).not.toBeNull();
    expect(fn!.name).toBe('f');
    expect(getEnclosingFunction(ctx, 99)).toBeNull();
  });
});
