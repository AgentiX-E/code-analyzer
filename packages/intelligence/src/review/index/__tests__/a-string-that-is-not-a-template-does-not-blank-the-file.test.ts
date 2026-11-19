// @code-analyzer/intelligence — a backtick is a string in four languages and a character in the other twelve
//
// **The lexer had one idea of what a backtick is and every language was measured by it.** In TypeScript, JavaScript,
// ArkTS and Go a backtick opens a template or a raw string and the state persists to the closing one - which is what
// lets a template literal hold a brace without the depth counter seeing it. **In the other twelve it is a character**,
// and a state that persisted anyway swallowed the rest of the file.
//
// **The measurement that found it: `cmd.py` from the Python 3.11 standard library indexed as zero symbols.** Its
// docstring contains `3. A command \`foo' is dispatched to a method 'do_foo()'` on line eight, the backtick opened a
// template, and every line after it - 393 of 401, including `__all__`, three module constants and the class the file
// exists for - was blanked as string content. **It is not one file**: this is what reStructuredText does in a docstring,
// and Python's own library does it in `configparser.py`, `code.py` and `compileall.py` as well.
//
// **The same walk had no long-string state**, so a Python `"""` block, a Kotlin raw string and a Java text block were
// eight separate single-quoted strings: a brace on one of their lines was counted as a brace, and a symbol that starts
// under such a block was read at the wrong depth - **the failure direction the whole module refuses**, since a symbol
// that ends early hides the guard that would have refuted a claim.

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex } from '../symbols.js';

const names = (path: string, text: string): string[] =>
  buildSymbolIndex(path, text).symbols.map((symbol) => symbol.name);

describe('a backtick outside the four languages that mean something by it', () => {
  it('does not blank the rest of a Python file from a docstring', () => {
    // The `cmd.py` shape, reduced to what it takes to reproduce: one docstring line quoting a command, and the
    // declarations the file exists for written after it.
    const source = [
      '"""A command interpreter.',
      '',
      "3. A command `foo' is dispatched to a method 'do_foo()'.",
      '"""',
      '',
      '__all__ = ["Cmd"]',
      '',
      'PROMPT = "(Cmd) "',
      '',
      'class Cmd:',
      '    pass',
    ].join('\n');
    expect(names('cmd.py', source)).toEqual(expect.arrayContaining(['__all__', 'PROMPT', 'Cmd']));
  });

  it('does not blank the rest of a Ruby file from a backtick command', () => {
    // A backtick runs a command in Ruby and opens nothing. **The method is a member rather than a top-level symbol** -
    // which is why the assertion reads the member list, and why the fixture has a module around it at all.
    const source = ['module Tools', '  def run', '    `ls -l`', '  end', 'end'].join('\n');
    const index = buildSymbolIndex('tool.rb', source);
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['Tools']);
    expect(index.symbols[0]?.members.map((member) => member.name)).toEqual(['run']);
  });

  it('still reads a Go raw string as a string, braces and all', () => {
    // Go's backtick is a raw string and it spans lines, so the state has to persist there - **a fix that removed the
    // state everywhere would have traded one wrong answer for another.**
    const source = [
      'package main',
      '',
      'var template = `',
      '{ "a": 1 }',
      '`',
      '',
      'func main() {',
      '}',
    ].join('\n');
    expect(names('main.go', source)).toEqual(expect.arrayContaining(['template', 'main']));
  });

  it('still reads a TypeScript template literal as a string, braces and all', () => {
    const source = [
      'export const template = `',
      '{ unbalanced',
      '`;',
      '',
      'export function after() {}',
    ].join('\n');
    expect(names('template.ts', source)).toEqual(expect.arrayContaining(['template', 'after']));
  });
});

describe('a string written over several lines is one string', () => {
  it('keeps a Kotlin raw string from moving the depth a later declaration stands at', () => {
    // `"""` opens a raw string that may hold a brace; without the state the `{` on its own line is a brace, and the
    // top-level function under it is read at depth one and dropped.
    const source = [
      'val template = """',
      '    {',
      '""".trimIndent()',
      '',
      'fun after(): Int = 0',
    ].join('\n');
    expect(names('raw.kt', source)).toContain('after');
  });

  it('keeps a Python docstring from moving the depth of what follows it', () => {
    const source = [
      '"""Docstring with a brace:',
      '',
      '{',
      '"""',
      '',
      'def after():',
      '    pass',
    ].join('\n');
    expect(names('doc.py', source)).toContain('after');
  });

  it('keeps a Java text block from moving the depth of what follows it', () => {
    const source = [
      'class Template {',
      '  String body = """',
      '      {',
      '      """;',
      '}',
      '',
      'class After {}',
    ].join('\n');
    expect(names('Template.java', source)).toContain('After');
  });

  it('closes the long string on the line it closes, and reads what follows it', () => {
    // `"""` on one line and `"""; const x = 1` on another: the declaration after the closing delimiter is code.
    const source = ['const doc = """', 'text', '""";', 'const after = 1;'].join('\n');
    expect(names('block.ts', source)).toContain('after');
  });
});
