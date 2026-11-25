// **A board is a corpus, not a file name.** `cut-curve.mjs` writes every run to the artifact path it was given, and on
// the runner both boards are written to `benchmarks/aacr-bench.json` - the corpus is an input, not a filename. The first
// version of this page asked whether the *artifact* started with `aacr`, so the six-lane Martian curves arrived under a
// tab labelled `AACR-Bench` and two boards shared one strip. **The corpus is the identity; the lane set is the arm.**
//
// Both halves are asserted here, because both are invisible from the drawn curve: a Martian curve labelled AACR-Bench
// and a Martian curve labelled Martian are the same arithmetic under different words.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOURCES, basisOf, boardOf, read } from '../../../scripts/cut-curve-page.mjs';

const ROOT = join(__dirname, '..', '..', '..');

describe('a curve is filed under the board it was divided by', () => {
  it('names the board from the corpus, not from the artifact name both boards share', () => {
    // Exactly the shape the runner writes: the artifact is `aacr-bench.json` on both boards.
    expect(
      boardOf({
        artifact: 'benchmarks/aacr-bench.json',
        corpus: 'benchmarks/martian/positive_samples.json',
      }),
    ).toBe('Martian Code Review Bench');
    expect(
      boardOf({
        artifact: 'benchmarks/aacr-bench.json',
        corpus: '/tmp/aacr/dataset/v1/positive_samples.json',
      }),
    ).toBe('AACR-Bench');
  });

  it('names the arm after the lane set the record carries', () => {
    const base = {
      artifact: 'benchmarks/aacr-bench.json',
      corpus: 'benchmarks/martian/positive_samples.json',
    };
    expect(boardOf({ ...base, laneSet: 'wide' })).toBe('Martian Code Review Bench (six lanes)');
    // **The shipped arm is the unmarked one**, and so is a record written before `laneSet` existed: it was written by a
    // run of the five lanes, and saying so on every tab would make the one that differs invisible.
    expect(boardOf({ ...base, laneSet: 'shipped' })).toBe('Martian Code Review Bench');
    expect(boardOf(base)).toBe('Martian Code Review Bench');
  });

  it('draws both arms of the same board as two tabs, which is the only way the device is visible', () => {
    const records = SOURCES.map((source) => read(source, readFileSync(join(ROOT, source), 'utf8')));
    // **A tab is a board and a denominator**, and both parts are needed: the arm alone repeats once per denominator, and
    // two tabs with one label ask the reader to open them to find out which is which - the defect this file is about.
    const labels = records.map((entry) => `${boardOf(entry)} · ${basisOf(entry)}`);
    expect(new Set(labels).size).toBe(SOURCES.length);
    // **Four of the five are one board on two arms and two denominators**, and the page exists so that pair of pairs can
    // be read side by side.
    expect(labels.filter((label) => label.startsWith('Martian Code Review Bench'))).toHaveLength(4);
    expect(records.filter((entry) => entry.laneSet === 'wide')).toHaveLength(2);
  });
});
