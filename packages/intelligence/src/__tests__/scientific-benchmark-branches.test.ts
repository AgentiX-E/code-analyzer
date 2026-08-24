// @code-analyzer/intelligence — Scientific Benchmark Branch Tests
// Targets the remaining edge-case branches: McNemar case-mismatch and tie
// handling, and per-category false-negative accounting.

import { describe, it, expect } from 'vitest';
import {
  mcnemarTest,
  computeCategoryMetrics,
  type CaseResult,
  type BenchmarkCase,
  type DetectionResult,
} from '../benchmark/scientific-benchmark.js';

function makeCase(caseId: string, detections: DetectionResult[]): CaseResult {
  const tp = detections.filter((d) => d.isTruePositive).length;
  const fp = detections.length - tp;
  const fn = Math.max(0, 5 - tp);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return {
    caseId,
    repository: 'repo/a',
    languages: ['typescript'],
    loc: 100,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    durationMs: 1,
    detections,
  };
}

function tpDet(id: string): DetectionResult {
  return {
    id,
    file: 'f.ts',
    startLine: 1,
    endLine: 3,
    category: 'security',
    severity: 'high',
    isTruePositive: true,
    matchedGroundTruthId: `gt-${id}`,
  };
}

describe('mcnemarTest — case mismatch', () => {
  it('skips case IDs present in only one system', () => {
    const systemA = [makeCase('case-a', [tpDet('x1')])];
    const systemB = [makeCase('case-b', [tpDet('y1')])];

    const result = mcnemarTest(systemA, systemB);
    // No shared cases → no discordant pairs → no difference.
    expect(result.significant).toBe(false);
    expect(result.pValue).toBe(1.0);
    expect(result.effectSize).toBe('no_difference');
  });
});

describe('mcnemarTest — tie (negligible effect)', () => {
  it('reports negligible effect when systems have equal discordance', () => {
    // A detects g1 (not g2); B detects g2 (not g1) → n10 == n01 == 1.
    const systemA = [makeCase('case-1', [tpDet('g1')])];
    const systemB = [makeCase('case-1', [tpDet('g2')])];

    const result = mcnemarTest(systemA, systemB);
    expect(result.effectSize).toBe('negligible');
    expect(result.significant).toBe(false);
  });
});

describe('computeCategoryMetrics — false negatives', () => {
  it('counts ground truth with no matching detection as false negative', () => {
    const cases: BenchmarkCase[] = [
      {
        id: 'c1',
        repository: 'r',
        languages: ['ts'],
        loc: 10,
        fileCount: 1,
        groundTruth: [
          {
            id: 'gt-1',
            file: 'a.ts',
            startLine: 1,
            endLine: 2,
            category: 'security',
            severity: 'high',
            description: 'x',
            language: 'ts',
          },
          {
            id: 'gt-2',
            file: 'a.ts',
            startLine: 5,
            endLine: 6,
            category: 'performance',
            severity: 'medium',
            description: 'y',
            language: 'ts',
          },
        ],
        expectedFalsePositives: [],
        realWorld: true,
      },
    ];

    // Only gt-1 is matched; gt-2 (performance) is a false negative.
    const detections: DetectionResult[] = [
      {
        id: 'd1',
        file: 'a.ts',
        startLine: 1,
        endLine: 2,
        category: 'security',
        severity: 'high',
        isTruePositive: true,
        matchedGroundTruthId: 'gt-1',
      },
    ];

    const metrics = computeCategoryMetrics(cases, detections);
    const perf = metrics.find((m) => m.category === 'performance')!;
    expect(perf.falseNegatives).toBe(1);
    expect(perf.recall).toBe(0);
  });
});
