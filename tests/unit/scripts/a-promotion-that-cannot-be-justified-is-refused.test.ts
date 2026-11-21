// @code-analyzer/code-analyzer — a promotion that cannot be justified is refused, by name
//
// **The mechanism this file guards is the one thing that was missing for three iterations** (see
// `the-configuration-the-product-ships-is-the-one-a-promotion-wrote.test.ts` for the chain it feeds). A promoter that
// returns `promote` too easily is worse than no promoter at all: it would rewrite the shipped reviewer on every
// dispatch, and the record would say "measured" about a noise draw.
//
// **So every refusal is a named condition with its own arm in this file.** Ten conditions, ten arms, and the two
// positive paths - a challenger that clears all of them, and a set whose best arm is the baseline. **A refactor that
// silently merges two reasons would leave one arm asserting a reason the code no longer produces**, which is why each
// assertion reads the reason string rather than only the outcome.

import { describe, expect, it } from 'vitest';

import {
  coverageOf,
  defaultsWith,
  knobsOf,
  metricAt,
  promote,
  selfTest,
} from '../../../.github/scripts/aacr-promote.mjs';

const KNOBS = {
  maxFindingsPerPullRequest: 12,
  sameSiteConcerns: 1,
  secondConcern: false,
  codeContext: false,
  adjudicate: false,
  remarks: false,
  languageChecklist: false,
};

const RULE = {
  version: 1,
  metric: 'pullRequestArm.f1',
  primary: 'f1',
  minimumDelta: 0.0281,
  guards: { precision: 0.2, recall: 0.15 },
  minimumSample: { pullRequests: 30, goldens: 300 },
  requirePaired: true,
  requireApplied: true,
  tieBreak: ['f1', 'precision', 'cost'],
};

type Options = {
  f1?: number;
  precision?: number;
  recall?: number;
  skip?: number;
  unapplied?: boolean;
  covered?: number[];
  goldensPerPull?: number;
  pullRequests?: number;
  omit?: string;
  cost?: number;
};

/**
 * One arm artifact, shaped like `aacr-bench.json`, with one thing wrong when a test wants something wrong.
 *
 * `unapplied` writes a `configuration.pullRequestArmBudget` the pull-request arm's own `budgetPerPullRequest` does not
 * agree with - which is **the R-67 shape**: a number that travelled to the artifact and not to the arm.
 */
function arm(label: string, overrides: Record<string, unknown>, options: Options = {}) {
  const {
    f1 = 0.2,
    precision = 0.5,
    recall = 0.5,
    skip = 0,
    unapplied = false,
    covered = [0, 1, 2, 3],
    goldensPerPull = 200,
    pullRequests = 2,
    omit,
    cost = 10,
  } = options;
  const configuration: Record<string, unknown> = {
    languageChecklist: false,
    codeContext: false,
    adjudicate: false,
    remarks: { enabled: false },
    secondConcern: false,
    sameSiteConcerns: 1,
    pullRequestArmBudget: 12,
    ...overrides,
  };
  if (omit !== undefined) delete configuration[omit];

  return {
    label,
    artifact: {
      configuration,
      pullRequestArm: {
        f1,
        precision,
        recall,
        budgetPerPullRequest: unapplied ? 12 : (configuration['pullRequestArmBudget'] ?? 12),
        perPullRequest: Array.from({ length: pullRequests }, (_, at) => ({
          pr: `p#${String(at)}`,
          goldens: goldensPerPull,
          covered: at === 0 ? covered.length : 0,
          coveredGoldens: at === 0 ? covered : [],
        })),
      },
      // **Sample size is read from the artifact rather than passed to the promoter**, so an arm cannot claim forty pull
      // requests and carry two.
      prsReviewed: pullRequests * 20,
      corpusSlice: { skip, requested: 40 },
      datasetRows: 200,
      spend: { totalCacheNeutralUsd: cost },
      provenance: { runId: '1234', sha: 'abc123' },
    },
  };
}

const baseline = () => arm('baseline', {});

describe('the promotion', () => {
  it('promotes a challenger that clears every condition, and moves the whole combination at once', () => {
    // **Eight gained, one lost** is the smallest discordance an exact McNemar tail will call significant at 0.05 on
    // this corpus, so this arm is the boundary of "a result" rather than an impressive one - which is the point.
    const decision = promote({
      arms: [
        baseline(),
        arm(
          'winner',
          { codeContext: true, remarks: { enabled: true } },
          {
            f1: 0.26,
            covered: [10, 11, 12, 13, 14, 15, 16, 17, 1, 2, 3],
          },
        ),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(decision.outcome).toBe('promote');
    // **Two knobs, one decision.** A promotion that moved one of them would be a combination measured jointly and
    // delivered halved, which is the experimental design undone at the last step.
    expect(decision.champion!.knobs).toEqual({ ...KNOBS, codeContext: true, remarks: true });
    expect(decision.paired!.oursOnly).toBe(8);
    expect(decision.paired!.theirsOnly).toBe(1);
    expect(decision.paired!.pValue).toBeLessThan(0.05);
    expect(decision.delta).toBeCloseTo(0.06, 10);
  });

  it('refuses when no arm in the set ran the configuration that ships', () => {
    // **The comparison has to be against a measured baseline, not a remembered one.** Without a baseline arm the only
    // alternative is a stored figure, and a stored figure drifts with the corpus, the judge and the harness.
    const held = promote({
      arms: [arm('challenger', { codeContext: true }, { f1: 0.3, covered: [10, 11, 12] })],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.outcome).toBe('hold');
    expect(held.reason).toBe('no-baseline');
  });

  it('refuses a challenger whose knob was recorded and never applied', () => {
    // **R-67, exactly.** The artifact said 20, the arm ran 12, and the headline was what the engine emits with nothing
    // cut. §128 is the readback; this is the refusal that would have prevented the dispatch from being counted.
    const held = promote({
      arms: [
        baseline(),
        arm(
          'recorded-not-applied',
          { pullRequestArmBudget: 20 },
          { f1: 0.3, unapplied: true, covered: [10, 11, 12] },
        ),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.outcome).toBe('hold');
    expect(held.rejections.map((entry) => entry.reason)).toContain('not-applied');
    expect(held.rejections.find((entry) => entry.reason === 'not-applied')!.detail).toContain(
      'maxFindingsPerPullRequest',
    );
  });

  it('refuses an arm that does not say which reviewer produced its figure', () => {
    const held = promote({
      arms: [baseline(), arm('silent', {}, { f1: 0.3, covered: [10, 11, 12], omit: 'adjudicate' })],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.rejections.map((entry) => entry.reason)).toContain('not-recorded');
  });

  it('refuses a challenger measured on a different slice of the corpus', () => {
    // **A difference of rows is not a difference of devices.** The slice is recorded in the artifact precisely so this
    // refusal is arithmetic rather than an honour system.
    const held = promote({
      arms: [
        baseline(),
        arm('elsewhere', { codeContext: true }, { f1: 0.4, skip: 50, covered: [10, 11, 12] }),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.rejections.map((entry) => entry.reason)).toContain('unpaired-corpus');
  });

  it('refuses a sample below the registered minimum, because a proportion on thirty goldens is a coin', () => {
    const held = promote({
      arms: [
        arm('baseline', {}, { pullRequests: 1, goldensPerPull: 50 }),
        arm(
          'tiny',
          { codeContext: true },
          { pullRequests: 1, goldensPerPull: 50, f1: 0.4, covered: [10, 11, 12] },
        ),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.reason).toBe('no-comparable-arm');
    expect(held.rejections.map((entry) => entry.reason)).toContain('incomplete-sample');
  });

  it('refuses an artifact that carries a count of matched goldens but not the goldens', () => {
    // **A count cannot be paired.** Two arms that each matched ninety may have matched ninety different ones, and a
    // comparison between two marginals is the statistic the exact test exists to replace.
    const withoutSets = arm('no-sets', { codeContext: true }, { f1: 0.3 });
    for (const row of (
      withoutSets.artifact.pullRequestArm as { perPullRequest: Record<string, unknown>[] }
    ).perPullRequest) {
      delete row['coveredGoldens'];
    }

    const held = promote({
      arms: [baseline(), withoutSets],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.rejections.map((entry) => entry.reason)).toContain('unpaired-coverage');
    expect(coverageOf(withoutSets.artifact)).toBeNull();
  });

  it('refuses to promote the baseline, because a run that measured nothing is a result and not a change', () => {
    const held = promote({ arms: [baseline()], defaults: { knobs: KNOBS }, rule: RULE });

    expect(held.outcome).toBe('hold');
    expect(held.reason).toBe('no-challenger');
  });

  it('refuses a challenger that is worse, and one that is better by less than the instrument can see', () => {
    // **A worse challenger is refused by `no-challenger`, and that is not a missing reason.** The baseline is one of the
    // arms, so a challenger behind it is never the best arm, and the resolution band is centred on the best arm - so a
    // `delta <= 0` branch would be a branch no arm can reach. `aacr-promote.mjs` says so where the branch would be.
    const worse = promote({
      arms: [
        baseline(),
        arm('worse', { codeContext: true }, { f1: 0.18, covered: [0, 1, 2, 3, 9] }),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });
    expect(worse.reason).toBe('no-challenger');

    // **+0.01 is inside the 0.0281 resolution**: R-64 and R-67 returned +0.0108 and +0.0105 on same-class arms, and a
    // mechanism that promoted those would be a mechanism that buys noise at the price of a product change.
    const inside = promote({
      arms: [
        baseline(),
        arm('inside', { codeContext: true }, { f1: 0.21, covered: [0, 1, 2, 3, 9] }),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });
    expect(inside.reason).toBe('below-resolution');
  });

  it('refuses a real gain that the goldens do not support, and says by how much it fell short', () => {
    // **+0.06 on three gained and two lost** is a large difference on seven discordant pairs: the exact tail is 1.0,
    // so the honest read is "cannot say" rather than "better". This is the refusal that keeps a lucky draw out of the
    // product, and it is the one an F1-only promoter would never make.
    const held = promote({
      arms: [
        baseline(),
        arm('lucky', { codeContext: true }, { f1: 0.26, covered: [0, 1, 2, 3, 70, 71, 72] }),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.outcome).toBe('hold');
    expect(held.reason).toBe('not-significant');
    expect(held.paired!.pValue).toBeGreaterThan(0.05);
  });

  it('refuses a challenger that buys F1 by walking down the precision curve past the floor', () => {
    const held = promote({
      arms: [
        baseline(),
        arm(
          'flood',
          { codeContext: true },
          {
            f1: 0.3,
            precision: 0.18,
            recall: 0.9,
            covered: [10, 11, 12, 13, 14, 15, 16, 17, 1, 2, 3],
          },
        ),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(held.reason).toBe('guard-regressed');
  });

  it('breaks a tie inside the resolution by cost, so two arms a corpus cannot separate are not promoted for being dear', () => {
    const decision = promote({
      arms: [
        baseline(),
        arm(
          'dear',
          { codeContext: true },
          { f1: 0.27, cost: 99, covered: [10, 11, 12, 13, 14, 15, 16, 17, 1, 2, 3] },
        ),
        arm(
          'cheap',
          { remarks: { enabled: true } },
          { f1: 0.265, cost: 4, covered: [10, 11, 12, 13, 14, 15, 16, 17, 1, 2, 3] },
        ),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });

    expect(decision.outcome).toBe('promote');
    expect(decision.champion!.label).toBe('cheap');
    // **And the cheaper arm's own knob travels, not the dearer one's**: a tie-break that promoted one arm's cost and the
    // other arm's configuration would be two reviewers joined at the report.
    expect(decision.champion!.knobs['remarks']).toBe(true);
    expect(decision.champion!.knobs['codeContext']).toBe(false);
  });
});

describe('the record a promotion leaves', () => {
  it('carries the delta, the discordance, the p-value and the run that measured it', () => {
    const decision = promote({
      arms: [
        baseline(),
        arm(
          'winner',
          { codeContext: true },
          { f1: 0.26, covered: [10, 11, 12, 13, 14, 15, 16, 17, 1, 2, 3] },
        ),
      ],
      defaults: { knobs: KNOBS },
      rule: RULE,
    });
    const next = defaultsWith(
      decision,
      { schema: 1, knobs: KNOBS, provenance: {} },
      {
        resolvedAt: '2026-11-22',
        runUrl: 'https://example.invalid/run/1',
        ruleVersion: 1,
      },
    ) as { knobs: Record<string, unknown>; provenance: Record<string, unknown> };

    expect(next.knobs['codeContext']).toBe(true);
    expect(next.provenance['decision']).toBe('promoted');
    expect(next.provenance['ruleVersion']).toBe(1);
    const champion = next.provenance['champion'] as Record<string, unknown>;
    // **The figure and its evidence travel together**, so a reader of the JSON can check the JSON against the artifact:
    // a delta with no p-value is a claim, and a p-value with no run id is a claim nobody can look up.
    expect(champion['delta']).toBeCloseTo(0.06, 10);
    expect(champion['mcnemarP']).toBeLessThan(0.05);
    expect(champion['runId']).toBe('1234');
    expect(champion['gained']).toBe(8);
    // And the incumbent it replaced is named, because "what did this replace" is the first question of a revert.
    expect((next.provenance['incumbent'] as Record<string, unknown>)['experiment']).toBe(
      'baseline',
    );
  });

  it('reads a knob out of an artifact the way the engine reads it', () => {
    const { knobs, missing, unproven } = knobsOf(baseline().artifact);

    expect(missing).toEqual([]);
    expect(unproven).toEqual([]);
    expect(knobs).toEqual(KNOBS);
    expect(metricAt(baseline().artifact, 'pullRequestArm.f1')).toBe(0.2);
    expect(metricAt(baseline().artifact, 'pullRequestArm.nope')).toBeNull();
  });

  it('passes its own self-test, so the CLI has an assertion a workflow can run before it writes', () => {
    expect(selfTest()).toContain('promotion: 8 assertions hold');
  });
});
