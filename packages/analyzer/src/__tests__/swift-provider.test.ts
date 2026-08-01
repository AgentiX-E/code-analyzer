import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { SwiftProvider } from '../languages/swift.js';

describe('SwiftProvider', () => {
  const provider = new SwiftProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('swift');
      expect(provider.displayName).toBe('Swift');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.swift');
    });
  });

  describe('parse', () => {
    it('detects functions', () => {
      const captures = provider.parse('func greet(name: String) -> String {\n  return "Hello"\n}', 'test.swift');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(c => c.name === 'greet')).toBe(true);
    });

    it('detects classes', () => {
      const captures = provider.parse('class MyClass {\n  func method() {}\n}', 'test.swift');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects class with inheritance', () => {
      const captures = provider.parse('class Dog: Animal {\n}', 'test.swift');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'Dog')).toBe(true);
    });

    it('detects structs', () => {
      const captures = provider.parse('struct Point {\n  var x: Double\n  var y: Double\n}', 'test.swift');
      const structs = captures.filter(c => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some(c => c.name === 'Point')).toBe(true);
    });

    it('detects protocols', () => {
      const captures = provider.parse('protocol Drawable {\n  func draw()\n}', 'test.swift');
      const protocols = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(protocols.some(c => c.name === 'Drawable')).toBe(true);
    });

    it('detects enums', () => {
      const captures = provider.parse('enum Color {\n  case red, green, blue\n}', 'test.swift');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(c => c.name === 'Color')).toBe(true);
    });

    it('detects extensions', () => {
      const captures = provider.parse('extension String {\n  func isValid() -> Bool { return true }\n}', 'test.swift');
      const extensions = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.isExtension === 'true');
      expect(extensions.some(c => c.name === 'String')).toBe(true);
    });

    it('detects variables', () => {
      const captures = provider.parse('var count: Int = 0\nlet name: String = "test"', 'test.swift');
      const vars = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF || c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(vars.length).toBeGreaterThanOrEqual(2);
    });

    it('detects imports', () => {
      const captures = provider.parse('import Foundation\nimport UIKit', 'test.swift');
      const imports = captures.filter(c => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'empty.swift');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('extracts import statements', () => {
      const imports = provider.extractImports('import Foundation\nimport UIKit');
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts submodule imports', () => {
      const imports = provider.extractImports('import Foundation.NSString');
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isExported', () => {
    it('detects public function', () => {
      expect(provider.isExported('public func doWork() {}', 'doWork')).toBe(true);
    });

    it('detects public class', () => {
      expect(provider.isExported('public class Service {}', 'Service')).toBe(true);
    });
  });
});
