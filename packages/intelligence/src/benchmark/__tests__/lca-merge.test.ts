// The combination's own tests.
//
// **The number this module produces is the one the gate judges**, and the way it can be wrong is arithmetic rather than
// plumbing: a mean of three per-language means weights a language with two instances as heavily as one with eight, and
// that figure would be a statement about how the workflow was sharded rather than about the retriever. Every case here
// is that failure or one of its neighbours - a skipped row leaking into an average, an arm that did not run being
// averaged as a zero, a part that is absent being read as a part that scored nothing.

import { describe, expect, it } from 'vitest';

import {
  armScore,
  combineParts,
  costModels,
  declarationDensity,
  fitCost,
  mapScore,
  publishedRow,
  skippedRow,
  summarisePart,
} from '../lca-merge.js';

import type { ArmMetrics, LanguagePart, LcaRowScore } from '../lca-merge.js';

/** The authors' seven figures for one instance, from the two that the rest are arithmetic functions of. */
function metrics(precision: number, recall: number): ArmMetrics {
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision,
    recall,
    f1,
    fpr: 1 - precision,
    allCorrect: precision === 1 && recall === 1 ? 1 : 0,
    atLeastOneCorrect: recall > 0 ? 1 : 0,
    allIncorrect: 0,
  };
}

/** A measured row with the same metrics at every cut, which is enough to test an average. */
function row(id: number, precision: number, recall: number, cuts = [1, 3, 5, 10]): LcaRowScore {
  const retrieval: Record<string, ArmMetrics> = {};
  for (const cut of cuts) retrieval[`at${String(cut)}`] = metrics(precision, recall);
  return {
    id,
    repo: `owner/repo${String(id)}`,
    corpusFiles: 10,
    expectedFiles: 1,
    expectedOutside: 0,
    offered: 10,
    outside: 0,
    answerRank: 1,
    offeredPaths: [],
    corpusBytes: 1_000,
    corpusUnreadable: 0,
    checkoutBytes: 4_000,
    checkoutUnreadable: 0,
    graphNodes: 0,
    graphEdges: 0,
    cost: { peakRssMb: 500, elapsedMs: 1_000 },
    bm25: null,
    tfidf: null,
    body: null,
    fallback: null,
    fusion: null,
    declarationMap: null,
    declarationRank: null,
    fusionByK: [],
    fusionByWeighting: [],
    rankedPaths: [],
    skipped: null,
    fileArms: null,
    retrieval,
    map: precision,
    answer: metrics(precision, recall),
  };
}

/** A row the bounds refused: no metrics, and a sentence saying why. */
function skipped(id: number, because: string): LcaRowScore {
  return {
    ...row(id, 0, 0),
    retrieval: {},
    answer: null,
    skipped: because,
  };
}

/** One part, as a job would have written it. **Without the answer arm its rows carry no answer**, which is what the
 * harness writes when no provider is present - a zero there would read as a model that cited nothing. */
function part(config: string, rows: LcaRowScore[], answerArm = true): LanguagePart {
  return {
    config,
    measuredAt: '2026-11-03',
    rowLimit: 8,
    planned: 8,
    answerArm,
    bounds: {
      capFiles: 2000,
      memoryFiles: 1500,
      mbPerFile: 3.7,
      reserveMb: 1024,
      budgetMs: 2_700_000,
      instanceRssCapMb: 6144,
      instanceHeapMb: 3072,
      instanceTimeoutMs: 900_000,
    },
    space: { semantic: false, reason: 'lexical only' },
    configuration: { maxBlocks: 40, retrieveLimit: 200 },
    rows: answerArm ? rows : rows.map((r) => ({ ...r, answer: null })),
  };
}

describe('armScore', () => {
  it('averages over the rows that produced a figure', () => {
    const score = armScore([row(1, 1, 1), row(2, 0, 0)], (r) => r.retrieval['at10']!);
    expect(score.rows).toBe(2);
    expect(score.precision).toBe(0.5);
    expect(score.recall).toBe(0.5);
  });

  it('leaves a skipped row out of the average and out of the count', () => {
    const score = armScore([row(1, 1, 1), skipped(2, 'too large')], (r) => r.retrieval['at10']!);
    expect(score.rows).toBe(1);
    expect(score.precision).toBe(1);
  });

  it('leaves an arm that did not run out of the average rather than counting it as zero', () => {
    const score = armScore([row(1, 1, 1), { ...row(2, 0, 0), answer: null }], (r) => r.answer);
    expect(score.rows).toBe(1);
    expect(score.precision).toBe(1);
  });

  it('leaves a cut the row did not report out of that cut’s average', () => {
    // A skipped row carries no metrics at all, and a row measured before a cut existed carries fewer than the rest:
    // both are absences rather than zeros, and the arm at a cut nobody reported is a mean over none.
    const partial = row(1, 1, 1, [1]);
    const score = armScore([partial], (r) => r.retrieval['at10'] ?? null);
    expect(score.rows).toBe(0);
    expect(armScore([partial], (r) => r.retrieval['at1'] ?? null).recall).toBe(1);
  });

  it('is a mean over none rather than NaN when nothing produced a figure', () => {
    const score = armScore([skipped(1, 'too large')], (r) => r.retrieval['at10']!);
    expect(score.rows).toBe(0);
    expect(score.precision).toBe(0);
    expect(score.f1).toBe(0);
  });
});

describe('summarisePart', () => {
  it('reports one arm per cut and the sample it averaged', () => {
    const summary = summarisePart(
      part('py', [row(1, 1, 1), skipped(2, 'too large')]),
      [1, 3, 5, 10],
    );
    expect(summary).toMatchObject({ config: 'py', rows: 2, measured: 1, skipped: 1 });
    expect(Object.keys(summary.retrieval)).toEqual(['at1', 'at3', 'at5', 'at10']);
    expect(summary.retrieval['at1']!.recall).toBe(1);
    expect(summary.answer?.f1).toBe(1);
  });

  it('reports a cut as a mean over none when no row carried it', () => {
    // The same absence as above, reached through the aggregation the log line and the artifact read.
    const summary = summarisePart(part('py', [row(1, 1, 1, [1])]), [1, 3]);
    expect(summary.retrieval['at1']!.rows).toBe(1);
    expect(summary.retrieval['at3']!.rows).toBe(0);
    expect(
      combineParts([part('py', [row(1, 1, 1, [1])])], [1, 3]).overall.retrieval['at3']!.rows,
    ).toBe(0);
  });

  it('says the answer arm did not run instead of reporting a zero for it', () => {
    const summary = summarisePart(part('kt', [row(1, 1, 1)], false), [1, 3, 5, 10]);
    expect(summary.answer).toBeNull();
  });
});

describe('combineParts', () => {
  it('averages over the pooled rows, not over the per-language means', () => {
    // One Python instance and two Java ones at a perfect precision: the mean over rows is 2.5/3, and the mean of the
    // two language means - the figure this module exists to avoid - would be 0.75.
    const combined = combineParts(
      [part('py', [row(1, 0.5, 0.5)]), part('java', [row(2, 1, 1), row(3, 1, 1)])],
      [1, 3, 5, 10],
    );
    expect(combined.overall.retrieval['at10']!.precision).toBe(0.8333);
    expect(combined.overall.retrieval['at10']!.rows).toBe(3);
    expect(combined.byLanguage['py']!.retrieval['at10']!.precision).toBe(0.5);
  });

  it('counts the instances each part examined and refused', () => {
    const combined = combineParts(
      [part('py', [row(1, 1, 1), skipped(2, 'too large')]), part('java', [skipped(3, 'no room')])],
      [1, 3, 5, 10],
    );
    expect(combined.overall).toMatchObject({ rows: 3, measured: 1, skipped: 2 });
    expect(combined.byLanguage['java']).toMatchObject({ rows: 1, measured: 0, skipped: 1 });
  });

  it('reports the answer arm when at least one part ran it', () => {
    const combined = combineParts(
      [part('py', [row(1, 1, 1)], true), part('java', [row(2, 0, 0)], false)],
      [1, 3, 5, 10],
    );
    // The Java row carries an answer of its own, but the part says the arm did not run: the pooled arm is over the
    // instances that were *asked*, which is the Python one.
    expect(combined.overall.answer?.rows).toBe(1);
  });

  it('reports no answer arm at all when no part ran it', () => {
    const combined = combineParts([part('py', [row(1, 1, 1)], false)], [1, 3, 5, 10]);
    expect(combined.overall.answer).toBeNull();
  });

  it('is the part itself when one part is all there is', () => {
    const single = combineParts([part('py', [row(1, 0.4, 0.2)])], [1, 3, 5, 10]);
    expect(single.overall.retrieval['at10']).toEqual(
      summarisePart(part('py', [row(1, 0.4, 0.2)]), [1, 3, 5, 10]).retrieval['at10'],
    );
  });
});

describe('mapScore', () => {
  it('averages the column over the rows that produced a ranking', () => {
    const rows = [
      { ...row(1, 1, 1), map: 0.4 },
      { ...row(2, 0.6, 0.4), map: 0.6 },
    ];
    expect(mapScore(rows)).toEqual({ rows: 2, value: 0.5 });
  });

  it('excludes a refused row rather than counting it as a zero', () => {
    // **The two zeros are different facts**: "the runner refused this instance" and "the retriever found nothing".
    const rows = [skipped(9, 'too large'), { ...row(1, 1, 1), map: 0.8 }];
    expect(mapScore(rows)).toEqual({ rows: 1, value: 0.8 });
  });

  it('answers null when nothing was measured, because a mean over none is not a score', () => {
    expect(mapScore([skipped(9, 'too large')])).toBeNull();
    expect(mapScore([])).toBeNull();
  });
});

describe('skippedRow', () => {
  it('carries the sentence, no metrics, and a map that cannot be averaged by accident', () => {
    const refused = skippedRow({
      id: 7,
      repo: 'owner/repo',
      corpusFiles: 100,
      expectedFiles: 2,
      because: 'the analysis reached 7000 MB resident',
    });
    expect(refused).toMatchObject({
      id: 7,
      repo: 'owner/repo',
      corpusFiles: 100,
      expectedFiles: 2,
      offered: 0,
      skipped: 'the analysis reached 7000 MB resident',
      retrieval: {},
      answer: null,
    });
  });
});

describe('fitCost', () => {
  /**
   * **The bound that is still wrong, and the fit that replaces it.** Both refusals in this harness are
   * `constant × files` - a 2000-file cap and a `3.7 MB per file` estimate - and the 23 instances that produced a peak
   * showed memory per corpus file spanning 1.3 MB to 430 MB. A constant cannot be recalibrated into a model, so what
   * ships is a line fitted to the rows that ran, published with its residual.
   */
  const costRow = (
    id: number,
    corpusBytes: number | null,
    peakRssMb: number,
    elapsedMs: number,
    corpusFiles = 10,
    corpusUnreadable = 0,
  ): LcaRowScore => ({
    ...row(id, 0.5, 0.5),
    corpusFiles,
    corpusBytes,
    corpusUnreadable,
    cost: { peakRssMb, elapsedMs },
  });

  it('returns null below three rows, because a line through two points has no residual to publish', () => {
    expect(fitCost([])).toBeNull();
    expect(fitCost([costRow(1, 1_000, 500, 100), costRow(2, 2_000, 900, 200)])).toBeNull();
  });

  it('recovers the line it was given, exactly', () => {
    // **The regression has to be checkable by hand**, or a defect in it is invisible: 1000 bytes → 600 MB,
    // 3000 bytes → 1400 MB, 5000 bytes → 2200 MB is `200 + 0.4 × bytes`, and every one of the three is on it.
    const fit = fitCost([
      costRow(1, 1_000, 600, 1_000),
      costRow(2, 3_000, 1_400, 3_000),
      costRow(3, 5_000, 2_200, 5_000),
    ]);
    expect(fit).not.toBeNull();
    expect(fit!.rows).toBe(3);
    expect(fit!.interceptMb).toBeCloseTo(200, 6);
    expect(fit!.mbPerByte).toBeCloseTo(0.4, 6);
    expect(fit!.meanResidualMb).toBeCloseTo(0, 6);
    expect(fit!.maxResidualMb).toBeCloseTo(0, 6);
  });

  it('publishes the residual of a point the line misses', () => {
    // **The worst miss is the number that says whether the ceiling can be trusted**, so it is asserted as a number
    // rather than described: the same line as above, with one instance that costs 400 MB more than it predicts.
    const fit = fitCost([
      costRow(1, 1_000, 600, 1_000),
      costRow(2, 3_000, 1_800, 3_000),
      costRow(3, 5_000, 2_200, 5_000),
    ]);
    // The line through four of the six points is `333.33 + 0.4 × bytes`, so the displaced instance misses by
    // `1800 - (333.33 + 1200) = 266.67` - asserted as a number rather than recomputed from the fit, which would make
    // the test agree with whatever the fit did.
    expect(fit!.maxResidualMb).toBeCloseTo(266.666_667, 5);
  });

  it('skips a row with no byte count, no cost, or a byte count missing files', () => {
    const fit = fitCost([
      costRow(1, 1_000, 600, 1_000),
      costRow(2, 3_000, 1_400, 3_000),
      costRow(3, 5_000, 2_200, 5_000),
      // A row that never got as far as counting its bytes.
      costRow(4, null, 9_000, 9_000),
      // A row whose byte count is short by a file that vanished, so it cannot be compared with a cost paid in full.
      costRow(5, 7_000, 3_000, 7_000, 10, 1),
      // A row that was refused before the spawn and never cost anything.
      { ...costRow(6, 9_000, 0, 0), cost: null },
    ]);
    expect(fit!.rows).toBe(3);
    expect(fit!.mbPerByte).toBeCloseTo(0.4, 6);
  });

  it('refuses to fit a stopped instance, because its cost is the bound that stopped it', () => {
    // **A censored observation is not a data point.** `airbnb/lottie-android` was killed at the 6 144 MB ceiling, so
    // its `peakRssMb` is the ceiling rather than its cost; `microsoft/deepspeed` was stopped at the 900 s clock, so its
    // `elapsedMs` is the clock. Fitting a line through either would pull the slope towards the bound by exactly the
    // amount the bound clipped, and the bound would then be chosen from a line that agreed with itself.
    const fit = fitCost([
      costRow(1, 1_000, 600, 1_000),
      costRow(2, 3_000, 1_400, 3_000),
      costRow(3, 5_000, 2_200, 5_000),
      { ...costRow(4, 7_000, 6_145, 900_000), skipped: 'reached 6145 MB resident' },
    ]);
    expect(fit!.rows).toBe(3);
    expect(fit!.mbPerByte).toBeCloseTo(0.4, 6);
    // 2 200 MB over ten corpus files, and **not** the stopped instance's 6 145 over ten.
    expect(fit!.mbPerFile.max).toBeCloseTo(220, 6);
  });

  it('returns null when every instance read the same number of bytes, because a vertical line has no slope', () => {
    expect(
      fitCost([
        costRow(1, 1_000, 600, 1_000),
        costRow(2, 1_000, 900, 2_000),
        costRow(3, 1_000, 1_200, 3_000),
      ]),
    ).toBeNull();
  });

  it('publishes the spread a constant cannot express, and averages the two middles of an even sample', () => {
    // Four instances: 100, 300, 600 and 1000 MB for ten files each, so the median is (30 + 60) / 2 = 45.
    const fit = fitCost([
      costRow(1, 1_000, 100, 100),
      costRow(2, 2_000, 300, 200),
      costRow(3, 3_000, 600, 300),
      costRow(4, 4_000, 1_000, 400),
    ]);
    expect(fit!.mbPerFile.min).toBeCloseTo(10, 6);
    expect(fit!.mbPerFile.max).toBeCloseTo(100, 6);
    expect(fit!.mbPerFile.median).toBeCloseTo(45, 6);
    // The clock gets the same three figures, because it is fitted against the same variable.
    expect(fit!.msPerFile.min).toBeCloseTo(10, 6);
    expect(fit!.msPerFile.median).toBeCloseTo(25, 6);
    expect(fit!.msPerFile.max).toBeCloseTo(40, 6);
  });

  it('does not divide by a corpus of zero files', () => {
    // A checkout whose answer space is empty still costs the runtime. The ratio must not be an infinity - a reader
    // compares this column against 3.7 - so a zero-file corpus degenerates to the resident set itself.
    const fit = fitCost([
      costRow(1, 1_000, 500, 100, 0),
      costRow(2, 2_000, 600, 300, 0),
      costRow(3, 3_000, 700, 500, 0),
    ]);
    expect(fit!.mbPerFile.min).toBe(500);
    expect(fit!.mbPerFile.max).toBe(700);
  });
});

describe('costModels', () => {
  const withBytes = (
    id: number,
    corpusBytes: number,
    checkoutBytes: number,
    peakRssMb: number,
  ): LcaRowScore => ({
    ...row(id, 0.5, 0.5),
    corpusBytes,
    checkoutBytes,
    cost: { peakRssMb, elapsedMs: 1_000 },
  });

  it('recommends the predictor that explains more, and says which one that is', () => {
    // **Two predictors, one decision, and the decision is arithmetic.** The answer space is unrelated to the cost here
    // and the checkout is proportional to it, so the checkout has to win - which is what the real instances did when
    // `appium/appium` cost three gigabytes for a hundred and twenty-two kilobytes of Java.
    const rows = [
      withBytes(1, 9_000, 1_000, 500),
      withBytes(2, 1_000, 2_000, 1_000),
      withBytes(3, 5_000, 3_000, 1_500),
    ];
    const models = costModels(rows);
    expect(models.recommended!.predictor).toBe('checkoutBytes');
    expect(models.recommended!.r2).toBeGreaterThan(models.byAnswerSpace!.r2);
  });

  it('prefers the mechanistic predictor when it ties, because the graph is the thing memory holds', () => {
    // Three predictors over rows where the node count is exactly proportional to the cost: the graph has to win, and it
    // has to win on `R²` rather than on being listed last.
    const rows = [
      { ...withBytes(1, 1_000, 1_000, 500), graphNodes: 1_000 },
      { ...withBytes(2, 2_000, 2_000, 1_000), graphNodes: 2_000 },
      { ...withBytes(3, 5_000, 5_000, 2_500), graphNodes: 5_000 },
    ];
    const models = costModels(rows);
    expect(models.byGraphNodes!.predictor).toBe('graphNodes');
    expect(models.byGraphNodes!.r2).toBeCloseTo(1, 6);
    expect(models.recommended!.predictor).toBe('graphNodes');
  });

  it('does not fit a graph predictor on rows that never analysed anything', () => {
    const rows = [
      withBytes(1, 1_000, 1_000, 500),
      withBytes(2, 2_000, 2_000, 1_000),
      withBytes(3, 3_000, 3_000, 1_500),
    ];
    expect(costModels(rows).byGraphNodes).toBeNull();
    // The two byte fits still stand, so the artifact is not left without a model.
    expect(costModels(rows).recommended).not.toBeNull();
  });

  it('recommends the answer space when that is the one that tracks the cost', () => {
    const rows = [
      withBytes(1, 1_000, 9_000, 500),
      withBytes(2, 2_000, 1_000, 1_000),
      withBytes(3, 3_000, 5_000, 1_500),
    ];
    expect(costModels(rows).recommended!.predictor).toBe('answerSpaceBytes');
  });

  it('still recommends the one that could be fitted when the other could not', () => {
    const rows = [
      { ...withBytes(1, 1_000, 1_000, 500), corpusUnreadable: 1 },
      withBytes(2, 2_000, 2_000, 1_000),
      withBytes(3, 3_000, 3_000, 1_500),
    ];
    const models = costModels(rows);
    expect(models.byAnswerSpace).toBeNull();
    expect(models.recommended!.predictor).toBe('checkoutBytes');
  });

  it('recommends nothing when neither could be fitted', () => {
    const models = costModels([withBytes(1, 1_000, 1_000, 500)]);
    expect(models.byAnswerSpace).toBeNull();
    expect(models.byCheckout).toBeNull();
    expect(models.recommended).toBeNull();
  });

  it('states the bar the constant it replaces scores, which is negative and therefore unreachable by a fit', () => {
    // **A least-squares line cannot score below zero on the data it was fitted to**, so a negative figure in this
    // artifact is always the *fixed* model's: `3.7 MB x corpusFiles`, evaluated rather than fitted. That is the bar,
    // and publishing it is what makes "the constant is worse than the mean" a number instead of an assertion.
    const rows = [
      withBytes(1, 1_000, 1_000, 900),
      withBytes(2, 2_000, 2_000, 100),
      withBytes(3, 3_000, 3_000, 900),
    ];
    expect(fitCost(rows)!.constantR2).toBeLessThan(0);
    expect(fitCost(rows)!.r2).toBeGreaterThanOrEqual(0);
  });

  it('reports no explanation rather than a perfect one when every instance cost the same', () => {
    const fit = fitCost([
      withBytes(1, 1_000, 1_000, 500),
      withBytes(2, 2_000, 2_000, 500),
      withBytes(3, 3_000, 3_000, 500),
    ]);
    expect(fit!.r2).toBe(0);
  });
});

/**
 * The density the file bound converts at, **published as a distribution with its denominator**.
 *
 * The defect these cases exist for is not arithmetic, it is provenance: the report stated "the sample's median of
 * 117.7" and 117.7 was the median of the 68 Java and Kotlin rows alone, computed while the Python part was still
 * running. The median of the 109 rows the artifact publishes is 164.6. **A figure whose denominator is not in the
 * artifact cannot be caught by reading the artifact**, so the denominator is now a field.
 */
describe('declarationDensity', () => {
  /** A measured row with a file count and a declaration count. **What the density is computed from.** */
  const withDensity = (id: number, corpusFiles: number, graphNodes: number): LcaRowScore => ({
    ...row(id, 0.5, 0.5),
    corpusFiles,
    graphNodes,
  });

  it('publishes the quantiles in order and the number of rows they were taken over', () => {
    const density = declarationDensity([
      withDensity(1, 10, 200),
      withDensity(2, 10, 1_000),
      withDensity(3, 10, 3_000),
      withDensity(4, 10, 60_000),
    ]);
    expect(density.rows).toBe(4);
    expect(density.min).toBe(20);
    expect(density.median).toBeGreaterThan(density.p25);
    expect(density.p90).toBeGreaterThan(density.median);
    expect(density.max).toBe(6_000);
  });

  it('**counts a refused row out of the sample rather than scoring it zero**', () => {
    // A refused row produced no declaration count, so it is not a row whose density is zero - it is a row with no
    // density, and a mean that included it would report a corpus four times sparser than the one measured.
    const density = declarationDensity([
      withDensity(1, 10, 2_000),
      { ...withDensity(2, 10, 0), skipped: 'the checkout holds 9 000 files, above the stated cap' },
    ]);
    expect(density.rows).toBe(1);
    expect(density.median).toBe(200);
  });

  it('prices every rung of the ladder, not only the one that ships', () => {
    // **The trade-off is the decision**, so it is published: a tighter rung covers more of the declarations it charges
    // for and refuses more checkouts outright.
    const rows = [withDensity(1, 10, 200), withDensity(2, 100, 20_000), withDensity(3, 900, 300)];
    const density = declarationDensity(rows, { chargedAt: 120, declarations: 240_000 });
    expect(density.ladder.map((entry) => entry.declarationsPerFile)).toEqual([
      20, 60, 120, 300, 600,
    ]);
    // The bound on this ceiling: 240 000 declarations at 120 per file is 2 000 files, which admits all three.
    expect(density.ladder.find((entry) => entry.declarationsPerFile === 120)?.files).toBe(2_000);
    expect(density.ladder.find((entry) => entry.declarationsPerFile === 120)?.refusedByBound).toBe(
      0,
    );
    // At 600 the same budget affords 400 files, so the 900-file checkout would be refused.
    expect(density.ladder.find((entry) => entry.declarationsPerFile === 600)?.files).toBe(400);
    expect(density.ladder.find((entry) => entry.declarationsPerFile === 600)?.refusedByBound).toBe(
      1,
    );
    // Coverage rises with the rung: at 20 the 100-file/20 000-declaration row is charged a tenth of what it cost, and
    // by 600 every row is covered. **That is the whole trade-off** - the same budget, one rung apart, and one of the
    // three checkouts stops being admitted.
    expect(density.ladder[0]!.covered).toBe(2);
    expect(density.ladder.at(-1)!.covered).toBe(3);
  });

  it('**states which rows its own charge covers, because the rest are the ceiling\u2019s problem**', () => {
    const rows = [withDensity(1, 10, 200), withDensity(2, 10, 60_000)];
    const density = declarationDensity(rows, { chargedAt: 120 });
    // 120 declarations per file on a 10-file checkout is 1 200: the first row is covered, the second is charged a
    // fiftieth of what it cost. **That gap is what the process ceiling catches, and it is published rather than
    // smoothed.**
    expect(density.chargedAt).toBe(120);
    expect(density.chargedAtCovered).toBe(1);
    expect(density.chargedAtMissed).toBe(1);
  });

  it('prices no ladder when the run did not publish what it had to spend', () => {
    // **A division by an absent budget is not a bound.** A part written before the model existed carries no declaration
    // figure, and the ladder says so instead of inventing one from zero.
    const density = declarationDensity([withDensity(1, 10, 200)], { chargedAt: 120 });
    expect(density.ladder.every((entry) => entry.files === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The row the artifact publishes
// ---------------------------------------------------------------------------

describe('publishedRow', () => {
  /** A measured row carrying every arm, both ladders, and the body figure the gate compares them against. */
  function loaded(): LcaRowScore {
    return {
      ...row(7, 0.5, 0.5),
      body: {
        map: 0.44,
        rank: 1,
        documents: 120,
        unreadableFiles: 0,
        bytesRead: 4096,
        durationMs: 12,
        ranked: ['a.py'],
        candidates: ['a.py', 'b.py'],
      },
      fallback: {
        map: 0.5,
        rank: 2,
        documents: 120,
        unreadableFiles: 1,
        importLines: 7,
        ranked: ['b.py'],
        candidates: ['b.py', 'a.py'],
        durationMs: 3,
        filesRead: 120,
      },
      fusion: {
        map: 0.47,
        rank: 1,
        fused: true,
        arms: ['declarations', 'file-level', 'file-body'],
        k: 10,
        weighting: 'equal',
        ranked: ['a.py', 'b.py'],
      },
      declarationMap: 0.42,
      declarationRank: 2,
      fusionByK: [
        { k: 10, map: 0.47, rank: 1 },
        { k: 60, map: 0.45, rank: 1 },
      ],
      fusionByWeighting: [
        { weighting: 'equal', map: 0.47, rank: 1 },
        { weighting: 'body-alone', map: 0.44, rank: 1 },
      ],
      rankedPaths: ['a.py', 'b.py'],
    };
  }

  it('**carries the body figure and both ladders onto the published row**', () => {
    // **The defect this case was written for.** The projection used to be a literal in the merge script, and the literal
    // had no `body` and no `fusionByWeighting`: the published artifact of 6 November carried 150 rows, none of which held
    // either, while the blocks computed from the *parts* above them were correct. The gate refused the run with
    // "0 rows carry a `body-alone` rung against 125 measured" - a whole eighty-minute measurement lost to a missing key.
    const source = loaded();
    const projected = publishedRow(source, 'py');

    expect(projected['config']).toBe('py');
    expect(projected['bodyMap']).toBe(0.44);
    expect(projected['bodyRank']).toBe(1);
    expect(projected['bodyDocuments']).toBe(120);
    expect(projected['fusionByWeighting']).toEqual(source.fusionByWeighting);
    expect(projected['fusionByK']).toEqual(source.fusionByK);
    // **And the two figures the gate compares row by row are the same numbers under the names it reads.**
    const rung = (
      projected['fusionByWeighting'] as readonly { weighting: string; map: number }[]
    ).find((at) => at.weighting === 'body-alone');
    expect(rung?.map).toBe(projected['bodyMap']);
  });

  it('**keeps an absent arm as a `null` rather than dropping the key**', () => {
    // A row with no body arm and a row whose body arm scored zero are different facts, and a projection that made the
    // first indistinguishable from the second would erase the difference the means depend on.
    const projected = publishedRow(row(8, 0.5, 0.5), 'java');
    expect('bodyMap' in projected).toBe(true);
    expect(projected['bodyMap']).toBeNull();
    expect('fusionByWeighting' in projected).toBe(true);
    expect(projected['fusionByWeighting']).toEqual([]);
  });

  it('**publishes the cut metrics and the answer figures at the addresses the documentation quotes**', () => {
    const source = loaded();
    const projected = publishedRow(source, 'kt');
    expect(projected['retrieval']).toEqual(source.retrieval);
    expect(projected['answer']).toEqual(source.answer);
    // **Every field a block above the rows is a mean of, present under the name it has on the row.** A reader
    // recomputing `fileBody.overall` from `rows[].body.map` has to find the same number of rows the block counted.
    expect(projected['map']).toBe(source.map);
    expect(projected['skipped']).toBeNull();
    expect(projected['fallbackMap']).toBe(0.5);
    expect(projected['bodyMap']).toBe(0.44);
  });
});
