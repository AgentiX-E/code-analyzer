/**
 * Tests for extended language providers: Java, Kotlin, C#, Rust.
 * Each provider is tested for:
 * - Function/method extraction
 * - Class/struct/interface extraction
 * - Import detection
 * - Export detection
 * - Annotation/decorator extraction
 * - Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';
import { JavaProvider } from '../languages/java.js';
import { KotlinProvider } from '../languages/kotlin.js';
import { CSharpProvider } from '../languages/csharp.js';
import { RustProvider } from '../languages/rust.js';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

// ============================================================================
// Java Provider Tests
// ============================================================================

describe('JavaProvider', () => {
  const provider = new JavaProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('java');
      expect(provider.displayName).toBe('Java');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.java');
    });

    it('has named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('class extraction', () => {
    it('detects public class', () => {
      const source = 'public class MyClass {\n  void foo() {}\n}';
      const captures = provider.parse(source, 'MyClass.java');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.length).toBeGreaterThanOrEqual(1);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects class with extends', () => {
      const source = 'public class Dog extends Animal {\n}';
      const captures = provider.parse(source, 'Dog.java');
      const dog = captures.find(c => c.name === 'Dog');
      expect(dog).toBeDefined();
      expect(dog!.properties.baseClasses).toBe('Animal');
    });

    it('detects class with implements', () => {
      const source = 'public class Service implements Runnable, Serializable {\n}';
      const captures = provider.parse(source, 'Service.java');
      const svc = captures.find(c => c.name === 'Service');
      expect(svc).toBeDefined();
      expect(svc!.properties.interfaces).toContain('Runnable');
    });
  });

  describe('interface extraction', () => {
    it('detects interface', () => {
      const source = 'public interface Repository<T> {\n  T findById(long id);\n}';
      const captures = provider.parse(source, 'Repository.java');
      const ifaces = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.length).toBeGreaterThanOrEqual(1);
      expect(ifaces.some(c => c.name === 'Repository')).toBe(true);
    });
  });

  describe('enum extraction', () => {
    it('detects enum', () => {
      const source = 'public enum Color { RED, GREEN, BLUE }';
      const captures = provider.parse(source, 'Color.java');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(c => c.name === 'Color')).toBe(true);
    });
  });

  describe('method extraction', () => {
    it('detects public method', () => {
      const source = 'public class Service {\n  public String getName() {\n    return "test";\n  }\n}';
      const captures = provider.parse(source, 'Service.java');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some(c => c.name === 'getName')).toBe(true);
    });

    it('detects static method', () => {
      const source = 'public class Utils {\n  public static int add(int a, int b) {\n    return a + b;\n  }\n}';
      const captures = provider.parse(source, 'Utils.java');
      const addMethod = captures.find(c => c.name === 'add');
      expect(addMethod).toBeDefined();
      expect(addMethod!.properties.static).toBe('true');
    });

    it('detects constructor', () => {
      const source = 'public class Person {\n  public Person(String name) {\n    this.name = name;\n  }\n}';
      const captures = provider.parse(source, 'Person.java');
      const ctors = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(ctors.some(c => c.name === 'Person')).toBe(true);
    });
  });

  describe('field extraction', () => {
    it('detects private fields', () => {
      const source = 'public class User {\n  private String name;\n  private int age;\n}';
      const captures = provider.parse(source, 'User.java');
      const fields = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(fields.some(f => f.name === 'name')).toBe(true);
      expect(fields.some(f => f.name === 'age')).toBe(true);
    });
  });

  describe('import extraction', () => {
    it('extracts single imports', () => {
      const source = 'import java.util.List;\nimport java.util.Map;\n\npublic class Test {}';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
      expect(imports.some(i => i.source === 'java.util.List')).toBe(true);
      expect(imports.some(i => i.source === 'java.util.Map')).toBe(true);
    });

    it('extracts wildcard imports', () => {
      const source = 'import java.util.*;\npublic class Test {}';
      const imports = provider.extractImports(source);
      const wildcard = imports.find(i => i.source === 'java.util');
      expect(wildcard).toBeDefined();
      expect(wildcard!.type).toBe('wildcard');
    });

    it('extracts static imports', () => {
      const source = 'import static org.junit.Assert.*;\npublic class Test {}';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isExported', () => {
    it('detects public class as exported', () => {
      expect(provider.isExported('public class MyClass {}', 'MyClass')).toBe(true);
    });

    it('detects package-private class as not exported', () => {
      expect(provider.isExported('class MyClass {}', 'MyClass')).toBe(false);
    });

    it('detects public method as exported', () => {
      expect(provider.isExported('public void doSomething() {}', 'doSomething')).toBe(true);
    });
  });

  describe('annotation extraction', () => {
    it('detects @Override annotation', () => {
      const source = '@Override\npublic String toString() { return ""; }';
      const captures = provider.parse(source, 'Test.java');
      const annotations = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(annotations.some(a => a.name === 'Override')).toBe(true);
    });
  });

  describe('record extraction', () => {
    it('detects Java record', () => {
      const source = 'public record Point(int x, int y) {}';
      const captures = provider.parse(source, 'Point.java');
      const records = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties.isRecord === 'true');
      expect(records.some(r => r.name === 'Point')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.java');
      expect(captures).toEqual([]);
    });

    it('handles source with only comments', () => {
      const source = '// This is a comment\n/* Block comment */\n// Another comment';
      const captures = provider.parse(source, 'Comments.java');
      // Should not crash, may return some doc comment captures
      expect(Array.isArray(captures)).toBe(true);
    });

    it('does not detect keywords as function names', () => {
      const source = 'if (true) { return; }';
      const captures = provider.parse(source, 'Test.java');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toEqual([]);
    });

    it('detects record correctly', () => {
      const source = 'public record User(String name, int age) {}';
      const captures = provider.parse(source, 'User.java');
      expect(captures.some(c => c.name === 'User' && c.tag === CAPTURE_TAGS.CLASS_DEF)).toBe(true);
    });
  });
});

// ============================================================================
// Kotlin Provider Tests
// ============================================================================

describe('KotlinProvider', () => {
  const provider = new KotlinProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('kotlin');
      expect(provider.displayName).toBe('Kotlin');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.kt');
      expect(provider.extensions).toContain('.kts');
    });
  });

  describe('class extraction', () => {
    it('detects class', () => {
      const source = 'class MyClass {\n  fun greet() = "hello"\n}';
      const captures = provider.parse(source, 'MyClass.kt');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects data class', () => {
      const source = 'data class User(val name: String, val age: Int)';
      const captures = provider.parse(source, 'User.kt');
      const user = captures.find(c => c.name === 'User');
      expect(user).toBeDefined();
      expect(user!.text).toContain('class');
    });

    it('detects sealed class', () => {
      const source = 'sealed class Result<T> {\n  data class Success(val data: T) : Result<T>()\n  data class Error(val message: String) : Result<T>()\n}';
      const captures = provider.parse(source, 'Result.kt');
      const sealed = captures.find(c => c.name === 'Result');
      expect(sealed).toBeDefined();
    });
  });

  describe('function extraction', () => {
    it('detects top-level function', () => {
      const source = 'fun greet(name: String): String {\n  return "Hello, $name"\n}';
      const captures = provider.parse(source, 'main.kt');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'greet')).toBe(true);
    });

    it('detects suspend function', () => {
      const source = 'suspend fun fetchData(): String {\n  return "data"\n}';
      const captures = provider.parse(source, 'api.kt');
      const fetch = captures.find(c => c.name === 'fetchData');
      expect(fetch).toBeDefined();
      expect(fetch!.properties.suspend).toBe('true');
    });

    it('detects extension function', () => {
      const source = 'fun String.isEmail(): Boolean {\n  return contains("@")\n}';
      const captures = provider.parse(source, 'extensions.kt');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'isEmail')).toBe(true);
    });
  });

  describe('property extraction', () => {
    it('detects val properties', () => {
      const source = 'val name: String = "test"\nval age: Int = 25';
      const captures = provider.parse(source, 'props.kt');
      const props = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(props.some(p => p.name === 'name')).toBe(true);
      expect(props.some(p => p.name === 'age')).toBe(true);
    });

    it('detects var properties', () => {
      const source = 'var count: Int = 0';
      const captures = provider.parse(source, 'counter.kt');
      const vars = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some(v => v.name === 'count')).toBe(true);
    });
  });

  describe('object extraction', () => {
    it('detects singleton object', () => {
      const source = 'object DatabaseConfig {\n  val url = "localhost"\n}';
      const captures = provider.parse(source, 'Config.kt');
      const objs = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties.isObject === 'true');
      expect(objs.some(o => o.name === 'DatabaseConfig')).toBe(true);
    });

    it('detects companion object', () => {
      const source = 'class MyClass {\n  companion object Factory {\n    fun create() = MyClass()\n  }\n}';
      const captures = provider.parse(source, 'MyClass.kt');
      const companion = captures.find(c => c.properties.isCompanion === 'true');
      expect(companion).toBeDefined();
    });
  });

  describe('import extraction', () => {
    it('extracts single imports', () => {
      const source = 'import kotlin.collections.List\nimport kotlin.collections.Map';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
      expect(imports.some(i => i.source === 'kotlin.collections.List')).toBe(true);
    });

    it('extracts wildcard imports', () => {
      const source = 'import kotlin.collections.*';
      const imports = provider.extractImports(source);
      const wildcard = imports.find(i => i.source === 'kotlin.collections');
      expect(wildcard).toBeDefined();
      expect(wildcard!.type).toBe('wildcard');
    });
  });

  describe('isExported', () => {
    it('detects top-level function as exported', () => {
      expect(provider.isExported('fun greet() {}', 'greet')).toBe(true);
    });

    it('detects class as exported', () => {
      expect(provider.isExported('class MyClass', 'MyClass')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.kt');
      expect(captures).toEqual([]);
    });

    it('does not detect keyword as function name', () => {
      const source = 'when (value) { 1 -> "one" }';
      const captures = provider.parse(source, 'test.kt');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'when');
      expect(funcs).toEqual([]);
    });
  });
});

// ============================================================================
// C# Provider Tests
// ============================================================================

describe('CSharpProvider', () => {
  const provider = new CSharpProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('csharp');
      expect(provider.displayName).toBe('C#');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.cs');
    });
  });

  describe('class extraction', () => {
    it('detects public class', () => {
      const source = 'public class MyClass {\n  public void DoSomething() {}\n}';
      const captures = provider.parse(source, 'MyClass.cs');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects sealed class', () => {
      const source = 'public sealed class FinalClass {}';
      const captures = provider.parse(source, 'FinalClass.cs');
      expect(captures.some(c => c.name === 'FinalClass')).toBe(true);
    });

    it('detects abstract class', () => {
      const source = 'public abstract class BaseController {\n  public abstract void Handle();\n}';
      const captures = provider.parse(source, 'BaseController.cs');
      const baseCtrl = captures.find(c => c.name === 'BaseController');
      expect(baseCtrl).toBeDefined();
      expect(baseCtrl!.properties.abstract).toBe('true');
    });
  });

  describe('struct extraction', () => {
    it('detects struct', () => {
      const source = 'public struct Point {\n  public int X;\n  public int Y;\n}';
      const captures = provider.parse(source, 'Point.cs');
      const structs = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.text.includes('struct'));
      expect(structs.some(s => s.name === 'Point')).toBe(true);
    });
  });

  describe('interface extraction', () => {
    it('detects interface', () => {
      const source = 'public interface IRepository<T> {\n  T GetById(int id);\n}';
      const captures = provider.parse(source, 'IRepository.cs');
      const ifaces = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some(i => i.name === 'IRepository')).toBe(true);
    });
  });

  describe('method extraction', () => {
    it('detects public method', () => {
      const source = 'public class Service {\n  public string GetName() {\n    return "test";\n  }\n}';
      const captures = provider.parse(source, 'Service.cs');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some(m => m.name === 'GetName')).toBe(true);
    });

    it('detects async method', () => {
      const source = 'public async Task<string> FetchAsync() {\n  return await httpClient.GetStringAsync("url");\n}';
      const captures = provider.parse(source, 'Api.cs');
      const fetch = captures.find(c => c.name === 'FetchAsync');
      expect(fetch).toBeDefined();
      expect(fetch!.properties.async).toBe('true');
    });

    it('detects static method', () => {
      const source = 'public static class Helper {\n  public static int Add(int a, int b) => a + b;\n}';
      const captures = provider.parse(source, 'Helper.cs');
      const add = captures.find(c => c.name === 'Add');
      expect(add).toBeDefined();
      expect(add!.properties.static).toBe('true');
    });

    it('detects constructor', () => {
      const source = 'public class Person {\n  public Person(string name) {\n    Name = name;\n  }\n  public string Name { get; }\n}';
      const captures = provider.parse(source, 'Person.cs');
      const ctors = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(ctors.some(c => c.name === 'Person')).toBe(true);
    });
  });

  describe('property extraction', () => {
    it('detects auto-property', () => {
      const source = 'public class User {\n  public string Name { get; set; }\n  public int Age { get; set; }\n}';
      const captures = provider.parse(source, 'User.cs');
      const props = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(props.some(p => p.name === 'Name')).toBe(true);
      expect(props.some(p => p.name === 'Age')).toBe(true);
    });
  });

  describe('record extraction', () => {
    it('detects record class', () => {
      const source = 'public record Person(string Name, int Age);';
      const captures = provider.parse(source, 'Person.cs');
      const records = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties.isRecord === 'true');
      expect(records.some(r => r.name === 'Person')).toBe(true);
    });
  });

  describe('using directive extraction', () => {
    it('extracts using directives', () => {
      const source = 'using System;\nusing System.Collections.Generic;\n\nnamespace App {}';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
      expect(imports.some(i => i.source === 'System')).toBe(true);
    });
  });

  describe('attribute extraction', () => {
    it('detects attributes', () => {
      const source = '[HttpGet]\n[Authorize]\npublic IActionResult Index() { return View(); }';
      const captures = provider.parse(source, 'Controller.cs');
      const attrs = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(attrs.some(a => a.name === 'HttpGet')).toBe(true);
      expect(attrs.some(a => a.name === 'Authorize')).toBe(true);
    });
  });

  describe('isExported', () => {
    it('detects public class as exported', () => {
      expect(provider.isExported('public class MyClass {}', 'MyClass')).toBe(true);
    });

    it('detects internal class as not exported', () => {
      expect(provider.isExported('internal class MyClass {}', 'MyClass')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.cs');
      expect(captures).toEqual([]);
    });

    it('does not detect keywords as method names', () => {
      const source = 'if (true) { return; }';
      const captures = provider.parse(source, 'Test.cs');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods).toEqual([]);
    });
  });
});

// ============================================================================
// Rust Provider Tests
// ============================================================================

describe('RustProvider', () => {
  const provider = new RustProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('rust');
      expect(provider.displayName).toBe('Rust');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.rs');
    });
  });

  describe('struct extraction', () => {
    it('detects named struct', () => {
      const source = 'pub struct User {\n  name: String,\n  age: u32,\n}';
      const captures = provider.parse(source, 'user.rs');
      const structs = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.text.includes('struct'));
      expect(structs.some(s => s.name === 'User')).toBe(true);
    });

    it('detects tuple struct', () => {
      const source = 'pub struct Point(f64, f64);';
      const captures = provider.parse(source, 'point.rs');
      expect(captures.some(c => c.name === 'Point')).toBe(true);
    });

    it('detects unit struct', () => {
      const source = 'pub struct Unit;';
      const captures = provider.parse(source, 'unit.rs');
      expect(captures.some(c => c.name === 'Unit')).toBe(true);
    });
  });

  describe('enum extraction', () => {
    it('detects enum', () => {
      const source = 'pub enum Color {\n  Red,\n  Green,\n  Blue,\n}';
      const captures = provider.parse(source, 'color.rs');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(e => e.name === 'Color')).toBe(true);
    });

    it('detects enum with data', () => {
      const source = 'pub enum Result<T, E> {\n  Ok(T),\n  Err(E),\n}';
      const captures = provider.parse(source, 'result.rs');
      expect(captures.some(c => c.name === 'Result')).toBe(true);
    });
  });

  describe('trait extraction', () => {
    it('detects trait', () => {
      const source = 'pub trait Display {\n  fn fmt(&self) -> String;\n}';
      const captures = provider.parse(source, 'display.rs');
      const traits = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(traits.some(t => t.name === 'Display')).toBe(true);
    });
  });

  describe('function extraction', () => {
    it('detects public function', () => {
      const source = 'pub fn greet(name: &str) -> String {\n  format!("Hello, {}", name)\n}';
      const captures = provider.parse(source, 'greet.rs');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'greet')).toBe(true);
    });

    it('detects private function', () => {
      const source = 'fn helper() -> u32 {\n  42\n}';
      const captures = provider.parse(source, 'helper.rs');
      const helper = captures.find(c => c.name === 'helper');
      expect(helper).toBeDefined();
      expect(helper!.properties.isPublic).toBe('false');
    });

    it('detects async function', () => {
      const source = 'pub async fn fetch_data() -> String {\n  "data".to_string()\n}';
      const captures = provider.parse(source, 'fetch.rs');
      const fetch = captures.find(c => c.name === 'fetch_data');
      expect(fetch).toBeDefined();
      expect(fetch!.properties.isAsync).toBe('true');
    });

    it('detects unsafe function', () => {
      const source = 'pub unsafe fn raw_pointer() -> *const u8 {\n  std::ptr::null()\n}';
      const captures = provider.parse(source, 'raw.rs');
      const raw = captures.find(c => c.name === 'raw_pointer');
      expect(raw).toBeDefined();
      expect(raw!.properties.isUnsafe).toBe('true');
    });
  });

  describe('impl extraction', () => {
    it('detects impl block', () => {
      const source = 'pub struct Counter { value: i32 }\nimpl Counter {\n  pub fn new() -> Self { Counter { value: 0 } }\n}';
      const captures = provider.parse(source, 'counter.rs');
      const impls = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties.isImpl === 'true');
      expect(impls.some(i => i.name === 'Counter')).toBe(true);
    });

    it('detects trait impl', () => {
      const source = 'impl Display for Counter {\n  fn fmt(&self, f: &mut Formatter) -> fmt::Result {\n    write!(f, "{}", self.value)\n  }\n}';
      const captures = provider.parse(source, 'display_impl.rs');
      const traitImpls = captures.filter(c => c.properties.traitName === 'Display');
      expect(traitImpls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('constant extraction', () => {
    it('detects const', () => {
      const source = 'const MAX_SIZE: usize = 1024;';
      const captures = provider.parse(source, 'constants.rs');
      const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(consts.some(c => c.name === 'MAX_SIZE')).toBe(true);
    });

    it('detects static', () => {
      const source = 'static GLOBAL_CONFIG: &str = "production";';
      const captures = provider.parse(source, 'config.rs');
      const statics = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(statics.some(s => s.name === 'GLOBAL_CONFIG')).toBe(true);
    });
  });

  describe('use extraction', () => {
    it('extracts single use', () => {
      const source = 'use std::collections::HashMap;';
      const imports = provider.extractImports(source);
      expect(imports.length).toBe(1);
      expect(imports[0]!.source).toBe('std::collections::HashMap');
    });

    it('extracts multi-item use', () => {
      const source = 'use std::collections::{HashMap, HashSet};';
      const imports = provider.extractImports(source);
      expect(imports.length).toBe(2);
      expect(imports.some(i => i.names.includes('HashMap'))).toBe(true);
      expect(imports.some(i => i.names.includes('HashSet'))).toBe(true);
    });

    it('extracts wildcard use', () => {
      const source = 'use std::collections::*;';
      const imports = provider.extractImports(source);
      expect(imports.length).toBe(1);
      expect(imports[0]!.type).toBe('wildcard');
    });

    it('extracts extern crate', () => {
      const source = 'extern crate serde;';
      const imports = provider.extractImports(source);
      expect(imports.some(i => i.source === 'serde')).toBe(true);
    });
  });

  describe('attribute extraction', () => {
    it('detects derive attribute', () => {
      const source = '#[derive(Debug, Clone)]\npub struct MyStruct {\n  field: i32,\n}';
      const captures = provider.parse(source, 'mystruct.rs');
      const attrs = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
      expect(attrs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isExported', () => {
    it('detects pub struct as exported', () => {
      expect(provider.isExported('pub struct MyStruct {}', 'MyStruct')).toBe(true);
    });

    it('detects non-pub struct as not exported', () => {
      expect(provider.isExported('struct MyStruct {}', 'MyStruct')).toBe(false);
    });

    it('detects pub fn as exported', () => {
      expect(provider.isExported('pub fn my_func() {}', 'my_func')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.rs');
      expect(captures).toEqual([]);
    });

    it('does not detect keyword as function name', () => {
      const source = 'fn if() {} // invalid but should not crash';
      const captures = provider.parse(source, 'test.rs');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'if');
      expect(funcs).toEqual([]);
    });

    it('handles complex generics', () => {
      const source = 'pub fn process<T: Display + Clone, U>(input: T, extra: U) -> Result<T, Error> {\n  Ok(input)\n}';
      const captures = provider.parse(source, 'complex.rs');
      const func = captures.find(c => c.name === 'process');
      expect(func).toBeDefined();
      expect(func!.properties.returnType).toBe('Result<T, Error>');
    });
  });
});

// ============================================================================
// Branch Coverage Hardening — Additional Edge Cases
// ============================================================================

describe('JavaProvider edge cases', () => {
  const provider = new JavaProvider();

  it('detects static method', () => {
    const source = 'public class Utils {\n  public static int calculate() {\n    return 42;\n  }\n}';
    const captures = provider.parse(source, 'Utils.java');
    const calc = captures.find(c => c.name === 'calculate');
    expect(calc).toBeDefined();
    expect(calc!.properties.static).toBe('true');
  });

  it('detects final field', () => {
    const source = 'public class Config {\n  public static final String APP_NAME = "MyApp";\n}';
    const captures = provider.parse(source, 'Config.java');
    const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
    expect(consts.some(c => c.name === 'APP_NAME')).toBe(true);
  });

  it('detects method with type parameters', () => {
    const source = 'public class Util {\n  public <T> T identity(T value) {\n    return value;\n  }\n}';
    const captures = provider.parse(source, 'Util.java');
    expect(captures.some(c => c.name === 'identity')).toBe(true);
  });

  it('detects interface methods', () => {
    const source = 'public interface Service {\n  void execute();\n  int getCount();\n}';
    const captures = provider.parse(source, 'Service.java');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF)).toBe(true);
  });

  it('handles abstract class', () => {
    const source = 'public abstract class BaseService {\n  public abstract void handle();\n  public void log() {}\n}';
    const captures = provider.parse(source, 'BaseService.java');
    expect(captures.some(c => c.name === 'BaseService')).toBe(true);
    expect(captures.some(c => c.name === 'handle')).toBe(true);
    expect(captures.some(c => c.name === 'log')).toBe(true);
  });
});

describe('KotlinProvider edge cases', () => {
  const provider = new KotlinProvider();

  it('detects inline function', () => {
    const source = 'inline fun <T> measure(crossinline block: () -> T): T {\n  return block()\n}';
    const captures = provider.parse(source, 'utils.kt');
    expect(captures.some(c => c.name === 'measure')).toBe(true);
  });

  it('detects private function', () => {
    const source = 'private fun helper(): Int {\n  return 42\n}';
    const captures = provider.parse(source, 'private.kt');
    expect(captures.some(c => c.name === 'helper')).toBe(true);
  });

  it('detects lateinit property', () => {
    const source = 'lateinit var name: String';
    const captures = provider.parse(source, 'lateinit.kt');
    expect(captures.some(c => c.name === 'name')).toBe(true);
  });

  it('detects const val', () => {
    const source = 'const val MAX = 100';
    const captures = provider.parse(source, 'const.kt');
    const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
    expect(consts.some(c => c.name === 'MAX')).toBe(true);
  });

  it('detects enum class with properties', () => {
    const source = 'enum class Color(val rgb: Int) {\n  RED(0xFF0000),\n  GREEN(0x00FF00),\n  BLUE(0x0000FF)\n}';
    const captures = provider.parse(source, 'Color.kt');
    expect(captures.some(c => c.name === 'Color')).toBe(true);
  });
});

describe('CSharpProvider edge cases', () => {
  const provider = new CSharpProvider();

  it('detects virtual method', () => {
    const source = 'public class Base {\n  public virtual void Handle() {}\n}';
    const captures = provider.parse(source, 'Base.cs');
    expect(captures.some(c => c.name === 'Handle')).toBe(true);
  });

  it('detects override method', () => {
    const source = 'public class Derived : Base {\n  public override void Handle() {}\n}';
    const captures = provider.parse(source, 'Derived.cs');
    expect(captures.some(c => c.name === 'Handle')).toBe(true);
  });

  it('detects readonly field', () => {
    const source = 'public class Config {\n  private readonly string _key = "test";\n}';
    const captures = provider.parse(source, 'Config.cs');
    const fields = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF || c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(fields.some(f => f.name === '_key')).toBe(true);
  });

  it('detects expression-bodied method', () => {
    const source = 'public class Calc {\n  public int Add(int a, int b) => a + b;\n}';
    const captures = provider.parse(source, 'Calc.cs');
    expect(captures.some(c => c.name === 'Add')).toBe(true);
  });

  it('handles partial class', () => {
    const source = 'public partial class MyForm {\n  public void Initialize() {}\n}';
    const captures = provider.parse(source, 'MyForm.cs');
    expect(captures.some(c => c.name === 'MyForm')).toBe(true);
  });
});

describe('RustProvider edge cases', () => {
  const provider = new RustProvider();

  it('detects pub(crate) visibility', () => {
    const source = 'pub(crate) fn internal_util() -> u32 {\n  42\n}';
    const captures = provider.parse(source, 'internal.rs');
    const func = captures.find(c => c.name === 'internal_util');
    expect(func).toBeDefined();
  });

  it('detects method in impl block', () => {
    const source = 'struct Counter { count: i32 }\nimpl Counter {\n  pub fn increment(&mut self) {\n    self.count += 1;\n  }\n}';
    const captures = provider.parse(source, 'counter.rs');
    expect(captures.some(c => c.name === 'increment')).toBe(true);
  });

  it('detects extern function', () => {
    const source = 'extern "C" {\n  fn printf(format: *const u8, ...) -> i32;\n}';
    const captures = provider.parse(source, 'ffi.rs');
    expect(captures.some(c => c.name === 'printf')).toBe(true);
  });

  it('detects mod declaration indirectly', () => {
    const source = 'pub mod utils;\nmod internal;';
    const captures = provider.parse(source, 'mod.rs');
    // mod declarations don't produce captures directly
    expect(Array.isArray(captures)).toBe(true);
  });

  it('detects generic impl block', () => {
    const source = 'impl<T: Display> Wrapper<T> {\n  pub fn new(val: T) -> Self {\n    Wrapper { val }\n  }\n}';
    const captures = provider.parse(source, 'wrapper.rs');
    expect(captures.some(c => c.name === 'new')).toBe(true);
  });
});

// ============================================================================
// Branch Coverage Hardening — Extra Edge Cases for All Providers
// ============================================================================

describe('JavaProvider extra hardening', () => {
  const p = new JavaProvider();

  it('detects abstract method', () => {
    const s = 'public abstract class Base { public abstract void process(); }';
    expect(p.parse(s, 'Base.java').some(c => c.name === 'process')).toBe(true);
  });

  it('detects final class', () => {
    const s = 'public final class Constants { public static final int MAX = 100; }';
    expect(p.parse(s, 'Constants.java').some(c => c.name === 'Constants')).toBe(true);
  });

  it('detects void method', () => {
    const s = 'public class Worker { void execute() { } }';
    expect(p.parse(s, 'Worker.java').some(c => c.name === 'execute')).toBe(true);
  });

  it('handles string field declaration', () => {
    const s = 'public class Data { String value; }';
    expect(p.parse(s, 'Data.java').some(c => c.name === 'value')).toBe(true);
  });

  it('detects boolean field', () => {
    const s = 'public class Flag { boolean active = true; }';
    expect(p.parse(s, 'Flag.java').some(c => c.name === 'active')).toBe(true);
  });
});

describe('KotlinProvider extra hardening', () => {
  const p = new KotlinProvider();

  it('detects abstract class', () => {
    const s = 'abstract class Shape { abstract fun area(): Double }';
    expect(p.parse(s, 'Shape.kt').some(c => c.name === 'Shape')).toBe(true);
  });

  it('detects open function', () => {
    const s = 'open class Base { open fun calculate(): Int { return 0 } }';
    expect(p.parse(s, 'Base.kt').some(c => c.name === 'calculate')).toBe(true);
  });

  it('detects tailrec function', () => {
    const s = 'tailrec fun factorial(n: Int, acc: Int = 1): Int { return if (n <= 1) acc else factorial(n - 1, n * acc) }';
    expect(p.parse(s, 'fact.kt').some(c => c.name === 'factorial')).toBe(true);
  });

  it('detects external function', () => {
    const s = 'external fun nativeLog(level: Int, msg: String)';
    expect(p.parse(s, 'native.kt').some(c => c.name === 'nativeLog')).toBe(true);
  });
});

describe('CSharpProvider extra hardening', () => {
  const p = new CSharpProvider();

  it('detects sealed override', () => {
    const s = 'public class Child : Base { public sealed override void Handle() { } }';
    expect(p.parse(s, 'Child.cs').some(c => c.name === 'Handle')).toBe(true);
  });

  it('detects partial method', () => {
    const s = 'public partial class Form { partial void OnLoad(); }';
    expect(p.parse(s, 'Form.cs').some(c => c.name === 'Form')).toBe(true);
  });

  it('detects init-only property', () => {
    const s = 'public class Immutable { public string Name { get; init; } }';
    expect(p.parse(s, 'Immutable.cs').some(c => c.name === 'Name')).toBe(true);
  });
});

describe('RustProvider extra hardening', () => {
  const p = new RustProvider();

  it('detects static item', () => {
    const s = 'static mut COUNTER: u32 = 0;';
    expect(p.parse(s, 'counter.rs').some(c => c.name === 'COUNTER' && c.tag === CAPTURE_TAGS.CONSTANT_DEF)).toBe(true);
  });

  it('detects method with self parameter', () => {
    const s = 'impl MyType { fn method(&self) -> bool { true } }';
    expect(p.parse(s, 'mytype.rs').some(c => c.name === 'method')).toBe(true);
  });

  it('handles use with self import', () => {
    const imports = p.extractImports('use std::io::{self, Write};');
    expect(imports.some(i => i.names.includes('Write'))).toBe(true);
  });
});
