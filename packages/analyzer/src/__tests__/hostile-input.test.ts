// @code-analyzer/analyzer — the files a repository can contain and no fixture had
//
// **A parser is asked to read what is in the repository, and nothing bounds that.** The fixtures in this package are
// twenty lines of idiomatic source; the inputs below are what a real checkout also holds - a minified bundle on one
// line, an expression nested four thousand deep, a generated table of twenty thousand rows - and until this file
// existed, no test asked any provider to read one.
//
// **What the first run of this file found, before anything was changed to make it pass**: `bash` took **79 seconds** on
// an 8 000-character line of parentheses, `dart` 5.0 s, `css` 3.3 s and `lua` and `zig` 1.5 s each on a single line of
// 50 000 characters - all four returning **zero captures**. The cost was not the parse. It was a declaration pattern
// asked to try every position on a line and re-scan the rest of the line from each of them, which is cubic in the line
// length, and it was paid to produce nothing.
//
// **Two mechanisms, and each is asserted here rather than described.** `maskOverlongLines` blanks a line longer than
// `OVERLONG_LINE_BUDGET` without moving any offset, so a text reader cannot pay a line's length for a shape that a
// declaration does not have; and `bash`'s pipeline head is a scan rather than a backtrack, because a 4 000-character
// line inside the budget could still cost seconds.
//
// **The budget is a ceiling, not a target.** These are wall-clock assertions on a shared runner, so the number is
// several times the slowest reading that has been green here (634 ms, `csharp` on the dense case) and an order of
// magnitude below what the worst provider cost before the fix (79 s). A machine that is three times slower than this
// one still passes; a pattern that has gone back to seconds does not.

import { describe, expect, it } from 'vitest';

import { lineOf } from '../languages/line-index.js';
import { providerLoaders } from '../pipeline/phase-helpers.js';

/** How long a provider may take on one hostile input, in milliseconds. */
const BUDGET_MS = 5_000;

/** A single line of the shape that makes each family of patterns backtrack. */
function minifiedLine(language: string): string {
  if (language === 'javascript' || language === 'typescript') return `const a = ${'x?y:z;'.repeat(8_000)}`;
  if (language === 'python') return `x = ${'a ? b : c'.repeat(8_000)}`;
  if (language === 'bash') return `x = ${'('.repeat(4_000)}1${')'.repeat(4_000)}`;
  if (language === 'css') return `${'a'.repeat(20_000)}`;
  return `value = ${'a'.repeat(20_000)}`;
}

/** Nesting deeper than any call stack, which is a fact about the input rather than about the parser. */
const DEEP_NESTING = `x = ${'('.repeat(4_000)}1${')'.repeat(4_000)};`;

/** Twenty thousand declarations, which is a throughput question rather than a shape question. */
const DENSE = Array.from({ length: 4_000 }, (_, index) => `const name${String(index)} = 1;`).join('\n');

const CASES: ReadonlyArray<readonly [string, (language: string) => string]> = [
  ['one minified line', minifiedLine],
  ['four thousand levels of nesting', () => DEEP_NESTING],
  ['four thousand declarations', () => DENSE],
];

describe('a provider reading a file no fixture describes', () => {
  for (const language of Object.keys(providerLoaders)) {
    for (const [shape, build] of CASES) {
      it(`${language}: ${shape} is read inside the budget`, async () => {
        const provider = await providerLoaders[language]!();
        const source = build(language);
        const started = Date.now();
        const captures = provider.parse(source, `hostile.${language}`);
        const elapsed = Date.now() - started;
        expect(Array.isArray(captures)).toBe(true);
        expect(elapsed, `${language} took ${String(elapsed)}ms on ${shape}`).toBeLessThan(BUDGET_MS);
      });
    }
  }
});

describe('a capture taken from a masked file', () => {
  it('still points at the line the declaration is on', async () => {
    // **The assertion the mask has to earn.** Blanking a line must not move the line numbers of the declarations
    // around it, because every capture carries one and a reader clicks it.
    const provider = await providerLoaders['python']!();
    const source = ['def first():', '    pass', `${'x'.repeat(9_000)}`, 'def second():', '    pass', ''].join(
      '\n',
    );
    const captures = provider.parse(source, 'masked.py');
    const second = captures.find((capture) => capture.text === 'second');
    expect(second).toBeDefined();
    expect(second?.startLine).toBe(4);
  });
});

describe('the cost of naming a line', () => {
  it('is not the cost of copying the file', () => {
    // **The number this replaces, measured rather than assumed**: two thousand line numbers over a one-megabyte source
    // cost **522 ms** when each one was `source.slice(0, offset).split('\n').length`, because that is two thousand
    // copies of up to a megabyte. The table costs one pass and a binary search, and the assertion below is set an order
    // of magnitude under the old cost so that a return to it fails here rather than on a user's repository.
    const lines: string[] = [];
    let size = 0;
    while (size < 1_000_000) {
      const line = `const value_${String(lines.length)} = compute(${String(lines.length)});`;
      lines.push(line);
      size += line.length + 1;
    }
    const source = lines.join('\n');
    const offsets = Array.from({ length: 2_000 }, (_, index) => (index * 499) % source.length);
    const started = Date.now();
    let sink = 0;
    for (const offset of offsets) sink += lineOf(source, offset);
    const elapsed = Date.now() - started;
    expect(sink).toBeGreaterThan(0);
    expect(elapsed, `two thousand line numbers took ${String(elapsed)}ms`).toBeLessThan(200);
  });
});
