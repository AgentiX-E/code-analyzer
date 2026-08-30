// @code-analyzer/intelligence — Synthesis Lens Branch Tests
// Exercises the dedup skip-guard, ML severity-calibration paths, and the
// executive-summary documentation recommendation that the happy-path suite
// does not reach.

import { describe, it, expect } from 'vitest';
import { synthesizeFindings, generateSynthesisReport } from '../lenses/synthesis-lens.js';
import type { LensReport, LensFinding } from '../review-lenses.js';

function makeFinding(
  id: string,
  lens: string,
  severity: string,
  title: string,
  filePath: string,
  startLine: number,
  endLine: number,
  overrides: Partial<LensFinding> = {},
): LensFinding {
  return {
    id,
    lens: lens as any,
    category: 'security' as any,
    severity: severity as any,
    title,
    description: 'Test finding',
    evidence: {
      filePath,
      startLine,
      endLine,
      codeSnippet: 'test code',
      lens: lens as any,
    },
    autoFixable: false,
    confidence: 'rule',
    ...overrides,
  };
}

function makeReport(lens: string, name: string, findings: LensFinding[]): LensReport {
  return {
    lens: lens as any,
    name,
    findings,
    filesScanned: 1,
    linesAnalyzed: 100,
    durationMs: 10,
  };
}

describe('Synthesis Lens — branch coverage', () => {
  it('skips an already-used finding during deduplication', () => {
    // findings[0] and findings[2] overlap; findings[1] sits between them and
    // does not overlap. When the outer loop reaches findings[1], findings[2]
    // is already marked used, driving the inner `used.has(j)` skip guard.
    const f0 = makeFinding('a', 'security', 'high', 'Dup A', '/src/db.ts', 10, 12);
    const f1 = makeFinding('b', 'style', 'low', 'Unrelated', '/src/db.ts', 50, 52);
    const f2 = makeFinding('c', 'performance', 'medium', 'Dup C', '/src/db.ts', 10, 12);
    const report = makeReport('security', 'Security', [f0, f1, f2]);

    const result = synthesizeFindings([report], 100);
    // f0 + f2 collapse into one kept finding; f1 survives independently.
    expect(result.findings.length).toBe(2);
    expect(result.summary.deduplicatedCount).toBe(1);
  });

  it('downgrades a high-severity finding from a high-FP-rate lens', () => {
    // The style lens has a 0.35 FP rate (> 0.3), so a non-rule high-severity
    // finding is downgraded to medium.
    const f = makeFinding('a', 'style', 'high', 'Style Blocker', '/src/a.ts', 1, 1, {
      category: 'style' as any,
      confidence: 'llm' as any,
    });
    const report = makeReport('style', 'Style', [f]);

    const result = synthesizeFindings([report], 100);
    expect(result.findings[0]!.severity).toBe('medium');
  });

  it('downgrades a critical-severity finding from a high-FP-rate lens', () => {
    const f = makeFinding('a', 'style', 'critical', 'Style Blocker', '/src/a.ts', 1, 1, {
      category: 'maintainability' as any,
      confidence: 'heuristic' as any,
    });
    const report = makeReport('style', 'Style', [f]);

    const result = synthesizeFindings([report], 100);
    expect(result.findings[0]!.severity).toBe('high');
  });

  it('uses the default FP rate for an unknown lens', () => {
    // An unlisted lens falls back to `{}` and then to the 0.3 default FP rate,
    // which is NOT above the 0.3 downgrade threshold, so severity is preserved.
    const f = makeFinding('a', 'mystery-lens', 'high', 'Unknown Lens', '/src/a.ts', 1, 1, {
      confidence: 'llm' as any,
    });
    const report = makeReport('mystery-lens', 'Mystery', [f]);

    const result = synthesizeFindings([report], 100);
    expect(result.findings[0]!.severity).toBe('high');
  });

  it('recommends documentation improvements for docs findings', () => {
    const f = makeFinding('a', 'docs', 'low', 'Missing JSDoc', '/src/a.ts', 1, 1, {
      category: 'documentation' as any,
    });
    const report = makeReport('docs', 'Docs', [f]);

    const result = synthesizeFindings([report], 100);
    expect(result.executiveSummary.recommendedActions).toContain(
      'Improve documentation coverage for public APIs',
    );
  });

  it('emits the needs_attention assessment for a moderate health score', () => {
    // One high-severity finding (weight 10) over 200 lines yields a health
    // score of 50, landing in the [40, 70) band with no critical findings and
    // no more than five high-severity findings — the middle tier.
    const f = makeFinding('a', 'style', 'high', 'Issue', '/src/a.ts', 1, 1);
    const report = makeReport('style', 'Style', [f]);

    const result = synthesizeFindings([report], 200);
    expect(result.executiveSummary.overallAssessment).toBe('needs_attention');
  });

  it('generates a synthesis report with a healthy assessment for no findings', () => {
    const synthReport = generateSynthesisReport([], 0);
    expect(synthReport.findings).toHaveLength(1);
    expect(synthReport.findings[0]!.description).toContain('Executive Summary');
  });
});
