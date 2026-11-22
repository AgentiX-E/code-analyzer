/**
 * **The second arithmetic has to agree with the scorer it calls, and the cut has to move what it claims to move.**
 *
 * §85 retired every pre-judge gate in this tree on an argument that holds for the pairwise instrument: a finding that
 * stands where no reference comment stands is never asked about, so removing it changes no counter. **Under the
 * corpus's arithmetic every comment is charged** - 216 of §139's 307 covered nothing - so the same removal is a gain
 * unless the comment it removes was one of the few that bought something.
 *
 * That makes `scoreFileCut` load-bearing: a table of cuts under this arithmetic is the only evidence a future gate has,
 * and the failure mode is a scorer that quietly agrees with itself. So the cases here are:
 *
 * - **equivalence**, on data where every verdict is within its own file (which is every verdict the file-level judge
 *   can produce): the cut scorer must return exactly what `scoreFileSemantic` returns, because it calls it;
 * - **the marginal rule**, worked by hand on five comments: a comment that covers nothing lowers F1, a comment that
 *   covers a new reference comment raises it, and a duplicate is charged to precision and not to recall;
 * - **the denominator**, which must be the corpus and not the cut, or every cut would report its own recall.
 */
import { describe, expect, it } from 'vitest';

import { scoreFileSemantic } from '../../../.github/scripts/lib/file-semantic.mjs';
import { scoreFileCut } from '../../../scripts/lib/file-cut.mjs';

const finding = (pr: string, path: string, goldens: number[]) => ({
  pr,
  path,
  fileLevelGoldens: goldens,
});

describe('a cut is scored the way the corpus scores it', () => {
  it('agrees with the scorer it calls when every verdict is within its own file', () => {
    const findings = [
      finding('p1', 'a.ts', [0, 1]),
      finding('p1', 'a.ts', [1]),
      finding('p1', 'b.ts', []),
      finding('p1', 'b.ts', [2]),
      finding('p2', 'a.ts', [0]),
    ];
    // The reference comments of each pull request, in that pull request's own coordinates - which is the shape the
    // scorer expects and the shape the artifact does not carry, because it stores the count and not the coordinates.
    const goldensByPull = {
      p1: [{ path: 'a.ts' }, { path: 'a.ts' }, { path: 'b.ts' }],
      p2: [{ path: 'a.ts' }],
    };

    const direct = Object.entries(goldensByPull).reduce(
      (total, [pr, goldens]) =>
        total +
        scoreFileSemantic({
          findings: findings.filter((entry) => entry.pr === pr),
          goldens,
          matches: findings
            .filter((entry) => entry.pr === pr)
            .map((entry) => entry.fileLevelGoldens),
        }).hitNewGt,
      0,
    );

    const cut = scoreFileCut({
      findings,
      goldens: 4,
      matchesOf: (entry) => entry.fileLevelGoldens ?? [],
    });

    expect(cut.hitNewGt).toBe(direct);
    // p1: (0,1) buys both, the next buys nothing new, the third buys nothing, the fourth buys 2 → 2 of 4.
    // p2: [0] buys p2's golden 0 → 1 of 1.
    expect(cut.hitNewGt).toBe(3);
    // Four reference comments covered, not three: coverage is a set per pull request, so p1's {0, 1, 2} and p2's {0}
    // are four distinct coordinates once the two pulls are counted apart - p2's golden 0 is not p1's.
    expect(cut.coveredGoldens).toBe(4);
    expect(cut.duplicateHits).toBe(1);
  });

  it('charges a comment that covers nothing against precision and a duplicate against nothing else', () => {
    // One pull request, four comments, two reference comments: a new hit, a duplicate, and two misses.
    const cut = scoreFileCut({
      findings: [
        finding('p', 'a.ts', [0]),
        finding('p', 'a.ts', [0]),
        finding('p', 'a.ts', []),
        finding('p', 'b.ts', []),
      ],
      goldens: 4,
      matchesOf: (entry) => entry.fileLevelGoldens ?? [],
    });

    expect(cut.hitNewGt).toBe(1);
    expect(cut.duplicateHits).toBe(1);
    expect(cut.coveredGoldens).toBe(1);
    // P = 1/4, R = 1/4, and F1 is the harmonic mean of the two rather than a count over a sum: the two halves of this
    // arithmetic move on different denominators, which is why a removal has no closed-form break-even here.
    expect(cut.precision).toBeCloseTo(0.25, 10);
    expect(cut.recall).toBeCloseTo(0.25, 10);
    expect(cut.f1).toBeCloseTo(0.25, 10);
  });

  it('reads recall against the corpus, so a cut cannot raise it by dropping findings', () => {
    const kept = [finding('p', 'a.ts', [0])];
    const all = [finding('p', 'a.ts', [0]), finding('p', 'a.ts', []), finding('p', 'a.ts', [])];

    const small = scoreFileCut({
      findings: kept,
      goldens: 4,
      matchesOf: (entry) => entry.fileLevelGoldens ?? [],
    });
    const large = scoreFileCut({
      findings: all,
      goldens: 4,
      matchesOf: (entry) => entry.fileLevelGoldens ?? [],
    });

    // Same recall - the corpus is four reference comments either way - and a precision three times higher.
    expect(small.recall).toBeCloseTo(large.recall, 10);
    expect(small.precision).toBeCloseTo(1, 10);
    expect(large.precision).toBeCloseTo(1 / 3, 10);
    // **And the cut is worth 0.1143 F1 more** - 0.4000 against 0.2857 - which is what a gate has to beat at this point,
    // and the number is smaller than the precision difference because recall did not move.
    expect(small.f1 - large.f1).toBeCloseTo(0.4 - 0.2857142857142857, 10);
  });

  it('treats a pull request with no golden as a pull request rather than as a zero', () => {
    const cut = scoreFileCut({
      findings: [finding('p', 'a.ts', [])],
      goldens: 0,
      matchesOf: (entry) => entry.fileLevelGoldens ?? [],
    });

    expect(cut.emitted).toBe(1);
    expect(cut.hitNewGt).toBe(0);
    expect(cut.recall).toBe(0);
    expect(cut.precision).toBe(0);
    expect(cut.f1).toBe(0);
  });
});
