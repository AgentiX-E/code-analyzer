// @code-analyzer/analyzer — the line table, and the equality that lets it replace a slice
//
// **The whole justification for this module is one sentence**: `source.slice(0, offset).split('\n').length` and
// `createLineIndex(source).lineOf(offset)` must agree for every offset in every source, or a provider that switches
// from the first to the second has moved the line numbers it publishes. The property below is that sentence, over
// generated sources, and the cases above it are the boundaries a generator would not reach on its own.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OVERLONG_LINE_BUDGET, createLineIndex, lineOf, maskOverlongLines } from '../languages/line-index.js';

/** The idiom the index replaces, kept here as the oracle rather than as a memory. */
const bySlice = (source: string, offset: number): number => source.slice(0, offset).split('\n').length;

describe('the line table', () => {
  it('counts the lines a reader sees', () => {
    expect(createLineIndex('').lineCount).toBe(1);
    expect(createLineIndex('one').lineCount).toBe(1);
    expect(createLineIndex('one\ntwo').lineCount).toBe(2);
    // **A trailing newline does not open a line.** `"one\n"` is line 1 followed by a terminator, which is why an
    // editor shows one line and not two.
    expect(createLineIndex('one\n').lineCount).toBe(1);
    expect(createLineIndex('one\n\ntwo').lineCount).toBe(3);
  });

  it('places every offset the way the slice did', () => {
    const source = 'a\nbb\n\nccc';
    const index = createLineIndex(source);
    for (let offset = 0; offset <= source.length; offset += 1) {
      expect(index.lineOf(offset), `offset ${String(offset)}`).toBe(bySlice(source, offset));
    }
  });

  it('clamps an offset outside the source rather than throwing', () => {
    const index = createLineIndex('a\nb');
    expect(index.lineOf(-1)).toBe(1);
    expect(index.lineOf(1_000)).toBe(2);
  });

  it('returns the first offset of a line, and the end of the source past the last', () => {
    const index = createLineIndex('a\nbb\nccc');
    expect(index.offsetOf(1)).toBe(0);
    expect(index.offsetOf(2)).toBe(2);
    expect(index.offsetOf(3)).toBe(5);
    // **Past the last line**, which is the end of an eight-character source.
    expect(index.offsetOf(4)).toBe(8);
    expect(index.offsetOf(0)).toBe(0);
  });

  it('agrees with the slice at every offset of a generated source', () => {
    // **The property, not a sample.** Lengths chosen to cross the binary search's midpoints, and newlines in every
    // position including the first and last.
    let seed = 20_260_811;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let round = 0; round < 60; round += 1) {
      const length = next() % 40;
      let source = '';
      for (let index = 0; index < length; index += 1) source += next() % 4 === 0 ? '\n' : 'x';
      const table = createLineIndex(source);
      for (let offset = 0; offset <= source.length; offset += 1) {
        expect(table.lineOf(offset), `${JSON.stringify(source)} at ${String(offset)}`).toBe(
          bySlice(source, offset),
        );
      }
    }
  });

  it('answers the same through the memo as through a fresh table', () => {
    const first = 'a\nb\nc';
    const second = 'x';
    expect(lineOf(first, 4)).toBe(bySlice(first, 4));
    // A second source interleaved with the first rebuilds the table, which is the case the cache has to survive.
    expect(lineOf(second, 0)).toBe(bySlice(second, 0));
    expect(lineOf(first, 2)).toBe(bySlice(first, 2));
  });
});

describe('the mask', () => {
  it('leaves a short source untouched and reports nothing blanked', () => {
    const source = 'a\nbb\nccc';
    const masked = maskOverlongLines(source, 10);
    expect(masked.text).toBe(source);
    expect(masked.lines).toBe(0);
  });

  it('blanks an over-long line without changing a single offset', () => {
    const source = ['short', 'x'.repeat(20), 'short', ''].join('\n');
    const masked = maskOverlongLines(source, 10);
    expect(masked.text.length).toBe(source.length);
    expect(masked.lines).toBe(1);
    // **The blank is NUL and not a space**: a space is what `\s` matches, and the pattern that made this necessary
    // backtracks on it.
    expect(masked.text).toContain('\u0000'.repeat(20));
    expect(masked.text.split('\n')).toHaveLength(source.split('\n').length);
    // **The line after the blank still starts where it started**, which is what a capture's line number depends on.
    expect(masked.text.indexOf('short', 10)).toBe(source.indexOf('short', 10));
  });

  it('keeps a line exactly at the budget', () => {
    const source = 'y'.repeat(OVERLONG_LINE_BUDGET);
    expect(maskOverlongLines(source, OVERLONG_LINE_BUDGET).lines).toBe(0);
    expect(maskOverlongLines(source, OVERLONG_LINE_BUDGET - 1).lines).toBe(1);
  });

  it('treats the text before the first newline as a line', () => {
    const source = `${'z'.repeat(30)}\nok`;
    const masked = maskOverlongLines(source, 5);
    expect(masked.lines).toBe(1);
    expect(masked.text.endsWith('\nok')).toBe(true);
  });
});

describe('the idiom this module replaced', () => {
  it('does not come back into the language providers', async () => {
    // **A unit test on the tree rather than on a value, because the defect is a line of code and not a behaviour.**
    // The copy-per-capture idiom was correct everywhere it appeared and expensive in all twenty-two places; a provider
    // added next year would reintroduce it silently, which is the same shape as the gates this repository already
    // keeps for coverage exclusions and baselines.
    const directory = join(process.cwd(), 'packages/analyzer/src/languages');
    const offenders: string[] = [];
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.ts') || name === 'line-index.ts') continue;
      const body = readFileSync(join(directory, name), 'utf8');
      // The pattern is the idiom itself and not the word `slice`: a provider may slice a line for other reasons.
      if (/\.slice\(\s*0\s*,[^)]*\)\s*\.split\(\s*'\\n'\s*\)\s*\.length/.test(body)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
