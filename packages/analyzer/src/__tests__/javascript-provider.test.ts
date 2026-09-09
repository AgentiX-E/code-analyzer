import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { JavaScriptProvider } from '../languages/javascript.js';
import type { ParsedImport } from '../languages/provider.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from '../languages/tree-sitter-base.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// A minimal in-memory TreeSitterSyntaxNode. Used to exercise defensive branches
// that real tree-sitter JavaScript cannot produce from valid input (a
// function_declaration without an identifier, a computed method with no
// property_identifier, etc.).
function makeNode(
  type: string,
  children: TreeSitterSyntaxNode[] = [],
  text?: string,
  parent: TreeSitterSyntaxNode | null = null,
): TreeSitterSyntaxNode {
  return {
    type,
    text: text ?? children.map((c) => c.text).join(''),
    startIndex: 0,
    endIndex: 0,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    childCount: children.length,
    namedChildCount: children.length,
    hasError: false,
    child: (i: number) => children[i],
    namedChild: (i: number) => children[i],
    childForFieldName: () => null,
    parent,
    walk: () => ({
      nodeType: type,
      startIndex: 0,
      endIndex: 0,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      gotoFirstChild: () => false,
      gotoNextSibling: () => false,
      gotoParent: () => false,
    }),
  };
}

// Exposes the protected AST-walk methods so their defensive branches can be
// exercised directly with synthetic nodes.
class TestableJavaScriptProvider extends JavaScriptProvider {
  public walkAndCaptureForTest(node: TreeSitterSyntaxNode): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    this.walkAndCapture(node, captures);
    return captures;
  }

  public walkForImportsForTest(node: TreeSitterSyntaxNode): ParsedImport[] {
    const imports: ParsedImport[] = [];
    this.walkForImports(node, imports);
    return imports;
  }

  public checkExportedForTest(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    return this.checkExported(node, symbolName);
  }
}

// Simulates a runtime where the tree-sitter grammar is unavailable, forcing
// the provider onto its regex-based fallback methods.
class NoGrammarJavaScriptProvider extends JavaScriptProvider {
  protected override loadGrammar(): TreeSitterLanguage | null {
    return null;
  }
}

describe('JavaScriptProvider', () => {
  const provider = new JavaScriptProvider();

  describe('properties', () => {
    it('should have correct language and display name', () => {
      expect(provider.language).toBe('javascript');
      expect(provider.displayName).toBe('JavaScript');
    });

    it('should have JavaScript extensions', () => {
      expect(provider.extensions).toContain('.js');
      expect(provider.extensions).toContain('.jsx');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect function declarations', () => {
      const source = 'function hello() { return "hi"; }';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('hello');
    });

    it('should detect async functions', () => {
      const source = 'async function fetchData() { await something(); }';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const asyncFunc = funcs.find((f) => f.name === 'fetchData');
      expect(asyncFunc).toBeDefined();
    });

    it('should detect arrow functions', () => {
      const source = 'const double = (x) => x * 2;';
      const captures = provider.parse(source, 'test.js');
      const arrowFuncs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
      );
      expect(arrowFuncs).toHaveLength(1);
      expect(arrowFuncs[0]!.name).toBe('double');
    });

    it('should detect class definitions', () => {
      const source = 'class Animal { constructor() {} }';
      const captures = provider.parse(source, 'test.js');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Animal');
    });

    it('should detect class extends base class', () => {
      const source = 'class Dog extends Animal {}\n';
      const captures = provider.parse(source, 'test.js');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Dog');
      expect(classes[0]!.properties?.baseClasses).toBe('Animal');
    });

    it('should detect JSDoc comments', () => {
      const source = '/** A documented function */\nfunction doc() {}\n';
      const captures = provider.parse(source, 'test.js');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.name).toBe('/** A documented function */');
    });

    it('should detect new expressions', () => {
      const source = 'const instance = new Foo();\n';
      const captures = provider.parse(source, 'test.js');
      const news = captures.filter((c) => c.tag === CAPTURE_TAGS.NEW_EXPRESSION);
      expect(news).toHaveLength(1);
      expect(news[0]!.name).toBe('Foo');
    });

    it('should detect method calls', () => {
      const source = 'obj.method();\n';
      const captures = provider.parse(source, 'test.js');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls.some((c) => c.name === 'method')).toBe(true);
    });

    it('should detect class methods and constructors', () => {
      const source =
        'class Person {\n  constructor(name) { this.name = name; }\n  greet() { return "hi"; }\n}';
      const captures = provider.parse(source, 'test.js');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(constructors).toHaveLength(1);
      expect(constructors[0]!.containerName).toBe('Person');
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('greet');
    });

    it('should detect variable declarations', () => {
      const source = 'const x = 42;\nlet y = "hello";\nvar z = true;';
      const captures = provider.parse(source, 'test.js');
      // tree-sitter detects variables as part of lexical_declaration nodes
      expect(captures.length).toBeGreaterThan(0);
    });

    it('should detect JSX components', () => {
      const source = 'const App = () => { return <div>Hello</div>; };';
      const captures = provider.parse(source, 'test.jsx');
      const components = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(components).toHaveLength(1);
      expect(components[0]!.name).toBe('App');
    });

    it('should detect imports as captures', () => {
      const source = 'import { useState } from "react";';
      const captures = provider.parse(source, 'test.js');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
    });

    it('should return results sorted by start line', () => {
      const source = 'const b = 2;\nfunction a() {}\nlet c = 3;';
      const captures = provider.parse(source, 'test.js');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should handle nested blocks', () => {
      const source = 'function outer() {\n  if (true) {\n    return true;\n  }\n  return false;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'outer',
      );
      expect(funcs).toHaveLength(1);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.js');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should parse star imports', () => {
      const source = 'import * as Utils from "./utils";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./utils');
      expect(imports[0]!.type).toBe('namespace');
    });

    it('should parse named imports', () => {
      const source = 'import { foo, bar } from "./module";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./module');
      expect(imports[0]!.type).toBe('named');
    });

    it('should parse default imports', () => {
      const source = 'import React from "react";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('default');
    });

    it('should return empty for no imports', () => {
      const imports = provider.extractImports('const x = 1;');
      expect(imports).toHaveLength(0);
    });

    it('should parse require() calls', () => {
      const source = 'const fs = require("fs");';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('fs');
      expect(imports[0]!.names).toContain('fs');
    });
  });

  describe('isExported', () => {
    it('should detect export named', () => {
      expect(provider.isExported('export { foo, bar }', 'foo')).toBe(true);
    });

    it('should detect export default function', () => {
      expect(provider.isExported('export default function App() {}', 'App')).toBe(true);
    });

    it('should detect export function', () => {
      expect(provider.isExported('export function init() {}', 'init')).toBe(true);
    });

    it('should return false for non-exported', () => {
      expect(provider.isExported('function internal() {}', 'internal')).toBe(false);
    });

    it('should return false for a different symbol in an export statement', () => {
      expect(provider.isExported('export { foo }', 'bar')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Special syntax — real grammar branches that valid input reaches
  // -------------------------------------------------------------------------

  describe('special syntax', () => {
    it('skips a computed class method (no property_identifier)', () => {
      const captures = provider.parse('class A { [foo]() {} }', 'test.js');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(0);
    });

    it('leaves containerName undefined for an object-literal method', () => {
      const captures = provider.parse('const obj = { method() {} }', 'test.js');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.containerName).toBeUndefined();
    });

    it('records an empty baseClasses for `extends null`', () => {
      const captures = provider.parse('class C extends null {}', 'test.js');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.properties?.baseClasses).toBe('');
    });

    it('does not name a callback arrow (parent is not a variable_declarator)', () => {
      const captures = provider.parse('const r = [1].map((x) => x);', 'test.js');
      const arrows = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
      );
      expect(arrows).toHaveLength(0);
    });

    it('skips a destructured arrow (no identifier in the declarator)', () => {
      const captures = provider.parse('const { a } = () => {};', 'test.js');
      const arrows = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
      );
      expect(arrows).toHaveLength(0);
    });

    it('skips a destructured const (no identifier binding)', () => {
      const captures = provider.parse('const { a } = 1;', 'test.js');
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts).toHaveLength(0);
    });

    it('ignores a non-JSDoc comment', () => {
      const captures = provider.parse('// plain comment\nfunction f() {}', 'test.js');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(0);
    });

    it('detects a function declaration returning JSX', () => {
      const captures = provider.parse('function App() { return <div>Hello</div>; }', 'test.jsx');
      const components = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(components).toHaveLength(1);
      expect(components[0]!.name).toBe('App');
    });

    it('skips a lowercase JSX component name', () => {
      const captures = provider.parse('const app = () => <div/>;', 'test.jsx');
      const components = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(components).toHaveLength(0);
    });
  });

  describe('import edge cases (real grammar)', () => {
    it('ignores a side-effect-only import', () => {
      const imports = provider.extractImports('import "polyfill";');
      expect(imports).toHaveLength(0);
    });

    it('ignores an empty named import', () => {
      const imports = provider.extractImports('import {} from "x";');
      expect(imports).toHaveLength(0);
    });

    it('ignores a non-require call expression', () => {
      const imports = provider.extractImports('compute(1, 2);');
      expect(imports).toHaveLength(0);
    });

    it('ignores a require() with a non-literal argument', () => {
      const imports = provider.extractImports('const x = require(someVar);');
      expect(imports).toHaveLength(0);
    });

    it('records a standalone require() with the path as the name', () => {
      const imports = provider.extractImports('require("fs");');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('fs');
      expect(imports[0]!.names).toEqual(['fs']);
    });

    it('records a destructured require() with the path as the name', () => {
      const imports = provider.extractImports('const { readFile } = require("fs");');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('fs');
      expect(imports[0]!.names).toEqual(['fs']);
    });
  });

  describe('export edge cases (real grammar)', () => {
    it('detects an exported class', () => {
      expect(provider.isExported('export class Foo {}', 'Foo')).toBe(true);
    });

    it('does not match a re-export of a different module', () => {
      expect(provider.isExported('export * from "other";', 'Foo')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Fallback methods (grammar unavailable)
// ---------------------------------------------------------------------------

describe('JavaScriptProvider fallback (grammar unavailable)', () => {
  const provider = new NoGrammarJavaScriptProvider();

  it('parses function declarations via regex', () => {
    const captures = provider.parse('function hello() { return 1; }', 'f.js');
    const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(funcs.some((f) => f.name === 'hello')).toBe(true);
  });

  it('parses exported async function declarations via regex', () => {
    const captures = provider.parse('export default async function run() {}', 'f.js');
    const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(funcs.some((f) => f.name === 'run')).toBe(true);
  });

  it('parses arrow functions via regex', () => {
    const captures = provider.parse('const double = (x) => x * 2;', 'f.js');
    const arrows = captures.filter(
      (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
    );
    expect(arrows.some((f) => f.name === 'double')).toBe(true);
  });

  it('parses class declarations via regex', () => {
    const captures = provider.parse('class Animal {}', 'f.js');
    const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(classes.some((c) => c.name === 'Animal')).toBe(true);
  });

  it('parses const/let/var declarations via regex', () => {
    const captures = provider.parse('const c = 1;\nlet l = 2;\nvar v = 3;', 'f.js');
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'c')).toBe(true);
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'l')).toBe(true);
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'v')).toBe(true);
  });

  it('extracts imports through the fallback parser', () => {
    const captures = provider.parse('import { a } from "m";\nfunction h() {}', 'f.js');
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'm')).toBe(true);
  });

  it('sorts captures by line number across multiple lines', () => {
    const captures = provider.parse('const a = 1;\nfunction b() {}', 'f.js');
    for (let i = 1; i < captures.length; i++) {
      expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
    }
  });

  it('sorts same-line captures by byte offset', () => {
    const captures = provider.parse('const a = 1; let b = 2;', 'f.js');
    expect(captures).toHaveLength(2);
    expect(captures[0]!.startByte).toBeLessThan(captures[1]!.startByte);
  });

  it('extracts namespace imports via regex', () => {
    const imports = provider.extractImports('import * as Utils from "./utils";');
    expect(imports[0]!.type).toBe('namespace');
    expect(imports[0]!.names).toEqual(['Utils']);
  });

  it('extracts named imports via regex', () => {
    const imports = provider.extractImports('import { a, b } from "./m";');
    expect(imports[0]!.type).toBe('named');
    expect(imports[0]!.names).toEqual(['a', 'b']);
  });

  it('extracts default imports via regex', () => {
    const imports = provider.extractImports('import React from "react";');
    expect(imports[0]!.type).toBe('default');
    expect(imports[0]!.names).toEqual(['React']);
  });

  it('extracts a destructured require via regex', () => {
    const imports = provider.extractImports('const { a, b } = require("m");');
    expect(imports[0]!.type).toBe('named');
    expect(imports[0]!.names).toEqual(['a', 'b']);
  });

  it('extracts a plain require via regex', () => {
    const imports = provider.extractImports('const fs = require("fs");');
    expect(imports[0]!.type).toBe('default');
    expect(imports[0]!.names).toEqual(['fs']);
  });

  it('returns no imports for plain source', () => {
    expect(provider.extractImports('const x = 1;')).toHaveLength(0);
  });

  it('detects module.exports assignments', () => {
    expect(provider.isExported('module.exports = foo;', 'foo')).toBe(true);
  });

  it('detects exports.x assignments', () => {
    expect(provider.isExported('exports.foo = bar;', 'foo')).toBe(true);
  });

  it('detects named export clauses', () => {
    expect(provider.isExported('export { foo };', 'foo')).toBe(true);
  });

  it('detects export default function', () => {
    expect(provider.isExported('export default function foo() {}', 'foo')).toBe(true);
  });

  it('detects export const', () => {
    expect(provider.isExported('export const foo = 1;', 'foo')).toBe(true);
  });

  it('returns false for non-exported symbols', () => {
    expect(provider.isExported('function foo() {}', 'foo')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defensive branches exercised with synthetic AST nodes
// ---------------------------------------------------------------------------

describe('JavaScriptProvider defensive branches (synthetic nodes)', () => {
  const provider = new TestableJavaScriptProvider();

  it('emits no capture for a function_declaration without an identifier', () => {
    const node = makeNode('function_declaration', [], 'function f() {}');
    const captures = provider.walkAndCaptureForTest(node);
    expect(captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF)).toEqual([]);
  });

  it('emits no capture for a class_declaration without an identifier', () => {
    const node = makeNode('class_declaration', [], 'class A {}');
    const captures = provider.walkAndCaptureForTest(node);
    expect(captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF)).toEqual([]);
  });

  it('leaves containerName undefined when the class has no identifier', () => {
    const classDecl = makeNode('class_declaration', [], 'class A {}');
    const method = makeNode(
      'method_definition',
      [makeNode('property_identifier', [], 'foo')],
      'foo() {}',
      classDecl,
    );
    const captures = provider.walkAndCaptureForTest(method);
    const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
    expect(methods).toHaveLength(1);
    expect(methods[0]!.containerName).toBeUndefined();
  });

  it('skips a lexical_declaration whose child is not a variable_declarator', () => {
    const node = makeNode('lexical_declaration', [makeNode('identifier', [], 'x')], 'let x');
    expect(provider.walkAndCaptureForTest(node)).toEqual([]);
  });

  it('emits an import capture with an empty path when the source string is absent', () => {
    const node = makeNode('import_statement', []);
    const captures = provider.walkAndCaptureForTest(node);
    const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.name).toBe('');
  });

  it('records no import when the source string is absent', () => {
    const node = makeNode('import_statement', [
      makeNode('import_clause', [makeNode('identifier', [], 'React')]),
    ]);
    expect(provider.walkForImportsForTest(node)).toEqual([]);
  });

  it('records no import for a namespace_import without an identifier', () => {
    const node = makeNode('import_statement', [
      makeNode('import_clause', [makeNode('namespace_import', [])]),
      makeNode('string', [], '"m"'),
    ]);
    expect(provider.walkForImportsForTest(node)).toEqual([]);
  });

  it('records no import for an import_specifier without any identifier', () => {
    const node = makeNode('import_statement', [
      makeNode('import_clause', [makeNode('named_imports', [makeNode('import_specifier', [])])]),
      makeNode('string', [], '"m"'),
    ]);
    expect(provider.walkForImportsForTest(node)).toEqual([]);
  });

  it('records no import for a require() call without an arguments node', () => {
    const node = makeNode('call_expression', [makeNode('identifier', [], 'require')]);
    expect(provider.walkForImportsForTest(node)).toEqual([]);
  });

  it('reports nothing exported for an export_clause without an export_specifier', () => {
    const node = makeNode('export_statement', [
      makeNode('export_clause', [makeNode('identifier', [], 'x')]),
    ]);
    expect(provider.checkExportedForTest(node, 'x')).toBe(false);
  });

  it('reports nothing exported for an export_specifier without an identifier', () => {
    const node = makeNode('export_statement', [
      makeNode('export_clause', [makeNode('export_specifier', [])]),
    ]);
    expect(provider.checkExportedForTest(node, 'foo')).toBe(false);
  });

  it('reports nothing exported for an exported function_declaration without an identifier', () => {
    const node = makeNode('export_statement', [makeNode('function_declaration', [])]);
    expect(provider.checkExportedForTest(node, 'foo')).toBe(false);
  });
});
