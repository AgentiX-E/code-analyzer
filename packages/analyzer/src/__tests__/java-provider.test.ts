import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { JavaProvider } from '../languages/java.js';

/** JavaProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexJavaProvider extends JavaProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

describe('JavaProvider', () => {
  const provider = new JavaProvider();

  describe('properties', () => {
    it('should report the correct language metadata', () => {
      expect(provider.language).toBe('java');
      expect(provider.displayName).toBe('Java');
      expect(provider.extensions).toContain('.java');
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should capture a class name and empty base-class/interface properties', () => {
      const captures = provider.parse('public class Foo { }', 'Foo.java');
      const cls = captures.find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(cls).toBeDefined();
      expect(cls!.name).toBe('Foo');
      expect(cls!.properties?.baseClasses).toBe('');
      expect(cls!.properties?.interfaces).toBe('');
    });

    it.each([
      ['plain type', 'public class Foo extends Base { }', 'Base'],
      ['generic type', 'public class Foo<T> extends AbstractList<T> { }', 'AbstractList'],
      ['scoped type', 'public class Foo extends com.example.Base { }', 'Base'],
      [
        'generic scoped type',
        'public class Foo extends java.util.AbstractList<String> { }',
        'AbstractList',
      ],
      ['annotated type', 'public class Foo extends @Nullable Base { }', 'Base'],
    ])('should extract the superclass leaf name for a %s', (_label, decl, expected) => {
      const captures = provider.parse(decl, 'Foo.java');
      const cls = captures.find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(cls!.properties?.baseClasses).toBe(expected);
    });

    it.each([
      ['plain interfaces', 'public class Foo implements A, B { }', 'A,B'],
      [
        'generic and scoped interfaces',
        'public class Foo implements List<T>, java.io.Serializable { }',
        'List,Serializable',
      ],
      [
        'annotated and plain interfaces',
        'public class Foo implements @NonNull Comparable<Foo>, Runnable { }',
        'Comparable,Runnable',
      ],
    ])('should extract interface names for %s', (_label, decl, expected) => {
      const captures = provider.parse(decl, 'Foo.java');
      const cls = captures.find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(cls!.properties?.interfaces).toBe(expected);
    });

    it('should capture an interface definition', () => {
      const captures = provider.parse('public interface Repository { void find(); }', 'R.java');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'Repository')).toBe(true);
    });

    it('should capture an enum definition', () => {
      const captures = provider.parse('public enum Color { RED, GREEN }', 'Color.java');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should capture a method with its container name', () => {
      const captures = provider.parse('public class Svc { public void run() { } }', 'Svc.java');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toHaveLength(1);
      expect(methods[0]!.name).toBe('run');
      expect(methods[0]!.containerName).toBe('Svc');
    });

    it('should capture an interface method with the interface as container', () => {
      const captures = provider.parse(
        'public interface I { default void init() { } void go(); }',
        'I.java',
      );
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.length).toBeGreaterThanOrEqual(2);
      expect(methods.every((m) => m.containerName === 'I')).toBe(true);
    });

    it('should capture an enum method with the enum as container', () => {
      const captures = provider.parse(
        'public enum E { A; public String code() { return "A"; } }',
        'E.java',
      );
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((m) => m.name === 'code' && m.containerName === 'E')).toBe(true);
    });

    it('should capture a record method with the record as container', () => {
      const captures = provider.parse(
        'public record R(int x) { public int get() { return x; } }',
        'R.java',
      );
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((m) => m.name === 'get' && m.containerName === 'R')).toBe(true);
    });

    it('should tag a method sharing its class name as METHOD_DEF, not CONSTRUCTOR_DEF', () => {
      const captures = provider.parse(
        'public class Foo { public void Foo() { } public Foo() { } }',
        'Foo.java',
      );
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(methods.some((c) => c.name === 'Foo')).toBe(true);
      expect(constructors).toHaveLength(1);
    });

    it('should capture a constructor with its container name', () => {
      const captures = provider.parse('public class U { public U(String n) { } }', 'U.java');
      const constructors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(constructors).toHaveLength(1);
      expect(constructors[0]!.name).toBe('U');
      expect(constructors[0]!.containerName).toBe('U');
    });

    it('should capture a single-variable field', () => {
      const captures = provider.parse('public class F { private String name; }', 'F.java');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.map((c) => c.name)).toEqual(['name']);
    });

    it('should capture every declarator in a multi-variable field', () => {
      const captures = provider.parse(
        'public class F { private int a, b; public String s; }',
        'F.java',
      );
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.map((c) => c.name)).toEqual(['a', 'b', 's']);
    });

    it('should capture an underscore-named field', () => {
      const captures = provider.parse('public class F { private int _; }', 'F.java');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.map((c) => c.name)).toEqual(['_']);
    });

    it('should capture a single-identifier import', () => {
      const captures = provider.parse('import Foo;\n', 'Test.java');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should capture a scoped import', () => {
      const captures = provider.parse('import java.util.List;\n', 'Test.java');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'java.util.List')).toBe(true);
    });

    it('should capture a wildcard import without the asterisk', () => {
      const captures = provider.parse('import java.util.*;\n', 'Test.java');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'java.util')).toBe(true);
    });

    it('should capture a marker annotation', () => {
      const captures = provider.parse('@Deprecated public class A { }', 'A.java');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.some((c) => c.name === 'Deprecated')).toBe(true);
    });

    it('should capture an annotation with arguments', () => {
      const captures = provider.parse(
        'public class A { @SuppressWarnings("unused") public void m() { } }',
        'A.java',
      );
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.some((c) => c.name === 'SuppressWarnings')).toBe(true);
    });

    it('should capture a qualified annotation', () => {
      const captures = provider.parse(
        '@java.lang.SuppressWarnings("x") public class A { }',
        'A.java',
      );
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.some((c) => c.name === 'java.lang.SuppressWarnings')).toBe(true);
    });

    it('should capture nested classes and their methods', () => {
      const captures = provider.parse(
        'public class Outer { public class Inner { public void m() { } } }',
        'Outer.java',
      );
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.map((c) => c.name)).toEqual(expect.arrayContaining(['Outer', 'Inner']));
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((m) => m.name === 'm' && m.containerName === 'Inner')).toBe(true);
    });

    it('should handle empty source', () => {
      expect(provider.parse('', 'Empty.java')).toEqual([]);
    });

    it('should return captures sorted by line and byte', () => {
      const captures = provider.parse(
        'import java.util.List;\npublic class First { }\npublic enum Color { RED }',
        'Test.java',
      );
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });
  });

  describe('extractImports', () => {
    it('should extract a single-identifier import', () => {
      const imports = provider.extractImports('import Foo;\n');
      expect(imports).toContainEqual(expect.objectContaining({ source: 'Foo', type: 'named' }));
    });

    it('should extract a deeply scoped import', () => {
      const imports = provider.extractImports('import java.util.stream.Collectors;\n');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('java.util.stream.Collectors');
      expect(imports[0]!.names).toEqual(['Collectors']);
    });

    it('should extract a static import', () => {
      const imports = provider.extractImports('import static org.junit.Assert.assertEquals;\n');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.source).toBe('org.junit.Assert.assertEquals');
    });

    it('should extract a wildcard import', () => {
      const imports = provider.extractImports('import java.util.*;\n');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('wildcard');
      expect(imports[0]!.names).toEqual([]);
    });

    it('should extract a static wildcard import', () => {
      const imports = provider.extractImports('import static org.junit.Assert.*;\n');
      expect(imports).toHaveLength(1);
      expect(imports[0]!.type).toBe('wildcard');
    });

    it('should include line numbers', () => {
      const imports = provider.extractImports('// comment\nimport java.util.List;\n');
      expect(imports[0]!.lineNumber).toBe(2);
    });

    it('should return no imports for source without imports', () => {
      expect(provider.extractImports('class Foo { }')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should detect a public class as exported', () => {
      expect(provider.isExported('public class Foo { }', 'Foo')).toBe(true);
    });

    it('should detect a public interface as exported', () => {
      expect(provider.isExported('public interface Bar { }', 'Bar')).toBe(true);
    });

    it('should detect a public enum as exported', () => {
      expect(provider.isExported('public enum Baz { A }', 'Baz')).toBe(true);
    });

    it('should detect a public method as exported', () => {
      expect(provider.isExported('public class A { public void run() { } }', 'run')).toBe(true);
    });

    it('should detect a public constructor as exported', () => {
      expect(provider.isExported('public class Test { public Test() { } }', 'Test')).toBe(true);
    });

    it('should detect a public field as exported', () => {
      expect(provider.isExported('public class A { public String name; }', 'name')).toBe(true);
    });

    it('should detect each declarator of a public multi-variable field', () => {
      const code = 'public class A { public int x, y; }';
      expect(provider.isExported(code, 'x')).toBe(true);
      expect(provider.isExported(code, 'y')).toBe(true);
    });

    it('should detect a public class preceded by an annotation as exported', () => {
      expect(provider.isExported('@Deprecated public class Foo { }', 'Foo')).toBe(true);
    });

    it('should find a public nested class', () => {
      expect(
        provider.isExported('public class Outer { public static class Inner { } }', 'Inner'),
      ).toBe(true);
    });

    it('should return false for a non-public class', () => {
      expect(provider.isExported('class Internal { }', 'Internal')).toBe(false);
    });

    it('should return false for a private method', () => {
      expect(provider.isExported('public class A { private void secret() { } }', 'secret')).toBe(
        false,
      );
    });

    it('should return false for a private field', () => {
      expect(provider.isExported('public class A { private int hidden; }', 'hidden')).toBe(false);
    });

    it('should return false for a non-matching name', () => {
      expect(provider.isExported('public class Foo { }', 'Bar')).toBe(false);
    });
  });

  describe('regex fallback (no parser)', () => {
    const fallback = new RegexJavaProvider();

    it('should parse classes, interfaces, enums, and imports', () => {
      const source =
        'public class Foo { }\ninterface Bar { }\nenum Baz { A }\nimport java.util.List;\n';
      const captures = fallback.parse(source, 'Test.java');
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF).map((c) => c.name)).toContain(
        'Foo',
      );
      expect(
        captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF).map((c) => c.name),
      ).toContain('Bar');
      expect(captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF).map((c) => c.name)).toContain(
        'Baz',
      );
      expect(
        captures.some((c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'java.util.List'),
      ).toBe(true);
    });

    it('should parse abstract and final classes', () => {
      const source = 'public abstract class Base { }\npublic final class C { }\n';
      const captures = fallback.parse(source, 'Test.java');
      const names = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF).map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['Base', 'C']));
    });

    it('should handle empty source', () => {
      expect(fallback.parse('', 'Empty.java')).toEqual([]);
    });

    it('should order same-line captures by byte offset', () => {
      const captures = fallback.parse('class A { } class B { }\n', 'Test.java');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.map((c) => c.name)).toEqual(['A', 'B']);
    });

    it('should extract single, static, and wildcard imports', () => {
      const source =
        'import java.util.List;\nimport static org.junit.Assert.assertEquals;\nimport java.io.*;\n';
      const imports = fallback.extractImports(source);
      expect(imports.map((i) => i.source)).toEqual(
        expect.arrayContaining(['java.util.List', 'org.junit.Assert.assertEquals', 'java.io']),
      );
    });

    it('should return no imports for empty source', () => {
      expect(fallback.extractImports('')).toEqual([]);
    });

    it('should detect exported classes, interfaces, enums, and methods', () => {
      expect(fallback.isExported('public class Foo { }', 'Foo')).toBe(true);
      expect(fallback.isExported('public interface Bar { }', 'Bar')).toBe(true);
      expect(fallback.isExported('public enum Baz { }', 'Baz')).toBe(true);
      expect(fallback.isExported('public void run() { }', 'run')).toBe(true);
      expect(fallback.isExported('public static String fmt(String s) { return s; }', 'fmt')).toBe(
        true,
      );
      expect(fallback.isExported('class Internal { }', 'Internal')).toBe(false);
      expect(fallback.isExported('public class Foo { }', 'Bar')).toBe(false);
    });

    it('should escape regex metacharacters in the symbol name', () => {
      expect(fallback.isExported('public class Foo$Bar { }', 'Foo$Bar')).toBe(true);
    });
  });
});
