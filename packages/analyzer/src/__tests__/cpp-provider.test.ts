import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { CppProvider } from '../languages/cpp.js';

/** CppProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexCppProvider extends CppProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

describe('CppProvider', () => {
  const provider = new CppProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('cpp');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('C++');
    });

    it('should have .cpp and .hpp extensions', () => {
      expect(provider.extensions).toContain('.cpp');
      expect(provider.extensions).toContain('.hpp');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — functions', () => {
    it('should extract a function definition', () => {
      const code = 'int main() {\n  return 0;\n}';
      const captures = provider.parse(code, 'main.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'main')).toBe(true);
    });

    it('should extract a member function', () => {
      const code = 'class A {\n  void foo() {}\n};';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'foo')).toBe(true);
    });

    it('should extract a static function', () => {
      const code = 'static void helper() {}';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'helper')).toBe(true);
    });

    it('should extract a forward declaration', () => {
      const code = 'int add(int a, int b);';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should extract a qualified out-of-class member definition', () => {
      const code = 'void Foo::bar() {}\n';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'bar')).toBe(true);
    });

    it('should extract a deeply-qualified function name', () => {
      const code = 'void a::b::foo() {}\n';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'foo')).toBe(true);
    });

    it('should extract a destructor', () => {
      const code = 'class A {\n  ~A() {}\n};\n';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === '~A')).toBe(true);
    });

    it('should extract an operator overload', () => {
      const code = 'bool operator==(const A& a) const { return true; }\n';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'operator==')).toBe(true);
    });

    it('should skip a function pointer', () => {
      const code = 'int (*fp)(int);\n';
      const captures = provider.parse(code, 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(0);
    });
  });

  describe('parse — classes, structs, enums', () => {
    it('should extract a class definition', () => {
      const code = 'class Foo {\npublic:\n  int x;\n};';
      const captures = provider.parse(code, 't.cpp');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should extract a qualified class name', () => {
      const code = 'class ns::Foo {\n  int x;\n};\n';
      const captures = provider.parse(code, 't.cpp');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should extract a template class specialization name', () => {
      const code = 'template <class T>\nclass Foo<T*> {\n  T x;\n};\n';
      const captures = provider.parse(code, 't.cpp');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should extract a struct definition', () => {
      const code = 'struct Point {\n  int x;\n};';
      const captures = provider.parse(code, 't.cpp');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });

    it('should skip an anonymous struct', () => {
      const code = 'struct {\n  int x;\n};\n';
      const captures = provider.parse(code, 't.cpp');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs).toHaveLength(0);
    });

    it('should skip an anonymous class', () => {
      const code = 'class {\n  int x;\n};\n';
      const captures = provider.parse(code, 't.cpp');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(0);
    });

    it('should extract a scoped enum', () => {
      const code = 'enum class Color { RED, GREEN };';
      const captures = provider.parse(code, 't.cpp');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should extract an unscoped enum', () => {
      const code = 'enum Color { RED, GREEN };';
      const captures = provider.parse(code, 't.cpp');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should skip an anonymous enum', () => {
      const code = 'enum { A, B };\n';
      const captures = provider.parse(code, 't.cpp');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums).toHaveLength(0);
    });
  });

  describe('parse — includes', () => {
    it('should extract system-library includes', () => {
      const code = '#include <iostream>\nint main() { return 0; }';
      const captures = provider.parse(code, 't.cpp');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'iostream')).toBe(true);
    });

    it('should extract local includes', () => {
      const code = '#include "foo.h"\nint main() { return 0; }';
      const captures = provider.parse(code, 't.cpp');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'foo.h')).toBe(true);
    });

    it('should skip a macro include', () => {
      const code = '#include SOME_MACRO\nint main() { return 0; }';
      const captures = provider.parse(code, 't.cpp');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(0);
    });
  });

  describe('extractImports', () => {
    it('should extract include paths', () => {
      const code = '#include <iostream>\n#include "foo.h"';
      const imports = provider.extractImports(code, 't.cpp');
      expect(imports.some((i) => i.source === 'iostream')).toBe(true);
      expect(imports.some((i) => i.source === 'foo.h')).toBe(true);
    });

    it('should use the basename for nested include paths', () => {
      const imports = provider.extractImports('#include "a/b/c.h"', 't.cpp');
      expect(imports[0]?.names).toEqual(['c.h']);
    });

    it('should return empty for code without includes', () => {
      expect(provider.extractImports('int x = 1;', 't.cpp')).toEqual([]);
    });

    it('should skip a macro include', () => {
      expect(provider.extractImports('#include SOME_MACRO', 't.cpp')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should report a public function as exported', () => {
      expect(provider.isExported('int main() {}', 'main')).toBe(true);
    });

    it('should report a qualified function as exported', () => {
      expect(provider.isExported('void Foo::bar() {}', 'bar')).toBe(true);
    });

    it('should report a static function as not exported', () => {
      expect(provider.isExported('static void helper() {}', 'helper')).toBe(false);
    });

    it('should report a class as exported', () => {
      expect(provider.isExported('class Foo {};', 'Foo')).toBe(true);
    });

    it('should report a struct as exported', () => {
      expect(provider.isExported('struct Point {};', 'Point')).toBe(true);
    });

    it('should report an enum as exported', () => {
      expect(provider.isExported('enum Color { RED };', 'Color')).toBe(true);
    });

    it('should report a non-matching symbol as not exported', () => {
      expect(provider.isExported('int main() {}', 'other')).toBe(false);
    });

    it('should report an anonymous-namespace function as not exported', () => {
      expect(provider.isExported('namespace {\n  int foo() { return 0; }\n}', 'foo')).toBe(false);
    });

    it('should report a named-namespace function as exported', () => {
      expect(provider.isExported('namespace util {\n  int foo() { return 0; }\n}', 'foo')).toBe(
        true,
      );
    });

    it('should report a C++17 nested-namespace function as exported', () => {
      expect(provider.isExported('namespace a::b {\n  int foo() { return 0; }\n}', 'foo')).toBe(
        true,
      );
    });

    it('should not let a preceding static variable shadow a public function', () => {
      expect(provider.isExported('static int g = 0;\nvoid foo() {}', 'foo')).toBe(true);
    });
  });

  describe('fallback (regex)', () => {
    const fallback = new RegexCppProvider();

    it('should parse classes, structs, enums, functions, includes', () => {
      const code =
        'class Foo {};\nstruct Point {};\nenum Color { RED };\nint main() {}\n#include <iostream>\n';
      const captures = fallback.parse(code, 't.cpp');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Foo')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF && c.name === 'Point')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.ENUM_DEF && c.name === 'Color')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'main')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'iostream')).toBe(
        true,
      );
    });

    it('should filter keyword-like function names', () => {
      const captures = fallback.parse('if (x) { y(); }', 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.filter((c) => c.name === 'if')).toHaveLength(0);
    });

    it('should sort captures by position', () => {
      const captures = fallback.parse('int b() {}\nint a() {}', 't.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should sort same-line captures by byte offset', () => {
      const captures = fallback.parse('class A {}; class B {};', 't.cpp');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.map((c) => c.name)).toEqual(['A', 'B']);
    });

    it('should return empty captures for empty source', () => {
      expect(fallback.parse('', 't.cpp')).toEqual([]);
    });

    it('should extract includes', () => {
      const imports = fallback.extractImports('#include <iostream>\n#include "a/b.h"', 't.cpp');
      expect(imports.some((i) => i.source === 'iostream')).toBe(true);
      expect(imports.some((i) => i.source === 'a/b.h' && i.names[0] === 'b.h')).toBe(true);
    });

    it('should return empty imports without includes', () => {
      expect(fallback.extractImports('int x = 1;', 't.cpp')).toEqual([]);
    });

    it('should report a function as exported', () => {
      expect(fallback.isExported('int main() {}', 'main')).toBe(true);
    });

    it('should report a static function as not exported', () => {
      expect(fallback.isExported('static int helper() {}', 'helper')).toBe(false);
    });

    it('should report a class as exported', () => {
      expect(fallback.isExported('class Foo {};', 'Foo')).toBe(true);
    });

    it('should escape regex metacharacters in the symbol', () => {
      expect(fallback.isExported('int main() {}', 'ma(n')).toBe(false);
    });
  });
});
