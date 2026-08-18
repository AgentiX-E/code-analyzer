import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { ZigProvider } from '../languages/zig.js';

describe('ZigProvider', () => {
  const provider = new ZigProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('zig');
    });
    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Zig');
    });
    it('should match .zig extension', () => {
      expect(provider.extensions).toContain('.zig');
    });
    it('should have "named" import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — functions', () => {
    it('should parse a private function', () => {
      const captures = provider.parse('fn add(a: i32, b: i32) i32 { return a + b; }', 'test.zig');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const add = funcs.find((c) => c.name === 'add');
      expect(add).toBeDefined();
      expect(add?.properties?.isPublic).toBe('false');
    });
    it('should parse a public function', () => {
      const captures = provider.parse('pub fn main() void {}', 'test.zig');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const main = funcs.find((c) => c.name === 'main');
      expect(main).toBeDefined();
      expect(main?.properties?.isPublic).toBe('true');
    });
  });

  describe('parse — structs and enums', () => {
    it('should parse a struct declaration', () => {
      const captures = provider.parse('const Point = struct { x: f32, y: f32 };', 'test.zig');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });
    it('should parse an enum declaration', () => {
      const captures = provider.parse('const Color = enum { red, green };', 'test.zig');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });
  });

  describe('parse — imports', () => {
    it('should parse @import', () => {
      const captures = provider.parse('const std = @import("std");', 'test.zig');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'std')).toBe(true);
    });
  });

  describe('parse — variables', () => {
    it('should parse const declarations', () => {
      const captures = provider.parse('const answer = 42;', 'test.zig');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      const answer = vars.find((c) => c.name === 'answer');
      expect(answer).toBeDefined();
      expect(answer?.properties?.isMutable).toBeUndefined();
    });
    it('should parse var declarations with a type', () => {
      const captures = provider.parse('var count: u32 = 0;', 'test.zig');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      const count = vars.find((c) => c.name === 'count');
      expect(count).toBeDefined();
      expect(count?.properties?.isMutable).toBe('true');
    });
  });

  describe('parse — edge cases', () => {
    it('should handle empty files', () => {
      expect(provider.parse('', 'empty.zig')).toEqual([]);
    });
    it('should include filePath in properties', () => {
      const captures = provider.parse('fn f() void {}', 'myfile.zig');
      expect(captures[0]?.properties?.filePath).toBe('myfile.zig');
    });
    it('should return captures sorted by line', () => {
      const code = 'const a = 1;\nfn b() void {}\nconst c = 3;';
      const captures = provider.parse(code, 'test.zig');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });
  });

  describe('extractImports', () => {
    it('should extract @import sources', () => {
      const imports = provider.extractImports('const a = @import("a");\nconst b = @import("b");');
      expect(imports).toHaveLength(2);
      expect(imports[0]?.source).toBe('a');
      expect(imports[0]?.type).toBe('named');
    });
    it('should handle files without imports', () => {
      expect(provider.extractImports('const x = 1;')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should return true for pub functions', () => {
      expect(provider.isExported('pub fn run() void {}', 'run')).toBe(true);
    });
    it('should return true for pub const declarations', () => {
      expect(provider.isExported('pub const x = 1;', 'x')).toBe(true);
    });
    it('should return false for private symbols', () => {
      expect(provider.isExported('fn hidden() void {}', 'hidden')).toBe(false);
    });
    it('should return false for unknown symbols', () => {
      expect(provider.isExported('fn f() void {}', 'missing')).toBe(false);
    });
  });
});
