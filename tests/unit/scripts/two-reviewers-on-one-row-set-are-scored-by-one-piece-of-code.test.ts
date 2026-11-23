/**
 * **Two reviewers on one row set have to be scored by one piece of code, or the comparison is a second score.**
 *
 * §140.5 printed a margin of `+10.19` against the competitor's tool. It was `31.44` on fifty pull requests minus
 * `21.25` on forty-seven: **two row sets and one instrument apart**, which is precisely the subtraction §121.2 refused
 * to draw and §121.3 turned into a gate for the figures in `benchmarks/`. The repair is not a better sentence about
 * that number - it is a scorer that cannot produce it, because it only scores rows both artifacts hold, with one
 * denominator and each side's own shipped cut.
 *
 * The cases here are the four ways such a scorer can lie:
 *
 * - **the row set**, where a pull request only one side holds must be excluded *and named*, since an invisible
 *   exclusion is an exclusion that can be tuned;
 * - **the matching**, where two comments that claim one reference comment are credited once, as the protocol says;
 * - **the denominator**, which belongs to the row set and not to whichever side is being scored;
 * - **the cut**, which is each side's own - a comparison of our full emission against their shipped cut measures two
 *   things at once and reports neither.
 */
import { describe, expect, it } from 'vitest';

import {
  likeForLike,
  scoreSide,
  sharedRows,
  atVolume,
} from '../../../scripts/lib/like-for-like.mjs';

const ours = (
  pr: string,
  path: string,
  goldens: number[],
  extra: Record<string, unknown> = {},
) => ({
  pr,
  path,
  matchedGoldens: goldens,
  actionable: true,
  score: 0.5,
  ...extra,
});

const theirs = (
  goldens: number,
  comments: { goldens: number[]; path: string; keep?: boolean }[],
) => ({
  goldens,
  matches: comments.map((comment) => comment.goldens),
  keep: comments.map((comment) => comment.keep !== false),
  detail: comments.map((comment) => ({ path: comment.path })),
});

describe('a comparison is one row set, one denominator, one scorer', () => {
  it('scores only the pull requests both artifacts hold, and names the ones it left out', () => {
    const shared = sharedRows([ours('p1', 'a.ts', [0]), ours('p9', 'a.ts', [0])], {
      pulls: { p1: theirs(1, [{ goldens: [0], path: 'a.ts' }]), p8: theirs(1, []) },
    });

    expect(shared.rows.map((row) => row.pr)).toEqual(['p1']);
    expect(shared.onlyThisRepository).toEqual(['p9']);
    expect(shared.onlyTheCompetitor).toEqual(['p8']);
  });

  it('credits two comments that claim one reference comment once, as the protocol does', () => {
    const side = scoreSide({
      findings: [ours('p1', 'a.ts', [3]), ours('p1', 'a.ts', [3]), ours('p1', 'b.ts', [7])],
      goldens: 20,
    });

    // Two comments, one reference comment, one more with a claimant of its own: a greedy walk would report three.
    expect(side.protocol.tp).toBe(2);
    expect(side.protocol.precision).toBeCloseTo(2 / 3, 12);
    expect(side.protocol.recall).toBeCloseTo(2 / 20, 12);
  });

  it('takes the recall denominator from the row set, so the same findings score the same on either side', () => {
    const findings = [ours('p1', 'a.ts', [0])];
    expect(scoreSide({ findings, goldens: 4 }).protocol.recall).toBeCloseTo(0.25, 12);
    expect(scoreSide({ findings, goldens: 8 }).protocol.recall).toBeCloseTo(0.125, 12);
  });

  it('scores each side at the cut that side shipped, not at the one that suits the comparison', () => {
    const comparison = likeForLike({
      ourFindings: [ours('p1', 'a.ts', [0]), ours('p1', 'a.ts', [1], { actionable: false })],
      competitorBaseline: {
        pulls: {
          p1: theirs(4, [
            { goldens: [1], path: 'a.ts' },
            { goldens: [2], path: 'a.ts', keep: false },
          ]),
        },
      },
    });

    // One comment each: ours is the actionable one, theirs is the kept one, and neither list is the full emission.
    expect(comparison.sides.ours.emitted).toBe(1);
    expect(comparison.sides.theirs.emitted).toBe(1);
    expect(comparison.sides.ours.protocol.tp).toBe(1);
    expect(comparison.sides.theirs.protocol.tp).toBe(1);
    expect(comparison.goldens).toBe(4);
  });

  it('refuses to compare artifacts that share no pull request, rather than printing two zeros', () => {
    expect(() =>
      likeForLike({ ourFindings: [ours('p1', 'a.ts', [0])], competitorBaseline: { pulls: {} } }),
    ).toThrow(/share no pull request/);
  });

  it('reaches a requested volume exactly, so a volume comparison is not also a rounding comparison', () => {
    const findings = Array.from({ length: 30 }, (_, at) =>
      ours(`p${at % 3}`, 'a.ts', at % 7 === 0 ? [at % 5] : [], { score: 1 - at / 100 }),
    );
    for (const total of [0, 1, 5, 29, 30]) {
      expect(atVolume({ findings, goldens: 40, total }).emitted).toBe(total);
    }
  });

  it('charges a comment that covers nothing to precision and not to recall', () => {
    const withMiss = scoreSide({
      findings: [ours('p1', 'a.ts', [0]), ours('p1', 'a.ts', [])],
      goldens: 4,
    });
    const without = scoreSide({ findings: [ours('p1', 'a.ts', [0])], goldens: 4 });

    expect(withMiss.corpus.recall).toBeCloseTo(without.corpus.recall, 12);
    expect(withMiss.corpus.precision).toBeLessThan(without.corpus.precision);
  });

  it('reports the file-shaped reading beside the comparison and never as part of it', () => {
    const filed = scoreSide({
      findings: [
        { ...ours('p1', 'a.ts', [0]), fileLevelGoldens: [0, 1] },
        ours('p1', 'a.ts', [2]),
      ],
      goldens: 4,
    });
    // The second instrument covered one more reference comment than the pairwise verdicts on the same finding did.
    expect(filed.corpus.coveredGoldens).toBe(2);
    expect(filed.filed?.coveredGoldens).toBe(3);

    const pairwiseOnly = scoreSide({ findings: [ours('p1', 'a.ts', [0])], goldens: 4 });
    expect(pairwiseOnly.filed).toBeNull();
  });
});
