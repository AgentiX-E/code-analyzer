// The sample's own tests.
//
// **These numbers are the argument, so every one of them has to be checked against arithmetic a reader can redo.** The
// ways this module can be wrong are all quiet: a coverage whose denominator is the rows that exist rather than the rows
// that were asked for; a standardisation that drops an unmeasured band and reports the remainder as the whole; a sign
// test whose tail is counted once instead of twice; a bootstrap whose interval moves between two runs of the same
// commit because it read `Math.random`.

import { describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_SEED,
  DEFAULT_STRATA,
  publishedRank,
  pairedComparison,
  rowsInBand,
  sampleCoverage,
  signTest,
  standardisedMap,
  stratify,
  worstCaseMap,
} from '../lca-sample.js';

import type { LcaRowScore } from '../lca-merge.js';

/** A row with the fields this module reads, and nothing else invented. */
function row(input: {
  id: number;
  corpusFiles: number;
  map?: number;
  bm25?: number | null;
  skipped?: string | null;
}): LcaRowScore {
  return {
    id: input.id,
    repo: `owner/repo${String(input.id)}`,
    corpusFiles: input.corpusFiles,
    expectedFiles: 1,
    expectedOutside: 0,
    offered: 0,
    outside: 0,
    offeredPaths: [],
    corpusBytes: null,
    corpusUnreadable: 0,
    checkoutBytes: null,
    checkoutUnreadable: 0,
    graphNodes: null,
    graphEdges: null,
    cost: null,
    bm25:
      input.bm25 === undefined || input.bm25 === null
        ? null
        : {
            map: input.bm25,
            documents: 10,
            skippedFiles: 0,
            unreadableFiles: 0,
            ranked: [],
          },
    skipped: input.skipped ?? null,
    retrieval: {},
    map: input.map ?? 0,
    answer: null,
  };
}

describe('sampleCoverage', () => {
  it('counts attempted, measured and refused', () => {
    const coverage = sampleCoverage([
      row({ id: 1, corpusFiles: 10, map: 0.5 }),
      row({ id: 2, corpusFiles: 10, map: 0.5 }),
      row({ id: 3, corpusFiles: 9_000, skipped: 'above the stated cap' }),
    ]);
    expect(coverage.attempted).toBe(3);
    expect(coverage.measured).toBe(2);
    expect(coverage.refused).toBe(1);
    expect(coverage.ofAttempted).toBeCloseTo(2 / 3, 10);
  });

  it('states the share of the protocol, not the share of the rows that exist', () => {
    // **The defect this parameter exists to prevent.** Thirty rows examined out of fifty asked for must not report a
    // coverage of one hundred per cent just because the twenty that were never reached produced no row.
    const coverage = sampleCoverage([row({ id: 1, corpusFiles: 10, map: 1 })], 50);
    expect(coverage.planned).toBe(50);
    expect(coverage.unreached).toBe(49);
    expect(coverage.ofPlanned).toBeCloseTo(1 / 50, 10);
    expect(coverage.ofAttempted).toBe(1);
  });

  it('never reports a planned smaller than the rows it has', () => {
    const coverage = sampleCoverage(
      [row({ id: 1, corpusFiles: 1 }), row({ id: 2, corpusFiles: 1 })],
      1,
    );
    expect(coverage.planned).toBe(2);
  });

  it('groups refusals by their sentence, most frequent first', () => {
    const coverage = sampleCoverage([
      row({ id: 1, corpusFiles: 9_000, skipped: 'too many files' }),
      row({ id: 2, corpusFiles: 9_000, skipped: 'too many files' }),
      row({ id: 3, corpusFiles: 9_000, skipped: 'no memory' }),
    ]);
    expect(coverage.refusals).toEqual([
      { because: 'too many files', count: 2 },
      { because: 'no memory', count: 1 },
    ]);
  });

  it('orders two refusals of equal count by their sentence, so two runs print the same table', () => {
    const coverage = sampleCoverage([
      row({ id: 1, corpusFiles: 1, skipped: 'zebra' }),
      row({ id: 2, corpusFiles: 1, skipped: 'alpha' }),
    ]);
    expect(coverage.refusals.map((refusal) => refusal.because)).toEqual(['alpha', 'zebra']);
  });

  it('answers an empty sample with zeros rather than with a division by zero', () => {
    const coverage = sampleCoverage([]);
    expect(coverage.ofAttempted).toBe(0);
    expect(coverage.ofPlanned).toBe(0);
    expect(coverage.refusals).toEqual([]);
  });
});

describe('rowsInBand', () => {
  it('is half-open, so an instance on a boundary is counted once', () => {
    const rows = [row({ id: 1, corpusFiles: 50 }), row({ id: 2, corpusFiles: 200 })];
    expect(rowsInBand(rows, 0, 50)).toHaveLength(0);
    expect(rowsInBand(rows, 50, 200)).toHaveLength(1);
    expect(rowsInBand(rows, 200, 500)).toHaveLength(1);
  });

  it('gives the open band everything above it', () => {
    const rows = [row({ id: 1, corpusFiles: 2_001 }), row({ id: 2, corpusFiles: 900_000 })];
    expect(rowsInBand(rows, 2_000, null)).toHaveLength(2);
  });
});

describe('stratify', () => {
  it('reports both rankings per band', () => {
    const strata = stratify(
      [
        row({ id: 1, corpusFiles: 10, map: 0.5, bm25: 0.25 }),
        row({ id: 2, corpusFiles: 10, map: 0.5, bm25: 0.25 }),
        row({ id: 3, corpusFiles: 9_000, skipped: 'too large', bm25: 0.1 }),
      ],
      DEFAULT_STRATA,
    );
    expect(strata[0]).toMatchObject({
      attempted: 2,
      measured: 2,
      map: 0.5,
      bm25: 0.25,
      bm25Rows: 2,
    });
    // **The band we could not measure still carries the control**, which is the entire reason the control exists: the
    // difficulty of the half of the corpus the bounds removed is a published number rather than a caveat.
    expect(strata[4]).toMatchObject({
      attempted: 1,
      measured: 0,
      map: null,
      bm25: 0.1,
      bm25Rows: 1,
    });
  });

  it('reports `null` rather than zero when a band produced no figure', () => {
    const strata = stratify([row({ id: 1, corpusFiles: 10, map: 0.5 })]);
    expect(strata[0]!.bm25).toBeNull();
    expect(strata[0]!.bm25Rows).toBe(0);
  });

  it('labels the open band without an upper bound', () => {
    const strata = stratify([row({ id: 1, corpusFiles: 10 })]);
    expect(strata.map((stratum) => stratum.label)).toEqual([
      '0-50 files',
      '50-200 files',
      '200-500 files',
      '500-2000 files',
      '2000+ files',
    ]);
  });

  it('answers with the bands it was given, in order', () => {
    const strata = stratify(
      [row({ id: 1, corpusFiles: 5, map: 1 })],
      [
        [0, 10],
        [10, null],
      ],
    );
    expect(strata).toHaveLength(2);
    expect(strata[0]!.map).toBe(1);
    expect(strata[1]!.map).toBeNull();
  });
});

describe('standardisedMap', () => {
  it('reweights the bands by how many instances each holds', () => {
    // **The arithmetic, by hand.** One small repository was measured at 1.0. Three large ones were attempted, one was
    // measured at 0.0 and two were refused - so the measured rows are 1:1 between the bands while the population is
    // 1:3. The raw mean over the measured rows is 0.5; the mean over the population, weighted 1:3, is 0.25. **The second
    // number is the one that estimates the corpus**, and the gap between them is the bias the sample carried.
    const strata = stratify(
      [
        row({ id: 1, corpusFiles: 10, map: 1 }),
        row({ id: 2, corpusFiles: 300, map: 0 }),
        row({ id: 3, corpusFiles: 300, skipped: 'too large' }),
        row({ id: 4, corpusFiles: 300, skipped: 'too large' }),
      ],
      [
        [0, 50],
        [50, null],
      ],
    );
    const standardised = standardisedMap(strata);
    expect(standardised.raw).toBe(0.5);
    expect(standardised.value).toBe(0.25);
    // **Both bands were measured, so every unit of weight is covered** - and that is a different statement from
    // "every instance was measured", which is why the two are published apart.
    expect(standardised.coveredShare).toBe(1);
  });

  it('drops an unmeasured band and says how much weight that cost', () => {
    const strata = stratify(
      [
        row({ id: 1, corpusFiles: 10, map: 1 }),
        row({ id: 2, corpusFiles: 9_000, skipped: 'too large' }),
      ],
      [
        [0, 50],
        [50, null],
      ],
    );
    const standardised = standardisedMap(strata);
    expect(standardised.value).toBe(1);
    // **Half the population is unmeasured and the figure says so**, which is the caveat that has to travel with it.
    expect(standardised.coveredShare).toBeCloseTo(0.5, 10);
  });

  it('answers `null` when no band was measured', () => {
    const strata = stratify(
      [row({ id: 1, corpusFiles: 9_000, skipped: 'too large' })],
      [[0, null]],
    );
    expect(standardisedMap(strata).value).toBeNull();
    expect(standardisedMap(strata).raw).toBeNull();
  });

  it('answers a zero covered share for an empty sample', () => {
    expect(standardisedMap(stratify([])).coveredShare).toBe(0);
  });
});

describe('worstCaseMap', () => {
  it('scores a refusal as zero, because that is what the bound costs', () => {
    // **A refusal is not evidence of anything, so scoring it as anything above zero would be inventing a measurement.**
    // 0.8 over two measured of four attempted is 0.4 as a floor, and 0.4 is a number nobody can argue with.
    const value = worstCaseMap([
      row({ id: 1, corpusFiles: 10, map: 0.8 }),
      row({ id: 2, corpusFiles: 10, map: 0.8 }),
      row({ id: 3, corpusFiles: 9_000, skipped: 'too large' }),
      row({ id: 4, corpusFiles: 9_000, skipped: 'too large' }),
    ]);
    expect(value).toBeCloseTo(0.4, 10);
  });

  it('answers `null` for an empty sample', () => {
    expect(worstCaseMap([])).toBeNull();
  });
});

describe('signTest', () => {
  it('answers one when there is no evidence either way', () => {
    expect(signTest(0, 0)).toBe(1);
  });

  it('is the exact two-sided binomial tail', () => {
    // Five wins out of five is 1/32 on one tail and 2/32 two-sided.
    expect(signTest(5, 0)).toBeCloseTo(0.0625, 10);
    // Ten out of ten is 2/1024.
    expect(signTest(10, 0)).toBeCloseTo(0.001953125, 10);
  });

  it('doubles the smaller tail and never exceeds one', () => {
    expect(signTest(5, 5)).toBe(1);
    expect(signTest(6, 4)).toBeCloseTo((2 * (210 + 120 + 45 + 10 + 1)) / 1024, 10);
  });

  it('is symmetric in its arguments, because the test is two-sided', () => {
    expect(signTest(7, 2)).toBeCloseTo(signTest(2, 7), 12);
  });

  it('stays computable at the largest sample the corpus can produce', () => {
    // **`150!` is not a number this program can hold and `C(150, 75)` is**, which is why the implementation multiplies
    // a running product rather than dividing factorials. The figure has to be a probability, not a `NaN`.
    const value = signTest(150, 0);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1e-30);
  });
});

describe('pairedComparison', () => {
  it('counts a win, a loss and a tie', () => {
    const paired = pairedComparison([
      row({ id: 1, corpusFiles: 10, map: 0.6, bm25: 0.2 }),
      row({ id: 2, corpusFiles: 10, map: 0.1, bm25: 0.4 }),
      row({ id: 3, corpusFiles: 10, map: 0.3, bm25: 0.3 }),
    ]);
    expect(paired).toMatchObject({ rows: 3, wins: 1, losses: 1, ties: 1 });
    expect(paired!.meanDelta).toBeCloseTo((0.4 - 0.3 + 0) / 3, 4);
  });

  it('excludes a refused row, which has no ranking of ours to pair', () => {
    const paired = pairedComparison([
      row({ id: 1, corpusFiles: 10, map: 0.6, bm25: 0.2 }),
      row({ id: 2, corpusFiles: 9_000, skipped: 'too large', bm25: 0.1 }),
    ]);
    // **Pairing against a zero would be pairing against a fact nobody measured**, and it would make the difference look
    // enormous on exactly the instances the bounds removed.
    expect(paired!.rows).toBe(1);
    expect(paired!.wins).toBe(1);
  });

  it('excludes a measured row the control did not run on', () => {
    const paired = pairedComparison([
      row({ id: 1, corpusFiles: 10, map: 0.6, bm25: null }),
      row({ id: 2, corpusFiles: 10, map: 0.5, bm25: 0.2 }),
    ]);
    expect(paired!.rows).toBe(1);
  });

  it('answers `null` when nothing could be paired', () => {
    expect(pairedComparison([row({ id: 1, corpusFiles: 10, map: 0.6 })])).toBeNull();
  });

  it('publishes the seed and the resample count so the interval can be recomputed', () => {
    const paired = pairedComparison([row({ id: 1, corpusFiles: 10, map: 0.6, bm25: 0.2 })]);
    expect(paired!.seed).toBe(BOOTSTRAP_SEED);
    expect(paired!.resamples).toBeGreaterThan(0);
  });

  it('is a function of the rows rather than of the run', () => {
    // **Two calls, one answer.** An interval that moved between two runs of the same commit is an interval nobody can
    // check, which is the only property a published interval really needs.
    const rows = [
      row({ id: 1, corpusFiles: 10, map: 0.6, bm25: 0.2 }),
      row({ id: 2, corpusFiles: 20, map: 0.5, bm25: 0.3 }),
      row({ id: 3, corpusFiles: 30, map: 0.4, bm25: 0.35 }),
      row({ id: 4, corpusFiles: 40, map: 0.9, bm25: 0.1 }),
    ];
    expect(pairedComparison(rows)).toEqual(pairedComparison(rows));
  });

  it('reports an interval that contains the estimate', () => {
    const rows = [
      row({ id: 1, corpusFiles: 10, map: 0.6, bm25: 0.2 }),
      row({ id: 2, corpusFiles: 20, map: 0.5, bm25: 0.3 }),
      row({ id: 3, corpusFiles: 30, map: 0.4, bm25: 0.35 }),
      row({ id: 4, corpusFiles: 40, map: 0.9, bm25: 0.1 }),
      row({ id: 5, corpusFiles: 50, map: 0.8, bm25: 0.25 }),
    ];
    const paired = pairedComparison(rows)!;
    expect(paired.lower).toBeLessThanOrEqual(paired.meanDelta);
    expect(paired.upper).toBeGreaterThanOrEqual(paired.meanDelta);
  });

  it('honours a caller’s seed and resample count', () => {
    const rows = [row({ id: 1, corpusFiles: 10, map: 0.6, bm25: 0.2 })];
    const paired = pairedComparison(rows, { seed: 7, resamples: 10 });
    expect(paired!.seed).toBe(7);
    expect(paired!.resamples).toBe(10);
  });
});

describe('publishedRank', () => {
  /** The paper's table, abridged to the shape the function reads. */
  const TABLE = [
    { name: 'GPT-4', map: 0.39 },
    { name: 'GTE', map: 0.33 },
    { name: 'Mistral', map: 0.3 },
    { name: 'TF-IDF', map: 0.27 },
    { name: 'BM25 and the rest', map: 0.25, bound: true },
  ];

  it('answers a position rather than a count of rows beaten', () => {
    // **The defect**: beating four of five used to publish `rank: 4` and be read as fourth. It is second, of six.
    const placed = publishedRank(0.3458, TABLE);
    expect(placed.beaten).toHaveLength(4);
    expect(placed.rank).toBe(2);
    expect(placed.of).toBe(6);
  });

  it('puts a figure above every row first', () => {
    const placed = publishedRank(0.9, TABLE);
    expect(placed.rank).toBe(1);
    expect(placed.of).toBe(6);
    expect(placed.beaten).toHaveLength(5);
    expect(placed.notBeaten).toHaveLength(0);
  });

  it('puts a figure below every row last', () => {
    const placed = publishedRank(0.01, TABLE);
    expect(placed.rank).toBe(6);
    expect(placed.beaten).toHaveLength(0);
    expect(placed.notBeaten).toHaveLength(5);
  });

  it('meets a bound rather than having to beat it', () => {
    // **A row published as "below 0.25" is a ceiling**, so a figure of exactly 0.25 is at the top of it and not above
    // it. A strict comparison here would credit us with beating a number the row never claimed.
    const at = publishedRank(0.25, TABLE);
    expect(at.beaten).toContain('BM25 and the rest');
    expect(publishedRank(0.2499, TABLE).beaten).not.toContain('BM25 and the rest');
  });

  it('counts a figure equal to a published figure as not beating it', () => {
    const placed = publishedRank(0.33, TABLE);
    expect(placed.beaten).not.toContain('GTE');
    expect(placed.notBeaten).toContain('GTE');
  });

  it('places a figure against an empty table first of one', () => {
    const placed = publishedRank(0.5, []);
    expect(placed.rank).toBe(1);
    expect(placed.of).toBe(1);
  });
});
