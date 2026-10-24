// The scoring criterion itself, because every number this project publishes is computed by these three functions.
//
// **A metric that is wrong is worse than a metric that is missing**: it gets compared, quoted and optimised against.
// The file had no test of its own — its only consumer is the semantic harness, which skips without an embedding
// provider — so **the arithmetic that produces every published precision and recall had never been executed by a
// test**. These cases pin the two decisions that separate one figure from another: **overlap is a line, not an exact
// span**, and **matching is one-to-one, in the order findings arrive**.

import { describe, expect, it } from 'vitest';

import { measure, overlaps, prf, score } from '../benchmark/real-ground-truth-scoring.js';

import type { Range } from '../benchmark/real-ground-truth-scoring.js';

const at = (startLine: number, endLine: number, extra: Partial<Range> = {}): Range => ({
  filePath: 'src/a.ts',
  startLine,
  endLine,
  ...extra,
});

describe('the overlap criterion', () => {
  it('counts a shared line as an overlap', () => {
    // **Not "the same span"**: a reviewer's range and the human's rarely coincide, and a criterion that demanded it
    // would score every finding wrong.
    expect(overlaps(at(10, 12), at(12, 20))).toBe(true);
    expect(overlaps(at(10, 20), at(15, 16))).toBe(true);
  });

  it('does not overlap when the ranges are adjacent but disjoint', () => {
    expect(overlaps(at(10, 12), at(13, 20))).toBe(false);
  });

  it('does not overlap across files, however close the lines are', () => {
    expect(overlaps(at(10, 12), { ...at(10, 12), filePath: 'src/b.ts' })).toBe(false);
  });

  it('treats a point range as a range', () => {
    expect(overlaps(at(7, 7), at(7, 9))).toBe(true);
  });
});

describe('one-to-one matching', () => {
  it('matches each ground-truth case at most once', () => {
    // **Two findings on the same bug are one true positive and one false positive**, which is what stops a producer
    // from scoring well by reporting every nearby line.
    const result = score([at(10, 10), at(11, 11)], [at(10, 12)]);
    expect(result.tp).toBe(1);
    expect(result.matched).toBe(1);
  });

  it('matches a later finding against a case an earlier one could not use', () => {
    const result = score([at(30, 30), at(10, 10)], [at(10, 12)]);
    expect(result.tp).toBe(1);
  });

  it('requires the category when asked, and ignores it otherwise', () => {
    const finding = at(10, 10, { category: 'bug' });
    const truth = at(10, 12, { category: 'security' });
    expect(score([finding], [truth]).tp).toBe(1);
    expect(score([finding], [truth], true).tp).toBe(0);
  });

  it('scores nothing when there is nothing to match', () => {
    expect(score([], [])).toEqual({ tp: 0, matched: 0 });
    expect(score([at(1, 1)], [])).toEqual({ tp: 0, matched: 0 });
    expect(score([], [at(1, 1)])).toEqual({ tp: 0, matched: 0 });
  });
});

describe('precision, recall and F1', () => {
  it('is zero on every dimension when there is nothing to divide by', () => {
    expect(prf(0, 0, 0)).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  it('is one when every finding is right and every case is found', () => {
    expect(prf(3, 0, 0)).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('rounds to four places so two runs print the same figure', () => {
    expect(prf(1, 2, 0)).toEqual({ precision: 0.3333, recall: 1, f1: 0.5 });
  });

  it('counts a finding matched to the wrong category as a false positive and a miss', () => {
    const metrics = measure(
      [at(10, 10, { category: 'bug' })],
      [at(10, 12, { category: 'sec' })],
      true,
    );
    expect(metrics).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  it('measures a mixed result', () => {
    // One hit, one miss and one finding on nothing: precision 1/2, recall 1/2, F1 1/2.
    const findings = [at(10, 10), at(50, 50)];
    const truth = [at(10, 12), at(80, 80)];
    expect(measure(findings, truth)).toEqual({ precision: 0.5, recall: 0.5, f1: 0.5 });
  });
});
