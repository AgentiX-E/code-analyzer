import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { GoProvider } from '../languages/go.js';

describe('GoProvider', () => {
  const provider = new GoProvider();

  describe('properties', () => {
    it('should have correct language and display name', () => {
      expect(provider.language).toBe('go');
      expect(provider.displayName).toBe('Go');
    });

    it('should have .go extension', () => {
      expect(provider.extensions).toContain('.go');
    });

    it('should have wildcard-leaf import semantics', () => {
      expect(provider.importSemantics).toBe('wildcard-leaf');
    });
  });

  describe('parse', () => {
    it('should detect function definitions', () => {
      const source = `package main\n\nfunc Hello() string {\n    return "hi"\n}`;
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const helloFunc = funcs.find((f) => f.name === 'Hello');
      expect(helloFunc).toBeDefined();
    });

    it('should detect method definitions with receivers', () => {
      const source = `package main\n\ntype Dog struct {}\n\nfunc (d *Dog) Bark() {\n    println("woof")\n}`;
      const captures = provider.parse(source, 'test.go');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('Bark');
    });

    it('should detect struct definitions', () => {
      const source = `package main\n\ntype Person struct {\n    Name string\n    Age  int\n}`;
      const captures = provider.parse(source, 'test.go');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs).toHaveLength(1);
      expect(structs[0]!.name).toBe('Person');
    });

    it('should detect interface definitions', () => {
      const source = `package main\n\ntype Reader interface {\n    Read(p []byte) (n int, err error)\n}`;
      const captures = provider.parse(source, 'test.go');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]!.name).toBe('Reader');
    });

    it('should detect package declaration', () => {
      const source = `package main`;
      const captures = provider.parse(source, 'test.go');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((v) => v.text?.includes('package'))).toBe(true);
    });

    it('should detect constant declarations', () => {
      const source = `package main\nconst MaxRetries = 3\n`;
      const captures = provider.parse(source, 'test.go');
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      const maxConst = consts.find((c) => c.name === 'MaxRetries');
      expect(maxConst).toBeDefined();
    });

    it('should return results sorted by start line', () => {
      const source = `package main\n\nimport "fmt"\n\nfunc A() {}\nfunc B() {}\n`;
      const captures = provider.parse(source, 'test.go');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.go');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should parse single imports', () => {
      const source = `import "fmt"`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('fmt');
    });

    it('should parse aliased imports', () => {
      const source = `import f "fmt"`;
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.names).toContain('f');
    });

    it('should parse multi-line imports', () => {
      const source = `import (\n    "fmt"\n    "os"\n    "strings"\n)`;
      const imports = provider.extractImports(source);
      expect(imports.length).toBe(3);
    });
  });

  describe('isExported', () => {
    it('should return true for uppercase names', () => {
      expect(provider.isExported('func Hello() {}', 'Hello')).toBe(true);
    });

    it('should return false for lowercase names', () => {
      expect(provider.isExported('func hello() {}', 'hello')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(provider.isExported('func F() {}', '')).toBe(false);
    });

    it('should handle single char uppercase', () => {
      expect(provider.isExported('func H() {}', 'H')).toBe(true);
    });
  });
});
