// **The fusion of two rankings that were each measured to win where the other loses.** The arithmetic is four lines and
// the rules around it are what the tests are for: a repeated path inside one arm, a path only one arm ranked, a tie, a
// cut, and the constant the score was computed with. Every one of them is a case where a plausible implementation
// disagrees with this one, and a disagreement that moves a published mean is worth a test.

import { describe, expect, it } from 'vitest';

import { RRF_K, reciprocalRankFusion } from '../search/fusion.js';

/** The contribution a path at `rank` (counting from one) makes at `k`, **computed here rather than copied from the module**. */
function contribution(rank: number, k: number): number {
  return 1 / (k + rank);
}

describe('reciprocalRankFusion', () => {
  it('**ranks by the sum of the reciprocal ranks**, and publishes every contribution', () => {
    const fused = reciprocalRankFusion([
      { name: 'declarations', ranked: ['a.py', 'b.py'] },
      { name: 'file-level', ranked: ['b.py', 'c.py'] },
    ]);

    // `b.py` is second in both arms; `a.py` is first in one; the sums are what the order follows.
    expect(fused.ranked).toEqual(['b.py', 'a.py', 'c.py']);
    expect(fused.k).toBe(RRF_K);
    const b = fused.scores[0]!;
    expect(b.path).toBe('b.py');
    expect(b.arms['declarations']).toBeCloseTo(contribution(2, RRF_K), 12);
    expect(b.arms['file-level']).toBeCloseTo(contribution(1, RRF_K), 12);
    expect(b.score).toBeCloseTo(contribution(2, RRF_K) + contribution(1, RRF_K), 12);
  });

  it('**a path only one arm ranked still ranks**, which is the whole reason the fusion exists', () => {
    // The pool stops at two files and the answer is the third file's name. A fusion that penalised the absence would
    // leave that file where the pool left it - nowhere - and the band this was built for would not move.
    const fused = reciprocalRankFusion([
      { name: 'declarations', ranked: ['a.py', 'b.py'] },
      { name: 'file-level', ranked: ['c.py', 'd.py'] },
    ]);

    const c = fused.scores.find((entry) => entry.path === 'c.py')!;
    expect(Object.keys(c.arms)).toEqual(['file-level']);
    expect(fused.ranked).toContain('c.py');
  });

  it('**a file repeated inside one arm is one position, not two**', () => {
    // Repetition inside an arm is an artefact of whatever produced it. Counting it twice would let one arm outvote the
    // other by repeating itself, and a reader could not tell that from evidence.
    const fused = reciprocalRankFusion([
      { name: 'declarations', ranked: ['a.py', 'a.py', 'b.py'] },
      { name: 'file-level', ranked: ['b.py'] },
    ]);

    expect(fused.scores.find((entry) => entry.path === 'a.py')!.arms['declarations']).toBeCloseTo(
      contribution(1, RRF_K),
      12,
    );
    // `b.py` is second in the de-duplicated first arm and first in the second.
    expect(fused.ranked[0]).toBe('b.py');
  });

  it('**a tie is broken by path, ascending**', () => {
    // Two paths at the same position in one arm are the same score, and the order has to be a function of the input
    // rather than of the iteration order of a map.
    const fused = reciprocalRankFusion([{ name: 'only', ranked: ['b.py', 'a.py', 'c.py'] }]);
    const tied = fused.scores.filter((entry) => entry.arms['only'] === contribution(1, RRF_K));
    expect(tied.map((entry) => entry.path)).toEqual(['b.py']);
    const symmetric = reciprocalRankFusion([
      { name: 'left', ranked: ['zeta.py'] },
      { name: 'right', ranked: ['alpha.py'] },
    ]);
    expect(symmetric.ranked).toEqual(['alpha.py', 'zeta.py']);
  });

  it('**the cut is a view, not a loss**: `scores` holds every path any arm ranked', () => {
    const fused = reciprocalRankFusion(
      [{ name: 'declarations', ranked: ['a.py', 'b.py', 'c.py'] }],
      { limit: 1 },
    );
    expect(fused.ranked).toEqual(['a.py']);
    expect(fused.scores.map((entry) => entry.path)).toEqual(['a.py', 'b.py', 'c.py']);
  });

  it('**a negative limit returns nothing rather than everything**', () => {
    // `slice(0, -1)` drops the last element, which would be a silent off-by-one in a caller's loop.
    expect(reciprocalRankFusion([{ name: 'x', ranked: ['a.py'] }], { limit: -3 }).ranked).toEqual(
      [],
    );
  });

  it('**no arms is an empty ranking, not a throw**', () => {
    const fused = reciprocalRankFusion([]);
    expect(fused.ranked).toEqual([]);
    expect(fused.scores).toEqual([]);
    expect(fused.k).toBe(RRF_K);
  });

  it('**the constant decides whether a file both arms ranked outranks a file one arm ranked first**', () => {
    // **Why the shipped constant is a parameter rather than a detail.** A path at rank 5 of *both* arms scores
    // `2 / (k + 5)`; a path at rank 1 of one arm and absent from the other scores `1 / (k + 1)`. The first beats the
    // second exactly when `k > 3` - so at `k = 1` the single top hit wins, at `k = 4` and above the agreement wins - and
    // the shipped value of 60 sits deep inside the region where agreement wins. Bruch, Gai and Ingber (2022) report
    // that reciprocal rank fusion is more sensitive to this constant than the folklore assumes; this is the shape of
    // that sensitivity, in two lines of arithmetic.
    const arms = (k: number) =>
      reciprocalRankFusion(
        [
          { name: 'a', ranked: ['first.py', 'a2.py', 'a3.py', 'a4.py', 'p.py'] },
          { name: 'b', ranked: ['z1.py', 'z2.py', 'z3.py', 'z4.py', 'p.py'] },
        ],
        { k },
      ).ranked;
    // At `k = 1` the one-armed path that leads an arm outranks the path both arms placed fifth.
    expect(arms(1)[0]).toBe('first.py');
    // At `k = 4` the inequality turns over, and it stays turned over at the shipped constant.
    expect(arms(4)[0]).toBe('p.py');
    expect(arms(RRF_K)[0]).toBe('p.py');
  });

  it('**the constant is published and passed through**, so an ablation cannot run an unpublished `k`', () => {
    const fused = reciprocalRankFusion([{ name: 'x', ranked: ['a.py'] }], { k: 10 });
    expect(fused.k).toBe(10);
    expect(fused.scores[0]!.score).toBeCloseTo(contribution(1, 10), 12);
  });

  it('**an arm named twice accumulates under one name**, which the artifact reads as one contribution', () => {
    const fused = reciprocalRankFusion([
      { name: 'file-level', ranked: ['a.py'] },
      { name: 'file-level', ranked: ['a.py', 'b.py'] },
    ]);
    const a = fused.scores.find((entry) => entry.path === 'a.py')!;
    expect(a.arms['file-level']).toBeCloseTo(contribution(1, RRF_K) + contribution(1, RRF_K), 12);
  });
});
