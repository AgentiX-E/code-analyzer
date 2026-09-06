import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { ScalaProvider } from '../languages/scala.js';

/** ScalaProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexScalaProvider extends ScalaProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

describe('ScalaProvider', () => {
  const provider = new ScalaProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('scala');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Scala');
    });

    it('should have .scala and .sc extensions', () => {
      expect(provider.extensions).toContain('.scala');
      expect(provider.extensions).toContain('.sc');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — type definitions', () => {
    it('should extract a class definition', () => {
      const code = 'class Foo(val x: Int) {}';
      const captures = provider.parse(code, 'Foo.scala');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Foo')).toBe(true);
    });

    it('should extract an operator class definition', () => {
      const code = 'class +(x: Int) {}';
      const captures = provider.parse(code, 'Plus.scala');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === '+')).toBe(true);
    });

    it('should extract an object definition with isObject flag', () => {
      const code = 'object Bar {}';
      const captures = provider.parse(code, 'Bar.scala');
      const objects = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(objects.some((c) => c.name === 'Bar' && c.properties?.isObject === 'true')).toBe(true);
    });

    it('should extract a trait as interface definition', () => {
      const code = 'trait Baz {}';
      const captures = provider.parse(code, 'Baz.scala');
      const traits = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(traits.some((c) => c.name === 'Baz')).toBe(true);
    });

    it('should extract a case class', () => {
      const code = 'case class User(id: Int, name: String)';
      const captures = provider.parse(code, 'User.scala');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'User')).toBe(true);
    });
  });

  describe('parse — functions', () => {
    it('should extract a method definition', () => {
      const code = 'class A {\n  def foo(): Int = 1\n}';
      const captures = provider.parse(code, 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'foo')).toBe(true);
    });

    it('should extract a function with parameters', () => {
      const code = 'class A {\n  def add(x: Int, y: Int): Int = x + y\n}';
      const captures = provider.parse(code, 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should extract an operator method definition', () => {
      const code = 'class A {\n  def +(other: Int): Int = other\n}';
      const captures = provider.parse(code, 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === '+')).toBe(true);
    });

    it('should extract an abstract method declaration', () => {
      const code = 'trait A { def foo(): Int }';
      const captures = provider.parse(code, 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'foo')).toBe(true);
    });
  });

  describe('parse — imports', () => {
    it('should extract a dotted import path', () => {
      const code = 'import scala.collection.mutable.ListBuffer';
      const captures = provider.parse(code, 't.scala');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'scala.collection.mutable.ListBuffer')).toBe(true);
    });

    it('should extract a single identifier import', () => {
      const code = 'import scala.collection.mutable';
      const captures = provider.parse(code, 't.scala');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'scala.collection.mutable')).toBe(true);
    });

    it('should extract an operator import path', () => {
      const code = 'import foo.::';
      const captures = provider.parse(code, 't.scala');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'foo.::')).toBe(true);
    });

    it('should extract only the package prefix for a selector import', () => {
      const code = 'import foo.{bar, baz}';
      const captures = provider.parse(code, 't.scala');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'foo')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract import with the last segment as the name', () => {
      const code = 'import scala.collection.mutable.ListBuffer';
      const imports = provider.extractImports(code, 't.scala');
      expect(
        imports.some(
          (i) =>
            i.source === 'scala.collection.mutable.ListBuffer' && i.names.includes('ListBuffer'),
        ),
      ).toBe(true);
    });

    it('should return empty for code without imports', () => {
      expect(provider.extractImports('val x = 1', 't.scala')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should report a public class as exported', () => {
      expect(provider.isExported('class Foo {}', 'Foo')).toBe(true);
    });

    it('should report a public object as exported', () => {
      expect(provider.isExported('object Bar {}', 'Bar')).toBe(true);
    });

    it('should report a public trait as exported', () => {
      expect(provider.isExported('trait Baz {}', 'Baz')).toBe(true);
    });

    it('should report a public method as exported', () => {
      expect(provider.isExported('class A { def foo() = 1 }', 'foo')).toBe(true);
    });

    it('should report a public abstract method as exported', () => {
      expect(provider.isExported('trait A { def foo(): Int }', 'foo')).toBe(true);
    });

    it('should report an operator method as exported', () => {
      expect(provider.isExported('class A { def +(x: Int) = x }', '+')).toBe(true);
    });

    it('should report a private class as not exported', () => {
      expect(provider.isExported('private class Secret {}', 'Secret')).toBe(false);
    });

    it('should report a protected def as not exported', () => {
      expect(provider.isExported('class A { protected def foo() = 1 }', 'foo')).toBe(false);
    });

    it('should report a sealed class as exported (no access modifier)', () => {
      expect(provider.isExported('sealed class Foo {}', 'Foo')).toBe(true);
    });

    it('should report a private[pkg] class as not exported', () => {
      expect(provider.isExported('private[pkg] class Secret {}', 'Secret')).toBe(false);
    });

    it('should return false for an unknown symbol', () => {
      expect(provider.isExported('class Foo {}', 'bar')).toBe(false);
    });
  });

  describe('fallback (regex)', () => {
    const fallback = new RegexScalaProvider();

    it('should parse class, object, trait, function, and import', () => {
      const code =
        'class Foo {}\nobject Bar {}\ntrait Baz {}\ndef qux() = 1\nimport scala.collection.mutable\n';
      const captures = fallback.parse(code, 't.scala');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Foo')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'Bar')).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF && c.name === 'Baz')).toBe(
        true,
      );
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'qux')).toBe(
        true,
      );
      expect(
        captures.some(
          (c) => c.tag === CAPTURE_TAGS.IMPORT && c.name === 'scala.collection.mutable',
        ),
      ).toBe(true);
    });

    it('should parse an abstract/case class', () => {
      const captures = fallback.parse('abstract class Foo {}\ncase class Bar(a: Int)', 't.scala');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Foo')).toBe(true);
      expect(classes.some((c) => c.name === 'Bar')).toBe(true);
    });

    it('should parse an operator method name', () => {
      const captures = fallback.parse('def +(x: Int) = x', 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === '+')).toBe(true);
    });

    it('should parse a type-annotated method name', () => {
      const captures = fallback.parse('def foo: Int = 1', 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'foo')).toBe(true);
    });

    it('should sort captures by position', () => {
      const captures = fallback.parse('def b() = 1\ndef a() = 2', 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should sort same-line captures by byte offset', () => {
      const captures = fallback.parse('def b() = 1 def a() = 2', 't.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should return empty captures for empty source', () => {
      expect(fallback.parse('', 't.scala')).toEqual([]);
    });

    it('should extract imports with the last segment as the name', () => {
      const imports = fallback.extractImports(
        'import scala.collection.mutable.ListBuffer',
        't.scala',
      );
      expect(imports.some((i) => i.source === 'scala.collection.mutable.ListBuffer')).toBe(true);
      expect(imports.some((i) => i.names.includes('ListBuffer'))).toBe(true);
    });

    it('should return empty imports without imports', () => {
      expect(fallback.extractImports('val x = 1', 't.scala')).toEqual([]);
    });

    it('should report a public class as exported', () => {
      expect(fallback.isExported('class Foo {}', 'Foo')).toBe(true);
    });

    it('should report a public function as exported', () => {
      expect(fallback.isExported('def foo() = 1', 'foo')).toBe(true);
    });

    it('should report a private class as not exported', () => {
      expect(fallback.isExported('private class Secret {}', 'Secret')).toBe(false);
    });

    it('should report a protected def as not exported', () => {
      expect(fallback.isExported('class A { protected def foo() = 1 }', 'foo')).toBe(false);
    });

    it('should return false for a non-matching symbol', () => {
      expect(fallback.isExported('class Foo {}', 'bar')).toBe(false);
    });
  });
});
