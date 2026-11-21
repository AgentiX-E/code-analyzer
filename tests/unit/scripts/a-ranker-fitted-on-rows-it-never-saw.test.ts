// @code-analyzer/code-analyzer — a fitted ordering, read on rows the fit never saw
//
// **The failure this file is written against is a fold that leaks.** A leave-one-pull-request-out score is only an
// out-of-sample score if the held-out pull request contributed nothing to the model - and the cheapest way to get this
// wrong is to standardise over the whole corpus, or to take the fold key from a field that two pull requests share. Both
// produce a number that looks like a measurement and is the fit's own opinion of itself.
//
// **The second failure is a replay that mutates the artifact.** `replay` replaces `score` on every finding, and a
// version that did it in place would make the second reading a reading of the first: the budget curve would then be
// taken over an ordering nothing wrote, and the difference between the two lines would be the order the code ran in.

import { describe, expect, it } from 'vitest';

import {
  FEATURE_NAMES,
  curveOf,
  featuresOf,
  labelOf,
  leaveOnePullRequestOut,
  replay,
  scoreCut,
} from '../../../scripts/lib/ranker-replay.mjs';

import type { RankerArtifact } from '../../../scripts/lib/ranker-replay.mjs';

/** A finding with the fields the fit reads, and defaults that make one field's effect visible. */
function row(overrides = {}) {
  return {
    pr: 'p1',
    path: 'src/a.cpp',
    startLine: 10,
    endLine: 10,
    category: 'bug',
    severity: 'high',
    lane: 'behaviour',
    text: 'the divisor can be zero',
    score: 0.5,
    matchedGoldens: [],
    features: {
      grounded: true,
      quotesDiff: true,
      namesSymbol: true,
      proposesChange: true,
      hedged: false,
      agreement: 2,
    },
    ...overrides,
  };
}

describe('the row a model reads', () => {
  it('writes one number per named feature, in the declared order', () => {
    // **Length and position together**, because a vector that is one column short fits, converges and reports a number
    // about a different feature set; and a `severity: high` that landed in the `isMedium` column would do the same.
    const vector = featuresOf(row());
    expect(vector).toHaveLength(FEATURE_NAMES.length);
    expect(vector[FEATURE_NAMES.indexOf('isHigh')]).toBe(1);
    expect(vector[FEATURE_NAMES.indexOf('isMedium')]).toBe(0);
    expect(vector[FEATURE_NAMES.indexOf('lane:testing')]).toBe(0);
    expect(vector[FEATURE_NAMES.indexOf('cat:bug')]).toBe(1);
  });

  it('reads a test path as a test path, whatever the separator', () => {
    // `pathClassOf` is the same rule the cut uses, so a feature built from a second opinion of it would make the model
    // learn a column the cut does not act on.
    for (const path of ['src/tests/a.cpp', 'test/a.cpp', 'a_test.go', 'Tests/A.cpp'])
      expect(featuresOf(row({ path }))[FEATURE_NAMES.indexOf('path:test')]).toBe(1);
    expect(
      featuresOf(row({ path: 'src/attestation.cpp' }))[FEATURE_NAMES.indexOf('path:test')],
    ).toBe(0);
  });

  it('calls a finding the judge accepted a positive, and nothing else', () => {
    expect(labelOf(row({ matchedGoldens: [0] }))).toBe(1);
    expect(labelOf(row({ matchedGoldens: [] }))).toBe(0);
    expect(labelOf(row({ matchedGoldens: undefined }))).toBe(0);
  });
});

describe('the fold boundary', () => {
  it('is the pull request, so a row cannot reach its own score through its label', () => {
    // **The same corpus twice, differing only in the labels of one pull request.** That pull request's scores must be
    // identical, because the model that produced them never saw it. A fold taken by index, by finding or by file would
    // let the flip through, and the check is the equality rather than the magnitude.
    const base = [
      row({ pr: 'p1', matchedGoldens: [0] }),
      row({ pr: 'p1', category: 'style', lane: 'maintainability' }),
      row({ pr: 'p2', matchedGoldens: [0] }),
      row({ pr: 'p2', category: 'test', lane: 'testing', path: 'src/tests/b.cpp' }),
      row({ pr: 'p3', category: 'architecture', lane: 'architecture' }),
      row({ pr: 'p3', severity: 'low', category: 'security', lane: 'security' }),
    ];
    const flipped = base.map((finding) =>
      finding.pr === 'p1' ? { ...finding, matchedGoldens: [] } : finding,
    );
    const held = (scores: readonly number[]) => scores.slice(0, 2);
    expect(held(leaveOnePullRequestOut(flipped))).toEqual(held(leaveOnePullRequestOut(base)));
  });

  it('gives every row a score, including a pull request the fold could not train without', () => {
    // **A corpus of one pull request cannot be read out of sample**, and the honest answer is a zero rather than a
    // skipped row: a `NaN` would propagate into the ranking and sort as neither high nor low.
    const scores = leaveOnePullRequestOut([row({ pr: 'only' }), row({ pr: 'only' })]);
    expect(scores).toHaveLength(2);
    for (const score of scores) expect(Number.isFinite(score)).toBe(true);
  });
});

describe('the replay', () => {
  const artifact = {
    missedGoldens: { total: 4 },
    emissionRules: {
      shipped: {
        steps: [
          { kind: 'drop', categories: ['test'] },
          { kind: 'drop-path-class', classes: ['test'] },
          { kind: 'budget', k: 1 },
        ],
      },
    },
    rankedFindings: [
      row({ pr: 'p1', startLine: 10, endLine: 10, score: 0.9, matchedGoldens: [0] }),
      row({ pr: 'p1', startLine: 20, endLine: 20, score: 0.1, matchedGoldens: [1] }),
      row({ pr: 'p2', startLine: 10, endLine: 10, score: 0.9, matchedGoldens: [] }),
      row({
        pr: 'p2',
        startLine: 20,
        endLine: 20,
        score: 0.2,
        category: 'test',
        path: 'src/tests/c.cpp',
      }),
    ],
  } as const satisfies RankerArtifact;

  it('scores the findings with the cut the artifact recorded', () => {
    // **The budget keeps the highest score in each pull request**, so p1 keeps the row that matched a golden and p2
    // keeps a row that did not: 1 emitted per pull request, 4 in total before the budget, 2 after.
    const point = scoreCut(artifact.rankedFindings, artifact.emissionRules.shipped.steps, 4);
    expect(point.emitted).toBe(2);
    expect(point.truePositives).toBe(1);
    expect(point.f1).toBeCloseTo((2 * 1) / (2 + 4), 10);
  });

  it('leaves the findings it was handed untouched', () => {
    // **The second reading has to be a reading of the artifact**, not of the first reading: a replay that wrote its own
    // scores back would make the curve below a curve about the fitted order.
    const before = JSON.stringify(artifact.rankedFindings);
    const result = replay(artifact);
    expect(JSON.stringify(artifact.rankedFindings)).toBe(before);
    expect(result?.shipped.f1).toBeCloseTo(
      scoreCut(artifact.rankedFindings, artifact.emissionRules.shipped.steps, 4).f1,
      10,
    );
  });

  it('prints the budget curve with the unbudgeted cut as its own row', () => {
    // **The last row is `null` rather than a large number**, because "no budget" is a different cut and a cap of a
    // thousand is a cap that a bigger pull request would reach.
    const curve = curveOf(artifact.rankedFindings, artifact.emissionRules.shipped.steps, 4, [
      1,
      Infinity,
    ]);
    expect(curve.map((point) => point.budget)).toEqual([1, null]);
    expect(curve[1]!.emitted).toBeGreaterThan(curve[0]!.emitted);
  });

  it('refuses an artifact with nothing to replay', () => {
    expect(replay({ rankedFindings: [] })).toBeNull();
  });
});
