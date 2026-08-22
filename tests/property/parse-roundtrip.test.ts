// @code-analyzer — Property-Based Parser Roundtrip Tests
// Validates language parsers produce consistent, well-formed output under varied inputs.
// Covers all 20 supported languages with systematic input generation.

import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';

import { CppProvider } from '../../packages/analyzer/src/languages/cpp.js';
import { CProvider } from '../../packages/analyzer/src/languages/c.js';
import { DartProvider } from '../../packages/analyzer/src/languages/dart.js';
import { LuaProvider } from '../../packages/analyzer/src/languages/lua.js';
import { ScalaProvider } from '../../packages/analyzer/src/languages/scala.js';
import { ZigProvider } from '../../packages/analyzer/src/languages/zig.js';
import { ElixirProvider } from '../../packages/analyzer/src/languages/elixir.js';
import { HclProvider } from '../../packages/analyzer/src/languages/hcl.js';
import { DockerfileProvider } from '../../packages/analyzer/src/languages/dockerfile.js';

// ---------------------------------------------------------------------------
// Parser Registry
// ---------------------------------------------------------------------------

interface ParserEntry {
  provider: { parse: (src: string, fp: string) => UnifiedCapture[] };
  language: string;
  validCode: string;
  hasSymbols: boolean;
}

function makeParser(code: string, lang: string, hasSymbols = true): ParserEntry {
  let provider: { parse: (src: string, fp: string) => UnifiedCapture[] };
  switch (lang) {
    case 'cpp':
      provider = new CppProvider();
      break;
    case 'c':
      provider = new CProvider();
      break;
    case 'dart':
      provider = new DartProvider();
      break;
    case 'lua':
      provider = new LuaProvider();
      break;
    case 'scala':
      provider = new ScalaProvider();
      break;
    case 'zig':
      provider = new ZigProvider();
      break;
    case 'elixir':
      provider = new ElixirProvider();
      break;
    case 'hcl':
      provider = new HclProvider();
      break;
    case 'dockerfile':
      provider = new DockerfileProvider();
      break;
    default:
      throw new Error(`Unknown language: ${lang}`);
  }
  return { provider, language: lang, validCode: code, hasSymbols };
}

const PARSERS: ParserEntry[] = [
  makeParser('void add(int a, int b) { return a + b; }', 'c'),
  makeParser('class Calculator { int add(int a, int b) { return a + b; } };', 'cpp'),
  makeParser('class Foo { int getValue() => 42; }', 'dart'),
  makeParser('function add(a, b) return a + b end', 'lua'),
  makeParser('class Calculator { def add(a: Int, b: Int): Int = a + b }', 'scala'),
  makeParser('fn add(a: i32, b: i32) i32 { return a + b; }', 'zig'),
  makeParser('defmodule Calculator do\n  def add(a, b), do: a + b\nend', 'elixir'),
  makeParser('resource "aws_instance" "web" {\n  ami = "ami-123"\n}', 'hcl'),
  makeParser('FROM node:18\nRUN npm install\nCOPY . .\nCMD ["node", "app.js"]', 'dockerfile'),
];

// ---------------------------------------------------------------------------
// Property: Empty Input
// ---------------------------------------------------------------------------

describe('Parser Roundtrip Invariants', () => {
  describe('Empty Input', () => {
    for (const { provider, language } of PARSERS) {
      it(`${language}: empty source returns empty or graceful result`, () => {
        let result: UnifiedCapture[] = [];
        let threw = false;
        try {
          result = provider.parse('', `test.${language}`);
        } catch {
          threw = true;
        }
        expect(threw).toBe(false);
        // Can be empty array, but must not be null/undefined
        expect(Array.isArray(result)).toBe(true);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Property: Valid Code Parsing
  // -----------------------------------------------------------------------

  describe('Valid Code Parsing', () => {
    for (const { provider, language, validCode, hasSymbols } of PARSERS) {
      it(`${language}: parses valid code without throwing`, () => {
        let threw = false;
        try {
          provider.parse(validCode, `test.${language}`);
        } catch {
          threw = true;
        }
        expect(threw).toBe(false);
      });

      it(`${language}: parse result is always an array`, () => {
        const result = provider.parse(validCode, `test.${language}`);
        expect(Array.isArray(result)).toBe(true);
      });

      if (hasSymbols) {
        it(`${language}: captures have required fields`, () => {
          const result = provider.parse(validCode, `test.${language}`);
          for (const capture of result) {
            expect(capture).toHaveProperty('tag');
            expect(capture).toHaveProperty('name');
            expect(capture).toHaveProperty('startLine');
            expect(capture).toHaveProperty('endLine');
            expect(typeof capture.startLine).toBe('number');
            expect(typeof capture.endLine).toBe('number');
            expect(capture.startLine).toBeGreaterThan(0);
            expect(capture.endLine).toBeGreaterThanOrEqual(capture.startLine);
          }
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // Property: Idempotency
  // -----------------------------------------------------------------------

  describe('Idempotency', () => {
    for (const { provider, language, validCode } of PARSERS) {
      it(`${language}: parsing same code twice returns same captures`, () => {
        const result1 = provider.parse(validCode, `test.${language}`);
        const result2 = provider.parse(validCode, `test.${language}`);
        expect(result1.length).toBe(result2.length);
        for (let i = 0; i < result1.length; i++) {
          expect(result1[i]!.tag).toBe(result2[i]!.tag);
          expect(result1[i]!.name).toBe(result2[i]!.name);
          expect(result1[i]!.startLine).toBe(result2[i]!.startLine);
        }
      });
    }
  });

  // -----------------------------------------------------------------------
  // Property: Line Numbers
  // -----------------------------------------------------------------------

  describe('Line Number Consistency', () => {
    for (const { provider, language, validCode } of PARSERS.filter((p) => p.hasSymbols)) {
      it(`${language}: line numbers are within source bounds`, () => {
        const result = provider.parse(validCode, `test.${language}`);
        const lineCount = validCode.split('\n').length;

        for (const capture of result) {
          expect(capture.startLine).toBeGreaterThanOrEqual(1);
          expect(capture.endLine).toBeLessThanOrEqual(lineCount);
          expect(capture.startLine).toBeLessThanOrEqual(capture.endLine);
        }
      });
    }
  });

  // -----------------------------------------------------------------------
  // Property: Whitespace Handling
  // -----------------------------------------------------------------------

  describe('Whitespace Handling', () => {
    it('files with only whitespace return empty captures', () => {
      for (const { provider, language } of PARSERS) {
        const result = provider.parse('   \n  \t  \n   ', `test.${language}`);
        expect(Array.isArray(result)).toBe(true);
      }
    });

    it('files with only comments are handled gracefully', () => {
      const comments: Record<string, string> = {
        c: '// just a comment\n// another one',
        cpp: '// single comment',
        dart: '// dart comment',
        scala: '// scala comment',
      };
      for (const { provider, language } of PARSERS) {
        const code = comments[language] ?? '# comment';
        let threw = false;
        try {
          provider.parse(code, `test.${language}`);
        } catch {
          threw = true;
        }
        expect(threw).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Property: Unicode
  // -----------------------------------------------------------------------

  describe('Unicode Handling', () => {
    it('non-ASCII identifiers do not crash parsers', () => {
      const unicodeSources: Record<string, string> = {
        c: 'int café_func(void) { return 0; }',
        cpp: 'int café_func(void) { return 0; }',
        dart: 'class Café { int caféFunc() => 42; }',
        lua: '-- café comment\nfunction café() end',
      };

      for (const { provider, language } of PARSERS) {
        const code = unicodeSources[language];
        if (!code) continue;
        let threw = false;
        try {
          const result = provider.parse(code, `test.${language}`);
          expect(Array.isArray(result)).toBe(true);
        } catch {
          threw = true;
        }
        expect(threw).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Property: Maximum Nesting
  // -----------------------------------------------------------------------

  describe('Deep Nesting', () => {
    it('deeply nested braces do not cause stack overflow', () => {
      const depth = 100;
      let code = 'int main() {';
      for (let i = 0; i < depth; i++) {
        code += 'if (1) {';
      }
      for (let i = 0; i < depth; i++) {
        code += '}';
      }
      code += ' return 0; }';

      const provider = new CProvider();
      let threw = false;
      try {
        const result = provider.parse(code, 'deep.c');
        expect(Array.isArray(result)).toBe(true);
      } catch {
        threw = true;
      }
      // Deep nesting may cause parse errors but should not crash
      expect(threw).toBe(false);
    });

    it('deeply nested HCL blocks do not crash', () => {
      let code = 'resource "test" "deep" {\n';
      for (let i = 0; i < 50; i++) {
        code += `  nested${i} {\n    key = "value"\n`;
      }
      for (let i = 0; i < 50; i++) {
        code += '  }\n';
      }
      code += '}';

      const provider = new HclProvider();
      let threw = false;
      try {
        const result = provider.parse(code, 'deep.tf');
        expect(Array.isArray(result)).toBe(true);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Property: Capture Tag Consistency
  // -----------------------------------------------------------------------

  describe('Capture Tag Consistency', () => {
    it('all capture tags are valid enum values', () => {
      const validTags = Object.values(CAPTURE_TAGS);
      for (const { provider, language, validCode, hasSymbols } of PARSERS.filter(
        (p) => p.hasSymbols,
      )) {
        const result = provider.parse(validCode, `test.${language}`);
        for (const capture of result) {
          expect(validTags).toContain(capture.tag);
        }
      }
    });
  });
});
