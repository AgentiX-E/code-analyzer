import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { TypeScriptProvider } from '../languages/typescript.js';

describe('TypeScriptProvider', () => {
  const provider = new TypeScriptProvider();

  describe('properties', () => {
    it('should have correct language and display name', () => {
      expect(provider.language).toBe('typescript');
      expect(provider.displayName).toBe('TypeScript');
    });

    it('should have TypeScript extensions', () => {
      expect(provider.extensions).toContain('.ts');
      expect(provider.extensions).toContain('.tsx');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect named function declarations', () => {
      const source = `function hello(): string {\n  return "hi";\n}`;
      const captures = provider.parse(source, 'test.ts');
      const funcDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcDefs).toHaveLength(1);
      expect(funcDefs[0]!.name).toBe('hello');
    });

    it('should detect arrow functions', () => {
      const source = `const double = (x: number): number => x * 2;`;
      const captures = provider.parse(source, 'test.ts');
      const arrowFuncs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
      );
      expect(arrowFuncs).toHaveLength(1);
      expect(arrowFuncs[0]!.name).toBe('double');
    });

    it('should detect class definitions', () => {
      const source = `class Animal {\n  name: string;\n}`;
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Animal');
    });

    it('should detect interface definitions', () => {
      const source = `interface Person {\n  name: string;\n  age: number;\n}`;
      const captures = provider.parse(source, 'test.ts');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]!.name).toBe('Person');
    });

    it('should detect enum definitions', () => {
      const source = `enum Color { Red, Green, Blue }`;
      const captures = provider.parse(source, 'test.ts');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums).toHaveLength(1);
      expect(enums[0]!.name).toBe('Color');
    });

    it('should detect type aliases', () => {
      const source = `type Point = { x: number; y: number; }`;
      const captures = provider.parse(source, 'test.ts');
      const types = captures.filter((c) => c.tag === CAPTURE_TAGS.TYPE_DEF);
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('Point');
    });

    it('should detect variable declarations', () => {
      const source = `const x: number = 42;\nlet y = "hello";`;
      const captures = provider.parse(source, 'test.ts');
      const vars = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF || c.tag === CAPTURE_TAGS.VARIABLE_DEF,
      );
      expect(vars.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect var declarations (variable_declaration node)', () => {
      const source = 'var legacy: number = 1;\n';
      const captures = provider.parse(source, 'test.ts');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(1);
      expect(vars[0]!.name).toBe('legacy');
    });

    it('should detect imports', () => {
      const source = `import { useState } from 'react';`;
      const captures = provider.parse(source, 'test.ts');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.name).toBe('react');
    });

    it('should return captures sorted by line number', () => {
      const source = `const b = 2;\nfunction a() {}\nlet c = 3;`;
      const captures = provider.parse(source, 'test.ts');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should detect class methods and constructors', () => {
      const source =
        'class User {\n  constructor(public name: string) {}\n  getInfo(): string { return this.name; }\n}';
      const captures = provider.parse(source, 'test.ts');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(constructors).toHaveLength(1);
      expect(constructors[0]!.containerName).toBe('User');
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('getInfo');
    });

    it('should handle multiple class methods', () => {
      const source =
        'class Service {\n  private doInternal(): void {}\n  protected getData(): string { return ""; }\n  public handle(): void {}\n}';
      const captures = provider.parse(source, 'test.ts');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(3);
      const names = methods.map((m) => m.name);
      expect(names).toContain('doInternal');
      expect(names).toContain('getData');
      expect(names).toContain('handle');
    });

    it('should detect static methods', () => {
      const source = 'class Utils {\n  static create(): any {}\n}';
      const captures = provider.parse(source, 'test.ts');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('create');
    });

    it('should handle generic type parameters', () => {
      const source = 'function identity<T>(arg: T): T { return arg; }';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const identity = funcs.find((f) => f.name === 'identity');
      expect(identity).toBeDefined();
    });

    it('should handle type alias with generics', () => {
      const source = 'type Container<T> = { value: T };';
      const captures = provider.parse(source, 'test.ts');
      const types = captures.filter((c) => c.tag === CAPTURE_TAGS.TYPE_DEF);
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('Container');
    });

    it('should handle async function', () => {
      const source = 'async function fetchData(): Promise<string> { return ""; }';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const asyncFunc = funcs.find((f) => f.name === 'fetchData');
      expect(asyncFunc).toBeDefined();
    });

    it('should handle const enum definitions', () => {
      const source = 'const enum Status { Active, Inactive }';
      const captures = provider.parse(source, 'test.ts');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums).toHaveLength(1);
      expect(enums[0]!.name).toBe('Status');
    });

    it('should handle block comments in source', () => {
      const source = 'function parse(): void {\n  /* multi-line\n     comment */\n  return;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'parse',
      );
      expect(funcs).toHaveLength(1);
    });

    it('should handle strings with special characters', () => {
      const source = 'function getTemplate(): string {\n  return "{ code } block";\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'getTemplate',
      );
      expect(funcs).toHaveLength(1);
    });

    it('should handle nested block structures', () => {
      const source =
        'function outer(): void {\n  if (true) {\n    while (false) {\n      break;\n    }\n  }\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'outer',
      );
      expect(funcs).toHaveLength(1);
    });

    it('should handle variable with type annotation', () => {
      const source = 'const config: Record<string, unknown> = {};\nlet state: "active" = "active";';
      const captures = provider.parse(source, 'test.ts');
      expect(captures.length).toBeGreaterThan(0);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle source with only comments', () => {
      const source = '// comment\n/* block */';
      const captures = provider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should detect export function', () => {
      const source = 'export function init(): void {}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('init');
    });

    it('should detect JSDoc comments', () => {
      const source = '/** A documented function */\nfunction doc(): void {}\n';
      const captures = provider.parse(source, 'test.ts');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
    });

    it('should detect export class', () => {
      const source = 'export class Service {}';
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Service');
    });
  });

  describe('extractImports', () => {
    it('should parse named imports', () => {
      const source = `import { foo, bar } from './module';`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./module');
      expect(imports[0]!.names).toContain('foo');
      expect(imports[0]!.names).toContain('bar');
      expect(imports[0]!.type).toBe('named');
    });

    it('should parse default imports', () => {
      const source = `import React from 'react';`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('default');
      expect(imports[0]!.names).toContain('React');
    });

    it('should parse namespace imports', () => {
      const source = `import * as Utils from './utils';`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('namespace');
      expect(imports[0]!.names).toContain('Utils');
    });

    it('should detect import line numbers', () => {
      const source = `// line 1\nimport { foo } from './bar';`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.lineNumber).toBe(2);
    });

    it('should handle dynamic imports', () => {
      const source = `const mod = await import('./dynamic');`;
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports.some((i) => i.source === './dynamic')).toBe(true);
    });

    it('should parse named imports with alias', () => {
      const source = "import { foo as bar, baz } from './module';";
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      // The local binding (alias `bar`) is recorded, matching the regex fallback.
      expect(imports[0]!.names).toContain('bar');
      expect(imports[0]!.names).toContain('baz');
      expect(imports[0]!.names).not.toContain('foo');
    });

    it('skips a malformed aliased import with an empty alias', () => {
      // `foo as` leaves an empty trailing identifier; the empty local binding is
      // skipped rather than recorded.
      const imports = provider.extractImports('import { foo as } from "x";');
      expect(imports).toHaveLength(0);
    });

    it('should parse type imports', () => {
      const source = "import type { MyType } from './types';";
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./types');
    });

    it('should return empty for no imports', () => {
      const imports = provider.extractImports('const x = 1;');
      expect(imports).toHaveLength(0);
    });
  });

  describe('isExported', () => {
    it('should detect exported functions', () => {
      expect(provider.isExported('export function foo() {}', 'foo')).toBe(true);
    });

    it('should detect exported classes', () => {
      expect(provider.isExported('export class Foo {}', 'Foo')).toBe(true);
    });

    it('should detect named exports', () => {
      expect(provider.isExported('export { foo, bar };', 'foo')).toBe(true);
    });

    it('should return false for non-exported symbols', () => {
      expect(provider.isExported('function internal() {}', 'internal')).toBe(false);
    });

    it('should detect export default function', () => {
      expect(provider.isExported('export default function MyFunc() {}', 'MyFunc')).toBe(true);
    });

    it('should detect export default class', () => {
      expect(provider.isExported('export default class MyClass {}', 'MyClass')).toBe(true);
    });

    it('should detect export const', () => {
      expect(provider.isExported('export const VERSION = 1;', 'VERSION')).toBe(true);
    });

    it('should detect export let', () => {
      expect(provider.isExported('export let counter = 0;', 'counter')).toBe(true);
    });

    it('should detect export interface', () => {
      expect(provider.isExported('export interface Config {}', 'Config')).toBe(true);
    });

    it('should detect export type alias', () => {
      expect(provider.isExported('export type ID = string;', 'ID')).toBe(true);
    });

    it('should detect export enum', () => {
      expect(provider.isExported('export enum Status { On }', 'Status')).toBe(true);
    });

    it('should return false for a different symbol in an export statement', () => {
      expect(provider.isExported('export function foo() {}', 'bar')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle function with commented braces', () => {
      const source = 'function test(): void {\n  // line comment\n  const x = 1;\n  return;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'test',
      );
      expect(funcs).toHaveLength(1);
    });

    it('should handle template literals', () => {
      const source =
        'function template(): string {\n  const s = `nested { block } here`;\n  return s;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'template',
      );
      expect(funcs).toHaveLength(1);
    });

    it('should handle deeply nested structures', () => {
      const source =
        'function compute() {\n  for (let i = 0; i < 10; i++) {\n    if (i > 5) {\n      return i;\n    }\n  }\n  return 0;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'compute',
      );
      expect(funcs).toHaveLength(1);
    });
  });

  describe('destructuring (no identifier name)', () => {
    it('skips object-destructured var', () => {
      const captures = provider.parse('var { a, b } = obj;\n', 'test.ts');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(0);
    });

    it('skips array-destructured var', () => {
      const captures = provider.parse('var [a, b] = arr;\n', 'test.ts');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(0);
    });

    it('skips object-destructured const', () => {
      const captures = provider.parse('const { a } = obj;\n', 'test.ts');
      const defs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF || c.tag === CAPTURE_TAGS.VARIABLE_DEF,
      );
      expect(defs).toHaveLength(0);
    });
  });

  describe('arrow function parent contexts', () => {
    it('does not name callbacks (parent is arguments)', () => {
      const captures = provider.parse('const r = [1].map((x) => x * 2);', 'test.ts');
      const arrows = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
      );
      expect(arrows).toHaveLength(0);
    });

    it('captures the outer const of a mapped call', () => {
      const captures = provider.parse('const r = [1].map((x) => x * 2);', 'test.ts');
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts.some((c) => c.name === 'r')).toBe(true);
    });

    it('skips destructured arrow names (no identifier)', () => {
      const captures = provider.parse('const { a } = () => {};', 'test.ts');
      const arrows = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
      );
      expect(arrows).toHaveLength(0);
    });
  });

  describe('dynamic import variants', () => {
    it('skips non-literal dynamic imports', () => {
      const imports = provider.extractImports('import(specifier);');
      expect(imports).toHaveLength(0);
    });

    it('skips empty named imports (side-effect only)', () => {
      const imports = provider.extractImports('import {} from "x";');
      expect(imports).toHaveLength(0);
    });

    it('ignores plain call expressions (no dynamic import)', () => {
      const imports = provider.extractImports('const r = compute(1, 2);');
      expect(imports).toHaveLength(0);
    });
  });

  describe('export aliases', () => {
    it('matches the local name of an aliased export', () => {
      expect(provider.isExported('export { foo as bar };', 'foo')).toBe(true);
    });

    it('matches the alias of an aliased export', () => {
      expect(provider.isExported('export { foo as bar };', 'bar')).toBe(true);
    });

    it('does not match an unrelated symbol in an aliased export', () => {
      expect(provider.isExported('export { foo as bar };', 'baz')).toBe(false);
    });
  });

  describe('decorators', () => {
    it('captures a class decorator', () => {
      const captures = provider.parse('@Component({ selector: "app" })\nclass App {}', 'test.ts');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('container name extraction', () => {
    it('resolves an enum container via its identifier name', () => {
      const source = 'enum E { /** doc */ A = 1 }';
      const captures = provider.parse(source, 'test.ts');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.containerName).toBe('E');
    });

    it('leaves the container name undefined for a nameless object type', () => {
      const source = 'type X = { /** doc */ m: () => void }';
      const captures = provider.parse(source, 'test.ts');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.containerName).toBeUndefined();
    });
  });

  describe('call sites', () => {
    it('captures new expressions', () => {
      const captures = provider.parse('new Foo();', 'test.ts');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.NEW_EXPRESSION)).toBe(true);
    });

    it('captures method calls as function calls with method callType', () => {
      const captures = provider.parse('obj.method();', 'test.ts');
      const call = captures.find((c) => c.name === 'method');
      expect(call).toBeDefined();
      // tree-sitter-typescript emits `call_expression` (not `method_invocation`),
      // so the tag is FUNCTION_CALL while the callType metadata marks it a method.
      expect(call!.tag).toBe(CAPTURE_TAGS.FUNCTION_CALL);
      expect(call!.properties?.callType).toBe('method');
    });
  });

  describe('fallbackParse (regex fallback)', () => {
    it('falls back to regex on a syntax error', () => {
      const captures = provider.parse('function broken(', 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((f) => f.name === 'broken')).toBe(true);
    });

    it('detects functions and classes', () => {
      const captures = provider.fallbackParse('function alpha() {}\nclass Beta {}', 'f.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(funcs.some((f) => f.name === 'alpha')).toBe(true);
      expect(classes.some((c) => c.name === 'Beta')).toBe(true);
    });

    it('detects interfaces, type aliases, and enums', () => {
      const src = 'interface I {}\ntype T = string;\nenum E { A }';
      const captures = provider.fallbackParse(src, 't.ts');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF && c.name === 'I')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.TYPE_DEF && c.name === 'T')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.ENUM_DEF && c.name === 'E')).toBe(true);
    });

    it('detects arrow functions and variables', () => {
      const src = 'const f = () => {};\nconst c = 1;\nlet l = 2;\nvar v = 3;';
      const captures = provider.fallbackParse(src, 'v.ts');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'f')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'c')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'l')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'v')).toBe(
        true,
      );
    });

    it('detects decorators and JSDoc', () => {
      const src = '@Component()\n/** doc */\nfunction g() {}';
      const captures = provider.fallbackParse(src, 'd.ts');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.DECORATOR)).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.DOCSTRING)).toBe(true);
    });

    it('extracts imports through the fallback parser', () => {
      const src = 'import { a } from "m";\nfunction h() {}';
      const captures = provider.fallbackParse(src, 'i.ts');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'm')).toBe(true);
    });

    it('sorts same-line captures by byte offset', () => {
      const captures = provider.fallbackParse('const a = 1; let b = 2;', 's.ts');
      expect(captures).toHaveLength(2);
      expect(captures[0]!.startByte).toBeLessThan(captures[1]!.startByte);
    });
  });

  describe('fallbackExtractImports (regex fallback)', () => {
    it('parses named imports', () => {
      const imports = provider.fallbackExtractImports('import { a, b } from "./m";');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('named');
      expect(imports[0]!.names).toEqual(['a', 'b']);
    });

    it('parses aliased named imports (records the alias)', () => {
      const imports = provider.fallbackExtractImports('import { foo as bar } from "./m";');
      expect(imports[0]!.names).toEqual(['bar']);
    });

    it('parses namespace imports', () => {
      const imports = provider.fallbackExtractImports('import * as ns from "./m";');
      expect(imports[0]!.type).toBe('namespace');
      expect(imports[0]!.names).toEqual(['ns']);
    });

    it('parses default imports', () => {
      const imports = provider.fallbackExtractImports('import React from "react";');
      expect(imports[0]!.type).toBe('default');
      expect(imports[0]!.names).toEqual(['React']);
    });

    it('parses dynamic imports', () => {
      const imports = provider.fallbackExtractImports('const m = import("./dyn");');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./dyn');
    });

    it('returns empty for no imports', () => {
      expect(provider.fallbackExtractImports('const x = 1;')).toHaveLength(0);
    });
  });

  describe('fallbackIsExported (regex fallback)', () => {
    it('detects exported declarations', () => {
      expect(provider.fallbackIsExported('export function f() {}', 'f')).toBe(true);
      expect(provider.fallbackIsExported('export class C {}', 'C')).toBe(true);
      expect(provider.fallbackIsExported('export const x = 1;', 'x')).toBe(true);
    });

    it('detects named export clauses', () => {
      expect(provider.fallbackIsExported('export { foo };', 'foo')).toBe(true);
      expect(provider.fallbackIsExported('export { foo as bar };', 'bar')).toBe(true);
    });

    it('returns false for non-exported symbols', () => {
      expect(provider.fallbackIsExported('function f() {}', 'f')).toBe(false);
    });
  });
});
