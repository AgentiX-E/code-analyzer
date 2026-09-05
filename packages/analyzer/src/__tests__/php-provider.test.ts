import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { PhpProvider } from '../languages/php.js';

describe('PhpProvider', () => {
  const provider = new PhpProvider();

  describe('metadata', () => {
    it('has correct language name', () => {
      expect(provider.language).toBe('php');
      expect(provider.displayName).toBe('PHP');
    });

    it('has correct extensions', () => {
      expect(provider.extensions).toContain('.php');
      expect(provider.extensions).toContain('.phtml');
    });

    it('uses named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse (tree-sitter)', () => {
    it('detects functions', () => {
      const captures = provider.parse('function hello() { return "hi"; }', 'test.php');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((f) => f.name === 'hello')).toBe(true);
    });

    it('detects classes', () => {
      const captures = provider.parse(
        'class MyClass {\n  public function method() {}\n}',
        'test.php',
      );
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.some((c) => c.name === 'MyClass')).toBe(true);
    });

    it('detects interfaces', () => {
      const captures = provider.parse(
        'interface MyInterface {\n  public function doSomething();\n}',
        'test.php',
      );
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.some((c) => c.name === 'MyInterface')).toBe(true);
    });

    it('detects traits', () => {
      const captures = provider.parse(
        'trait Loggable {\n  public function log($msg) {}\n}',
        'test.php',
      );
      const traits = captures.filter((c) => c.tag === CAPTURE_TAGS.TRAIT_DEF);
      expect(traits.some((c) => c.name === 'Loggable')).toBe(true);
    });

    it('detects enums', () => {
      const captures = provider.parse('enum Color {\n  case Red;\n  case Green;\n}', 'test.php');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.some((c) => c.name === 'Color')).toBe(true);
    });

    it('detects imports (use statements)', () => {
      const captures = provider.parse('use App\\Models\\User;\nclass Test {}', 'test.php');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('handles empty source', () => {
      const captures = provider.parse('', 'empty.php');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('parses source that already has a PHP opening tag', () => {
      const captures = provider.parse('<?php function tagged() { return 1; }', 'tagged.php');
      expect(captures.some((c) => c.name === 'tagged')).toBe(true);
    });

    it('parses source with a short echo tag', () => {
      const captures = provider.parse('<?= $value ?>', 'echo.php');
      expect(Array.isArray(captures)).toBe(true);
    });
  });

  describe('extractImports (tree-sitter)', () => {
    it('extracts a single use statement', () => {
      const imports = provider.extractImports('use App\\Models\\User;');
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('App\\Models\\User');
      expect(imports[0].names).toEqual(['User']);
      expect(imports[0].type).toBe('named');
    });

    it('extracts an aliased use statement', () => {
      const imports = provider.extractImports('use App\\Models\\User as U;');
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('App\\Models\\User');
      expect(imports[0].names).toEqual(['U']);
    });

    it('extracts multiple clauses in one use statement', () => {
      const imports = provider.extractImports('use App\\A, App\\B;');
      expect(imports).toHaveLength(2);
      expect(imports.map((i) => i.source)).toEqual(['App\\A', 'App\\B']);
    });

    it('extracts use function declarations', () => {
      const imports = provider.extractImports('use function App\\helper;');
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('App\\helper');
      expect(imports[0].names).toEqual(['helper']);
    });

    it('extracts use const declarations', () => {
      const imports = provider.extractImports('use const App\\CONSTANT;');
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('App\\CONSTANT');
      expect(imports[0].names).toEqual(['CONSTANT']);
    });

    it('extracts grouped imports with a base namespace', () => {
      const imports = provider.extractImports('use App\\Models\\{User, Post};');
      expect(imports).toHaveLength(2);
      expect(imports.map((i) => i.source)).toEqual(['App\\Models\\User', 'App\\Models\\Post']);
      expect(imports[0].names).toEqual(['User']);
      expect(imports[1].names).toEqual(['Post']);
    });

    it('extracts grouped imports with an alias', () => {
      const imports = provider.extractImports('use App\\Models\\{User, Post as P};');
      expect(imports).toHaveLength(2);
      expect(imports[1].source).toBe('App\\Models\\Post');
      expect(imports[1].names).toEqual(['P']);
    });

    it('extracts single-quoted include', () => {
      const imports = provider.extractImports("include 'config.php';");
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('config.php');
      expect(imports[0].type).toBe('default');
    });

    it('extracts double-quoted include', () => {
      const imports = provider.extractImports('include "config.php";');
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('config.php');
    });

    it('extracts parenthesized require', () => {
      const imports = provider.extractImports('require("lib.php");');
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('lib.php');
    });

    it('extracts parenthesized require_once with single quotes', () => {
      const imports = provider.extractImports("require_once('lib.php');");
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('lib.php');
    });

    it('extracts include_once', () => {
      const imports = provider.extractImports("include_once 'helpers.php';");
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('helpers.php');
    });

    it('returns no imports for import-free source', () => {
      expect(provider.extractImports('$x = 1;')).toHaveLength(0);
    });

    it('skips a use clause with an empty name (malformed use function)', () => {
      const imports = provider.extractImports('use function;');
      expect(imports).toHaveLength(0);
    });

    it('skips a grouped clause with an empty name (malformed group)', () => {
      const imports = provider.extractImports('use App\\Models\\{function};');
      expect(imports).toHaveLength(0);
    });
  });

  describe('isExported (tree-sitter)', () => {
    it('detects a public method', () => {
      expect(provider.isExported('class Foo { public function handle() {} }', 'handle')).toBe(true);
    });

    it('rejects a private method', () => {
      expect(provider.isExported('class Foo { private function secret() {} }', 'secret')).toBe(
        false,
      );
    });

    it('rejects a protected method', () => {
      expect(provider.isExported('class Foo { protected function helper() {} }', 'helper')).toBe(
        false,
      );
    });

    it('treats a method without a visibility modifier as public', () => {
      expect(provider.isExported('class Foo { function plain() {} }', 'plain')).toBe(true);
    });

    it('detects a class', () => {
      expect(provider.isExported('class MyService {}', 'MyService')).toBe(true);
    });

    it('detects an interface', () => {
      expect(provider.isExported('interface Contract {}', 'Contract')).toBe(true);
    });

    it('detects a trait', () => {
      expect(provider.isExported('trait Loggable {}', 'Loggable')).toBe(true);
    });

    it('detects an enum', () => {
      expect(provider.isExported('enum Color {}', 'Color')).toBe(true);
    });

    it('detects a top-level function', () => {
      expect(provider.isExported('function run() {}', 'run')).toBe(true);
    });

    it('detects a nested method through recursion', () => {
      expect(provider.isExported('class Foo {\n  public function nested() {}\n}', 'nested')).toBe(
        true,
      );
    });

    it('returns false for a missing symbol', () => {
      expect(provider.isExported('class Foo {}', 'Missing')).toBe(false);
    });
  });

  describe('fallbackParse (regex fallback)', () => {
    it('extracts functions', () => {
      const captures = provider.fallbackParse('function alpha() {}\nfunction beta() {}', 'f.php');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.map((f) => f.name)).toEqual(['alpha', 'beta']);
    });

    it('extracts plain, abstract, and final classes', () => {
      const captures = provider.fallbackParse(
        'class Plain {}\nabstract class Abs {}\nfinal class Fin {}',
        'c.php',
      );
      const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
      expect(classes.map((c) => c.name)).toEqual(['Plain', 'Abs', 'Fin']);
    });

    it('extracts interfaces', () => {
      const captures = provider.fallbackParse('interface Contract {}', 'i.php');
      const ifaces = captures.filter((c) => c.tag === CAPTURE_TAGS.INTERFACE_DEF);
      expect(ifaces.map((c) => c.name)).toEqual(['Contract']);
    });

    it('extracts traits', () => {
      const captures = provider.fallbackParse('trait Loggable {}', 't.php');
      const traits = captures.filter((c) => c.tag === CAPTURE_TAGS.TRAIT_DEF);
      expect(traits.map((c) => c.name)).toEqual(['Loggable']);
    });

    it('extracts enums', () => {
      const captures = provider.fallbackParse('enum Color {}', 'e.php');
      const enums = captures.filter((c) => c.tag === CAPTURE_TAGS.ENUM_DEF);
      expect(enums.map((c) => c.name)).toEqual(['Color']);
    });

    it('extracts variables with de-duplication and skips $this', () => {
      const captures = provider.fallbackParse('$x = 1; $x = 2; $this->go(); $y = 3;', 'v.php');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.map((v) => v.name)).toEqual(['x', 'y']);
    });

    it('extracts imports through the fallback parser', () => {
      const captures = provider.fallbackParse('use App\\Models\\User;', 'u.php');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.some((i) => i.name === 'App\\Models\\User')).toBe(true);
    });

    it('extracts doc comments', () => {
      const captures = provider.fallbackParse('/**\n * Doc block\n */\nfunction x() {}', 'd.php');
      const docs = captures.filter((c) => c.tag === CAPTURE_TAGS.DOCSTRING);
      expect(docs).toHaveLength(1);
    });

    it('sorts captures by line then byte', () => {
      const captures = provider.fallbackParse('function first() {}\nclass Second {}', 's.php');
      expect(captures[0].name).toBe('first');
    });

    it('handles empty source', () => {
      expect(provider.fallbackParse('', 'empty.php')).toEqual([]);
    });
  });

  describe('fallbackExtractImports (regex fallback)', () => {
    it('extracts single and aliased use statements', () => {
      const imports = provider.fallbackExtractImports(
        'use App\\Models\\User;\nuse App\\Models\\User as U;',
      );
      expect(imports).toHaveLength(2);
      expect(imports[0].names).toEqual(['User']);
      expect(imports[1].names).toEqual(['U']);
    });

    it('extracts use function and use const', () => {
      const imports = provider.fallbackExtractImports(
        'use function App\\helper;\nuse const App\\CONST;',
      );
      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('App\\helper');
      expect(imports[1].source).toBe('App\\CONST');
    });

    it('extracts grouped imports', () => {
      const imports = provider.fallbackExtractImports('use App\\Models\\{User, Post as P};');
      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('App\\Models\\User');
      expect(imports[1].source).toBe('App\\Models\\Post');
      expect(imports[1].names).toEqual(['P']);
    });

    it('extracts require and include variants', () => {
      const imports = provider.fallbackExtractImports(
        "require 'a.php';\nrequire_once \"b.php\";\ninclude('c.php');\ninclude_once('d.php');",
      );
      expect(imports).toHaveLength(4);
      expect(imports.map((i) => i.source)).toEqual(['a.php', 'b.php', 'c.php', 'd.php']);
      expect(imports.every((i) => i.type === 'default')).toBe(true);
    });

    it('handles empty source', () => {
      expect(provider.fallbackExtractImports('')).toHaveLength(0);
    });
  });

  describe('fallbackIsExported (regex fallback)', () => {
    it('detects a public function', () => {
      expect(provider.fallbackIsExported('public function handle() {}', 'handle')).toBe(true);
    });

    it('detects a function without a modifier', () => {
      expect(provider.fallbackIsExported('function run() {}', 'run')).toBe(true);
    });

    it('detects a class', () => {
      expect(provider.fallbackIsExported('class Service {}', 'Service')).toBe(true);
    });

    it('detects an interface', () => {
      expect(provider.fallbackIsExported('interface Contract {}', 'Contract')).toBe(true);
    });

    it('detects a trait', () => {
      expect(provider.fallbackIsExported('trait Loggable {}', 'Loggable')).toBe(true);
    });

    it('rejects a private function', () => {
      expect(provider.fallbackIsExported('private function secret() {}', 'secret')).toBe(false);
    });

    it('rejects a protected function', () => {
      expect(provider.fallbackIsExported('protected function guard() {}', 'guard')).toBe(false);
    });

    it('returns false for a symbol that is not declared at all', () => {
      expect(provider.fallbackIsExported('class Foo {}', 'Nonexistent')).toBe(false);
    });

    it('escapes special regex characters in the symbol name', () => {
      expect(provider.fallbackIsExported('function foo.bar() {}', 'foo.bar')).toBe(true);
    });
  });

  describe('parse falls back to regex on malformed source', () => {
    it('uses the regex fallback when tree-sitter reports a syntax error', () => {
      const captures = provider.parse('function broken(', 'broken.php');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((f) => f.name === 'broken')).toBe(true);
    });
  });
});
