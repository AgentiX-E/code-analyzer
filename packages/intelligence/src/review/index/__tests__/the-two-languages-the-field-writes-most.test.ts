// The two languages the field writes most were the two the index could not read
//
// **The count that forced this file, taken from the artifact rather than from an opinion.** On the 481 distinct paths
// `benchmarks/martian-bench.json` filed a finding against, `.java` is 75 (15.6 %) and `.rb` is 57 (11.9 %), and
// `.js.es6` is 13 more. `languageOf` answered all three with `unknown`, so **47.2 % of the files this benchmark scores
// stood where the index had nothing to say** - and the witness device §86.7 registered needs exactly that: a witness
// names *which declaration* a defect walks into, and a file whose declarations the index cannot name has no name to
// give.
//
// **What these scanners may claim is what the five before them claimed**, and nothing more: a name, the lines it
// occupies, whether the file offers it to another file, and which declarations sit inside it - each of them checkable
// by opening the file. Java answers `exported` with the `public` modifier, which is the language's own rule. **Ruby has
// no such rule at all**, so its answer is the one that is true rather than borrowed: a top-level `class`, `module` or
// `def` is reachable from any file that requires this one, and a nested constant is reachable as `Outer::Inner`.
//
// **The failure direction is the one `symbols.ts` fixed in advance.** Ruby ends a block with `end` rather than with a
// brace or an indentation, and the counting is done on the blanked, comment-stripped code so that **a `end` inside a
// heredoc body is not an `end`** - the case that would truncate a method early and hide the guard a claim would have
// been refuted by.

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex, languageOf, symbolAt } from '../symbols.js';

const JAVA = [
  'package com.example.claim;',
  '',
  'import java.util.List;',
  'import java.util.Map;',
  'import java.util.concurrent.ConcurrentHashMap;',
  '',
  '/** A store of claims. */',
  'public final class ClaimStore implements Store {',
  '    private static final int RETRY_LIMIT = 3;',
  '    private final Map<String, Entry> entries = new ConcurrentHashMap<>();',
  '',
  '    public ClaimStore(List<Entry> seed) {',
  '        for (final Entry entry : seed) {',
  '            entries.put(entry.id(), entry);',
  '        }',
  '    }',
  '',
  '    @Override',
  '    public Entry claim(String id) {',
  '        if (id == null) {',
  '            throw new IllegalArgumentException("id");',
  '        }',
  '        return entries.get(id);',
  '    }',
  '',
  '    private void touch(Entry entry) {',
  '        entry.attempts++;',
  '    }',
  '}',
  '',
  'interface Store {',
  '    Entry claim(String id);',
  '}',
  '',
  'enum Mode {',
  '    FAST,',
  '    SLOW',
  '}',
  '',
].join('\n');

const RUBY = [
  '# frozen_string_literal: true',
  '',
  'module Billing',
  '  RETRY_LIMIT = 3',
  '',
  '  class Charge',
  '    attr_reader :amount, :currency',
  '',
  '    def initialize(id)',
  '      @id = id',
  '      @amount = 0',
  '    end',
  '',
  '    def claim(id)',
  '      raise ArgumentError if id.nil?',
  '      true',
  '    end',
  '',
  '    def self.kinds',
  '      %w[card cash]',
  '    end',
  '',
  '    private',
  '',
  '    def settle',
  '      @amount',
  '    end',
  '  end',
  'end',
  '',
  'def helper(x)',
  '  x',
  'end',
  '',
].join('\n');

describe('the paths the field scores that the index answered with unknown', () => {
  it('reads the two languages the corpus is mostly written in', () => {
    expect(languageOf('core/src/main/java/ClaimStore.java')).toBe('java');
    expect(languageOf('app/models/charge.rb')).toBe('ruby');
  });

  it('reads the extensions those two languages are spelled with beside their own', () => {
    expect(languageOf('db/migrate.rake')).toBe('ruby');
    expect(languageOf('config.ru')).toBe('ruby');
    expect(languageOf('charge.gemspec')).toBe('ruby');
    expect(languageOf('tasks.thor')).toBe('ruby');
  });

  it('reads a path whose last extension is the one that names the language', () => {
    // `app/assets/javascripts/store.js.es6` is JavaScript, and it is the *last* extension that says so: a mapping keyed
    // on `.js` would answer this file with `unknown` while the file it names is 13 of the 481.
    expect(languageOf('app/assets/javascripts/store.js.es6')).toBe('javascript');
  });
});

describe('Java, read as declarations', () => {
  const index = buildSymbolIndex('src/main/java/ClaimStore.java', JAVA);

  it('reads the classes, interfaces and enums a file declares', () => {
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:ClaimStore',
      'interface:Store',
      'type:Mode',
    ]);
  });

  it('reads the lines each declaration occupies', () => {
    expect(index.symbols.map((symbol) => [symbol.startLine, symbol.endLine])).toEqual([
      [8, 29],
      [31, 33],
      [35, 38],
    ]);
  });

  it('reads a field, a call-initialised field, a constructor and two methods as the members they are', () => {
    const store = index.symbols[0]!;
    expect(store.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:RETRY_LIMIT',
      'property:entries',
      'constructor:ClaimStore',
      'method:claim',
      'method:touch',
    ]);
  });

  it('reads public as exported and the absence of it as not', () => {
    // Java's own rule: a type with no modifier is package-private, and this index does not invent an export for it.
    expect(index.exported).toEqual(['ClaimStore']);
  });

  it('reads a member of an interface, which has no body to close', () => {
    expect(index.symbols[1]!.members.map((member) => member.name)).toEqual(['claim']);
  });

  it('answers a line inside a method with the declaration that method belongs to', () => {
    expect(symbolAt(index, 20)?.name).toBe('ClaimStore');
    expect(symbolAt(index, 33)?.name).toBe('Store');
  });

  it('reads nothing from an import line, which names a type it does not declare', () => {
    expect(index.symbols.map((symbol) => symbol.name)).not.toContain('List');
    expect(symbolAt(index, 3)).toBeNull();
  });
});

describe('Ruby, read as declarations', () => {
  const index = buildSymbolIndex('app/models/charge.rb', RUBY);

  it('reads a module, the class inside it, and the function outside both', () => {
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Billing',
      'class:Charge',
      'function:helper',
    ]);
  });

  it('reads the lines each declaration occupies, closing a block at its own end', () => {
    expect(index.symbols.map((symbol) => [symbol.startLine, symbol.endLine])).toEqual([
      [3, 29],
      [6, 28],
      [31, 33],
    ]);
  });

  it('reads initialize as the constructor of the class it is written in', () => {
    const charge = index.symbols[1]!;
    expect(charge.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:amount',
      'property:currency',
      'constructor:Charge',
      'method:claim',
      'method:kinds',
      'method:settle',
    ]);
  });

  it('reads a line that is a modifier rather than a member', () => {
    expect(index.symbols[1]!.members.map((member) => member.name)).not.toContain('private');
  });

  it('reads a comment line as no declaration, because Ruby writes its comments with a hash', () => {
    const commented = buildSymbolIndex(
      'a.rb',
      ['# def claim(id)', 'def claim(id)', 'end', ''].join('\n'),
    );
    expect(commented.symbols.map((symbol) => symbol.name)).toEqual(['claim']);
  });

  it('offers every top-level declaration and the nested constants with them', () => {
    expect(index.exported).toEqual(['Billing', 'Charge', 'helper']);
  });

  it('answers a line inside a method with the class the method belongs to', () => {
    expect(symbolAt(index, 16)?.name).toBe('Charge');
  });
});

describe('the shapes a Ruby counter has to answer rather than assume', () => {
  it('does not close a method at an end that a heredoc body wrote', () => {
    const index = buildSymbolIndex(
      'a.rb',
      ['def query', '  sql = <<~SQL', '    SELECT 1', '  end', '  SQL', '  sql', 'end', ''].join(
        '\n',
      ),
    );
    // The `end` on line 4 is SQL, and a counter that read it as Ruby's would end `query` there - three lines early,
    // hiding the line the guard stands on.
    expect(index.symbols[0]!.endLine).toBe(7);
    expect(index.uncertain).toBe(false);
  });

  it('does not close a block at an if written after a statement', () => {
    const index = buildSymbolIndex(
      'a.rb',
      ['def claim(id)', '  raise ArgumentError if id.nil?', '  true', 'end', ''].join('\n'),
    );
    expect(index.symbols[0]!.endLine).toBe(4);
  });

  it('closes a block whose body holds a do-block, which opens one more end than the def did', () => {
    const index = buildSymbolIndex(
      'a.rb',
      ['def each', '  items.each do |item|', '    puts item', '  end', 'end', ''].join('\n'),
    );
    expect(index.symbols[0]!.endLine).toBe(5);
  });

  it('extends an unterminated method to the end of the file and says so', () => {
    const index = buildSymbolIndex('a.rb', ['def broken', '  if x', '    y', ''].join('\n'));
    expect(index.symbols[0]!.endLine).toBe(4);
    expect(index.uncertain).toBe(true);
  });

  it('keeps counting past an end whose indentation is not the declaration', () => {
    // A counter that accepted the first balance of zero would return line 4, inside the class.
    const index = buildSymbolIndex(
      'a.rb',
      ['class A', '  def x', '    foo', '  end', 'end', ''].join('\n'),
    );
    expect(index.symbols[0]!.endLine).toBe(5);
  });

  it('does not read a method that a =begin block hides', () => {
    const index = buildSymbolIndex(
      'a.rb',
      ['=begin', 'def hidden', '=end', 'def shown', 'end', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['shown']);
  });

  it('runs wide rather than short when an end has no opener in front of it', () => {
    // The shape a half-applied patch leaves: a `def` line deleted, its `end` kept. The balance goes negative on a line
    // that is not the class's, and the only range that cannot be too short is the rest of the file.
    const index = buildSymbolIndex(
      'a.rb',
      ['class A', '  orphaned', '  end', '  end', 'end', ''].join('\n'),
    );
    expect(index.symbols[0]!.endLine).toBe(5);
  });

  it('attributes a method to the class it is written in rather than to the one beside it', () => {
    const index = buildSymbolIndex(
      'a.rb',
      ['class A', 'end', '', 'class B', '  def x', '  end', 'end', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['A', 'B']);
    expect(index.symbols[0]!.members).toEqual([]);
    expect(index.symbols[1]!.members.map((member) => member.name)).toEqual(['x']);
  });
});

describe('the one shared member reader, after two languages joined it', () => {
  it('reads a field initialised by a call as the field rather than as the function it calls', () => {
    const index = buildSymbolIndex(
      'src/main/java/Holder.java',
      [
        'public class Holder {',
        '    private final Map<String, Entry> byId = load();',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['byId']);
  });

  it('reads a C# auto-property whose getter is an expression body', () => {
    const index = buildSymbolIndex(
      'Worker.cs',
      ['public class Worker {', '    public int Count => items.Count;', '}', ''].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['Count']);
  });

  it('reads nothing from a declaration a diff caught half-written', () => {
    // **A scanner sees the line before its author finished it**, and this is the two shapes that has: an initialiser
    // with no name ahead of it, and a field with no terminator at all. Neither is a member and neither may throw.
    const leading = buildSymbolIndex(
      'Worker.cs',
      ['public class Worker {', '    = seed;', '}', ''].join('\n'),
    );
    expect(leading.symbols[0]!.members).toEqual([]);
    const unterminated = buildSymbolIndex(
      'Worker.cs',
      ['public class Worker {', '    private int count', '}', ''].join('\n'),
    );
    expect(unterminated.symbols[0]!.members).toEqual([]);
  });

  it('reads a member annotated on the line above it without reading the annotation', () => {
    const index = buildSymbolIndex(
      'Worker.cs',
      ['public class Worker {', '    [Obsolete]', '    public int Count;', '}', ''].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['Count']);
  });

  it('reads an inner type as a type rather than as a property of the one around it', () => {
    const index = buildSymbolIndex(
      'src/main/java/Outer.java',
      [
        'public class Outer {',
        '    public static class Inner {',
        '        int depth;',
        '    }',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['Outer', 'Inner']);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual([]);
    expect(index.symbols[1]!.members.map((member) => member.name)).toEqual(['depth']);
  });

  it('reads a static initialiser as no member at all, rather than as a property called static', () => {
    const index = buildSymbolIndex(
      'src/main/java/Cache.java',
      ['public class Cache {', '    static {', '        LOADED = true;', '    }', '}', ''].join(
        '\n',
      ),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual([]);
    expect(index.symbols[0]!.endLine).toBe(5);
  });
});

describe('the ranges an unterminated block leaves behind', () => {
  it('does not read the body of the function that follows an unterminated Go struct as its members', () => {
    const index = buildSymbolIndex(
      'a.go',
      ['type Entry struct {', '\ta int', 'func (e Entry) touch() {', '\te.a++', '}', ''].join('\n'),
    );
    // The struct's range is the rest of the file, and **the field it really declares is still the only member**: the
    // function that follows is named where a field would be, and its body is two levels in rather than one.
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['a']);
    expect(index.uncertain).toBe(true);
  });
});

describe("the shapes a scanner meets at a file's edge", () => {
  it('reads a C function on the last line of a file that ends without a newline', () => {
    const index = buildSymbolIndex('a.c', 'int claim(int id)');
    // **No body opens and nothing follows**, so the line is a prototype and the scanner claims no range for it - and the
    // look at the next line is a look past the end of the file rather than a crash.
    expect(index.symbols).toEqual([]);
  });

  it('reads a Go function whose receiver wrapped onto a second line as no declaration at all', () => {
    const index = buildSymbolIndex('a.go', ['func (s *Entry,', ') touch() {', '}'].join('\n'));
    // **A receiver this scanner cannot close is answered with nothing**, because guessing which of `s` and `touch` is
    // the name would be inventing the fact the index exists to establish.
    expect(index.symbols).toEqual([]);
  });

  it('closes a class at its own end even when the method inside it never closed', () => {
    const index = buildSymbolIndex('a.rb', ['class A', '  def x', 'end', ''].join('\n'));
    expect(index.uncertain).toBe(true);
    expect(index.symbols[0]!.members.map((member) => [member.name, member.endLine])).toEqual([
      ['x', 2],
    ]);
  });
});

describe('the indentation a block is written with', () => {
  it('counts a tab as four spaces when a Ruby block is indented with them', () => {
    const index = buildSymbolIndex(
      'a.rb',
      ['class A', '\tdef x', '\t\tfoo', '\tend', 'end', ''].join('\n'),
    );
    expect(index.symbols[0]!.endLine).toBe(5);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['x']);
  });
});
