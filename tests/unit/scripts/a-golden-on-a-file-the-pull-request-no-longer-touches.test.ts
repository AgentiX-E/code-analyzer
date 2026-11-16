// **Fifty-four of the corpus's 724 goldens sit on files the pull request no longer touches, and the bucket called them
// our fault.**
//
// The corpus is a snapshot of other people's pull requests, and a pull request is a moving object: heads are
// force-pushed, files are dropped from a series, a revert lands. `ClickHouse/ClickHouse#74070` carried fifteen goldens
// on `src/Functions/FunctionStrncmp.cpp` and today the pull request has five changed files and that is not one of them;
// `google-gemini/gemini-cli#4828` and `#5819` are the same shape. **A golden on a path the pull request does not have
// is not a missed finding - it is a row no reviewer could answer, ours or the competitor's**, and a bucket table that
// files it under "the file was never handed to the engine" sends the next iteration looking for a path filter that is
// working correctly.
//
// **The distinction is decidable and it costs one request per pull request**: the file list is `pulls/{n}/files`, and a
// golden whose path is not in it is `pathNotInPull`; a golden whose path *is* in it and whose diff section was never
// handed to the engine is `fileNotReviewed`, which is what that bucket was always supposed to mean. **When the list
// cannot be fetched the old reading stands**, because a classification that guesses in the absence of evidence is worse
// than one that says less.

import { describe, expect, it } from 'vitest';

import {
  GOLDEN_BUCKETS,
  attributeGoldens,
  mergeAttributions,
} from '../../../.github/scripts/lib/golden-attribution.mjs';

const goldens = [
  { path: 'src/kept.cpp', note: 'the guard reads past the end' },
  { path: 'src/dropped.cpp', note: 'the lock is taken twice' },
  { path: 'src/split.cpp', note: 'no bounds check on the copy' },
];

describe('a golden the pull request can no longer answer', () => {
  it('is a bucket of its own, ahead of the one that names a filter', () => {
    const result = attributeGoldens({
      goldens,
      // The pull request's own file list, today: `src/dropped.cpp` is gone from it, and `src/split.cpp` is in it but
      // its section did not survive the split.
      pullPaths: ['src/kept.cpp', 'src/split.cpp'],
      reviewedPaths: ['src/kept.cpp'],
      findings: [{ path: 'src/kept.cpp' }],
      matches: [[0]],
    });

    expect(result.counts.pathNotInPull).toBe(1);
    expect(result.counts.fileNotReviewed).toBe(1);
    expect(result.counts.hit).toBe(1);
    const dropped = result.perGolden.find((row) => row.path === 'src/dropped.cpp');
    expect(dropped?.bucket).toBe('pathNotInPull');
    const split = result.perGolden.find((row) => row.path === 'src/split.cpp');
    expect(split?.bucket).toBe('fileNotReviewed');
  });

  it('is still a partition, and the new bucket is part of the declared order', () => {
    const result = attributeGoldens({
      goldens,
      pullPaths: ['src/kept.cpp'],
      reviewedPaths: [],
      findings: [],
      matches: [],
    });
    const total = GOLDEN_BUCKETS.reduce((sum, bucket) => sum + result.counts[bucket], 0);
    expect(total).toBe(goldens.length);
    expect(GOLDEN_BUCKETS.indexOf('pathNotInPull')).toBeLessThan(
      GOLDEN_BUCKETS.indexOf('fileNotReviewed'),
    );
  });

  it('falls back to the bucket that names a filter when the file list is unknown', () => {
    const result = attributeGoldens({
      goldens,
      pullPaths: null,
      reviewedPaths: ['src/kept.cpp'],
      findings: [],
      matches: [],
    });
    expect(result.counts.pathNotInPull).toBe(0);
    expect(result.counts.fileNotReviewed).toBe(2);
  });

  it('does not reclassify a golden that was hit, whatever the file list says', () => {
    const result = attributeGoldens({
      goldens,
      pullPaths: [],
      reviewedPaths: ['src/kept.cpp'],
      findings: [{ path: 'src/kept.cpp' }],
      matches: [[0], [], []],
    });
    expect(result.counts.hit).toBe(1);
    expect(result.perGolden[0]?.bucket).toBe('hit');
  });

  it('arrives in the merged table, because the merged table is what the artifact publishes', () => {
    const one = attributeGoldens({
      goldens,
      pullPaths: ['src/kept.cpp'],
      reviewedPaths: ['src/kept.cpp'],
      findings: [{ path: 'src/kept.cpp' }],
      matches: [[0]],
    });
    const merged = mergeAttributions([{ pr: 'one', ...one }]);
    expect(merged.counts.pathNotInPull).toBe(2);
    expect(merged.total).toBe(goldens.length);
    expect(merged.records.filter((row) => row.bucket === 'pathNotInPull')).toHaveLength(2);
  });
});
