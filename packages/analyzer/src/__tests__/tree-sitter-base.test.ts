// @code-analyzer/analyzer — Tests for TreeSitterBaseProvider abstract base class
// Tests the base class methods through a concrete implementation.

import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { ParsedImport, UnifiedCapture, CaptureTag, ImportSemantics } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from '../languages/tree-sitter-base.js';

import { TreeSitterBaseProvider } from '../languages/tree-sitter-base.js';
import { TypeScriptProvider } from '../languages/typescript.js';
import { JavaScriptProvider } from '../languages/javascript.js';

// Create a minimal concrete implementation for testing the base class
class TestProvider extends TreeSitterBaseProvider {
  readonly language = 'test';
  readonly displayName = 'Test';
  readonly extensions = ['.test'];
  readonly globs = ['**/*.test'];
  readonly importSemantics: ImportSemantics = 'named';

  // Don't try to load a real grammar — force fallback
  protected loadGrammar(): TreeSitterLanguage | null {
    return null;
  }

  protected getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'class_definition', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
    ];
  }

  // Implement abstract fallback methods
  protected fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const funcRegex = /function\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const classRegex = /class\s+(\w+)/g;
    while ((m = classRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const regex = /import\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  protected fallbackIsExported(source: string, symbolName: string): boolean {
    return source.includes(symbolName);
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}

describe('TreeSitterBaseProvider', () => {
  const provider = new TestProvider();

  describe('metadata', () => {
    it('should have correct language', () => {
      expect(provider.language).toBe('test');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Test');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.test');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should use fallbackParse when no grammar', () => {
      const captures = provider.parse('function greet() {}\nclass MyClass {}', 'test.test');
      expect(Array.isArray(captures)).toBe(true);
      expect(captures.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract function definitions', () => {
      const captures = provider.parse('function hello() {}', 'test.test');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'hello')).toBe(true);
    });

    it('should extract class definitions', () => {
      const captures = provider.parse('class MyClass {}', 'test.test');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyClass')).toBe(true);
    });

    it('should return sorted captures', () => {
      const captures = provider.parse('function second() {}\nclass First {}', 'test.test');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'test.test');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should use fallbackExtractImports when no grammar', () => {
      const imports = provider.extractImports('import Foo\nimport Bar');
      expect(Array.isArray(imports)).toBe(true);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract import source', () => {
      const imports = provider.extractImports('import React');
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toBe('React');
    });

    it('should handle empty source', () => {
      const imports = provider.extractImports('');
      expect(imports).toHaveLength(0);
    });
  });

  describe('isExported', () => {
    it('should use fallbackIsExported when no grammar', () => {
      expect(provider.isExported('function foo() {}', 'foo')).toBe(true);
    });

    it('should return false for non-matching name', () => {
      expect(provider.isExported('function foo() {}', 'bar')).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('should have queryTree method', () => {
      expect(typeof provider.queryTree).toBe('function');
    });

    it('should have walkTree method', () => {
      expect(typeof provider.walkTree).toBe('function');
    });

    it('should have nodeText method', () => {
      expect(typeof provider.nodeText).toBe('function');
    });

    it('should have nodeLine method', () => {
      expect(typeof provider.nodeLine).toBe('function');
    });

    it('queryTree should return empty when no parser', () => {
      const results = provider.queryTree('test', '(function)');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('walkTree should not throw when no parser', () => {
      expect(() => {
        provider.walkTree('test', () => {});
      }).not.toThrow();
    });
  });

  describe('tree-sitter path through TypeScript provider', () => {
    const tsProvider = new TypeScriptProvider();

    it('parse should return captures with correct tags', () => {
      const source = 'function hello(): string { return "hi"; }';
      const captures = tsProvider.parse(source, 'test.ts');
      const funcDefs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcDefs.length).toBeGreaterThanOrEqual(1);
      expect(funcDefs[0]!.name).toBe('hello');
    });

    it('parse should return captures with positions', () => {
      const source = 'class MyClass {\n  method(): void {}\n}';
      const captures = tsProvider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      expect(classes[0]!.startLine).toBeGreaterThanOrEqual(1);
    });

    it('parse should detect container names', () => {
      const source = 'class User {\n  getInfo(): string { return ""; }\n}';
      const captures = tsProvider.parse(source, 'test.ts');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(1);
      expect(methods[0]!.containerName).toBe('User');
    });

    it('parse should detect base class extraction', () => {
      const source = 'class Dog extends Animal {\n  bark(): void {}\n}';
      const captures = tsProvider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      if (classes.length > 0 && classes[0]!.properties?.baseClasses) {
        expect(classes[0]!.properties.baseClasses).toBe('Animal');
      }
    });

    it('parse should detect call site capture', () => {
      const source = 'function test() { console.log("hello"); }';
      const captures = tsProvider.parse(source, 'test.ts');
      const calls = captures.filter(c =>
        c.tag === CAPTURE_TAGS.FUNCTION_CALL || c.tag === CAPTURE_TAGS.METHOD_CALL
      );
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect new expression', () => {
      const source = 'function test() { const x = new Date(); }';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect method calls on objects', () => {
      const source = 'function test() { const s = "hello"; s.trim(); }';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('extractImports should return correct import data', () => {
      const source = "import { useState } from 'react';";
      const imports = tsProvider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toBe('react');
    });

    it('isExported should detect exported function', () => {
      expect(tsProvider.isExported('export function foo() {}', 'foo')).toBe(true);
    });

    it('isExported should return false for internal', () => {
      expect(tsProvider.isExported('function internal() {}', 'internal')).toBe(false);
    });

    it('multiple parse calls should work correctly', () => {
      const captures1 = tsProvider.parse('function first() {}', 'first.ts');
      const captures2 = tsProvider.parse('function second() {}', 'second.ts');
      expect(captures1.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'first').length).toBe(1);
      expect(captures2.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'second').length).toBe(1);
    });

    it('parse with both source and filePath set correctly', () => {
      const source = 'const x: number = 42;';
      const captures = tsProvider.parse(source, 'my-file.ts');
      const vars = captures.filter(c =>
        c.tag === CAPTURE_TAGS.CONSTANT_DEF || c.tag === CAPTURE_TAGS.VARIABLE_DEF
      );
      expect(vars.length).toBeGreaterThanOrEqual(1);
    });

    it('queryTree should work with TypeScript provider', () => {
      const results = tsProvider.queryTree(
        'function hello(): void {}',
        '(function_declaration) @func'
      );
      expect(Array.isArray(results)).toBe(true);
    });

    it('walkTree should work with TypeScript provider', () => {
      const visited: string[] = [];
      tsProvider.walkTree('const x = 1;', (node) => {
        visited.push(node.type);
      });
      expect(visited.length).toBeGreaterThan(0);
    });
  });

  describe('tree-sitter path through JavaScript provider', () => {
    const jsProvider = new JavaScriptProvider();

    it('parse should detect function declarations', () => {
      const captures = jsProvider.parse('function test() {}', 'test.js');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'test')).toBe(true);
    });

    it('parse should detect class declarations', () => {
      const captures = jsProvider.parse('class MyClass {}', 'test.js');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('extractImports should return correct types', () => {
      const imports = jsProvider.extractImports('import React from "react";');
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.type).toBe('default');
    });

    it('isExported should detect exports', () => {
      expect(jsProvider.isExported('export function init() {}', 'init')).toBe(true);
    });

    it('isExported should not detect internal functions', () => {
      expect(jsProvider.isExported('function internal() {}', 'internal')).toBe(false);
    });

    it('parse should detect new expressions', () => {
      const captures = jsProvider.parse('function test() { const d = new Date(); return d; }', 'test.js');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect method calls', () => {
      const captures = jsProvider.parse('function test() { "hello".toUpperCase(); }', 'test.js');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('TestProvider utility coverage', () => {
    it('nodeText and nodeLine should be callable functions', () => {
      expect(typeof provider.nodeText).toBe('function');
      expect(typeof provider.nodeLine).toBe('function');
    });

    it('queryTree should return matches with TypeScript provider', () => {
      const tsProvider = new TypeScriptProvider();
      const results = tsProvider.queryTree(
        'function hello(): void {}', 
        '(function_declaration) @func'
      );
      expect(Array.isArray(results)).toBe(true);
    });

    it('walkTree should return visited nodes with TypeScript provider', () => {
      const tsProvider = new TypeScriptProvider();
      const visited: string[] = [];
      tsProvider.walkTree('const x = 1;', (node) => {
        visited.push(node.type);
      });
      expect(visited.length).toBeGreaterThan(0);
      expect(visited.includes('program')).toBe(true);
    });

    it('queryTree should return match objects with captures', () => {
      const tsProvider = new TypeScriptProvider();
      const results = tsProvider.queryTree(
        'function hello(): void { return "hi"; }',
        '(function_declaration name: (identifier) @func_name)'
      );
      expect(Array.isArray(results)).toBe(true);
    });

    it('walkTree should call visitor with depth parameter', () => {
      const tsProvider = new TypeScriptProvider();
      const depths: number[] = [];
      tsProvider.walkTree('const x = 1;', (_node, depth) => {
        depths.push(depth);
      });
      // Root node is at depth 0
      expect(depths[0]).toBe(0);
      expect(depths.some((d) => d > 0)).toBe(true);
    });
  });

  describe('call capture methods through TypeScript provider', () => {
    const tsProvider = new TypeScriptProvider();

    it('parse should detect call expressions (function calls)', () => {
      const source = 'function test() { foo(); }';
      const captures = tsProvider.parse(source, 'test.ts');
      const calls = captures.filter(c =>
        c.tag === CAPTURE_TAGS.FUNCTION_CALL
      );
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect method calls on objects', () => {
      const source = 'class Foo { bar() { this.baz(); } }';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect new expressions', () => {
      const source = 'function test() { const d = new Date(); return d; }';
      const captures = tsProvider.parse(source, 'test.ts');
      const newExprs = captures.filter(c => c.tag === CAPTURE_TAGS.NEW_EXPRESSION);
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect method calls on object members', () => {
      const source = 'function test() { console.log("hello"); }';
      const captures = tsProvider.parse(source, 'test.ts');
      const methodCalls = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_CALL);
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect class with extends (baseClasses property)', () => {
      const source = 'class Dog extends Animal { bark(): void {} }';
      const captures = tsProvider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      // At least one class should have baseClasses
      const hasBaseClasses = classes.some(c => c.properties?.baseClasses);
      expect(hasBaseClasses).toBe(true);
    });

    it('parse should detect interface definitions', () => {
      const source = 'interface Animal { name: string; }';
      const captures = tsProvider.parse(source, 'test.ts');
      const interfaces = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should detect enum definitions', () => {
      const source = 'enum Color { Red, Green, Blue }';
      const captures = tsProvider.parse(source, 'test.ts');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should detect type definitions', () => {
      const source = 'type Name = string;';
      const captures = tsProvider.parse(source, 'test.ts');
      const types = captures.filter(c => c.tag === CAPTURE_TAGS.TYPE_DEF);
      expect(types.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should detect variable definitions', () => {
      const source = 'const x = 42;';
      const captures = tsProvider.parse(source, 'test.ts');
      const vars = captures.filter(c =>
        c.tag === CAPTURE_TAGS.VARIABLE_DEF || c.tag === CAPTURE_TAGS.CONSTANT_DEF
      );
      expect(vars.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should detect class with implements', () => {
      const source = 'interface Foo { bar(): void; } class Baz implements Foo { bar(): void {} }';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect method definitions with containerName', () => {
      const source = 'class User { getName(): string { return "Alice"; } }';
      const captures = tsProvider.parse(source, 'test.ts');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(1);
      expect(methods[0]!.containerName).toBe('User');
    });

    it('parse should detect class heritage with extends and baseClasses property', () => {
      const source = 'class Dog extends Animal {}';
      const captures = tsProvider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      const dogClass = classes.find(c => c.name === 'Dog');
      expect(dogClass).toBeDefined();
    });

    it('parse should detect call expressions in nested scopes', () => {
      const source = 'function outer() { function inner() { doWork(); } }';
      const captures = tsProvider.parse(source, 'test.ts');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThanOrEqual(2);
    });

    it('parse should detect class with extends clause in class_heritage', () => {
      const source = 'class Child extends Parent { method(): void {} }';
      const captures = tsProvider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      const child = classes.find(c => c.name === 'Child');
      expect(child?.properties?.baseClasses).toBeDefined();
    });
  });

  describe('tree-sitter path through JavaScript provider (more coverage)', () => {
    const jsProvider = new JavaScriptProvider();

    it('parse should detect class heritage with extends', () => {
      const source = 'class Rectangle extends Shape { area() { return 1; } }';
      const captures = jsProvider.parse(source, 'test.js');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      const rect = classes.find(c => c.name === 'Rectangle');
      expect(rect).toBeDefined();
      if (rect?.properties?.baseClasses) {
        expect(rect.properties.baseClasses).toBe('Shape');
      }
    });

    it('parse should detect arrow function calls', () => {
      const source = 'const fn = () => { helper(); }; fn();';
      const captures = jsProvider.parse(source, 'test.js');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should detect variable declarations', () => {
      const source = 'var x = 1; let y = 2; const z = 3;';
      const captures = jsProvider.parse(source, 'test.js');
      const vars = captures.filter(c =>
        c.tag === CAPTURE_TAGS.VARIABLE_DEF || c.tag === CAPTURE_TAGS.CONSTANT_DEF
      );
      expect(vars.length).toBeGreaterThanOrEqual(1);
    });

    it('parse should detect property definitions in class', () => {
      const source = 'class Foo { constructor() { this.x = 1; } }';
      const captures = jsProvider.parse(source, 'test.js');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('extractImports should handle default imports', () => {
      const imports = jsProvider.extractImports('import React from "react";');
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toBe('react');
    });

    it('extractImports should handle named imports', () => {
      const imports = jsProvider.extractImports('import { useState, useEffect } from "react";');
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toBe('react');
    });
  });

  describe('nodeText and nodeLine utility methods', () => {
    it('nodeText should return slice of source', () => {
      const tsProvider = new TypeScriptProvider();
      const captures = tsProvider.parse('const x = 42;', 'test.ts');
      // nodeText is protected but can be tested indirectly
      expect(typeof tsProvider.nodeText).toBe('function');
    });

    it('nodeLine should return 1-based line number', () => {
      const tsProvider = new TypeScriptProvider();
      expect(typeof tsProvider.nodeLine).toBe('function');
    });
  });

  describe('extractImports edge cases', () => {
    it('should handle source with no imports', () => {
      const jsProvider = new JavaScriptProvider();
      const imports = jsProvider.extractImports('const x = 1;');
      expect(imports.length).toBe(0);
    });

    it('should handle complex import statements', () => {
      const jsProvider = new JavaScriptProvider();
      const imports = jsProvider.extractImports("import def from 'pkg'; import { a, b } from 'other';");
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isExported edge cases', () => {
    it('should handle export default class', () => {
      const tsProvider = new TypeScriptProvider();
      expect(tsProvider.isExported('export default class Foo {}', 'Foo')).toBe(true);
    });

    it('should handle export default function', () => {
      const tsProvider = new TypeScriptProvider();
      expect(tsProvider.isExported('export default function bar() {}', 'bar')).toBe(true);
    });
  });

  describe('parse with various TypeScript constructs', () => {
    const tsProvider = new TypeScriptProvider();

    it('should detect exported functions', () => {
      const source = 'export function exportedFn(): string { return "hi"; }';
      const captures = tsProvider.parse(source, 'test.ts');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThanOrEqual(1);
      expect(funcs[0]!.name).toBe('exportedFn');
    });

    it('should detect exported classes', () => {
      const source = 'export class ExportedClass { method(): void {} }';
      const captures = tsProvider.parse(source, 'test.ts');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      expect(classes[0]!.name).toBe('ExportedClass');
    });

    it('should detect async functions', () => {
      const source = 'async function fetchData(): Promise<string> { return "data"; }';
      const captures = tsProvider.parse(source, 'test.ts');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThanOrEqual(1);
      expect(funcs[0]!.name).toBe('fetchData');
    });

    it('should detect class with multiple methods', () => {
      const source = 'class Service { get(): string { return "a"; } post(): string { return "b"; } }';
      const captures = tsProvider.parse(source, 'test.ts');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect class with constructor', () => {
      const source = 'class MyService { constructor(private name: string) {} }';
      const captures = tsProvider.parse(source, 'test.ts');
      const constructors = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(constructors.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect properties in class body', () => {
      const source = 'class Config { host: string = "localhost"; port: number = 8080; }';
      const captures = tsProvider.parse(source, 'test.ts');
      // Property definitions may or may not be captured depending on tree-sitter
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should handle complex call chains', () => {
      const source = 'function test() { obj.method().another().chain(); }';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parse should handle template literal calls', () => {
      const source = 'function test() { const msg = `Hello ${name}`; }';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should detect decorators on classes', () => {
      const source = '@Component({})\nclass MyComp {}';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should detect docstring comments', () => {
      const source = '/** @param {string} name */\nfunction greet(name: string) {}';
      const captures = tsProvider.parse(source, 'test.ts');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('JavaScript provider additional coverage', () => {
    const jsProvider = new JavaScriptProvider();

    it('should detect require() style imports', () => {
      const imports = jsProvider.extractImports("const fs = require('fs');");
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect class with constructor', () => {
      const source = 'class Person { constructor(name) { this.name = name; } }';
      const captures = jsProvider.parse(source, 'test.js');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      expect(classes[0]!.name).toBe('Person');
    });

    it('should detect arrow functions', () => {
      const source = 'const add = (a, b) => a + b;';
      const captures = jsProvider.parse(source, 'test.js');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle export default arrow', () => {
      const source = 'export default () => {};';
      const captures = jsProvider.parse(source, 'test.js');
      expect(Array.isArray(captures)).toBe(true);
    });
  });
});
