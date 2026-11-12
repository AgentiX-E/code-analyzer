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
  nearestOnPath,
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
          perGolden: [
            {
              index: 0,
              bucket: 'findingOnPathRejected',
              path: 'a',
              note: '',
              matchedFindings: [],
              proximity: 0,
              nearestFinding: null,
            },
          ],
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

describe('a rejection carries the finding it rejected, not only how far away it was', () => {
  /** A ranked finding in the shape the bench script builds, so the gate verdict and the sentence are both read. */
  const ranked = (startLine: number, actionable: boolean) => ({
    path: 'src/renderer/blocks.ts',
    finding: {
      startLine,
      endLine: startLine + 2,
      title: 'the checkpoint path calls `block` positionally',
      description: 'the forward pass is skipped under gradient checkpointing',
    },
    score: { actionable, why: actionable ? ['grounded'] : ['no change proposed'] },
  });

  it('returns the nearest finding with its coordinates, its gate verdict and its sentence', () => {
    // **The arithmetic, before the assertion**: the middle finding spans 118-120 and so covers line 120, which is
    // distance zero rather than the two lines between its start and the golden - the same rule
    // `nearestFindingDistance` has always applied, now returning the entry it was measured to.
    const near = nearestOnPath(120, [ranked(400, false), ranked(118, true), ranked(200, true)]);
    expect(near?.at).toBe(1);
    expect(near?.distance).toBe(0);
    // **The gate's verdict travels with the evidence**, because it is the field that decides which repair the next
    // iteration owes: a kept finding at distance zero is a wording defect, a dropped one is a gate calibration defect.
    const scored = near?.finding as { score?: { actionable?: boolean } } | undefined;
    expect(scored?.score?.actionable).toBe(true);
  });

  it('still returns a finding when the golden has no line, and says the distance is unknown', () => {
    // **The one shape that would otherwise have nothing behind it.** `noLine` is a hole in the corpus rather than a
    // targeting defect, and dropping the evidence because the distance could not be computed would leave the reader
    // with a shape and no sentence.
    const near = nearestOnPath(null, [ranked(10, false)]);
    expect(near?.at).toBe(0);
    expect(near?.distance).toBeNull();
  });

  it('takes the nearer of two candidates, and keeps the higher-ranked one on a tie', () => {
    // 90-92 is eight lines above line 100, 110-112 is ten below: the nearer one is the first.
    expect(nearestOnPath(100, [ranked(90, true), ranked(110, false)])?.at).toBe(0);
    expect(nearestOnPath(100, [ranked(400, true), ranked(110, false)])?.at).toBe(1);
    // **A genuine tie**: 90-92 is six lines above line 98 and 104-106 is six below, so the ranked order decides.
    const tie = nearestOnPath(98, [ranked(90, true), ranked(104, false)]);
    expect(tie?.at).toBe(0);
    expect(tie?.distance).toBe(6);
  });

  it('gives up when no finding on the path has coordinates', () => {
    // **Not `sameLine` and not `beyond50`**: a finding with no line is a hole on our side, and calling it zero would
    // report agreement that nobody measured.
    expect(nearestOnPath(100, [{ startLine: null, endLine: null }])).toBeNull();
    expect(nearestOnPath(100, [])).toBeNull();
  });

  it('takes the first placed finding when the golden is the one without coordinates', () => {
    const near = nearestOnPath(null, [{ startLine: null }, ranked(300, true), ranked(10, false)]);
    expect(near?.at).toBe(1);
    expect(near?.distance).toBeNull();
  });

  it('publishes the finding in the record, and only for a rejection', () => {
    const attribution = attributeGoldens({
      goldens: [
        // Four lines below the finding's end, so the row is a rejection that is *near* rather than on the line.
        {
          path: 'src/renderer/blocks.ts',
          note: 'the golden the lane commented near',
          startLine: 124,
        },
        { path: 'src/other.ts', note: 'a file the lane never read', startLine: 4 },
      ],
      reviewedPaths: ['src/renderer/blocks.ts'],
      findings: [ranked(118, true)],
      matches: [],
    });
    const [rejection, hole] = attribution.perGolden;
    expect(rejection?.bucket).toBe('findingOnPathRejected');
    expect(rejection?.proximity).toBe(4);
    expect(rejection?.nearestFinding).toEqual({
      at: 0,
      startLine: 118,
      endLine: 120,
      actionable: true,
      why: ['grounded'],
      text: 'the checkpoint path calls `block` positionally :: the forward pass is skipped under gradient checkpointing',
    });
    // **Null on everything that is not a rejection**, so a zero cannot be read as a finding that happened to be there.
    expect(hole?.nearestFinding).toBeNull();
  });

  it('carries the evidence through the merge, because the artifact is where it has to be read', () => {
    const attribution = attributeGoldens({
      goldens: [{ path: 'src/renderer/blocks.ts', note: 'rejected', startLine: 119 }],
      reviewedPaths: ['src/renderer/blocks.ts'],
      findings: [ranked(120, false)],
      matches: [],
    });
    const merged = mergeAttributions([{ pr: 'pr/1', ...attribution }]);
    expect(merged.records).toHaveLength(1);
    expect(merged.records[0]?.nearestFinding).toMatchObject({ at: 0, actionable: false });
    // **And the gate's reason, which is what a calibration defect is diagnosed from** - the words, not only the flag.
    expect(merged.records[0]?.nearestFinding?.why).toEqual(['no change proposed']);
  });
});
