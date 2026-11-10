// A head-to-head needs a counterpart, and the artifact must say so when it has none.
//
// **The bill this file was written against.** Run
// [42789979455](https://github.com/AgentiX-E/code-analyzer/actions/runs/42789979455) - fifty pull requests, both checklist
// arms, competitor replayed - published:
//
//     mcnemar: { oursOnly: 83, theirsOnly: 0, pValue: 0, verdict: 'significant at 0.05' }
//
// and in the same log:
//
//     AACR-BENCH competitor open-code-review · replay · replayed 0 · recorded 0 · missing 50 · findings 0
//
// **Eighty-three to nothing, against an arm that produced nothing.** The strongest result the project has ever printed
// was the one where the competitor had no data, and it was printed because the run held two representations of one
// comparison: `secondReviewer.comparable`, which knew, and a bare `mcnemar`, which did not. **The flattering copy is the
// one a reader quotes**, so the two are now one object and these tests hold every answer it can give.

import { describe, expect, it } from 'vitest';

import type {
  CompetitorComparison,
  WithheldComparison,
} from '../../../.github/scripts/lib/competitor-comparison.mjs';
import {
  WITHHELD,
  compareAgainstCompetitor,
  describeComparison,
} from '../../../.github/scripts/lib/competitor-comparison.mjs';

/** Narrow to the withheld arm, failing loudly rather than casting. */
function withheld(comparison: CompetitorComparison): WithheldComparison {
  if (comparison.comparable) throw new Error('expected the comparison to withhold');
  return comparison;
}

describe('a comparison states a verdict only when both arms were scored over the corpus', () => {
  it('states one when every pull request has a competitor row', () => {
    const comparison = compareAgainstCompetitor({
      oursOnly: 40,
      theirsOnly: 4,
      coverage: { requested: 50, covered: 50, missing: 0 },
    });
    expect(comparison.comparable).toBe(true);
    expect(comparison.verdict).toBe('significant at 0.05');
    expect(comparison.pValue).toBeLessThan(0.05);
    expect(comparison.coverage.share).toBe(1);
  });

  it('reports a difference that is not significant as not significant, because both answers are results', () => {
    const comparison = compareAgainstCompetitor({
      oursOnly: 3,
      theirsOnly: 1,
      coverage: { requested: 50, covered: 50, missing: 0 },
    });
    expect(comparison.comparable).toBe(true);
    expect(comparison.verdict).toBe('not significant at 0.05');
  });

  it('withholds when any pull request has no competitor row, and says how many', () => {
    const comparison = withheld(
      compareAgainstCompetitor({
        oursOnly: 83,
        theirsOnly: 0,
        coverage: { requested: 50, covered: 14, missing: 36 },
      }),
    );
    expect(comparison.verdict).toBe(WITHHELD);
    expect(comparison.withheldReason).toContain('36 of 50');
    // The sentence has to say *why* it matters, not only that it happened: a denominator is what makes two figures
    // the same measurement.
    expect(comparison.withheldReason).toContain('smaller corpus');
  });

  it('withholds when the competitor produced no row at all, which is the run this file was written for', () => {
    const comparison = withheld(
      compareAgainstCompetitor({
        oursOnly: 83,
        theirsOnly: 0,
        coverage: { requested: 50, covered: 0, missing: 50 },
      }),
    );
    expect(comparison.withheldReason).toContain('produced no row at all');
    expect(comparison.withheldReason).toContain('comparison against nothing');
    expect(comparison.coverage.covered).toBe(0);
  });

  it('withholds when the run scored nothing, because an empty corpus is not a tie', () => {
    const comparison = withheld(
      compareAgainstCompetitor({ oursOnly: 0, theirsOnly: 0, coverage: { requested: 0 } }),
    );
    expect(comparison.withheldReason).toContain('scored no pull requests');
    expect(comparison.coverage.share).toBe(0);
  });

  it('removes the zero rather than publishing it, because a guaranteed zero reads as a shutout', () => {
    const comparison = withheld(
      compareAgainstCompetitor({
        oursOnly: 83,
        theirsOnly: 0,
        coverage: { requested: 50, covered: 0, missing: 50 },
      }),
    );
    // **`null`, not `0`.** `theirsOnly` is zero by construction here - the competitor had no rows, so it found nothing -
    // and a reader skimming a column of numbers cannot tell a shutout from an absence.
    expect(comparison.theirsOnly).toBeNull();
    expect(comparison.pValue).toBeNull();
  });

  it('keeps our own count, because it is a fact about our arm and not a claim about theirs', () => {
    const comparison = withheld(
      compareAgainstCompetitor({
        oursOnly: 83,
        theirsOnly: 0,
        coverage: { requested: 50, covered: 0, missing: 50 },
      }),
    );
    expect(comparison.oursOnly).toBe(83);
  });
});

describe('the coverage it publishes is the coverage it was given', () => {
  it('computes the share from the two counts rather than trusting a third', () => {
    const comparison = compareAgainstCompetitor({
      oursOnly: 0,
      theirsOnly: 0,
      coverage: { requested: 40, covered: 10, missing: 30 },
    });
    expect(comparison.coverage).toEqual({ requested: 40, covered: 10, missing: 30, share: 0.25 });
  });

  it('treats a missing count it was not given as the difference, never as zero', () => {
    // A caller that states requested and covered but not missing is a caller that would otherwise **slip past the
    // gate**, because `missing` defaulting to `0` is the one value that admits every comparison.
    const comparison = compareAgainstCompetitor({
      oursOnly: 5,
      theirsOnly: 0,
      coverage: { requested: 10, covered: 4 },
    });
    expect(comparison.comparable).toBe(false);
    expect(comparison.coverage.missing).toBe(6);
  });

  it('clamps nonsense to zero rather than publishing a negative denominator', () => {
    const comparison = compareAgainstCompetitor({
      oursOnly: -3,
      theirsOnly: -1,
      coverage: { requested: -5, covered: -2, missing: -1 },
    });
    expect(comparison.coverage).toEqual({ requested: 0, covered: 0, missing: 0, share: 0 });
    expect(comparison.oursOnly).toBe(0);
  });
});

describe('the log line and the artifact read the same object', () => {
  it('names the withholding and the count behind it', () => {
    const line = describeComparison(
      compareAgainstCompetitor({
        oursOnly: 83,
        theirsOnly: 0,
        coverage: { requested: 50, covered: 0, missing: 50 },
      }),
    );
    expect(line).toContain('withheld');
    expect(line).toContain('50 of 50');
    expect(line).toContain('coverage 0/50');
    // **And it does not print the numbers that made the old line look like a result.**
    expect(line).not.toContain('ours-only');
    expect(line).not.toContain('theirs-only');
  });

  it('prints the counts and the p-value when there is a comparison to print', () => {
    const line = describeComparison(
      compareAgainstCompetitor({
        oursOnly: 40,
        theirsOnly: 4,
        coverage: { requested: 50, covered: 50, missing: 0 },
      }),
    );
    expect(line).toContain('ours-only 40');
    expect(line).toContain('theirs-only 4');
    expect(line).toContain('significant at 0.05');
    expect(line).toContain('coverage 50/50');
  });
});
