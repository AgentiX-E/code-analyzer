// @ts-nocheck
// @code-analyzer/intelligence — Scientific benchmark branch coverage: empty-result
// precision/recall/f1 fallbacks, McNemar effect-size classification, and the
// chi-squared x<=0 survival branch.

import { describe, it, expect } from 'vitest';
import {
  computePrecisionRecallF1,
  computeCategoryMetrics,
  mcnemarTest,
  type CaseResult,
  type DetectionResult,
  type BenchmarkCase,
} from '../benchmark/scientific-benchmark.js';

function caseResult(caseId: string, detections: DetectionResult[] = []): CaseResult {
  return {
    caseId,
    repository: 'repo',
    languages: ['typescript'],
    loc: 100,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    durationMs: 0,
    detections,
  };
}

function tpDet(id: string): DetectionResult {
  return { id, isTruePositive: true, category: 'security', severity: 'high' } as DetectionResult;
}

describe('computePrecisionRecallF1 — empty-input fallbacks', () => {
  it('returns 0 precision/recall/f1 when there are no detections', () => {
    const r = computePrecisionRecallF1([], 0);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
    expect(r.tp).toBe(0);
    expect(r.fp).toBe(0);
    expect(r.fn).toBe(0);
  });
});

describe('mcnemarTest — effect size classification', () => {
  it('reports no_difference when both systems agree', () => {
    const a = [caseResult('c1', [tpDet('x')])];
    const b = [caseResult('c1', [tpDet('x')])];
    const r = mcnemarTest(a, b);
    expect(r.effectSize).toBe('no_difference');
  });

  it('reports negligible effect when the systems disagree symmetrically', () => {
    const a = [caseResult('c1', [tpDet('a')])];
    const b = [caseResult('c1', [tpDet('b')])];
    const r = mcnemarTest(a, b);
    expect(r.effectSize).toBe('negligible');
  });

  it('classifies small / medium / large effect sizes by disagreement rate', () => {
    const total = 10;
    const makeCases = (disagreeCount: number): CaseResult[] =>
      Array.from({ length: total }, (_, i) =>
        caseResult(`c${i}`, i < disagreeCount ? [tpDet(`d${i}`)] : []),
      );
    const empty = Array.from({ length: total }, (_, i) => caseResult(`c${i}`));

    // diff=1, total=10 -> rate=0.1 -> small
    expect(mcnemarTest(makeCases(1), empty).effectSize).toBe('small');
    // diff=2, total=10 -> rate=0.2 -> medium
    expect(mcnemarTest(makeCases(2), empty).effectSize).toBe('medium');
    // diff=3, total=10 -> rate=0.3 -> large
    expect(mcnemarTest(makeCases(3), empty).effectSize).toBe('large');
  });

  it('hits the chi-squared survival x<=0 branch for a unit disagreement', () => {
    const a = [caseResult('c1', [tpDet('a')])];
    const b = [caseResult('c1', [])];
    const r = mcnemarTest(a, b);
    // n10=1, n01=0 -> chiSquared = (|1|-1)^2 / 1 = 0 -> x<=0 -> pValue 1.0
    expect(r.pValue).toBe(1);
  });
});

describe('computeCategoryMetrics — missing detections produce fn', () => {
  it('falls back to 0 metrics for a category with ground truth but no detections', () => {
    const cases: BenchmarkCase[] = [
      {
        id: 'c1',
        repository: 'repo',
        languages: ['typescript'],
        loc: 10,
        fileCount: 1,
        realWorld: false,
        groundTruth: [
          {
            id: 'gt1',
            file: 'a.ts',
            startLine: 1,
            endLine: 2,
            category: 'security',
            severity: 'high',
            description: 'sql injection',
            language: 'typescript',
          },
        ],
        expectedFalsePositives: [],
      },
    ];
    const metrics = computeCategoryMetrics(cases, []);
    expect(metrics.length).toBe(1);
    expect(metrics[0].falseNegatives).toBe(1);
    expect(metrics[0].precision).toBe(0);
    expect(metrics[0].recall).toBe(0);
    expect(metrics[0].f1).toBe(0);
  });
});
