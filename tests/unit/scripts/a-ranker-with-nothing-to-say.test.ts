// @code-analyzer/code-analyzer — what a comment budget buys when the ordering is the only thing that varies
//
// **The question this file guards is the one §116 asked and could not answer with the shipped score**: with the comment
// count held at what a competitor spends, does any ordering beat theirs. That makes the ordering the device, and a
// device needs three things a table cannot give it.
//
// **A fold that leaks.** The prior is a rate per category, and the cheapest way to get it wrong is to compute that rate
// over the whole corpus: every finding would then be ranked by a cell it contributed to, and a category with one row
// would rank that row first. The held-out fold is the only thing that makes the number out of sample, so it is asserted
// by changing the held-out pull request's labels and requiring the held-out scores to be unchanged.
//
// **A curve that is not the protocol's.** `curveAtBudget` must equal `f1FromCounts` and a maximum matching at the same
// count, or the curve is an arithmetic about comments that no artifact agrees with. The `k` at the pool's own length is
// the point where the curve has to fall back onto the uncut figure, and it is checked against it.
//
// **An oracle that is not a ceiling.** The oracle row exists to say what a perfect ranker would reach, so a row above it
// would be a contradiction rather than a device - and it is the one invariant that makes the oracle row worth reading.

import { describe, expect, it } from 'vitest';

import {
  curveAtBudget,
  leaveOnePullRequestOutPrior,
  matchedPairs,
  penaltyOf,
  rankCurves,
} from '../../../scripts/lib/ranker-replay.mjs';

import { f1FromCounts } from '../../../scripts/lib/operating-point.mjs';

/** One finding, with the fields the ordering reads and a default that makes a single change visible. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    pr: 'p1',
    path: 'src/a.cpp',
    category: 'bug',
    score: 0.5,
    matchedGoldens: [] as number[],
    features: { grounded: true, namesSymbol: true },
    ...overrides,
  };
}

/**
 * **The one point a one-budget curve holds**, and a throw rather than a `!`: a helper that returned `undefined` and let a
 * `.f1` read answer `undefined` would make the assertion below pass for the wrong reason.
 */
function at(curve: ReturnType<typeof curveAtBudget>, index = 0) {
  const point = curve[index];
  if (point === undefined) throw new Error(`no point at ${String(index)}`);
  return point;
}

/** An artifact in the shape `rankCurves` reads: the pool, and the corpus's golden count. */
function artifact(rows: ReturnType<typeof row>[], goldens: number) {
  return { rankedFindings: rows, missedGoldens: { total: goldens } };
}

describe('the penalty is a claim about the text, and it is a product', () => {
  it('costs nothing for a finding that is grounded and names a symbol', () => {
    expect(penaltyOf(row())).toBe(1);
  });

  it('multiplies rather than adds, so failing both is worse than failing either', () => {
    const groundedOnly = penaltyOf(row({ features: { grounded: false, namesSymbol: true } }));
    const symbolOnly = penaltyOf(row({ features: { grounded: true, namesSymbol: false } }));
    const both = penaltyOf(row({ features: { grounded: false, namesSymbol: false } }));
    expect(both).toBeCloseTo(groundedOnly * symbolOnly, 12);
    expect(both).toBeLessThan(Math.min(groundedOnly, symbolOnly));
  });

  it('reads an absent flag as passing, because the field is a refutation and not a score', () => {
    expect(penaltyOf({ features: {} })).toBe(1);
    expect(penaltyOf({})).toBe(1);
  });
});

describe('the prior is learned on the other pull requests and nowhere else', () => {
  it('gives a held-out pull request the same scores whatever its own labels say', () => {
    const base = [
      row({ pr: 'p1', matchedGoldens: [] }),
      row({ pr: 'p1', matchedGoldens: [] }),
      row({ pr: 'p2', matchedGoldens: [1] }),
      row({ pr: 'p2', matchedGoldens: [2] }),
    ];
    const relabelled = base.map((finding, at) => ({
      ...finding,
      matchedGoldens: at === 0 ? [7] : at === 1 ? [8] : [...finding.matchedGoldens],
    }));
    const before = leaveOnePullRequestOutPrior(base);
    const after = leaveOnePullRequestOutPrior(relabelled);
    // `p1` is the held-out fold in both runs, so its own labels cannot reach its own scores.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    // And the other fold is a different fold, so it is free to move - which is what makes this a fold and not a table.
    expect(after.slice(2)).not.toEqual(before.slice(2));
  });

  it('moves a pull request score when another pull request changes', () => {
    const two = [row({ pr: 'p1' }), row({ pr: 'p2', matchedGoldens: [1] })];
    const more = [
      row({ pr: 'p1' }),
      row({ pr: 'p2', matchedGoldens: [1] }),
      row({ pr: 'p2', matchedGoldens: [2] }),
      row({ pr: 'p2', matchedGoldens: [3] }),
    ];
    const before = leaveOnePullRequestOutPrior(two);
    const after = leaveOnePullRequestOutPrior(more);
    // `p1`'s rate is learned from `p2`, so more evidence in `p2` has to reach `p1`.
    expect(after[0]).not.toBe(before[0]);
  });
});

describe('the curve is the protocol at every count', () => {
  const rows = [
    row({ pr: 'p1', matchedGoldens: [1] }),
    row({ pr: 'p1', matchedGoldens: [1] }),
    row({ pr: 'p1', matchedGoldens: [] }),
    row({ pr: 'p2', matchedGoldens: [2, 3] }),
    row({ pr: 'p2', matchedGoldens: [] }),
  ];

  it('lands on the uncut figure when the budget covers the pool', () => {
    const goldens = 10;
    const point = at(curveAtBudget(rows, goldens, [rows.length]));
    const truePositives = matchedPairs(rows);
    expect(point.truePositives).toBe(truePositives);
    expect(point.f1).toBeCloseTo(f1FromCounts(truePositives, rows.length, goldens), 12);
  });

  it('credits one golden per finding, which is what a matching is', () => {
    const point = at(curveAtBudget(rows, 10, [rows.length]));
    // Two findings both carry golden 1, and one carries 2 and 3. **A matching pairs a finding with at most one
    // golden**, so the answer is two pairs - one from each pull request - and not the three distinct goldens the rows
    // name. The protocol's true positives are pairs, and a reading that counted goldens here would put precision above
    // one on the competitor's side.
    expect(point.truePositives).toBe(2);
  });

  it('never lets a budget exceed the pool, so a k above the pool is the pool', () => {
    const point = at(curveAtBudget(rows, 10, [rows.length + 50]));
    expect(point.emitted).toBe(rows.length);
  });
});

describe('no ordering beats the oracle at the same count', () => {
  it('holds on a pool where the orderings disagree', () => {
    const rows = [
      row({ pr: 'p1', category: 'test', score: 0.9, matchedGoldens: [] }),
      row({ pr: 'p1', category: 'bug', score: 0.1, matchedGoldens: [1] }),
      row({ pr: 'p2', category: 'test', score: 0.8, matchedGoldens: [] }),
      row({ pr: 'p2', category: 'documentation', score: 0.2, matchedGoldens: [2] }),
    ];
    const curves = rankCurves(artifact(rows, 10), [1, 2, 3, 4]).curves;
    for (const k of [1, 2, 3, 4]) {
      const oracle = curves.oracle.find((point) => point.k === k);
      for (const name of ['score', 'prior', 'priorTimesPenalty', 'fitted'] as const) {
        const point = curves[name].find((entry) => entry.k === k);
        expect(point, `${name} @ ${k}`).toBeDefined();
        expect(point!.f1, `${name} @ ${k}`).toBeLessThanOrEqual(oracle!.f1 + 1e-12);
      }
    }
  });

  it('does not mutate the artifact it is handed', () => {
    const rows = [row({ pr: 'p1', matchedGoldens: [1] }), row({ pr: 'p2', matchedGoldens: [] })];
    const subject = artifact(rows, 10);
    const before = JSON.stringify(subject);
    rankCurves(subject, [1, 2]);
    expect(JSON.stringify(subject)).toBe(before);
  });
});
