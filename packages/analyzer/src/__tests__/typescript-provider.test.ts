import { CAPTURE_TAGS, type CaptureTag } from '@code-analyzer/shared';
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
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.['arrow'] === 'true',
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

  // **`extends` and `implements` share one clause, and only one of them is a base class.** The resolver walks bases to
  // find a member, so recording an interface as a base sends it looking for a body that does not exist - and recording
  // none where the source names one leaves the call unresolvable. Both directions are stated here because the clause
  // is written one way and means two things.
  describe('the class a declaration extends', () => {
    const heritageOf = (
      source: string,
    ): { baseClasses?: string; interfaces?: string } | undefined =>
      provider.parse(source, 'test.ts').find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF)?.properties;

    it('records the extended class and nothing else when both are named', () => {
      const properties = heritageOf('class Child extends Base implements Thing {}');
      expect(properties?.['baseClasses']).toBe('Base');
      expect(properties?.['interfaces']).toBe('Thing');
    });

    it('takes the head of a generic base', () => {
      expect(heritageOf('class Child extends Base<Item> {}')?.['baseClasses']).toBe('Base');
    });

    it('records no base class for a class that only implements', () => {
      // **This is the arm the base provider had to keep**: a heritage clause with no `extends` in it is a class that
      // conforms to interfaces and extends nothing, which is `class Repository implements Store {}`.
      const properties = heritageOf('class Repository implements Store, Closeable {}');
      expect(properties?.['baseClasses']).toBeUndefined();
      expect(properties?.['interfaces']).toBe('Store,Closeable');
    });

    it('records no base class for a class that neither extends nor implements', () => {
      const properties = heritageOf('class Plain {}');
      expect(properties?.['baseClasses']).toBeUndefined();
    });
  });

  // **A field's declared type leaves the parse as one property on its class**, which is what the receiver's-type arm
  // reads. Every case below is a shape that either produces that property or must not: a field without an annotation,
  // a computed key, a name a class declares twice, and an interface, whose members are fields without bodies.
  describe('field types, filed on the class', () => {
    const TYPE_TAGS: readonly CaptureTag[] = [
      CAPTURE_TAGS.CLASS_DEF,
      CAPTURE_TAGS.INTERFACE_DEF,
      CAPTURE_TAGS.STRUCT_DEF,
    ];
    const classNode = (captures: ReturnType<typeof provider.parse>, name: string): unknown =>
      captures.find((capture) => TYPE_TAGS.includes(capture.tag) && capture.name === name)
        ?.properties?.['fieldTypes'];

    it('records what a field was declared to be', () => {
      const captures = provider.parse(
        'class Holder {\n  index: Index;\n  name: string;\n  run(): void {}\n}',
        '/p/a.ts',
      );
      expect(classNode(captures, 'Holder')).toBe(
        JSON.stringify({ index: 'Index', name: 'string' }),
      );
    });

    it('records an interface member the same way, because an interface declares fields too', () => {
      const captures = provider.parse('interface Shape {\n  radius: Radius;\n}', '/p/a.ts');
      expect(classNode(captures, 'Shape')).toBe(JSON.stringify({ radius: 'Radius' }));
    });

    it('says nothing about a class whose fields state no type at all', () => {
      // **A field with neither an annotation nor a construction is a value this provider cannot reduce**, and the
      // refusal is unchanged: `count = 0` and `index = build()` name no class. A construction *is* a type fact, which
      // is the rule below.
      const captures = provider.parse(
        'class Holder {\n  count = 0;\n  index = build();\n}',
        '/p/a.ts',
      );
      expect(classNode(captures, 'Holder')).toBeUndefined();
    });

    it('refuses a computed key, whose name is not a property name', () => {
      const captures = provider.parse('class Holder {\n  [key: string]: Index;\n}', '/p/a.ts');
      expect(classNode(captures, 'Holder')).toBeUndefined();
    });

    it('drops a name the class declares twice with two different types', () => {
      // A field declared twice with two types has no type a resolution can defend, and the same rule the resolver
      // applies to every other name applies here.
      const captures = provider.parse(
        'class Holder {\n  index: Index;\n}\ninterface Holder {\n  index: Other;\n}',
        '/p/a.ts',
      );
      expect(classNode(captures, 'Holder')).toBeUndefined();
    });

    it('keeps a name the class declares twice with the same type', () => {
      const captures = provider.parse(
        'class Holder {\n  index: Index;\n}\ninterface Holder {\n  index: Index;\n}',
        '/p/a.ts',
      );
      expect(classNode(captures, 'Holder')).toBe(JSON.stringify({ index: 'Index' }));
    });

    it('names a function assigned to a bare identifier', () => {
      // `handlers = function () {}` - the name is the identifier on the left, which is the arm beside the member one.
      const captures = provider.parse('handlers = function () {};', '/p/a.ts');
      expect(captures.filter((capture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF)).toHaveLength(
        1,
      );
    });

    it('refuses a function assigned through a computed member, whose name is a value', () => {
      // `handlers[name] = function () {}` defines a function whose name nobody can spell, so it is not emitted.
      const captures = provider.parse('handlers[0] = function () {};', '/p/a.ts');
      expect(captures.filter((capture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF)).toHaveLength(
        0,
      );
    });

    it('refuses a field whose key is not a property name', () => {
      // A quoted key is a `string` node, not a `property_identifier`, so there is no name to file the type under.
      const captures = provider.parse("class Holder {\n  'a-b': Index;\n}", '/p/a.ts');
      expect(classNode(captures, 'Holder')).toBeUndefined();
    });

    it('leaves the class alone when a field sits outside one', () => {
      // A field declaration is only ever read inside a class or an interface body; the guard is what says so if a
      // dialect ever hands one over elsewhere.
      const captures = provider.parse('const holder = { index: new Index() };', '/p/a.ts');
      expect(classNode(captures, 'holder')).toBeUndefined();
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

  describe('re-exports', () => {
    // **A barrel publishes names and binds none.** The resolver needs the published name and the name the target
    // declares, and it needs them as a record of their own rather than as an import - see `export-chain.test.ts` for
    // the four ways the chain can end.
    it('records a star re-export as a star', () => {
      const imports = provider.extractImports(`export * from './leaf';`);
      expect(imports).toEqual([
        { source: './leaf', names: ['*'], type: 'reexport', lineNumber: 1 },
      ]);
    });

    it('records a renaming clause as the published name and the local one', () => {
      const imports = provider.extractImports(`export { parse as go, keep } from './types';`);
      expect(imports).toEqual([
        {
          source: './types',
          names: ['go'],
          type: 'reexport',
          alias: 'parse',
          lineNumber: 1,
        },
        {
          source: './types',
          names: ['keep'],
          type: 'reexport',
          alias: 'keep',
          lineNumber: 1,
        },
      ]);
    });

    it('ignores a clause with no source, which publishes a local declaration', () => {
      // `export { local }` names a declaration this file already makes; the file's own index answers it.
      expect(provider.extractImports('export { local };')).toEqual([]);
    });

    it('ignores a namespace re-export, which publishes one value rather than the module names', () => {
      // `export * as ns from './x'` exports the module object; `ns.member()` is a member of a value.
      expect(provider.extractImports(`export * as ns from './leaf';`)).toEqual([]);
    });

    it('still finds a dynamic import inside an exported declaration', () => {
      // **The statement is read, not skipped.** Closing the walk over an `export_statement` to read its header would
      // lose `import()` in the body of a declaration it exports.
      const imports = provider.extractImports(`export const load = async () => import('./lazy');`);
      expect(imports.some((entry) => entry.source === './lazy')).toBe(true);
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
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.['arrow'] === 'true',
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
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.['arrow'] === 'true',
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

    it('captures a method call once, as a method call, with the callee it was made on', () => {
      const captures = provider.parse('obj.method();', 'test.ts');
      const calls = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.METHOD_CALL || c.tag === CAPTURE_TAGS.FUNCTION_CALL,
      );
      // **One capture, not two.** The provider used to emit its own call capture and the base walk emitted another,
      // so this expression produced two identical references and therefore two `CALLS` edges - a fan-in of two for
      // a call made once.
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.name).toBe('method');
      // **`METHOD_CALL` because the tag is what carries the receiver.** `text` is the callee, so `obj` is readable
      // from it; `callType` says the same thing in a property nothing in the resolver reads.
      expect(call.tag).toBe(CAPTURE_TAGS.METHOD_CALL);
      expect(call.text).toBe('obj.method');
      expect(call.properties?.['callType']).toBe('method');
    });
  });

  describe('parameters, arguments and returns — the three facts an inter-procedural flow needs', () => {
    it('records the position each parameter is declared at', () => {
      // **A call site passes argument 1; the callee declares argument 1 second.** The position is the only handle the
      // two sides agree on, and without it a call's value could not be matched to the parameter it lands in.
      const captures = provider.parse('function inner(x: string, y: number): void {}', 'test.ts');
      const parameters = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(parameters.map((c) => c.name)).toEqual(['x', 'y']);
      expect(parameters.map((c) => c.properties?.['parameterIndex'])).toEqual(['0', '1']);
    });

    it('records the argument each name sits in', () => {
      // `run(a + b, `x${c}`)` is two arguments holding three names; a flow that lands on the wrong one reaches a
      // parameter the callee does not have.
      const captures = provider.parse('run(a + b, `x${c}`);', 'test.ts');
      const accesses = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS);
      const byName = new Map(accesses.map((c) => [c.name, c.properties?.['argIndex']]));
      expect(byName.get('a')).toBe('0');
      expect(byName.get('b')).toBe('0');
      expect(byName.get('c')).toBe('1');
    });

    it('records the names a return hands back, anchored to the return line', () => {
      const captures = provider.parse('function f(x: string) {\n  return x;\n}', 'test.ts');
      const returned = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS && c.name === 'x',
      );
      expect(returned.some((c) => c.startLine === 2)).toBe(true);
    });

    it('records nothing for a bare return', () => {
      // `return;` hands back no value, and an empty name list is the answer rather than a missing one.
      const captures = provider.parse('function f() {\n  return;\n}', 'test.ts');
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS)).toHaveLength(0);
    });

    it('records an import through the tree walk', () => {
      const captures = provider.parse('import { a } from "./m";', 'test.ts');
      expect(captures.length).toBeGreaterThan(0);
      expect(captures[0]!.tag).toBe(CAPTURE_TAGS.IMPORT);
    });

    it('records a call with no arguments as a call', () => {
      const captures = provider.parse('helper();', 'test.ts');
      expect(
        captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.name === 'helper'),
      ).toBe(true);
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

// ---------------------------------------------------------------------------
// Functions defined by assignment
// ---------------------------------------------------------------------------

describe('a function assigned to a member', () => {
  const local = new TypeScriptProvider();
  const defs = (source: string): string[] =>
    local
      .parse(source, 'app.ts')
      .filter((capture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF)
      .map((capture) => capture.name ?? '');

  it('is a definition, named by the member it is assigned to', () => {
    expect(
      defs('app.use = function use(fn: Handler): void {\n  this.router.use(fn);\n};\n'),
    ).toEqual(['use']);
  });

  it('takes the last segment of a prototype path', () => {
    expect(defs('Router.prototype.handle = function (req: Req): void {};\n')).toEqual(['handle']);
  });

  it('is a definition when the right side is an arrow function', () => {
    // **The arrow arm already existed, but only for a `variable_declarator` parent**: an arrow assigned to a member
    // declares nothing, so the index had no name for it either.
    expect(defs('app.engine = (ext: string): string => ext;\n')).toEqual(['engine']);
  });

  it('is not invented when the member is computed', () => {
    expect(defs('handlers[name] = function () {\n  return 1;\n};\n')).toEqual([]);
  });

  it('is not invented when the right side is not a function', () => {
    expect(defs('app.port = 3000;\nconst typed: number = 1;\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two class spellings the walk did not file
// ---------------------------------------------------------------------------

// **`abstract class` is a class, and this grammar gives it its own node type.** `export abstract class ZodType<…>` is
// where `colinhacks/zod@3.23.8` declares its entire type system, so every member of it was a member of nothing:
// `this.nullable()` and the forty methods beside it resolved against no class at all, and `redis/ioredis@v5.4.2` spells
// `AbstractConnector` the same way. The fix is the same fact stated three times - the node is a container, it is
// captured as a class, and its heritage clause is read - which is why it is one set and not three conditions.
describe('a class written abstract', () => {
  const local = new TypeScriptProvider();

  it('is a class, with the members it declares', () => {
    const source = [
      'export abstract class Shape {',
      '  abstract area(): number;',
      '  describe(): string { return ""; }',
      '}',
    ].join('\n');
    const captures = local.parse(source, 'shape.ts');
    const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(classes.map((c) => c.name)).toEqual(['Shape']);
    const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
    expect(methods.map((c) => c.containerName)).toEqual(['Shape', 'Shape']);
  });

  it('reads the heritage clause written as an abstract class', () => {
    const source = 'abstract class Base { }\nabstract class Child extends Base { }';
    const child = local
      .parse(source, 'shape.ts')
      .find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Child');
    expect(child?.properties?.['baseClasses']).toBe('Base');
  });

  it('is exported when it says so', () => {
    // The `export` flag is the parse phase's property and not this provider's, so the question is asked of the
    // predicate that phase calls.
    expect(local.isExported('export abstract class Shape { }', 'Shape')).toBe(true);
    expect(local.isExported('abstract class Shape { }', 'Shape')).toBe(false);
  });
});

// **A class expression is a class too, and its body belongs to it.** `this.Command = class CustomScriptCommand extends
// Command { toWritable() {…} }` is how `redis/ioredis@5.4.2` writes `Script`, and every member of that class was
// attributed to the class *containing the expression* - `Holder3` in the fixture below - which is worse than filing
// nothing: a call inside it resolved against a class it has no relation to.
describe('a class written as an expression', () => {
  const local = new TypeScriptProvider();

  it('is a class when it is named, with the members it declares', () => {
    const source = [
      'export class Outer {',
      '  make(): unknown {',
      '    return class Inner extends Base { run(): void { } };',
      '  }',
      '}',
    ].join('\n');
    const captures = local.parse(source, 'outer.ts');
    const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(classes.map((c) => c.name)).toEqual(['Outer', 'Inner']);
    const run = captures.find((c) => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'run');
    expect(run?.containerName).toBe('Inner');
  });

  it('leaves the members of an anonymous one with no container', () => {
    // **An anonymous class declares no name to belong to**, and the outer class is not it: a call inside the body is a
    // call on the anonymous instance. Filing it under `Outer` would answer an unrelated class's member.
    const source = [
      'export class Outer {',
      '  make(): unknown {',
      '    return class { run(): void { } };',
      '  }',
      '}',
    ].join('\n');
    const captures = local.parse(source, 'outer.ts');
    const run = captures.find((c) => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'run');
    expect(run?.containerName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The type facts a declaration states without an annotation
// ---------------------------------------------------------------------------

// **A type alias names a type.** `export type ZodTypeAny = ZodType<any, any, any>` is the only spelling zod's own tests
// use for their helper parameters - `function checkErrors(a: z.ZodTypeAny, bad: any)` - and a resolver that stopped at
// the alias answered nothing for `a.nullable().parse(bad)` in eight test files. The alias is a statement about a name
// and not an inference: the right-hand side either names a type or it does not.
describe('a type alias', () => {
  const local = new TypeScriptProvider();

  const aliasOf = (source: string, name: string) =>
    local.parse(source, 'alias.ts').find((c) => c.tag === CAPTURE_TAGS.TYPE_DEF && c.name === name)
      ?.properties?.['aliasOf'];

  it('names the type its right-hand side names', () => {
    expect(aliasOf('export type Any = ZodType<any, any, any>;', 'Any')).toBe('ZodType');
    expect(aliasOf('type Direct = Client;', 'Direct')).toBe('Client');
  });

  it('names nothing for an alias of a shape or a union', () => {
    // `type Point = { x: number }` and `type Value = string | number` are shapes, not names of a class.
    expect(aliasOf('type Point = { x: number };', 'Point')).toBeUndefined();
    expect(aliasOf('type Value = string | number;', 'Value')).toBeUndefined();
  });

  it('names nothing for a qualified target, which the file does not resolve alone', () => {
    // `import * as z from "./index"` then `type T = z.Base` - the qualifier is the resolver's import pass, and this
    // provider files what the declaration spells.
    expect(aliasOf('type T = z.Base;', 'T')).toBeUndefined();
  });
});

// **A class property whose value is a function declares what it returns.** `static create = (): ZodString => {…}` is
// how zod writes every constructor in its type system, and the capture said `fieldFunction: 'true'` and stopped there -
// so `const stringType = ZodString.create` had nothing to inherit a return type from.
describe('a class property whose value is a function', () => {
  const local = new TypeScriptProvider();

  it('declares the return type its arrow writes', () => {
    const source = [
      'class ZodString {',
      '  static create = (): ZodString => new ZodString();',
      '}',
    ].join('\n');
    const create = local
      .parse(source, 'z.ts')
      .find((c) => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'create');
    expect(create?.properties?.['returnType']).toBe(': ZodString');
  });

  it('declares none when the arrow writes none', () => {
    const source = ['class ZodString {', '  static create = () => new ZodString();', '}'].join(
      '\n',
    );
    const create = local
      .parse(source, 'z.ts')
      .find((c) => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'create');
    expect(create?.properties?.['returnType']).toBeUndefined();
  });
});

// **A field initialised by a construction holds that class.** `private other = new Box()` wrote no annotation and was
// filed as nothing, so `this.other.run()` had no receiver. The initialiser is a declaration the same way an annotation
// is: it names one class and the language reads the field as that class.
describe('a field initialised by a construction', () => {
  const local = new TypeScriptProvider();

  const fieldTypesOf = (source: string, name: string) =>
    JSON.parse(
      String(
        local
          .parse(source, 'box.ts')
          .find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === name)?.properties?.[
          'fieldTypes'
        ] ?? '{}',
      ),
    ) as Record<string, string>;

  it('holds the class it constructs', () => {
    const source = ['class Holder {', '  private other = new Box();', '}'].join('\n');
    expect(fieldTypesOf(source, 'Holder')).toEqual({ other: 'Box' });
  });

  it('does not overrule an annotation it was written beside', () => {
    const source = ['class Holder {', '  private other: Contract = new Box();', '}'].join('\n');
    expect(fieldTypesOf(source, 'Holder')).toEqual({ other: 'Contract' });
  });

  it('holds nothing for an initialiser that constructs nothing', () => {
    const source = [
      'class Holder {',
      '  private other = build();',
      '  private count = 0;',
      '}',
    ].join('\n');
    expect(fieldTypesOf(source, 'Holder')).toEqual({});
  });
});

// **A name bound to a member holds what that member returns.** `const stringType = ZodString.create` is the whole of
// zod's shorthand constructor family: `const ostring = () => stringType().optional()` cannot be typed without knowing
// that calling `stringType` returns a `ZodString`. The binding is written, not inferred - the value is `Class.member`
// and nothing else - so it is filed as the path the reader resolves, exactly as a `for…of` binding is.
describe('a name bound to a member', () => {
  const local = new TypeScriptProvider();

  /** Everything one declaration carries about the names written around it: its own locals and the module's. */
  const localsOf = (source: string, name: string) => {
    const capture = local
      .parse(source, 'z.ts')
      .find((c) => c.name === name && c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    const own = JSON.parse(String(capture?.properties?.['localTypes'] ?? '{}')) as Record<
      string,
      string
    >;
    const module = JSON.parse(String(capture?.properties?.['moduleLocals'] ?? '{}')) as Record<
      string,
      string
    >;
    return { ...module, ...own };
  };

  it('records the member as the path a call returns from', () => {
    const source = [
      'const ostring = (): unknown => {',
      '  const maker = ZodString.create;',
      '  return maker();',
      '};',
    ].join('\n');
    expect(localsOf(source, 'ostring')).toEqual({ maker: '@calls:ZodString.create' });
  });

  it('records a module-scope binding, which every declaration in the file can reach', () => {
    // **A binding written outside a function is visible to the whole file**, and zod writes its whole shorthand family
    // that way. The owner key is empty because no function owns the declaration.
    const source = [
      'const stringType = ZodString.create;',
      'const ostring = (): unknown => stringType();',
    ].join('\n');
    expect(localsOf(source, 'ostring')).toEqual({ stringType: '@calls:ZodString.create' });
  });

  it('records a member of a name that may hold no class, and leaves the reader to decide', () => {
    // **The provider files the spelling and the reader holds the classes.** `box.open` names a member of *something*,
    // and whether `box` is a class is a question this file cannot answer - the same split a `for…of` binding makes
    // when it files `this.leaves` without reducing it.
    const source = [
      'const ostring = (): unknown => {',
      '  const maker = build();',
      '  const other = box.open;',
      '  return maker(other);',
      '};',
    ].join('\n');
    expect(localsOf(source, 'ostring')).toEqual({ other: '@calls:box.open' });
  });
});

// **The shapes that must produce nothing, asserted beside the shapes that produce a fact.** Every rule this iteration
// added refuses more than it accepts - a construction written on a qualifier, an alias whose right-hand side is a union,
// a member assignment whose receiver is a variable - and a refusal nobody tests is a refusal that can turn into a claim
// without a red run.
describe('the refusals each new rule makes', () => {
  const provider = new TypeScriptProvider();
  const fieldTypesOf = (source: string, name: string) => {
    const capture = provider.parse(source, 'z.ts').find((c) => c.name === name);
    return JSON.parse(String(capture?.properties?.['fieldTypes'] ?? '{}')) as Record<
      string,
      string
    >;
  };
  const aliasOf = (source: string, name: string) =>
    provider.parse(source, 'z.ts').find((c) => c.name === name && c.tag === CAPTURE_TAGS.TYPE_DEF)
      ?.properties?.['aliasOf'];

  it('declines a field constructed through a qualifier, because the qualifier names no class here', () => {
    // `new ns.Box()` states a member of a value; the class it means is the import pass's question, not this one.
    expect(
      fieldTypesOf(
        'class Holder {\n  private other = new ns.Box();\n  kept = new Box();\n}',
        'Holder',
      ),
    ).toEqual({
      kept: 'Box',
    });
  });

  it('declines a type alias whose right-hand side is not one type reference', () => {
    // A qualified generic names the same class a plain generic does, so the head is read and the qualifier dropped.
    expect(aliasOf('type Base<T> = z.Base<T>;', 'Base')).toBe('Base');
    // A union, an object type and a function type name no class to find a member in.
    expect(aliasOf('type Either = A | B;', 'Either')).toBeUndefined();
    expect(aliasOf('type Shape = { area(): number };', 'Shape')).toBeUndefined();
    expect(aliasOf('type Fn = () => number;', 'Fn')).toBeUndefined();
    // `typeof f` is the type of a value, which is a different question.
    expect(aliasOf('type Value = typeof f;', 'Value')).toBeUndefined();
  });

  it('declines a class expression that names no base and no contract, and reads the ones it does name', () => {
    const captures = provider.parse(
      [
        'const Plain = class Named {};',
        'const Extended = class Second extends Base implements Shape {};',
      ].join('\n'),
      'z.ts',
    );
    const plain = captures.find((c) => c.name === 'Named');
    expect(plain?.properties?.['baseClasses']).toBeUndefined();
    expect(plain?.properties?.['interfaces']).toBeUndefined();
    const extended = captures.find((c) => c.name === 'Second');
    expect(extended?.properties?.['baseClasses']).toBe('Base');
    expect(extended?.properties?.['interfaces']).toBe('Shape');
  });

  it('declines a member assignment whose right-hand side is not a function', () => {
    const captures = provider.parse('app.use = 1;', 'z.ts');
    expect(captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF)).toEqual([]);
  });

  it('declines a member assignment whose receiver is not a constructor’s prototype', () => {
    // `a.b.c = …` names a member of a value: two hops, and only the last one is a name this walk can prove.
    const nested = provider.parse('a.b.c = function () {};', 'z.ts');
    const capture = nested.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(capture?.name).toBe('c');
    expect(capture?.properties?.['enclosingClass']).toBeUndefined();
    // `(a.b).prototype.m = …` is the prototype of a value rather than of a name, so no class is claimed either.
    const qualified = provider.parse('a.b.prototype.m = function () {};', 'z.ts');
    expect(
      qualified.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF)?.properties?.['enclosingClass'],
    ).toBeUndefined();
  });

  it('carries no import for a side-effect import, which binds no name', () => {
    expect(provider.extractImports("import './polyfill';")).toEqual([]);
  });

  it('records no local for a module-scope `this`, which names an object nobody declared', () => {
    const captures = provider.parse(
      'const self = this;\nexport function read() { return self; }',
      'z.ts',
    );
    const read = captures.find((c) => c.name === 'read' && c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    const module = JSON.parse(String(read?.properties?.['moduleLocals'] ?? '{}')) as Record<
      string,
      string
    >;
    expect(module['self']).toBeUndefined();
  });
  it('records no loop binding from an incomplete edit, which is a file being typed rather than a file', () => {
    // **An editor sends this on every keystroke.** `for (const leaf of)` names an iterable that is not written yet, so
    // the binding has no type to file - and the walk has to say so rather than read the missing side as a name.
    const captures = provider.parse(
      'export function read() {\n  for (const leaf of) {\n    leaf.go();\n  }\n}',
      'z.ts',
    );
    const read = captures.find((c) => c.name === 'read' && c.tag === CAPTURE_TAGS.FUNCTION_DEF);
    const locals = JSON.parse(String(read?.properties?.['localTypes'] ?? '{}')) as Record<
      string,
      string
    >;
    expect(locals).toEqual({});
  });

  it('records no field from a construction whose class is not written', () => {
    const captures = provider.parse('class Holder {\n  private other = new ();\n}', 'z.ts');
    const holder = captures.find((c) => c.name === 'Holder' && c.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(holder?.properties?.['fieldTypes']).toBeUndefined();
  });
  it('refuses a loop binding whose body has no name, because no call site could ask for it', () => {
    // **`const { run } = function () {…}` binds no name this walk can key a body under.** A local is filed against the
    // owner the resolver names at the call site, so a body nobody named has no key to file against - and the binding is
    // dropped rather than filed at file scope, where it would answer a `leaf` written anywhere in the file.
    const source =
      'const { run } = function () {\n' +
      '  for (const leaf of this.leaves) {\n' +
      '    leaf.go();\n' +
      '  }\n' +
      '};\n' +
      'export function later() {}';
    const captures = provider.parse(source, 'z.ts');
    const filed = captures.flatMap((c) =>
      Object.keys({
        ...(JSON.parse(String(c.properties?.['moduleLocals'] ?? '{}')) as Record<string, string>),
        ...(JSON.parse(String(c.properties?.['localTypes'] ?? '{}')) as Record<string, string>),
      }),
    );
    expect(filed).not.toContain('leaf');
  });
});
