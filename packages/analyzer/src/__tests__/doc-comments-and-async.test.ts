import { describe, expect, it } from 'vitest';

import { CppProvider } from '../languages/cpp.js';
import { CSharpProvider } from '../languages/csharp.js';
import { DartProvider } from '../languages/dart.js';
import { ElixirProvider } from '../languages/elixir.js';
import { GoProvider } from '../languages/go.js';
import { JavaProvider } from '../languages/java.js';
import { JavaScriptProvider } from '../languages/javascript.js';
import { KotlinProvider } from '../languages/kotlin.js';
import { LuaProvider } from '../languages/lua.js';
import { PhpProvider } from '../languages/php.js';
import { PythonProvider } from '../languages/python.js';
import { RubyProvider } from '../languages/ruby.js';
import { RustProvider } from '../languages/rust.js';
import { ScalaProvider } from '../languages/scala.js';
import { SwiftProvider } from '../languages/swift.js';
import { ZigProvider } from '../languages/zig.js';

import type { LanguageProvider } from '../languages/provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

interface Case {
  readonly language: string;
  readonly provider: () => LanguageProvider;
  readonly file: string;
  readonly source: string;
  /** The name the documentation is written above, and the declaration that must end up carrying it. */
  readonly documented: string;
}

/**
 * `Docstrings/JSDoc` was `✅` for seventeen languages and **three of them emitted one**.
 *
 * The fourteen below are the ones that did not: TypeScript, JavaScript and Python each map their own comment nodes, and
 * every other walk was written for declarations — a comment reached no branch and was dropped, so a Javadoc block above
 * a class was parsed, forgotten, and the row that claimed it was read as a measurement. The fix is a stage in `parse`
 * rather than a branch in each walk, for the reason the signature pass is one: twenty providers replace
 * `walkAndCapture`, so a branch reaches the two that use the base one and no others.
 *
 * **What each case asserts is the fact the row names** — the text reaches the declaration, not just the capture list —
 * because a docstring nobody can look up is a comment.
 */
const CASES: readonly Case[] = [
  {
    language: 'Java',
    provider: () => new JavaProvider(),
    file: 'A.java',
    source: '/** A widget. */\npublic class Widget {\n  public void draw() {}\n}\n',
    documented: 'Widget',
  },
  {
    language: 'Kotlin',
    provider: () => new KotlinProvider(),
    file: 'A.kt',
    source: '/** A widget. */\nclass Widget {\n    fun draw() {}\n}\n',
    documented: 'Widget',
  },
  {
    language: 'C#',
    provider: () => new CSharpProvider(),
    file: 'A.cs',
    source: '/// <summary>A widget.</summary>\npublic class Widget { public void Draw() {} }\n',
    documented: 'Widget',
  },
  {
    language: 'Rust',
    provider: () => new RustProvider(),
    file: 'a.rs',
    source: '/// A widget.\npub struct Widget;\n',
    documented: 'Widget',
  },
  {
    language: 'Go',
    provider: () => new GoProvider(),
    file: 'a.go',
    source: 'package m\n\n// Widget is a widget.\ntype Widget struct{}\n',
    documented: 'Widget',
  },
  {
    language: 'PHP',
    provider: () => new PhpProvider(),
    file: 'a.php',
    source: '<?php\n/** A widget. */\nclass Widget {}\n',
    documented: 'Widget',
  },
  {
    language: 'Ruby',
    provider: () => new RubyProvider(),
    file: 'a.rb',
    source: '# A widget.\nclass Widget\nend\n',
    documented: 'Widget',
  },
  {
    language: 'C/C++',
    provider: () => new CppProvider(),
    file: 'a.cpp',
    source: '/** A widget. */\nclass Widget {};\n',
    documented: 'Widget',
  },
  {
    language: 'Swift',
    provider: () => new SwiftProvider(),
    file: 'a.swift',
    source: '/// A widget.\nclass Widget {}\n',
    documented: 'Widget',
  },
  {
    language: 'Scala',
    provider: () => new ScalaProvider(),
    file: 'a.scala',
    source: '/** A widget. */\nclass Widget\n',
    documented: 'Widget',
  },
  {
    language: 'Dart',
    provider: () => new DartProvider(),
    file: 'a.dart',
    source: '/// A widget.\nclass Widget {}\n',
    documented: 'Widget',
  },
  {
    language: 'Lua',
    provider: () => new LuaProvider(),
    file: 'a.lua',
    source: '-- A widget.\nlocal Widget = {}\n',
    documented: 'Widget',
  },
  {
    language: 'Zig',
    provider: () => new ZigProvider(),
    file: 'a.zig',
    source: '/// A widget.\nconst Widget = struct {};\n',
    documented: 'Widget',
  },
  {
    language: 'Elixir',
    provider: () => new ElixirProvider(),
    file: 'a.ex',
    source: 'defmodule A do\n  @doc "A widget."\n  def widget, do: 1\nend\n',
    documented: 'widget',
  },
];

const docstringOf = (captures: readonly UnifiedCapture[], name: string): string | undefined =>
  captures.find((capture) => capture.name === name && capture.properties?.docstring !== undefined)
    ?.properties?.docstring;

describe('a comment a declaration is documented with', () => {
  for (const testCase of CASES) {
    it(`reaches the ${testCase.language} declaration it documents`, () => {
      const captures = testCase.provider().parse(testCase.source, testCase.file);
      expect(captures.filter((capture) => capture.tag === 'docstring').length).toBeGreaterThan(0);
      expect(docstringOf(captures, testCase.documented)).toMatch(/widget/i);
    });
  }

  /**
   * **Two rules, and the difference is what each reader can see.** A tree-based provider knows which declaration
   * contains which node, so the nearest declaration *after* the comment owns it whether or not a blank line separates
   * them; a text-based provider has only adjacency, so it stops at a blank line. Both are stated here rather than
   * smoothed into one rule, because a reader comparing a Java docstring with a Dart one would otherwise see a
   * difference the code does not explain.
   */
  it('attaches across a blank line in a tree-based provider', () => {
    const captures = new JavaProvider().parse('/** A widget. */\n\nclass Widget {}', 'A.java');
    expect(docstringOf(captures, 'Widget')).toBe('A widget.');
  });

  it('does not attach across a blank line in a text-based provider', () => {
    const captures = new DartProvider().parse('/// A widget.\n\nclass Widget {}', 'a.dart');
    expect(docstringOf(captures, 'Widget')).toBeUndefined();
  });

  it('keeps a comment that documents nothing rather than attaching it to the next declaration', () => {
    const captures = new JavaProvider().parse('// nothing follows\n', 'A.java');
    expect(captures.filter((capture) => capture.tag === 'docstring')).toHaveLength(1);
  });
});

/**
 * **Where the collection pass has to stop, and each case is a language that draws the line differently.**
 *
 * `Docstrings/JSDoc` was a row of the matrix, and the pass that made it true for seventeen languages could make it false
 * for two of them in the same stroke: a `//` line is documentation in Go and a note to the next reader in JavaScript, and
 * the grammar spells both `comment`. These are the four boundaries that decision has.
 */
describe('what a comment may become documentation for', () => {
  it('does not attach a plain line comment in JavaScript, where JSDoc is the doubled star', () => {
    const captures = new JavaScriptProvider().parse('// TODO: rename\nfunction f() {}', 'a.js');
    expect(docstringOf(captures, 'f')).toBeUndefined();
  });

  it('attaches a JSDoc block in JavaScript', () => {
    const captures = new JavaScriptProvider().parse(
      '/** Greets a name. */\nfunction f() {}',
      'a.js',
    );
    expect(docstringOf(captures, 'f')).toBe('Greets a name.');
  });

  it('does not attach an ordinary comment in C#, where the compiler reads three slashes', () => {
    const captures = new CSharpProvider().parse('// just a note\nclass Widget {}', 'a.cs');
    expect(docstringOf(captures, 'Widget')).toBeUndefined();
  });

  it('attaches an XML documentation comment in C#', () => {
    const captures = new CSharpProvider().parse('/// A widget.\nclass Widget {}', 'a.cs');
    expect(docstringOf(captures, 'Widget')).toBe('A widget.');
  });

  it('collects no docstring for a comment with no text in it', () => {
    const captures = new JavaProvider().parse('/** */\nclass Widget {}', 'A.java');
    expect(captures.filter((capture) => capture.tag === 'docstring')).toHaveLength(0);
    expect(docstringOf(captures, 'Widget')).toBeUndefined();
  });

  /**
   * **A doc comment is a block and a line comment is one line of it.** Go documents a function with three `//` lines and
   * Godoc renders all three; a pass that kept the last line would hand the index the third sentence of a paragraph.
   */
  it('joins a run of line comments into one docstring', () => {
    const captures = new GoProvider().parse(
      '// Adds two numbers.\n// It is intentionally simple.\nfunc Add(a, b int) int { return a + b }',
      'a.go',
    );
    expect(docstringOf(captures, 'Add')).toBe('Adds two numbers.\nIt is intentionally simple.');
  });

  it('does not join comments separated by a blank line', () => {
    const captures = new GoProvider().parse(
      '// A note about the file.\n\n// Adds two numbers.\nfunc Add(a, b int) int { return a + b }',
      'a.go',
    );
    expect(docstringOf(captures, 'Add')).toBe('Adds two numbers.');
  });

  /**
   * **The docstring is at the top of the body, so a comment further down cannot be more specific than it.** Python writes
   * both as captures and both are inside the function's range; without the first-wins rule the last `# note` in a body
   * would replace the paragraph that describes the function.
   */
  it('keeps the documented docstring when a comment follows it inside the body', () => {
    const captures = new PythonProvider().parse(
      'def kinetic_energy(m):\n    """Energy of a mass."""\n    # note about the arithmetic\n    return m\n',
      'a.py',
    );
    expect(docstringOf(captures, 'kinetic_energy')).toBe('Energy of a mass.');
  });
});

describe('a declaration that says it is asynchronous', () => {
  const asyncCases: readonly [string, () => LanguageProvider, string, string, string][] = [
    ['Python', () => new PythonProvider(), 'a.py', 'async def later():\n    return 1\n', 'later'],
    ['Kotlin', () => new KotlinProvider(), 'a.kt', 'suspend fun later(): Int = 1\n', 'later'],
    ['C#', () => new CSharpProvider(), 'a.cs', 'class A { public async void Later() {} }', 'Later'],
    ['Rust', () => new RustProvider(), 'a.rs', 'pub async fn later() -> u8 { 1 }', 'later'],
    [
      'Swift',
      () => new SwiftProvider(),
      'a.swift',
      'public func later() async -> Int { 1 }',
      'later',
    ],
    [
      'Dart',
      () => new DartProvider(),
      'a.dart',
      'Future<int> later() async {\n  return 1;\n}',
      'later',
    ],
  ];

  for (const [language, provider, file, source, name] of asyncCases) {
    it(`is marked as such in ${language}`, () => {
      const captures = provider().parse(source, file);
      const declaration = captures.find((capture) => capture.name === name)!;
      const marker = declaration.properties?.async ?? declaration.properties?.isAsync;
      expect(marker).toBe('true');
    });
  }

  it('does not mark a synchronous declaration', () => {
    const captures = new KotlinProvider().parse('fun later(): Int = 1\n', 'a.kt');
    expect(captures.find((capture) => capture.name === 'later')!.properties?.async).toBeUndefined();
  });
});
