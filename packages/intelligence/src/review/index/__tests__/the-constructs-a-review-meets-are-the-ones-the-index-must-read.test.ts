// @code-analyzer/intelligence — the constructs a review files comments against, and the six the index could not read
//
// **§89 measured whether the index reads eleven languages; this file measures whether it reads the constructs written in
// them.** The first wave used one real file per language and every scanner answered it perfectly, which is the shape a
// measurement takes when the corpus was chosen to be read. `benchmarks/polyglot/hard/` is the other corpus: one file per
// language holding the constructs a reviewer actually files comments against - a type alias, a `const enum`, a key with
// an escaped quote, a module constant with an annotation, a flow mapping, a namespaced element - and the third-party
// grammar that judges them found **six names the lexer missed and two it invented**.
//
// **Each case below is one of those six.** They are written as the fact a consumer needs, not as the regex that should
// produce it: `Completion` is declared by `public typealias Completion = ...` and a reader asking `symbolAt` about that
// line has to be answered.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex } from '../symbols.js';

// Six levels up from this file - `__tests__`, `index`, `review`, `src`, `intelligence`, `packages` - because the
// corpus is the repository's, not the package's, and a copy of it inside the package would be a second corpus.
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const indexOf = (name: string) =>
  buildSymbolIndex(
    `benchmarks/polyglot/hard/${name}`,
    readFileSync(`${root}benchmarks/polyglot/hard/${name}`, 'utf8'),
  );
const names = (name: string): string[] => indexOf(name).symbols.map((symbol) => symbol.name);
const find = (name: string, symbol: string) =>
  indexOf(name).symbols.find((it) => it.name === symbol);

describe('a typealias is a declaration in the two languages that spell it that way', () => {
  it('names a Swift typealias, and calls it a type', () => {
    // `public typealias Completion = (Result<Void, Error>) -> Void` is one declaration, and it is the one a reader
    // asking "what is Completion" has to be shown. The scanner read five type keywords and `typealias` was not among
    // them, so a file whose only export is an alias answered that it exports nothing.
    expect(find('hard.swift', 'Completion')).toMatchObject({ kind: 'type', exported: true });
  });

  it('leaves the aliased types and the rest of the Swift file alone', () => {
    expect(names('hard.swift')).toEqual(
      expect.arrayContaining([
        'Service',
        'Config',
        'State',
        'Store',
        'Cache',
        'Base',
        'Hidden',
        'topLevel',
      ]),
    );
  });
});

describe('a const enum is an enum and not a constant called enum', () => {
  it('names Fast and calls it what an enum is called here', () => {
    // `export const enum Fast { On = 1, Off = 0 }`: the keyword table tried `const` first, took the next word as the
    // name, and declared a symbol called `enum` - **one name missed and one invented on one line**.
    expect(find('hard.ts', 'Fast')).toMatchObject({ kind: 'class', exported: true });
  });

  it('does not declare a symbol named enum', () => {
    expect(names('hard.ts')).not.toContain('enum');
  });

  it('still names the plain enum beside it', () => {
    expect(names('hard.ts')).toContain('Color');
  });
});

describe('a JSON key is the name the string decodes to', () => {
  it('decodes an escaped quote in a key', () => {
    // The file writes `"escaped\"quote": "value"` and the key is `escaped"quote`. **A name carrying its own escape is a
    // name no consumer can match**: a JSON pointer, a `package.json` field lookup and a prompt all want the decoded one.
    expect(names('hard.json')).toContain('escaped"quote');
  });

  it('does not carry the backslash into the name', () => {
    expect(names('hard.json')).not.toContain('escaped\\"quote');
  });

  it('reads a key that follows another key on the same line', () => {
    // `{ "os": "linux", "arch": "x64" }` inside an array: the key regex was anchored at the start of the line, so a
    // line beginning with a brace declared nothing and every compact object in a document was invisible.
    expect(names('hard.json')).toEqual(expect.arrayContaining(['os', 'arch']));
  });

  it('does not invent a key out of a quoted word inside a string value', () => {
    // `"argv": "echo \"ghost\": 1"` holds the characters of a key and is not one. **A scanner that searched the line
    // for `"…":` would report `ghost`**, which is the failure mode that makes a naive fix worse than the defect.
    expect(names('hard.json')).not.toContain('ghost');
  });
});

describe('a module constant is a name whether or not it is shouted', () => {
  it('names an annotated module-level assignment', () => {
    // `_cache: dict[str, int] = {}` declares `_cache` with a type, which is the Python analogue of `const x: T`. The
    // rule was `[A-Z][A-Z0-9_]*`, a convention rather than a syntax, so every lowercase module name was invisible.
    expect(find('hard.py', '_cache')).toMatchObject({ kind: 'const', exported: false });
  });

  it('names a function defined under a module-level if', () => {
    // `if sys.version_info >= (3, 11): def guarded():` - **the name is module-level and the condition is not part of
    // its scope**: a reviewer asking about that line is asking about a function the module declares.
    expect(names('hard.py')).toContain('guarded');
  });

  it('names every name of a chained assignment', () => {
    // `DEFAULT_TIMEOUT = MAX_RETRIES = 3` declares two names in one statement, and the rule that read the first
    // identifier on the line found one of them.
    expect(names('hard.py')).toEqual(expect.arrayContaining(['DEFAULT_TIMEOUT', 'MAX_RETRIES']));
  });

  it('names a constant assigned inside a module-level try', () => {
    // `try: from _fastjson import dumps; FAST_PATH = True / except ImportError: FAST_PATH = False` - the name is
    // assigned twice, at an indent, and it is a name the module has. **This is how `codecs.py` writes its four error
    // handlers**, and the indent rule read all four as invisible.
    expect(names('hard.py')).toEqual(expect.arrayContaining(['FAST_PATH']));
    expect(names('hard.py').filter((name) => name === 'FAST_PATH')).toHaveLength(1);
  });

  it('does not turn a comparison into a declaration', () => {
    // `if x == 1:` reads as `x =` to a rule that only looks for an equals sign, and the fix for the two cases above
    // must not buy them by declaring every comparison in the file.
    expect(names('hard.py')).not.toContain('sys');
  });
});

describe('a flow mapping declares keys, and a quoted value does not', () => {
  it('names the keys written inline between braces', () => {
    // `flow: { a: 1, b: 2 }` is a mapping with two keys and no indentation: **the scanner read YAML by column**, so it
    // saw one key called `flow` and nothing under it.
    expect(names('hard.yaml')).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('does not read a colon inside a quoted value as a key', () => {
    // `quoted: "key: with a colon"` holds a colon and names no second key.
    expect(names('hard.yaml')).not.toContain('key');
  });

  it('still reads the block keys the file is mostly made of', () => {
    expect(names('hard.yaml')).toEqual(
      expect.arrayContaining(['service', 'steps', 'matrix', 'second']),
    );
  });
});

describe('an XML element keeps the name the file wrote', () => {
  it('preserves a namespace prefix rather than resolving it', () => {
    // `<meta:info owner="platform" />` is the element `meta:info`. **Resolving the prefix to a URI and reporting the
    // local part is a different answer** - and one that would make two elements from two namespaces indistinguishable.
    expect(names('hard.xml')).toContain('meta:info');
  });

  it('does not make an element out of a CDATA section or a comment', () => {
    expect(names('hard.xml')).not.toEqual(expect.arrayContaining(['cdata-ghost', 'ghost']));
  });
});
