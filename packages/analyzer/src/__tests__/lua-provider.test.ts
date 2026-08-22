import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { LuaProvider } from '../languages/lua.js';

describe('LuaProvider', () => {
  const provider = new LuaProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('lua');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Lua');
    });

    it('should match .lua extension', () => {
      expect(provider.extensions).toContain('.lua');
    });

    it('should have "named" import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — functions', () => {
    it('should parse a global function definition', () => {
      const captures = provider.parse('function greet()\nend', 'test.lua');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
      expect(funcs.find((c) => c.name === 'greet')?.properties?.isLocal).toBe('false');
    });

    it('should parse a local function definition', () => {
      const captures = provider.parse('local function helper()\nend', 'test.lua');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'helper')).toBe(true);
      expect(funcs.find((c) => c.name === 'helper')?.properties?.isLocal).toBe('true');
    });

    it('should parse namespaced functions', () => {
      const captures = provider.parse('function my.module.deep()\nend', 'test.lua');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'my.module.deep')).toBe(true);
    });
  });

  describe('parse — table methods', () => {
    it('should parse dot-indexed methods', () => {
      const captures = provider.parse('function obj.method()\nend', 'test.lua');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'obj.method')).toBe(true);
    });

    it('should parse colon methods', () => {
      const captures = provider.parse('function obj:method()\nend', 'test.lua');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'obj.method')).toBe(true);
    });
  });

  describe('parse — imports', () => {
    it('should parse require("module")', () => {
      const captures = provider.parse('local http = require("http")', 'test.lua');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'http')).toBe(true);
    });

    it("should parse require 'module' (single quotes)", () => {
      const captures = provider.parse("local x = require('socket')", 'test.lua');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'socket')).toBe(true);
    });
  });

  describe('parse — variables', () => {
    it('should parse local variable assignments', () => {
      const captures = provider.parse('local count = 0\nlocal name = "x"', 'test.lua');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'count')).toBe(true);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
    });
  });

  describe('parse — edge cases', () => {
    it('should handle empty files', () => {
      expect(provider.parse('', 'empty.lua')).toEqual([]);
    });

    it('should include filePath in properties', () => {
      const captures = provider.parse('function f()\nend', 'myfile.lua');
      expect(captures[0]?.properties?.filePath).toBe('myfile.lua');
    });

    it('should return captures sorted by line', () => {
      const code = 'local a = 1\nfunction b()\nend\nlocal c = 2';
      const captures = provider.parse(code, 'test.lua');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });
  });

  describe('extractImports', () => {
    it('should extract require imports', () => {
      const imports = provider.extractImports('require("a")\nrequire("b")');
      expect(imports).toHaveLength(2);
      expect(imports[0]?.source).toBe('a');
      expect(imports[0]?.type).toBe('named');
    });

    it('should include line numbers', () => {
      const imports = provider.extractImports('\nrequire("utils")');
      expect(imports[0]?.lineNumber).toBe(2);
    });

    it('should handle files without imports', () => {
      expect(provider.extractImports('local x = 1')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return true for global functions', () => {
      expect(provider.isExported('function global()\nend', 'global')).toBe(true);
    });

    it('should return false for local functions', () => {
      expect(provider.isExported('local function hidden()\nend', 'hidden')).toBe(false);
    });

    it('should return false for unknown symbols', () => {
      expect(provider.isExported('function global()\nend', 'missing')).toBe(false);
    });
  });
});
