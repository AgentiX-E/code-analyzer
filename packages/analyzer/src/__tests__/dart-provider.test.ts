import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { DartProvider } from '../languages/dart.js';

describe('DartProvider', () => {
  const provider = new DartProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('dart');
    });
    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Dart');
    });
    it('should match .dart extension', () => {
      expect(provider.extensions).toContain('.dart');
    });
    it('should have "named" import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — classes', () => {
    it('should parse a class definition', () => {
      const captures = provider.parse('class User {}', 'test.dart');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'User')).toBe(true);
    });
    it('should parse an abstract class', () => {
      const captures = provider.parse('abstract class Shape {}', 'test.dart');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Shape')).toBe(true);
    });
  });

  describe('parse — mixins and enums', () => {
    it('should parse a mixin', () => {
      const captures = provider.parse('mixin Loggable {}', 'test.dart');
      const mixins = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(mixins.some((c) => c.name === 'Loggable')).toBe(true);
    });
    it('should parse an enum', () => {
      const captures = provider.parse('enum Color { red, green }', 'test.dart');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });
  });

  describe('parse — functions', () => {
    it('should parse a block function with a return type', () => {
      const captures = provider.parse('void main() {}', 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'main')).toBe(true);
    });
    it('should parse a function without a return type', () => {
      const captures = provider.parse('greet() { print("hi"); }', 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
    });
    it('should parse an arrow function', () => {
      const captures = provider.parse('int add(int a, int b) => a + b;', 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });
    it('should not treat control-flow keywords as functions', () => {
      const captures = provider.parse('for (var i = 0; i < 3; i++) { print(i); }', 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'for')).toBe(false);
    });
    it('should not treat control-flow keywords as arrow functions', () => {
      const captures = provider.parse('for (x) => y;', 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'for')).toBe(false);
    });
  });

  describe('parse — imports', () => {
    it('should parse a package import', () => {
      const captures = provider.parse("import 'package:http/http.dart';", 'test.dart');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'package:http/http.dart')).toBe(true);
    });
    it('should parse a double-quoted import', () => {
      const captures = provider.parse('import "dart:core";', 'test.dart');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'dart:core')).toBe(true);
    });
  });

  describe('parse — edge cases', () => {
    it('should handle empty files', () => {
      expect(provider.parse('', 'empty.dart')).toEqual([]);
    });
    it('should include filePath in properties', () => {
      const captures = provider.parse('class A {}', 'myfile.dart');
      expect(captures[0]?.properties?.filePath).toBe('myfile.dart');
    });
    it('should return captures sorted by line', () => {
      const code = 'class A {}\nclass B {}\nclass C {}';
      const captures = provider.parse(code, 'test.dart');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });
    it('should sort same-line captures by byte offset', () => {
      const captures = provider.parse('class A {} class B {}', 'test.dart');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.map((c) => c.name)).toEqual(['A', 'B']);
    });
  });

  describe('extractImports', () => {
    it('should extract imports', () => {
      const imports = provider.extractImports("import 'a.dart';\nimport 'b.dart';");
      expect(imports).toHaveLength(2);
      expect(imports[0]?.source).toBe('a.dart');
      expect(imports[0]?.type).toBe('named');
    });
    it('should include line numbers', () => {
      const imports = provider.extractImports('\nimport "utils.dart";');
      expect(imports[0]?.lineNumber).toBe(2);
    });
    it('should handle files without imports', () => {
      expect(provider.extractImports('class A {}')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return true for public classes', () => {
      expect(provider.isExported('class Public {}', 'Public')).toBe(true);
    });
    it('should return true for public functions', () => {
      expect(provider.isExported('void run() {}', 'run')).toBe(true);
    });
    it('should return false for private (underscore-prefixed) symbols', () => {
      expect(provider.isExported('class _Private {}', '_Private')).toBe(false);
    });
    it('should return false for unknown symbols', () => {
      expect(provider.isExported('class A {}', 'missing')).toBe(false);
    });
  });
});
