import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { RubyProvider } from '../languages/ruby.js';

describe('RubyProvider', () => {
  const provider = new RubyProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('ruby');
      expect(provider.displayName).toBe('Ruby');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.rb');
    });

    it('uses named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse (tree-sitter)', () => {
    it('detects method definitions', () => {
      const captures = provider.parse("def hello\n  return 'hi'\nend", 'test.rb');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'hello')).toBe(true);
    });

    it('detects class definitions', () => {
      const captures = provider.parse('class MyClass\n  def method\n  end\nend', 'test.rb');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyClass')).toBe(true);
    });

    it('detects class with inheritance', () => {
      const captures = provider.parse('class Dog < Animal\nend', 'test.rb');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Dog')).toBe(true);
    });

    it('detects module definitions', () => {
      const captures = provider.parse('module Utilities\n  def self.helper\n  end\nend', 'test.rb');
      const modules = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(modules.some((c) => c.name === 'Utilities')).toBe(true);
    });

    it('detects constants', () => {
      const captures = provider.parse(
        "MAX_SIZE = 100\nDEFAULT_CONFIG = { key: 'value' }",
        'test.rb',
      );
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts.some((c) => c.name === 'MAX_SIZE')).toBe(true);
    });

    it('skips lowercase assignments (no constant)', () => {
      const captures = provider.parse('foo = 1\nbar = 2', 'test.rb');
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts).toHaveLength(0);
    });

    it('detects attr_accessor symbols', () => {
      const captures = provider.parse('class User\n  attr_accessor :name, :email\nend', 'test.rb');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((v) => v.name === 'name')).toBe(true);
    });

    it('detects attr_reader with a string argument', () => {
      const captures = provider.parse("attr_reader 'name'", 'test.rb');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((v) => v.name === 'name')).toBe(true);
    });

    it('detects attr_reader with a bare identifier argument', () => {
      const captures = provider.parse('attr_reader name', 'test.rb');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((v) => v.name === 'name')).toBe(true);
    });

    it('detects imports (require)', () => {
      const captures = provider.parse("require 'json'\nrequire 'net/http'", 'test.rb');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('detects require_relative and load imports', () => {
      const captures = provider.parse("require_relative '../lib/foo'\nload 'config.rb'", 'test.rb');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('detects require invoked on a receiver (self.require)', () => {
      const captures = provider.parse("self.require 'json'", 'test.rb');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((i) => i.name === 'json')).toBe(true);
    });

    it('skips require with a non-string argument', () => {
      const captures = provider.parse('require some_variable', 'test.rb');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(0);
    });

    it('emits nothing for a plain call (puts)', () => {
      const captures = provider.parse("puts 'hi'", 'test.rb');
      expect(captures).toHaveLength(0);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'empty.rb');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('falls back to regex on malformed input', () => {
      const captures = provider.parse('def broken(', 'broken.rb');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'broken')).toBe(true);
    });
  });

  describe('extractImports (tree-sitter)', () => {
    it('extracts require statements', () => {
      const imports = provider.extractImports("require 'json'\nrequire 'net/http'");
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts require_relative', () => {
      const imports = provider.extractImports("require_relative '../lib/helper'");
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts load', () => {
      const imports = provider.extractImports("load 'config.rb'");
      expect(imports.some((i) => i.source === 'config.rb')).toBe(true);
    });

    it('extracts the basename as the imported name', () => {
      const imports = provider.extractImports("require_relative '../lib/foo'");
      expect(imports.some((i) => i.source === '../lib/foo' && i.names.includes('foo'))).toBe(true);
    });

    it('extracts require invoked on a receiver (self.require)', () => {
      const imports = provider.extractImports("self.require 'json'");
      expect(imports.some((i) => i.source === 'json')).toBe(true);
    });

    it('skips require with a non-string argument', () => {
      expect(provider.extractImports('require some_variable')).toEqual([]);
    });

    it('skips a bare require without arguments', () => {
      expect(provider.extractImports('require')).toEqual([]);
    });

    it('returns empty for non-require calls', () => {
      expect(provider.extractImports("puts 'hi'")).toEqual([]);
    });
  });

  describe('isExported (tree-sitter)', () => {
    it('detects class as public', () => {
      expect(provider.isExported('class MyClass\nend', 'MyClass')).toBe(true);
    });

    it('returns false for a non-existent symbol', () => {
      expect(provider.isExported('class MyClass\nend', 'Other')).toBe(false);
    });

    it('detects a method as public', () => {
      expect(provider.isExported('def hello\nend', 'hello')).toBe(true);
    });

    it('detects a module as public', () => {
      expect(provider.isExported('module Utilities\nend', 'Utilities')).toBe(true);
    });

    it('detects a singleton method as public', () => {
      expect(provider.isExported('def self.helper\nend', 'helper')).toBe(true);
    });
  });

  describe('fallbackParse (regex)', () => {
    it('detects method definitions', () => {
      const captures = provider.fallbackParse('def hello\nend', 'f.rb');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'hello')).toBe(
        true,
      );
    });

    it('detects singleton method definitions', () => {
      const captures = provider.fallbackParse('def self.helper\nend', 'f.rb');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'helper')).toBe(
        true,
      );
    });

    it('detects classes with a base class', () => {
      const captures = provider.fallbackParse('class Dog < Animal\nend', 'f.rb');
      const cls = captures.find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Dog');
      expect(cls).toBeDefined();
      expect(cls!.properties.baseClasses).toBe('Animal');
    });

    it('detects classes without a base class', () => {
      const captures = provider.fallbackParse('class Plain\nend', 'f.rb');
      const cls = captures.find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Plain');
      expect(cls).toBeDefined();
      expect(cls!.properties.baseClasses).toBe('');
    });

    it('detects modules', () => {
      const captures = provider.fallbackParse('module Utilities\nend', 'f.rb');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Utilities')).toBe(
        true,
      );
    });

    it('detects constants', () => {
      const captures = provider.fallbackParse('MAX_SIZE = 100', 'f.rb');
      expect(
        captures.some((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'MAX_SIZE'),
      ).toBe(true);
    });

    it('detects attr_accessor symbols', () => {
      const captures = provider.fallbackParse('attr_accessor :name', 'f.rb');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'name')).toBe(
        true,
      );
    });

    it('detects require, require_relative and load imports', () => {
      const captures = provider.fallbackParse(
        "require 'json'\nrequire_relative '../lib/foo'\nload 'config.rb'",
        'f.rb',
      );
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(3);
    });

    it('sorts captures by line and byte', () => {
      const captures = provider.fallbackParse('class A\nend\ndef m\nend', 'f.rb');
      expect(captures.map((c) => c.name)).toEqual(['A', 'm']);
    });

    it('sorts same-line captures by byte offset', () => {
      const captures = provider.fallbackParse('attr_accessor :name; attr_reader :email', 'f.rb');
      expect(captures.map((c) => c.name)).toEqual(['name', 'email']);
    });

    it('returns empty for empty source', () => {
      expect(provider.fallbackParse('', 'empty.rb')).toEqual([]);
    });
  });

  describe('fallbackExtractImports (regex)', () => {
    it('extracts require', () => {
      const imports = provider.fallbackExtractImports("require 'json'");
      expect(imports).toEqual([{ source: 'json', names: ['json'], type: 'named', lineNumber: 1 }]);
    });

    it('extracts require_relative with the basename', () => {
      const imports = provider.fallbackExtractImports("require_relative '../lib/foo'");
      expect(imports[0]!.source).toBe('../lib/foo');
      expect(imports[0]!.names).toEqual(['foo']);
    });

    it('extracts load', () => {
      const imports = provider.fallbackExtractImports("load 'config.rb'");
      expect(imports[0]!.source).toBe('config.rb');
    });

    it('returns empty for empty source', () => {
      expect(provider.fallbackExtractImports('')).toEqual([]);
    });
  });

  describe('fallbackIsExported (regex)', () => {
    it('detects a public method', () => {
      expect(provider.fallbackIsExported('def hello\nend', 'hello')).toBe(true);
    });

    it('detects a class', () => {
      expect(provider.fallbackIsExported('class MyClass\nend', 'MyClass')).toBe(true);
    });

    it('detects a module', () => {
      expect(provider.fallbackIsExported('module Utilities\nend', 'Utilities')).toBe(true);
    });

    it('rejects a private method', () => {
      expect(provider.fallbackIsExported('private\ndef secret\nend', 'secret')).toBe(false);
    });

    it('rejects a non-existent symbol', () => {
      expect(provider.fallbackIsExported('class Foo\nend', 'Bar')).toBe(false);
    });
  });
});
