import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { CppProvider } from '../languages/cpp.js';

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
  });

  describe('parse — classes, structs, enums', () => {
    it('should extract a class definition', () => {
      const code = 'class Foo {\npublic:\n  int x;\n};';
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

    it('should extract a scoped enum', () => {
      const code = 'enum class Color { RED, GREEN };';
      const captures = provider.parse(code, 't.cpp');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
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
  });

  describe('extractImports', () => {
    it('should extract include paths', () => {
      const code = '#include <iostream>\n#include "foo.h"';
      const imports = provider.extractImports(code, 't.cpp');
      expect(imports.some((i) => i.source === 'iostream')).toBe(true);
      expect(imports.some((i) => i.source === 'foo.h')).toBe(true);
    });

    it('should return empty for code without includes', () => {
      expect(provider.extractImports('int x = 1;', 't.cpp')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should report a public function as exported', () => {
      expect(provider.isExported('int main() {}', 'main')).toBe(true);
    });

    it('should report a static function as not exported', () => {
      expect(provider.isExported('static void helper() {}', 'helper')).toBe(false);
    });

    it('should report a class as exported', () => {
      expect(provider.isExported('class Foo {};', 'Foo')).toBe(true);
    });

    it('should report an anonymous-namespace symbol as not exported', () => {
      expect(provider.isExported('namespace {\n  int hidden;\n}', 'hidden')).toBe(false);
    });
  });
});
