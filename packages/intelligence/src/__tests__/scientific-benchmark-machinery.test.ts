// The statistical machinery, exercised.
//
// The 2026-08-17 audit's finding was precise: `scientific-benchmark.ts` has bootstrap confidence intervals and
// McNemar's paired test, "it just isn't fed a real dataset". The machinery being right and untested is its own
// risk, so these tests exercise the paths and — the part that matters — pin the property that makes a resample
// count meaningful. A count that no test observes can be wrong without anyone noticing.

import { describe, it, expect } from 'vitest';

import {
  computeBootstrapConfidenceIntervals,
  mcnemarTest,
} from '../benchmark/scientific-benchmark.js';

import type { CaseResult } from '../benchmark/scientific-benchmark.js';

/** A case with a given precision/recall, which is all these paths read. */
function caseResult(id: string, precision: number, recall: number): CaseResult {
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    caseId: id,
    repository: 'org/repo',
    languages: ['typescript'],
    loc: 100,
    truePositives: Math.round(precision * 10),
    falsePositives: Math.round((1 - precision) * 10),
    falseNegatives: Math.round((1 - recall) * 10),
    precision,
    recall,
    f1,
    durationMs: 100,
    detections: [],
  };
}

/** A true-positive detection, which is what McNemar's contingency table counts. */
function detection(id: string): CaseResult['detections'][number] {
  return {
    id,
    file: 'src/a.ts',
    startLine: 1,
    endLine: 2,
    category: 'logic',
    severity: 'high',
    isTruePositive: true,
  };
}

/** Cases whose per-case quality varies, so a resample can produce different means. */
const spread = [
  caseResult('a', 1.0, 1.0),
  caseResult('b', 0.9, 0.8),
  caseResult('c', 0.6, 0.5),
  caseResult('d', 0.2, 0.3),
  caseResult('e', 0.5, 0.4),
];

describe('computeBootstrapConfidenceIntervals', () => {
  it('returns nothing for an empty result set rather than a fabricated interval', () => {
    expect(computeBootstrapConfidenceIntervals([], 100)).toEqual([]);
  });

  it('reports the number of samples it was asked for', () => {
    const intervals = computeBootstrapConfidenceIntervals(spread, 250);

    expect(intervals).toHaveLength(3);
    expect(intervals.map((i) => i.metric)).toEqual(['precision', 'recall', 'f1']);
    // If the implementation ignores its `numSamples` argument, this is the assertion that notices.
    for (const interval of intervals) expect(interval.samples).toBe(250);
  });

  it('brackets its own point estimate on every metric', () => {
    for (const interval of computeBootstrapConfidenceIntervals(spread, 500)) {
      expect(interval.lower).toBeLessThanOrEqual(interval.estimate);
      expect(interval.estimate).toBeLessThanOrEqual(interval.upper);
    }
  });

  it('estimates the same quantity whatever the resample count', () => {
    // My first version of this test asserted that more resamples give a narrower interval. That is false, and the
    // test failed: with two samples the percentile indices degenerate to the minimum and maximum of two draws, so
    // the width is whatever those two draws happened to be. What is true, and is worth pinning, is that the point
    // estimate does not depend on the count — it estimates the same quantity either way.
    const few = computeBootstrapConfidenceIntervals(spread, 200);
    const many = computeBootstrapConfidenceIntervals(spread, 4000);

    for (let i = 0; i < few.length; i += 1) {
      expect(Math.abs(few[i]!.estimate - many[i]!.estimate)).toBeLessThan(0.02);
    }
  });

  it('collapses to a single value when asked for one sample', () => {
    // The deliberately-wrong count, asserted rather than assumed: with one resample the lower and upper bounds are
    // the same draw. A caller asking for one sample gets a degenerate interval, and saying so is better than
    // reporting it as a 95% interval.
    for (const interval of computeBootstrapConfidenceIntervals(spread, 1)) {
      expect(interval.lower).toBe(interval.upper);
    }
  });
});

describe('mcnemarTest', () => {
  // The statistic builds its contingency table from `detections`, filtering on `isTruePositive` and comparing
  // ids across the two systems — not from `truePositives` or `precision`. My first two fixtures changed the
  // derived rates and left `detections` empty, so the table saw nothing to count and the early return answered
  // p = 1. Two attempts, both wrong, both caught by the assertion; the third reads the implementation first.
  const better = spread.map((c, i) => ({ ...c, detections: [detection(`gt-${i}`)] }));
  const identical = spread.map((c) => ({ ...c, detections: [...c.detections] }));

  it('returns the mcnemar test, not the bootstrap one', () => {
    expect(mcnemarTest(spread, better).test).toBe('mcnemar');
  });

  it('finds no significance between a system and itself', () => {
    const result = mcnemarTest(spread, identical);

    expect(result.pValue).toBeGreaterThanOrEqual(0.05);
    expect(result.significant).toBe(false);
  });

  it('finds a difference when every case moves the same way', () => {
    // Ten discordant pairs in one direction and none in the other is the clearest signal the statistic can see;
    // if this returns "not significant", the contingency table is being read wrongly.
    const weak = Array.from({ length: 10 }, (_, i) => ({
      ...caseResult(`s${i}`, 0.2, 0.2),
      detections: [],
    }));
    const strong = weak.map((c, i) => ({ ...c, detections: [detection(`gt-${i}`)] }));
    const outcome = mcnemarTest(weak, strong);

    expect(outcome.pValue).toBeLessThan(0.05);
    expect(outcome.significant).toBe(true);
  });

  it('carries a p-value in the unit interval', () => {
    const result = mcnemarTest(spread, better);

    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });
});
