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

    it('should detect decorator with arguments', () => {
      const source = '@Component({ selector: "app-root" })\nexport class AppComponent {}';
      const captures = provider.parse(source, 'test.ts');
      const decorators = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators).toHaveLength(1);
      expect(decorators[0]!.properties?.['decorator']).toBe('Component');
    });

    it('should detect decorator without arguments', () => {
      const source = '@Injectable()\nexport class MyService {}';
      const captures = provider.parse(source, 'test.ts');
      const decorators = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.length).toBeGreaterThanOrEqual(1);
      expect(decorators.some(d => d.name === 'Injectable')).toBe(true);
    });

    it('should detect abstract class with abstract property', () => {
      const source = 'export abstract class BaseRepo {\n  abstract getTable(): string;\n  find(): any { return null; }\n}';
      const captures = provider.parse(source, 'test.ts');
      expect(captures.some(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.['abstract'] === 'true')).toBe(true);
    });

    it('should detect type import', () => {
      const source = "import type { User, Post } from './models';";
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.names).toContain('User');
      expect(imports[0]!.names).toContain('Post');
    });

    it('should detect function with type parameter constraint', () => {
      const source = 'function create<T extends string>(data: T): T { return data; }';
      const captures = provider.parse(source, 'test.ts');
      expect(captures.some(c => c.name === 'create' && c.tag === CAPTURE_TAGS.FUNCTION_DEF)).toBe(true);
    });

    it('should detect variable with union type', () => {
      const source = "const status: 'active' | 'inactive' = 'active';";
      const captures = provider.parse(source, 'test.ts');
      const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts.some(c => c.name === 'status')).toBe(true);
    });

    it('should detect const enum', () => {
      const source = 'const enum Direction { Up, Down, Left, Right }';
      const captures = provider.parse(source, 'test.ts');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(e => e.name === 'Direction')).toBe(true);
    });

    it('should detect export enum', () => {
      const source = 'export enum LogLevel { Debug, Info, Error }';
      const captures = provider.parse(source, 'test.ts');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(e => e.name === 'LogLevel')).toBe(true);
    });

    it('should detect @Patch route decorator', () => {
      const source = "@Patch('/api/users/:id')\nexport class UserController {}";
      const captures = provider.parse(source, 'test.ts');
      const routes = captures.filter(c => c.tag === CAPTURE_TAGS.ROUTE_PATH);
      expect(routes).toHaveLength(1);
      expect(routes[0]!.name).toBe('/api/users/:id');
    });

    it('should detect @All route decorator with route method', () => {
      const source = "@All('/catch')\nexport class CatchController {}";
      const captures = provider.parse(source, 'test.ts');
      const routeMethods = captures.filter(c => c.tag === CAPTURE_TAGS.ROUTE_METHOD);
      expect(routeMethods).toHaveLength(1);
      expect(routeMethods[0]!.name).toBe('All');
    });

    it('should detect export let variable', () => {
      expect(provider.isExported('export let count = 0;', 'count')).toBe(true);
    });

    it('should handle dynamic import', () => {
      const source = "async function load() { const m = await import('./lazy'); }";
      const imports = provider.extractImports(source);
      expect(imports.some(i => i.source === './lazy')).toBe(true);
    });

    it('should detect namespace import', () => {
      const source = "import * as All from './module';";
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('namespace');
      expect(imports[0]!.names).toContain('All');
    });

    it('should handle export interface', () => {
      expect(provider.isExported('export interface Config { debug: boolean; }', 'Config')).toBe(true);
    });
  });

  // ============================================================================
  // Branch coverage hardening - wave 2
  // ============================================================================

  describe('extractFunctions class body slice edge cases', () => {
    it('should handle class at line 1 (clsStart === 1) for class body slicing (L159)', () => {
      // clsStart > 0 is true, but clsStart === 1 means clsStart - 1 === 0
      const source = 'class User {\n  constructor() {}\n  getName(): string { return "test"; }\n}';
      const captures = provider.parse(source, 'test.ts');
      expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF)).toBe(true);
      expect(captures.some(c => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'getName')).toBe(true);
    });

    it('should handle class not at line 1 (clsStart > 1 branch)', () => {
      const source = '// comment\n// another\nclass Service {\n  process(): void {}\n}';
      const captures = provider.parse(source, 'test.ts');
      expect(captures.some(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Service')).toBe(true);
    });
  });

  describe('extractClasses fullLine fallback', () => {
    it('should handle class at end of file without newline (L201 || fallback)', () => {
      const source = 'class LastClass extends Base';
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('LastClass');
    });

    it('should handle class with no extends or implements (L201-203)', () => {
      const source = 'class Simple {}';
      const captures = provider.parse(source, 'test.ts');
      const cls = captures.find(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Simple');
      expect(cls).toBeDefined();
      expect(cls!.properties.baseClasses).toBe('');
      expect(cls!.properties.interfaces).toBe('');
    });

    it('should handle class with implements only (L203)', () => {
      const source = 'class Handler implements IHandler {\n}';
      const captures = provider.parse(source, 'test.ts');
      const cls = captures.find(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Handler');
      expect(cls).toBeDefined();
      expect(cls!.properties.interfaces).toBe('IHandler');
    });
  });

  // ============================================================================
  // Branch coverage hardening - wave 3
  // ============================================================================

  describe('extractClasses end-of-file edge cases', () => {
    it('should handle class at end of file with no newline (L201 no newline)', () => {
      // source.indexOf('\n', match.index) returns -1, triggering the || fallback
      const source = 'class EndClass implements IFace';
      const captures = provider.parse(source, 'test.ts');
      const cls = captures.find(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'EndClass');
      expect(cls).toBeDefined();
    });
  });

  // ============================================================================
  // Branch coverage hardening
  // ============================================================================

  describe('branch coverage hardening', () => {
    it('should handle reserved keyword in named function (L121)', () => {
      const source = 'function if() { return; }';
      const captures = provider.parse(source, 'test.ts');
      // 'if' is a reserved keyword, should be skipped
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'if');
      expect(funcs).toEqual([]);
    });

    it('should handle reserved keyword in arrow function (L140)', () => {
      const source = 'const if = () => { return; };';
      const captures = provider.parse(source, 'test.ts');
      // 'if' is a reserved keyword, should be skipped
      const arrowFuncs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'if');
      expect(arrowFuncs).toEqual([]);
    });

    it('should handle method regex in class body without methods (L160)', () => {
      // This hits the branch where classBodyMatches has entries but methodRegex matches nothing
      const source = 'class Empty {\n  // no methods\n}';
      const captures = provider.parse(source, 'test.ts');
      // Should not crash, class should still be detected
      expect(captures.some(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Empty')).toBe(true);
    });

    it('should handle class without extends (L202)', () => {
      // The extendsMatch null path
      const source = 'class Simple { }';
      const captures = provider.parse(source, 'test.ts');
      const cls = captures.find(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Simple');
      expect(cls).toBeDefined();
      expect(cls!.properties.baseClasses).toBe('');
    });

    it('should handle variable detection with constructor skip (L289)', () => {
      const source = 'const constructor = "not a constructor";\nconst valid = 42;';
      const captures = provider.parse(source, 'test.ts');
      // 'constructor' should be skipped in variable extraction
      const vars = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'constructor');
      expect(vars).toEqual([]);
      expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'valid')).toBe(true);
    });

    it('should handle docstring endLine with single line (L362)', () => {
      const source = '/** Single line */\nfunction foo() {}';
      const captures = provider.parse(source, 'test.ts');
      const docs = captures.filter(c => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
      // Single line docstring: endLine === startLine
    });

    it('should handle block comment inside function body (L416)', () => {
      const source = 'function test() {\n  /* comment */\n  return;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'test');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.endLine).toBeGreaterThan(funcs[0]!.startLine);
    });

    it('should handle unmatched brace in findBlockEnd (L443)', () => {
      // Missing closing brace - falls through to return EOF line
      const source = 'function openBrace() {';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'openBrace');
      expect(funcs).toHaveLength(1);
    });

    it('should filter reserved keyword method name in class body (L164)', () => {
      const source = 'class Test {\n  public if(x) { return x; }\n  public while(x) { return x; }\n}';
      const captures = provider.parse(source, 'test.ts');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.every(m => !['if', 'while'].includes(m.name!))).toBe(true);
    });

    it('should filter reserved keyword variable name (L288)', () => {
      const source = 'const if = 1;\nconst class = 2;\nconst function = 3;';
      const captures = provider.parse(source, 'test.ts');
      const vars = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF || c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(vars.every(v => !['if', 'class', 'function'].includes(v.name!))).toBe(true);
    });

    it('should handle nested braces in findBlockEnd (L442 depth > 0)', () => {
      // Extra closing brace triggers depth === 0 in findBlockEnd
      const source = 'function foo() {\n  return 1;\n} }';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'foo');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.endLine).toBeGreaterThan(funcs[0]!.startLine);
    });

    it('should handle class at end of file without newline (L201)', () => {
      const source = 'class Foo {';
      const captures = provider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Foo');
      expect(classes).toHaveLength(1);
    });

    it('should handle openPos === 0 in findBlockEnd (L415 i === 0)', () => {
      // No space between => and { so openPos is 0
      const source = 'const foo=()=>{\n  return 1;\n}';
      const captures = provider.parse(source, 'test.ts');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'foo');
      expect(funcs).toHaveLength(1);
    });
  });
});
