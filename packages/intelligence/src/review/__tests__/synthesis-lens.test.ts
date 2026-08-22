// @code-analyzer/intelligence — Synthesis Lens Tests
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

describe('Synthesis Lens', () => {
  it('should deduplicate overlapping findings (IoU > 0.5)', () => {
    const f1 = makeFinding('a', 'security', 'high', 'SQL Injection', '/src/db.ts', 10, 12);
    const f2 = makeFinding('b', 'performance', 'medium', 'Slow Query', '/src/db.ts', 10, 12);
    const report = makeReport('security', 'Security', [f1, f2]);
    const result = synthesizeFindings([report], 100);
    expect(result.findings.length).toBeLessThan(2);
    expect(result.findings[0]!.severity).toBe('high'); // High severity wins
  });

  it('should keep higher-severity finding when deduplicating', () => {
    const f1 = makeFinding('a', 'style', 'low', 'Long Line', '/src/file.ts', 5, 5);
    const f2 = makeFinding('b', 'security', 'critical', 'Hardcoded Key', '/src/file.ts', 5, 5);
    const report = makeReport('security', 'Security', [f1, f2]);
    const result = synthesizeFindings([report], 100);
    const kept = result.findings.find((f) => f.severity === 'critical');
    expect(kept).toBeDefined();
  });

  it('should calibrate severity when same issue appears >3 times', () => {
    const findings: LensFinding[] = [];
    for (let i = 0; i < 4; i++) {
      findings.push(
        makeFinding(`f${i}`, 'style', 'low', 'Magic Numbers', `/src/file${i}.ts`, 5, 5),
      );
    }
    const report = makeReport('style', 'Style', findings);
    const result = synthesizeFindings([report], 400);
    // All 4 should be upgraded to medium
    const calibrated = result.findings.filter(
      (f) => f.severity === 'medium' && f.title === 'Magic Numbers',
    );
    expect(calibrated.length).toBe(4);
  });

  it('should compute health score correctly', () => {
    const findings: LensFinding[] = [
      makeFinding('a', 'security', 'critical', 'Issue A', '/src/a.ts', 1, 1),
      makeFinding('b', 'security', 'high', 'Issue B', '/src/b.ts', 1, 1),
      makeFinding('c', 'style', 'low', 'Issue C', '/src/c.ts', 1, 1),
    ];
    const report = makeReport('security', 'Security', findings);
    const result = synthesizeFindings([report], 1000);
    expect(result.summary.healthScore).toBeGreaterThan(0);
    expect(result.summary.healthScore).toBeLessThanOrEqual(100);
    expect(result.summary.critical).toBe(1);
    expect(result.summary.high).toBe(1);
    expect(result.summary.low).toBe(1);
  });

  it('should handle empty reports', () => {
    const result = synthesizeFindings([], 0);
    expect(result.findings).toHaveLength(0);
    expect(result.summary.totalFindings).toBe(0);
    expect(result.summary.healthScore).toBe(100);
  });

  it('should build action plan with correct priorities', () => {
    const findings: LensFinding[] = [
      makeFinding('a', 'security', 'critical', 'Critical Bug', '/src/a.ts', 1, 1),
      makeFinding('b', 'performance', 'medium', 'Slow Code', '/src/b.ts', 1, 1),
    ];
    const report = makeReport('security', 'Security', findings);
    const result = synthesizeFindings([report], 200);
    expect(result.actionPlan.length).toBeGreaterThan(0);
    // Critical issues should come first (priority 1)
    expect(result.actionPlan[0]!.priority).toBe(1);
  });

  it('should sort topIssues by frequency', () => {
    const findings: LensFinding[] = [];
    // 3 "Missing JSDoc" findings
    for (let i = 0; i < 3; i++) {
      findings.push(
        makeFinding(`js${i}`, 'docs', 'low', 'Missing JSDoc', `/src/file${i}.ts`, i + 1, i + 1),
      );
    }
    // 1 "Magic Numbers" finding
    findings.push(makeFinding('m1', 'style', 'low', 'Magic Numbers', '/src/magic.ts', 5, 5));

    const report1 = makeReport('docs', 'Docs', findings.slice(0, 3));
    const report2 = makeReport('style', 'Style', findings.slice(3));
    const result = synthesizeFindings([report1, report2], 400);
    expect(result.summary.topIssues.length).toBeGreaterThan(0);
    expect(result.summary.topIssues[0]!.title).toBe('Missing JSDoc');
    expect(result.summary.topIssues[0]!.count).toBe(3);
  });

  it('should track lanesActive', () => {
    const f1 = makeFinding('a', 'security', 'high', 'Issue', '/src/a.ts', 1, 1);
    const f2 = makeFinding('b', 'style', 'low', 'Style', '/src/b.ts', 1, 1);
    const report1 = makeReport('security', 'Security', [f1]);
    const report2 = makeReport('style', 'Style', [f2]);
    const result = synthesizeFindings([report1, report2], 200);
    expect(result.summary.lanesActive).toContain('security');
    expect(result.summary.lanesActive).toContain('style');
  });

  it('should generate a valid LensReport via generateSynthesisReport', () => {
    const f1 = makeFinding('a', 'style', 'low', 'Style Issue', '/src/a.ts', 1, 1);
    const report = makeReport('style', 'Style', [f1]);
    const synthReport = generateSynthesisReport([report], 100);
    expect(synthReport.lens).toBe('synthesis');
    expect(synthReport.name).toBe('Synthesis Lens');
    expect(synthReport.findings.length).toBe(1);
    expect(synthReport.durationMs).toBeGreaterThanOrEqual(0);
  });
});
