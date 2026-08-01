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

    it('should detect class methods and constructors', () => {
      const source = 'class Person {\n  constructor(name) { this.name = name; }\n  greet() { return "hi"; }\n}';
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
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'outer');
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
  });
});
