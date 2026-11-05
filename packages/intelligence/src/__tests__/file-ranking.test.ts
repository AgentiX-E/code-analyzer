// The conversion from a ranking of declarations to a ranking of files, tested where the five aggregations disagree.
//
// **A test that only asserts the shipped aggregation agrees with itself is not a test.** `max` is `max`, and every
// ordering it produces would also be produced by the ten lines it replaces - so the cases below are chosen for the
// rows where the aggregations give different answers, which is the only place the choice is a decision rather than a
// rewrite.

import { describe, expect, it } from 'vitest';

import {
  FILE_AGGREGATIONS,
  FILE_AGGREGATION,
  rankFiles,
  type PoolEntry,
} from '../search/file-ranking.js';

/** A file with one declaration, and the score that declaration was given. */
function entry(filePath: string, score: number): PoolEntry {
  return { filePath, score };
}

/** The order of the paths, which is what every assertion below is about. */
function order(pool: readonly PoolEntry[], aggregation: Parameters<typeof rankFiles>[1]): string[] {
  return rankFiles(pool, aggregation).map((file) => file.filePath);
}

describe('the aggregation the product ships', () => {
  it('is `top2`, and it is stated rather than implied', () => {
    // **Measured, not preferred**: on 108 Long Code Arena instances `top2` gained +0.0290 MAP over `max` with an
    // interval that excludes zero, and lifted the first-place count from 50 to 58. `max` stays in the list because it
    // is the reading the product used until then, and a reader comparing two artifacts needs the row to still be there.
    expect(FILE_AGGREGATION).toBe('top2');
    expect(FILE_AGGREGATIONS[0]).toBe('max');
  });

  it('reproduces first appearance exactly, which is what the previous rule was', () => {
    // Three files interleaved in the pool, so a grouping that sorted by path, by count or by anything else would
    // produce a different order than the pool did.
    const pool = [
      entry('b.py', 9),
      entry('a.py', 8),
      entry('b.py', 7),
      entry('c.py', 6),
      entry('a.py', 5),
    ];
    const firstAppearance: string[] = [];
    for (const item of pool)
      if (!firstAppearance.includes(item.filePath)) firstAppearance.push(item.filePath);
    expect(order(pool, 'max')).toEqual(firstAppearance);
  });

  it('equals `max` because a file with one declaration has no other reading', () => {
    const pool = [entry('x.py', 1), entry('y.py', 2), entry('z.py', 3)];
    expect(order(pool, 'max')).toEqual(['z.py', 'y.py', 'x.py']);
    expect(order(pool, 'sum')).toEqual(['z.py', 'y.py', 'x.py']);
    expect(order(pool, 'count')).toEqual(['x.py', 'y.py', 'z.py']);
  });
});

describe('when the file is read as the union of its declarations', () => {
  // The case the aggregation exists for: `spread` has three declarations of 4, 3 and 3, `peak` has one of 8. A
  // first-appearance ranking puts `peak` first, because one declaration outscored every declaration in `spread`.
  const pool = [
    entry('peak.py', 8),
    entry('spread.py', 4),
    entry('spread.py', 3),
    entry('spread.py', 3),
  ];

  it('promotes the file the question reached three times', () => {
    expect(order(pool, 'max')).toEqual(['peak.py', 'spread.py']);
    expect(order(pool, 'sum')).toEqual(['spread.py', 'peak.py']);
  });

  it('reports how many declarations contributed', () => {
    const ranked = rankFiles(pool, 'sum');
    expect(ranked.map((file) => file.contributors)).toEqual([3, 1]);
    expect(ranked[0]!.score).toBe(10);
  });

  it('reads the whole file even when its declarations arrive in any order', () => {
    const shuffled = [
      entry('peak.py', 8),
      entry('spread.py', 3),
      entry('spread.py', 3),
      entry('spread.py', 4),
    ];
    expect(order(shuffled, 'sum')).toEqual(order(pool, 'sum'));
    // **Not only `sum`**: `top2` and `top3` read the best ones, and "the best ones" is a property of the scores rather
    // than of their arrival.
    expect(order(shuffled, 'top2')).toEqual(order(pool, 'top2'));
  });
});

describe('when breadth is bounded', () => {
  // A vendored directory is a file with two hundred declarations. `sum` rewards that; a bound does not.
  const pool = [
    entry('vendored.py', 1),
    entry('vendored.py', 1),
    entry('vendored.py', 1),
    entry('vendored.py', 1),
    entry('vendored.py', 1),
    entry('answer.py', 3),
    entry('answer.py', 2),
  ];

  it('does not let a long tail outvote a shorter, better file under `top2`', () => {
    expect(order(pool, 'sum')).toEqual(['vendored.py', 'answer.py']);
    expect(order(pool, 'top2')).toEqual(['answer.py', 'vendored.py']);
  });

  it('gives the same answer at `top3`, because the tail is worth nothing either way', () => {
    expect(order(pool, 'top3')).toEqual(['answer.py', 'vendored.py']);
    expect(rankFiles(pool, 'top3')[0]!.score).toBe(5);
  });

  it('counts declarations and ignores their magnitude under `count`', () => {
    expect(order(pool, 'count')).toEqual(['vendored.py', 'answer.py']);
    expect(rankFiles(pool, 'count').map((file) => file.score)).toEqual([5, 2]);
  });

  it('breaks a tie on the pool, not on the path and not on the grouping order', () => {
    // Two files, one declaration each, the same score. `b.py` came first, so `b.py` is first - even though `a.py`
    // sorts before it and even though some other order would be "nicer".
    const tied = [entry('b.py', 5), entry('a.py', 5)];
    for (const aggregation of FILE_AGGREGATIONS) {
      expect(order(tied, aggregation)).toEqual(['b.py', 'a.py']);
    }
  });
});

describe('the one-parameter blend, whose ends are `max` and `top2`', () => {
  // Two files: `peak` has one declaration of 6, `pair` has two of 4 and 4. `max` prefers the peak, `top2` prefers the
  // pair, and every blend weight between them has to be monotone - which is what makes the family a dose-response
  // rather than five chances to find a winner.
  const pool = [entry('peak.py', 6), entry('pair.py', 4), entry('pair.py', 4)];
  const scoreOf = (aggregation: Parameters<typeof rankFiles>[1], file: string): number =>
    rankFiles(pool, aggregation).find((entry) => entry.filePath === file)!.score;

  it('starts at `max` and ends at `top2`', () => {
    expect(scoreOf('blend25', 'pair.py')).toBe(5);
    expect(scoreOf('blend50', 'pair.py')).toBe(6);
    expect(scoreOf('blend75', 'pair.py')).toBe(7);
    // **The ends are the two arms already published**, so the curve is comparable with them rather than being a third
    // scale that means nothing beside the others.
    expect(scoreOf('max', 'pair.py')).toBe(4);
    expect(scoreOf('top2', 'pair.py')).toBe(8);
  });

  it('moves the order at the weight where the second declaration outweighs the gap, and not before', () => {
    // 6 against 4 + 0.25x4 = 5: the peak still wins. 6 against 4 + 0.5x4 = 6: **a tie, and the pool breaks it** -
    // `peak.py` came first, so it stays first. 6 against 4 + 0.75x4 = 7: the pair wins.
    expect(order(pool, 'blend25')).toEqual(['peak.py', 'pair.py']);
    expect(order(pool, 'blend50')).toEqual(['peak.py', 'pair.py']);
    expect(order(pool, 'blend75')).toEqual(['pair.py', 'peak.py']);
  });

  it('counts the same declaration twice only when the file really has two', () => {
    const single = [entry('solo.py', 6)];
    for (const aggregation of ['blend25', 'blend50', 'blend75'] as const) {
      expect(rankFiles(single, aggregation)[0]!.score).toBe(6);
    }
  });
});

describe('degenerate pools', () => {
  it('ranks nothing when there is nothing', () => {
    expect(rankFiles([], 'sum')).toEqual([]);
  });

  it('ranks one file with one declaration', () => {
    expect(rankFiles([entry('only.py', 0.5)], 'top3')).toEqual([
      { filePath: 'only.py', score: 0.5, contributors: 1 },
    ]);
  });

  it('treats a zero score as evidence of a match, which is what a rank in a fused list means', () => {
    // A node can be in the fused pool with a lexical score of zero - it was reached by the semantic half alone. Its
    // file is a candidate, and `count` counts it while `max` gives it nothing to be first with.
    const pool = [entry('semantic.py', 0), entry('lexical.py', 0)];
    expect(order(pool, 'max')).toEqual(['semantic.py', 'lexical.py']);
    expect(order(pool, 'count')).toEqual(['semantic.py', 'lexical.py']);
    expect(rankFiles(pool, 'count').map((file) => file.score)).toEqual([1, 1]);
  });
});
