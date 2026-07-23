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
      const vars = captures.filter((c) =>
        c.tag === CAPTURE_TAGS.CONSTANT_DEF || c.tag === CAPTURE_TAGS.VARIABLE_DEF,
      );
      expect(vars.length).toBeGreaterThanOrEqual(1);
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
      const source = 'class User {\n  constructor(public name: string) {}\n  getInfo(): string { return this.name; }\n}';
      const captures = provider.parse(source, 'test.ts');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(constructors).toHaveLength(1);
      expect(constructors[0]!.containerName).toBe('User');
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('getInfo');
    });

    it('should handle multiple class methods', () => {
      const source = 'class Service {\n  private doInternal(): void {}\n  protected getData(): string { return ""; }\n  public handle(): void {}\n}';
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
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'parse');
      expect(funcs).toHaveLength(1);
    });

    it('should handle strings with special characters', () => {
      const source = 'function getTemplate(): string {\n  return "{ code } block";\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'getTemplate');
      expect(funcs).toHaveLength(1);
    });

    it('should handle nested block structures', () => {
      const source = 'function outer(): void {\n  if (true) {\n    while (false) {\n      break;\n    }\n  }\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'outer');
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
      // tree-sitter extracts the identifier (foo is the import_specifier identifier)
      expect(imports[0]!.names).toContain('baz');
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
  });

  describe('edge cases', () => {
    it('should handle function with commented braces', () => {
      const source = 'function test(): void {\n  // line comment\n  const x = 1;\n  return;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'test');
      expect(funcs).toHaveLength(1);
    });

    it('should handle template literals', () => {
      const source = 'function template(): string {\n  const s = `nested { block } here`;\n  return s;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'template');
      expect(funcs).toHaveLength(1);
    });

    it('should handle deeply nested structures', () => {
      const source = 'function compute() {\n  for (let i = 0; i < 10; i++) {\n    if (i > 5) {\n      return i;\n    }\n  }\n  return 0;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'compute');
      expect(funcs).toHaveLength(1);
    });
  });
});
