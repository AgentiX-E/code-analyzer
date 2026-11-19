// @code-analyzer/intelligence — the eleven languages the field asks about, seven of which this index did not read
//
// **The question names eleven languages and the index read four of them.** `symbols-langs.ts` walked TypeScript,
// JavaScript, Go, Python, C, C#, PHP, Java and Ruby; the seven missing ones are not exotic - Kotlin is what Android is
// written in, Swift is what iOS is, Groovy is what a Gradle build is, ArkTS is what HarmonyOS is, and **JSON, YAML and
// XML are what every repository is configured in**. §87 measured the two of them that the martian key files most; this
// file is the measurement for the other seven.
//
// **What each one is allowed to claim is the language's own rule and not a house rule.** Kotlin's `internal` and
// Swift's absence of `public` both mean "not offered to other modules", and Groovy and Swift spell a method's name
// after its return type the way C does. **A scanner that answered all seven with TypeScript's `export` keyword would
// report every Kotlin file as private**, which is a fact about the scanner rather than about the file.
//
// **The three documents are read as keys and not as declarations.** A `package.json` has no functions; it has keys, and
// "the claim on line 42 is about `scripts.test`" is a fact that can be established by opening the file. Claiming it
// under the kind `key` is what keeps that fact separate from "this file declares a function" - the distinction a
// consumer needs, because the two answer different questions about where a claim stands.

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex, languageOf, symbolAt } from '../symbols.js';

/** The names and kinds of a file's declarations, in source order. */
function declared(path: string, lines: readonly string[]): string[] {
  const index = buildSymbolIndex(path, lines.join('\n'));
  return index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);
}

describe('the extension a language is written with', () => {
  it('names all eleven, and keeps answering the ones it does not read with unknown', () => {
    expect(
      [
        'a.java',
        'a.js',
        'a.ts',
        'a.py',
        'build.gradle',
        'pom.xml',
        'ci.yml',
        'package.json',
        'Main.kt',
        'App.swift',
        'pages/Index.ets',
      ].map((path) => `${path}=${languageOf(path)}`),
    ).toEqual([
      'a.java=java',
      'a.js=javascript',
      'a.ts=typescript',
      'a.py=python',
      'build.gradle=groovy',
      'pom.xml=xml',
      'ci.yml=yaml',
      'package.json=json',
      'Main.kt=kotlin',
      'App.swift=swift',
      'pages/Index.ets=arkts',
    ]);
    expect(languageOf('Dockerfile')).toBe('unknown');
    expect(languageOf('notes.txt')).toBe('unknown');
  });
});

describe('Kotlin, which spells a function fun and a module-private name internal', () => {
  const file = [
    'package matrix',
    '',
    'import kotlinx.coroutines.Flow',
    '',
    'const val LIMIT = 10',
    '',
    'private const val SECRET = 1',
    '',
    'interface Drawable {',
    '    fun draw()',
    '}',
    '',
    'enum class Color { RED, GREEN }',
    '',
    '/** A widget. */',
    'data class Widget(val label: String) : Drawable {',
    '    override fun draw() {',
    '        helper(label)',
    '    }',
    '',
    '    val size: Int = 1',
    '}',
    '',
    'fun topLevel(name: String): String {',
    '    val local = helper(name)',
    '    return local',
    '}',
    '',
    'fun <T> identity(value: T): T = value',
    '',
    'fun String.shout(): String = helper(this)',
    '',
    'object Registry {',
    '    fun register() {}',
    '}',
    '',
    'typealias Alias = Widget',
    '',
  ];

  it('reads the type, the function, the object, the enum and the alias', () => {
    expect(declared('Matrix.kt', file)).toEqual([
      'const:LIMIT',
      'const:SECRET',
      'interface:Drawable',
      'type:Color',
      'class:Widget',
      'function:topLevel',
      'function:identity',
      'function:shout',
      'class:Registry',
      'type:Alias',
    ]);
  });

  it('offers the names a caller can reach and withholds the two that are file or module private', () => {
    const index = buildSymbolIndex('Matrix.kt', file.join('\n'));
    // **`private` and `internal` are both withheld**, and the second one is Kotlin's own rule rather than a guess:
    // `internal` means "visible in this module", which is what `exported` has meant since the first scanner.
    expect(index.exported).toEqual([
      'LIMIT',
      'Drawable',
      'Color',
      'Widget',
      'topLevel',
      'identity',
      'shout',
      'Registry',
      'Alias',
    ]);
  });

  it('reads a primary constructor parameter that is a val as the property it declares', () => {
    const index = buildSymbolIndex('Matrix.kt', file.join('\n'));
    const widget = index.symbols.find((symbol) => symbol.name === 'Widget')!;
    expect(widget.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:label',
      'method:draw',
      'property:size',
    ]);
  });

  it('gives an expression body the one line it occupies rather than the rest of the file', () => {
    const index = buildSymbolIndex('Matrix.kt', file.join('\n'));
    const identity = index.symbols.find((symbol) => symbol.name === 'identity')!;
    expect(identity.startLine).toBe(identity.endLine);
    expect(index.uncertain).toBe(false);
  });

  it('reads a receiver written before the function name as the name and not as the receiver', () => {
    const index = buildSymbolIndex('Matrix.kt', file.join('\n'));
    const shout = index.symbols.find((symbol) => symbol.name === 'shout')!;
    // **`fun String.shout(` declares `shout`**, and a reader that took the first word after `fun` would answer
    // `String` - a type that is in the file and is not what the function is called.
    expect(shout.signature).toContain('fun String.shout()');
  });

  it('reads a nested type as a declaration of its own rather than as a member of the one around it', () => {
    const index = buildSymbolIndex(
      'Outer.kt',
      ['class Outer {', '    class Inner {', '        fun deep() {}', '    }', '}', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Outer',
      'class:Inner',
    ]);
    expect(index.symbols[1]!.members.map((member) => member.name)).toEqual(['deep']);
  });
});

describe('Groovy, which is what a Gradle build and a Jenkinsfile are written in', () => {
  const file = [
    'package demo',
    '',
    '@CompileStatic',
    'class Widget implements Drawable {',
    '    String label = "x"',
    '    private int attempts = 0',
    '',
    '    Widget(String label) {',
    '        this.label = label',
    '    }',
    '',
    '    def draw() {',
    '        helper(label)',
    '    }',
    '',
    '    static void main(String[] args) {',
    '        new Widget("y").draw()',
    '    }',
    '}',
    '',
    'interface Drawable {',
    '    void draw()',
    '}',
    '',
    'trait Labelled {',
    '    String label = "z"',
    '}',
    '',
    'enum Color {',
    '    RED, GREEN',
    '}',
    '',
    'def topLevel(name) {',
    '    helper(name)',
    '}',
    '',
  ];

  it('reads a class, an interface, a trait, an enum and a script-level def', () => {
    expect(declared('build.gradle', file)).toEqual([
      'class:Widget',
      'interface:Drawable',
      'interface:Labelled',
      'type:Color',
      'function:topLevel',
    ]);
  });

  it('reads a member behind a modifier, behind a type, and behind nothing but def', () => {
    const index = buildSymbolIndex('build.gradle', file.join('\n'));
    const widget = index.symbols.find((symbol) => symbol.name === 'Widget')!;
    expect(widget.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:label',
      'property:attempts',
      'constructor:Widget',
      'method:draw',
      'method:main',
    ]);
  });

  it('withholds a member a class keeps to itself, and offers the rest', () => {
    const index = buildSymbolIndex(
      'build.gradle',
      ['class A {', '    private void hidden() {}', '    void shown() {}', '}', ''].join('\n'),
    );
    // **`exported` is a property of the file's declarations and not of its members**, so the member list carries the
    // modifier and this assertion is about the type the file offers.
    expect(index.exported).toEqual(['A']);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['hidden', 'shown']);
  });
});

describe('the two declarations the oracle found and the tests had not', () => {
  it('reads a Groovy annotation type as the interface it is', () => {
    const index = buildSymbolIndex(
      'AutoExternalize.groovy',
      [
        '@Retention(RetentionPolicy.RUNTIME)',
        '@interface AutoExternalize {',
        '    String value()',
        '}',
        '',
      ].join('\n'),
    );
    // **`@interface` is one token in Groovy and Java**, and the guard that skips a decorator line skipped this too - so a
    // file that declares nothing but an annotation type reported no declaration at all.
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'interface:AutoExternalize',
    ]);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['value']);
  });

  it('reads an abstract class in TypeScript and in ArkTS', () => {
    const ts = buildSymbolIndex(
      'src/base.ts',
      ['export abstract class Base {', '  abstract run(): void;', '}', ''].join('\n'),
    );
    // **`abstract` sits between `export` and `class`**, and a prefix that allowed only `export`, `default` and `declare`
    // read the line as starting with a word it did not know.
    expect(ts.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(['class:Base']);
    const arkts = buildSymbolIndex(
      'pages/Base.ets',
      ['@Component', 'export abstract struct Base {', '  build() {}', '}', ''].join('\n'),
    );
    expect(arkts.symbols.map((symbol) => symbol.name)).toEqual(['Base']);
  });
});

describe('Swift, which spells a type struct, protocol and extension and writes no export keyword', () => {
  const file = [
    'import Foundation',
    '',
    'public let LIMIT = 10',
    '',
    'public protocol Drawable {',
    '    func draw()',
    '}',
    '',
    'public struct Widget: Drawable {',
    '    var label: String',
    '    private var attempts: Int = 0',
    '',
    '    public init(label: String) {',
    '        self.label = label',
    '    }',
    '',
    '    public func draw() {',
    '        helper(label)',
    '    }',
    '}',
    '',
    'enum Color: String {',
    '    case red',
    '}',
    '',
    'extension Widget {',
    '    func shout() -> String {',
    '        helper(label)',
    '    }',
    '}',
    '',
    'internal func hidden() {}',
    '',
    'public func topLevel(name: String) -> String {',
    '    let local = helper(name)',
    '    return local',
    '}',
    '',
  ];

  it('reads the protocol, the struct, the enum, the extension and the two functions', () => {
    expect(declared('App.swift', file)).toEqual([
      'const:LIMIT',
      'interface:Drawable',
      'class:Widget',
      'type:Color',
      'class:Widget',
      'function:hidden',
      'function:topLevel',
    ]);
  });

  it('offers only what is public or open, because internal is not visible outside the module', () => {
    const index = buildSymbolIndex('App.swift', file.join('\n'));
    expect(index.exported).toEqual(['LIMIT', 'Drawable', 'Widget', 'topLevel']);
  });

  it('reads init as the constructor of the type that names it, and a var as a property', () => {
    const index = buildSymbolIndex('App.swift', file.join('\n'));
    const widget = index.symbols.find((symbol) => symbol.name === 'Widget')!;
    expect(widget.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:label',
      'property:attempts',
      'constructor:Widget',
      'method:draw',
    ]);
  });

  it('reads an extension as a range in the type it extends without offering the name twice', () => {
    const index = buildSymbolIndex('App.swift', file.join('\n'));
    const extensions = index.symbols.filter((symbol) => symbol.name === 'Widget');
    // **Two symbols and one exported name**, because an extension adds members to a type rather than declaring a new
    // one - and a witness that says "inside Widget" is more useful than no symbol at all on those lines.
    expect(extensions).toHaveLength(2);
    expect(extensions[1]!.members.map((member) => member.name)).toEqual(['shout']);
    expect(index.exported.filter((name) => name === 'Widget')).toHaveLength(1);
  });

  it('reads a func whose name is written with a generic clause', () => {
    const index = buildSymbolIndex(
      'Generic.swift',
      ['func identity<T>(_ value: T) -> T {', '    return value', '}', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['identity']);
  });
});

describe('ArkTS, which is TypeScript with a struct and a decorator', () => {
  const page = [
    'import { hilog } from "@kit.PerformanceAnalysisKit";',
    '',
    '@Entry',
    '@Component',
    'export struct Index {',
    '  @State count: number = 0;',
    '  private label: string = "x";',
    '',
    '  build() {',
    '    Column() {',
    '      Text(this.label)',
    '    }',
    '  }',
    '}',
    '',
    'export function helper(name: string): string {',
    '  return name;',
    '}',
    '',
  ];

  it('reads the struct as a type and the function beside it', () => {
    expect(declared('pages/Index.ets', page)).toEqual(['class:Index', 'function:helper']);
  });

  it('reads a decorated field as the property it declares rather than as an assignment', () => {
    const index = buildSymbolIndex('pages/Index.ets', page.join('\n'));
    const struct = index.symbols[0]!;
    // **`@State count: number = 0` declares `count`**, and a reader that looked for the `=` first would answer `0`.
    expect(struct.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:count',
      'property:label',
      'method:build',
    ]);
  });

  it('keeps reading a .ts file as TypeScript, where a struct is not a declaration', () => {
    const index = buildSymbolIndex(
      'src/a.ts',
      ['export struct Index {', '  build() {}', '}', '', 'export function run() {}', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['run']);
  });
});

describe('JSON, read as the keys a line stands in', () => {
  const manifest = [
    '{',
    '  "name": "demo",',
    '  "scripts": {',
    '    "build": "tsc -p .",',
    '    "test": "vitest run"',
    '  },',
    '  "files": [',
    '    {',
    '      "path": "dist",',
    '      "mode": 420',
    '    }',
    '  ]',
    '}',
    '',
  ];

  it('reads every key, top level and nested, and holds the nested ones under the key that contains them', () => {
    const index = buildSymbolIndex('package.json', manifest.join('\n'));
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'key:name',
      'key:scripts',
      'key:build',
      'key:test',
      'key:files',
      'key:path',
      'key:mode',
    ]);
    const scripts = index.symbols[1]!;
    expect(scripts.members.map((member) => member.name)).toEqual(['build', 'test']);
    // **Only the three top-level keys are offered**, because an inner key is reachable through the key above it and a
    // document that listed them all would say it offers seven names where a reader can reach three.
    expect(index.exported).toEqual(['name', 'scripts', 'files']);
  });

  it('answers which key a line stands in, down to the innermost one', () => {
    const index = buildSymbolIndex('package.json', manifest.join('\n'));
    expect(symbolAt(index, 4)?.name).toBe('build');
    expect(symbolAt(index, 9)?.name).toBe('path');
    // **The bracket is what makes this the interesting case**: `"files": [` opens an array, and a range counted in braces
    // alone would end the key on the line that opens it.
    expect(index.symbols[4]!.endLine).toBe(12);
  });

  it('names the key a line starts with, and does not name a second key sharing that line', () => {
    const index = buildSymbolIndex(
      'a.json',
      ['{', '  "a": { "b": 1 },', '  "c": 2', '}', ''].join('\n'),
    );
    // **`b` is on `a`'s line and is not claimed**, because the index answers "which key does line N stand in" and a line
    // that holds two keys has two answers. A minified manifest is the same fact at the scale of the whole file: it is
    // read as having no key at all, which is the answer that says nothing rather than the one that says something false.
    expect(
      index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}-${symbol.endLine}`),
    ).toEqual(['a@2-2', 'c@3-3']);
    expect(symbolAt(buildSymbolIndex('a.json', '{"a":1,"b":2}'), 1)).toBeNull();
  });

  it('reads a file whose top level is an array as having no key of its own', () => {
    const index = buildSymbolIndex(
      'a.json',
      ['[', '  { "a": 1 },', '  { "a": 2 }', ']', ''].join('\n'),
    );
    // **An array has no key**, so the objects in it are answered with nothing: the index does not invent a name for a
    // position the file does not name.
    expect(index.symbols).toEqual([]);
    expect(index.language).toBe('json');
  });
});

describe('YAML, read by indentation, where the block sequence is the shape that matters', () => {
  const workflow = [
    'name: CI',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Checkout',
    '        uses: actions/checkout@v4',
    '      - name: Test',
    '        run: pnpm test',
    '',
  ];

  it('reads every key, and holds the ones a sequence item carries under the key that owns the sequence', () => {
    const index = buildSymbolIndex('.github/workflows/ci.yml', workflow.join('\n'));
    expect(index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}`)).toEqual([
      'name@1',
      'on@3',
      'push@4',
      'branches@5',
      'jobs@7',
      'build@8',
      'runs-on@9',
      'steps@10',
      'name@11',
      'uses@12',
      'name@13',
      'run@14',
    ]);
    expect(index.exported).toEqual(['name', 'on', 'jobs']);
  });

  it('gives a key with nothing after its colon the block that follows, and a key with a value one line', () => {
    const index = buildSymbolIndex('.github/workflows/ci.yml', workflow.join('\n'));
    const byLine = new Map(index.symbols.map((symbol) => [symbol.startLine, symbol]));
    // **This is the rule that keeps `uses:` a sibling of `name:` rather than its child**: a key whose value is written on
    // its own line occupies that line, so the deeper line that follows belongs to the sequence item around it.
    expect(byLine.get(10)!.endLine).toBe(14);
    expect(byLine.get(11)!.endLine).toBe(11);
    expect(byLine.get(8)!.endLine).toBe(14);
    expect(byLine.get(5)!.endLine).toBe(5);
  });

  it('answers which key a line stands in', () => {
    const index = buildSymbolIndex('.github/workflows/ci.yml', workflow.join('\n'));
    expect(symbolAt(index, 12)?.name).toBe('uses');
    expect(symbolAt(index, 9)?.name).toBe('runs-on');
  });

  it('reads a tab as the four columns a reader would see, so a tab-indented block still nests', () => {
    const index = buildSymbolIndex('a.yml', ['parent:', '\tchild: 1', ''].join('\n'));
    // **Tabs are not YAML indentation**, and a file that has one is answered wide rather than narrow: the child is read
    // as a child, which is the direction that keeps a block from ending early.
    expect(index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}`)).toEqual([
      'parent@1',
      'child@2',
    ]);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['child']);
  });

  it('does not read a comment, a blank line or a bare sequence item as a key', () => {
    const index = buildSymbolIndex(
      'a.yml',
      ['# a comment: not a key', '', 'items:', '  - one', '  - two', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['items']);
    expect(index.symbols[0]!.endLine).toBe(5);
  });
});

describe('XML, read as the elements a line stands in', () => {
  const pom = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- <not-an-element> -->',
    '<project>',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>demo</groupId>',
    '  <dependencies>',
    '    <dependency>',
    '      <groupId>junit</groupId>',
    '    </dependency>',
    '  </dependencies>',
    '  <build/>',
    '</project>',
    '',
  ];

  it('reads every element and gives each one the range its closing tag ends', () => {
    const index = buildSymbolIndex('pom.xml', pom.join('\n'));
    expect(
      index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}-${symbol.endLine}`),
    ).toEqual([
      'project@3-12',
      'modelVersion@4-4',
      'groupId@5-5',
      'dependencies@6-10',
      'dependency@7-9',
      'groupId@8-8',
      'build@11-11',
    ]);
    const project = index.symbols[0]!;
    expect(project.members.map((member) => member.name)).toEqual([
      'modelVersion',
      'groupId',
      'dependencies',
      'build',
    ]);
  });

  it('does not read a tag inside a comment as an element', () => {
    const index = buildSymbolIndex('pom.xml', pom.join('\n'));
    expect(index.symbols.some((symbol) => symbol.name === 'not-an-element')).toBe(false);
  });

  it('answers which element a line stands in', () => {
    const index = buildSymbolIndex('pom.xml', pom.join('\n'));
    expect(symbolAt(index, 8)?.name).toBe('groupId');
    expect(symbolAt(index, 3)?.name).toBe('project');
  });
});

describe('the shapes the first pass over the seven did not read', () => {
  it('withholds a Kotlin type and a Kotlin function that carry a modifier of their own', () => {
    const index = buildSymbolIndex(
      'Hidden.kt',
      [
        'private class Hidden',
        '',
        'internal class ModuleOnly',
        '',
        'private fun secret() = 1',
        '',
        'fun offered() = 2',
        '',
      ].join('\n'),
    );
    // **`private class Hidden` has no braces and no members**, which is a Kotlin shape a reader of C would not expect:
    // the declaration ends with its name and the next declaration begins.
    expect(index.symbols.map((symbol) => symbol.name)).toEqual([
      'Hidden',
      'ModuleOnly',
      'secret',
      'offered',
    ]);
    expect(index.exported).toEqual(['offered']);
  });

  it('reads a Kotlin fun interface as the interface it is', () => {
    const index = buildSymbolIndex(
      'Handler.kt',
      ['fun interface Handler {', '    fun handle(id: String)', '}', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'interface:Handler',
    ]);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['handle']);
  });

  it('reads a Kotlin secondary constructor as the constructor of its class', () => {
    const index = buildSymbolIndex(
      'Widget.kt',
      ['class Widget(val label: String) {', '    constructor() : this("x")', '}', ''].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:label',
      'constructor:Widget',
    ]);
  });

  it('reads a Kotlin primary constructor whose parameter list wrapped onto the next line', () => {
    const index = buildSymbolIndex(
      'Widget.kt',
      ['class Widget(', '    val label: String,', ') {', '    fun draw() {}', '}', ''].join('\n'),
    );
    // **The parameter list is not on the declaration's line**, so the properties it declares are not claimed; what is
    // claimed is the type and the method inside it, which is the fact the file states on lines that exist.
    expect(index.symbols[0]!.name).toBe('Widget');
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['draw']);
  });

  it('reads a Kotlin declaration whose parameter list never closes as the one line it wrote', () => {
    const index = buildSymbolIndex('Half.kt', 'class Widget(\n');
    // **A half-written line is a shape a diff carries**, and the answer is the declaration's own line rather than a range
    // that runs to the end of a file whose last line is the one that never closed.
    expect(
      index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}-${symbol.endLine}`),
    ).toEqual(['Widget@1-1']);
  });

  it('withholds a Groovy type and a Groovy script function that are private', () => {
    const index = buildSymbolIndex(
      'build.gradle',
      ['private class Hidden {}', '', 'private def secret() {}', '', 'def offered() {}', ''].join(
        '\n',
      ),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['Hidden', 'secret', 'offered']);
    expect(index.exported).toEqual(['offered']);
  });

  it('withholds a Swift binding that is private', () => {
    const index = buildSymbolIndex(
      'Constants.swift',
      ['private let SECRET = 1', 'let INTERNAL_DEFAULT = 2', 'public let OFFERED = 3', ''].join(
        '\n',
      ),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual([
      'SECRET',
      'INTERNAL_DEFAULT',
      'OFFERED',
    ]);
    // **A `let` with no modifier is `internal`**, which stops at the module boundary, so only the third is offered.
    expect(index.exported).toEqual(['OFFERED']);
  });

  it('does not read a file it has no scanner for as having no declarations it can name', () => {
    const index = buildSymbolIndex('Dockerfile', 'FROM node:22\nRUN pnpm build\n');
    expect(index.language).toBe('unknown');
    expect(index.symbols).toEqual([]);
    expect(index.exported).toEqual([]);
  });
});

describe('the shapes a document writes at its edges', () => {
  it('does not read a comment that spans lines as an element', () => {
    const index = buildSymbolIndex(
      'a.xml',
      ['<project>', '<!--', '  <fake>', '-->', '  <real/>', '</project>', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['project', 'real']);
  });

  it('ignores a closing tag whose element was never opened', () => {
    const index = buildSymbolIndex('a.xml', ['<a>', '</b>', '</a>', ''].join('\n'));
    // **A stray `</b>` is answered with nothing rather than by closing `a`**, which is the reading that would make every
    // later element a child of the wrong one.
    expect(
      index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}-${symbol.endLine}`),
    ).toEqual(['a@1-3']);
  });

  it('reads two elements written on one line as two, ordered by the one that encloses the other', () => {
    const index = buildSymbolIndex('a.xml', ['<a><b>x</b></a>', ''].join('\n'));
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['a', 'b']);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['b']);
  });

  it('reads a document whose only element is self-closing as one element at the top level', () => {
    const index = buildSymbolIndex('a.xml', ['<root/>', ''].join('\n'));
    expect(index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}`)).toEqual(['root@1']);
    expect(index.exported).toEqual(['root']);
  });
});

describe('the documents a half-written diff leaves', () => {
  it('keeps the child of an element the file never closed, and reports it as top level', () => {
    const index = buildSymbolIndex('a.xml', ['<a>', '  <b>x</b>', ''].join('\n'));
    // **`a` was opened and never closed**, so it is not an element this scanner can give a range to. Its child is, and the
    // child's parent is an element that does not exist - which is answered as "no parent" rather than by pointing at
    // whichever element happened to be first.
    expect(index.symbols.map((symbol) => `${symbol.name}@${symbol.startLine}`)).toEqual(['b@2']);
    expect(index.exported).toEqual(['b']);
  });
});
