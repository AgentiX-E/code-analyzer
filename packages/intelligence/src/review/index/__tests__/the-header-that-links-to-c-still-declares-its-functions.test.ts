// @code-analyzer/intelligence — a header that C and C++ both include still declares its functions
//
// **The defect this file was written for is not a missing keyword.** `scanCFamily` read declarations at brace depth
// zero, and **`extern "C" {` is a brace**: every header written for both languages - which is every C library's public
// header - put its entire surface one level down, where the scanner was not looking. **The index answered those files
// with zero symbols**, which is the answer §89 separated from `unknown` and called the worse of the two: `unknown` says
// nobody read this file, and `0` says the file declares nothing.
//
// **And the second defect was a rule rather than a depth.** `cFunction` required a body, on the stated ground that a
// prototype has no lines a claim could be refuted against - **which is true and is not a reason to declare nothing**:
// a prototype's extent is its own line, and a review that files a comment on `int panel_open(...)` is filing it against
// a declaration the index can name.
//
// **Measured on the artifact before either was fixed**: 50 of the 316 files the 569 findings stood in indexed as zero
// symbols, all of them `.h`/`.hpp`, and C is 287 of the 569 findings - **the largest single language in the corpus**.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex, symbolAt } from '../symbols.js';

const indexOf = (name: string) =>
  buildSymbolIndex(
    `benchmarks/polyglot/hard/${name}`,
    readFileSync(join(process.cwd(), 'benchmarks/polyglot/hard', name), 'utf8'),
  );
const names = (name: string): string[] => indexOf(name).symbols.map((symbol) => symbol.name);
const find = (name: string, symbol: string) =>
  indexOf(name).symbols.find((it) => it.name === symbol);

describe('a linkage block is a scope and not a declaration', () => {
  it('declares the seven names a guarded C header offers', () => {
    // The file's own text: an opaque handle, a `#define`, a `static inline` prototype and five plain ones. **The
    // `#define` is deliberately not in this list** - a macro is text substitution and the index does not claim it.
    expect(names('hard.h').sort()).toEqual(
      [
        'panel_clamp',
        'panel_close',
        'panel_name',
        'panel_open',
        'panel_paint',
        'panel_resize',
        'panel_state_t',
      ].sort(),
    );
  });

  it('keeps `static` meaning what it means, inside the block as outside it', () => {
    // `static inline int panel_clamp(int rows);` is a name this file keeps to itself, and the export surface has to say
    // so - a `static` that stops being read the moment a brace opens is a linkage answer that depends on punctuation.
    expect(find('hard.h', 'panel_clamp')).toMatchObject({ kind: 'function', exported: false });
    expect(find('hard.h', 'panel_open')).toMatchObject({ kind: 'function', exported: true });
  });

  it('gives a prototype its own line, which is the only extent it has', () => {
    const index = indexOf('hard.h');
    const open = index.symbols.find((symbol) => symbol.name === 'panel_open')!;
    expect(open.endLine).toBe(open.startLine);
    // **And `symbolAt` answers it**, which is the question a witness asks: a comment filed on that line stands in a
    // declaration the index can name rather than in no declaration at all.
    expect(symbolAt(index, open.startLine)?.name).toBe('panel_open');
  });

  it('names a typedef by the name the typedef gives, not by the keyword', () => {
    expect(find('hard.h', 'panel_state_t')).toMatchObject({ kind: 'type' });
  });
});

describe('a namespace is the same brace in C++ and gets the same answer', () => {
  it('declares the two functions one namespace deep', () => {
    expect(names('hard.hpp').sort()).toEqual(['area', 'perimeter']);
  });

  it('answers `symbolAt` for a line inside the namespace', () => {
    const index = indexOf('hard.hpp');
    const area = index.symbols.find((symbol) => symbol.name === 'area')!;
    expect(symbolAt(index, area.startLine)?.name).toBe('area');
  });
});

describe('what a body still means, and what a pointer typedef still does not', () => {
  it('leaves a definition with an extent and its body inside it', () => {
    // **The regression this rewrite could have caused**: dropping the depth rule lets the scanner look inside function
    // bodies, where `if (x) {` and `return f(a);` are statements. The claim list is checked rather than trusted.
    const index = buildSymbolIndex(
      'panel.c',
      [
        'int panel_rows(const panel_state_t * state) {',
        '  if (state == 0) {',
        '    return 0;',
        '  }',
        '  return 3;',
        '}',
      ].join('\n'),
    );
    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['panel_rows']);
    expect(symbolAt(index, 3)?.name).toBe('panel_rows');
  });

  it('does not name a function-pointer typedef after a type it points at', () => {
    // `typedef void (*cb_t)(int);` declares `cb_t` and this scanner does not name it, **because the tail before the
    // semicolon is `int`** - and answering `int` would be a name the file never declared. Nothing is the honest answer.
    const index = buildSymbolIndex('callback.h', 'typedef void (*cb_t)(int);\n');
    expect(index.symbols.map((symbol) => symbol.name)).toEqual([]);
  });
});
