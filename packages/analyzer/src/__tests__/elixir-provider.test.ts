import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { ElixirProvider } from '../languages/elixir.js';

/** ElixirProvider with tree-sitter disabled, forcing the regex fallback path. */
class RegexElixirProvider extends ElixirProvider {
  constructor() {
    super();
    // Force the regex fallback by clearing the tree-sitter parser and grammar.
    this.parser = null;
    this.languageGrammar = null;
  }
}

describe('ElixirProvider', () => {
  const provider = new ElixirProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('elixir');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Elixir');
    });

    it('should have .ex and .exs extensions', () => {
      expect(provider.extensions).toContain('.ex');
      expect(provider.extensions).toContain('.exs');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — modules', () => {
    it('should extract a defmodule as class definition', () => {
      const code = 'defmodule MyApp do\nend';
      const captures = provider.parse(code, 'my_app.ex');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyApp')).toBe(true);
    });

    it('should extract a nested defmodule path', () => {
      const code = 'defmodule MyApp.Users do\nend';
      const captures = provider.parse(code, 't.ex');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyApp.Users')).toBe(true);
    });

    it('should extract nested defmodules by walking into the do block', () => {
      const code = 'defmodule A do\n  defmodule B do\n  end\nend';
      const captures = provider.parse(code, 't.ex');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'A')).toBe(true);
      expect(classes.some((c) => c.name === 'B')).toBe(true);
    });

    it('should skip a quoted-atom module name', () => {
      const code = 'defmodule :"Elixir.Foo" do\nend';
      const captures = provider.parse(code, 't.ex');
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes).toHaveLength(0);
    });
  });

  describe('parse — functions', () => {
    it('should extract a public def without params', () => {
      const code = 'def hello do\n  :world\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'hello' && c.properties?.visibility === 'public')).toBe(
        true,
      );
    });

    it('should extract a public def with params', () => {
      const code = 'def add(a, b) do\n  a + b\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should extract a private defp as private function', () => {
      const code = 'defp secret(x) do\n  x\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'secret' && c.properties?.visibility === 'private')).toBe(
        true,
      );
    });

    it('should extract a defmacro with isMacro flag', () => {
      const code = 'defmacro unless(expr) do\n  expr\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'unless' && c.properties?.isMacro === 'true')).toBe(true);
    });

    it('should extract a guarded function with params', () => {
      const code = 'def add(x) when x > 0 do\n  x\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'add')).toBe(true);
    });

    it('should extract a guarded function without params', () => {
      const code = 'def hello when x > 0 do\n  :ok\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'hello')).toBe(true);
    });

    it('should extract a guarded private function', () => {
      const code = 'defp secret(x) when is_integer(x) do\n  x\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'secret' && c.properties?.visibility === 'private')).toBe(
        true,
      );
    });

    it('should skip an operator definition', () => {
      const code = 'def a + b, do: c\n';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(0);
    });

    it('should skip an operator definition with a guard clause', () => {
      const code = 'def a + b when a > 0 do\nend\n';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs).toHaveLength(0);
    });

    it('should not double-capture a nested call inside a function body', () => {
      const code = 'def foo do\n  bar()\nend';
      const captures = provider.parse(code, 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.filter((c) => c.name === 'foo')).toHaveLength(1);
      expect(funcs.filter((c) => c.name === 'bar')).toHaveLength(0);
    });
  });

  describe('parse — imports', () => {
    it('should extract use as import', () => {
      const code = 'defmodule A do\n  use GenServer\nend';
      const captures = provider.parse(code, 't.ex');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'GenServer')).toBe(true);
    });

    it('should extract import as import', () => {
      const code = 'defmodule A do\n  import Enum\nend';
      const captures = provider.parse(code, 't.ex');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'Enum')).toBe(true);
    });

    it('should extract alias with a dotted path', () => {
      const code = 'defmodule A do\n  alias MyApp.User\nend';
      const captures = provider.parse(code, 't.ex');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'MyApp.User')).toBe(true);
    });

    it('should skip a dotted multi-alias', () => {
      const code = 'alias MyApp.{Foo, Bar}\n';
      const captures = provider.parse(code, 't.ex');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(0);
    });
  });

  describe('parse — remote and anonymous calls', () => {
    it('should ignore a remote call', () => {
      const captures = provider.parse('String.upcase("x")\n', 't.ex');
      expect(captures).toHaveLength(0);
    });

    it('should ignore an anonymous function call', () => {
      const captures = provider.parse('(fn x -> x end).()\n', 't.ex');
      expect(captures).toHaveLength(0);
    });
  });

  describe('extractImports', () => {
    it('should extract use/import/alias/require modules', () => {
      const code = 'defmodule A do\n  use GenServer\n  alias MyApp.User\n  require Logger\nend';
      const imports = provider.extractImports(code, 't.ex');
      expect(imports.some((i) => i.source === 'GenServer')).toBe(true);
      expect(imports.some((i) => i.source === 'MyApp.User')).toBe(true);
      expect(imports.some((i) => i.source === 'Logger')).toBe(true);
    });

    it('should return empty for code without imports', () => {
      expect(provider.extractImports('x = 1', 't.ex')).toEqual([]);
    });

    it('should ignore a remote call while walking', () => {
      expect(provider.extractImports('String.upcase("x")', 't.ex')).toEqual([]);
    });

    it('should skip an atom module argument', () => {
      expect(provider.extractImports('use :foo', 't.ex')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should report public def as exported', () => {
      expect(provider.isExported('def hello do\nend', 'hello')).toBe(true);
    });

    it('should report a public def with params as exported', () => {
      expect(provider.isExported('def add(a, b) do\nend', 'add')).toBe(true);
    });

    it('should report a guarded def as exported', () => {
      expect(provider.isExported('def add(x) when x > 0 do\nend', 'add')).toBe(true);
    });

    it('should report defmacro as exported', () => {
      expect(provider.isExported('defmacro unless(expr) do\nend', 'unless')).toBe(true);
    });

    it('should report defmodule as exported', () => {
      expect(provider.isExported('defmodule MyApp do\nend', 'MyApp')).toBe(true);
    });

    it('should report a non-matching module as not exported', () => {
      expect(provider.isExported('defmodule MyApp do\nend', 'Other')).toBe(false);
    });

    it('should report a remote call symbol as not exported', () => {
      expect(provider.isExported('String.upcase("x")\n', 'upcase')).toBe(false);
    });

    it('should report defp as not exported', () => {
      expect(provider.isExported('defp secret do\nend', 'secret')).toBe(false);
    });

    it('should report a non-matching symbol as not exported', () => {
      expect(provider.isExported('def hello do\nend', 'other')).toBe(false);
    });

    it('should report an operator definition as not exported', () => {
      expect(provider.isExported('def a + b, do: c\n', 'a')).toBe(false);
    });
  });

  describe('fallback (regex)', () => {
    const fallback = new RegexElixirProvider();

    it('should parse modules and functions', () => {
      const code = 'defmodule MyApp do\n  def hello do\n  end\n  defp secret do\n  end\nend';
      const captures = fallback.parse(code, 't.ex');
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.CLASS_DEF && c.name === 'MyApp')).toBe(
        true,
      );
      expect(
        captures.some(
          (c) =>
            c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
            c.name === 'hello' &&
            c.properties?.visibility === 'public',
        ),
      ).toBe(true);
      expect(
        captures.some(
          (c) =>
            c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
            c.name === 'secret' &&
            c.properties?.visibility === 'private',
        ),
      ).toBe(true);
    });

    it('should parse defmacro', () => {
      const captures = fallback.parse('defmacro unless(expr) do\nend', 't.ex');
      expect(
        captures.some(
          (c) =>
            c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
            c.name === 'unless' &&
            c.properties?.isMacro === 'true',
        ),
      ).toBe(true);
    });

    it('should parse use/import/alias as imports', () => {
      const captures = fallback.parse('use GenServer\nimport Enum\nalias MyApp.User\n', 't.ex');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((c) => c.name === 'GenServer')).toBe(true);
      expect(imports.some((c) => c.name === 'Enum')).toBe(true);
      expect(imports.some((c) => c.name === 'MyApp.User')).toBe(true);
    });

    it('should sort captures by position', () => {
      const captures = fallback.parse('def b do\nend\ndef a do\nend', 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('should sort same-line captures by byte offset', () => {
      const captures = fallback.parse('def a, do: 1; def b, do: 2', 't.ex');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((c) => c.name)).toEqual(['a', 'b']);
    });

    it('should return empty captures for empty source', () => {
      expect(fallback.parse('', 't.ex')).toEqual([]);
    });

    it('should extract imports including require', () => {
      const imports = fallback.extractImports('use GenServer\nrequire Logger\n', 't.ex');
      expect(imports.some((i) => i.source === 'GenServer')).toBe(true);
      expect(imports.some((i) => i.source === 'Logger')).toBe(true);
    });

    it('should return empty imports for code without imports', () => {
      expect(fallback.extractImports('x = 1', 't.ex')).toEqual([]);
    });

    it('should report def/defmacro/defmodule as exported', () => {
      expect(fallback.isExported('def hello do\nend', 'hello')).toBe(true);
      expect(fallback.isExported('defmacro unless do\nend', 'unless')).toBe(true);
      expect(fallback.isExported('defmodule MyApp do\nend', 'MyApp')).toBe(true);
    });

    it('should report defp and non-matches as not exported', () => {
      expect(fallback.isExported('defp secret do\nend', 'secret')).toBe(false);
      expect(fallback.isExported('def hello do\nend', 'other')).toBe(false);
    });

    it('should escape regex metacharacters in the symbol', () => {
      expect(fallback.isExported('def hello do\nend', 'hel(o')).toBe(false);
    });
  });
});
