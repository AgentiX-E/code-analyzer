// The claim this iteration introduces: for a changed symbol, the analysis reports the consumers the diff never
// touched — and distinguishes that from "not determined".
//
// The distinction is the point. A reviewer reporting an empty consumer list cannot tell a caller whether there are
// none or whether it never looked, and only one of those readings is safe to act on.

import { describe, it, expect } from 'vitest';

import { classifyConsumersByDiff } from '../cross-repo/cross-repo-pr-review.js';

describe('classifyConsumersByDiff', () => {
  it('separates a consumer the diff touched from one it did not', () => {
    const result = classifyConsumersByDiff(
      ['packages/api/src/gateway.ts'],
      ['packages/api/src/gateway.ts', 'packages/worker/src/consumer.ts'],
    );

    expect(result.insideDiff).toEqual(['packages/api/src/gateway.ts']);
    expect(result.outsideDiff).toEqual(['packages/worker/src/consumer.ts']);
  });

  it('reports nothing outside the diff when every consumer is in it', () => {
    const result = classifyConsumersByDiff(['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/b.ts']);

    expect(result.outsideDiff).toEqual([]);
    expect(result.insideDiff).toHaveLength(2);
  });

  it('matches paths that differ only by separator or a leading ./', () => {
    // A diff and a graph index routinely spell the same file differently; treating those as different files would
    // report a consumer as outside the diff when the author had it open.
    const result = classifyConsumersByDiff(['./src/a.ts'], ['src\\a.ts', './src/b.ts']);

    expect(result.insideDiff).toEqual(['src\\a.ts']);
    expect(result.outsideDiff).toEqual(['./src/b.ts']);
  });

  it('puts every consumer outside the diff when the diff names no consumer at all', () => {
    const result = classifyConsumersByDiff(['src/unrelated.ts'], ['src/consumer.ts']);

    expect(result.insideDiff).toEqual([]);
    expect(result.outsideDiff).toEqual(['src/consumer.ts']);
  });
});
