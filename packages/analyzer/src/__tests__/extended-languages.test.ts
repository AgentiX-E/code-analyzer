import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS, getLanguageFromFilename } from '@code-analyzer/shared';

import { CppProvider } from '../languages/cpp.js';
import { CProvider } from '../languages/c.js';
import { DartProvider } from '../languages/dart.js';
import { LuaProvider } from '../languages/lua.js';
import { ScalaProvider } from '../languages/scala.js';
import { ZigProvider } from '../languages/zig.js';
import { ElixirProvider } from '../languages/elixir.js';
import { HclProvider } from '../languages/hcl.js';
import { DockerfileProvider } from '../languages/dockerfile.js';

// ============================================================================
// C++ Provider Tests
// ============================================================================

describe('CppProvider', () => {
  const provider = new CppProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('cpp');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('C++');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.cpp');
      expect(provider.extensions).toContain('.cc');
      expect(provider.extensions).toContain('.cxx');
      expect(provider.extensions).toContain('.hpp');
      expect(provider.extensions).toContain('.hh');
      expect(provider.extensions).toContain('.hxx');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });

    it('should have correct globs', () => {
      expect(provider.globs).toContain('**/*.cpp');
      expect(provider.globs).toContain('**/*.hpp');
    });
  });

  describe('parse', () => {
    it('should detect class definitions', () => {
      const source = 'class MyClass {\npublic:\n  void foo() {}\n};';
      const captures = provider.parse(source, 'test.cpp');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyClass')).toBe(true);
    });

    it('should detect struct definitions', () => {
      const source = 'struct Point {\n  int x;\n  int y;\n};';
      const captures = provider.parse(source, 'test.cpp');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });

    it('should detect enum definitions', () => {
      const source = 'enum Color { RED, GREEN, BLUE };';
      const captures = provider.parse(source, 'test.cpp');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should detect function definitions', () => {
      const source = 'int add(int a, int b) {\n  return a + b;\n}';
      const captures = provider.parse(source, 'test.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should detect void functions', () => {
      const source = 'void initialize() {\n  setup();\n}';
      const captures = provider.parse(source, 'test.cpp');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'initialize')).toBe(true);
    });

    it('should detect #include directives', () => {
      const source = '#include <iostream>\n#include "myheader.h"';
      const captures = provider.parse(source, 'test.cpp');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'iostream')).toBe(true);
      expect(imports.some((c) => c.name === 'myheader.h')).toBe(true);
    });

    it('should handle template classes', () => {
      const source = 'template<typename T>\nclass Container {\n  T value;\n};';
      const captures = provider.parse(source, 'test.cpp');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Container')).toBe(true);
    });

    it('should handle .hpp files', () => {
      const source = 'class MyClass {\npublic:\n  void foo();\n};';
      const captures = provider.parse(source, 'header.hpp');
      expect(captures.some((c) => c.name === 'MyClass')).toBe(true);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.cpp');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle malformed C++ syntax', () => {
      const source = 'class Broken {\n  missing semicolon\n}';
      const captures = provider.parse(source, 'broken.cpp');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract #include directives', () => {
      const source = '#include <vector>\n#include "config.h"';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
      expect(imports.some((i) => i.source === 'vector')).toBe(true);
    });
  });

  describe('isExported', () => {
    it('should detect top-level class as exported', () => {
      expect(provider.isExported('class MyClass {};', 'MyClass')).toBe(true);
    });

    it('should detect static function as not exported', () => {
      expect(provider.isExported('static void helper() {}', 'helper')).toBe(false);
    });
  });
});

// ============================================================================
// C Provider Tests
// ============================================================================

describe('CProvider', () => {
  const provider = new CProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('c');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('C');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.c');
      expect(provider.extensions).toContain('.h');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect struct definitions', () => {
      const source = 'struct Point {\n  int x;\n  int y;\n};';
      const captures = provider.parse(source, 'test.c');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });

    it('should detect enum definitions', () => {
      const source = 'enum Color { RED, GREEN, BLUE };';
      const captures = provider.parse(source, 'test.c');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should detect function definitions', () => {
      const source = 'int add(int a, int b) {\n  return a + b;\n}';
      const captures = provider.parse(source, 'test.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should detect void function declarations', () => {
      const source = 'void initialize(void);';
      const captures = provider.parse(source, 'test.c');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'initialize')).toBe(true);
    });

    it('should detect #include directives', () => {
      const source = '#include <stdio.h>\n#include "myheader.h"';
      const captures = provider.parse(source, 'test.c');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'stdio.h')).toBe(true);
      expect(imports.some((c) => c.name === 'myheader.h')).toBe(true);
    });

    it('should handle .h files', () => {
      const source = 'struct Config {\n  int port;\n  char* host;\n};';
      const captures = provider.parse(source, 'config.h');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Config')).toBe(true);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.c');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle typedef struct', () => {
      const source = 'typedef struct {\n  int x;\n  int y;\n} Point;';
      const captures = provider.parse(source, 'test.c');
      // Should at least find the struct keyword context
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract #include directives', () => {
      const source = '#include <stdlib.h>\n#include "local.h"';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('should detect top-level function as exported', () => {
      expect(provider.isExported('void myFunc() {}', 'myFunc')).toBe(true);
    });

    it('should detect static function as not exported', () => {
      expect(provider.isExported('static void helper() {}', 'helper')).toBe(false);
    });
  });
});

// ============================================================================
// Scala Provider Tests
// ============================================================================

describe('ScalaProvider', () => {
  const provider = new ScalaProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('scala');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Scala');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.scala');
      expect(provider.extensions).toContain('.sc');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect class definitions', () => {
      const source = 'class Calculator {\n  def add(x: Int, y: Int): Int = x + y\n}';
      const captures = provider.parse(source, 'Calculator.scala');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF &&
        c.properties?.isObject !== 'true');
      expect(classes.some((c) => c.name === 'Calculator')).toBe(true);
    });

    it('should detect object definitions', () => {
      const source = 'object DatabaseConfig {\n  val url = "localhost:5432"\n}';
      const captures = provider.parse(source, 'Config.scala');
      const objects = captures.filter((c) => c.properties?.isObject === 'true');
      expect(objects.some((c) => c.name === 'DatabaseConfig')).toBe(true);
    });

    it('should detect trait definitions', () => {
      const source = 'trait Serializable {\n  def serialize(): String\n}';
      const captures = provider.parse(source, 'Serializable.scala');
      const traits = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(traits.some((c) => c.name === 'Serializable')).toBe(true);
    });

    it('should detect function definitions', () => {
      const source = 'def greet(name: String): String = s"Hello, $name"';
      const captures = provider.parse(source, 'Test.scala');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
    });

    it('should detect case class', () => {
      const source = 'case class User(name: String, age: Int)';
      const captures = provider.parse(source, 'User.scala');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'User')).toBe(true);
    });

    it('should detect import statements', () => {
      const source = 'import scala.collection.mutable.ListBuffer';
      const captures = provider.parse(source, 'Test.scala');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name?.includes('ListBuffer'))).toBe(true);
    });

    it('should handle .sc extension files', () => {
      const source = 'object Script {\n  def run(): Unit = println("hello")\n}';
      const captures = provider.parse(source, 'script.sc');
      expect(captures.some((c) => c.name === 'Script')).toBe(true);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.scala');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle abstract class', () => {
      const source = 'abstract class BaseRepository {\n  def find(id: Int): Option[Entity]\n}';
      const captures = provider.parse(source, 'Repository.scala');
      expect(captures.some((c) => c.name === 'BaseRepository')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract scala imports', () => {
      const source = 'import scala.concurrent.Future\nimport java.util.Date';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('should detect public class as exported', () => {
      expect(provider.isExported('class MyApp {}', 'MyApp')).toBe(true);
    });

    it('should detect private class as not exported', () => {
      expect(provider.isExported('private class Internal {}', 'Internal')).toBe(false);
    });

    it('should detect top-level def as exported', () => {
      expect(provider.isExported('def run(): Unit = {}', 'run')).toBe(true);
    });
  });
});

// ============================================================================
// Elixir Provider Tests
// ============================================================================

describe('ElixirProvider', () => {
  const provider = new ElixirProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('elixir');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Elixir');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.ex');
      expect(provider.extensions).toContain('.exs');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect defmodule', () => {
      const source = 'defmodule MyApp.Calculator do\n  def add(a, b), do: a + b\nend';
      const captures = provider.parse(source, 'calculator.ex');
      const modules = captures.filter((c) => c.properties?.isModule === 'true');
      expect(modules.some((c) => c.name === 'MyApp.Calculator')).toBe(true);
    });

    it('should detect def (public function)', () => {
      const source = 'defmodule User do\n  def greet(name), do: "Hello, #{name}"\nend';
      const captures = provider.parse(source, 'user.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
    });

    it('should detect defp (private function)', () => {
      const source = 'defmodule Helper do\n  defp internal_parse(data), do: data\nend';
      const captures = provider.parse(source, 'helper.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
        c.properties?.visibility === 'private');
      expect(funcs.some((c) => c.name === 'internal_parse')).toBe(true);
    });

    it('should detect defmacro', () => {
      const source = 'defmodule MyMacro do\n  defmacro my_macro(expr), do: expr\nend';
      const captures = provider.parse(source, 'macro.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
        c.properties?.isMacro === 'true');
      expect(funcs.some((c) => c.name === 'my_macro')).toBe(true);
    });

    it('should detect use/import/alias', () => {
      const source = 'defmodule MyModule do\n  use Ecto.Schema\n  import Ecto.Changeset\n  alias MyApp.User\nend';
      const captures = provider.parse(source, 'module.ex');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle .exs extension files', () => {
      const source = 'defmodule Script do\n  def run, do: :ok\nend';
      const captures = provider.parse(source, 'script.exs');
      expect(captures.some((c) => c.name === 'Script')).toBe(true);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.ex');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle nested modules', () => {
      const source = 'defmodule Outer do\n  defmodule Inner do\n    def value, do: 42\n  end\nend';
      const captures = provider.parse(source, 'outer.ex');
      const modules = captures.filter((c) => c.properties?.isModule === 'true');
      expect(modules.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractImports', () => {
    it('should extract use/import/alias', () => {
      const source = 'defmodule Test do\n  use SomeModule\n  import OtherModule\nend';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('should detect defmodule as exported', () => {
      expect(provider.isExported('defmodule MyModule do\nend', 'MyModule')).toBe(true);
    });

    it('should detect def as exported', () => {
      expect(provider.isExported('defmodule M do\n  def my_func, do: :ok\nend', 'my_func')).toBe(true);
    });

    it('should detect defp as not exported', () => {
      expect(provider.isExported('defmodule M do\n  defp private_func, do: nil\nend', 'private_func')).toBe(false);
    });
  });
});

// ============================================================================
// Lua Provider Tests
// ============================================================================

describe('LuaProvider', () => {
  const provider = new LuaProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('lua');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Lua');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.lua');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect function definitions', () => {
      const source = 'function greet(name)\n  return "Hello, " .. name\nend';
      const captures = provider.parse(source, 'test.lua');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
    });

    it('should detect local functions', () => {
      const source = 'local function helper()\n  return true\nend';
      const captures = provider.parse(source, 'test.lua');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
        c.properties?.isLocal === 'true');
      expect(funcs.some((c) => c.name === 'helper')).toBe(true);
    });

    it('should detect method definitions', () => {
      const source = 'function Table:method()\n  return self.value\nend';
      const captures = provider.parse(source, 'test.lua');
      const methods = captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(methods.some((c) => c.name?.includes('method'))).toBe(true);
    });

    it('should detect require statements', () => {
      const source = 'local http = require("http")\nlocal json = require("json")';
      const captures = provider.parse(source, 'test.lua');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'http')).toBe(true);
      expect(imports.some((c) => c.name === 'json')).toBe(true);
    });

    it('should detect local variables', () => {
      const source = 'local name = "World"\nlocal count = 42';
      const captures = provider.parse(source, 'test.lua');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle table-based functions', () => {
      const source = 'function Calculator.add(a, b)\n  return a + b\nend';
      const captures = provider.parse(source, 'test.lua');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF ||
        c.tag === CAPTURE_TAGS.METHOD_DEF);
      expect(funcs.some((c) => c.name?.includes('add'))).toBe(true);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.lua');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle colon syntax methods', () => {
      const source = 'function Obj:method(a, b)\n  return a + b\nend';
      const captures = provider.parse(source, 'test.lua');
      expect(captures.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractImports', () => {
    it('should extract require statements', () => {
      const source = 'require("module")\nrequire "another"';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isExported', () => {
    it('should detect global function as exported', () => {
      expect(provider.isExported('function greet() end', 'greet')).toBe(true);
    });

    it('should detect local function as not exported', () => {
      expect(provider.isExported('local function helper() end', 'helper')).toBe(false);
    });
  });
});

// ============================================================================
// Zig Provider Tests
// ============================================================================

describe('ZigProvider', () => {
  const provider = new ZigProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('zig');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Zig');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.zig');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect function definitions', () => {
      const source = 'fn add(a: i32, b: i32) i32 {\n  return a + b;\n}';
      const captures = provider.parse(source, 'test.zig');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should detect pub functions', () => {
      const source = 'pub fn main() void {\n  std.debug.print("Hello", .{});\n}';
      const captures = provider.parse(source, 'test.zig');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
        c.properties?.isPublic === 'true');
      expect(funcs.some((c) => c.name === 'main')).toBe(true);
    });

    it('should detect struct definitions', () => {
      const source = 'const Point = struct {\n  x: f64,\n  y: f64,\n};';
      const captures = provider.parse(source, 'test.zig');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Point')).toBe(true);
    });

    it('should detect enums', () => {
      const source = 'const Color = enum {\n  red,\n  green,\n  blue,\n};';
      const captures = provider.parse(source, 'test.zig');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should detect @import statements', () => {
      const source = 'const std = @import("std");';
      const captures = provider.parse(source, 'test.zig');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'std')).toBe(true);
    });

    it('should detect const variables', () => {
      const source = 'const APP_NAME = "MyApp";\nconst VERSION = 1;';
      const captures = provider.parse(source, 'test.zig');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect var variables', () => {
      const source = 'var counter: u32 = 0;';
      const captures = provider.parse(source, 'test.zig');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF &&
        c.properties?.isMutable === 'true');
      expect(vars.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.zig');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle pub struct', () => {
      const source = 'pub const Vector = struct {\n  x: i32,\n  y: i32,\n  z: i32,\n};';
      const captures = provider.parse(source, 'test.zig');
      const structs = captures.filter((c) => c.tag === CAPTURE_TAGS.STRUCT_DEF);
      expect(structs.some((c) => c.name === 'Vector')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract @import statements', () => {
      const source = 'const std = @import("std");\nconst math = @import("math");';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('should detect pub fn as exported', () => {
      expect(provider.isExported('pub fn init() void {}', 'init')).toBe(true);
    });

    it('should detect non-pub fn as not exported', () => {
      expect(provider.isExported('fn helper() void {}', 'helper')).toBe(false);
    });

    it('should detect pub struct as exported', () => {
      expect(provider.isExported('pub const Config = struct {};', 'Config')).toBe(true);
    });
  });
});

// ============================================================================
// Dart Provider Tests
// ============================================================================

describe('DartProvider', () => {
  const provider = new DartProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('dart');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Dart');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.dart');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should detect class definitions', () => {
      const source = 'class User {\n  final String name;\n  User(this.name);\n}';
      const captures = provider.parse(source, 'user.dart');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'User')).toBe(true);
    });

    it('should detect mixin definitions', () => {
      const source = 'mixin LoggerMixin {\n  void log(String msg) {}\n}';
      const captures = provider.parse(source, 'logger.dart');
      const mixins = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(mixins.some((c) => c.name === 'LoggerMixin')).toBe(true);
    });

    it('should detect enums', () => {
      const source = 'enum Color { red, green, blue }';
      const captures = provider.parse(source, 'color.dart');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('should detect function definitions', () => {
      const source = 'String greet(String name) {\n  return "Hello, $name";\n}';
      const captures = provider.parse(source, 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'greet')).toBe(true);
    });

    it('should detect arrow functions', () => {
      const source = 'int add(int a, int b) => a + b;';
      const captures = provider.parse(source, 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should detect import statements', () => {
      const source = 'import "dart:io";\nimport "package:http/http.dart";';
      const captures = provider.parse(source, 'test.dart');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect abstract class', () => {
      const source = 'abstract class Repository {\n  Future<List> findAll();\n}';
      const captures = provider.parse(source, 'repository.dart');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'Repository')).toBe(true);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.dart');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle async functions', () => {
      const source = 'Future<void> fetchData() async {\n  await Future.delayed(Duration(seconds: 1));\n}';
      const captures = provider.parse(source, 'test.dart');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fetchData')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract import statements', () => {
      const source = 'import "dart:core";\nimport "package:test/test.dart";';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('should detect public class as exported', () => {
      expect(provider.isExported('class MyClass {}', 'MyClass')).toBe(true);
    });

    it('should detect private (underscore-prefixed) as not exported', () => {
      expect(provider.isExported('class _InternalState {}', '_InternalState')).toBe(false);
    });

    it('should detect public function as exported', () => {
      expect(provider.isExported('void doWork() {}', 'doWork')).toBe(true);
    });
  });
});

// ============================================================================
// HCL / Terraform Provider Tests
// ============================================================================

describe('HclProvider', () => {
  const provider = new HclProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('hcl');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('HCL (Terraform)');
    });

    it('should have correct extensions', () => {
      expect(provider.extensions).toContain('.hcl');
      expect(provider.extensions).toContain('.tf');
      expect(provider.extensions).toContain('.tfvars');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse - Terraform resources', () => {
    it('should detect resource blocks', () => {
      const source = 'resource "aws_instance" "web" {\n  ami = "ami-123"\n  instance_type = "t2.micro"\n}';
      const captures = provider.parse(source, 'main.tf');
      const resources = captures.filter((c) =>
        c.properties?.iaCType === 'TerraformResource');
      expect(resources.some((c) => c.name === 'aws_instance.web')).toBe(true);
    });

    it('should detect data blocks', () => {
      const source = 'data "aws_ami" "ubuntu" {\n  most_recent = true\n}';
      const captures = provider.parse(source, 'data.tf');
      const dataSources = captures.filter((c) =>
        c.properties?.dataSource !== undefined);
      expect(dataSources.some((c) => c.name === 'aws_ami.ubuntu')).toBe(true);
    });

    it('should detect variable blocks', () => {
      const source = 'variable "region" {\n  type = string\n  default = "us-east-1"\n}';
      const captures = provider.parse(source, 'variables.tf');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'region')).toBe(true);
    });

    it('should detect output blocks', () => {
      const source = 'output "instance_ip" {\n  value = aws_instance.web.public_ip\n}';
      const captures = provider.parse(source, 'outputs.tf');
      const outputs = captures.filter((c) => c.properties?.isOutput === 'true');
      expect(outputs.some((c) => c.name === 'instance_ip')).toBe(true);
    });

    it('should detect provider blocks', () => {
      const source = 'provider "aws" {\n  region = "us-west-2"\n}';
      const captures = provider.parse(source, 'provider.tf');
      const providers = captures.filter((c) => c.properties?.isProvider === 'true');
      expect(providers.some((c) => c.name === 'aws')).toBe(true);
    });

    it('should detect module blocks', () => {
      const source = 'module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}';
      const captures = provider.parse(source, 'module.tf');
      const modules = captures.filter((c) => c.properties?.isModule === 'true');
      expect(modules.some((c) => c.name === 'vpc')).toBe(true);
    });

    it('should handle .tfvars files', () => {
      const source = 'region = "us-east-1"\ninstance_count = 3';
      const captures = provider.parse(source, 'terraform.tfvars');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle empty source', () => {
      const captures = provider.parse('', 'empty.tf');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle multiple resources', () => {
      const source = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`;
      const captures = provider.parse(source, 'network.tf');
      const resources = captures.filter((c) => c.properties?.iaCType === 'TerraformResource');
      expect(resources.some((c) => c.name === 'aws_vpc.main')).toBe(true);
      expect(resources.some((c) => c.name === 'aws_subnet.public')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract module sources', () => {
      const source = 'module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isExported', () => {
    it('should always return true for IaC', () => {
      expect(provider.isExported('resource "aws_instance" "web" {}', 'web')).toBe(true);
    });
  });
});

// ============================================================================
// Dockerfile Provider Tests
// ============================================================================

describe('DockerfileProvider', () => {
  const provider = new DockerfileProvider();

  describe('metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('dockerfile');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Dockerfile');
    });

    it('should have empty extensions (detected by filename)', () => {
      expect(provider.extensions).toEqual([]);
    });

    it('should have correct globs for Dockerfile detection', () => {
      expect(provider.globs).toContain('**/Dockerfile');
      expect(provider.globs).toContain('**/*.dockerfile');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse - FROM detection', () => {
    it('should detect FROM instruction', () => {
      const source = 'FROM ubuntu:22.04';
      const captures = provider.parse(source, 'Dockerfile');
      const froms = captures.filter((c) =>
        c.properties?.iaCType === 'DockerImage');
      expect(froms.some((c) => c.name === 'ubuntu:22.04')).toBe(true);
    });

    it('should detect FROM with AS alias', () => {
      const source = 'FROM node:18-alpine AS builder';
      const captures = provider.parse(source, 'Dockerfile');
      const froms = captures.filter((c) =>
        c.properties?.iaCType === 'DockerImage');
      expect(froms.some((c) =>
        c.properties?.baseImage === 'node:18-alpine' &&
        c.properties?.stage === 'builder'
      )).toBe(true);
    });

    it('should detect FROM with digest', () => {
      const source = 'FROM alpine@sha256:abc123';
      const captures = provider.parse(source, 'Dockerfile');
      const froms = captures.filter((c) =>
        c.properties?.iaCType === 'DockerImage');
      expect(froms.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('parse - RUN/COPY/ADD detection', () => {
    it('should detect RUN instruction', () => {
      const source = 'RUN apt-get update && apt-get install -y curl';
      const captures = provider.parse(source, 'Dockerfile');
      const runs = captures.filter((c) =>
        c.name === 'RUN' && c.properties?.instruction === 'RUN');
      expect(runs.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect COPY instruction', () => {
      const source = 'COPY package.json /app/';
      const captures = provider.parse(source, 'Dockerfile');
      const copies = captures.filter((c) =>
        c.name === 'COPY' && c.properties?.instruction === 'COPY');
      expect(copies.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect ADD instruction', () => {
      const source = 'ADD https://example.com/file.tar.gz /tmp/';
      const captures = provider.parse(source, 'Dockerfile');
      const adds = captures.filter((c) =>
        c.name === 'ADD' && c.properties?.instruction === 'ADD');
      expect(adds.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('parse - other instructions', () => {
    it('should detect CMD instruction', () => {
      const source = 'CMD ["node", "app.js"]';
      const captures = provider.parse(source, 'Dockerfile');
      const cmds = captures.filter((c) =>
        c.name === 'CMD' && c.properties?.instruction === 'CMD');
      expect(cmds.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect ENTRYPOINT instruction', () => {
      const source = 'ENTRYPOINT ["/docker-entrypoint.sh"]';
      const captures = provider.parse(source, 'Dockerfile');
      const entries = captures.filter((c) =>
        c.name === 'ENTRYPOINT' && c.properties?.instruction === 'ENTRYPOINT');
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect ENV instruction', () => {
      const source = 'ENV NODE_ENV=production';
      const captures = provider.parse(source, 'Dockerfile');
      const envs = captures.filter((c) =>
        c.properties?.instruction === 'ENV');
      expect(envs.some((c) => c.name === 'NODE_ENV')).toBe(true);
    });

    it('should detect ARG instruction', () => {
      const source = 'ARG VERSION=latest';
      const captures = provider.parse(source, 'Dockerfile');
      const args = captures.filter((c) =>
        c.properties?.instruction === 'ARG');
      expect(args.some((c) => c.name === 'VERSION')).toBe(true);
    });

    it('should detect EXPOSE instruction', () => {
      const source = 'EXPOSE 8080';
      const captures = provider.parse(source, 'Dockerfile');
      const exposes = captures.filter((c) =>
        c.properties?.instruction === 'EXPOSE');
      expect(exposes.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect WORKDIR instruction', () => {
      const source = 'WORKDIR /app';
      const captures = provider.parse(source, 'Dockerfile');
      const workdirs = captures.filter((c) =>
        c.properties?.instruction === 'WORKDIR');
      expect(workdirs.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect LABEL instruction', () => {
      const source = 'LABEL maintainer="dev@example.com"';
      const captures = provider.parse(source, 'Dockerfile');
      const labels = captures.filter((c) =>
        c.properties?.instruction === 'LABEL');
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect VOLUME instruction', () => {
      const source = 'VOLUME /data';
      const captures = provider.parse(source, 'Dockerfile');
      const volumes = captures.filter((c) =>
        c.properties?.instruction === 'VOLUME');
      expect(volumes.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect USER instruction', () => {
      const source = 'USER node';
      const captures = provider.parse(source, 'Dockerfile');
      const users = captures.filter((c) =>
        c.properties?.instruction === 'USER');
      expect(users.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('parse - multi-stage builds', () => {
    it('should detect multiple FROM stages', () => {
      const source = `FROM node:18 AS builder
WORKDIR /app
RUN npm install
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html`;
      const captures = provider.parse(source, 'Dockerfile');
      const froms = captures.filter((c) =>
        c.properties?.iaCType === 'DockerImage');
      expect(froms.length).toBe(2);
    });
  });

  describe('parse - edge cases', () => {
    it('should handle empty Dockerfile', () => {
      const captures = provider.parse('', 'Dockerfile');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle comments', () => {
      const source = '# This is a comment\nFROM alpine:latest\n# Another comment';
      const captures = provider.parse(source, 'Dockerfile');
      const froms = captures.filter((c) =>
        c.properties?.iaCType === 'DockerImage');
      expect(froms.length).toBe(1);
    });

    it('should handle .dockerfile extension files', () => {
      const source = 'FROM python:3.11-slim\nRUN pip install flask';
      const captures = provider.parse(source, 'App.dockerfile');
      const froms = captures.filter((c) =>
        c.properties?.iaCType === 'DockerImage');
      expect(froms.length).toBe(1);
    });
  });

  describe('extractImports', () => {
    it('should extract FROM images as imports', () => {
      const source = 'FROM ubuntu:22.04\nFROM nginx:latest';
      const imports = provider.extractImports(source);
      expect(imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isExported', () => {
    it('should always return true for Dockerfile', () => {
      expect(provider.isExported('FROM alpine:latest', 'alpine')).toBe(true);
    });
  });
});

// ============================================================================
// Language Detection from Filename Tests
// ============================================================================

describe('Language detection from filename', () => {
  describe('existing languages', () => {
    it('should detect C files', () => {
      expect(getLanguageFromFilename('main.c')).toBe('c');
      expect(getLanguageFromFilename('config.h')).toBe('c');
    });

    it('should detect C++ files', () => {
      expect(getLanguageFromFilename('main.cpp')).toBe('cpp');
      expect(getLanguageFromFilename('header.hpp')).toBe('cpp');
      expect(getLanguageFromFilename('source.cc')).toBe('cpp');
      expect(getLanguageFromFilename('legacy.cxx')).toBe('cpp');
      expect(getLanguageFromFilename('header.hh')).toBe('cpp');
      expect(getLanguageFromFilename('modern.hxx')).toBe('cpp');
    });

    it('should detect Dart files', () => {
      expect(getLanguageFromFilename('main.dart')).toBe('dart');
    });

    it('should detect Lua files', () => {
      expect(getLanguageFromFilename('main.lua')).toBe('lua');
    });

    it('should detect Scala files', () => {
      expect(getLanguageFromFilename('main.scala')).toBe('scala');
      expect(getLanguageFromFilename('script.sc')).toBe('scala');
    });

    it('should detect Zig files', () => {
      expect(getLanguageFromFilename('main.zig')).toBe('zig');
    });

    it('should detect Elixir files', () => {
      expect(getLanguageFromFilename('module.ex')).toBe('elixir');
      expect(getLanguageFromFilename('script.exs')).toBe('elixir');
    });
  });

  describe('new IaC languages', () => {
    it('should detect HCL/Terraform files', () => {
      expect(getLanguageFromFilename('main.hcl')).toBe('hcl');
      expect(getLanguageFromFilename('main.tf')).toBe('hcl');
      expect(getLanguageFromFilename('terraform.tfvars')).toBe('hcl');
    });

    it('should detect Dockerfile by name', () => {
      expect(getLanguageFromFilename('Dockerfile')).toBe('dockerfile');
      expect(getLanguageFromFilename('dev.Dockerfile')).toBe('dockerfile');
      expect(getLanguageFromFilename('prod.Dockerfile')).toBe('dockerfile');
    });

    it('should detect Dockerfile with .dockerfile extension', () => {
      expect(getLanguageFromFilename('App.dockerfile')).toBe('dockerfile');
    });

    it('should detect case-insensitive Dockerfile', () => {
      expect(getLanguageFromFilename('dockerfile')).toBe('dockerfile');
      expect(getLanguageFromFilename('DOCKERFILE')).toBe('dockerfile');
    });
  });

  describe('unknown files', () => {
    it('should return null for unknown extensions', () => {
      expect(getLanguageFromFilename('file.xyz')).toBeNull();
    });

    it('should return null for files without extensions', () => {
      expect(getLanguageFromFilename('Makefile')).toBeNull();
    });
  });
});

// ============================================================================
// Edge Cases & Robustness Tests
// ============================================================================

describe('Edge cases and robustness', () => {
  describe('empty files', () => {
    it('should handle empty files gracefully', () => {
      const providers = [
        new CppProvider(),
        new CProvider(),
        new DartProvider(),
        new LuaProvider(),
        new ScalaProvider(),
        new ZigProvider(),
        new ElixirProvider(),
        new HclProvider(),
        new DockerfileProvider(),
      ];
      for (const provider of providers) {
        const captures = provider.parse('', 'test');
        expect(Array.isArray(captures)).toBe(true);
      }
    });
  });

  describe('binary content', () => {
    it('should handle strings with null bytes', () => {
      const providers = [
        new CppProvider(),
        new CProvider(),
        new DartProvider(),
        new ZigProvider(),
        new ElixirProvider(),
        new HclProvider(),
        new DockerfileProvider(),
      ];
      for (const provider of providers) {
        const captures = provider.parse('\x00\x00\x00\x00', 'test');
        expect(Array.isArray(captures)).toBe(true);
      }
    });
  });

  describe('malformed syntax', () => {
    it('C++ should handle unmatched braces', () => {
      const provider = new CppProvider();
      const captures = provider.parse('class Foo {', 'test.cpp');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('Scala should handle unexpected tokens', () => {
      const provider = new ScalaProvider();
      const captures = provider.parse('class { def ', 'test.scala');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('Dockerfile should handle non-standard casing', () => {
      const provider = new DockerfileProvider();
      const captures = provider.parse('from ubuntu:latest\nrun echo test', 'Dockerfile');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('HCL should handle unclosed blocks', () => {
      const provider = new HclProvider();
      const captures = provider.parse('resource "aws_vpc" "main" {', 'test.tf');
      expect(Array.isArray(captures)).toBe(true);
    });
  });
});
