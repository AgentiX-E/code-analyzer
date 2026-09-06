import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { CSharpProvider } from '../languages/csharp.js';

/** CSharpProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexCSharpProvider extends CSharpProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

describe('CSharpProvider', () => {
  const provider = new CSharpProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('csharp');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('C#');
    });

    it('should have .cs extension', () => {
      expect(provider.extensions).toContain('.cs');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — type declarations', () => {
    it('should extract a class definition', () => {
      const captures = provider.parse('public class MyService { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyService' && c.text === 'class MyService')).toBe(
        true,
      );
    });

    it('should extract a class with modifiers', () => {
      const captures = provider.parse('public static class Utils { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Utils')).toBe(true);
    });

    it('should extract an abstract sealed class', () => {
      const captures = provider.parse('public abstract sealed class BaseHandler { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'BaseHandler')).toBe(true);
    });

    it('should extract a partial class', () => {
      const captures = provider.parse('public partial class MyForm { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyForm')).toBe(true);
    });

    it('should extract an interface definition', () => {
      const captures = provider.parse('public interface IRepository { void Save(); }', 't.cs');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'IRepository')).toBe(true);
    });

    it('should extract a struct as STRUCT_DEF', () => {
      const captures = provider.parse('public struct Point { public int X; }', 't.cs');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });

    it('should extract an enum definition', () => {
      const captures = provider.parse('public enum Color { Red, Green, Blue }', 't.cs');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });
  });

  describe('parse — methods, constructors, properties', () => {
    it('should extract a method definition with its container', () => {
      const captures = provider.parse('public class Service { public void DoWork() { } }', 't.cs');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'DoWork' && c.containerName === 'Service')).toBe(true);
    });

    it('should extract a method whose return type is a plain identifier', () => {
      const captures = provider.parse('public class Box<T> { public T GetValue() { } }', 't.cs');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'GetValue')).toBe(true);
    });

    it('should extract an async generic method', () => {
      const captures = provider.parse(
        'public class Service { public async Task<string> FetchAsync() { return ""; } }',
        't.cs',
      );
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'FetchAsync')).toBe(true);
    });

    it('should extract an interface method with its interface as container', () => {
      const captures = provider.parse('public interface IRepo { void Save(); }', 't.cs');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name === 'Save' && c.containerName === 'IRepo')).toBe(true);
    });

    it('should extract a constructor as CONSTRUCTOR_DEF', () => {
      const captures = provider.parse('public class MyClass { public MyClass() { } }', 't.cs');
      const ctors = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(ctors.some((c) => c.name === 'MyClass' && c.containerName === 'MyClass')).toBe(true);
    });

    it('should extract a property definition', () => {
      const captures = provider.parse(
        'public class User { public string Name { get; set; } }',
        't.cs',
      );
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'Name')).toBe(true);
    });

    it('should extract a property whose type is a plain identifier', () => {
      const captures = provider.parse(
        'public class Box<T> { public T Value { get; set; } }',
        't.cs',
      );
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'Value')).toBe(true);
    });
  });

  describe('parse — imports', () => {
    it('should extract a simple using directive', () => {
      const captures = provider.parse('using System;\npublic class C { }', 't.cs');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'System')).toBe(true);
    });

    it('should extract a qualified using directive', () => {
      const captures = provider.parse(
        'using System.Collections.Generic;\npublic class C { }',
        't.cs',
      );
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'System.Collections.Generic')).toBe(true);
    });

    it('should extract a using static directive', () => {
      const captures = provider.parse('using static System.Math;\npublic class C { }', 't.cs');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'System.Math')).toBe(true);
    });

    it('should extract the target (not the alias) of an alias using directive', () => {
      const captures = provider.parse(
        'using Alias = System.Collections.Generic.List;\npublic class C { }',
        't.cs',
      );
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'System.Collections.Generic.List')).toBe(true);
      expect(imports.some((c) => c.name === 'Alias')).toBe(false);
    });
  });

  describe('parse — attributes', () => {
    it('should extract a simple attribute', () => {
      const captures = provider.parse('[Obsolete]\npublic class OldClass { }', 't.cs');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.some((c) => c.name === 'Obsolete')).toBe(true);
    });

    it('should extract a qualified attribute name', () => {
      const captures = provider.parse('[System.Obsolete]\npublic class OldClass { }', 't.cs');
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.some((c) => c.name === 'System.Obsolete')).toBe(true);
    });

    it('should extract attributes on methods', () => {
      const captures = provider.parse(
        'public class Test { [HttpGet] public string Get() { return ""; } }',
        't.cs',
      );
      const decorators = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decorators.some((c) => c.name === 'HttpGet')).toBe(true);
    });
  });

  describe('parse — edge cases', () => {
    it('should return an empty array for an empty file', () => {
      expect(provider.parse('', 'empty.cs')).toEqual([]);
    });

    it('should return an empty array for a comment-only file', () => {
      expect(provider.parse('// Just a comment\n/* Block */\n', 't.cs')).toEqual([]);
    });

    it('should return captures sorted by line', () => {
      const captures = provider.parse(
        'using System;\npublic class First { }\npublic interface ISecond { }',
        't.cs',
      );
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });
  });

  describe('extractImports', () => {
    it('should extract simple and qualified using directives', () => {
      const imports = provider.extractImports('using System;\nusing System.Collections.Generic;');
      expect(imports.some((i) => i.source === 'System')).toBe(true);
      expect(imports.some((i) => i.source === 'System.Collections.Generic')).toBe(true);
    });

    it('should extract using static directives', () => {
      const imports = provider.extractImports('using static System.Math;');
      expect(imports.some((i) => i.source === 'System.Math')).toBe(true);
    });

    it('should extract the target of an alias using directive', () => {
      const imports = provider.extractImports('using Alias = System.Collections.Generic.List;');
      expect(imports.some((i) => i.source === 'System.Collections.Generic.List')).toBe(true);
    });

    it('should return an empty array for code without imports', () => {
      expect(provider.extractImports('class Foo { }')).toEqual([]);
    });

    it('should include the line number', () => {
      const imports = provider.extractImports('// comment\nusing System;\n');
      expect(imports[0]?.lineNumber).toBe(2);
    });
  });

  describe('isExported', () => {
    it('should report a public class as exported', () => {
      expect(provider.isExported('public class Foo { }', 'Foo')).toBe(true);
    });

    it('should report a public interface as exported', () => {
      expect(provider.isExported('public interface IRepo { }', 'IRepo')).toBe(true);
    });

    it('should report a public struct as exported', () => {
      expect(provider.isExported('public struct Point { }', 'Point')).toBe(true);
    });

    it('should report a public enum as exported', () => {
      expect(provider.isExported('public enum Color { Red }', 'Color')).toBe(true);
    });

    it('should report a public method as exported', () => {
      expect(provider.isExported('class Foo { public void Bar() { } }', 'Bar')).toBe(true);
    });

    it('should report a public property as exported', () => {
      expect(provider.isExported('class Foo { public int Bar { get; set; } }', 'Bar')).toBe(true);
    });

    it('should report a public constructor as exported', () => {
      expect(provider.isExported('class Foo { public Foo() { } }', 'Foo')).toBe(true);
    });

    it('should report a class without an access modifier as not exported', () => {
      expect(provider.isExported('class Foo { }', 'Foo')).toBe(false);
    });

    it('should report a private method as not exported', () => {
      expect(provider.isExported('class Foo { private void Bar() { } }', 'Bar')).toBe(false);
    });

    it('should report a private property as not exported', () => {
      expect(provider.isExported('class Foo { private int Bar { get; set; } }', 'Bar')).toBe(false);
    });

    it('should report a private constructor as not exported', () => {
      expect(provider.isExported('class Foo { private Foo() { } }', 'Foo')).toBe(false);
    });

    it('should honour a public modifier in any position', () => {
      expect(provider.isExported('static public class Foo { }', 'Foo')).toBe(true);
    });

    it('should return false for a non-matching name', () => {
      expect(provider.isExported('public class Foo { }', 'Bar')).toBe(false);
    });

    it('should return false for a non-matching method name', () => {
      expect(provider.isExported('public class Test { public void Foo() { } }', 'Bar')).toBe(false);
    });
  });

  describe('fallback (regex)', () => {
    const fallback = new RegexCSharpProvider();

    it('should parse a class definition', () => {
      const captures = fallback.parse('public class MyService { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyService')).toBe(true);
    });

    it('should parse a static class', () => {
      const captures = fallback.parse('public static class Utils { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Utils')).toBe(true);
    });

    it('should parse an abstract class', () => {
      const captures = fallback.parse('public abstract class BaseHandler { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'BaseHandler')).toBe(true);
    });

    it('should parse a partial class', () => {
      const captures = fallback.parse('public partial class MyForm { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyForm')).toBe(true);
    });

    it('should parse an interface definition', () => {
      const captures = fallback.parse('public interface IRepository { void Save(); }', 't.cs');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'IRepository')).toBe(true);
    });

    it('should parse imports', () => {
      const captures = fallback.parse('using System;\nusing System.Collections.Generic;', 't.cs');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should return an empty array for an empty file', () => {
      expect(fallback.parse('', 't.cs')).toEqual([]);
    });

    it('should sort same-line captures by byte offset', () => {
      const captures = fallback.parse('public class B { } public class A { }', 't.cs');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.map((c) => c.name)).toEqual(['B', 'A']);
    });

    it('should extract simple and qualified using directives', () => {
      const imports = fallback.extractImports('using System;\nusing System.Collections.Generic;');
      expect(imports.some((i) => i.source === 'System')).toBe(true);
      expect(imports.some((i) => i.source === 'System.Collections.Generic')).toBe(true);
    });

    it('should extract a using static directive', () => {
      const imports = fallback.extractImports('using static System.Math;');
      expect(imports.some((i) => i.source === 'System.Math')).toBe(true);
    });

    it('should extract the target of an alias using directive', () => {
      const imports = fallback.extractImports('using Alias = System.Collections.Generic.List;');
      expect(imports.some((i) => i.source === 'System.Collections.Generic.List')).toBe(true);
    });

    it('should return an empty array for code without imports', () => {
      expect(fallback.extractImports('class Foo { }')).toEqual([]);
    });

    it('should report a public class as exported', () => {
      expect(fallback.isExported('public class Foo { }', 'Foo')).toBe(true);
    });

    it('should report a public interface as exported', () => {
      expect(fallback.isExported('public interface IRepo { }', 'IRepo')).toBe(true);
    });

    it('should report a public struct as exported', () => {
      expect(fallback.isExported('public struct Point { }', 'Point')).toBe(true);
    });

    it('should report a public enum as exported', () => {
      expect(fallback.isExported('public enum Color { Red }', 'Color')).toBe(true);
    });

    it('should report a public method as exported', () => {
      expect(fallback.isExported('public void DoWork() { }', 'DoWork')).toBe(true);
    });

    it('should return false for a non-matching name', () => {
      expect(fallback.isExported('public class Foo { }', 'Bar')).toBe(false);
    });
  });
});
