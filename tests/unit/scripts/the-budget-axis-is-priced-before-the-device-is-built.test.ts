/**
 * **The budget axis is priced before a dispatch is spent on a device to improve it.**
 *
 * The campaign's next candidate device answers "how many problems does this pull request contain", and its whole case
 * rests on there being room between what a flat budget achieves and what the best possible per-pull-request budget could
 * achieve. **That room is measurable on artifacts already paid for, in one afternoon, with no model** - and it was
 * measured before the device was built rather than after it failed.
 *
 * Two properties are asserted here because both have already gone wrong once in this repository:
 *
 * - **`fixed 13` must equal `drop:test + budget 13` from the operating-point table**, because two implementations of one
 *   cut that disagree by a rounding are two tables about one run (§51);
 * - **the oracle must be a bound and must say so** - it reads the answers, so it is never printed as a rule and never
 *   compared to a device as if a device could reach it.
 */
import { describe, expect, it } from 'vitest';

import {
  BUDGET_RULES,
  DROP_TEST,
  bestScoreThreshold,
  budgetRuleTable,
  goldensByPullRequest,
  oracleGreedy,
} from '../../../scripts/lib/budget-rules.mjs';
import { applyCut, score } from '../../../scripts/lib/operating-point.mjs';

const creditOf = (finding: { matchedGoldens?: readonly number[] }) => finding.matchedGoldens ?? [];

/**
 * **Two pull requests, one of which is over-emitting**: `o/r#1` holds two goldens and has three findings that claim
 * them plus one that claims nothing; `o/r#2` holds one golden and has one finding that claims it.
 */
function artifact() {
  const finding = (pr: string, score: number, matchedGoldens: number[], category = 'bug') => ({
    pr,
    filePath: 'a.ts',
    startLine: 1,
    endLine: 1,
    category,
    score,
    matchedGoldens,
  });
  return {
    configuration: { codeContext: false },
    truePositives: 2,
    falsePositives: 2,
    falseNegatives: 1,
    coverage: {
      byPullRequest: [
        { pr: 'o/r#1', covered: [0, 1] },
        { pr: 'o/r#2', covered: [0] },
      ],
    },
    rankedFindings: [
      finding('o/r#1', 0.9, [0]),
      finding('o/r#1', 0.8, [1]),
      finding('o/r#1', 0.7, []),
      finding('o/r#2', 0.95, [0]),
      finding('o/r#1', 0.6, [], 'test'),
    ],
  };
}

describe('the rules are read against the same denominator', () => {
  it('counts the goldens each pull request held', () => {
    const counts = goldensByPullRequest(artifact());
    expect(counts.get('o/r#1')).toBe(2);
    expect(counts.get('o/r#2')).toBe(1);
  });

  it('refuses an artifact with no coverage rows rather than pricing a rule on nothing', () => {
    expect(() => goldensByPullRequest({ rankedFindings: [] })).toThrow(/coverage/u);
  });
});

describe('the flat budget here is the flat budget there', () => {
  it('agrees with `drop:test + budget 13` from the operating-point table', () => {
    const data = artifact();
    const table = budgetRuleTable(data);
    const flat = table.rows.find((row) => row.rule === 'fixed 13');
    const byOperatingPoint = score(
      applyCut(data.rankedFindings, [...DROP_TEST, { kind: 'budget', k: 13 }]),
      creditOf,
      // **The fixture's own corpus**: `truePositives + falseNegatives`, which is what the table divides by. Passing a
      // different number here is how a test can agree with an implementation about the emission and disagree about the
      // recall - which is exactly the failure the assertion is for.
      data.truePositives + data.falseNegatives,
    );
    expect(flat?.truePositives).toBe(byOperatingPoint.truePositives);
    expect(flat?.emitted).toBe(byOperatingPoint.emitted);
    expect(flat?.f1).toBeCloseTo(byOperatingPoint.f1, 12);
  });

  it('drops the `test` finding before any rule sees the list', () => {
    const rows = budgetRuleTable(artifact()).rows;
    for (const row of rows) {
      expect(row.emitted).toBeLessThanOrEqual(4);
    }
  });
});

describe('every rule in the table is a rule, and the bound is named as a bound', () => {
  const table = budgetRuleTable(artifact());

  it('prints one row per rule plus the oracle', () => {
    expect(table.rows).toHaveLength(Object.keys(BUDGET_RULES).length + 1);
    expect(table.rows.at(-1)?.rule).toMatch(/^oracle/u);
  });

  it('never lets the oracle fall below the flat budget, because it can always choose thirteen', () => {
    const flat = table.rows.find((row) => row.rule === 'fixed 13');
    const bound = table.rows.at(-1);
    expect(bound?.f1).toBeGreaterThanOrEqual((flat?.f1 ?? 0) - 1e-12);
  });

  it('reports the median budget the oracle chose, so a reader can see how small it is', () => {
    expect(oracleGreedy(artifact()).medianBudget).toBeGreaterThan(0);
  });
});

describe('the score threshold is the same axis written the other way round', () => {
  it('returns the best threshold it was given, with the point that goes with it', () => {
    const best = bestScoreThreshold(artifact(), [0, 0.65, 0.85, 0.99]);
    expect(best?.threshold).toBeGreaterThanOrEqual(0);
    expect(best?.f1 ?? 0).toBeGreaterThan(0);
  });
});
