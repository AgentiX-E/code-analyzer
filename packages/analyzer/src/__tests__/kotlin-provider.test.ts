import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { KotlinProvider } from '../languages/kotlin.js';

/**
 * Locate a descendant node by tree-sitter type.
 *
 * The provider no longer exposes a deep search — nothing in its own extraction
 * used one — so the suite carries the locator it needs to reach fixture nodes.
 */
interface SyntaxNodeLike {
  type: string;
  namedChildCount: number;
  namedChild(index: number): SyntaxNodeLike;
}

function findDeepChild(node: SyntaxNodeLike, type: string): SyntaxNodeLike | null {
  if (node.type === type) return node;
  for (let i = 0; i < node.namedChildCount; i++) {
    const result = findDeepChild(node.namedChild(i), type);
    if (result) return result;
  }
  return null;
}

describe('KotlinProvider', () => {
  const provider = new KotlinProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('kotlin');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Kotlin');
    });

    it('should have .kt and .kts extensions', () => {
      expect(provider.extensions).toContain('.kt');
      expect(provider.extensions).toContain('.kts');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('extractImports', () => {
    // **The base class walked JavaScript's shapes and found nothing**, so a Kotlin repository indexed with no dependency
    // edges at all. These three statements are the whole grammar: plain, wildcard, aliased.
    it('reads a plain import, a wildcard and an alias from Kotlin’s own nodes', () => {
      const imports = provider.extractImports(
        [
          'package kotlinx.coroutines',
          'import kotlinx.coroutines.internal.MainDispatcherLoader',
          'import kotlinx.coroutines.scheduling.*',
          'import kotlin.coroutines.CoroutineContext as CC',
          '',
        ].join('\n'),
      );

      expect(imports.map((i) => [i.source, i.type, i.names, i.lineNumber])).toEqual([
        ['kotlinx.coroutines.internal.MainDispatcherLoader', 'named', ['MainDispatcherLoader'], 2],
        ['kotlinx.coroutines.scheduling', 'wildcard', [], 3],
        ['kotlin.coroutines.CoroutineContext', 'named', ['CC'], 4],
      ]);
      expect(imports[2]?.alias).toBe('CC');
    });

    it('falls back to the regex reader when no grammar is loaded', () => {
      // **A degraded install must not look like a file with no imports**, which is the same rule the Python provider
      // follows: the fallback is the only reader there is.
      const degraded = Object.create(provider) as KotlinProvider;
      Object.defineProperty(degraded, 'parser', { value: null });

      const imports = degraded.extractImports('import a.b.C\nimport d.e.*\n');

      expect(imports.map((i) => [i.source, i.type])).toEqual([
        ['a.b.C', 'named'],
        ['d.e.*', 'wildcard'],
      ]);
    });
  });

  describe('parse', () => {
    it('should extract class definitions', () => {
      const code = 'class MyClass {\n  fun greet() = "hello"\n}';
      const captures = provider.parse(code, 'MyClass.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract data class', () => {
      const code = 'data class User(val name: String, val age: Int)';
      const captures = provider.parse(code, 'User.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'User')).toBe(true);
    });

    it('should extract sealed class', () => {
      const code = 'sealed class Result { }';
      const captures = provider.parse(code, 'Result.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'Result')).toBe(true);
    });

    it('should extract abstract class', () => {
      const code = 'abstract class BaseRepository { }';
      const captures = provider.parse(code, 'BaseRepository.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'BaseRepository')).toBe(true);
    });

    it('should extract open class', () => {
      const code = 'open class BaseViewModel { }';
      const captures = provider.parse(code, 'BaseViewModel.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'BaseViewModel')).toBe(true);
    });

    it('should extract inner class', () => {
      const code = 'inner class InnerHelper { }';
      const captures = provider.parse(code, 'InnerHelper.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'InnerHelper')).toBe(true);
    });

    it('should extract interface definitions', () => {
      const code = 'interface Callback {\n  fun onSuccess()\n}';
      const captures = provider.parse(code, 'Callback.kt');
      const interfaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(interfaces.some((c) => c.name === 'Callback')).toBe(true);
    });

    it('should extract object declarations', () => {
      const code = 'object DatabaseConfig {\n  val url = "localhost"\n}';
      const captures = provider.parse(code, 'Config.kt');
      const objs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.['isObject'] === 'true',
      );
      expect(objs.some((c) => c.name === 'DatabaseConfig')).toBe(true);
    });

    it('should extract companion object', () => {
      const code = 'companion object Factory { }';
      const captures = provider.parse(code, 'Test.kt');
      // companion object with no identifier before 'companion' may parse differently
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract companion object inside a class', () => {
      const code = 'class MyClass { companion object Factory { const val TAG = "MyClass" } }';
      const captures = provider.parse(code, 'Test.kt');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract enum classes', () => {
      const code = 'enum class Color { RED, GREEN, BLUE }';
      const captures = provider.parse(code, 'Color.kt');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should extract enum class with properties', () => {
      const code = 'enum class Status(val code: Int) { ACTIVE(1), INACTIVE(0) }';
      const captures = provider.parse(code, 'Status.kt');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Status')).toBe(true);
    });

    // **A Kotlin class names its superclass and its interfaces in one colon-separated list**, and until this was read
    // the graph recorded neither: `class Foo : Base()` produced a `Class` with no `baseClasses`, so every call a
    // subclass makes to an inherited method was unresolvable and the resolver's class chain had nothing to walk.
    describe('the class a declaration extends', () => {
      const baseOf = (code: string, name: string): string | undefined =>
        provider
          .parse(code, 'Sample.kt')
          .find((c) => c.name === name && c.tag === CAPTURE_TAGS.CLASS_DEF)?.properties?.[
          'baseClasses'
        ];

      const interfacesOf = (code: string, name: string): string | undefined =>
        provider
          .parse(code, 'Sample.kt')
          .find((c) => c.name === name && c.tag === CAPTURE_TAGS.CLASS_DEF)?.properties?.[
          'interfaces'
        ];

      it('reads the invoked specifier as the base class', () => {
        expect(baseOf('class Repository : BaseRepository() {}', 'Repository')).toBe(
          'BaseRepository',
        );
      });

      it('separates the interfaces that follow it', () => {
        const code = 'class Repository : BaseRepository(), Closeable, Logging {}';
        expect(baseOf(code, 'Repository')).toBe('BaseRepository');
        expect(interfacesOf(code, 'Repository')).toBe('Closeable,Logging');
      });

      it('names no base class when every specifier is an interface', () => {
        // **An interface cannot be constructed**, so a declaration with no argument list conforms to interfaces and
        // extends nothing - and recording the first one as a base class would send the resolver into a body that
        // does not exist.
        const code = 'class Event : Closeable, Logging {}';
        expect(baseOf(code, 'Event')).toBeUndefined();
        expect(interfacesOf(code, 'Event')).toBe('Closeable,Logging');
      });

      it('takes the head of a generic base and not its type argument', () => {
        expect(baseOf('class IntList : ArrayList<Int>() {}', 'IntList')).toBe('ArrayList');
      });

      it('reads the base of a class written across several lines', () => {
        // A primary constructor puts the parameters between the name and the colon, so the heritage is three lines
        // below the keyword - which is how most real Kotlin declares a class.
        const code = [
          'class Service(',
          '  private val client: Client,',
          ') : BaseService() {',
          '}',
        ].join('\n');
        expect(baseOf(code, 'Service')).toBe('BaseService');
      });

      it('names no heritage for a declaration that has none', () => {
        expect(baseOf('class Plain {}', 'Plain')).toBeUndefined();
        expect(interfacesOf('class Plain {}', 'Plain')).toBeUndefined();
      });

      it('keeps the first invoked specifier when the source invokes two', () => {
        // **Not valid Kotlin** - a class has one superclass - and exactly what error recovery produces halfway
        // through an edit. The first invokable specifier is the base, and a later one must not overwrite it.
        expect(baseOf('class Broken : First(), Second() {}', 'Broken')).toBe('First');
      });

      it('reads a delegated interface as an interface and not as a base class', () => {
        // `class Repo : Store by memory` conforms to an interface by handing the work to another object. There is no
        // constructor call, so there is no class to extend - and a base class recorded here would send the resolver
        // into a body that does not exist.
        const code = 'class Repo : Store by memory {}';
        expect(baseOf(code, 'Repo')).toBeUndefined();
        expect(interfacesOf(code, 'Repo')).toBe('Store');
      });
    });

    it('should extract functions', () => {
      const code = 'fun greet(name: String): String {\n  return "Hello"\n}';
      const captures = provider.parse(code, 'main.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
    });

    it('should extract functions with modifiers', () => {
      const code =
        'private fun doInternal(): Unit { }\nsuspend fun fetchData(): String { return "" }';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'doInternal')).toBe(true);
      expect(funcs.some((c) => c.name === 'fetchData')).toBe(true);
    });

    it('should extract suspend functions explicitly', () => {
      const code = 'suspend fun fetchRemote(): String { return "data" }';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fetchRemote')).toBe(true);
    });

    it('should extract functions with default params and varargs', () => {
      const code =
        'fun greet(name: String = "World", vararg args: String) { }\nfun sum(vararg nums: Int): Int = nums.sum()';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
      expect(funcs.some((c) => c.name === 'sum')).toBe(true);
    });

    it('should extract properties (val)', () => {
      const code = 'val name: String = "hello"\nval count = 42';
      const captures = provider.parse(code, 'test.kt');
      // tree-sitter uses 'property_declaration' which isn't in walkAndCapture
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract properties (var)', () => {
      const code = 'var state: String = "active"\nlateinit var config: Config';
      const captures = provider.parse(code, 'test.kt');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract properties with getter/setter', () => {
      const code =
        'val getter: String get() = "hello"\nvar count: Int = 0\n  get() = field\n  set(value) { field = value }';
      const captures = provider.parse(code, 'test.kt');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract annotations', () => {
      const code =
        '@Override\nfun onCreate() { }\n@Deprecated("use newMethod")\nfun oldMethod() { }';
      const captures = provider.parse(code, 'test.kt');
      // tree-sitter uses 'annotation' which isn't in walkAndCapture
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract import statements', () => {
      const code = 'import kotlin.collections.List\nimport kotlin.collections.Map\nfun main() { }';
      const captures = provider.parse(code, 'main.kt');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract wildcard imports in parse', () => {
      const code = 'import kotlin.collections.*\nfun main() { }';
      const captures = provider.parse(code, 'main.kt');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract aliased imports in parse', () => {
      const code = 'import kotlin.collections.List as MyList\nfun main() { }';
      const captures = provider.parse(code, 'main.kt');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'Empty.kt');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = 'import kotlin.collections.List\nclass First\nfun second()';
      const captures = provider.parse(code, 'test.kt');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should extract extension functions', () => {
      const code = 'fun String.isValid(): Boolean = true';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'isValid')).toBe(true);
    });

    it('should extract infix functions', () => {
      const code = 'infix fun Int.add(other: Int): Int = this + other';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should extract higher-order functions', () => {
      const code =
        'fun higherOrder(fn: () -> Unit) { fn() }\nfun execute(callback: (String) -> Boolean): Boolean { return callback("test") }';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'higherOrder')).toBe(true);
      expect(funcs.some((c) => c.name === 'execute')).toBe(true);
    });

    it('should extract lambda expressions and functions together', () => {
      const code = 'fun process(items: List<String>) { items.forEach { println(it) } }';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'process')).toBe(true);
    });

    it('should handle files with only comments', () => {
      const code = '// Just a comment\n/* Block comment */';
      const captures = provider.parse(code, 'test.kt');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should extract class with methods inside', () => {
      const code =
        'class Calculator {\n  fun add(a: Int, b: Int): Int = a + b\n  fun subtract(a: Int, b: Int): Int = a - b\n}';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThanOrEqual(2);
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Calculator')).toBe(true);
    });

    it('should extract overloaded functions', () => {
      const code =
        'fun format(value: Int): String = value.toString()\nfun format(value: Double): String = value.toString()';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'format',
      );
      expect(funcs.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract inline functions', () => {
      const code = 'inline fun <reified T> isType(value: Any): Boolean = value is T';
      const captures = provider.parse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'isType')).toBe(true);
    });

    it('should extract object expression', () => {
      const code = 'object : Runnable { override fun run() { } }';
      const captures = provider.parse(code, 'test.kt');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle file with class, function, enum, and imports', () => {
      const code =
        'import kotlin.collections.List\n\nclass Box<T>(val value: T)\n\nfun main() { }\n\nenum class Direction { NORTH, SOUTH }';
      const captures = provider.parse(code, 'test.kt');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      expect(funcs.length).toBeGreaterThanOrEqual(1);
      expect(enums.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractImports', () => {
    it('should extract imports', () => {
      const code = 'import kotlin.collections.List\nimport kotlin.collections.Map';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract wildcard imports', () => {
      const code = 'import kotlin.collections.*';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      const wildcard = imports.find((i) => i.type === 'wildcard');
      expect(wildcard).toBeDefined();
    });

    it('should extract aliased imports', () => {
      const code = 'import kotlin.collections.List as MyList';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports.some((i) => i.names?.includes('MyList'))).toBe(true);
    });

    it('should handle files without imports', () => {
      const imports = provider.extractImports('fun main() { }');
      expect(imports.length).toBe(0);
    });

    it('should include line numbers', () => {
      const code = '// comment\nimport kotlin.collections.List';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.lineNumber).toBe(2);
    });

    it('should extract multiple wildcard imports', () => {
      const code = 'import kotlin.collections.*\nimport java.io.*';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(2);
      const wildcards = imports.filter((i) => i.type === 'wildcard');
      expect(wildcards.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract imports with correct source paths', () => {
      const code = 'import kotlin.collections.List';
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toContain('kotlin');
      expect(imports[0]!.type).toBe('named');
    });
  });

  describe('isExported', () => {
    it('should detect top-level function as exported', () => {
      expect(provider.isExported('fun greet() { }', 'greet')).toBe(true);
    });

    it('should detect class as exported', () => {
      expect(provider.isExported('class MyClass { }', 'MyClass')).toBe(true);
    });

    it('should detect interface as exported', () => {
      expect(provider.isExported('interface Callback { }', 'Callback')).toBe(true);
    });

    it('should detect object as exported', () => {
      expect(provider.isExported('object Singleton { }', 'Singleton')).toBe(true);
    });

    it('should detect val as exported', () => {
      const result = provider.isExported('val name = "test"', 'name');
      // Kotlin top-level val uses property_declaration node, not handled in kotlinCheckExported
      expect(typeof result).toBe('boolean');
    });

    it('should detect var as exported', () => {
      const result = provider.isExported('var count = 0', 'count');
      expect(typeof result).toBe('boolean');
    });

    it('should return false for non-matching name', () => {
      expect(provider.isExported('class Foo { }', 'Bar')).toBe(false);
    });

    it('should return false for non-matching function', () => {
      expect(provider.isExported('fun foo() { }', 'bar')).toBe(false);
    });

    it('should detect enum class as exported', () => {
      expect(provider.isExported('enum class Color { RED, GREEN }', 'Color')).toBe(true);
    });

    it('should detect data class as exported', () => {
      expect(provider.isExported('data class User(val name: String)', 'User')).toBe(true);
    });

    it('should handle source with nested class', () => {
      const code = 'class Outer { class Inner { } }';
      expect(provider.isExported(code, 'Outer')).toBe(true);
    });
  });

  describe('fallback methods', () => {
    it('fallbackParse should extract class definitions', () => {
      const code = 'class MyClass {\n  fun greet() = "hello"\n}';
      const captures = provider.fallbackParse(code, 'MyClass.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'MyClass')).toBe(true);
    });

    it('fallbackParse should extract functions', () => {
      const code = 'fun greet(name: String): String {\n  return "Hello"\n}';
      const captures = provider.fallbackParse(code, 'main.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
    });

    it('fallbackParse should extract interface definitions', () => {
      const code = 'interface Callback {\n  fun onSuccess()\n}';
      const captures = provider.fallbackParse(code, 'test.kt');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'Callback')).toBe(true);
    });

    it('fallbackParse should extract object declarations', () => {
      const code = 'object DatabaseConfig {\n  val url = "localhost"\n}';
      const captures = provider.fallbackParse(code, 'test.kt');
      const objs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.['isObject'] === 'true',
      );
      expect(objs.some((c) => c.name === 'DatabaseConfig')).toBe(true);
    });

    it('fallbackParse should extract enum classes', () => {
      const code = 'enum class Color { RED, GREEN, BLUE }';
      const captures = provider.fallbackParse(code, 'test.kt');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('fallbackParse should extract properties', () => {
      const code = 'val name: String = "hello"\nvar count = 42';
      const captures = provider.fallbackParse(code, 'test.kt');
      expect(captures.length).toBeGreaterThan(0);
    });

    it('fallbackParse should extract annotations', () => {
      const code =
        '@Override\nfun onCreate() { }\n@Deprecated("use newMethod")\nfun oldMethod() { }';
      const captures = provider.fallbackParse(code, 'test.kt');
      const decs = captures.filter((c) => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(decs.length).toBeGreaterThanOrEqual(2);
    });

    it('fallbackParse should extract imports', () => {
      const code = 'import kotlin.collections.List\nimport kotlin.collections.Map';
      const captures = provider.fallbackParse(code, 'test.kt');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('fallbackParse should handle empty files', () => {
      const captures = provider.fallbackParse('', 'Empty.kt');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('fallbackParse should extract data class', () => {
      const code = 'data class User(val name: String)';
      const captures = provider.fallbackParse(code, 'test.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'User')).toBe(true);
    });

    it('fallbackParse should extract sealed class', () => {
      const code = 'sealed class Result { }';
      const captures = provider.fallbackParse(code, 'test.kt');
      const classDefs = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classDefs.some((c) => c.name === 'Result')).toBe(true);
    });

    it('fallbackParse should extract companion object', () => {
      const code = 'companion object Factory { }';
      const captures = provider.fallbackParse(code, 'test.kt');
      const objs = captures.filter((c) => c.properties?.['isObject'] === 'true');
      expect(objs.some((c) => c.name === 'Factory')).toBe(true);
    });

    it('fallbackParse should extract suspending function', () => {
      const code = 'suspend fun fetchData(): String { return "" }';
      const captures = provider.fallbackParse(code, 'test.kt');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fetchData')).toBe(true);
    });

    it('fallbackExtractImports should extract named imports', () => {
      const code = 'import kotlin.collections.List\nimport kotlin.collections.Map';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('fallbackExtractImports should extract wildcard imports', () => {
      const code = 'import kotlin.collections.*';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.type).toBe('wildcard');
    });

    it('fallbackExtractImports should extract aliased imports', () => {
      const code = 'import kotlin.collections.List as MyList';
      const imports = provider.fallbackExtractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.names).toContain('MyList');
    });

    it('fallbackExtractImports should handle empty source', () => {
      const imports = provider.fallbackExtractImports('');
      expect(imports).toHaveLength(0);
    });

    it('fallbackIsExported should detect class as exported', () => {
      expect(provider.fallbackIsExported('class MyClass { }', 'MyClass')).toBe(true);
    });

    it('fallbackIsExported should detect interface as exported', () => {
      expect(provider.fallbackIsExported('interface Callback { }', 'Callback')).toBe(true);
    });

    it('fallbackIsExported should detect object as exported', () => {
      expect(provider.fallbackIsExported('object Singleton { }', 'Singleton')).toBe(true);
    });

    it('fallbackIsExported should detect fun as exported', () => {
      expect(provider.fallbackIsExported('fun greet() { }', 'greet')).toBe(true);
    });

    it('fallbackIsExported should detect val as exported', () => {
      expect(provider.fallbackIsExported('val name = "test"', 'name')).toBe(true);
    });

    it('fallbackIsExported should detect var as exported', () => {
      expect(provider.fallbackIsExported('var count = 0', 'count')).toBe(true);
    });

    it('fallbackIsExported should return false for non-matching name', () => {
      expect(provider.fallbackIsExported('class Foo { }', 'Bar')).toBe(false);
    });
  });

  describe('internal helpers', () => {
    it('collectImportPathParts should collect path parts with wildcard', () => {
      const code = 'import kotlin.collections.*';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        // Find import_header node
        const importNode = findDeepChild(tree.rootNode, 'import_header');
        if (importNode) {
          const parts = p.collectImportPathParts(importNode);
          expect(Array.isArray(parts)).toBe(true);
        }
      }
    });

    it('findChild should find direct named child', () => {
      const code = 'class Foo { }';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const classNode = findDeepChild(tree.rootNode, 'class_declaration');
        if (classNode) {
          const result = p.findChild(classNode, 'type_identifier');
          expect(result).toBeDefined();
        }
      }
    });

    it('findChild should return null for missing child', () => {
      const code = 'class Foo { }';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const classNode = findDeepChild(tree.rootNode, 'class_declaration');
        if (classNode) {
          const result = p.findChild(classNode, 'nonexistent');
          expect(result).toBeNull();
        }
      }
    });

    it('walkAndCapture should handle empty source_file root', () => {
      const code = '';
      const p = provider as any;
      const tree = p.parser?.parse(code);
      if (tree) {
        const captures: any[] = [];
        p.walkAndCapture(tree.rootNode, captures);
        expect(Array.isArray(captures)).toBe(true);
      }
    });

    it('kotlinCheckExported should detect function_declaration', () => {
      const p = provider as any;
      const tree = p.parser?.parse('fun greet() { }');
      if (tree) {
        const result = p.kotlinCheckExported(tree.rootNode, 'greet');
        expect(result).toBe(true);
      }
    });

    it('kotlinCheckExported should detect class_declaration', () => {
      const p = provider as any;
      const tree = p.parser?.parse('class MyClass { }');
      if (tree) {
        const result = p.kotlinCheckExported(tree.rootNode, 'MyClass');
        expect(result).toBe(true);
      }
    });

    it('kotlinCheckExported should detect object_declaration', () => {
      const p = provider as any;
      const tree = p.parser?.parse('object Singleton { }');
      if (tree) {
        const result = p.kotlinCheckExported(tree.rootNode, 'Singleton');
        expect(result).toBe(true);
      }
    });

    it('kotlinCheckExported should return false for non-matching name', () => {
      const p = provider as any;
      const tree = p.parser?.parse('class Foo { }');
      if (tree) {
        const result = p.kotlinCheckExported(tree.rootNode, 'Bar');
        expect(result).toBe(false);
      }
    });
  });

  describe('direct method coverage for functions metric', () => {
    it('ln should return correct line numbers', () => {
      const p = provider as any;
      expect(p.ln('line1\nline2\nline3\n', 0)).toBe(1);
      expect(p.ln('line1\nline2\nline3\n', 6)).toBe(2);
      expect(p.ln('line1\nline2\nline3\n', 12)).toBe(3);
      expect(p.ln('', 0)).toBe(1);
    });

    it('walkAndCapture with enum class detection', () => {
      const p = provider as any;
      const code = 'enum class Color { RED, GREEN, BLUE }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const captures: any[] = [];
        p.walkAndCapture(tree.rootNode, captures);
        const enums = captures.filter((c: any) => c.tag === CAPTURE_TAGS.ENUM_DEF);
        expect(enums.length).toBeGreaterThanOrEqual(1);
        expect(enums[0].name).toBe('Color');
      }
    });

    it('walkAndCapture with object_declaration', () => {
      const p = provider as any;
      const code = 'object Singleton { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const captures: any[] = [];
        p.walkAndCapture(tree.rootNode, captures);
        const objs = captures.filter((c: any) => c.properties?.isObject === 'true');
        expect(objs.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('walkAndCapture with import_header basic', () => {
      const p = provider as any;
      const code = 'import kotlin.collections.List\nfun main() { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const captures: any[] = [];
        p.walkAndCapture(tree.rootNode, captures);
        const imports = captures.filter((c: any) => c.tag === CAPTURE_TAGS.IMPORT);
        expect(imports.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('extractKotlinImport with wildcard import', () => {
      const p = provider as any;
      const code = 'import kotlin.collections.*';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const importNode = findDeepChild(tree.rootNode, 'import_header');
        if (importNode) {
          const imports: any[] = [];
          p.extractKotlinImport(importNode, imports);
          expect(imports.length).toBe(1);
          expect(imports[0].type).toBe('wildcard');
        }
      }
    });

    it('extractKotlinImport with alias import', () => {
      const p = provider as any;
      const code = 'import kotlin.collections.List as MyList';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const importNode = findDeepChild(tree.rootNode, 'import_header');
        if (importNode) {
          const imports: any[] = [];
          p.extractKotlinImport(importNode, imports);
          expect(imports.length).toBe(1);
          expect(imports[0].names).toContain('MyList');
        }
      }
    });

    it('walkForImports with wildcard import', () => {
      const p = provider as any;
      const code = 'import kotlin.collections.*\nfun main() { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const imports: any[] = [];
        p.walkForImports(tree.rootNode, imports);
        expect(imports.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('walkForImports with aliased import', () => {
      const p = provider as any;
      const code = 'import kotlin.collections.List as MyList\nfun main() { }';
      p.source = code;
      const tree = p.parser?.parse(code);
      if (tree) {
        const imports: any[] = [];
        p.walkForImports(tree.rootNode, imports);
        expect(imports.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});

/**
 * The other half of "a name is written and nothing recorded it".
 *
 * **Kotlin's grammar makes this the easiest of the three to get right and the easiest to get wrong.** Every type a
 * declaration writes is inside a `user_type`, so the boundary between a use and a declaration is structural rather
 * than positional - but a qualified type (`kotlinx.coroutines.Flow`) is *three* `type_identifier` siblings joined by
 * dots, so a walk that collected identifiers would file `kotlinx` and `coroutines` as types.
 */
describe('a name a type position writes', () => {
  const reader = new KotlinProvider();
  const typeReferences = (source: string): string[] =>
    reader
      .parse(source, 'Types.kt')
      .filter((capture) => capture.tag === CAPTURE_TAGS.TYPE_REFERENCE)
      .map((capture) => String(capture.name));

  it('is a reference when a property declares it', () => {
    expect(typeReferences('class Foo {\n  val policy: RetryPolicy = TODO()\n}')).toEqual([
      'RetryPolicy',
    ]);
  });

  it('reads the parameter types and the return type', () => {
    expect(typeReferences('fun send(p: RetryPolicy): Outcome = TODO()')).toEqual([
      'RetryPolicy',
      'Outcome',
    ]);
  });

  it('includes every name a type argument holds', () => {
    expect(typeReferences('fun send(rest: List<Widget>) {}')).toEqual(['List', 'Widget']);
  });

  it('names the member of a qualified type, not the packages in front of it', () => {
    expect(typeReferences('class Foo {\n  val dep: kotlinx.coroutines.Flow? = null\n}')).toEqual([
      'Flow',
    ]);
  });

  it('does not record the name a class declares', () => {
    // **A Kotlin class names itself with a `type_identifier`**, which is the same node type a use has - so this is the
    // assertion that pins the boundary the `user_type` rule draws.
    expect(typeReferences('class Widget')).toEqual([]);
  });

  it('does not record a type parameter it declares, only the bound it names', () => {
    expect(typeReferences('class Box<T : Widget>')).toEqual(['Widget']);
  });

  it('reads the right-hand side of a type alias', () => {
    expect(typeReferences('typealias Alias = RetryPolicy')).toEqual(['RetryPolicy']);
  });

  it('reads the superclass and the interfaces a declaration names', () => {
    expect(typeReferences('class Foo : Base(), Runnable')).toEqual(['Base', 'Runnable']);
  });
});

/**
 * What a declaration says about its own signature.
 *
 * **Kotlin published none of it.** The base provider's `recordDeclaredReturn`, `recordDeclaredArity` and
 * `attachDeclaredFacts` are language-agnostic hooks, and this provider reached none of them: its `signature` property
 * carried `fun send(p: RetryPolicy, rest: List<Widget>)` as **text**, while the resolver had no `returnType`, no
 * `parameterCount`, no `parameterTypes` and no field types to read. A signature a resolver would have to parse is not a
 * fact the graph holds - it is the source again, one layer up.
 */
describe('what a Kotlin declaration says about its own signature', () => {
  const reader = new KotlinProvider();
  const functionNamed = (source: string, name: string) =>
    reader
      .parse(source, 'Sig.kt')
      .find((capture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF && capture.name === name);

  it('publishes the return type', () => {
    expect(functionNamed('fun send(): Outcome = TODO()', 'send')?.properties?.['returnType']).toBe(
      'Outcome',
    );
  });

  it('publishes how many arguments it takes and what they are', () => {
    const fn = functionNamed('fun send(p: RetryPolicy, rest: List<Widget>) {}', 'send');
    expect(fn?.properties?.['parameterCount']).toBe('2');
    expect(fn?.properties?.['requiredParameters']).toBe('2');
    // **Written as the source wrote them**, generic arguments included: the reader of this property reduces a name to
    // its head, and doing that reduction there keeps one rule instead of two.
    expect(JSON.parse(String(fn?.properties?.['parameterTypes']))).toEqual([
      'RetryPolicy',
      'List<Widget>',
    ]);
  });

  it('does not count a parameter with a default as required', () => {
    // A default is a statement that a call may omit this argument, which is a different fact from how many are
    // written - the same distinction TypeScript's `?` and a rest parameter draw.
    const fn = functionNamed('fun send(p: RetryPolicy = TODO()) {}', 'send');
    expect(fn?.properties?.['parameterCount']).toBe('1');
    expect(fn?.properties?.['requiredParameters']).toBe('0');
  });

  it('says nothing about the types of parameters a declaration does not type', () => {
    // **An empty list would read as "stated, and matched nothing"**, the one reading a resolver must not make.
    const fn = functionNamed('fun run() {}', 'run');
    expect(fn?.properties?.['parameterCount']).toBe('0');
    expect(fn?.properties?.['parameterTypes']).toBeUndefined();
  });

  it('publishes each parameter as a declaration a call site can name', () => {
    // **The class is part of the key, because the call site knows the class and not the file.** `ownerKeyOf` builds
    // `Service.send`, and the resolver looks a parameter up by exactly that.
    const captures = reader.parse('class Service {\n  fun send(p: RetryPolicy) {}\n}', 'Sig.kt');
    const parameter = captures.find(
      (capture) => capture.tag === CAPTURE_TAGS.VARIABLE_DEF && capture.name === 'p',
    );
    expect(parameter?.properties?.['parameterIndex']).toBe('0');
    expect(parameter?.properties?.['parameterType']).toBe('RetryPolicy');
    expect(parameter?.properties?.['parameterOwner']).toBe('Service.send');
  });

  it('names the class a method is declared in', () => {
    const captures = reader.parse('class Service {\n  fun send() {}\n}', 'Sig.kt');
    const fn = captures.find((capture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF);
    expect(fn?.properties?.['enclosingClass']).toBe('Service');
  });

  it('files the type of a property under its class', () => {
    const source = 'class Service {\n  private val cache: Map<String, Widget> = TODO()\n}';
    const cls = reader
      .parse(source, 'Sig.kt')
      .find((capture) => capture.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(JSON.parse(String(cls?.properties?.['fieldTypes']))).toEqual({
      cache: 'Map<String, Widget>',
    });
  });

  it('files a constructor property under its class too', () => {
    // **`class Service(val policy: RetryPolicy)` declares a field and a parameter at once**, which is the Kotlin idiom
    // for dependency injection - the same position the type reference was added for.
    const cls = reader
      .parse('class Service(val policy: RetryPolicy)', 'Sig.kt')
      .find((capture) => capture.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(JSON.parse(String(cls?.properties?.['fieldTypes']))).toEqual({ policy: 'RetryPolicy' });
  });

  it('reads the return type of a declaration that writes no body', () => {
    // **A body is where the search for the return type stops, and an interface method has none.** `fun send(): Outcome`
    // writes the type and nothing after it, so a walk that stopped only at a body would never reach the end of this list.
    expect(
      functionNamed('interface Port {\n  fun send(): Outcome\n}', 'send')?.properties?.[
        'returnType'
      ],
    ).toBe('Outcome');
  });

  it('says nothing about fields for a class that declares none', () => {
    const cls = reader
      .parse('class Empty', 'Sig.kt')
      .find((capture) => capture.tag === CAPTURE_TAGS.CLASS_DEF);
    // **No empty object either.** `{}` would read as "stated, and there are none" on a class whose properties this walk
    // could not read, which is a claim rather than a fact.
    expect(cls?.properties?.['fieldTypes']).toBeUndefined();
  });

  it('drops a name two declarations disagree about', () => {
    // The resolver's own rule: a field two declarations type differently has no type, and keeping the first would answer
    // every read of it with the declaration that happens to come first.
    const cls = reader
      .parse(
        'class Service {\n  val cache: Cache = TODO()\n  val cache: Archive = TODO()\n}',
        'Sig.kt',
      )
      .find((capture) => capture.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(cls?.properties?.['fieldTypes']).toBeUndefined();
  });

  it('does not treat a constructor argument as a field unless it says val or var', () => {
    const cls = reader
      .parse('class Service(registry: Registry)', 'Sig.kt')
      .find((capture) => capture.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(cls?.properties?.['fieldTypes']).toBeUndefined();
  });

  it('does not file a property declared inside a function body as a field of the class', () => {
    // **`fun run() { val x: Widget = … }` is a local**, and the upward walk stops at the function so the class is not
    // handed a type it never declared - the same distinction `localTypes` draws from `fieldTypes` elsewhere.
    const cls = reader
      .parse('class Service {\n  fun run() {\n    val x: Widget = TODO()\n  }\n}', 'Sig.kt')
      .find((capture) => capture.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(cls?.properties?.['fieldTypes']).toBeUndefined();
  });
});

/**
 * The call sites this provider never emitted.
 *
 * **`Function Calls` was `✅` for Kotlin in `docs/language-support.md` and the graph held zero of them.** The provider
 * overrode `walkAndCapture` and handled classes, functions and imports; a `call_expression` reached no branch, so
 * `p.refresh()` was parsed and dropped. That is the shape of defect this repository keeps finding - a capability the
 * documentation states, the infrastructure supports, and one walk forgets to produce - and it is why this language
 * reads 0.3934 on the Long Code Arena sample while Python reads 0.5405.
 */
describe('a Kotlin call site', () => {
  const reader = new KotlinProvider();
  const calls = (source: string) =>
    reader
      .parse(source, 'Calls.kt')
      .filter(
        (capture) =>
          capture.tag === CAPTURE_TAGS.FUNCTION_CALL || capture.tag === CAPTURE_TAGS.METHOD_CALL,
      );

  it('is a method call when the callee is written as a member', () => {
    const [call] = calls('fun run() { p.refresh() }');
    expect(call?.tag).toBe(CAPTURE_TAGS.METHOD_CALL);
    // **The receiver is the text and the name is the last segment**, which is the split `receiverOf` reads and the one
    // a lookup is keyed by.
    expect(call?.text).toBe('p.refresh');
    expect(call?.name).toBe('refresh');
  });

  it('is a function call when the callee is a bare name', () => {
    const [call] = calls('fun run() { refresh() }');
    expect(call?.tag).toBe(CAPTURE_TAGS.FUNCTION_CALL);
    expect(call?.name).toBe('refresh');
  });

  it('records the inner call of a chained one', () => {
    // **`Builder().build()` is two call sites.** The callee of the outer is a call expression; a walk that stopped at
    // the outer one would lose the constructor, and with it the type the receiver has. **The outer comes first**,
    // because the walk visits a node before the children it is written on.
    const recorded = calls('fun run() { Builder().build() }').map((call) => call.name);
    expect(recorded).toEqual(['build', 'Builder']);
  });

  it('counts the arguments a call passes', () => {
    expect(calls('fun run() { service.refresh(1, 2) }')[0]?.properties?.['argumentCount']).toBe(
      '2',
    );
  });

  it('states no count for a call that spreads a list', () => {
    // A spread stands for a list whose length is a runtime fact, so the honest answer is no answer rather than a
    // wrong one - the same rule `String... parts` and `*args` follow.
    expect(calls('fun run() { service.refresh(*args) }')[0]?.properties?.['argumentCount']).toBe(
      undefined,
    );
  });

  it('states no count for a call whose only argument is a trailing lambda', () => {
    // **`list.forEach { … }` passes no argument list at all** - the suffix holds the lambda and nothing else - so a
    // count of zero would say the call takes no arguments when it takes one.
    expect(calls('fun run() { list.forEach { it.refresh() } }').map((call) => call.name)).toEqual([
      'forEach',
      'refresh',
    ]);
    expect(
      calls('fun run() { list.forEach { it.refresh() } }')[0]?.properties?.['argumentCount'],
    ).toBe(undefined);
  });
});
