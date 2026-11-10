// **A rejection has two causes and the artifact used to report them as one.**
//
// `findingOnPathRejected` says *"the lanes spoke on that file and none of it was accepted"*. That sentence is true of a
// lane that read the right file and looked somewhere else, **and of a lane that stood on the golden's own line and said
// it in words the judge would not accept as the same defect.** The first is a search problem and the second is a
// sentence problem, **and an iteration spent on the wrong one is an iteration**.
//
// **The coordinate was in hand the whole time.** The corpus states `from_line`; the finding states its range; nothing
// compared them. These tests hold the comparison: a range that covers the golden's line is distance zero rather than the
// offset from its first line, a golden the corpus did not locate is `noLine` rather than silently `beyond50`, and the
// shape table is asserted to add up to the bucket it re-reads.
//
// **The numbers in the first test are the ones the run of 2026-11-10 produced**, so the fixture and the finding cannot
// drift apart without one of them failing.

import { describe, expect, it } from 'vitest';

import {
  REJECTION_SHAPES,
  attributeGoldens,
  dominantRejectionShape,
  mergeAttributions,
  nearestFindingDistance,
  rejectionShapeOf,
} from '../../../.github/scripts/lib/golden-attribution.mjs';

describe('the distance from a golden to what was said on its own file', () => {
  it('calls a range that covers the golden distance zero, not the offset from its first line', () => {
    expect(nearestFindingDistance(1120, [{ startLine: 1110, endLine: 1130 }])).toBe(0);
    // **The same finding, counted the wrong way**: 1120 - 1110 is the number a naive implementation reports, and it
    // files a finding that *covers* the line under `within10` as though it merely came near it.
    expect(nearestFindingDistance(1120, [{ startLine: 1110, endLine: 1130 }])).not.toBe(10);
  });

  it('measures to the nearer edge of a range below the golden', () => {
    expect(nearestFindingDistance(100, [{ startLine: 140, endLine: 160 }])).toBe(40);
  });

  it('takes the nearest of several findings on the path', () => {
    expect(
      nearestFindingDistance(100, [
        { startLine: 1, endLine: 2 },
        { startLine: 300, endLine: 301 },
        { startLine: 108, endLine: 109 },
      ]),
    ).toBe(8);
  });

  it('falls back to whichever end a finding carries, and gives up when neither does', () => {
    expect(nearestFindingDistance(100, [{ startLine: 105 }])).toBe(5);
    expect(nearestFindingDistance(100, [{ endLine: 95 }])).toBe(5);
    expect(nearestFindingDistance(100, [{ startLine: null, endLine: null }])).toBeNull();
    expect(nearestFindingDistance(100, [])).toBeNull();
  });

  it('reads the range whether the caller keeps it flat or nested under the finding', () => {
    // **The bench script's `ranked` entries are `{ path, finding: { startLine }, score }`**, and the first version of
    // this function read only the flat shape - so **every rejection in the corpus would have been filed as `noLine`**:
    // a table that is empty, plausible, and wrong. The `--dry-run` fixture caught it before a run published it, and
    // this test holds both shapes so it cannot come back.
    expect(nearestFindingDistance(100, [{ path: 'a', startLine: 100, endLine: 100 }])).toBe(0);
    expect(
      nearestFindingDistance(100, [{ path: 'a', finding: { startLine: 100, endLine: 100 } }]),
    ).toBe(0);
    expect(
      nearestFindingDistance(100, [{ path: 'a', finding: { startLine: 130, endLine: 140 } }]),
    ).toBe(30);
  });

  it('refuses to measure a golden the corpus did not locate', () => {
    // **Not `beyond50` and not `sameLine`**: a golden with no line is a hole in the corpus, and a hole counted as a
    // targeting defect would send the next iteration to fix a lane that was never wrong.
    expect(nearestFindingDistance(null, [{ startLine: 10, endLine: 12 }])).toBeNull();
    expect(nearestFindingDistance(0, [{ startLine: 10, endLine: 12 }])).toBeNull();
    expect(nearestFindingDistance(Number.NaN, [{ startLine: 10 }])).toBeNull();
  });
});

describe('a rejection is shaped by its distance', () => {
  it('splits at the two thresholds a reader would use', () => {
    expect(rejectionShapeOf(0)).toBe('sameLine');
    expect(rejectionShapeOf(1)).toBe('within10');
    expect(rejectionShapeOf(10)).toBe('within10');
    // **Eleven lines is not "within ten"**, and a threshold that rounds in the reader's favour is a threshold that
    // reports agreement the reader would not see.
    expect(rejectionShapeOf(11)).toBe('beyond50');
    expect(rejectionShapeOf(50)).toBe('beyond50');
    expect(rejectionShapeOf(null)).toBe('noLine');
  });

  it('re-reads the run of 2026-11-10 as 40 same-line, 33 within ten, 16 beyond, 9 unlocated', () => {
    // **Placed at the distances the run reported**, and then attributed through the public entry point so that the
    // shape is what `attributeGoldens` actually produces for a rejected golden rather than what a direct call would.
    const distances = [
      ...Array.from({ length: 40 }, () => 0),
      ...Array.from({ length: 33 }, () => 5),
      ...Array.from({ length: 16 }, () => 400),
      ...Array.from({ length: 9 }, () => null),
    ];
    const attribution = attributeGoldens({
      goldens: distances.map((distance, index) => ({
        path: 'src/a.cpp',
        note: `golden ${index}`,
        // A finding stands at line 1; the golden is placed at 1 + distance, so the distance is what the array says.
        startLine: distance === null ? null : 1 + distance,
        endLine: distance === null ? null : 1 + distance,
      })),
      reviewedPaths: ['src/a.cpp'],
      findings: [{ path: 'src/a.cpp', startLine: 1, endLine: 1 }],
      matches: [],
    });

    expect(attribution.counts.findingOnPathRejected).toBe(98);
    const merged = mergeAttributions([{ pr: 'pr/1', ...attribution }]);
    expect(merged.rejectionShape).toEqual({ sameLine: 40, within10: 33, beyond50: 16, noLine: 9 });
    expect(dominantRejectionShape(merged.rejectionShape)).toEqual({ shape: 'sameLine', count: 40 });
  });

  it('leaves proximity null on every bucket that is not a rejection', () => {
    const attribution = attributeGoldens({
      goldens: [
        { path: 'src/a.cpp', note: 'hit', startLine: 5 },
        { path: '', note: 'no path', startLine: 5 },
        { path: 'src/b.cpp', note: 'not read', startLine: 5 },
        { path: 'src/c.cpp', note: 'read, silence', startLine: 5 },
      ],
      reviewedPaths: ['src/a.cpp', 'src/c.cpp'],
      findings: [{ path: 'src/a.cpp', startLine: 5, endLine: 5 }],
      matches: [[0]],
    });
    expect(attribution.perGolden.map((golden) => golden.bucket)).toEqual([
      'hit',
      'noPath',
      'fileNotReviewed',
      'noFindingOnPath',
    ]);
    // **A zero on a `hit` would read as a coincidence that happened**, which is exactly the confusion this field is
    // meant to prevent, so every non-rejection carries `null`.
    expect(attribution.perGolden.map((golden) => golden.proximity)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('refuses a shape table that does not add up to the bucket it re-reads', () => {
    // Handed a crafted entry whose `perGolden` disagrees with its own counts: the merge must throw rather than publish
    // a second table with a row missing.
    expect(() =>
      mergeAttributions([
        {
          counts: {
            hit: 0,
            noPath: 0,
            fileNotReviewed: 0,
            noFindingOnPath: 0,
            findingOnPathRejected: 3,
          },
          perGolden: [{ bucket: 'findingOnPathRejected', path: 'a', note: '', proximity: 0 }],
          total: 3,
        },
      ]),
    ).toThrow(/rejection shapes do not add up/);
  });

  it('names no shape when nothing was rejected', () => {
    expect(dominantRejectionShape({})).toBeNull();
    expect(REJECTION_SHAPES).toHaveLength(4);
  });
});
