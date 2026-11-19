/**
 * **The four numbers R-41 is read against are arithmetic over an artifact, and this is the arithmetic.**
 *
 * The prediction has three parts - an anchoring rate, a precision among anchored comments, and an F1 that must clear
 * 0.28 - and each can be computed wrongly in a way that flatters the device:
 *
 * - **a rate over the wrong denominator**: over every finding ever parsed, the anchor question is asked of comments no
 *   reader will see, and the rate measured there is a rate about the model's obedience rather than about the review;
 * - **a precision that re-decides what a hit is**: the judge already matched this run's comments to goldens, and a second
 *   matcher here would be a second measurement wearing the first one's name;
 * - **a recall with its own denominator**: recall among a subset is free to raise by naming fewer comments, so the
 *   false negatives are the artifact's, not this file's.
 *
 * The fixture below makes each of those distinguishable: one anchored true positive, one anchored false positive (the
 * case that ends the programme), one unanchored true positive and two unanchored false positives.
 */
import { describe, expect, it } from 'vitest';

import { anchorTable, findingsOf, formatAnchorTable } from '../../../scripts/anchor-rate.mjs';

interface Row {
  matchedGoldens: string[];
  features: Record<string, unknown>;
}

const row = (anchored: boolean, matched: boolean): Row => ({
  matchedGoldens: matched ? ['g'] : [],
  features: { anchored },
});

const ROWS: Row[] = [
  row(true, true),
  row(true, false),
  row(false, true),
  row(false, false),
  row(false, false),
];

describe('the anchor table', () => {
  it('counts the anchoring rate over the comments that were emitted, not over every row it was given', () => {
    const table = anchorTable(ROWS, 5);
    expect(table.emitted).toBe(5);
    expect(table.anchoringRate).toBeCloseTo(0.4, 4);
  });

  it('takes a hit from the judge’s matching rather than deciding one', () => {
    const table = anchorTable(ROWS, 5);
    expect(table.anchored.tp).toBe(1);
    expect(table.unanchored.tp).toBe(1);
    expect(table.all.tp).toBe(2);
  });

  it('reads recall against the artifact’s own false negatives, so a subset cannot buy recall by emitting less', () => {
    // One anchored true positive against five false negatives: 1/6, not 1/2.
    expect(anchorTable(ROWS, 5).anchored.recall).toBeCloseTo(1 / 6, 6);
  });

  it('separates anchored-and-wrong from unanchored-and-wrong, which is the pair the verdict turns on', () => {
    expect(anchorTable(ROWS, 5).cell).toEqual({
      anchoredAndRight: 1,
      anchoredAndWrong: 1,
      unanchoredAndRight: 1,
      unanchoredAndWrong: 2,
    });
  });

  it('reports zero rather than NaN for an artifact written before the field existed', () => {
    const table = anchorTable([{ matchedGoldens: [], features: {} }], 0);
    expect(table.anchoringRate).toBe(0);
    expect(table.anchored.f1).toBe(0);
  });

  it('prints the same four decimals twice, so two runs can be subtracted', () => {
    const printed = formatAnchorTable(anchorTable(ROWS, 5));
    expect(printed).toContain('anchoring rate 0.4000 over 5 emitted comments');
    expect(printed).toContain('| anchored    |      2 |   1 |    0.5000 | 0.1667 | 0.2500 |');
  });
});

describe('the artifact reader', () => {
  it('prefers the pull-request arm, whose ranked list is the shipped cut', () => {
    const artifact = {
      falseNegatives: 1,
      rankedFindings: [row(false, false)],
      pullRequestArm: { rankedFindings: [row(true, true)] },
    };
    expect(findingsOf(artifact)).toHaveLength(1);
    expect(anchorTable(findingsOf(artifact), 1).anchoringRate).toBe(1);
  });

  it('falls back to the top-level list for an artifact written before the arm was split', () => {
    expect(findingsOf({ rankedFindings: [row(true, true)] })).toHaveLength(1);
  });

  it('answers an artifact with no list at all with an empty list rather than throwing', () => {
    expect(findingsOf({})).toEqual([]);
  });
});
