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
      expect(methods[0]!.containerName).toBe('Dog');
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
      expect(vars.length).toBeGreaterThanOrEqual(1);
      expect(vars.some((v) => v.text?.includes('package'))).toBe(true);
    });

    it('should detect variable declarations', () => {
      const source = `package main\nvar Version = "1.0.0"\n`;
      const captures = provider.parse(source, 'test.go');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      const versionVar = vars.find((v) => v.name === 'Version');
      expect(versionVar).toBeDefined();
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

    it('should return true for struct names', () => {
      expect(provider.isExported('type Config struct {}', 'Config')).toBe(true);
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

    it('should handle single char lowercase', () => {
      expect(provider.isExported('func h() {}', 'h')).toBe(false);
    });
  });

  describe('complex source parsing', () => {
    it('should handle method with value receiver', () => {
      const source = 'package main\n\ntype Point struct { X int }\nfunc (p Point) Scale(factor int) {\n}';
      const captures = provider.parse(source, 'test.go');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('Scale');
      expect(methods[0]!.containerName).toBe('Point');
    });

    it('should handle function with line comment inside body', () => {
      const source = 'package main\nfunc Foo() {\n// comment\nreturn\n}';
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('Foo');
      expect(funcs[0]!.endLine).toBe(5);
    });

    it('should handle struct with line comment inside body', () => {
      const source = 'package main\ntype Config struct {\n// TODO: add field\nName string\n}';
      const captures = provider.parse(source, 'test.go');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs).toHaveLength(1);
      expect(structs[0]!.name).toBe('Config');
    });

    it('should handle interface with string in body', () => {
      const source = 'package main\ntype Greeter interface {\nGreet(name string) string\n}';
      const captures = provider.parse(source, 'test.go');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]!.name).toBe('Greeter');
    });

    it('should handle multi-line import with alias', () => {
      const source = 'import (\n\tf "fmt"\n\t"os"\n)';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(2);
      const aliased = imports.find((i) => i.type === 'namespace');
      expect(aliased).toBeDefined();
      expect(aliased!.names).toContain('f');
    });

    it('should handle multiple structs with methods', () => {
      const source = 'package main\ntype Dog struct {}\nfunc (d *Dog) Bark() {}\nfunc (d *Dog) Eat() {}\ntype Cat struct {}\nfunc (c *Cat) Meow() {}';
      const captures = provider.parse(source, 'test.go');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.go');
      expect(captures).toHaveLength(0);
    });

    it('should handle source with only package declaration', () => {
      const source = 'package main';
      const captures = provider.parse(source, 'test.go');
      const packageVars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'main');
      expect(packageVars.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip reserved keywords in variable declarations', () => {
      const source = 'package main\nvar if = 1\nvar defer = 2\n';
      const captures = provider.parse(source, 'test.go');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      // 'if' and 'defer' are reserved keywords, should be skipped
      expect(vars.find((v) => v.name === 'if')).toBeUndefined();
      expect(vars.find((v) => v.name === 'defer')).toBeUndefined();
    });

    it('should skip reserved keywords in const declarations', () => {
      const source = 'package main\nconst select = "value"\nconst switch = 42\n';
      const captures = provider.parse(source, 'test.go');
      const consts = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts.find((c) => c.name === 'select')).toBeUndefined();
      expect(consts.find((c) => c.name === 'switch')).toBeUndefined();
    });

    it('should handle function with string containing braces', () => {
      const source = 'package main\n\nfunc Format() string {\n    return "text {with} braces"\n}';
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'Format');
      expect(funcs).toHaveLength(1);
    });

    it('should handle multiple named imports with mixed alias and path', () => {
      const source = 'import f "fmt"\nimport "os"\nimport s "strings"';
      const imports = provider.extractImports(source);
      expect(imports).toHaveLength(3);
      // Single import regex runs first, so 'os' is first
      expect(imports[0]!.source).toBe('os');
      // Named imports follow
      const aliasedImports = imports.filter((i) => i.type === 'namespace');
      expect(aliasedImports).toHaveLength(2);
      expect(aliasedImports.some((i) => i.names.includes('f'))).toBe(true);
      expect(aliasedImports.some((i) => i.names.includes('s'))).toBe(true);
    });

    it('should handle function with nested brace block', () => {
      const source = 'package main\nfunc Outer() {\n\tif true {\n\t\treturn\n\t}\n\treturn\n}';
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'Outer');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.endLine).toBeGreaterThan(funcs[0]!.startLine);
    });

    it('should handle struct with nested brace in tag', () => {
      const source = 'package main\ntype Model struct {\n\tName string `json:"name"`\n}';
      const captures = provider.parse(source, 'test.go');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs).toHaveLength(1);
      expect(structs[0]!.name).toBe('Model');
    });

    it('should handle function with named returns', () => {
      const source = 'package main\nfunc Divide(a, b int) (result int, err error) {\n\treturn\n}';
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('Divide');
    });

    it('should handle function with single named return', () => {
      const source = 'package main\nfunc Name() (name string) {\n\treturn\n}';
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.name).toBe('Name');
    });

    it('should handle method with pointer and value receivers', () => {
      const source = 'package main\ntype Counter struct {}\nfunc (c *Counter) Increment() {}\nfunc (c Counter) Value() int { return 0 }';
      const captures = provider.parse(source, 'test.go');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(2);
      expect(methods.some((m) => m.name === 'Increment')).toBe(true);
      expect(methods.some((m) => m.name === 'Value')).toBe(true);
    });

    it('should handle interface with multiple methods', () => {
      const source = 'package main\ntype Writer interface {\n\tWrite(p []byte) (n int, err error)\n\tClose() error\n}';
      const captures = provider.parse(source, 'test.go');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]!.name).toBe('Writer');
    });

    it('should handle interface embedding', () => {
      const source = 'package main\ntype ReadWriter interface {\n\tReader\n\tWriter\n}';
      const captures = provider.parse(source, 'test.go');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]!.name).toBe('ReadWriter');
    });

    it('should handle short variable declarations (:=)', () => {
      const source = 'package main\nfunc Init() {\n\tx := 42\n\t_ = x\n}';
      const captures = provider.parse(source, 'test.go');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(1);
    });
  });
});
