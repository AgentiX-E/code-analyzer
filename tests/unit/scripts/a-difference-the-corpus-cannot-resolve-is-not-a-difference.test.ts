/**
 * **A difference the corpus cannot resolve is not a difference.**
 *
 * Iteration 147 priced the actionability score term by term on a paid artifact. The instrument reproduced every published
 * score to the digit, and the best move it found was **+0.0053 F1** from dropping the hedge penalty - which is where this
 * module starts, because resampling the fifty pull requests puts that interval at **[−0.0042, +0.0162]** and choosing
 * terms on one half of the corpus and reading them on the other picks a different term in each direction.
 *
 * What survives is not a re-weighting. It is the resolution: **0.0123 F1 at fifty pull requests**, against a frontier that
 * was priced at +0.0087. **The remaining moves are below the ruler**, and a plan that does not say so is a plan that will
 * keep reporting noise as progress.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ablateScoreTerms,
  pairedTermComparison,
  recomputeScore,
  ScoreReproductionError,
} from '../../../scripts/lib/score-ablation.mjs';
import {
  bootstrapF1Delta,
  mcnemarExact,
  mulberry32,
} from '../../../scripts/lib/paired-difference.mjs';
import { readScoreWeights } from '../../../scripts/lib/score-weights.mjs';

const source = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'intelligence',
    'src',
    'review',
    'actionability.ts',
  ),
  'utf8',
);
const weights = readScoreWeights(source);

const row = (pr: string, features: Record<string, unknown>, matchedGoldens: number[] = []) => ({
  pr,
  path: `src/${pr}.ts`,
  features,
  matchedGoldens,
  score: recomputeScore({ features }, weights),
});

describe('the resampler is reproducible or the interval is not evidence', () => {
  it('gives the same sequence for the same seed and a different one for a different seed', () => {
    const first = mulberry32(7);
    const again = mulberry32(7);
    const other = mulberry32(8);
    const a = [first(), first(), first()];
    expect(a).toEqual([again(), again(), again()]);
    expect(a).not.toEqual([other(), other(), other()]);
  });
});

describe('resampling pull requests, not comments', () => {
  it('separates a gain every pull request shares, because that is a signal the corpus can see', () => {
    const perPullRequest = Array.from({ length: 40 }, () => ({
      base: { truePositives: 1, emitted: 6, goldens: 10 },
      alt: { truePositives: 2, emitted: 6, goldens: 10 },
    }));
    const interval = bootstrapF1Delta({ perPullRequest, rounds: 400 });
    expect(interval.lo).toBeGreaterThan(0);
    expect(interval.mde).toBeLessThan(interval.observed * 4);
  });

  it('refuses to separate a gain carried by one pull request out of fifty', () => {
    // **The shape of every move this corpus has left.** One pull request buys two more comments; the other forty-nine are
    // unchanged. The point estimate is positive and the interval spans zero, which is the correct reading.
    const perPullRequest = Array.from({ length: 50 }, (_, index) => ({
      base: { truePositives: index === 0 ? 1 : 2, emitted: 6, goldens: 9 },
      alt: { truePositives: index === 0 ? 3 : 2, emitted: 6, goldens: 9 },
    }));
    const interval = bootstrapF1Delta({ perPullRequest, rounds: 600 });
    expect(interval.observed).toBeGreaterThan(0);
    expect(interval.lo).toBeLessThanOrEqual(0);
    expect(interval.mde).toBeGreaterThan(interval.observed);
  });

  it('reads a pull request that emitted nothing and owns nothing as an F1 of zero rather than as a division', () => {
    const interval = bootstrapF1Delta({
      perPullRequest: [
        {
          base: { truePositives: 0, emitted: 0, goldens: 0 },
          alt: { truePositives: 0, emitted: 0, goldens: 0 },
        },
      ],
      rounds: 50,
    });
    expect(interval.observed).toBe(0);
    expect(Number.isNaN(interval.mean)).toBe(false);
  });

  it('returns zeros rather than NaN when there is nothing to resample', () => {
    expect(bootstrapF1Delta({ perPullRequest: [] })).toMatchObject({
      rounds: 0,
      observed: 0,
      lo: 0,
      hi: 0,
    });
  });

  it('reports no difference when both arms are the same arm', () => {
    const perPullRequest = Array.from({ length: 20 }, () => ({
      base: { truePositives: 3, emitted: 8, goldens: 12 },
      alt: { truePositives: 3, emitted: 8, goldens: 12 },
    }));
    const interval = bootstrapF1Delta({ perPullRequest, rounds: 200 });
    expect(interval.observed).toBe(0);
    expect(interval.lo).toBe(0);
    expect(interval.hi).toBe(0);
  });
});

describe('the paired test on the comments that changed hands', () => {
  it('is one for two arms that bought the same comments, because agreement is not a difference', () => {
    expect(mcnemarExact(0, 0)).toBe(1);
  });

  it('reads eight comments all one way as p = 0.0078, where the F1 interval cannot see them', () => {
    expect(mcnemarExact(0, 8)).toBeCloseTo(0.0078125, 9);
  });

  it('is symmetric, because which arm is called the baseline is a naming choice', () => {
    expect(mcnemarExact(3, 9)).toBeCloseTo(mcnemarExact(9, 3), 12);
  });

  it('reads three of four one way as p = 0.625, which is a tie rather than a tendency', () => {
    // 2 x P(X <= 1 | n = 4) = 2 x (1 + 4) / 16
    expect(mcnemarExact(1, 3)).toBeCloseTo(0.625, 9);
  });
});

describe('the paired comparison of one score term', () => {
  it('refuses to price a row set whose scores the weights do not reproduce', () => {
    const findings = [{ pr: 'p1', features: { severity: 'high', lane: 'security' }, score: 0.4 }];
    expect(() =>
      pairedTermComparison({
        findings,
        goldensByPullRequest: [{ pr: 'p1', goldens: 1 }],
        weights,
        rounds: 50,
      }),
    ).toThrow(ScoreReproductionError);
  });

  it('keeps a pull request that posted nothing in the row set, with its own reference comments', () => {
    const findings = [row('p1', { grounded: true, severity: 'low', lane: 'testing' }, [0])];
    const compared = pairedTermComparison({
      findings,
      goldensByPullRequest: [
        { pr: 'p1', goldens: 1 },
        { pr: 'p2', goldens: 2 },
      ],
      weights,
      rounds: 100,
    });
    expect(compared.pullRequests).toBe(2);
    expect(compared.goldens).toBe(3);
    expect(compared.baseline.recall).toBeCloseTo(1 / 3, 6);
  });

  it('scopes a covered comment to its own pull request, so two answer keys do not merge', () => {
    // **The key is the pull request and the index.** p1's buyer is sixteenth of thirteen and is cut while `quotesDiff`
    // fires on the twelve that buy nothing; p2 has one comment that buys golden 0 whatever its score. Dropping the term
    // therefore moves **golden 0 from p2's key to p1's key** - a gain of one - and a coverage set keyed on the index
    // alone would see one golden before and one after and report no change at all.
    const buying = row(
      'p1',
      { namesSymbol: true, agreement: 1, severity: 'low', lane: 'testing' },
      [0],
    );
    const notBuying = Array.from({ length: 12 }, () =>
      row('p1', {
        namesSymbol: true,
        quotesDiff: true,
        agreement: 1,
        severity: 'low',
        lane: 'testing',
      }),
    );
    const other = row(
      'p2',
      { quotesDiff: true, agreement: 1, severity: 'low', lane: 'testing' },
      [0],
    );

    const compared = pairedTermComparison({
      findings: [buying, ...notBuying, other],
      goldensByPullRequest: [
        { pr: 'p1', goldens: 1 },
        { pr: 'p2', goldens: 1 },
      ],
      weights,
      rounds: 100,
    });
    const quotes = compared.terms.find((term) => term.term === 'quotesDiff');
    expect(quotes?.onlyAlt).toBe(1);
    expect(quotes?.onlyBase).toBe(0);
    expect(quotes?.p).toBe(1);
  });

  it('publishes the corpus resolution beside the terms, because a smaller move cannot be shown', () => {
    const findings = [
      row('p1', { grounded: true, severity: 'high', lane: 'security' }, [0]),
      row('p1', { grounded: false, severity: 'low', lane: 'testing' }, []),
    ];
    const compared = pairedTermComparison({
      findings,
      goldensByPullRequest: [{ pr: 'p1', goldens: 2 }],
      weights,
      rounds: 100,
    });
    expect(compared.resolution.mde).toBeCloseTo(2.801_585 * compared.resolution.sd, 5);
    // One pull request cannot resolve anything, and the resolution figure says so rather than printing a confident zero.
    expect(compared.resolution.mde).toBe(0);
  });

  it('agrees with the unpaired pricing on the point estimate, or the two instruments are two arithmetics', () => {
    const findings = [
      row(
        'p1',
        { grounded: true, proposesChange: true, severity: 'high', lane: 'security', hedged: true },
        [0],
      ),
      row('p1', { severity: 'low', lane: 'testing' }, []),
      row('p2', { quotesDiff: true, severity: 'medium', lane: 'maintenance' }, [0]),
    ];
    const points = ablateScoreTerms({ findings, goldens: 2, weights });
    const paired = pairedTermComparison({
      findings,
      goldensByPullRequest: [
        { pr: 'p1', goldens: 1 },
        { pr: 'p2', goldens: 1 },
      ],
      weights,
      rounds: 100,
    });
    expect(paired.baseline.f1).toBeCloseTo(points.baseline.f1, 9);
    for (const term of pairs(paired.terms, points.terms)) {
      expect(term.paired.delta).toBeCloseTo(term.unpaired.delta, 6);
    }
  });
});

/** Both instruments' readings for one term, so the agreement case can name both sides of the comparison. */
function pairs(
  paired: readonly { term: string; delta: number }[],
  unpaired: readonly { term: string; delta: number }[],
): { paired: { term: string; delta: number }; unpaired: { term: string; delta: number } }[] {
  return paired.map((entry) => ({
    paired: entry,
    unpaired: unpaired.find((other) => other.term === entry.term) ?? {
      term: entry.term,
      delta: Number.NaN,
    },
  }));
}

describe('the instrument is wired where the artifact is made', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
    'utf8',
  );

  it('prices the terms on every dispatch, against the artifact that dispatch produced', () => {
    expect(workflow).toContain('scripts/aacr-score-ablation.mjs benchmarks/aacr-bench.json');
    expect(workflow).toContain('benchmarks/aacr-score-ablation.json');
  });

  it('runs the step without `continue-on-error`, because an artifact the weights cannot rebuild is the defect', () => {
    const step = workflow.slice(workflow.indexOf('name: score_terms'));
    const body = step.slice(
      0,
      step.indexOf('- name:', 10) < 0 ? step.length : step.indexOf('- name:', 10),
    );
    expect(body).not.toContain('continue-on-error');
  });

  it('uploads the figure beside the artifact, or it is a number nobody can download', () => {
    const upload = workflow.slice(workflow.indexOf('name: Upload the figure'));
    expect(upload).toContain('benchmarks/aacr-score-ablation.json');
  });
});

describe('the shapes a real artifact has and a tidy fixture does not', () => {
  it('counts the reference comments a term costs, not only the ones it wins', () => {
    // **A term that keeps a buyer in the twelve has a cost when it goes.** The buyer's margin is exactly the `grounded`
    // term: at 0.4593 it is first of thirteen, and at 0.1593 it is thirteenth, so removing the term trades a bought
    // comment for nothing and the discordant table reads `1 -> 0`.
    const buyer = row(
      'p1',
      { grounded: true, agreement: 1, severity: 'high', lane: 'architecture' },
      [0],
    );
    const others = Array.from({ length: 12 }, () =>
      row('p1', { proposesChange: true, agreement: 3, severity: 'high', lane: 'architecture' }),
    );
    const compared = pairedTermComparison({
      findings: [buyer, ...others],
      goldensByPullRequest: [{ pr: 'p1', goldens: 1 }],
      weights,
      rounds: 100,
    });
    expect(compared.baseline.truePositives).toBe(1);
    const grounded = compared.terms.find((term) => term.term === 'grounded');
    expect(grounded?.onlyBase).toBe(1);
    expect(grounded?.onlyAlt).toBe(0);
    expect(grounded?.delta).toBeLessThan(0);
  });

  it('reads a row with no pull request, no verdicts and an unmapped lane as the zeroes the artifact means', () => {
    // **Every one of these is a real artifact field, and each is a default this instrument used to assume.** An
    // unlabelled lane earns the engine's 0.5 prior; a row with no verdicts buys nothing; a pull request with findings but
    // no answer key is a row set the coverage table has no count for, which is zero reference comments rather than a
    // crash. If any of them threw, the run would lose its figure to a field the artifact is allowed to omit.
    const findings = [
      row('p1', { grounded: true, severity: 'low', lane: 'unmapped-lane' }, [0]),
      {
        pr: '',
        features: { severity: 'info', lane: 'testing' },
        score: recomputeScore({ features: { severity: 'info', lane: 'testing' } }, weights),
      },
      {
        pr: 'p3',
        features: { severity: 'info', lane: 'testing' },
        matchedGoldens: [],
        score: recomputeScore({ features: { severity: 'info', lane: 'testing' } }, weights),
      },
    ];
    const compared = pairedTermComparison({
      findings,
      goldensByPullRequest: [
        { pr: 'p1', goldens: 1 },
        { pr: 'p2', goldens: 0 },
      ],
      weights,
      rounds: 100,
    });
    expect(compared.pullRequests).toBe(4);
    expect(compared.goldens).toBe(1);
    expect(compared.baseline.truePositives).toBe(1);
  });
});

describe('the fields an artifact is allowed to omit', () => {
  it('reads a row with no lane as the engine default rather than as a crash', () => {
    const features = { severity: 'info' };
    const unlabelled = { features, score: recomputeScore({ features }, weights) };
    const compared = pairedTermComparison({
      findings: [unlabelled],
      goldensByPullRequest: [{ pr: '' }, { pr: 'p9' }],
      weights,
      rounds: 50,
    });
    // Three keys: the unattributed bucket, `p9`, and the empty-string pull request the entry names. None of them posted
    // anything, so the baseline is the empty point rather than a division.
    expect(compared.baseline.emitted).toBe(1);
    expect(compared.goldens).toBe(0);
  });

  it('names a row that published neither a pull request nor a figure, instead of blaming the weights', () => {
    const nameless = [{ features: { severity: 'high', lane: 'security' }, score: 0.9 }];
    expect(() =>
      pairedTermComparison({
        findings: nameless,
        goldensByPullRequest: [{ pr: 'p9' }],
        weights,
        rounds: 50,
      }),
    ).toThrow(ScoreReproductionError);
    expect(() => ablateScoreTerms({ findings: nameless, goldens: 0, weights })).toThrow(
      ScoreReproductionError,
    );
    expect(() => recomputeScore({}, weights)).toThrow(/severity/u);

    // And the unpaired pricing reads a row with no verdicts as buying nothing, rather than as a row to skip.
    const features = { severity: 'high', lane: 'security' };
    const unjudged = [{ pr: 'p1', features, score: recomputeScore({ features }, weights) }];
    expect(
      ablateScoreTerms({ findings: unjudged, goldens: 1, weights }).baseline.truePositives,
    ).toBe(0);
  });
});
