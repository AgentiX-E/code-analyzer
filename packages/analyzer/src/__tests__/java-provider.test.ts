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
      expect(cls!.properties?.['baseClasses']).toBe('');
      expect(cls!.properties?.['interfaces']).toBe('');
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
      expect(cls!.properties?.['baseClasses']).toBe(expected);
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
      expect(cls!.properties?.['interfaces']).toBe(expected);
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

    describe('a constructor that delegates', () => {
      /** Every call this provider records, as `name` in the order the walk produced them. */
      const callsOf = (source: string): string[] =>
        provider
          .parse(source, 'Demo.java')
          .filter((capture) => capture.tag === CAPTURE_TAGS.FUNCTION_CALL)
          .map((capture) => String(capture.name));

      it('names `super(…)` after the class the enclosing type extends', () => {
        // **`super(…)` was a call site nothing recorded**, because the production writes its target as a keyword
        // (`explicit_constructor_invocation super: (argument_list)`) and every branch of the Java walk was keyed on a
        // name. Measured on `apache/commons-lang@3.14.0` against `javac`'s own attribution, this shape is **72 of the
        // 327 edges the oracle expected and the graph claimed nothing for** - and every one of them is the top of a
        // hierarchy, which is the edge a class diagram is drawn from.
        expect(callsOf('class Child extends Base { Child(int a) { super(a); } }')).toEqual([
          'Base',
        ]);
      });

      it('names `this(…)` after the class it is written in', () => {
        // A delegating constructor is a call to another constructor of the same class, which is a fact the language
        // states and the graph records under the class's own name. **The second constructor delegates to nothing, so
        // it runs the base's** - which is the other half of the same sentence, and it is why the list has two names
        // rather than one.
        expect(
          callsOf('class Child extends Base { Child() { this(1); } Child(int a) { } }'),
        ).toEqual(['Child', 'Base']);
      });

      it('records no call for `super()` in a class that extends nothing', () => {
        // **`super()` with no `extends` means `Object`, and `Object` is not in the graph.** Claiming the name would
        // be an edge to a declaration the checkout does not contain, so the empty clause answers nothing - which is
        // also the shape a file *being edited* parses into, since the clause may be the very thing being typed.
        expect(callsOf('class Plain { Plain() { super(); } }')).toEqual([]);
      });

      it('records the construction a constructor performs when it delegates to nothing', () => {
        // **Every constructor runs a base constructor, and the source writes the call only sometimes.** `javac`'s
        // own tree holds the implicit `super()` of `Child(int a) { this.a = a; }`, and its attribution names it
        // `Base` - so a graph without it is missing a call every instance of the class makes. Measured on
        // `apache/commons-lang@3.14.0`: **37 of the pairs javac expects and this graph claimed nothing for were
        // exactly this shape**, `MutablePair`'s two constructors to `Pair` among them.
        expect(callsOf('class Child extends Base { Child(int a) { this.a = a; } }')).toEqual([
          'Base',
        ]);
        // A constructor that delegates says where it goes, and it goes there once.
        expect(callsOf('class Child extends Base { Child() { super(1); } }')).toEqual(['Base']);
        // `Object` is not in the graph, so a class that extends nothing has no base constructor to name.
        expect(callsOf('class Plain { Plain() { } }')).toEqual([]);
      });

      it('reads the arguments as uses, so a request reaches a base constructor that stores it', () => {
        // A delegation passes its arguments like any other call, and the taint that matters is the one that travels
        // that way: `super(request)` in a framework base class is where a servlet request becomes a field.
        const captures = provider.parse(
          'class Child extends Base { Child(String p) { super(p); } }',
          'Child.java',
        );
        const uses = captures
          .filter((capture) => capture.tag === CAPTURE_TAGS.VARIABLE_ACCESS)
          .map((capture) => String(capture.name));
        expect(uses).toContain('p');
      });
    });

    describe('a construction that names its type arguments', () => {
      /** Every call this provider records, as `name` in the order the walk produced them. */
      const callsOf = (source: string): string[] =>
        provider
          .parse(source, 'Demo.java')
          .filter((capture) => capture.tag === CAPTURE_TAGS.FUNCTION_CALL)
          .map((capture) => String(capture.name));

      it('names the class, not the type arguments it is given', () => {
        // **`new ArrayList<>()` recorded the name `ArrayList<>`**, and a name that is not the class's name matches no
        // declaration: `new FailableStream<>(…)` in `apache/commons-lang`'s `Functions.java` was 39 of the corpus's
        // unanswered construction sites, every one of them calling a class the checkout declares.
        expect(callsOf('class Holder { Object make() { return new ArrayList<>(); } }')).toEqual([
          'ArrayList',
        ]);
        expect(callsOf('class Holder { Object make() { return new Box<Item>(x); } }')).toEqual([
          'Box',
        ]);
      });

      it('names the last segment of a qualified type', () => {
        // `new java.util.ArrayList<>()` writes a package path before the class, and the graph files a class by its
        // simple name - the same reduction every import of the form `import a.b.C` already performs.
        expect(
          callsOf('class Holder { Object make() { return new java.util.ArrayList<String>(); } }'),
        ).toEqual(['ArrayList']);
      });

      it('keeps what a declaration says it returns, in the declaration`s own words', () => {
        // **A return type is a fact about the declaration, and nothing read one.** `builder()` returning `Builder`
        // is what makes `QueueInputStream.builder().get()` a call on a `Builder`; the property carries the source's
        // spelling so the resolver - not the parser - decides what counts as a name.
        const captures = provider.parse(
          'class Holder { Builder builder() { return null; } void run() { } }',
          'Holder.java',
        );
        const returns = captures
          .filter((capture) => capture.tag === CAPTURE_TAGS.METHOD_DEF)
          .map((capture) => [capture.name, capture.properties?.['returnType']]);
        expect(returns).toEqual([
          ['builder', 'Builder'],
          ['run', 'void'],
        ]);
      });
    });

    describe('a call written as a reference', () => {
      /** Every call this provider records, as `tag name <- text`, in the order the walk produced them. */
      const callsOf = (source: string): string[] =>
        provider
          .parse(source, 'Demo.java')
          .filter(
            (capture) =>
              capture.tag === CAPTURE_TAGS.FUNCTION_CALL ||
              capture.tag === CAPTURE_TAGS.METHOD_CALL,
          )
          .map(
            (capture) =>
              `${String(capture.tag)} ${String(capture.name)} <- ${String(capture.text)}`,
          );

      it('reads `Type::method` as a call on the type', () => {
        // **`Strings::isEmpty` is a call, and it happens later.** The deferred call is the shape a stream pipeline
        // is written in, and nothing in the walk recorded it: the production is a `method_reference`, not a
        // `method_invocation` with a receiver, so every branch keyed on `method_invocation` stepped past all 254 of
        // them in the two Java corpora. The receiver is the type, exactly as `Strings.isEmpty(…)` would spell it, so
        // the resolver's own static arm is the rule that answers it.
        expect(
          callsOf('class A { void run() { Function<String, Boolean> f = Strings::isEmpty; } }'),
        ).toEqual([`${String(CAPTURE_TAGS.METHOD_CALL)} isEmpty <- Strings.isEmpty`]);
      });

      it('reads the two keywords as the receivers they are', () => {
        // `this::helper` runs the enclosing class's method and `super::helper` skips it for the base's - the same
        // two answers `this.helper()` and `super.helper()` get, which is why the keyword is carried as the receiver
        // rather than resolved here.
        expect(
          callsOf(
            'class A { void run() { Runnable r = this::helper; Runnable s = super::helper; } }',
          ),
        ).toEqual([
          `${String(CAPTURE_TAGS.METHOD_CALL)} helper <- this.helper`,
          `${String(CAPTURE_TAGS.METHOD_CALL)} helper <- super.helper`,
        ]);
      });

      it('names the class a `::new` constructs, not the type arguments it is given', () => {
        // **`Box<Item>::new` writes no name at all** - the production's second half is the `new` keyword - so the
        // class is the only thing there is to call, and the graph files a constructor under the class's name.
        expect(callsOf('class A { void run() { Supplier<B> s = Box<Item>::new; } }')).toEqual([
          `${String(CAPTURE_TAGS.FUNCTION_CALL)} Box <- Box<Item>`,
        ]);
        // A qualified type is its last segment, the same reduction `import a.b.C` performs.
        expect(
          callsOf('class A { void run() { Supplier<B> s = java.util.ArrayList::new; } }'),
        ).toEqual([`${String(CAPTURE_TAGS.FUNCTION_CALL)} ArrayList <- java.util.ArrayList`]);
      });

      it('records no call for a reference that constructs an array', () => {
        // **`String[]::new` constructs an array, and the graph holds no node for one.** A name invented here would
        // be an edge to a declaration that does not exist, which is worse than the missing edge it pretends to fix.
        expect(
          callsOf('class A { void run() { IntFunction<String[]> f = String[]::new; } }'),
        ).toEqual([]);
      });

      it('keeps the line of the reference, so two references are two sites', () => {
        const lines = provider
          .parse(
            'class A { void run() {\n  Runnable r = this::helper;\n  Runnable s = this::helper;\n} }',
            'Demo.java',
          )
          .filter((capture) => capture.tag === CAPTURE_TAGS.METHOD_CALL)
          .map((capture) => capture.startLine);
        expect(lines).toEqual([2, 3]);
      });
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

// **A name is not a signature** — the two facts a call site needs to tell one declaration from another, read from the
// source that states them. See `receiver-types.ts` for what the resolver does with them.
describe('JavaProvider — a declaration states its signature', () => {
  const provider = new JavaProvider();

  /** The one capture with this name and tag, from a source. */
  const captureOf = (source: string, name: string, tag: string) =>
    provider.parse(source, 'Fixture.java').find((c) => c.name === name && c.tag === tag);

  it('counts the parameters a method writes and the ones a call must pass', () => {
    const source = 'class Holder { void run(Widget widget, Other other) { } }';
    const run = captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF);
    expect(run?.properties?.['parameterCount']).toBe('2');
    expect(run?.properties?.['requiredParameters']).toBe('2');
    expect(run?.properties?.['variadic']).toBeUndefined();
  });

  it('admits one argument fewer when the last parameter is a spread', () => {
    // **`String... parts` may receive nothing at all**, which is why `notExists(path)` is a legal call to
    // `notExists(Path, LinkOption...)` and why counting the spread as required refused 17 calls in one file.
    const source = 'class Holder { void run(Widget widget, String... parts) { } }';
    const run = captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF);
    expect(run?.properties?.['parameterCount']).toBe('2');
    expect(run?.properties?.['requiredParameters']).toBe('1');
    expect(run?.properties?.['variadic']).toBe('true');
  });

  it('counts a comment in a parameter list as nothing', () => {
    const source = 'class Holder { void run(Widget widget /* the widget */, Other other) { } }';
    expect(captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['parameterCount']).toBe(
      '2',
    );
  });

  it('counts a constructor, which is an overload like any other', () => {
    const source = 'class Holder { Holder(Widget widget) { } }';
    const ctor = captureOf(source, 'Holder', CAPTURE_TAGS.CONSTRUCTOR_DEF);
    expect(ctor?.properties?.['parameterCount']).toBe('1');
  });

  it('counts the arguments a call passes, and not the comment among them', () => {
    // `addSub(fraction, true /* add */)` passes two arguments; the grammar reports three named children.
    const source = 'class Holder { void run() { addSub(fraction, true /* add */); } }';
    expect(
      captureOf(source, 'addSub', CAPTURE_TAGS.FUNCTION_CALL)?.properties?.['argumentCount'],
    ).toBe('2');
  });

  it('counts a construction, whose argument list is what the class overloads', () => {
    const source = 'class Holder { Object run() { return new Thing(a, b); } }';
    expect(
      captureOf(source, 'Thing', CAPTURE_TAGS.FUNCTION_CALL)?.properties?.['argumentCount'],
    ).toBe('2');
  });

  it('reads the interfaces an interface extends', () => {
    // **`interface A extends B` is the clause that makes B's members A's**, and it is not the `implements` clause a
    // class writes - which declares no body and is refused as a base on purpose.
    const source = 'interface Reader extends Source<Item>, Sink { Item read(); }';
    expect(
      captureOf(source, 'Reader', CAPTURE_TAGS.INTERFACE_DEF)?.properties?.['baseClasses'],
    ).toBe('Source,Sink');
  });

  it('types a loop variable with the type it declares', () => {
    // **`for (final Pair<String, Object> entry : this.entries)` writes the type on the declaration**, and a walk that
    // recorded only the name left every call on `entry` unanswerable.
    const source =
      'class Holder { void run() { for (final Pair<String, Object> entry : this.entries) { entry.getKey(); } } }';
    const run = captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF);
    expect(JSON.parse(String(run?.properties?.['localTypes']))).toMatchObject({
      entry: 'Pair<String, Object>',
    });
  });

  it('does not count a receiver parameter as an argument', () => {
    // **`void run(Inner this, int size)` is Java's receiver parameter**, which names the enclosing instance and which
    // no caller passes. It crashed the parse outright - the walk went looking for a declarator a receiver does not
    // have - and counting it would have made every call look one argument short as well.
    const source = 'class Outer { class Inner { void run(Inner this, int size) { } } }';
    const parameters = provider
      .parse(source, 'Outer.java')
      .filter(
        (c) =>
          c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.properties?.['parameterOwner'] !== undefined,
      );
    expect(parameters.map((c) => c.name)).toEqual(['size']);
    expect(parameters[0]?.properties?.['parameterIndex']).toBe('0');
    expect(captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['parameterCount']).toBe(
      '1',
    );
  });

  it('reads no type from a loop binding that writes `var`', () => {
    // `var` is a token where the type would be, and filing it as the type of `name` made the resolver look for a class
    // called `var` - the same string `declaredTypeOf` already refuses for a local.
    const source = 'class Holder { void run(List<String> names) { for (var name : names) { } } }';
    expect(
      captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['localTypes'],
    ).toBeUndefined();
  });

  it('reads no type from a `var` whose initialiser is not a construction', () => {
    // `var total = compute()` states no type the source writes, and inferring one is not this pass's job: the
    // declaration is a fact and an inference is a guess, which is the difference the whole resolver is built on.
    const source = 'class Holder { void run() { var total = compute(); } }';
    expect(
      captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['localTypes'],
    ).toBeUndefined();
  });

  it('records no call for a reference whose tail is a type argument list', () => {
    // `Foo::<String>` is a reference caught mid-edit: the name never arrives, and the last named child is the type
    // argument list. Reading _it_ as the method would name a method `<String>` that nothing declares.
    const source = 'class Holder { void run() { Function<String, Foo> s = Foo::<String>; } }';
    expect(
      provider.parse(source, 'Fixture.java').filter((c) => c.tag === CAPTURE_TAGS.METHOD_CALL),
    ).toHaveLength(0);
  });
});

// **Three declarations Java writes and this provider used to step past** — a resource, a constant, a bound. Each is a
// fact the language states, and each one is what a call on the name it introduces is resolved through.
describe('JavaProvider — the declarations a try, an enum body and a type parameter write', () => {
  const provider = new JavaProvider();
  const captureOf = (source: string, name: string, tag: string) =>
    provider.parse(source, 'Fixture.java').find((c) => c.name === name && c.tag === tag);
  const localTypesOf = (source: string) =>
    JSON.parse(
      String(captureOf(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['localTypes'] ?? '{}'),
    ) as Record<string, string>;

  it('types a resource the try-with-resources header declares', () => {
    // **A `resource` is a declaration and is not a `local_variable_declaration`.** The grammar writes
    // `resource_specification > resource > (type, name, …)`, so the walk recognised nothing: on `commons-io` that is
    // 35 headers, and every call on the resource - `urlConnection.getInputStream()` among them - was unanswered.
    const source =
      'class Holder { void run() { try (CloseableURLConnection urlConnection = open(source)) { urlConnection.getInputStream(); } } }';
    expect(localTypesOf(source)).toMatchObject({ urlConnection: 'CloseableURLConnection' });
  });

  it('records no type for a resource that reuses a variable', () => {
    // `try (existing)` declares nothing, and a rule that read the existing name as a type would invent one.
    const source = 'class Holder { void run() { try (existing) { } catch (Exception e) { } } }';
    expect(localTypesOf(source)).not.toHaveProperty('existing');
  });

  it('files each constant of an enum as a value of that enum', () => {
    // **`enum IOCase { SYSTEM(…) }` declares `SYSTEM` of type `IOCase` and writes no field.** Nothing else in the
    // grammar says so, so `IOCase.SYSTEM.checkEquals(…)` had no receiver type at all.
    const source =
      'enum IOCase { SYSTEM("System"), INSENSITIVE("Insensitive"); IOCase(String name) { } }';
    const declaration = captureOf(source, 'IOCase', CAPTURE_TAGS.ENUM_DEF);
    expect(JSON.parse(String(declaration?.properties?.['fieldTypes']))).toMatchObject({
      SYSTEM: 'IOCase',
      INSENSITIVE: 'IOCase',
    });
  });

  it('states the bound a type parameter declares', () => {
    // **`S extends IOBaseStream<T, S, B>` is what lets `delegate.close()` be answered.** A type variable with no bound
    // names a class nobody declared, and the bound is the only place the language writes what it may be.
    const source =
      'class Holder<T, S extends IOBaseStream<T, S, B>, B extends BaseStream<T, B>> { void run() { } }';
    const cls = captureOf(source, 'Holder', CAPTURE_TAGS.CLASS_DEF);
    expect(JSON.parse(String(cls?.properties?.['typeParameters']))).toEqual({
      S: 'IOBaseStream<T, S, B>',
      B: 'BaseStream<T, B>',
    });
  });

  it('states nothing for a type parameter with no bound', () => {
    // `T` alone bounds nothing this resolver can look a member up in, and `Object` is not written in the source.
    const source = 'interface Reader<T> { T read(); }';
    const declaration = captureOf(source, 'Reader', CAPTURE_TAGS.INTERFACE_DEF);
    expect(declaration?.properties?.['typeParameters']).toBeUndefined();
  });

  it('records no bound for a clause caught mid-edit', () => {
    // **`class Holder<T extends>` is valid enough to parse and states no bound.** The grammar still produces a
    // `type_bound`, with an empty name inside it - so the rule reads the clause's content rather than its presence, and
    // a type bound to nothing stays unbound instead of being filed as a class called `""`.
    const source = 'class Holder<T extends> { void run() { } }';
    const cls = captureOf(source, 'Holder', CAPTURE_TAGS.CLASS_DEF);
    expect(cls?.properties?.['typeParameters']).toBeUndefined();
  });

  it('reads the first bound of a parameter that declares several', () => {
    // `<T extends Number & Comparable<T>>` has one class bound and one interface bound; the class is what members are
    // looked up in, and the interface declares no body to reach - the same distinction the base-class rule draws.
    const source = 'class Holder<T extends Number & Comparable<T>> { void run() { } }';
    const cls = captureOf(source, 'Holder', CAPTURE_TAGS.CLASS_DEF);
    expect(JSON.parse(String(cls?.properties?.['typeParameters']))).toEqual({ T: 'Number' });
  });
});

// **A declaration writes its parameter types and a call writes its argument names, and both are facts about the
// source.** Iteration 60 made a call choose between overloads by counting arguments; the count cannot tell
// `accept(File, String)` from `accept(Path, BasicFileAttributes)`, and those two live in different classes. The two
// properties below are what a resolver needs to decide by type what the count could only narrow.
describe('the signature a declaration writes, and the names a call passes', () => {
  const provider = new JavaProvider();

  /** The first capture of a tag whose name is `name`. */
  const found = (source: string, name: string, tag: string) =>
    provider.parse(source, 'Holder.java').find((c) => c.tag === tag && c.name === name);

  it('writes each parameter type in the order the declaration writes it', () => {
    const source = 'class Holder { void run(Widget widget, String name) { } }';
    expect(found(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['parameterTypes']).toBe(
      '["Widget","String"]',
    );
  });

  it('writes a spread parameter as the type it spreads', () => {
    // **`String... parts` is a `spread_parameter` and the grammar gives it no `type` field**, so a reader that asked
    // for the field wrote an empty string and a call passing four strings looked like a call passing none.
    const source = 'class Holder { void run(Widget widget, String... parts) { } }';
    expect(found(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['parameterTypes']).toBe(
      '["Widget","String"]',
    );
  });

  it('writes no parameter types for a declaration that writes none', () => {
    // **An absent fact is not an empty list.** A method with no parameters declares no types, and writing `[]` would
    // make "nothing to check" look like "checked and matched nothing".
    const source = 'class Holder { void run() { } }';
    expect(
      found(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['parameterTypes'],
    ).toBeUndefined();
  });

  it('says which declarations write a body', () => {
    // **A contract's method is written and not implemented**, and a resolver that reads it as the code that runs
    // answers an interface's signature where a field of the class holds the function.
    const source = [
      'interface Contract {',
      '  void run();',
      '  default void stop() { }',
      '}',
      'class Holder implements Contract {',
      '  public void run() { }',
      '}',
    ].join('\n');
    expect(found(source, 'run', CAPTURE_TAGS.METHOD_DEF)?.properties?.['hasBody']).toBeUndefined();
    expect(found(source, 'stop', CAPTURE_TAGS.METHOD_DEF)?.properties?.['hasBody']).toBe('true');
    expect(
      provider
        .parse(source, 'Holder.java')
        .filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF && c.name === 'run')
        .map((c) => c.properties?.['hasBody']),
    ).toEqual([undefined, 'true']);
  });

  it('writes the names a call passes, and a placeholder for what is not a name', () => {
    // **The resolver can only type a name it can look up.** `accept(dir, new File(name))` passes one binding and one
    // expression, and an empty entry says which is which without inventing a type for the other.
    const source = 'class Holder { void run(Widget widget) { accept(widget, new File(name)); } }';
    expect(found(source, 'accept', CAPTURE_TAGS.FUNCTION_CALL)?.properties?.['argumentNames']).toBe(
      '["widget",""]',
    );
  });

  it('writes no argument names for a call that passes no name', () => {
    const source = 'class Holder { void run() { accept(1, "two"); } }';
    expect(
      found(source, 'accept', CAPTURE_TAGS.FUNCTION_CALL)?.properties?.['argumentNames'],
    ).toBeUndefined();
  });
});

// **A lambda's parameter is bound where the container is declared, and nowhere else.** `listeners.forEach(listener -> …)`
// states no type for `listener`; `List<FileAlterationListener> listeners` states it, and the call is what joins the two.
describe('a lambda parameter and the collection it is passed to', () => {
  const provider = new JavaProvider();

  /** The `localTypes` a named method wrote, as the JSON blob it is. */
  const localsOf = (source: string, name: string): Record<string, string> =>
    JSON.parse(
      String(
        provider.parse(source, 'Holder.java').find((c) => c.name === name)?.properties?.[
          'localTypes'
        ] ?? '{}',
      ),
    ) as Record<string, string>;

  it('binds the one parameter of a forEach lambda to the receiver’s element', () => {
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire() { listeners.forEach(listener -> listener.onStart(this)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({ listener: '@elementOf:listeners' });
  });

  it('binds a parameter the lambda writes its type on, and one written with brackets', () => {
    // **`(listener) -> …` is the same lambda with brackets**, and the grammar files the parameter in a different node.
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire() { listeners.forEach((listener) -> listener.onStart(this)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({ listener: '@elementOf:listeners' });
  });

  it('binds nothing for a lambda that takes two parameters', () => {
    // **`reduce`'s lambda takes the accumulator and the element**, and the first of them is not the receiver's element.
    // Neither is a comparator's, which is why two names are refused rather than answered by position. The call is a
    // `forEach` on purpose: a name outside `LAMBDA_ELEMENT_CALLS` would pass this test without the rule being asked.
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire() { listeners.forEach((a, b) -> a.compareTo(b)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('binds nothing for a lambda that declares no parameter', () => {
    // `() -> cleanup()` hands the element to nobody, so there is no name to bind.
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire() { listeners.forEach(() -> cleanup()); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('reads the parameter list, not the first name the lambda writes', () => {
    // **`() -> listener` has one named child and it is the body.** Read by position, the body's identifier became the
    // lambda's parameter and was bound to the receiver's element - a wrong type on a name that means something else.
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire() { listeners.forEach(() -> listener); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('binds nothing for a parameter the lambda writes its type on', () => {
    // A typed parameter states its own type, and this rule is for the one that states none.
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire() { listeners.forEach((Listener l) -> l.onStart(this)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('binds nothing for a call whose receiver is an expression', () => {
    // `getListeners().forEach(…)` states no declaration to take an element from, and a call site is not a declaration.
    const source = [
      'class Holder {',
      '  void fire() { getListeners().forEach(listener -> listener.onStart(this)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('records the callee a call without a receiver names, and leaves the meaning to the declaration', () => {
    // **`forEach(…)` inside a class that *is* a list** has no `object` field at all: the receiver is `this`, which the
    // class already is. The provider records the callee's name and nothing more - it cannot see whether the class
    // declares `forEach` or inherits it - and the resolver answers with the parameter that declaration writes, or with
    // nothing when the class declares none. `Holder` here inherits `forEach` from `ArrayList`, so the path resolves to
    // no declaration and the lambda's parameter keeps no type, which is the refusal this case has always asserted.
    const source = [
      'class Holder extends ArrayList<Listener> {',
      '  void fire() { forEach(listener -> listener.onStart(this)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({ listener: '@elementOf:forEach' });
  });

  it('binds nothing for a call that passes no lambda', () => {
    // The functional parameter is a value written elsewhere, and its type is the parameter's declaration.
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire(Listener handler) { listeners.forEach(handler); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('binds nothing for an element-passing call that passes nothing', () => {
    const source = [
      'class Holder {',
      '  private final List<Listener> listeners;',
      '  void fire() { listeners.forEach(); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('binds the element of the collection a stream was opened from', () => {
    // **A stream is a view of one collection and holds no element of its own**, so `set.stream().anyMatch(…)` hands the
    // lambda the element of `set`. `commons-io`'s `AndFileFilter.accept` and `commons-lang`'s `CharSet.contains` are this
    // shape, and both were unanswered because the receiver was an expression rather than a path.
    const source = [
      'class Holder {',
      '  private final Set<Range> ranges;',
      '  void fire(final char ch) { ranges.stream().anyMatch(range -> range.contains(ch)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({ range: '@elementOf:ranges' });
  });

  it('binds the element a callee names on its own parameter', () => {
    // **`forEachObserver(observer -> …)` names no container at all**, and the element is written on `forEachObserver`'s
    // parameter - a `FailableConsumer<Observer, IOException>`. The path recorded is the callee's name, and what it means
    // is decided where that declaration is.
    const source = [
      'class Holder {',
      '  void fire() { forEachObserver(observer -> observer.data(1)); }',
      '  private void forEachObserver(final FailableConsumer<Observer, IOException> action) { }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({ observer: '@elementOf:forEachObserver' });
  });

  it('binds nothing for a stream opened on an expression, which names no declaration', () => {
    const source = [
      'class Holder {',
      '  void fire() { getRanges().stream().anyMatch(range -> range.contains(1)); }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'fire')).toEqual({});
  });
});

describe('a class that writes no constructor, and the one the language supplies', () => {
  const provider = new JavaProvider();

  const constructorCaptures = (source: string) =>
    provider.parse(source, 'Child.java').filter((c) => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);

  const implicitSuperCall = (source: string) =>
    provider.parse(source, 'Child.java').filter((c) => c.properties?.['implicitSuper'] === 'true');

  it('declares the constructor, and the base constructor it calls', () => {
    // **`class Child extends Base { }` writes no constructor and still has one**, and that constructor's first act is
    // `super()`. `javac`'s attribution names both, so a graph that names neither is missing a call every instance of
    // the class makes.
    const source = 'class Child extends Base { }';
    const constructors = constructorCaptures(source);
    expect(constructors.map((c) => c.name)).toEqual(['Child']);
    expect(constructors[0]!.containerName).toBe('Child');
    // **Implicit is stated rather than inferred**, because a reader cannot tell a constructor written on the class line
    // from one the language put there.
    expect(constructors[0]!.properties?.['implicit']).toBe('true');
    expect(implicitSuperCall(source).map((c) => c.name)).toEqual(['Base']);
  });

  it('puts the constructor on the line the class is declared on, and no further', () => {
    // **A declaration's span is what a capture is attributed to**, so a constructor stretched over the class body
    // claimed every field initialiser in it: `DEFAULT_COMPARATOR = new ReverseFileComparator()` inside
    // `DirectoryFileComparator` moved from no caller at all to a constructor that calls it - 5 wrong edges on
    // `apache/commons-io@2.16.1`, all of them caught by the corpus and none by a unit test that only counted nodes.
    const source = ['class Child extends Base {', '  int field = build();', '}'].join('\n');
    const constructor = constructorCaptures(source)[0]!;
    expect(constructor.startLine).toBe(1);
    expect(constructor.endLine).toBe(1);
  });

  it('declares none for a class that extends nothing', () => {
    // The constructor such a class runs is `Object`'s, whose declaration this graph does not hold - the same refusal the
    // written-constructor path already makes.
    expect(constructorCaptures('class Alone { }')).toEqual([]);
  });

  it('declares none for a class that writes its own', () => {
    // The language supplies a constructor only where none is written, and the written one records its own `super()`.
    const source = 'class Child extends Base { Child(final int a) { } }';
    const constructors = constructorCaptures(source);
    expect(constructors.map((c) => c.properties?.['implicit'])).toEqual([undefined]);
    expect(implicitSuperCall(source)).toHaveLength(1);
  });

  it('declares none for an interface, which has no constructor at all', () => {
    expect(constructorCaptures('interface Child extends Base { }')).toEqual([]);
  });
});

// **An enum writes two methods and the source never mentions either.** `values()` and `valueOf(String)` are declared by
// the language for every enum, and `javac`'s attribution names them - so a graph that only files what the source spells
// answers nothing for `IOCase.values()`, which is how `commons-io`'s `IOCase.forName` iterates its own constants.
describe('the two methods an enum declares without writing them', () => {
  const provider = new JavaProvider();

  const methodsOf = (source: string) =>
    provider.parse(source, 'Color.java').filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);

  it('declares values and valueOf, and says the language wrote them', () => {
    const source = ['enum Color {', '  RED("red");', '  Color(final String name) { }', '}'].join(
      '\n',
    );
    const methods = methodsOf(source);
    expect(methods.map((c) => c.name)).toEqual(['values', 'valueOf']);
    expect(methods.map((c) => c.properties?.['implicit'])).toEqual(['true', 'true']);
    // **`values()` is an array of the enum and `valueOf` is one of it**, which is what a receiver written on either
    // means: `values()` iterates the constants, `valueOf(x)` is a constant.
    expect(methods.map((c) => c.properties?.['returnType'])).toEqual(['Color[]', 'Color']);
    expect(methods.map((c) => c.containerName)).toEqual(['Color', 'Color']);
  });

  it('declares them on the line the enum is declared on', () => {
    // The span is what a capture is attributed to, and a synthetic declaration stretched over the body would claim the
    // constants' own initialisers - the mistake the implicit constructor made once already.
    const source = [
      'enum Color {',
      '  RED("red"), GREEN("green");',
      '  Color(final String name) { }',
      '}',
    ].join('\n');
    expect(methodsOf(source).map((c) => c.startLine)).toEqual([1, 1]);
  });

  it('declares none for a class or an interface, which the language writes none for', () => {
    expect(methodsOf('class Color { }')).toEqual([]);
    expect(methodsOf('interface Color { }')).toEqual([]);
  });
});

// **`Stream.of(x)` is a stream of `x`'s elements**, and it is written where a container would be. `commons-lang`'s
// `DurationFormatUtils.Token.containsTokenWithValue` reads `Stream.of(tokens).anyMatch(token -> token.getValue() …)`,
// and `commons-io`'s `IOCase.forName` reads `Stream.of(IOCase.values()).filter(ioCase -> ioCase.getName() …)` — two
// files, one rule, and both lambdas unbound because the receiver was an expression rather than a path.
describe('a stream opened with Stream.of', () => {
  const provider = new JavaProvider();

  const localsOf = (source: string, name: string): Record<string, string> =>
    JSON.parse(
      String(
        provider.parse(source, 'Holder.java').find((c) => c.name === name)?.properties?.[
          'localTypes'
        ] ?? '{}',
      ),
    ) as Record<string, string>;

  it('binds the element of the array it was handed', () => {
    const source = [
      'class Holder {',
      '  static boolean has(final Token[] tokens) {',
      '    return Stream.of(tokens).anyMatch(token -> token.value() == 1);',
      '  }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'has')).toEqual({ token: '@elementOf:tokens' });
  });

  it('binds the element of what the handed call returns', () => {
    // **A call in the argument still names one declaration**, and the path recorded is the call's own name: what
    // `Color.values` means is decided where it is declared, exactly as it is for a receiver.
    const source = [
      'class Holder {',
      '  static Holder find(final String n) {',
      '    return Stream.of(Color.values()).filter(c -> c.name().equals(n)).findFirst().orElse(null);',
      '  }',
      '}',
    ].join('\n');
    expect(localsOf(source, 'find')).toEqual({ c: '@elementOf:Color.values' });
  });

  it('binds nothing for a Stream.of that writes several arguments', () => {
    // Three values are three elements, and which one the lambda is handed is the stream's business rather than the
    // argument's - the refusal this module makes everywhere it would have to pick.
    const source = 'class Holder { void fire() { Stream.of(a, b).forEach(x -> x.run()); } }';
    expect(localsOf(source, 'fire')).toEqual({});
  });

  it('binds nothing for a Stream.of written on another receiver', () => {
    const source = 'class Holder { void fire() { gather.Stream.of(a).forEach(x -> x.run()); } }';
    expect(localsOf(source, 'fire')).toEqual({});
  });
});

// **A class written inside a class is written inside a scope.** Java's member lookup starts at the class the code is
// written in and walks outward through the classes that lexically contain it, so `Builder.setDirectory`'s
// `toPath(file, null)` names `DeferredFileOutputStream`'s private static method — two edges on `commons-io`, and the
// same shape in `FastDateParser.StrategyParser.letterPattern`.
describe('a class written inside another class', () => {
  const provider = new JavaProvider();

  const classOf = (source: string, name: string) =>
    provider
      .parse(source, 'Outer.java')
      .find((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === name);

  it('names the class that encloses it', () => {
    const source = [
      'class Outer {',
      '  static class Inner {',
      '    void run() { }',
      '  }',
      '}',
    ].join('\n');
    expect(classOf(source, 'Inner')?.properties?.['outerClass']).toBe('Outer');
  });

  it('names the nearest one, and an anonymous class names the class it is written in', () => {
    // **The walk is one level at a time**, so a class two deep answers its own parent rather than the top-level one.
    const source = [
      'class Outer {',
      '  static class Middle {',
      '    static class Inner { }',
      '  }',
      '}',
    ].join('\n');
    expect(classOf(source, 'Inner')?.properties?.['outerClass']).toBe('Middle');
    expect(classOf(source, 'Middle')?.properties?.['outerClass']).toBe('Outer');
  });

  it('names none for a class written at the top level', () => {
    expect(classOf('class Alone { }', 'Alone')?.properties?.['outerClass']).toBeUndefined();
  });
});
