// @code-analyzer/intelligence — the magic-number scan agrees with the pattern it replaced, and cannot be made to crawl
//
// **The pattern was quadratic and the lens runs it on every line of every file under review.** `(-?\d+\.?\d*)(?![a-zA-Z0-9_])`
// has one way to fail - the character after the digit run - and it discovers that only after backtracking the run down to
// nothing, at every position of the run. On a generated line of thirty thousand digits followed by one letter, the old
// pattern took **2 322 ms**; the scan takes **0.8 ms** and returns the same literals. A pull request can contain that
// line, so the cost was available to anyone who could open one.
//
// **Two things are asserted, and the first one is the reason the change is safe.** A faster scan that matches differently
// is a new lens, not an optimisation, so the scan is compared against the pattern itself over generated inputs - the
// alphabet is chosen so that every branch of both spellings is reachable, including the digits that end in `x`, the
// fraction that ends in a letter, and the `-` that is glued to an identifier. The second assertion is the cost: the
// bound is loose on purpose, because it is not measuring a machine, it is distinguishing linear from quadratic.

import { describe, expect, it } from 'vitest';

import { numericLiterals } from '../review/lenses/style-lens.js';

/** The pattern this scan replaced, kept here as the oracle rather than as the implementation. */
const ORACLE = /(?<![a-zA-Z0-9_.#])(-?\d+\.?\d*)(?![a-zA-Z0-9_])/g;

/** Every match the oracle finds, in order. */
function oracle(text: string): string[] {
  ORACLE.lastIndex = 0;
  return text.match(ORACLE) ?? [];
}

/** A deterministic generator, so a failure names a string that can be pasted into a test. */
function generated(count: number): string[] {
  const alphabet = [
    '0',
    '1',
    '9',
    '.',
    '-',
    '#',
    '_',
    'a',
    'Z',
    ' ',
    '\t',
    ';',
    '{',
    '}',
    '(',
    ')',
    '*',
    'x',
  ];
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const inputs: string[] = [];
  for (let n = 0; n < count; n++) {
    const length = 1 + Math.floor(next() * 24);
    let text = '';
    for (let k = 0; k < length; k++) text += alphabet[Math.floor(next() * alphabet.length)]!;
    inputs.push(text);
  }
  return inputs;
}

describe('the scan says what the pattern said', () => {
  it('agrees on 20 000 generated inputs, character for character', () => {
    const disagreements = generated(20_000).filter(
      (text) => JSON.stringify(numericLiterals(text)) !== JSON.stringify(oracle(text)),
    );

    expect(disagreements).toEqual([]);
  });

  it.each([
    ['3.a', ['3']],
    ['3.5x', ['3']],
    ['1.2.3', ['1.2']],
    ['a-1', ['1']],
    ['-1', ['-1']],
    ['x = 26.6.6', ['26.6']],
    ['0000', ['0000']],
    ['@types/node": "^26.6.6', ['26.6']],
    ['no digits here', []],
  ])('reads %s as %j', (text, expected) => {
    expect(numericLiterals(text)).toEqual(expected);
    // The oracle is asserted in the same breath, so the expectation above cannot drift from the rule it records.
    expect(oracle(text)).toEqual(expected);
  });

  it('skips a literal glued to an identifier or a member access, which is what the lookbehind said', () => {
    expect(numericLiterals('arr.0 and obj#1 and a1')).toEqual([]);
    expect(numericLiterals('(0) [1] {2}')).toEqual(['0', '1', '2']);
  });
});

describe('the scan cannot be made to crawl', () => {
  it('reads thirty thousand digits and a letter in linear time', () => {
    // The shape the old pattern was quadratic on: every position of the run is a start it tried and a prefix it undid.
    const text = `${'0'.repeat(30_000)}x`;

    const started = performance.now();
    const found = numericLiterals(text);
    const elapsed = performance.now() - started;

    // The old pattern took 2 322 ms on this input, measured on the same machine. A linear scan cannot approach the
    // bound from below by being lucky, and a quadratic one cannot cross it by being fast.
    expect(elapsed).toBeLessThan(250);
    expect(found).toEqual([]);
  });

  it('reads a run that ends in a fraction the same way, at the same cost', () => {
    const integer = '7'.repeat(20_000);
    const text = `${integer}.${'3'.repeat(20_000)}x`;

    const started = performance.now();
    const found = numericLiterals(text);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(250);
    // The fraction ends in a letter, so the fraction is not a literal and the integer part is: the pattern gave back
    // the fraction one character at a time and accepted `777…7` with the `.` after it, and the scan tries the same
    // three ends in the same order. Asserted against the oracle so the two cannot drift.
    expect(found).toEqual(oracle(text));
    expect(found).toEqual([integer]);
  });
});
