/**
 * **A verdict filed on the wrong finding leaves every total unchanged.**
 *
 * The corpus's arithmetic republishes three totals. §139 read them and found that step 2 - one call per file - recovers
 * 36 of the 141 same-line rejections the pairwise judge refused. The next question is *which* of the 307 comments to
 * keep, and that question cannot be answered from a total: it needs the second instrument's verdict on the finding it
 * was asked about, and until this iteration those verdicts were computed, summed, and discarded.
 *
 * A join like this fails silently and in the flattering direction. If a verdict lands one row off, the published totals
 * are identical - they are sums - and the only thing that moves is the score of a cut nobody ran, which is exactly the
 * figure a later iteration would quote. So the cases here are the four ways a row and a verdict can fail to be about the
 * same thing, and the assertion is on *which* rows carry *which* verdicts rather than on a sum:
 *
 * - the position, not the arrival order, decides: a pull request whose rows are not contiguous still joins correctly;
 * - a pull request the instrument could not answer keeps its pairwise verdict and gains no field;
 * - a position the plan never assigned keeps its pairwise verdict too;
 * - a row that carries no verdict carries no field, so a reader cannot mistake "not asked" for "covered nothing".
 */
import { describe, expect, it } from 'vitest';

import {
  fileLevelOnFindings,
  verdictsByPull,
} from '../../../.github/scripts/lib/file-level-placement.mjs';

const row = (path: string, matchedGoldens: number[]) => ({ path, matchedGoldens });

describe('a file-shaped verdict is filed on the finding it was asked about', () => {
  it('reads the position the row came from, not the order the rows were emitted in', () => {
    // Two pull requests whose rows interleave in the artifact, which is what a sort by score does to them.
    const rows = [row('a.ts', [0]), row('b.ts', [1]), row('a.ts', [2])];
    const keys = [
      { pr: 'pr-a', at: 1 },
      { pr: 'pr-b', at: 0 },
      { pr: 'pr-a', at: 0 },
    ];
    const matchesByPull = verdictsByPull({
      pulls: [{ pr: 'pr-a' }, { pr: 'pr-b' }],
      matches: [[[7, 8], []], [[9]]],
    });

    const filed = fileLevelOnFindings({ rows, keys, matchesByPull });

    expect(filed.map((entry) => entry.fileLevelGoldens)).toEqual([[], [9], [7, 8]]);
    // **And the pairwise verdict is still there beside it**, because the two readings are two instruments over one
    // emission and a row that carried only one of them could not be scored both ways.
    expect(filed.map((entry) => entry.matchedGoldens)).toEqual([[0], [1], [2]]);
  });

  it('leaves a pull request the instrument could not answer with the verdict it already had', () => {
    const rows = [row('a.ts', [0]), row('b.ts', [1])];
    const keys = [
      { pr: 'pr-a', at: 0 },
      { pr: 'pr-b', at: 0 },
    ];
    // The pass returns `undefined` for a pull request whose files it could not read, and the fallback is the pairwise
    // matrix - not an empty list, which would score the pull request as if nothing had been covered.
    const matchesByPull = verdictsByPull({
      pulls: [{ pr: 'pr-a' }, { pr: 'pr-b' }],
      matches: [[[3]], undefined],
    });

    const filed = fileLevelOnFindings({ rows, keys, matchesByPull });

    expect('fileLevelGoldens' in filed[0]!).toBe(true);
    expect('fileLevelGoldens' in filed[1]!).toBe(false);
    expect(filed[1]).toEqual(row('b.ts', [1]));
  });

  it('leaves a position the plan never assigned with the verdict it already had', () => {
    const rows = [row('a.ts', [0]), row('a.ts', [1])];
    const keys = [
      { pr: 'pr-a', at: 0 },
      { pr: 'pr-a', at: 5 },
    ];
    const matchesByPull = verdictsByPull({ pulls: [{ pr: 'pr-a' }], matches: [[[], []]] });

    const filed = fileLevelOnFindings({ rows, keys, matchesByPull });

    expect(filed[0]!.fileLevelGoldens).toEqual([]);
    expect('fileLevelGoldens' in filed[1]!).toBe(false);
  });

  it('refuses a shorter coordinate list rather than filing the tail of one list on the head of another', () => {
    expect(() =>
      fileLevelOnFindings({
        rows: [row('a.ts', []), row('b.ts', [])],
        keys: [{ pr: 'pr-a', at: 0 }],
        matchesByPull: new Map(),
      }),
    ).toThrow(/2 rows but 1 coordinates/u);
  });
});
