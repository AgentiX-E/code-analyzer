// **Five buckets, and the property that makes them worth reading is that they add up.**
//
// The run of 2026-11-09 reported `recall 0.2412` at full emission - 41 of 196 expert-confirmed issues - and that figure
// is compatible with three unrelated defects: the file was never read, the file was read and the lane was silent, or the
// lane spoke on that file about something else. **Each implies different work, and the artifact could not separate
// them**, because the golden's `path` and `from_line` were discarded when its text was mapped into `issueTexts`.
//
// **So these tests hold the partition itself**, not the numbers: every golden lands in exactly one bucket, a path that
// the diff writes with an `a/` prefix is not silently a different path from the corpus's, and a bucket table that does
// not add up throws instead of losing a row.

import { describe, expect, it } from 'vitest';

import {
  GOLDEN_BUCKETS,
  attributeGoldens,
  largestBucket,
  mergeAttributions,
  normalisePath,
} from '../../../.github/scripts/lib/golden-attribution.mjs';

const goldens = [
  { path: 'src/a.cpp', note: 'the guard reads past the end' },
  { path: 'src/a.cpp', note: 'the lock is taken twice' },
  { path: 'src/b.cpp', note: 'no bounds check on the copy' },
  { path: 'src/c.cpp', note: 'the error is swallowed' },
  { path: 'src/d.cpp', note: 'the cache is never invalidated' },
  { path: '', note: 'a row the corpus did not locate' },
];

describe('every golden lands in exactly one bucket', () => {
  it('decides in the order hit, noPath, fileNotReviewed, noFindingOnPath, findingOnPathRejected', () => {
    const result = attributeGoldens({
      goldens,
      // `src/c.cpp` is in the diff and produced no finding; `src/d.cpp` produced one that matched nothing.
      reviewedPaths: ['src/a.cpp', 'src/c.cpp', 'src/d.cpp'],
      findings: [{ path: 'src/a.cpp' }, { path: 'src/a.cpp' }, { path: 'src/d.cpp' }],
      // The first finding matched the first golden and nothing else.
      matches: [[0], [], []],
    });

    expect(result.counts).toEqual({
      hit: 1,
      // `src/b.cpp` was never handed to the engine.
      noPath: 1,
      fileNotReviewed: 1,
      // `src/c.cpp` was read and the lanes said nothing.
      noFindingOnPath: 1,
      // **Two**: `src/d.cpp` was read and a finding was emitted on it that the judge did not accept, and the second
      // `src/a.cpp` golden shares a file a finding was emitted on but was not the issue that finding described.
      findingOnPathRejected: 2,
    });
    // And the row whose path is in the corpus but not in the diff is `noPath` rather than a sixth bucket.
    expect(result.total).toBe(goldens.length);
  });

  it('is a partition for a pull request where nothing was found', () => {
    const result = attributeGoldens({
      goldens: goldens.slice(0, 3),
      reviewedPaths: ['src/a.cpp'],
      findings: [],
      matches: [[], []],
    });
    const sum = GOLDEN_BUCKETS.reduce((total, bucket) => total + result.counts[bucket], 0);
    expect(sum).toBe(3);
    expect(result.counts.hit).toBe(0);
    // Two goldens in `src/a.cpp`, which was read and produced nothing, and one in `src/b.cpp`, which was never sent.
    expect(result.counts.noFindingOnPath).toBe(2);
    expect(result.counts.fileNotReviewed).toBe(1);
  });

  it('calls a golden hit when any finding matched it, even if the matching is one-to-one elsewhere', () => {
    const result = attributeGoldens({
      goldens: [{ path: 'src/a.cpp', note: 'x' }],
      reviewedPaths: ['src/a.cpp'],
      findings: [{ path: 'src/a.cpp' }, { path: 'src/a.cpp' }],
      // Both findings matched the same golden - the score will use one of them, the diagnosis uses both.
      matches: [[0], [0]],
    });
    expect(result.counts.hit).toBe(1);
    expect(result.perGolden[0]?.matchedFindings).toEqual([0, 1]);
  });

  it('carries the note, capped, so a bucket can be read without opening the corpus', () => {
    const long = 'z'.repeat(400);
    const result = attributeGoldens({
      goldens: [{ path: 'src/a.cpp', note: long }],
      reviewedPaths: [],
      findings: [],
      matches: [],
    });
    expect(result.perGolden[0]?.note).toHaveLength(160);
  });

  it('treats a missing golden list as an empty partition rather than throwing', () => {
    const result = attributeGoldens({ goldens: [], reviewedPaths: [], findings: [], matches: [] });
    expect(result.total).toBe(0);
    expect(largestBucket(result.counts)).toBeNull();
  });
});

describe('a path is compared in one normal form', () => {
  it('strips the diff prefixes, a leading ./ and a trailing slash', () => {
    expect(normalisePath('b/src/a.cpp')).toBe('src/a.cpp');
    expect(normalisePath('a/src/a.cpp')).toBe('src/a.cpp');
    expect(normalisePath('./src/a.cpp')).toBe('src/a.cpp');
    expect(normalisePath('src/pkg/')).toBe('src/pkg');
    expect(normalisePath('src\\win\\a.cs')).toBe('src/win/a.cs');
    expect(normalisePath(undefined)).toBe('');
  });

  it('matches a corpus path against the path the diff wrote, so the bucket is about the review and not the prefix', () => {
    const result = attributeGoldens({
      goldens: [{ path: 'src/a.cpp', note: 'x' }],
      reviewedPaths: ['b/src/a.cpp'],
      findings: [{ path: 'a/src/a.cpp' }],
      matches: [[0]],
    });
    // Read, emitted, and matched - not `fileNotReviewed`, which is what a raw `===` would have reported.
    expect(result.counts.hit).toBe(1);
    expect(result.counts.fileNotReviewed).toBe(0);
  });
});

describe('the merged table is what the artifact publishes', () => {
  it('adds the buckets up across pull requests and caps the examples per bucket', () => {
    const one = attributeGoldens({
      goldens: [
        { path: 'src/a.cpp', note: 'one' },
        { path: 'src/b.cpp', note: 'two' },
      ],
      reviewedPaths: [],
      findings: [],
      matches: [],
    });
    const merged = mergeAttributions([
      { pr: 'pr/1', ...one },
      { pr: 'pr/2', ...one },
    ]);
    expect(merged.counts.fileNotReviewed).toBe(4);
    expect(merged.total).toBe(4);
    expect(merged.examples.fileNotReviewed).toHaveLength(4);
    expect(merged.examples.fileNotReviewed[0]).toEqual({
      pr: 'pr/1',
      path: 'src/a.cpp',
      note: 'one',
    });
  });

  it('stops at the cap, because a hundred examples are not a hundred times the information', () => {
    const wide = attributeGoldens({
      goldens: Array.from({ length: 20 }, (_, index) => ({
        path: `src/f${index}.cpp`,
        note: `n${index}`,
      })),
      reviewedPaths: [],
      findings: [],
      matches: [],
    });
    const merged = mergeAttributions([{ pr: 'pr/1', ...wide }], { examplesPerBucket: 3 });
    expect(merged.counts.fileNotReviewed).toBe(20);
    expect(merged.examples.fileNotReviewed).toHaveLength(3);
  });

  it('names the bucket to fix first, and nothing when there is nothing to fix', () => {
    expect(largestBucket({ hit: 3, noFindingOnPath: 11, findingOnPathRejected: 2 })).toEqual({
      bucket: 'noFindingOnPath',
      count: 11,
    });
    // A tie is broken by the declared order rather than by object insertion order.
    expect(largestBucket({ findingOnPathRejected: 2, noFindingOnPath: 2 })).toEqual({
      bucket: 'noFindingOnPath',
      count: 2,
    });
    expect(largestBucket({ hit: 4 })).toEqual({ bucket: 'hit', count: 4 });
  });
});
