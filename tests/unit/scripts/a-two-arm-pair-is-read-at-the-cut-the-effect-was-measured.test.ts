/**
 * **A two-arm comparison is read at one cut, and the cut is the one the effect was measured at.**
 *
 * The window control on 2026-11-15 produced a table computed at the published gate and a paired test computed over the
 * full emission, and the two disagreed by seventeen goldens in the `both` cell. **Both numbers were arithmetic over the
 * same artifacts** - the failure was that the test and the table were about different configurations, which is exactly
 * what §50.2 says a published figure must not be.
 *
 * So the pairing lives here, once, next to the cut it has to agree with, and the compare job imports it instead of
 * carrying its own copy. Three properties are asserted:
 *
 * - **the coverage set is the published point**, read from `coverage.byPullRequest[].covered`, not recomputed from the
 *   full emission;
 * - **an artifact with no `coverage` block is refused**, because an empty set pairs as `both: 0, p: 1` - a number that
 *   reads like independence and is really a missing field;
 * - **the delta is `on − off`**, so a negative device prints negative and a reader never has to know which arm came
 *   first in the command line.
 */
import { describe, expect, it } from 'vitest';

import { coverageSet, cutComparison, pairArms } from '../../../scripts/lib/arm-pair.mjs';

/** An artifact is a configuration, a published point, its coverage rows, and the verdicts behind them. */
function artifact(overrides: Record<string, unknown> = {}) {
  return {
    configuration: { codeContext: false, agent: false },
    truePositives: 2,
    falsePositives: 3,
    falseNegatives: 4,
    coverage: {
      byPullRequest: [
        { pr: 'o/r#1', covered: [0, 2] },
        { pr: 'o/r#2', covered: [1] },
      ],
    },
    rankedFindings: [],
    ...overrides,
  };
}

describe('the coverage set is the published point', () => {
  it('keys one entry per pull request and golden', () => {
    expect([...coverageSet(artifact())].sort()).toEqual(['o/r#1#0', 'o/r#1#2', 'o/r#2#1']);
  });

  it('refuses an artifact with no coverage block rather than pairing an empty set', () => {
    expect(() => coverageSet({ truePositives: 2, falseNegatives: 4 })).toThrow(/coverage/u);
  });

  it('accepts an artifact whose coverage block is present but empty, and says zero rather than throwing', () => {
    expect([...coverageSet(artifact({ coverage: { byPullRequest: [] } }))]).toEqual([]);
  });
});

describe('the pairing reports what the two arms did together, per pull request', () => {
  const off = artifact();
  const on = artifact({
    configuration: { codeContext: false, agent: true },
    coverage: {
      byPullRequest: [
        { pr: 'o/r#1', covered: [0] },
        { pr: 'o/r#2', covered: [1, 3] },
      ],
    },
  });

  it('counts the overlap and both differences', () => {
    const paired = pairArms(off, on);
    expect(paired.both).toBe(2);
    expect(paired.offOnly).toBe(1);
    expect(paired.onOnly).toBe(1);
  });

  it('names the arms in the terms the artifacts differ in, not in command-line order', () => {
    const paired = pairArms(off, on);
    expect(paired.off.covered).toBe(3);
    expect(paired.on.covered).toBe(3);
    expect(paired.varied).toEqual(['agent']);
  });
});

describe('the cut comparison is one table over both arms', () => {
  const finding = (pr: string, category: string, matchedGoldens: number[]) => ({
    pr,
    filePath: 'a.ts',
    startLine: 1,
    endLine: 1,
    category,
    matchedGoldens,
  });
  const off = artifact({
    rankedFindings: [finding('o/r#1', 'bug', [0]), finding('o/r#2', 'test', [1])],
  });
  const on = artifact({
    configuration: { codeContext: false, agent: true },
    rankedFindings: [finding('o/r#1', 'bug', [0]), finding('o/r#2', 'bug', [1])],
  });

  it('prints the delta as on minus off, at every registered cut', () => {
    const rows = cutComparison(off, on);
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      expect(row.delta).toBeCloseTo(row.on.f1 - row.off.f1, 12);
    }
  });

  it('keeps the denominator the corpus, so both arms divide by the same number', () => {
    const rows = cutComparison(off, on);
    for (const row of rows) {
      expect(row.off.truePositives + row.off.falseNegatives).toBe(6);
      expect(row.on.truePositives + row.on.falseNegatives).toBe(6);
    }
  });

  it('changes the delta when the cut removes the category one arm over-emits', () => {
    const rows = cutComparison(off, on);
    const noRule = rows.find((row) => row.cut === 'no rule');
    const dropped = rows.find((row) => row.cut === 'drop test');
    // **At no cut the two arms are identical**, which is what makes the next line a statement about the cut: the off arm
    // carries a `test` finding the on arm does not, and removing that category leaves the two arms with different
    // emissions - so a device priced at one cut is not a device priced at another.
    expect(noRule?.delta).toBeCloseTo(0, 12);
    expect(dropped?.delta).not.toBeCloseTo(noRule?.delta ?? 0, 12);
    expect(dropped?.off.emitted).toBe(1);
    expect(dropped?.on.emitted).toBe(2);
  });
});
