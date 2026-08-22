import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { ScalaProvider } from '../languages/scala.js';

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
  });
});
