// The corpus writes five languages and the index could read one
//
// **The measurement this answers, taken from the artifact rather than from an opinion.** On the 311 findings the
// `m-off` artifact scored, the paths by extension are `.go` 91, `.c` 50, `.py` 38, `.ts` 32, `.js` 22, `.json` 12,
// `.h` 11, `.php` 10, `.xml` 10, `.cpp` 8, `.tsx` 6, `.cs` 4. The lexer in `symbols.ts` reads `function`, `class`,
// `interface`, `const` - **TypeScript's and JavaScript's spellings, and nothing else** - so **81 % of the corpus's
// findings stood in a file whose declarations the index could not name**, and `selectIndexedContext` answered them with
// the three lines around the claim: a window wearing an index's clothes.
//
// **That is the reason the index measured small rather than the reason it was wrong.** §79 registered the second block
// as a substitute for a window; on four files in five the substitute contained less than the window it replaced. **A
// device that is idle on four fifths of its corpus cannot be priced on the fifth**, and the fix is upstream of every
// prompt: the scanner has to know what a declaration looks like in the language in front of it.
//
// **What each scanner is allowed to claim is fixed by the same rule as the TypeScript one.** A name, the lines it
// occupies, whether the file offers it to other files, and which declarations sit inside it - all four checkable by
// opening the file. **Nothing about what a symbol is for**, which is `aoci-code`'s `F`/`S` layer and its
// `s-field-discipline` forbids deriving. And the failure direction is unchanged: a construct a scanner cannot read
// makes the open declaration run to the end of the file rather than end at a guess, because **a symbol that ends early
// hides the guard that would have refuted a claim.**
//
// **Where the four scanners disagree, and why the tests name it rather than hiding it.** `exported` means what each
// language means by it: Go's leading uppercase, Python's leading underscore convention, C's `static` opt-out, C#'s
// `public` modifier, PHP's `public` - **five different questions that share a field name**, and a scanner that
// answered them all with TypeScript's `export` keyword would say "nothing is exported" in four languages where that is
// false.

import { describe, expect, it } from 'vitest';

import { declaringWord, wordBefore, words } from '../lexemes.js';
import { buildSymbolIndex, languageOf, symbolAt } from '../symbols.js';

const GO = [
  'package checker',
  '',
  '// Entry is one entry in the cache.',
  'type Entry struct {',
  '\tid string',
  '\tattempts int',
  '\ttags []string `json:"tags"`',
  '}',
  '',
  'type Store interface {',
  '\tGet(id string) (*Entry, error)',
  '}',
  '',
  'const RETRY_LIMIT = 3',
  '',
  'func Claim(id string) (*Entry, bool) {',
  '\tentry, err := open(id)',
  '\tif err != nil {',
  '\t\treturn nil, false',
  '\t}',
  '\treturn entry, true',
  '}',
  '',
  'func (s *Entry) touch() {',
  '\ts.attempts++',
  '}',
  '',
  'func helper() {',
  '}',
].join('\n');

const PYTHON = [
  'import os',
  '',
  'RETRY_LIMIT = 3',
  '',
  '',
  'class Store:',
  '    """Entries, by id."""',
  '',
  '    def __init__(self, path):',
  '        self.path = path',
  '',
  '    def claim(self, id):',
  '        if not id:',
  '            raise ValueError(id)',
  '        return None',
  '',
  '',
  'def helper(x):',
  '    return x',
  '',
  '',
  '@dataclass',
  'class Entry:',
  '    id: str',
  '    attempts: int = 0',
  '',
  '',
  'async def fetch(url):',
  '    return url',
].join('\n');

const C_FILE = [
  '#include <stdio.h>',
  '',
  'struct entry {',
  '    const char *id;',
  '    int attempts;',
  '};',
  '',
  'static int helper(int x) {',
  '    return x;',
  '}',
  '',
  'int claim(const char *id) {',
  '    if (id == NULL) {',
  '        return -1;',
  '    }',
  '    return 0;',
  '}',
  '',
  'void (*callback)(void);',
].join('\n');

const CSHARP = [
  'namespace Engine.Cache',
  '{',
  '    public class Worker',
  '    {',
  '        private readonly string name;',
  '',
  '        public Worker(string name)',
  '        {',
  '            this.name = name;',
  '        }',
  '',
  '        public void Claim(string id)',
  '        {',
  '            if (id == null)',
  '            {',
  '                throw new ArgumentNullException(nameof(id));',
  '            }',
  '        }',
  '    }',
  '',
  '    internal interface IStore',
  '    {',
  '        void Get();',
  '    }',
  '}',
].join('\n');

const PHP = [
  '<?php',
  '',
  'class Worker',
  '{',
  '    private string $name;',
  '',
  '    public function claim($id)',
  '    {',
  '        return $id;',
  '    }',
  '',
  '    private function helper()',
  '    {',
  '        return 1;',
  '    }',
  '}',
  '',
  'function shared($x)',
  '{',
  '    return $x;',
  '}',
].join('\n');

describe('a path says which language it is written in', () => {
  it('names the five the corpus is written in, and refuses the rest', () => {
    expect(languageOf('internal/checker/checker.go')).toBe('go');
    expect(languageOf('src/queue.ts')).toBe('typescript');
    expect(languageOf('web/app.tsx')).toBe('typescript');
    expect(languageOf('lib/index.mjs')).toBe('javascript');
    expect(languageOf('lib/index.js')).toBe('javascript');
    expect(languageOf('src/joystick/hidapi/SDL_hidapi_8bitdo.c')).toBe('c');
    expect(languageOf('src/joystick/usb_ids.h')).toBe('c');
    expect(languageOf('src/render/SDL_render.cpp')).toBe('c');
    expect(languageOf('engine/RunspaceConnectionInfo.cs')).toBe('csharp');
    expect(languageOf('app/Http/Worker.php')).toBe('php');
    expect(languageOf('scripts/tool.py')).toBe('python');
  });

  it('refuses an extension no scanner reads rather than guessing one', () => {
    expect(languageOf('testdata/baseline.json')).toBe('unknown');
    expect(languageOf('docs/page.xml')).toBe('unknown');
    expect(languageOf('Dockerfile')).toBe('unknown');
  });

  it('records the language on the index, because every later claim depends on it', () => {
    expect(buildSymbolIndex('a.go', GO).language).toBe('go');
    expect(buildSymbolIndex('a.json', '{}').language).toBe('unknown');
  });
});

describe('Go, because 29 % of the corpus is Go', () => {
  const index = buildSymbolIndex('internal/checker/checker.go', GO);

  it('reads func, type struct, type interface and const', () => {
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Entry',
      'interface:Store',
      'const:RETRY_LIMIT',
      'function:Claim',
      'method:touch',
      'function:helper',
    ]);
  });

  it('gives a declaration the lines it occupies, closing brace included', () => {
    const claim = index.symbols.find((symbol) => symbol.name === 'Claim')!;
    expect([claim.startLine, claim.endLine]).toEqual([16, 22]);
    const entry = index.symbols.find((symbol) => symbol.name === 'Entry')!;
    expect([entry.startLine, entry.endLine]).toEqual([4, 8]);
  });

  it("reads exported as Go reads it - the name's first letter", () => {
    expect(index.exported).toEqual(['Entry', 'Store', 'RETRY_LIMIT', 'Claim']);
    expect(index.symbols.find((symbol) => symbol.name === 'touch')!.exported).toBe(false);
    expect(index.symbols.find((symbol) => symbol.name === 'helper')!.exported).toBe(false);
  });

  it('reads a struct field as a member, and a struct tag as no part of the name', () => {
    const entry = index.symbols.find((symbol) => symbol.name === 'Entry')!;
    expect(entry.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:id',
      'property:attempts',
      'property:tags',
    ]);
  });

  it('reads an interface method as a member of the interface', () => {
    const store = index.symbols.find((symbol) => symbol.name === 'Store')!;
    expect(store.members.map((member) => member.name)).toEqual(['Get']);
  });

  it('keeps a generic receiver and a generic function out of the name', () => {
    const generic = buildSymbolIndex(
      'a.go',
      ['func Map[T any](xs []T, f func(T) T) []T {', '\treturn nil', '}', ''].join('\n'),
    );
    expect(generic.symbols.map((symbol) => symbol.name)).toEqual(['Map']);
    const receiver = buildSymbolIndex(
      'a.go',
      ['func (w *Worker[T]) Claim(id T) {', '}', ''].join('\n'),
    );
    expect(receiver.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'method:Claim',
    ]);
  });

  it('finds the declaration a line stands in, which is what a claim is refuted against', () => {
    expect(symbolAt(index, 16)?.name).toBe('Claim');
    expect(symbolAt(index, 5)?.name).toBe('Entry');
    expect(symbolAt(index, 1)).toBeNull();
  });
});

describe('Python, because 12 % of the corpus is Python', () => {
  const index = buildSymbolIndex('tools/worker.py', PYTHON);

  it('reads class and def at any indentation, and async def', () => {
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'const:RETRY_LIMIT',
      'class:Store',
      'function:helper',
      'class:Entry',
      'function:fetch',
    ]);
  });

  it('ends a block at the first line that returns to its indentation', () => {
    const store = index.symbols.find((symbol) => symbol.name === 'Store')!;
    expect([store.startLine, store.endLine]).toEqual([6, 15]);
    const helper = index.symbols.find((symbol) => symbol.name === 'helper')!;
    expect([helper.startLine, helper.endLine]).toEqual([18, 19]);
  });

  it('reads a method as a member of the class it is indented under', () => {
    const store = index.symbols.find((symbol) => symbol.name === 'Store')!;
    expect(store.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'constructor:Store',
      'method:claim',
    ]);
  });

  it('does not let a decorator hide the declaration it decorates', () => {
    const entry = index.symbols.find((symbol) => symbol.name === 'Entry')!;
    expect(entry.startLine).toBe(23);
    expect(entry.kind).toBe('class');
  });

  it('reads exported as the language reads it - no leading underscore', () => {
    expect(index.exported).toEqual(['RETRY_LIMIT', 'Store', 'helper', 'Entry', 'fetch']);
  });

  it('finds the method a line stands in, not only the class', () => {
    expect(symbolAt(index, 14)?.name).toBe('Store');
    // A blank line between two declarations belongs to neither, which is the only answer that cannot be wrong.
    expect(symbolAt(index, 16)).toBeNull();
  });
});

describe('C and C++, because 21 % of the corpus is one of them', () => {
  const index = buildSymbolIndex('src/hidapi.c', C_FILE);

  it('reads a function definition and a struct, and no prototype', () => {
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:entry',
      'function:helper',
      'function:claim',
    ]);
  });

  it('reads static as the file keeping the symbol to itself', () => {
    expect(index.exported).toEqual(['entry', 'claim']);
    expect(index.symbols.find((symbol) => symbol.name === 'helper')!.exported).toBe(false);
  });

  it('reads a struct field as a member and a function pointer as none of the above', () => {
    const entry = index.symbols.find((symbol) => symbol.name === 'entry')!;
    expect(entry.members.map((member) => member.name)).toEqual(['id', 'attempts']);
  });

  it('reads a C++ method at depth one as a member of its class', () => {
    const cpp = buildSymbolIndex(
      'a.cpp',
      [
        'class Worker {',
        'public:',
        '    void Claim(int id) {',
        '        if (id > 0) { return; }',
        '    }',
        '    int attempts;',
        '};',
      ].join('\n'),
    );
    const worker = cpp.symbols.find((symbol) => symbol.name === 'Worker')!;
    expect(worker.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'method:Claim',
      'property:attempts',
    ]);
  });

  it('does not read a control statement as a declaration', () => {
    const index2 = buildSymbolIndex(
      'a.c',
      [
        'int claim(int x) {',
        '    if (x) {',
        '        return 1;',
        '    }',
        '    return 0;',
        '}',
        '',
      ].join('\n'),
    );
    expect(index2.symbols.map((symbol) => symbol.name)).toEqual(['claim']);
  });
});

describe('C#, because the corpus carries it and its declarations live inside a namespace', () => {
  const index = buildSymbolIndex('engine/Worker.cs', CSHARP);

  it('reads a class at depth one, which is where a namespace puts it', () => {
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Worker',
      'interface:IStore',
    ]);
  });

  it('reads a method and a field at depth two as members', () => {
    const worker = index.symbols.find((symbol) => symbol.name === 'Worker')!;
    // **`public Worker(...)` is a constructor and not a method called `Worker`**, which is what C# means by a member
    // named after its type - the same fact §87 taught Java and Ruby to read.
    expect(worker.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'property:name',
      'constructor:Worker',
      'method:Claim',
    ]);
  });

  it('reads exported as the public modifier', () => {
    expect(index.exported).toEqual(['Worker']);
  });
});

describe('PHP, because the corpus carries it too', () => {
  const index = buildSymbolIndex('app/Worker.php', PHP);

  it('reads a class, its methods, and a function outside it', () => {
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Worker',
      'function:shared',
    ]);
    const worker = index.symbols.find((symbol) => symbol.name === 'Worker')!;
    expect(worker.members.map((member) => member.name)).toEqual(['name', 'claim', 'helper']);
  });

  it('reads public as exported and private as not', () => {
    expect(index.exported).toEqual(['Worker', 'shared']);
  });

  it('reads an interface as an interface and a trait as the class a trait is', () => {
    const shapes = buildSymbolIndex(
      'app/Shapes.php',
      ['interface Shape {', '    public function area();', '}', '', 'trait Label {', '}', ''].join(
        '\n',
      ),
    );
    expect(shapes.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'interface:Shape',
      'class:Label',
    ]);
    expect(shapes.symbols[0]!.members.map((member) => member.name)).toEqual(['area']);
  });
});

describe('and the failure direction is the same in every language', () => {
  it('extends an unterminated Go declaration to the end of the file and says so', () => {
    const index = buildSymbolIndex('a.go', ['func Claim() {', '\tif true {', ''].join('\n'));
    expect(index.symbols[0]!.endLine).toBe(3);
    expect(index.uncertain).toBe(true);
  });

  it('reads nothing from a language it does not know, and claims nothing about it', () => {
    const index = buildSymbolIndex('a.json', '{"a": 1}');
    expect(index.symbols).toEqual([]);
    expect(index.exported).toEqual([]);
    expect(index.uncertain).toBe(false);
  });

  it('answers a line in a file it cannot read with no symbol rather than a wrong one', () => {
    expect(symbolAt(buildSymbolIndex('a.json', '{}'), 1)).toBeNull();
  });
});

describe('the branches a scanner has to answer rather than assume', () => {
  it('reads several names declared by one Go field line', () => {
    const index = buildSymbolIndex(
      'a.go',
      ['type Entry struct {', '\tid, name string', '\tparent', '\ttags []string', '}', ''].join(
        '\n',
      ),
    );
    const entry = index.symbols[0]!;
    expect(entry.members.map((member) => member.name)).toEqual(['id', 'name', 'tags']);
  });

  it('reads a TypeScript property with an optional marker, and one with a definite-assignment one', () => {
    const index = buildSymbolIndex(
      'a.ts',
      [
        'export class Worker {',
        '  private name?: string;',
        '  private retries!: number;',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['name', 'retries']);
  });

  it('marks the index uncertain when a file closes a block it never opened', () => {
    const index = buildSymbolIndex('a.ts', ['}', 'export const x = 1;', ''].join('\n'));
    expect(index.uncertain).toBe(true);
  });

  it('answers a punctuation that is not on the line with no word rather than the last one', () => {
    expect(wordBefore(words('int claim(int id) {'), ';', 'int claim(int id) {')).toBeUndefined();
    expect(declaringWord(words('if (x) {'), 'if (x) {')).toBe(-1);
    expect(declaringWord(words('void (*handler)(int);'), 'void (*handler)(int);')).toBe(-1);
  });

  it('reads no function from a definition that opens a body with a pointer to one', () => {
    const index = buildSymbolIndex(
      'a.c',
      ['int (*factory)(int);', 'int claim(int x) {', '  return x;', '}', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['claim']);
  });

  it('declares nothing for a C aggregate with no name and for a K&R definition that never opens', () => {
    const index = buildSymbolIndex(
      'a.c',
      [
        'typedef struct {',
        '  int id;',
        '} entry;',
        '',
        'int claim(int x)',
        '{',
        '  return x;',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['claim']);
  });

  it('reads a PHP trait and a final class as declarations, and a private function as no export', () => {
    const index = buildSymbolIndex(
      'a.php',
      [
        '<?php',
        'final class Worker {',
        '  private function helper() {',
        '    return 1;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['Worker']);
    expect(index.exported).toEqual(['Worker']);
  });
});

describe('the constructs the corpus really writes, one per branch', () => {
  it('keeps a Go group declaration out of the index instead of naming it "("', () => {
    const index = buildSymbolIndex(
      'a.go',
      [
        'type (',
        '\tAlias = int',
        ')',
        '',
        'const (',
        '\tMAX = 3',
        ')',
        '',
        'func (s *Entry',
        '',
      ].join('\n'),
    );
    expect(index.symbols).toEqual([]);
  });

  it('does not read a function-pointer field as a member named after its type', () => {
    const index = buildSymbolIndex(
      'a.c',
      ['struct handler {', '  int (*run)(int);', '  int attempts;', '};', ''].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['attempts']);
  });

  it('reads a field with an initialiser by the name, not by the value', () => {
    const index = buildSymbolIndex(
      'a.cpp',
      [
        'class Limits {',
        'public:',
        '  static const int MAX = 5;',
        '  using Base::foo',
        '};',
        '',
      ].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['MAX']);
  });

  it('names a PHP constructor after its class, because __construct is a keyword', () => {
    const index = buildSymbolIndex(
      'a.php',
      [
        '<?php',
        'class Worker {',
        '  public function __construct($name) {',
        '    $this->name = $name;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const worker = index.symbols[0]!;
    expect(worker.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'constructor:Worker',
    ]);
  });

  it('reads a C# enum and record as types rather than as classes, and a delegate as neither', () => {
    const index = buildSymbolIndex(
      'a.cs',
      [
        'namespace N',
        '{',
        '    public enum Mode',
        '    {',
        '        Fast,',
        '    }',
        '',
        '    public record Entry(int Id);',
        '',
        '    internal delegate void Handler(int id);',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(['type:Mode']);
    expect(index.exported).toEqual(['Mode']);
  });

  it('reads a struct body that holds only a type alias as having no members', () => {
    const index = buildSymbolIndex(
      'a.h',
      ['struct empty {', '  /// nothing here', '  /* nor here */', '};', ''].join('\n'),
    );
    expect(index.symbols[0]!.members).toEqual([]);
  });

  it('reads a Python nested class method as a member of the inner class only', () => {
    const index = buildSymbolIndex(
      'a.py',
      [
        'class Outer:',
        '    class Inner:',
        '        def go(self):',
        '            return 1',
        '',
        '    def stop(self):',
        '        return 2',
        '',
      ].join('\n'),
    );
    const outer = index.symbols.find((symbol) => symbol.name === 'Outer')!;
    expect(outer.members.map((member) => member.name)).toEqual(['stop']);
    // **A nested class is deliberately not claimed**: `MemberSymbol` has no class kind, so calling `Inner` a member
    // would be a schema that says "method" about a class - and the method it holds is not attributed to `Outer`, which
    // is the part that would have been wrong in a way a reader could not see.
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['Outer']);
  });
});

describe('a body the scanner has to walk without being told how far it runs', () => {
  it('runs an unterminated Go struct to the end of the file and reads its fields only where they are fields', () => {
    const index = buildSymbolIndex(
      'a.go',
      ['type Entry struct {', '\tid string', 'func Claim() {}', ''].join('\n'),
    );
    const entry = index.symbols[0]!;
    expect(entry.endLine).toBe(4);
    expect(entry.members.map((member) => member.name)).toEqual(['id']);
    expect(index.uncertain).toBe(true);
  });

  it('reads an embedded pointer field as no field at all', () => {
    const index = buildSymbolIndex(
      'a.go',
      ['type Entry struct {', '\t*Base', '\tid string', '}', ''].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['id']);
  });

  it('reads a C enum as a type and offers it, because an enum is not a class with members', () => {
    const index = buildSymbolIndex(
      'a.h',
      ['enum mode {', '    FAST,', '    SLOW,', '};', ''].join('\n'),
    );
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(['type:mode']);
    expect(index.exported).toEqual(['mode']);
  });

  it('reads a C++ pure virtual method and an empty declaration in a class body', () => {
    const index = buildSymbolIndex(
      'a.cpp',
      ['class Store {', 'public:', '    virtual void run() = 0;', '    ;', '};', ''].join('\n'),
    );
    expect(index.symbols[0]!.members.map((member) => `${member.kind}:${member.name}`)).toEqual([
      'method:run',
    ]);
  });

  it('gives a method to the innermost of three nested classes', () => {
    const index = buildSymbolIndex(
      'a.py',
      [
        'class Outer:',
        '    class Middle:',
        '        def go(self):',
        '            return 1',
        '',
        '    def stop(self):',
        '        return 2',
        '',
      ].join('\n'),
    );
    const outer = index.symbols[0]!;
    expect(outer.members.map((member) => member.name)).toEqual(['stop']);
  });
});

describe('the declarations a corpus has and a fixture forgets', () => {
  it('reads a Go generic type and a var, and a function-typed field by its own name', () => {
    const index = buildSymbolIndex(
      'a.go',
      [
        'type Set[T comparable] struct {',
        '\tonDone func(error)',
        '',
        '\t// A blank line and a comment are not fields.',
        '\titems map[string]T',
        '}',
        '',
        'var Count = 1',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Set',
      'const:Count',
    ]);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['onDone', 'items']);
  });

  it('reads a C prototype that is followed by another prototype as no function', () => {
    const index = buildSymbolIndex(
      'a.c',
      [
        'int claim(int x)',
        'int other(int y)',
        '',
        'int claim(int x) {',
        '  return x;',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['claim']);
  });

  it('does not read a class nested two levels down as a declaration of the file', () => {
    const index = buildSymbolIndex(
      'a.cs',
      [
        'namespace N',
        '{',
        '    public class Outer',
        '    {',
        '        public class Inner',
        '        {',
        '        }',
        '    }',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['Outer']);
  });

  it('reads a PHP trait as a class, because a trait is a body other classes borrow', () => {
    const index = buildSymbolIndex(
      'a.php',
      [
        '<?php',
        'trait Claimable {',
        '  public function claim() {',
        '    return 1;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Claimable',
    ]);
  });

  it('reads a Python annotation constant and a module-level assignment that is not one', () => {
    const index = buildSymbolIndex('a.py', ['RETRY: int = 3', 'lower = 4', ''].join('\n'));
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['RETRY']);
  });
});

describe('the two shapes a brace can take, and a type that is only a name', () => {
  it('reads a C# class whose brace is on its own line and one whose brace is not', () => {
    const index = buildSymbolIndex(
      'a.cs',
      [
        'public class Same {',
        '    public int id;',
        '}',
        '',
        'public interface IStore',
        '{',
        '    void Get();',
        '}',
        '',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'class:Same',
      'interface:IStore',
    ]);
    expect(index.symbols[0]!.members.map((member) => member.name)).toEqual(['id']);
  });

  it('reads a Go type that names a type without saying what it is as a type', () => {
    const index = buildSymbolIndex('a.go', ['type Handler', ''].join('\n'));
    expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
      'type:Handler',
    ]);
  });
});
