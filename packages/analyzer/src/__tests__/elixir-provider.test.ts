import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { ElixirProvider } from '../languages/elixir.js';

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
  });

  describe('isExported', () => {
    it('should report public def as exported', () => {
      expect(provider.isExported('def hello do\nend', 'hello')).toBe(true);
    });

    it('should report defp as not exported', () => {
      expect(provider.isExported('defp secret do\nend', 'secret')).toBe(false);
    });

    it('should report a non-matching symbol as not exported', () => {
      expect(provider.isExported('def hello do\nend', 'other')).toBe(false);
    });
  });
});
