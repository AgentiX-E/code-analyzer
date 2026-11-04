// The combination's own tests.
//
// **The number this module produces is the one the gate judges**, and the way it can be wrong is arithmetic rather than
// plumbing: a mean of three per-language means weights a language with two instances as heavily as one with eight, and
// that figure would be a statement about how the workflow was sharded rather than about the retriever. Every case here
// is that failure or one of its neighbours - a skipped row leaking into an average, an arm that did not run being
// averaged as a zero, a part that is absent being read as a part that scored nothing.

import { describe, expect, it } from 'vitest';

import { armScore, combineParts, mapScore, skippedRow, summarisePart } from '../lca-merge.js';

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
    offeredPaths: [],
    skipped: null,
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
