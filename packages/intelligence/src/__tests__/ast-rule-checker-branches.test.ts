// @ts-nocheck
// @code-analyzer/intelligence — AST context factory branch coverage: the regex
// fallback extractors (exercised when tree-sitter reports a syntax error) and
// grammar-loading branches for tsx/python/cpp.

import { describe, it, expect } from 'vitest';
import {
  createAstContext,
  hasCall,
  getEnclosingFunction,
  hasStringLiteral,
  findStringLiterals,
  hasAssignment,
  findImports,
} from '../rules/ast-rule-checker.js';

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

  it('gracefully falls back to regex for a language with no grammar package', () => {
    // An unmapped language key has no entry in GRAMMAR_PACKAGES, so loadGrammar
    // returns null deterministically (independent of whether any tree-sitter
    // grammar happens to be hoisted into this package's resolution path) and
    // the context factory transparently falls back to the regex extractors.
    const ctx = createAstContext(['int main() { return 0; }'], 'x.foo', 'unknown');
    expect(ctx.hasAst).toBe(false);
    // The regex fallback still surfaces the call site even without an AST.
    expect(ctx.calls.some((c) => c.name === 'main')).toBe(true);
  });

  it('does not extract a python import whose module is a dotted_name', () => {
    // tree-sitter-python models `import os` as an import_statement with a
    // `dotted_name` child (no `string` child), so the import extractor records
    // nothing for it instead of emitting an empty module specifier.
    const ctx = createAstContext(['import os', 'print(1)'], 'x.py', 'python');
    expect(ctx.hasAst).toBe(true);
    expect(ctx.imports).toEqual([]);
  });
});

describe('createAstContext — regex fallback imports and bounds', () => {
  it('extracts a python `import X` module from capture group 2', () => {
    // The dangling `def (` forces a syntax error, routing into the regex
    // fallback where `import os` matches with its module in group 2 (the
    // from-import alternative leaves group 1 unset).
    const ctx = createAstContext(['import os', 'def ('], 'x.py', 'python');
    expect(ctx.hasAst).toBe(false);
    expect(ctx.imports).toEqual([{ moduleSpecifier: 'os', symbols: [], line: 1, isType: false }]);
  });

  it('extracts a python `from X import Y` module from capture group 1', () => {
    const ctx = createAstContext(['from x import y', 'def ('], 'x.py', 'python');
    expect(ctx.hasAst).toBe(false);
    expect(ctx.imports.length).toBe(1);
    expect(ctx.imports[0].moduleSpecifier).toBe('x');
  });

  it('records a zero-parameter arrow function bound via regex fallback', () => {
    // An empty parameter list hits the `paramCount : 0` arm of the ternary.
    const ctx = createAstContext(['const g = () => {}', 'const = ;'], 'x.ts', 'typescript');
    expect(ctx.hasAst).toBe(false);
    expect(ctx.functions).toEqual([{ name: 'g', startLine: 1, endLine: 1, paramCount: 0 }]);
  });

  it('detects a bare method signature in the regex fallback', () => {
    // `handleClick(a, b) {` has no `function` keyword, so it is only matched by
    // the method pattern (and is not a reserved keyword), exercising the method
    // detection branch and the non-empty parameter-list arm.
    const ctx = createAstContext(
      ['handleClick(a, b) {', '  return a + b;', '}', 'const = ;'],
      'x.ts',
      'typescript',
    );
    expect(ctx.hasAst).toBe(false);
    expect(ctx.functions).toEqual([
      { name: 'handleClick', startLine: 1, endLine: 1, paramCount: 2 },
    ]);
  });

  it('detects a zero-parameter method signature in the regex fallback', () => {
    const ctx = createAstContext(
      ['noArgs() {', '  return 1;', '}', 'const = ;'],
      'x.ts',
      'typescript',
    );
    expect(ctx.hasAst).toBe(false);
    expect(ctx.functions).toEqual([{ name: 'noArgs', startLine: 1, endLine: 1, paramCount: 0 }]);
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

  it('records a tagged-template call that has no `arguments` node', () => {
    // tree-sitter-typescript models `tag`x`` as a call_expression whose child is
    // a `template_string` rather than an `arguments` node, so the argument
    // extractor must tolerate a missing arguments node and emit an empty list.
    const ctx = createAstContext(['tag`hello`;'], 'x.ts', 'typescript');
    expect(ctx.hasAst).toBe(true);
    const call = ctx.calls.find((c) => c.name === 'tag');
    expect(call).toBeDefined();
    expect(call!.arguments).toEqual([]);
  });

  it('does not record a name for a private-field member call', () => {
    // `a.#b` has a `private_property_identifier` (not `property_identifier`), so
    // the member-expression property lookup finds nothing and the call has no
    // usable name — it is therefore skipped rather than mis-attributed.
    const ctx = createAstContext(['a.#b();'], 'x.ts', 'typescript');
    expect(ctx.hasAst).toBe(true);
    expect(ctx.calls).toEqual([]);
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

  it('matches string literals by value pattern', () => {
    const ctx = createAstContext(['a = "api-key";', 'b = "other";'], 'x.ts', 'typescript');
    expect(hasStringLiteral(ctx, /api-key/)).toBe(true);
    expect(hasStringLiteral(ctx, /missing/)).toBe(false);
    expect(findStringLiterals(ctx, /api/).map((s) => s.value)).toEqual(['api-key']);
  });

  it('matches assignments by name pattern', () => {
    const ctx = createAstContext(
      ['const secretKey = 1;', 'const other = 2;'],
      'x.ts',
      'typescript',
    );
    expect(hasAssignment(ctx, /secret/)).toBe(true);
    expect(hasAssignment(ctx, /missing/)).toBe(false);
  });

  it('finds imports by module pattern', () => {
    const ctx = createAstContext(
      ['import { X } from "lodash";', 'import { Y } from "fs";'],
      'x.ts',
      'typescript',
    );
    const found = findImports(ctx, /lodash/);
    expect(found.length).toBe(1);
    expect(found[0].moduleSpecifier).toBe('lodash');
    expect(findImports(ctx, /missing/)).toEqual([]);
  });
});
