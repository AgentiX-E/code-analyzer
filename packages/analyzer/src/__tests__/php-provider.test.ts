import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { PhpProvider } from '../languages/php.js';

describe('PhpProvider', () => {
  const provider = new PhpProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('php');
      expect(provider.displayName).toBe('PHP');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.php');
      expect(provider.extensions).toContain('.phtml');
    });
  });

  describe('parse', () => {
    it('detects functions', () => {
      const captures = provider.parse('function hello() { return "hi"; }', 'test.php');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'hello')).toBe(true);
    });

    it('detects classes', () => {
      const captures = provider.parse('class MyClass {\n  public function method() {}\n}', 'test.php');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects interfaces', () => {
      const captures = provider.parse('interface MyInterface {\n  public function doSomething();\n}', 'test.php');
      const ifaces = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some(c => c.name === 'MyInterface')).toBe(true);
    });

    it('detects traits', () => {
      const captures = provider.parse('trait Loggable {\n  public function log($msg) {}\n}', 'test.php');
      const traits = captures.filter(c => c.tag === CAPTURE_TAGS.TRAIT_DEF);
      expect(traits.some(c => c.name === 'Loggable')).toBe(true);
    });

    it('detects enums', () => {
      const captures = provider.parse('enum Color {\n  case Red;\n  case Green;\n}', 'test.php');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(c => c.name === 'Color')).toBe(true);
    });

    it('detects imports (use statements)', () => {
      const captures = provider.parse('use App\\Models\\User;\nclass Test {}', 'test.php');
      const imports = captures.filter(c => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'empty.php');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('extracts use statements', () => {
      const imports = provider.extractImports('use App\\Models\\User;\nuse App\\Services\\Auth;');
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts require/include', () => {
      const imports = provider.extractImports("require 'config.php';\ninclude_once 'helpers.php';");
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('detects public function', () => {
      expect(provider.isExported('public function handle() {}', 'handle')).toBe(true);
    });

    it('detects class as exported', () => {
      expect(provider.isExported('class MyService {}', 'MyService')).toBe(true);
    });
  });
});
