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
  });

  describe('parse', () => {
    it('detects method definitions', () => {
      const captures = provider.parse("def hello\n  return 'hi'\nend", 'test.rb');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some(c => c.name === 'hello')).toBe(true);
    });

    it('detects class definitions', () => {
      const captures = provider.parse("class MyClass\n  def method\n  end\nend", 'test.rb');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects class with inheritance', () => {
      const captures = provider.parse("class Dog < Animal\nend", 'test.rb');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'Dog')).toBe(true);
    });

    it('detects module definitions', () => {
      const captures = provider.parse("module Utilities\n  def self.helper\n  end\nend", 'test.rb');
      const modules = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(modules.some(c => c.name === 'Utilities')).toBe(true);
    });

    it('detects constants', () => {
      const captures = provider.parse("MAX_SIZE = 100\nDEFAULT_CONFIG = { key: 'value' }", 'test.rb');
      const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts.some(c => c.name === 'MAX_SIZE')).toBe(true);
    });

    it('detects attr_accessor', () => {
      const captures = provider.parse("class User\n  attr_accessor :name, :email\nend", 'test.rb');
      const vars = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some(v => v.name === 'name')).toBe(true);
    });

    it('detects imports (require)', () => {
      const captures = provider.parse("require 'json'\nrequire 'net/http'", 'test.rb');
      const imports = captures.filter(c => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'empty.rb');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('extracts require statements', () => {
      const imports = provider.extractImports("require 'json'\nrequire 'net/http'");
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts require_relative', () => {
      const imports = provider.extractImports("require_relative '../lib/helper'");
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isExported', () => {
    it('detects class as public', () => {
      expect(provider.isExported("class MyClass\nend", 'MyClass')).toBe(true);
    });
  });
});
