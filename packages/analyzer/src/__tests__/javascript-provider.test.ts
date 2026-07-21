import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { JavaScriptProvider } from '../languages/javascript.js';

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
      expect(provider.extensions).toContain('.mjs');
      expect(provider.extensions).toContain('.cjs');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect named function declarations', () => {
      const source = 'function hello() { return "hi"; }';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('hello');
    });

    it('should detect async function declarations', () => {
      const source = 'async function fetchData() { await something(); }';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const asyncFunc = funcs.find((f) => f.name === 'fetchData');
      expect(asyncFunc).toBeDefined();
      expect(asyncFunc!.properties?.['async']).toBe('true');
    });

    it('should detect arrow functions assigned to variables', () => {
      const source = 'const double = (x) => x * 2;';
      const captures = provider.parse(source, 'test.js');
      const arrowFuncs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.['arrow'] === 'true',
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

    it('should detect class with extends keyword', () => {
      const source = 'class Dog extends Animal { bark() {} }';
      const captures = provider.parse(source, 'test.js');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(1);
      expect(classes[0]!.name).toBe('Dog');
      expect(classes[0]!.properties?.['baseClasses']).toBe('Animal');
    });

    it('should detect class methods and constructors', () => {
      const source = 'class Person {\n  constructor(name) { this.name = name; }\n  greet() { return "hi"; }\n  async fetch() {}\n}';
      const captures = provider.parse(source, 'test.js');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(constructors).toHaveLength(1);
      expect(constructors[0]!.name).toBe('constructor');
      expect(constructors[0]!.containerName).toBe('Person');
      expect(methods).toHaveLength(2);
      expect(methods.some((m) => m.name === 'greet')).toBe(true);
      expect(methods.some((m) => m.name === 'fetch')).toBe(true);
    });

    it('should detect variable declarations', () => {
      const source = 'const x = 42;\nlet y = "hello";\nvar z = true;';
      const captures = provider.parse(source, 'test.js');
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(consts).toHaveLength(1);
      expect(consts[0]!.name).toBe('x');
      expect(vars).toHaveLength(2);
      expect(vars[0]!.name).toBe('y');
      expect(vars[1]!.name).toBe('z');
    });

    it('should detect JSX components (uppercase names)', () => {
      const source = 'const App = () => { return <div>Hello</div>; };';
      const captures = provider.parse(source, 'test.jsx');
      const components = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(components).toHaveLength(1);
      expect(components[0]!.name).toBe('App');
    });

    it('should not detect lowercase functions as JSX components', () => {
      const source = 'const app = () => { return <div>Hello</div>; };';
      const captures = provider.parse(source, 'test.jsx');
      const components = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(components).toHaveLength(0);
    });

    it('should detect Express route patterns', () => {
      const source = 'app.get("/api/users", handler);\napp.post("/api/login", loginHandler);';
      const captures = provider.parse(source, 'test.js');
      const routes = captures.filter((c) => c.tag === CAPTURE_TAGS.ROUTE_PATH);
      expect(routes).toHaveLength(2);
      expect(routes[0]!.name).toBe('/api/users');
      expect(routes[1]!.name).toBe('/api/login');
    });

    it('should detect router.route patterns', () => {
      const source = 'router.get("/products", handler);\nthis.delete("/items/:id", handler);';
      const captures = provider.parse(source, 'test.js');
      const routes = captures.filter((c) => c.tag === CAPTURE_TAGS.ROUTE_PATH);
      expect(routes).toHaveLength(2);
    });

    it('should detect JSDoc docstrings', () => {
      const source = '/**\n * Description\n * @param {string} name\n */\nfunction greet(name) {}';
      const captures = provider.parse(source, 'test.js');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.text).toContain('@param');
    });

    it('should detect imports as captures', () => {
      const source = 'import { useState } from "react";';
      const captures = provider.parse(source, 'test.js');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.name).toBe('react');
    });

    it('should return results sorted by start line', () => {
      const source = 'const b = 2;\nfunction a() {}\nlet c = 3;';
      const captures = provider.parse(source, 'test.js');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should skip reserved keywords in function detection', () => {
      const source = 'function if(x) { return x; }';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'if');
      expect(funcs).toHaveLength(0);
    });
  });

  describe('extractImports', () => {
    it('should parse star imports', () => {
      const source = 'import * as Utils from "./utils";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./utils');
      expect(imports[0]!.type).toBe('namespace');
      expect(imports[0]!.names).toContain('Utils');
    });

    it('should parse named imports', () => {
      const source = 'import { foo, bar } from "./module";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('./module');
      expect(imports[0]!.type).toBe('named');
      expect(imports[0]!.names).toContain('foo');
      expect(imports[0]!.names).toContain('bar');
    });

    it('should parse default imports', () => {
      const source = 'import React from "react";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('default');
      expect(imports[0]!.names).toContain('React');
    });

    it('should detect import line numbers', () => {
      const source = '// line 1\nimport { foo } from "./bar";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.lineNumber).toBe(2);
    });

    it('should parse require() calls with named destructuring', () => {
      const source = 'const { readFile, writeFile } = require("fs");';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('fs');
      expect(imports[0]!.type).toBe('named');
      expect(imports[0]!.names).toContain('readFile');
      expect(imports[0]!.names).toContain('writeFile');
    });

    it('should parse require() calls with single assignment', () => {
      const source = 'const fs = require("fs");';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('fs');
      expect(imports[0]!.type).toBe('default');
      expect(imports[0]!.names).toContain('fs');
    });

    it('should handle require() with let/var', () => {
      const source = 'let path = require("path");\nvar util = require("util");';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(2);
      expect(imports[0]!.source).toBe('path');
      expect(imports[1]!.source).toBe('util');
    });

    it('should return empty array for no imports', () => {
      const imports = provider.extractImports('const x = 1;');
      expect(imports).toHaveLength(0);
    });
  });

  describe('isExported', () => {
    it('should detect module.exports', () => {
      expect(provider.isExported('module.exports = myFunc', 'myFunc')).toBe(true);
    });

    it('should detect exports.name', () => {
      expect(provider.isExported('exports.foo = function() {}', 'foo')).toBe(true);
    });

    it('should detect export named', () => {
      expect(provider.isExported('export { foo, bar }', 'foo')).toBe(true);
      expect(provider.isExported('export { foo, bar }', 'bar')).toBe(true);
    });

    it('should detect export default function', () => {
      expect(provider.isExported('export default function App() {}', 'App')).toBe(true);
    });

    it('should detect export default class', () => {
      expect(provider.isExported('export default class MyClass {}', 'MyClass')).toBe(true);
    });

    it('should detect export const', () => {
      expect(provider.isExported('export const VERSION = "1.0"', 'VERSION')).toBe(true);
    });

    it('should detect export let', () => {
      expect(provider.isExported('export let count = 0', 'count')).toBe(true);
    });

    it('should detect export var', () => {
      expect(provider.isExported('export var config = {}', 'config')).toBe(true);
    });

    it('should detect export function', () => {
      expect(provider.isExported('export function init() {}', 'init')).toBe(true);
    });

    it('should detect export class', () => {
      expect(provider.isExported('export class Service {}', 'Service')).toBe(true);
    });

    it('should return false for non-exported symbols', () => {
      expect(provider.isExported('function internal() {}', 'internal')).toBe(false);
      expect(provider.isExported('class Hidden {}', 'Hidden')).toBe(false);
    });
  });

  describe('complex parsing', () => {
    it('should handle block comments in function body', () => {
      const source = 'function test() {\n  /* block comment */\n  return true;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'test');
      expect(funcs).toHaveLength(1);
    });

    it('should handle strings with braces in function body', () => {
      const source = 'function parse() {\n  const s = "this has { braces } inside";\n  return s;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'parse');
      expect(funcs).toHaveLength(1);
    });

    it('should handle template literals in function body', () => {
      const source = 'function greeting() {\n  const msg = `Hello ${name}`;\n  return msg;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'greeting');
      expect(funcs).toHaveLength(1);
    });

    it('should handle nested blocks', () => {
      const source = 'function outer() {\n  if (true) {\n    return true;\n  }\n  return false;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'outer');
      expect(funcs).toHaveLength(1);
    });

    it('should handle default import in extractImports', () => {
      const source = 'import React from "react";';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('default');
      expect(imports[0]!.names).toEqual(['React']);
    });

    it('should handle named export re-exports', () => {
      expect(provider.isExported('export { foo, bar, baz };', 'baz')).toBe(true);
    });

    it('should detect method with constructor in class', () => {
      const source = 'class Calculator {\n  constructor() {}\n  add(a, b) { return a + b; }\n}';
      const captures = provider.parse(source, 'test.js');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(constructors).toHaveLength(1);
      expect(methods.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle line comment inside function body', () => {
      const source = 'function test() {\n  // line comment\n  const x = 1;\n  return x;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'test');
      expect(funcs).toHaveLength(1);
    });

    it('should handle deeply nested blocks', () => {
      const source = 'function compute() {\n  for (let i = 0; i < 10; i++) {\n    if (i > 5) {\n      return i;\n    }\n  }\n  return 0;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'compute');
      expect(funcs).toHaveLength(1);
    });

    it('should handle single-line comment end in function body', () => {
      const source = 'function bar() {\n  // first comment\n  // second comment\n  return;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'bar');
      expect(funcs).toHaveLength(1);
    });

    it('should detect arrow function with implicit return', () => {
      const source = 'const add = (a, b) => a + b;';
      const captures = provider.parse(source, 'test.js');
      const arrowFuncs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.['arrow'] === 'true');
      expect(arrowFuncs.length).toBeGreaterThanOrEqual(1);
      expect(arrowFuncs.some(f => f.name === 'add')).toBe(true);
    });

    it('should detect arrow function with block body', () => {
      const source = 'const compute = (x) => {\n  return x * 2;\n};';
      const captures = provider.parse(source, 'test.js');
      const arrowFuncs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.['arrow'] === 'true');
      expect(arrowFuncs.some(f => f.name === 'compute')).toBe(true);
    });

    it('should detect async arrow function', () => {
      const source = 'const fetch = async (url) => { return await request(url); };';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'fetch')).toBe(true);
    });

    it('should detect class with static method', () => {
      const source = 'class Util {\n  static create() { return new Util(); }\n}';
      const captures = provider.parse(source, 'test.js');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some(m => m.name === 'create')).toBe(true);
    });

    it('should detect class with multiple methods', () => {
      const source = 'class Calculator {\n  constructor() { this.result = 0; }\n  add(n) { this.result += n; return this; }\n  get() { return this.result; }\n}';
      const captures = provider.parse(source, 'test.js');
      const constructors = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(constructors).toHaveLength(1);
      expect(methods.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect export function with isExported', () => {
      expect(provider.isExported('export function init() { return true; }', 'init')).toBe(true);
    });

    it('should detect function assigned with const as variable', () => {
      const source = 'const handler = function process() { return "done"; };';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      // The named function 'process' inside the assignment should be detected
      expect(funcs.some(f => f.name === 'process')).toBe(true);
    });

    it('should detect destructured require', () => {
      const source = 'const { join, resolve } = require("path");';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.names).toContain('join');
      expect(imports[0]!.names).toContain('resolve');
    });

    it('should handle export with named aliases', () => {
      expect(provider.isExported('export { foo as default };', 'foo')).toBe(true);
    });

    it('should detect route with use method', () => {
      const source = 'app.use("/api", middleware);';
      const captures = provider.parse(source, 'test.js');
      const routes = captures.filter(c => c.tag === CAPTURE_TAGS.ROUTE_PATH);
      expect(routes.length).toBeGreaterThanOrEqual(1);
      expect(routes.some(r => r.name === '/api')).toBe(true);
    });

    it('should handle export of let declaration', () => {
      expect(provider.isExported('export let count = 0', 'count')).toBe(true);
    });
  });

  // ============================================================================
  // Branch coverage hardening - wave 2
  // ============================================================================

  describe('JSX component reserved keyword filter', () => {
    it('should skip reserved keyword in JSX component detection (L262)', () => {
      // A function named after a reserved keyword returning JSX should be filtered
      const source = 'const class = () => { return <div>test</div>; };';
      const captures = provider.parse(source, 'test.jsx');
      // 'class' is a reserved keyword, should be skipped
      const components = captures.filter(c => c.tag === CAPTURE_TAGS.COMPONENT_PROPS && c.name === 'class');
      expect(components).toEqual([]);
    });

    it('should skip lowercase JSX-like function in component detection (L263)', () => {
      const source = 'const render = () => { return <span>hi</span>; };';
      const captures = provider.parse(source, 'test.jsx');
      // 'render' starts with lowercase, should be skipped as component
      const components = captures.filter(c => c.tag === CAPTURE_TAGS.COMPONENT_PROPS && c.name === 'render');
      expect(components).toEqual([]);
    });
  });

  describe('findBlockEnd branch coverage', () => {
    it('should handle prev === empty at i === 0 (L364 ternary false)', () => {
      const source = 'function foo() {\n  return 1;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'foo');
      expect(funcs).toHaveLength(1);
    });

    it('should handle openPos === 0 so i starts at 0 (L364 prev empty)', () => {
      // When openPos is 0 (brace immediately after match), for loop starts at i=0
      const source = 'function bar(){ return 2; }';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'bar');
      expect(funcs).toHaveLength(1);
    });

    it('should handle brace depth reduction (L376 else branch)', () => {
      // When depth > 0 and closing brace is found, depth-- (not return)
      const source = 'function nested() {\n  if (true) {\n    return 1;\n  }\n  return 0;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'nested');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.endLine).toBeGreaterThan(funcs[0]!.startLine);
    });

    it('should handle closing brace at depth 0 (L376 if depth===0)', () => {
      // First closing brace at depth 0 triggers return
      const source = 'function simple() {\n  return 1;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'simple');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.endLine).toBeGreaterThan(funcs[0]!.startLine);
    });
  });

  // ============================================================================
  // Branch coverage hardening
  // ============================================================================

  describe('branch coverage hardening', () => {
    it('should handle reserved keyword in arrow function (L157)', () => {
      const source = 'const if = () => { return; };';
      const captures = provider.parse(source, 'test.js');
      // 'if' is a reserved keyword, should be skipped in arrow functions
      const arrowFuncs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'if');
      expect(arrowFuncs).toEqual([]);
    });

    it('should handle reserved keyword in class method (L180)', () => {
      const source = 'class Test {\n  if() { return; }\n  valid() { return; }\n}';
      const captures = provider.parse(source, 'test.js');
      // 'if' is reserved, should be skipped as method name
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.every(m => m.name !== 'if')).toBe(true);
      expect(methods.some(m => m.name === 'valid')).toBe(true);
    });

    it('should handle reserved keyword in variable extraction (L241)', () => {
      const source = 'const if = 1;\nconst valid = 2;';
      const captures = provider.parse(source, 'test.js');
      // 'if' is a reserved keyword, should be skipped in variables
      const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'if');
      expect(consts).toEqual([]);
      expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'valid')).toBe(true);
    });

    it('should handle JSX component detection filter (L263)', () => {
      const source = 'const MyComponent = () => { return <div>test</div>; };';
      const captures = provider.parse(source, 'test.jsx');
      const components = captures.filter(c => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(components.some(c => c.name === 'MyComponent')).toBe(true);
    });

    it('should handle docstring endLine with no newlines (L306)', () => {
      const source = '/** @param {string} name */\nfunction greet(name) {}';
      const captures = provider.parse(source, 'test.js');
      const docs = captures.filter(c => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
      // Single-line JSDoc: endLine should equal startLine
      expect(docs[0]!.endLine).toBe(docs[0]!.startLine);
    });

    it('should handle line comment end in findBlockEnd (L365)', () => {
      const source = 'function test() {\n  // comment line\n  return true;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'test');
      expect(funcs).toHaveLength(1);
    });

    it('should handle brace depth closing in findBlockEnd (L377)', () => {
      const source = 'function wrap() {\n  if (true) {\n    return 1;\n  }\n  return 0;\n}';
      const captures = provider.parse(source, 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'wrap');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.endLine).toBeGreaterThan(funcs[0]!.startLine);
    });
  });
});
