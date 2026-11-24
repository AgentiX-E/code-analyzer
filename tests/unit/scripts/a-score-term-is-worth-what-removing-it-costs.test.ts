/**
 * **A score term is worth what removing it costs, and nothing else has been measured about it.**
 *
 * The actionability score is eight terms added into one number in [0, 1], and every argument about the ranking has been
 * an argument about the sum. An attachment audited in iteration 147 proposes exactly the opposite discipline - hold the
 * corpus and the query set fixed, toggle one asset, and read the difference as that asset's contribution - and applies it
 * to an ontology layer that does not exist in this repository. **The method is the transferable part, and the object it
 * should be pointed at is the score**, because that is the only part of the engine that decides which twelve comments a
 * pull request gets.
 *
 * Three ways this instrument can lie, and the cases that hold it:
 *
 * 1. **A weight table copied into the instrument.** The parser reads the engine's own source, and the first case asserts
 *    the parsed table equals the constant the engine exports - so a term added to the engine and not here fails a test
 *    rather than quietly going unpriced.
 * 2. **A score that is not the artifact's score.** Nothing is priced until every row's published score is reproduced to
 *    the digit; a mismatch throws and names the row. This is §144.4's rule, and it exists because the version of that
 *    probe which skipped it reported **+0.027 of pure arithmetic error in the flattering direction**.
 * 3. **A recall denominator taken from the emission.** Goldens are passed in, because a pull request whose comments a cut
 *    removed still owns its answer key, and a denominator that shrinks when a rule abstains raises recall for silence.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTIONABILITY_WEIGHTS,
  LANE_WEIGHT,
  SEVERITY_WEIGHT,
} from '../../../packages/intelligence/src/review/actionability';
import { readScoreWeights } from '../../../scripts/lib/score-weights.mjs';
import {
  ablateScoreTerms,
  ablationTable,
  recomputeScore,
  ScoreReproductionError,
} from '../../../scripts/lib/score-ablation.mjs';

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

/** One published row: the features the engine recorded and the score it published beside them. */
const row = (
  pr: string,
  features: Record<string, unknown>,
  matchedGoldens: number[] = [],
  score = recomputeScore({ features }, readScoreWeights(source)),
) => ({ pr, features, matchedGoldens, score, path: `src/${pr}.ts` });

describe('the weight table has one owner', () => {
  const weights = readScoreWeights(source);

  it('reads the engine source and lands on the constants the engine exports', () => {
    expect(weights.actionability).toEqual({ ...ACTIONABILITY_WEIGHTS });
    expect(weights.severity).toEqual({ ...SEVERITY_WEIGHT });
    expect(weights.lane).toEqual({ ...LANE_WEIGHT });
  });

  it('refuses a table that is missing a term, so a term cannot be added and stay unpriced', () => {
    const truncated = source.replace(/\n {2}hedgePenalty: [\d.]+,/u, '');
    expect(() => readScoreWeights(truncated)).toThrow(/hedgePenalty/u);
  });

  it('refuses a source with no weight table at all, rather than parsing an empty object as a table', () => {
    expect(() => readScoreWeights('export const NOTHING = 1;\n')).toThrow(/ACTIONABILITY_WEIGHTS/u);
  });
});

describe('reproducing the published score before pricing anything', () => {
  const weights = readScoreWeights(source);

  it('adds every term to exactly one, so the ceiling of the score is a real ceiling', () => {
    const all = recomputeScore(
      {
        features: {
          grounded: true,
          proposesChange: true,
          quotesDiff: true,
          namesSymbol: true,
          agreement: 3,
          severity: 'critical',
          lane: 'security',
          hedged: false,
        },
      },
      weights,
    );
    expect(all).toBe(1);
  });

  it('subtracts the hedge and clamps at zero, because a hedged finding is a claim the model declined to make', () => {
    const hedged = recomputeScore(
      {
        features: {
          grounded: false,
          hedged: true,
          agreement: 1,
          severity: 'info',
          lane: 'testing',
        },
      },
      weights,
    );
    // Only the agreement term (0.1 x 1/3 = 0.0333) and the lane prior (0.4 x 0.06 = 0.024) are left, against 0.1 of hedge.
    expect(hedged).toBe(0);
  });

  it('treats a missing agreement as one lane rather than as zero, which is what the engine does', () => {
    const absent = recomputeScore({ features: { severity: 'info', lane: 'testing' } }, weights);
    const explicitOne = recomputeScore(
      { features: { severity: 'info', lane: 'testing', agreement: 1 } },
      weights,
    );
    expect(absent).toBe(explicitOne);
  });
});

describe('pricing a term means removing it from everyone at once', () => {
  const weights = readScoreWeights(source);

  it('reports a term that fires on no row as dead, with a delta of exactly zero', () => {
    const findings = [
      row('p1', { grounded: true, agreement: 1, severity: 'low', lane: 'testing' }, [0]),
      row('p1', { grounded: true, agreement: 1, severity: 'low', lane: 'testing' }, []),
    ];
    const priced = ablateScoreTerms({ findings, goldens: 1, weights });
    const quotes = priced.terms.find((term) => term.term === 'quotesDiff');
    expect(quotes?.firedOn).toBe(0);
    expect(quotes?.dead).toBe(true);
    expect(quotes?.delta).toBe(0);
  });

  it('prices a term that pushes a buyer out of the budget as a cost, not as a neutral', () => {
    // **Thirteen comments for twelve slots.** The buyer scores lowest while `quotesDiff` fires on the twelve that buy
    // nothing; drop the term and the buyer ties them, and the cut's index tie-break keeps it.
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
    const findings = [buying, ...notBuying];
    expect(ablateScoreTerms({ findings, goldens: 1, weights }).baseline.truePositives).toBe(0);

    const priced = ablateScoreTerms({ findings, goldens: 1, weights });
    const quotes = priced.terms.find((term) => term.term === 'quotesDiff');
    expect(quotes?.firedOn).toBe(12);
    expect(quotes?.delta).toBeGreaterThan(0);
    expect(quotes?.delta).toBeCloseTo(2 / (12 + 1), 6);
  });

  it('refuses to price a row set whose scores the weights do not reproduce', () => {
    const findings = [
      {
        pr: 'p1',
        path: 'src/a.ts',
        matchedGoldens: [0],
        features: { grounded: true, severity: 'high', lane: 'security', agreement: 1 },
        score: 0.9,
      },
    ];
    expect(() => ablateScoreTerms({ findings, goldens: 1, weights })).toThrow(
      ScoreReproductionError,
    );
    expect(() => ablateScoreTerms({ findings, goldens: 1, weights })).toThrow(/p1/u);
  });

  it('keeps a silenced pull request in the denominator, so abstaining cannot raise the figure', () => {
    // p2 posted nothing after the cut and still holds two reference comments. A denominator taken from the emission would
    // read recall 1.0 here; the row set's reads one third.
    const findings = [
      row('p1', { grounded: true, agreement: 1, severity: 'low', lane: 'testing' }, [0]),
    ];
    const priced = ablateScoreTerms({ findings, goldens: 3, weights });
    expect(priced.baseline.goldens).toBe(3);
    expect(priced.baseline.recall).toBeCloseTo(1 / 3, 6);
  });
});

describe('the shapes an artifact has carried, and the ones it must not', () => {
  const weights = readScoreWeights(source);

  it('reads a row whose score is the nested shape an older artifact stored it in', () => {
    const features = { grounded: true, severity: 'high', lane: 'security', agreement: 1 };
    const flat = recomputeScore({ features }, weights);
    const nested = recomputeScore({ score: { score: flat, features } }, weights);
    expect(nested).toBe(flat);
  });

  it('refuses a row whose severity has no weight rather than treating it as zero', () => {
    // **`0` would be a number, and a number is what every average after it would be computed from.** The engine's own
    // table lookup produces `NaN` here; this refuses, which is the version a reader can act on.
    expect(() => recomputeScore({ features: { severity: 'catastrophic' } }, weights)).toThrow(
      /catastrophic/u,
    );
    expect(() => recomputeScore({ features: {} }, weights)).toThrow(/severity/u);
  });

  it('refuses a row that published no score at all, rather than reading it as zero', () => {
    const bare = [{ pr: 'p1', features: { severity: 'high', lane: 'security' } }];
    expect(() => ablateScoreTerms({ findings: bare, goldens: 1, weights })).toThrow(
      ScoreReproductionError,
    );
  });

  it('prints one line per term plus the baseline, with the baseline F1 on the baseline line', () => {
    const findings = [row('p1', { grounded: true, severity: 'low', lane: 'testing' }, [0])];
    const result = ablateScoreTerms({ findings, goldens: 1, weights });
    const lines = ablationTable(result).split('\n');
    expect(lines).toHaveLength(2 + result.terms.length);
    expect(lines[1]).toContain(result.baseline.f1.toFixed(4));
    expect(lines.map((line) => line.slice(0, 15).trim())).toContain('hedgePenalty');
  });
});

describe('the parser refuses the two ways a table can be unusable', () => {
  const table = [
    'export const ACTIONABILITY_WEIGHTS = Object.freeze({',
    '  grounded: 0.3, proposesChange: 0.2, quotesDiff: 0.14, namesSymbol: 0.08,',
    '  agreement: 0.1, severity: 0.12, lane: 0.06, hedgePenalty: 0.1,',
    '});',
    'const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 1 };',
  ].join('\n');

  it('refuses an object literal that never closes, instead of reading to the end of the file', () => {
    expect(() =>
      readScoreWeights(`${table}\nconst LANE_WEIGHT: Record<string, number> = {\n  security: 1,`),
    ).toThrow(/never closes/u);
  });

  it('refuses a declaration with no object literal, rather than searching the rest of the file for a brace', () => {
    expect(() =>
      readScoreWeights(`${table}\nconst LANE_WEIGHT: Record<string, number> = 5;`),
    ).toThrow(/without an object literal/u);
  });

  it('refuses a row whose score is an object carrying no number, because that is a row with no figure to rebuild', () => {
    const nothing = [{ pr: 'p1', features: { severity: 'high', lane: 'security' }, score: {} }];
    expect(() =>
      ablateScoreTerms({ findings: nothing, goldens: 1, weights: readScoreWeights(source) }),
    ).toThrow(ScoreReproductionError);
  });

  it('refuses a table that parses as empty, which would price every row at zero', () => {
    expect(() =>
      readScoreWeights(`${table}\nconst LANE_WEIGHT: Record<string, number> = {\n};`),
    ).toThrow(/empty table/u);
  });
});
