import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { CProvider } from '../languages/c.js';

/** CProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexCProvider extends CProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

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

    it('should extract a pointer-returning function definition', () => {
      const code = 'int *fp(int x) { return 0; }';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fp')).toBe(true);
    });

    it('should extract a pointer-returning function declaration', () => {
      const code = 'void *foo(void);';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'foo')).toBe(true);
    });

    it('should not treat a function pointer as a function', () => {
      const code = 'int (*handler)(int);';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(0);
    });

    it('should not treat a pointer variable as a function', () => {
      const code = 'int *x;';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(0);
    });

    it('should not treat a variable declaration as a function', () => {
      const code = 'int x = 1;';
      const captures = provider.parse(code, 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(0);
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

    it('should extract a typedef struct definition', () => {
      const code = 'typedef struct Foo { int x; } Foo;';
      const captures = provider.parse(code, 't.c');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should skip an anonymous struct', () => {
      const code = 'struct { int x; } anon;';
      const captures = provider.parse(code, 't.c');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs).toHaveLength(0);
    });

    it('should extract an enum definition', () => {
      const code = 'enum Color { RED, GREEN };';
      const captures = provider.parse(code, 't.c');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should skip an anonymous enum', () => {
      const code = 'enum { A, B } e;';
      const captures = provider.parse(code, 't.c');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums).toHaveLength(0);
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

    it('should skip a macro include', () => {
      const code = '#include MY_MACRO\nint main() { return 0; }';
      const captures = provider.parse(code, 't.c');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(0);
    });
  });

  describe('extractImports', () => {
    it('should extract include paths', () => {
      const code = '#include <stdio.h>\n#include "local.h"';
      const imports = provider.extractImports(code, 't.c');
      expect(imports.some((i) => i.source === 'stdio.h')).toBe(true);
      expect(imports.some((i) => i.source === 'local.h')).toBe(true);
    });

    it('should return empty for a macro include', () => {
      expect(provider.extractImports('#include MY_MACRO', 't.c')).toEqual([]);
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

    it('should report a static inline function as not exported', () => {
      expect(provider.isExported('static inline void helper() {}', 'helper')).toBe(false);
    });

    it('should report an inline static function as not exported', () => {
      expect(provider.isExported('inline static void helper() {}', 'helper')).toBe(false);
    });

    it('should report an extern function as exported', () => {
      expect(provider.isExported('extern int foo(void);', 'foo')).toBe(true);
    });

    it('should report a pointer-returning function as exported', () => {
      expect(provider.isExported('void *foo(void);', 'foo')).toBe(true);
    });

    it('should report a struct as exported', () => {
      expect(provider.isExported('struct Point {};', 'Point')).toBe(true);
    });

    it('should report an enum as exported', () => {
      expect(provider.isExported('enum Color { RED };', 'Color')).toBe(true);
    });

    it('should not be fooled by a "static" comment', () => {
      expect(provider.isExported('int foo(void) {} // static helper', 'foo')).toBe(true);
    });

    it('should return false for an unknown symbol', () => {
      expect(provider.isExported('int foo(void) {}', 'bar')).toBe(false);
    });
  });

  describe('fallback (regex)', () => {
    const fallback = new RegexCProvider();

    it('should parse functions, structs, enums, and includes', () => {
      const code =
        'int main(void) {}\nstruct Point { int x; };\nenum Color { RED };\n#include <stdio.h>\n';
      const captures = fallback.parse(code, 't.c');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'main')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF && c.name === 'Point')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.ENUM_DEF && c.name === 'Color')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'stdio.h')).toBe(
        true,
      );
    });

    it('should parse a pointer-returning function (space before star)', () => {
      const captures = fallback.parse('int *fp(int x) {}', 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fp')).toBe(true);
    });

    it('should parse a pointer-returning function (star attached to type)', () => {
      const captures = fallback.parse('int* fp(int x) {}', 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fp')).toBe(true);
    });

    it('should parse a multi-word return type', () => {
      const captures = fallback.parse('unsigned long fn(void) {}', 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fn')).toBe(true);
    });

    it('should parse a typedef struct', () => {
      const captures = fallback.parse('typedef struct Foo { int x; } Foo;', 't.c');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should filter keyword-like function names', () => {
      const captures = fallback.parse('int if(x) {}', 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(0);
    });

    it('should sort captures by position', () => {
      const captures = fallback.parse('int b() {}\nint a() {}', 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should sort same-line captures by byte offset', () => {
      const captures = fallback.parse('int b() {} int a() {}', 't.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should return empty captures for empty source', () => {
      expect(fallback.parse('', 't.c')).toEqual([]);
    });

    it('should extract include imports', () => {
      const imports = fallback.extractImports('#include <stdio.h>\n#include "local.h"', 't.c');
      expect(imports.some((i) => i.source === 'stdio.h')).toBe(true);
      expect(imports.some((i) => i.source === 'local.h')).toBe(true);
    });

    it('should return empty imports without includes', () => {
      expect(fallback.extractImports('int x = 1;', 't.c')).toEqual([]);
    });

    it('should report a public function as exported', () => {
      expect(fallback.isExported('int main() {}', 'main')).toBe(true);
    });

    it('should report a static function as not exported', () => {
      expect(fallback.isExported('static void helper() {}', 'helper')).toBe(false);
    });

    it('should report a static inline function as not exported', () => {
      expect(fallback.isExported('static inline void helper() {}', 'helper')).toBe(false);
    });

    it('should report a struct as exported', () => {
      expect(fallback.isExported('struct Point {};', 'Point')).toBe(true);
    });

    it('should report an enum as exported', () => {
      expect(fallback.isExported('enum Color {};', 'Color')).toBe(true);
    });

    it('should return false for a non-matching symbol', () => {
      expect(fallback.isExported('int foo() {}', 'bar')).toBe(false);
    });
  });
});
