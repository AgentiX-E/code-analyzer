import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { JavaProvider } from '../languages/java.js';
import { KotlinProvider } from '../languages/kotlin.js';
import { CSharpProvider } from '../languages/csharp.js';
import { RustProvider } from '../languages/rust.js';

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

  describe('parse', () => {
    it('detects public class', () => {
      const source = 'public class MyClass {\n  void foo() {}\n}';
      const captures = provider.parse(source, 'MyClass.java');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects interface', () => {
      const source = 'public interface Repository {\n  void find();\n}';
      const captures = provider.parse(source, 'Repository.java');
      const ifaces = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some(c => c.name === 'Repository')).toBe(true);
    });

    it('detects enum', () => {
      const source = 'public enum Color { RED, GREEN, BLUE }';
      const captures = provider.parse(source, 'Color.java');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(c => c.name === 'Color')).toBe(true);
    });

    it('detects methods', () => {
      const source = 'public class Service {\n  public void execute() {}\n}';
      const captures = provider.parse(source, 'Service.java');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some(c => c.name === 'execute')).toBe(true);
    });

    it('detects constructor', () => {
      const source = 'public class Person {\n  public Person(String name) {\n  }\n}';
      const captures = provider.parse(source, 'Person.java');
      const ctors = captures.filter(c => c.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF);
      expect(ctors.some(c => c.name === 'Person')).toBe(true);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.java');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('extracts imports', () => {
      const source = 'import java.util.List;\nimport java.util.Map;';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('detects public class as exported', () => {
      expect(provider.isExported('public class MyClass {}', 'MyClass')).toBe(true);
    });

    it('detects package-private class as not exported', () => {
      expect(provider.isExported('class MyClass {}', 'MyClass')).toBe(false);
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

  describe('parse', () => {
    it('detects class', () => {
      const source = 'class MyClass {\n  fun greet() = "hello"\n}';
      const captures = provider.parse(source, 'MyClass.kt');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects data class', () => {
      const source = 'data class User(val name: String, val age: Int)';
      const captures = provider.parse(source, 'User.kt');
      expect(captures.some(c => c.name === 'User')).toBe(true);
    });

    it('detects functions', () => {
      const source = 'fun greet(name: String): String {\n  return "Hello"\n}';
      const captures = provider.parse(source, 'main.kt');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'greet')).toBe(true);
    });

    it('detects object declarations', () => {
      const source = 'object DatabaseConfig {\n  val url = "localhost"\n}';
      const captures = provider.parse(source, 'Config.kt');
      const objs = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.isObject === 'true');
      expect(objs.some(o => o.name === 'DatabaseConfig')).toBe(true);
    });

    it('detects enum class', () => {
      const source = 'enum class Color {\n  RED, GREEN, BLUE\n}';
      const captures = provider.parse(source, 'Color.kt');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(e => e.name === 'Color')).toBe(true);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.kt');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('extracts imports', () => {
      const source = 'import kotlin.collections.List\nimport kotlin.collections.Map';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('detects top-level function as exported', () => {
      expect(provider.isExported('fun greet() {}', 'greet')).toBe(true);
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

  describe('parse', () => {
    it('detects public class', () => {
      const source = 'public class MyClass {\n  public void DoSomething() {}\n}';
      const captures = provider.parse(source, 'MyClass.cs');
      const classes = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some(c => c.name === 'MyClass')).toBe(true);
    });

    it('detects interface', () => {
      const source = 'public interface IRepository {\n  void Find();\n}';
      const captures = provider.parse(source, 'IRepository.cs');
      const ifaces = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some(i => i.name === 'IRepository')).toBe(true);
    });

    it('detects struct', () => {
      const source = 'public struct Point {\n  public int X;\n  public int Y;\n}';
      const captures = provider.parse(source, 'Point.cs');
      const structs = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(structs.some(s => s.name === 'Point')).toBe(true);
    });

    it('detects enum', () => {
      const source = 'public enum Color { Red, Green, Blue }';
      const captures = provider.parse(source, 'Color.cs');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(e => e.name === 'Color')).toBe(true);
    });

    it('detects methods', () => {
      const source = 'public class Service {\n  public void Execute() {}\n}';
      const captures = provider.parse(source, 'Service.cs');
      const methods = captures.filter(c => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some(m => m.name === 'Execute')).toBe(true);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.cs');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('extracts using directives', () => {
      const source = 'using System;\nusing System.Collections.Generic;';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
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

  describe('parse', () => {
    it('detects named struct', () => {
      const source = 'pub struct User {\n  name: String,\n  age: u32,\n}';
      const captures = provider.parse(source, 'user.rs');
      const structs = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(structs.some(s => s.name === 'User')).toBe(true);
    });

    it('detects enum', () => {
      const source = 'pub enum Color {\n  Red,\n  Green,\n  Blue,\n}';
      const captures = provider.parse(source, 'color.rs');
      const enums = captures.filter(c => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some(e => e.name === 'Color')).toBe(true);
    });

    it('detects trait', () => {
      const source = 'pub trait Display {\n  fn fmt(&self) -> String;\n}';
      const captures = provider.parse(source, 'display.rs');
      const traits = captures.filter(c => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(traits.some(t => t.name === 'Display')).toBe(true);
    });

    it('detects function', () => {
      const source = 'pub fn greet(name: &str) -> String {\n  format!("Hello, {}", name)\n}';
      const captures = provider.parse(source, 'greet.rs');
      const funcs = captures.filter(c => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some(f => f.name === 'greet')).toBe(true);
    });

    it('detects impl block', () => {
      const source = 'impl Counter {\n  pub fn new() -> Self { Counter { value: 0 } }\n}';
      const captures = provider.parse(source, 'counter.rs');
      const impls = captures.filter(c => c.tag === CAPTURE_TAGS.CLASS_DEF && c.properties?.isImpl === 'true');
      expect(impls.some(i => i.name === 'Counter')).toBe(true);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'Empty.rs');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('extracts use declarations', () => {
      const source = 'use std::collections::HashMap;';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(1);
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
});
