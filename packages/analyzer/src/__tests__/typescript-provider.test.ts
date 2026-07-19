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
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.['arrow'] === 'true',
      );
      expect(arrowFuncs).toHaveLength(1);
      expect(arrowFuncs[0]!.name).toBe('double');
    });

    it('should detect class definitions', () => {
      const source = `class Animal extends Base {\n  name: string;\n}`;
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Animal');
    });

    it('should detect class with extends and implements', () => {
      const source = `class Dog extends Animal implements Pet {\n}`;
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Dog');
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

    it('should detect decorators', () => {
      const source = `@Component\nexport class MyComponent {}`;
      const captures = provider.parse(source, 'test.ts');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.properties?.['decorator']).toBe('Component');
    });

    it('should detect route decorators', () => {
      const source = `@Get('/api/users')\n@Post('/api/users')\nexport class UserController {}`;
      const captures = provider.parse(source, 'test.ts');
      const routes = captures.filter((c) => c.tag === CAPTURE_TAGS.ROUTE_PATH);
      expect(routes).toHaveLength(2);
      expect(routes[0]!.name).toBe('/api/users');
      expect(routes[1]!.name).toBe('/api/users');
    });

    it('should detect JSDoc docstrings', () => {
      const source = `/**\n * @param name The user name\n */\nfunction greet(name: string) {}`;
      const captures = provider.parse(source, 'test.ts');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.text).toContain('@param name');
    });

    it('should detect imports', () => {
      const source = `import { useState } from 'react';`;
      const captures = provider.parse(source, 'test.ts');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.name).toBe('react');
    });

    it('should detect variable declarations', () => {
      const source = `const x: number = 42;\nlet y = "hello";`;
      const captures = provider.parse(source, 'test.ts');
      const vars = captures.filter((c) =>
        c.tag === CAPTURE_TAGS.CONSTANT_DEF || c.tag === CAPTURE_TAGS.VARIABLE_DEF,
      );
      expect(vars.length).toBeGreaterThanOrEqual(1);
    });

    it('should return captures sorted by line number', () => {
      const source = `const b = 2;\nfunction a() {}\nlet c = 3;`;
      const captures = provider.parse(source, 'test.ts');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
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

    it('should detect export default keywords', () => {
      expect(provider.isExported('export default function MyFunc() {}', 'MyFunc')).toBe(true);
    });

    it('should detect export abstract class', () => {
      expect(provider.isExported('export abstract class Base {}', 'Base')).toBe(true);
    });

    it('should detect export interface', () => {
      expect(provider.isExported('export interface IRepo {}', 'IRepo')).toBe(true);
    });

    it('should detect export type', () => {
      expect(provider.isExported('export type ID = string', 'ID')).toBe(true);
    });

    it('should detect export enum', () => {
      expect(provider.isExported('export enum Colors {}', 'Colors')).toBe(true);
    });

    it('should detect export const', () => {
      expect(provider.isExported('export const API_URL = "/api"', 'API_URL')).toBe(true);
    });

    it('should detect export let', () => {
      expect(provider.isExported('export let count = 0', 'count')).toBe(true);
    });

    it('should detect export var', () => {
      expect(provider.isExported('export var flag = true', 'flag')).toBe(true);
    });
  });

  describe('abstract classes', () => {
    it('should detect abstract class definitions', () => {
      const source = 'abstract class BaseService {\n  abstract init(): void;\n}';
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('BaseService');
      expect(classes[0]!.properties?.['abstract']).toBe('true');
    });
  });

  describe('class methods', () => {
    it('should detect constructor in class', () => {
      const source = 'class User {\n  constructor(public name: string) {}\n  getInfo(): string { return this.name; }\n}';
      const captures = provider.parse(source, 'test.ts');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(constructors).toHaveLength(1);
      expect(constructors[0]!.name).toBe('constructor');
      expect(constructors[0]!.containerName).toBe('User');
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('getInfo');
    });

    it('should detect private and protected methods', () => {
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
  });

  describe('const enum', () => {
    it('should detect const enum definitions', () => {
      const source = 'const enum Status { Active, Inactive }';
      const captures = provider.parse(source, 'test.ts');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums).toHaveLength(1);
      expect(enums[0]!.name).toBe('Status');
    });
  });

  describe('route methods', () => {
    it('should capture route methods and paths', () => {
      const source = '@Get("/api/health")\nexport class HealthController {}';
      const captures = provider.parse(source, 'test.ts');
      const routeMethods = captures.filter((c) => c.tag === CAPTURE_TAGS.ROUTE_METHOD);
      expect(routeMethods).toHaveLength(1);
      expect(routeMethods[0]!.name).toBe('Get');
      expect(routeMethods[0]!.properties?.['routePath']).toBe('/api/health');
    });

    it('should handle @Delete and @Put decorators', () => {
      const source = '@Delete("/api/users/:id")\n@Put("/api/users/:id")\nexport class UserController {}';
      const captures = provider.parse(source, 'test.ts');
      const routeMethods = captures.filter((c) => c.tag === CAPTURE_TAGS.ROUTE_METHOD);
      expect(routeMethods).toHaveLength(2);
      expect(routeMethods[0]!.name).toBe('Delete');
      expect(routeMethods[1]!.name).toBe('Put');
    });
  });

  describe('type imports', () => {
    it('should parse type imports', () => {
      const source = "import type { MyType } from './types';";
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./types');
      expect(imports[0]!.type).toBe('named');
      expect(imports[0]!.names).toContain('MyType');
    });
  });

  describe('generic type parameters', () => {
    it('should detect function with generic type', () => {
      const source = 'function identity<T>(arg: T): T { return arg; }';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const identity = funcs.find((f) => f.name === 'identity');
      expect(identity).toBeDefined();
    });

    it('should detect type alias with generics', () => {
      const source = 'type Container<T> = { value: T };';
      const captures = provider.parse(source, 'test.ts');
      const types = captures.filter((c) => c.tag === CAPTURE_TAGS.TYPE_DEF);
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('Container');
    });
  });

  describe('interface extends', () => {
    it('should detect exported interfaces', () => {
      const source = 'export interface Repository {\n  find(id: number): any;\n}';
      const captures = provider.parse(source, 'test.ts');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]!.name).toBe('Repository');
    });
  });

  describe('complex parsing', () => {
    it('should handle block comments in function body', () => {
      const source = 'function parse(): void {\n  /* multi-line\n     comment */\n  return;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'parse');
      expect(funcs).toHaveLength(1);
    });

    it('should handle strings with braces in code', () => {
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
      const source = 'const config: Record<string, unknown> = {};\nlet state: "active" | "inactive" = "active";';
      const captures = provider.parse(source, 'test.ts');
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(consts.length).toBeGreaterThanOrEqual(1);
      expect(vars.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle named imports with alias', () => {
      const source = "import { foo as bar, baz } from './module';";
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      // 'foo as bar' should resolve to 'bar' (alias)
      expect(imports[0]!.names).toContain('bar');
      expect(imports[0]!.names).toContain('baz');
    });

    it('should handle @Head and @Options route decorators', () => {
      const source = '@Head("/health")\n@Options("/config")\nexport class Controller {}';
      const captures = provider.parse(source, 'test.ts');
      const routes = captures.filter((c) => c.tag === CAPTURE_TAGS.ROUTE_PATH);
      expect(routes).toHaveLength(2);
    });

    it('should handle @All route decorator', () => {
      const source = '@All("/catch-all")\nexport class WildcardController {}';
      const captures = provider.parse(source, 'test.ts');
      const routes = captures.filter((c) => c.tag === CAPTURE_TAGS.ROUTE_PATH);
      expect(routes).toHaveLength(1);
    });

    it('should handle line comment inside function body', () => {
      const source = 'function test(): void {\n  // single-line comment\n  const x = 1;\n  return;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'test');
      expect(funcs).toHaveLength(1);
    });

    it('should handle template literal in function body', () => {
      const source = 'function template(): string {\n  const s = `nested { block } here`;\n  return s;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'template');
      expect(funcs).toHaveLength(1);
    });

    it('should handle abstract method in class', () => {
      const source = 'abstract class Repository {\n  abstract find(id: string): Promise<any>;\n  abstract save(data: any): void;\n}';
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.properties?.['abstract']).toBe('true');
    });

    it('should handle export type with generics', () => {
      const source = 'export type Record<K extends string, V> = { [key in K]: V };';
      const captures = provider.parse(source, 'test.ts');
      const types = captures.filter((c) => c.tag === CAPTURE_TAGS.TYPE_DEF);
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('Record');
    });
  });
});
