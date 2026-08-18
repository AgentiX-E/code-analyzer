import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { CProvider } from '../languages/c.js';

describe('CProvider', () => {
  const provider = new CProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('c');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('C');
    });

    it('should have .c and .h extensions', () => {
      expect(provider.extensions).toContain('.c');
      expect(provider.extensions).toContain('.h');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — functions', () => {
    it('should extract a function definition', () => {
      const code = 'int main() {\n  return 0;\n}';
      const captures = provider.parse(code, 'main.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'main')).toBe(true);
    });

    it('should extract a function declaration', () => {
      const code = 'void foo(void);';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'foo')).toBe(true);
    });

    it('should extract a function with parameters', () => {
      const code = 'int add(int a, int b) {\n  return a + b;\n}';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should extract a static function', () => {
      const code = 'static void helper(void) {}';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'helper')).toBe(true);
    });

    it('should not treat control-flow keywords as functions', () => {
      const code = 'void loop(void) {\n  if (1) {}\n  for (;;) {}\n}';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'if' || c.name === 'for')).toBe(false);
    });
  });

  describe('parse — structs and enums', () => {
    it('should extract a struct definition', () => {
      const code = 'struct Point {\n  int x;\n};';
      const captures = provider.parse(code, 't.c');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });

    it('should extract an enum definition', () => {
      const code = 'enum Color { RED, GREEN };';
      const captures = provider.parse(code, 't.c');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });
  });

  describe('parse — includes', () => {
    it('should extract system-library includes', () => {
      const code = '#include <stdio.h>\nint main() { return 0; }';
      const captures = provider.parse(code, 't.c');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'stdio.h')).toBe(true);
    });

    it('should extract local includes', () => {
      const code = '#include "local.h"\nint main() { return 0; }';
      const captures = provider.parse(code, 't.c');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'local.h')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract include paths', () => {
      const code = '#include <stdio.h>\n#include "local.h"';
      const imports = provider.extractImports(code, 't.c');
      expect(imports.some((i) => i.source === 'stdio.h')).toBe(true);
      expect(imports.some((i) => i.source === 'local.h')).toBe(true);
    });

    it('should return empty for code without includes', () => {
      expect(provider.extractImports('int x = 1;', 't.c')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should report a public function as exported', () => {
      expect(provider.isExported('int main() {}', 'main')).toBe(true);
    });

    it('should report a static function as not exported', () => {
      expect(provider.isExported('static void helper() {}', 'helper')).toBe(false);
    });

    it('should report a struct as exported', () => {
      expect(provider.isExported('struct Point {};', 'Point')).toBe(true);
    });
  });
});
