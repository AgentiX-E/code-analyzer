// @code-analyzer — Parser Edge Case Tests
// Validates language parsers handle extreme and malformed inputs gracefully.

import { describe, it, expect } from 'vitest';
import { CppProvider } from '../languages/cpp.js';
import { CProvider } from '../languages/c.js';
import { ScalaProvider } from '../languages/scala.js';
import { LuaProvider } from '../languages/lua.js';
import { ZigProvider } from '../languages/zig.js';
import { ElixirProvider } from '../languages/elixir.js';
import { DartProvider } from '../languages/dart.js';
import { HclProvider } from '../languages/hcl.js';
import { DockerfileProvider } from '../languages/dockerfile.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSafe(
  provider: { parse: (src: string, fp: string) => UnifiedCapture[] },
  source: string,
  filePath: string,
): UnifiedCapture[] {
  let result: UnifiedCapture[] = [];
  let threw = false;
  try {
    result = provider.parse(source, filePath);
  } catch {
    threw = true;
  }
  // Parsing should never throw — return gracefully even on malformed input
  expect(threw).toBe(false);
  expect(Array.isArray(result)).toBe(true);
  return result;
}

// ---------------------------------------------------------------------------
// Long Files
// ---------------------------------------------------------------------------

describe('Parser Edge Cases', () => {
  describe('Long Files', () => {
    it('C: 10K-line file does not crash', () => {
      const provider = new CProvider();
      const lines: string[] = [];
      for (let i = 0; i < 10_000; i++) {
        lines.push(`int func${i}(void) { return ${i}; }`);
      }
      const source = lines.join('\n');
      const result = parseSafe(provider, source, 'long.c');
      // Should parse at least some functions
      expect(result.length).toBeGreaterThan(0);
    });

    it('C++: very large file is handled', () => {
      const provider = new CppProvider();
      const lines: string[] = ['#include <vector>'];
      for (let i = 0; i < 5_000; i++) {
        lines.push(`class C${i} { public: int m${i}; };`);
      }
      const result = parseSafe(provider, lines.join('\n'), 'large.cpp');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Whitespace-Only
  // -----------------------------------------------------------------------

  describe('Whitespace-Only Files', () => {
    const whitespaceOnly = '   \n\n  \t  \n   \n';

    it('C: whitespace-only returns empty', () => {
      const provider = new CProvider();
      const result = provider.parse(whitespaceOnly, 'empty.c');
      expect(Array.isArray(result)).toBe(true);
    });

    it('C++: whitespace-only returns empty', () => {
      const provider = new CppProvider();
      const result = provider.parse(whitespaceOnly, 'empty.cpp');
      expect(Array.isArray(result)).toBe(true);
    });

    it('all parsers handle whitespace-only gracefully', () => {
      const providers = [
        new CProvider(), new CppProvider(), new ScalaProvider(),
        new LuaProvider(), new ZigProvider(), new ElixirProvider(),
        new DartProvider(), new DockerfileProvider(),
      ];
      for (const provider of providers) {
        const result = parseSafe(provider, whitespaceOnly, `empty.${provider.language}`);
        expect(result).toEqual([]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Mixed Line Endings
  // -----------------------------------------------------------------------

  describe('Mixed Line Endings', () => {
    it('C: CRLF line endings work', () => {
      const provider = new CProvider();
      const source = 'int main(void) {\r\n  return 0;\r\n}';
      const result = parseSafe(provider, source, 'crlf.c');
      expect(result.length).toBeGreaterThan(0);
    });

    it('C++: mixed CRLF/LF works', () => {
      const provider = new CppProvider();
      const source = 'class Foo {\r\npublic:\n  int bar();\r\n};';
      const result = parseSafe(provider, source, 'mixed.cpp');
      expect(result.length).toBeGreaterThan(0);
    });

    it('Lua: CR line endings are handled', () => {
      const provider = new LuaProvider();
      const source = 'function greet()\r  print("hello")\rend';
      const result = parseSafe(provider, source, 'cr.lua');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Null Bytes
  // -----------------------------------------------------------------------

  describe('Null Bytes', () => {
    it('C: null byte in source is handled', () => {
      const provider = new CProvider();
      const source = 'int main(void) { return 0; }\0hidden';
      const result = parseSafe(provider, source, 'null.c');
      expect(Array.isArray(result)).toBe(true);
    });

    it('HCL: null bytes do not crash', () => {
      const provider = new HclProvider();
      const source = 'resource "test" "null" {\0  key = "val"\n}';
      const result = parseSafe(provider, source, 'null.tf');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Control Characters
  // -----------------------------------------------------------------------

  describe('Control Characters', () => {
    it('C: SOH/STX control chars are tolerated', () => {
      const provider = new CProvider();
      const source = 'int main(void) { return 0; }';
      const result = parseSafe(provider, source, 'control.c');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Unmatched Delimiters
  // -----------------------------------------------------------------------

  describe('Unmatched Delimiters', () => {
    it('C: unmatched brace produces graceful fallback', () => {
      const provider = new CProvider();
      const source = 'int main(void) { return 0;';
      const result = parseSafe(provider, source, 'unmatched.c');
      expect(Array.isArray(result)).toBe(true);
    });

    it('Scala: unmatched brace handled', () => {
      const provider = new ScalaProvider();
      const source = 'class Foo { def bar = 42';
      const result = parseSafe(provider, source, 'unmatched.scala');
      expect(Array.isArray(result)).toBe(true);
    });

    it('Dart: missing closing bracket handled', () => {
      const provider = new DartProvider();
      const source = 'class Foo {\n  int bar() => 42;\n';
      const result = parseSafe(provider, source, 'unmatched.dart');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Very Large Token Sequences
  // -----------------------------------------------------------------------

  describe('Large Token Sequences', () => {
    it('C: very long single-line expression does not crash', () => {
      const provider = new CProvider();
      const source = `int main(void) { return ${'1 + '.repeat(1000)} 0; }`;
      const result = parseSafe(provider, source, 'long_expr.c');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
