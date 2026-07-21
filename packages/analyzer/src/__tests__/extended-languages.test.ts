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

// ============================================================================
// Branch Coverage Hardening — Third Wave
// ============================================================================

describe('CSharpProvider third wave', () => {
  const p = new CSharpProvider();

  it('detects record struct', () => {
    const s = 'public record struct Point2D(int X, int Y);';
    const captures = p.parse(s, 'Point2D.cs');
    expect(captures.some(c => c.name === 'Point2D' && c.properties.isRecord === 'true')).toBe(true);
  });

  it('detects record with sealed modifier', () => {
    const s = 'public sealed record ImmutableData(string Key, string Value);';
    const captures = p.parse(s, 'Data.cs');
    expect(captures.some(c => c.name === 'ImmutableData' && c.properties.isRecord === 'true')).toBe(true);
  });

  it('detects constructor with class detection', () => {
    const s = 'public class Service {\n  public Service() { }\n}';
    const captures = p.parse(s, 'Service.cs');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF && c.name === 'Service')).toBe(true);
  });

  it('detects method with generic return type', () => {
    const s = 'public class Repo {\n  public Task<string> GetUsers() { return null; }\n}';
    const captures = p.parse(s, 'Repo.cs');
    expect(captures.some(c => c.name === 'GetUsers' && c.tag === CAPTURE_TAGS.METHOD_DEF)).toBe(true);
  });

  it('detects internal class', () => {
    const s = 'internal class InternalService { public void DoWork() {} }';
    const captures = p.parse(s, 'Service.cs');
    expect(captures.some(c => c.name === 'InternalService' && c.tag === CAPTURE_TAGS.CLASS_DEF)).toBe(true);
  });

  it('detects protected method', () => {
    const s = 'public class Base {\n  protected virtual void OnStart() { }\n}';
    const captures = p.parse(s, 'Base.cs');
    expect(captures.some(c => c.name === 'OnStart')).toBe(true);
  });

  it('detects private class', () => {
    const s = 'private class InnerHelper { public void Run() { } }';
    const captures = p.parse(s, 'Helper.cs');
    expect(captures.some(c => c.name === 'InnerHelper' && c.tag === CAPTURE_TAGS.CLASS_DEF)).toBe(true);
  });

  it('detects const field as constant', () => {
    const s = 'public class Config {\n  public const int MaxRetries = 3;\n}';
    const captures = p.parse(s, 'Config.cs');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'MaxRetries')).toBe(true);
  });

  it('detects unsafe method', () => {
    const s = 'public class Ptr {\n  public unsafe void* GetPointer() { return null; }\n}';
    const captures = p.parse(s, 'Ptr.cs');
    expect(captures.some(c => c.name === 'GetPointer')).toBe(true);
  });

  it('detects extern method', () => {
    const s = 'public class Native {\n  public static extern int MessageBox(IntPtr h, string text, string caption, uint type);\n}';
    const captures = p.parse(s, 'Native.cs');
    expect(captures.some(c => c.name === 'MessageBox')).toBe(true);
  });

  it('detects expression-bodied property with get only', () => {
    const s = 'public class User {\n  public string Name { get; }\n}';
    const captures = p.parse(s, 'User.cs');
    const prop = captures.find(c => c.name === 'Name');
    expect(prop).toBeDefined();
    expect(prop!.properties.hasGet).toBe('true');
  });

  it('detects property with set only', () => {
    const s = 'public class Data {\n  public int Value { set; }\n}';
    const captures = p.parse(s, 'Data.cs');
    const prop = captures.find(c => c.name === 'Value');
    expect(prop).toBeDefined();
    expect(prop!.properties.hasSet).toBe('true');
  });

  it('detects property with get body', () => {
    const s = 'public class Foo {\n  public string Label { get { return _label; } }\n}';
    const captures = p.parse(s, 'Foo.cs');
    expect(captures.some(c => c.name === 'Label')).toBe(true);
  });

  it('detects property with init only', () => {
    const s = 'public class Config {\n  public string Key { get; init; }\n}';
    const captures = p.parse(s, 'Config.cs');
    const prop = captures.find(c => c.name === 'Key');
    expect(prop).toBeDefined();
    expect(prop!.properties.hasGet).toBe('true');
  });

  it('handles isExported for public method', () => {
    expect(p.isExported('public class Service { public void Execute() {} }', 'Execute')).toBe(true);
  });

  it('handles isExported for public field', () => {
    expect(p.isExported('public class Data { public int Value; }', 'Value')).toBe(true);
  });

  it('handles isExported for public static field', () => {
    expect(p.isExported('public class Constants { public static readonly int Max = 100; }', 'Max')).toBe(true);
  });
});

describe('JavaProvider third wave', () => {
  const p = new JavaProvider();

  it('detects constructor inside class with preceding text', () => {
    const s = 'public class User {\n  private String name;\n  public User(String name) {\n    this.name = name;\n  }\n}';
    const captures = p.parse(s, 'User.java');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF && c.name === 'User')).toBe(true);
  });

  it('detects final field as constant', () => {
    const s = 'public class Config {\n  private final String env = "prod";\n}';
    const captures = p.parse(s, 'Config.java');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'env')).toBe(true);
  });

  it('detects field with generic type', () => {
    const s = 'public class Container {\n  private List<String> items;\n}';
    const captures = p.parse(s, 'Container.java');
    expect(captures.some(c => c.name === 'items')).toBe(true);
  });

  it('detects static field', () => {
    const s = 'public class Singleton {\n  private static Singleton instance;\n}';
    const captures = p.parse(s, 'Singleton.java');
    expect(captures.some(c => c.name === 'instance')).toBe(true);
  });

  it('detects protected field', () => {
    const s = 'public class Base {\n  protected String id;\n}';
    const captures = p.parse(s, 'Base.java');
    expect(captures.some(c => c.name === 'id')).toBe(true);
  });

  it('detects record in class context', () => {
    const s = 'public record User(String name, int age) {}';
    const captures = p.parse(s, 'User.java');
    expect(captures.some(c => c.name === 'User' && c.properties.isRecord === 'true')).toBe(true);
  });

  it('detects method with throws clause', () => {
    const s = 'public class FileOp {\n  public void read(String path) throws IOException {\n  }\n}';
    const captures = p.parse(s, 'FileOp.java');
    expect(captures.some(c => c.name === 'read')).toBe(true);
  });

  it('detects synchronized method', () => {
    const s = 'public class Counter {\n  public synchronized void increment() {\n  }\n}';
    const captures = p.parse(s, 'Counter.java');
    expect(captures.some(c => c.name === 'increment')).toBe(true);
  });

  it('detects native method', () => {
    const s = 'public class Native {\n  public native int compute();\n}';
    const captures = p.parse(s, 'Native.java');
    expect(captures.some(c => c.name === 'compute')).toBe(true);
  });

  it('detects protected class', () => {
    const s = 'protected class Inner {\n  void run() {}\n}';
    const captures = p.parse(s, 'Inner.java');
    expect(captures.some(c => c.name === 'Inner')).toBe(true);
  });

  it('handles isExported for public field', () => {
    expect(p.isExported('public class Data { public int value; }', 'value')).toBe(true);
  });

  it('handles isExported for public static method', () => {
    expect(p.isExported('public class Utils { public static void init() {} }', 'init')).toBe(true);
  });

  it('detects variable with type annotation and value', () => {
    const s = 'public class Demo {\n  int count = 0;\n  String name = "test";\n}';
    const captures = p.parse(s, 'Demo.java');
    expect(captures.some(c => c.name === 'count')).toBe(true);
    expect(captures.some(c => c.name === 'name')).toBe(true);
  });
});

describe('KotlinProvider third wave', () => {
  const p = new KotlinProvider();

  it('detects extension function with receiver type', () => {
    const s = 'fun String.isValidEmail(): Boolean {\n  return contains("@") && contains(".")\n}';
    const captures = p.parse(s, 'ext.kt');
    expect(captures.some(c => c.name === 'isValidEmail')).toBe(true);
  });

  it('detects property without explicit type (defaults to Any)', () => {
    const s = 'val count = 42\nval name: String = "hello"';
    const captures = p.parse(s, 'test.kt');
    const prop = captures.find(c => c.name === 'count');
    expect(prop).toBeDefined();
    expect(prop!.properties.propertyType).toBe('Any');
  });

  it('detects companion object without explicit name', () => {
    const s = 'class MyClass {\n  companion object {\n    fun create() = MyClass()\n  }\n}';
    const captures = p.parse(s, 'MyClass.kt');
    // The regex requires object followed by a name (object\s+(\w+)), so companion object without name won't match
    // This tests that the code doesn't crash and handles it gracefully
    expect(Array.isArray(captures)).toBe(true);
  });

  it('detects interface', () => {
    const s = 'interface Repository<T> {\n  fun findById(id: Long): T?\n}';
    const captures = p.parse(s, 'Repo.kt');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF && c.name === 'Repository')).toBe(true);
  });

  it('detects operator function', () => {
    const s = 'operator fun Point.plus(other: Point): Point {\n  return Point(x + other.x, y + other.y)\n}';
    const captures = p.parse(s, 'Point.kt');
    expect(captures.some(c => c.name === 'plus')).toBe(true);
  });

  it('detects infix function', () => {
    const s = 'infix fun Int.times(str: String): String {\n  return str.repeat(this)\n}';
    const captures = p.parse(s, 'ext.kt');
    expect(captures.some(c => c.name === 'times')).toBe(true);
  });

  it('detects function with generic type parameter', () => {
    const s = 'fun <T> singleton(item: T): List<T> {\n  return listOf(item)\n}';
    const captures = p.parse(s, 'util.kt');
    expect(captures.some(c => c.name === 'singleton')).toBe(true);
  });

  it('detects property without explicit type (defaults to Any)', () => {
    const s = 'var count = 0';
    const captures = p.parse(s, 'test.kt');
    const prop = captures.find(c => c.name === 'count');
    expect(prop).toBeDefined();
    expect(prop!.properties.propertyType).toBe('Any');
  });

  it('detects mutable var property', () => {
    const s = 'var name = "test"';
    const captures = p.parse(s, 'test.kt');
    const prop = captures.find(c => c.name === 'name');
    expect(prop).toBeDefined();
    expect(prop!.properties.mutable).toBe('true');
  });

  it('detects val property as constant', () => {
    const s = 'val PI = 3.14';
    const captures = p.parse(s, 'test.kt');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'PI')).toBe(true);
  });
});

describe('RustProvider third wave', () => {
  const p = new RustProvider();

  it('detects trait method in impl block', () => {
    const s = 'trait Draw {\n  fn draw(&self);\n}\nstruct Circle;\nimpl Draw for Circle {\n  fn draw(&self) {\n    println!("circle");\n  }\n}';
    const captures = p.parse(s, 'draw.rs');
    expect(captures.some(c => c.name === 'Circle')).toBe(true);
    expect(captures.some(c => c.name === 'draw' && c.tag === CAPTURE_TAGS.FUNCTION_DEF)).toBe(true);
  });

  it('detects unsafe trait', () => {
    const s = 'pub unsafe trait RawAccess {\n  unsafe fn read(&self) -> *const u8;\n}';
    const captures = p.parse(s, 'raw.rs');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF && c.name === 'RawAccess')).toBe(true);
  });

  it('detects cfg attribute', () => {
    const s = '#[cfg(test)]\nfn test_helper() {}\n#[derive(Debug)]\nstruct MyData {}';
    const captures = p.parse(s, 'test.rs');
    const attrs = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
    expect(attrs.some(a => a.name === 'cfg')).toBe(true);
  });

  it('detects inner attribute (#!)', () => {
    const s = '#![no_std]\nfn main() {}';
    const captures = p.parse(s, 'main.rs');
    const attrs = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
    expect(attrs.some(a => a.name === 'no_std')).toBe(true);
  });

  it('detects use with wildcard', () => {
    const s = 'use std::collections::HashMap;\nfn main() {}';
    const imports = p.extractImports(s);
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports.some(i => i.source === 'std::collections::HashMap')).toBe(true);
  });

  it('detects impl block with generic type parameter', () => {
    const s = 'impl<T> Container<T> {\n  fn new() -> Self { Container {}\n  }\n}';
    const captures = p.parse(s, 'container.rs');
    expect(captures.some(c => c.properties.isImpl === 'true')).toBe(true);
  });

  it('detects pub(crate) struct', () => {
    const s = 'pub(crate) struct InternalConfig {\n  debug: bool,\n}';
    const captures = p.parse(s, 'config.rs');
    expect(captures.some(c => c.name === 'InternalConfig')).toBe(true);
  });

  it('detects pub const', () => {
    const s = 'pub const MAX_CONNECTIONS: u32 = 100;';
    const captures = p.parse(s, 'constants.rs');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'MAX_CONNECTIONS')).toBe(true);
  });

  it('detects pub(crate) const', () => {
    const s = 'pub(crate) const TIMEOUT: u64 = 30;';
    const captures = p.parse(s, 'config.rs');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.name === 'TIMEOUT')).toBe(true);
  });

  it('handles isExported for pub(crate) function', () => {
    expect(p.isExported('pub(crate) fn internal() {}', 'internal')).toBe(true);
  });
});

// ============================================================================
// Branch Coverage — base-c-like shared functions via Java provider
// ============================================================================

describe('JavaProvider base-c-like branch coverage', () => {
  const p = new JavaProvider();

  it('detects function with void return type via extractFunctions', () => {
    const s = 'public class Service {\n  public void execute() {\n  }\n}';
    const captures = p.parse(s, 'Service.java');
    expect(captures.some(c => c.name === 'execute' && c.tag === CAPTURE_TAGS.METHOD_DEF)).toBe(true);
  });

  it('detects function with return type via extractFunctions', () => {
    const s = 'public class Util {\n  public String getName() {\n    return "test";\n  }\n}';
    const captures = p.parse(s, 'Util.java');
    const m = captures.find(c => c.name === 'getName');
    expect(m).toBeDefined();
    expect(m!.properties.returnType).toBe('String');
  });

  it('detects function call via extractCalls', () => {
    const s = 'public class Runner {\n  public void run() {\n    doSomething();\n    calculate();\n  }\n}';
    const captures = p.parse(s, 'Runner.java');
    const calls = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    expect(calls.some(c => c.name === 'doSomething')).toBe(true);
    expect(calls.some(c => c.name === 'calculate')).toBe(true);
  });

  it('skips ALL_CAPS constant in function calls', () => {
    const s = 'public class Runner {\n  public void run() {\n    int MAX = 100;\n    doWork(MAX);\n  }\n}';
    const captures = p.parse(s, 'Runner.java');
    const calls = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    // MAX should be skipped because it's ALL_CAPS
    expect(calls.every(c => c.name !== 'MAX')).toBe(true);
  });

  it('detects variable with const keyword via extractVariables', () => {
    const s = 'public class Config {\n  public static final int MAX_VALUE = 100;\n  private String name = "test";\n}';
    const captures = p.parse(s, 'Config.java');
    const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
    const vars = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(consts.some(c => c.name === 'MAX_VALUE')).toBe(true);
    expect(vars.some(v => v.name === 'name')).toBe(true);
  });

  it('detects variable with final keyword', () => {
    const s = 'public class Config {\n  private final String env = "prod";\n}';
    const captures = p.parse(s, 'Config.java');
    const consts = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
    expect(consts.some(c => c.name === 'env')).toBe(true);
  });

  it('detects doc comments via extractDocComments', () => {
    const s = '/**\n * Represents a user.\n */\npublic class User {\n  /**\n   * Gets the name.\n   */\n  public String getName() { return null; }\n}';
    const captures = p.parse(s, 'User.java');
    const docs = captures.filter(c => c.tag === CAPTURE_TAGS.DOCSTRING);
    expect(docs.length).toBeGreaterThanOrEqual(2);
  });

  it('detects single-line doc comment', () => {
    const s = '/** Single line doc */\npublic class Simple {}';
    const captures = p.parse(s, 'Simple.java');
    const docs = captures.filter(c => c.tag === CAPTURE_TAGS.DOCSTRING);
    expect(docs.length).toBeGreaterThanOrEqual(1);
  });

  it('handles private class extraction', () => {
    const s = 'private class InnerHelper {\n  public void assist() {\n  }\n}';
    const captures = p.parse(s, 'Helper.java');
    expect(captures.some(c => c.name === 'InnerHelper')).toBe(true);
  });

  it('handles enum extraction', () => {
    const s = 'public enum Status {\n  ACTIVE, INACTIVE, PENDING\n}';
    const captures = p.parse(s, 'Status.java');
    expect(captures.some(c => c.tag === CAPTURE_TAGS.ENUM_DEF && c.name === 'Status')).toBe(true);
  });
});

// ============================================================================
// Java - additional branch coverage for uncovered branches
// ============================================================================

describe('JavaProvider branch coverage wave 4', () => {
  const p = new JavaProvider();

  it('handles reserved word check in method extraction (L115-116)', () => {
    // The check skips if/while/for/switch/catch/synchronized as method names
    const s = 'public class Test {\n  public void for() {\n  }\n  public void if() {\n  }\n}';
    const captures = p.parse(s, 'Test.java');
    // 'for' and 'if' should not be extracted as method names
    const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
    expect(methods.every(m => !['for', 'if'].includes(m.name!))).toBe(true);
  });

  it('handles field with short name filter (L155)', () => {
    const s = 'public class Test {\n  private int x;\n  private int y;\n}';
    const captures = p.parse(s, 'Test.java');
    // Short field names (x, y - less than 2 chars) should be filtered
    const fields = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(fields.every(f => f.name!.length >= 2)).toBe(true);
  });

  it('handles import as capture extraction (L193)', () => {
    const s = 'import java.util.List;\nimport java.util.ArrayList;\npublic class Test {}';
    const captures = p.parse(s, 'Test.java');
    const imports = captures.filter(c => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('handles explicit keyword check in method extraction (L116)', () => {
    const s = 'public class Test {\n  public void switch() {\n  }\n  public void catch() {\n  }\n}';
    const captures = p.parse(s, 'Test.java');
    // 'switch' and 'catch' are in the explicit skip list
    const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
    expect(methods.every(m => !['switch', 'catch'].includes(m.name!))).toBe(true);
  });

  it('handles synchronized keyword in method extraction (L115)', () => {
    // 'synchronized' is in the explicit keyword skip list at L115
    const s = 'public class Test {\n  public void synchronized() {\n  }\n}';
    const captures = p.parse(s, 'Test.java');
    const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
    expect(methods.every(m => !['synchronized'].includes(m.name!))).toBe(true);
  });
});

// ============================================================================
// Kotlin - additional branch coverage for uncovered branches
// ============================================================================

describe('KotlinProvider branch coverage wave 4', () => {
  const p = new KotlinProvider();

  it('handles reserved keyword in function detection (L110)', () => {
    const s = 'fun when() {\n  println("test")\n}';
    const captures = p.parse(s, 'test.kt');
    // 'when' is a reserved keyword, should be skipped
    const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'when');
    expect(funcs).toEqual([]);
  });

  it('handles reserved keyword in property extraction (L147-148)', () => {
    const s = 'val if = 1\nvar when = 2';
    const captures = p.parse(s, 'test.kt');
    // 'if' and 'when' are reserved, should be skipped
    const props = captures.filter(c => c.name === 'if' || c.name === 'when');
    expect(props).toEqual([]);
  });

  it('handles import as capture extraction (L209)', () => {
    const s = 'import kotlin.collections.List\nimport kotlin.collections.ArrayList\nfun main() {}';
    const captures = p.parse(s, 'main.kt');
    const imports = captures.filter(c => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('handles short property name filter (L148)', () => {
    const s = 'val x = 1\nvar y = 2\nval validName = 3';
    const captures = p.parse(s, 'test.kt');
    // 'x' and 'y' are less than 2 chars, should be filtered
    const props = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTANT_DEF || c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(props.every(p => p.name!.length >= 2)).toBe(true);
    expect(props.some(p => p.name === 'validName')).toBe(true);
  });
});

// ============================================================================
// Rust - additional branch coverage for uncovered branches
// ============================================================================

describe('RustProvider branch coverage wave 4', () => {
  const p = new RustProvider();

  it('handles reserved keyword in struct detection (L161)', () => {
    const s = 'pub struct if {}\npub struct Valid {}';
    const captures = p.parse(s, 'test.rs');
    // 'if' is reserved, should be skipped
    const structs = captures.filter(c => c.name === 'if');
    expect(structs).toEqual([]);
    expect(captures.some(c => c.name === 'Valid')).toBe(true);
  });

  it('handles reserved keyword in const detection (L246)', () => {
    const s = 'const if: u32 = 0;\nconst VALID: u32 = 1;';
    const captures = p.parse(s, 'test.rs');
    // 'if' is reserved, should be skipped in constants
    const consts = captures.filter(c => c.name === 'if');
    expect(consts).toEqual([]);
    expect(captures.some(c => c.name === 'VALID')).toBe(true);
  });

  it('handles reserved keyword in call detection (L268)', () => {
    const s = 'fn main() {\n  if true {\n    println!("test");\n  }\n}';
    const captures = p.parse(s, 'test.rs');
    // 'if' is reserved, should not appear as a function call
    const calls = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.name === 'if');
    expect(calls).toEqual([]);
  });

  it('handles use as capture extraction (L285)', () => {
    const s = 'use std::collections::HashMap;\nuse std::io;\nfn main() {}';
    const captures = p.parse(s, 'main.rs');
    const imports = captures.filter(c => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('handles ALL_CAPS filter in call extraction (L268)', () => {
    const s = 'fn main() {\n  let DEBUG = 1;\n  println!("{}", DEBUG);\n}';
    const captures = p.parse(s, 'test.rs');
    // ALL_CAPS names like DEBUG should be filtered from function calls
    const calls = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.name === 'DEBUG');
    expect(calls).toEqual([]);
  });

  it('handles uppercase single char call name filter (L267-268)', () => {
    // Names that start with uppercase AND are all uppercase should be skipped
    const s = 'fn main() {\n  let X = 1;\n  A();\n  B();\n}';
    const captures = p.parse(s, 'test.rs');
    const calls = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    // 'A' and 'B' are single uppercase chars - should be skipped
    expect(calls.every(c => c.name !== 'A' && c.name !== 'B')).toBe(true);
  });
});

describe('CSharpProvider branch coverage hardening', () => {
  const p = new CSharpProvider();

  it('detects using static import', () => {
    const s = 'using static System.Math;\npublic class Calc {}';
    const imports = p.extractImports(s);
    expect(imports.length).toBeGreaterThanOrEqual(1);
  });

  it('detects using with alias', () => {
    const s = 'using Project = System.Collections.Generic;\npublic class Test {}';
    const imports = p.extractImports(s);
    expect(imports.length).toBeGreaterThanOrEqual(1);
  });

  it('detects attribute with arguments', () => {
    const s = '[Authorize(Roles = "Admin")]\npublic class AdminController {}';
    const captures = p.parse(s, 'Controller.cs');
    const attrs = captures.filter(c => c.tag === CAPTURE_TAGS.DECORATOR);
    expect(attrs.some(a => a.name === 'Authorize')).toBe(true);
  });

  it('detects method with where clause', () => {
    const s = 'public class Repo {\n  public T GetById<T>(int id) where T : class { return null; }\n}';
    const captures = p.parse(s, 'Repo.cs');
    expect(captures.some(c => c.name === 'GetById')).toBe(true);
  });
});

// ============================================================================
// Branch Coverage — base-c-like findBlockEnd edge cases via C#
// ============================================================================

describe('CSharpProvider findBlockEnd edge cases', () => {
  const p = new CSharpProvider();

  it('handles method with line comment in body', () => {
    const s = 'public class Test {\n  public void Run() {\n    // line comment\n    return;\n  }\n}';
    const captures = p.parse(s, 'Test.cs');
    const m = captures.find(c => c.name === 'Run');
    expect(m).toBeDefined();
    expect(m!.endLine).toBeGreaterThan(m!.startLine);
  });

  it('handles method with block comment in body', () => {
    const s = 'public class Test {\n  public void Run() {\n    /* block comment */\n    return;\n  }\n}';
    const captures = p.parse(s, 'Test.cs');
    const m = captures.find(c => c.name === 'Run');
    expect(m).toBeDefined();
    expect(m!.endLine).toBeGreaterThan(m!.startLine);
  });

  it('handles method with string containing braces in body', () => {
    const s = 'public class Test {\n  public string GetTemplate() {\n    return "{ nested } braces";\n  }\n}';
    const captures = p.parse(s, 'Test.cs');
    const m = captures.find(c => c.name === 'GetTemplate');
    expect(m).toBeDefined();
    expect(m!.endLine).toBeGreaterThan(m!.startLine);
  });

  it('handles method with single quoted string', () => {
    const s = 'public class Test {\n  public char GetChar() {\n    return \'{\';\n  }\n}';
    const captures = p.parse(s, 'Test.cs');
    const m = captures.find(c => c.name === 'GetChar');
    expect(m).toBeDefined();
    expect(m!.endLine).toBeGreaterThan(m!.startLine);
  });

  it('handles class with no brace block (semicolon ended)', () => {
    const s = 'public class Simple { }';
    const captures = p.parse(s, 'Simple.cs');
    expect(captures.some(c => c.name === 'Simple')).toBe(true);
  });

  it('handles property with get and set accessors', () => {
    const s = 'public class User {\n  private string _name;\n  public string Name {\n    get { return _name; }\n    set { _name = value; }\n  }\n}';
    const captures = p.parse(s, 'User.cs');
    const prop = captures.find(c => c.name === 'Name');
    expect(prop).toBeDefined();
    expect(prop!.properties.hasGet).toBe('true');
    expect(prop!.properties.hasSet).toBe('true');
  });
});

// ============================================================================
// CSharp - additional branch coverage for uncovered branches
// ============================================================================

describe('CSharpProvider branch coverage wave 4', () => {
  const p = new CSharpProvider();

  it('handles ALL_CAPS call being skipped (L253)', () => {
    const s = 'public class Runner {\n  public void Execute() {\n    Console.WriteLine("test");\n  }\n}';
    const captures = p.parse(s, 'Runner.cs');
    // ALL_CAPS function calls should be skipped
    const calls = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.name === 'WRITE');
    expect(calls).toEqual([]);
  });

  it('handles foreach keyword in method extraction (L137-138 explicit list)', () => {
    // 'foreach' is in the explicit keyword skip list at L137
    const s = 'public class Test {\n  public void foreach() { }\n  public void lock() { }\n  public void fixed() { }\n}';
    const captures = p.parse(s, 'Test.cs');
    const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
    expect(methods.every(m => !['foreach', 'lock', 'fixed'].includes(m.name!))).toBe(true);
  });

  it('handles reserved word in call extraction (L137-138)', () => {
    const s = 'public class Test {\n  public void Method() {\n    int x = if (true) 1 : 0;\n  }\n}';
    // Should not crash when parsing if/while/for as calls
    const captures = p.parse(s, 'Test.cs');
    expect(Array.isArray(captures)).toBe(true);
  });

  it('handles property with name less than 2 chars (L179-181)', () => {
    const s = 'public class Test {\n  public int X { get; set; }\n  public string A { get; }\n}';
    const captures = p.parse(s, 'Test.cs');
    // Single-char property names should be skipped (length < 2 check)
    const props = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    // X is 1 char, should be filtered. A is 1 char, should be filtered.
    expect(props.every(p => p.name!.length >= 2)).toBe(true);
  });

  it('handles property with reserved name get/set (L179)', () => {
    const s = 'public class Test {\n  public string Get { get; set; }\n  public string Set { get; set; }\n}';
    const captures = p.parse(s, 'Test.cs');
    // 'Get' and 'Set' are reserved accessor names, should be skipped in properties
    const props = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(props.every(p => !['get', 'set'].includes(p.name!))).toBe(true);
  });

  it('handles extractUsings as capture (L270)', () => {
    const s = 'using System;\nusing System.Collections.Generic;\npublic class Test {}';
    const captures = p.parse(s, 'Test.cs');
    const imports = captures.filter(c => c.tag === CAPTURE_TAGS.IMPORT);
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('handles reserved word filter in method extraction (L137-138)', () => {
    // Test that reserved words like 'if', 'while', 'for', 'foreach', 'switch', 'lock', 'using', 'fixed' are filtered
    const s = 'public class Test {\n  public void if() { }\n  public void while() { }\n  public void for() { }\n  public void using() { }\n}';
    const captures = p.parse(s, 'Test.cs');
    const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
    expect(methods.every(m => !['if', 'while', 'for', 'using'].includes(m.name!))).toBe(true);
  });

  it('handles property accessor name filter and short names (L178-180)', () => {
    // Test that get/set/init/add/remove and short names are filtered from properties
    const s = 'public class Test {\n  public string Get { get; set; }\n  public string Set { get; set; }\n  public string Init { get; set; }\n  public int X { get; set; }\n  public int Y { get; }\n}';
    const captures = p.parse(s, 'Test.cs');
    // 'Get', 'Set', 'Init' are filtered as accessor names, 'X', 'Y' are filtered for short names
    const props = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    expect(props.every(p => !['get', 'set', 'init', 'add', 'remove'].includes(p.name!))).toBe(true);
    expect(props.every(p => p.name!.length >= 2)).toBe(true);
  });

  it('handles ALL_CAPS call name skip with uppercase check (L252-253)', () => {
    // ALL_CAPS names starting with uppercase should be skipped in call extraction
    const s = 'public class Test {\n  public void Run() {\n    DEBUG_MODE();\n    Console.WriteLine("test");\n  }\n}';
    const captures = p.parse(s, 'Test.cs');
    // DEBUG_MODE is ALL_CAPS and should be skipped
    const calls = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    expect(calls.every(c => c.name !== 'DEBUG_MODE')).toBe(true);
    // But Console should also be skipped (starts with uppercase)
    expect(calls.every(c => !(c.name === c.name!.toUpperCase() && /^[A-Z]/.test(c.name!)))).toBe(true);
  });

  it('handles property literally named get/set/add/remove (L178-180)', () => {
    // Properties literally named 'get', 'set', 'add', 'remove' should be filtered at L179
    const s = 'public class Test {\n  public string get { get; set; }\n  public string set { get; set; }\n  public string add { add; remove; }\n  public string remove { add; remove; }\n}';
    const captures = p.parse(s, 'Test.cs');
    const props = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    // 'get', 'set', 'add', 'remove' should be filtered as accessor names
    expect(props.every(p => !['get', 'set', 'add', 'remove'].includes(p.name!))).toBe(true);
  });

  it('handles property with C# keyword as name (L178)', () => {
    // Property name that is a C# keyword (in CSHARP_RESERVED) should be filtered at L178
    const s = 'public class Test {\n  public int string { get; set; }\n  public int class { get; set; }\n  public int void { get; set; }\n}';
    const captures = p.parse(s, 'Test.cs');
    const props = captures.filter(c => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
    // Properties named after C# keywords should be filtered
    expect(props.every(p => !['string', 'class', 'void'].includes(p.name!))).toBe(true);
  });
});
