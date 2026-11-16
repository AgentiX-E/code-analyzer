import { describe, expect, it } from 'vitest';
import { decomposeMisses, describeMisses } from '../../../scripts/lib/miss-anatomy.mjs';

/**
 * **The diagnostic that tells two repairs apart.**
 *
 * A golden rejected on a path we commented on has two very different causes: our comment at that site *was* accepted,
 * for a different issue, so the site needed a second sentence; or our comment at that site was accepted by nothing, so
 * the sentence is what failed. **Both cost exactly one false negative and one false positive, both are consistent with
 * the same precision and recall, and the artifact's own bucket names them identically** - which is why this table has to
 * exist before the next device is chosen rather than after it fails.
 */
const finding = (overrides = {}) => ({
  path: 'src/a.ts',
  startLine: 10,
  text: 'the queue is never drained',
  matchedGoldens: [],
  ...overrides,
});

const reject = (overrides = {}) => ({
  bucket: 'findingOnPathRejected',
  path: 'src/a.ts',
  proximity: 0,
  note: 'a golden',
  nearestFinding: { startLine: 10, text: 'the queue is never drained' },
  ...overrides,
});

describe('the anatomy of a missed golden', () => {
  it('splits a reject by the band it sits in and by whether its neighbour was accepted', () => {
    const anatomy = decomposeMisses({
      rankedFindings: [
        finding({ matchedGoldens: [{ goldenIndex: 0 }] }),
        finding({ startLine: 40, text: 'the retry has no bound' }),
      ],
      missedGoldens: {
        records: [
          // On our own line, beside a comment that was accepted elsewhere: the site needed a second sentence.
          reject(),
          // On our own line, beside a comment nothing accepted.
          reject({ nearestFinding: { startLine: 40, text: 'the retry has no bound' } }),
          // Fifty lines away from an accepted comment.
          reject({
            proximity: 55,
            nearestFinding: { startLine: 10, text: 'the queue is never drained' },
          }),
          // And one the attribution already explains without us.
          { bucket: 'pathNotInPull', path: 'src/gone.ts', proximity: null },
        ],
      },
    });

    expect(anatomy.rejected).toBe(3);
    expect(anatomy.matrix.sameLine).toEqual({ 'true-positive': 1, 'false-positive': 1 });
    expect(anatomy.matrix.beyond).toEqual({ 'true-positive': 1, 'false-positive': 0 });
    expect(anatomy.neighbourIsAccepted).toBeCloseTo(0.667, 3);
    // **And the bucket the reviewer cannot reach by rewriting anything**, which is why it is not in the matrix.
    expect(anatomy.silence.pathNotInPull).toBe(1);
    expect(anatomy.reconciled).toBe(true);
  });

  it('refuses a neighbour that matches on text but sits on another path', () => {
    // **The path check is what keeps a repeated sentence from linking two files**: "the retry has no bound" can be a true
    // comment on two implementations, and linking them would credit a comment on one file with a golden on another.
    const anatomy = decomposeMisses({
      rankedFindings: [finding({ path: 'src/other.ts', matchedGoldens: [{ goldenIndex: 1 }] })],
      missedGoldens: { records: [reject()] },
    });
    expect(anatomy.unlinked).toBe(1);
    expect(anatomy.matrix.sameLine['true-positive']).toBe(0);
  });

  it('links the neighbour by its text, because the index the artifact carries is not an index', () => {
    // `nearestFinding.at` was read as an index into `rankedFindings` and it is not one: on `43795692468` it named a
    // different line in fifty of fifty sampled records. **A linkage that trusted it would attribute every miss to an
    // unrelated comment** - so the link is made on the text and line the record carries, and a record that cannot be
    // linked is reported rather than counted as a false positive.
    const anatomy = decomposeMisses({
      rankedFindings: [finding({ matchedGoldens: [{ goldenIndex: 3 }] })],
      missedGoldens: {
        records: [
          reject({
            nearestFinding: { at: 999, startLine: 10, text: 'the queue is never drained' },
          }),
        ],
      },
    });
    expect(anatomy.matrix.sameLine['true-positive']).toBe(1);
    expect(anatomy.unlinked).toBe(0);
  });

  it('reports an unlinkable neighbour instead of inventing one', () => {
    const anatomy = decomposeMisses({
      rankedFindings: [finding()],
      missedGoldens: {
        records: [
          reject({
            nearestFinding: { startLine: 77, text: 'something this artifact never ranked' },
          }),
        ],
      },
    });
    expect(anatomy.unlinked).toBe(1);
    expect(anatomy.reconciled).toBe(true);
    expect(anatomy.matrix.sameLine).toEqual({ 'true-positive': 0, 'false-positive': 0 });
  });

  it('says it has lost a row rather than printing a total that disagrees with the artifact', () => {
    // **The reconciliation is the assertion, not the arithmetic**: a matrix that silently dropped an unlinkable record
    // would report a smaller denominator than the artifact and a *higher* share of neighbours accepted, which is the
    // direction that flatters the reviewer.
    const anatomy = decomposeMisses({
      rankedFindings: [],
      missedGoldens: { records: [reject(), reject({ nearestFinding: null }), { bucket: 'hit' }] },
    });
    expect(anatomy.rejected).toBe(2);
    expect(anatomy.unlinked).toBe(2);
    expect(anatomy.reconciled).toBe(true);
  });

  it('describes itself from the object, so two descriptions of one number cannot drift', () => {
    const anatomy = decomposeMisses({
      rankedFindings: [finding({ matchedGoldens: [{ goldenIndex: 0 }] })],
      missedGoldens: {
        records: [reject(), { bucket: 'noFindingOnPath' }, { bucket: 'fileNotReviewed' }],
      },
    });
    const line = describeMisses(anatomy);
    expect(line).toContain('1 rejected on a path we commented on');
    expect(line).toContain('1 on our own line');
    expect(line).toContain('100.0 % of rejects sit beside a true positive');
    expect(line).toContain('silence 1 on a path we read');
    expect(decomposeMisses({ missedGoldens: { records: [] } }).goldens).toBe(0);
    expect(describeMisses(decomposeMisses({ missedGoldens: { records: [] } }))).toContain(
      'no golden',
    );
  });
});
