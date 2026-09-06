import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { GoProvider } from '../languages/go.js';

/** GoProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexGoProvider extends GoProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

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

    it('should mark exported functions by their uppercase first letter', () => {
      const source = `package main\n\nfunc Hello() {}\n\nfunc _hidden() {}\n`;
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.find((f) => f.name === 'Hello')?.properties?.exported).toBe('true');
      expect(funcs.find((f) => f.name === '_hidden')?.properties?.exported).toBe('false');
    });

    it('should detect method definitions with receivers', () => {
      const source = `package main\n\ntype Dog struct {}\n\nfunc (d *Dog) Bark() {\n    println("woof")\n}`;
      const captures = provider.parse(source, 'test.go');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('Bark');
      expect(methods[0]!.containerName).toBe('Dog');
    });

    it.each([
      ['value receiver', 'func (r T) M() {}', 'T'],
      ['pointer receiver', 'func (r *T) M() {}', 'T'],
      ['pointer-to-pointer receiver', 'func (r **T) M() {}', 'T'],
      ['qualified receiver', 'func (r io.Reader) M() {}', 'Reader'],
      ['pointer-to-qualified receiver', 'func (r *io.Reader) M() {}', 'Reader'],
      ['generic receiver', 'func (r List[int]) M() {}', 'List'],
      ['pointer-to-generic receiver', 'func (r *List[int]) M() {}', 'List'],
      ['qualified generic receiver', 'func (r pkg.List[int]) M() {}', 'List'],
    ])('extracts the receiver type name for %s', (_label, decl, expected) => {
      const captures = provider.parse(`package main\n\n${decl}\n`, 'test.go');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.containerName).toBe(expected);
      expect(methods[0]!.properties?.receiverType).toBe(expected);
    });

    it('should detect struct definitions', () => {
      const source = `package main\n\ntype Person struct {\n    Name string\n    Age  int\n}`;
      const captures = provider.parse(source, 'test.go');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs).toHaveLength(1);
      expect(structs[0]!.name).toBe('Person');
    });

    it('should detect interface definitions', () => {
      // tree-sitter-go requires a trailing newline after the closing brace of a
      // type declaration, otherwise the parse reports hasError and falls back to
      // regex (masking the tree-sitter path).
      const source = `package main\n\ntype Reader interface {\n\tRead(p []byte) (n int, err error)\n}\n`;
      const captures = provider.parse(source, 'test.go');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]!.name).toBe('Reader');
    });

    it('should detect type aliases', () => {
      const source = `package main\n\ntype MyInt int\n`;
      const captures = provider.parse(source, 'test.go');
      const types = captures.filter((c) => c.tag === CAPTURE_TAGS.TYPE_DEF);
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('MyInt');
    });

    it('should detect grouped imports with alias as captures', () => {
      const source = `package main\n\nimport (\n\tf "fmt"\n\t"os"\n)\n`;
      const captures = provider.parse(source, 'test.go');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((i) => i.name === 'fmt' && i.properties?.alias === 'f')).toBe(true);
      expect(imports.some((i) => i.name === 'os')).toBe(true);
    });

    it('should detect raw-string-literal (backtick) imports', () => {
      const source = 'package main\n\nimport `fmt`\n';
      const captures = provider.parse(source, 'test.go');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((i) => i.name === 'fmt')).toBe(true);
    });

    it('should detect blank imports without an alias', () => {
      const source = `package main\n\nimport _ "fmt"\n`;
      const captures = provider.parse(source, 'test.go');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]!.name).toBe('fmt');
      expect(imports[0]!.properties?.alias).toBe('');
    });

    it('should skip imports with an empty path', () => {
      const captures = provider.parse('package main\n\nimport ""\n', 'test.go');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(0);
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

    it('should detect single variable declarations', () => {
      const source = `package main\n\nvar x = 1\n`;
      const captures = provider.parse(source, 'test.go');
      const vars = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && !c.text?.startsWith('package'),
      );
      expect(vars.map((c) => c.name)).toEqual(['x']);
    });

    it('should detect grouped variable declarations', () => {
      const source = `package main\n\nvar (\n\ta = 1\n\tb = 2\n)\n`;
      const captures = provider.parse(source, 'test.go');
      const vars = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && !c.text?.startsWith('package'),
      );
      expect(vars.map((c) => c.name)).toEqual(['a', 'b']);
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

    it('should skip imports with an empty path', () => {
      const imports = provider.extractImports('import ""');
      expect(imports).toHaveLength(0);
    });
  });

  describe('isExported', () => {
    it('should return true for uppercase names', () => {
      expect(provider.isExported('func Hello() {}', 'Hello')).toBe(true);
    });

    it('should return false for lowercase names', () => {
      expect(provider.isExported('func hello() {}', 'hello')).toBe(false);
    });

    it('should return false for underscore-prefixed names', () => {
      expect(provider.isExported('func _hidden() {}', '_hidden')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(provider.isExported('func F() {}', '')).toBe(false);
    });

    it('should handle single char uppercase', () => {
      expect(provider.isExported('func H() {}', 'H')).toBe(true);
    });
  });

  describe('regex fallback (no parser)', () => {
    const fallback = new RegexGoProvider();

    it('should parse functions, methods, structs, interfaces, package, and imports', () => {
      const source = `package main\n\nfunc Foo() {}\n\nfunc (r *T) M() {}\n\ntype S struct {}\n\ntype I interface {}\n\nimport "fmt"\n`;
      const captures = fallback.parse(source, 'test.go');
      expect(
        captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF).map((c) => c.name),
      ).toContain('Foo');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('M');
      expect(methods[0]!.containerName).toBe('T');
      expect(
        captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF).map((c) => c.name),
      ).toContain('S');
      expect(
        captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF).map((c) => c.name),
      ).toContain('I');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'main')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'fmt')).toBe(true);
    });

    it('should omit the package capture when there is no package clause', () => {
      const captures = fallback.parse('func A() {}\n', 'test.go');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF)).toBe(false);
    });

    it('should order same-line captures by byte offset', () => {
      const captures = fallback.parse('func A() {} func B() {}\n', 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['A', 'B']);
    });

    it('should parse single, aliased, and grouped imports', () => {
      const source = 'import "fmt"\nimport f "os"\nimport (\n    "strings"\n    s "sort"\n)\n';
      const imports = fallback.extractImports(source);
      expect(imports.map((i) => i.source)).toEqual(
        expect.arrayContaining(['fmt', 'os', 'strings', 'sort']),
      );
      const namespaced = imports.filter((i) => i.type === 'namespace');
      expect(namespaced.map((i) => i.names[0])).toEqual(expect.arrayContaining(['f', 's']));
    });

    it('should match the AST export check', () => {
      expect(fallback.isExported('', 'Hello')).toBe(true);
      expect(fallback.isExported('', 'hello')).toBe(false);
      expect(fallback.isExported('', '_hidden')).toBe(false);
      expect(fallback.isExported('', '')).toBe(false);
    });
  });
});
