// @code-analyzer/analyzer — CFG Set Utility Tests
// Direct tests for the set helpers shared by the dominator and dataflow
// analyses. `setEquals` is exported specifically so that its element-scan arms
// can be covered honestly: every in-repo call site lives inside a monotone
// fixed-point iteration where the compared sets are nested, so an equal size
// always implies equal contents there and the scan can never fail in
// production.

import { describe, it, expect } from 'vitest';
import { intersectSets, setEquals } from '../cfg/set-utils.js';

describe('setEquals', () => {
  it('returns true for sets with identical contents', () => {
    expect(setEquals(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
  });

  it('returns true for two empty sets', () => {
    expect(setEquals(new Set<string>(), new Set<string>())).toBe(true);
  });

  it('short-circuits on differing sizes without scanning elements', () => {
    expect(setEquals(new Set(['a', 'b']), new Set(['a']))).toBe(false);
    expect(setEquals(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  });

  it('returns false when equal-size sets hold different elements', () => {
    // The membership arm the monotone fixed-point call sites cannot reach: both
    // sets have the same cardinality but differ in content.
    expect(setEquals(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false);
  });

  it('compares number sets as well as string sets', () => {
    expect(setEquals(new Set([1, 2]), new Set([1, 2]))).toBe(true);
    expect(setEquals(new Set([1, 2]), new Set([1, 3]))).toBe(false);
  });
});

describe('intersectSets', () => {
  it('returns the elements present in both operands', () => {
    expect(intersectSets(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toEqual(
      new Set(['b', 'c']),
    );
  });

  it('iterates the second operand when the first is smaller', () => {
    expect(intersectSets(new Set([2, 4]), new Set([1, 2, 3, 4]))).toEqual(new Set([2, 4]));
  });

  it('iterates the first operand when it is smaller', () => {
    // Exercises the swap branch: the running intersection starts larger than the
    // operand it is intersected with.
    expect(intersectSets(new Set([1, 2, 3, 4]), new Set([2, 4]))).toEqual(new Set([2, 4]));
  });

  it('returns an empty set for disjoint operands', () => {
    expect(intersectSets(new Set(['a']), new Set(['b']))).toEqual(new Set());
  });

  it('does not mutate its operands', () => {
    const a = new Set([1, 2]);
    const b = new Set([2, 3]);
    intersectSets(a, b);
    expect(a).toEqual(new Set([1, 2]));
    expect(b).toEqual(new Set([2, 3]));
  });
});
