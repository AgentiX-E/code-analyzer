// @code-analyzer/intelligence — Synthesis Review Lens
// Hard gate: deduplication, severity calibration, consensus merge, action plan, health score.

import type { LensFinding, LensReport, EvidenceAnchor } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';

// ---------------------------------------------------------------------------
// IoU (Intersection over Union) deduplication
// ---------------------------------------------------------------------------

/** Check if two findings refer to overlapping code regions (IoU > 0.5) */
function iouOverlap(a: LensFinding, b: LensFinding): number {
  const aStart = a.evidence.startLine;
  const aEnd = a.evidence.endLine;
  const bStart = b.evidence.startLine;
  const bEnd = b.evidence.endLine;

  if (a.evidence.filePath !== b.evidence.filePath) return 0;

  const intersectStart = Math.max(aStart, bStart);
  const intersectEnd = Math.min(aEnd, bEnd);
  if (intersectStart > intersectEnd) return 0;

  const intersection = intersectEnd - intersectStart + 1;
  const union = (aEnd - aStart + 1) + (bEnd - bStart + 1) - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Deduplicate findings — merge overlapping ones, keep the higher-severity */
function deduplicate(findings: LensFinding[]): LensFinding[] {
  const severityRank: Record<string, number> = {
    critical: 4, high: 3, medium: 2, low: 1, info: 0,
  };
  const result: LensFinding[] = [];
  const used = new Set<number>();

  for (let i = 0; i < findings.length; i++) {
    if (used.has(i)) continue;
    let kept = findings[i]!;

    for (let j = i + 1; j < findings.length; j++) {
      if (used.has(j)) continue;
      const iou = iouOverlap(kept, findings[j]!);
      if (iou > 0.5) {
        // Keep the higher-severity finding
        const aSev = severityRank[kept.severity] ?? 0;
        const bSev = severityRank[findings[j]!.severity] ?? 0;
        if (bSev > aSev) kept = findings[j]!;
        used.add(j);
      }
    }
    result.push(kept);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Severity calibration
// ---------------------------------------------------------------------------

/** Upgrade severity if same issue appears in >3 files */
function calibrateSeverity(findings: LensFinding[]): LensFinding[] {
  const titleCounts = new Map<string, number>();
  for (const f of findings) {
    titleCounts.set(f.title, (titleCounts.get(f.title) ?? 0) + 1);
  }

  return findings.map(f => {
    const count = titleCounts.get(f.title) ?? 1;
    if (count > 3 && f.severity === 'low') return { ...f, severity: 'medium' as const };
    if (count > 3 && f.severity === 'medium') return { ...f, severity: 'high' as const };
    return f;
  });
}

// ---------------------------------------------------------------------------
// Health score
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 25,
  high: 10,
  medium: 3,
  low: 1,
  info: 0,
};

function computeHealthScore(findings: LensFinding[], totalLines: number): number {
  if (totalLines === 0) return 100;
  let penalty = 0;
  for (const f of findings) {
    const base = SEVERITY_WEIGHT[f.severity] ?? 1;
    // Normalize by lines analyzed
    penalty += base;
  }
  // Scale: score starts at 100, each finding reduces it
  // Max reasonable findings per 1000 lines is ~20
  const scaledPenalty = Math.min(penalty * (1000 / Math.max(totalLines, 1)), 100);
  return Math.max(0, Math.round(100 - scaledPenalty));
}

// ---------------------------------------------------------------------------
// Main synthesis
// ---------------------------------------------------------------------------

export interface SynthesisResult {
  findings: LensFinding[];
  summary: {
    totalFindings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    healthScore: number;
    lanesActive: string[];
    topIssues: Array<{ title: string; count: number; severity: string }>;
  };
  actionPlan: Array<{ priority: number; action: string; findings: string[] }>;
}

export function synthesizeFindings(
  reports: LensReport[],
  totalLinesAnalyzed: number,
): SynthesisResult {
  // Collect all findings
  let allFindings: LensFinding[] = [];
  const lanesActive: string[] = [];

  for (const report of reports) {
    if (report.findings.length > 0) lanesActive.push(report.lens);
    allFindings.push(...report.findings);
  }

  // 1. Deduplicate overlapping findings
  allFindings = deduplicate(allFindings);

  // 2. Calibrate severity based on frequency
  allFindings = calibrateSeverity(allFindings);

  // 3. Compute health score
  const healthScore = computeHealthScore(allFindings, totalLinesAnalyzed);

  // 4. Count by severity
  const critical = allFindings.filter(f => f.severity === 'critical').length;
  const high = allFindings.filter(f => f.severity === 'high').length;
  const medium = allFindings.filter(f => f.severity === 'medium').length;
  const low = allFindings.filter(f => f.severity === 'low' || f.severity === 'info').length;

  // 5. Top issues by frequency
  const titleFreq = new Map<string, { count: number; severity: string }>();
  for (const f of allFindings) {
    const existing = titleFreq.get(f.title);
    if (existing) {
      existing.count++;
      if (SEVERITY_WEIGHT[f.severity] > SEVERITY_WEIGHT[existing.severity]) {
        existing.severity = f.severity;
      }
    } else {
      titleFreq.set(f.title, { count: 1, severity: f.severity });
    }
  }
  const topIssues = Array.from(titleFreq.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([title, info]) => ({ title, count: info.count, severity: info.severity }));

  // 6. Build action plan — prioritize by severity, then frequency
  const actionPlan = buildActionPlan(allFindings, titleFreq);

  return {
    findings: allFindings,
    summary: {
      totalFindings: allFindings.length,
      critical, high, medium, low,
      healthScore,
      lanesActive,
      topIssues,
    },
    actionPlan,
  };
}

function buildActionPlan(
  findings: LensFinding[],
  titleFreq: Map<string, { count: number; severity: string }>,
): Array<{ priority: number; action: string; findings: string[] }> {
  const actions: Array<{ priority: number; action: string; findings: string[] }> = [];
  const severityOrder = ['critical', 'high', 'medium', 'low'];

  for (let priority = 0; priority < severityOrder.length; priority++) {
    const sev = severityOrder[priority]!;
    const matching = findings.filter(f => f.severity === sev);
    if (matching.length === 0) continue;

    // Group by file
    const byFile = new Map<string, LensFinding[]>();
    for (const f of matching) {
      const existing = byFile.get(f.evidence.filePath) ?? [];
      existing.push(f);
      byFile.set(f.evidence.filePath, existing);
    }

    for (const [file, fileFindings] of byFile) {
      actions.push({
        priority: priority + 1,
        action: `Fix ${fileFindings.length} ${sev}-severity issues in ${file}`,
        findings: fileFindings.map(f => f.id),
      });
    }
  }

  return actions;
}

/** Generate a synthesis lens report */
export function generateSynthesisReport(
  reports: LensReport[],
  totalLines: number,
): LensReport {
  const start = Date.now();
  const result = synthesizeFindings(reports, totalLines);

  // Convert synthesis result to a single "finding" for the report format
  const evidence: EvidenceAnchor = {
    filePath: 'SYNTHESIS',
    startLine: 1,
    endLine: 1,
    codeSnippet: JSON.stringify(result.summary, null, 2),
    lens: 'synthesis',
  };

  const finding = createLensFinding('synthesis', 'maintainability' as any, 'info',
    `Code Health Score: ${result.summary.healthScore}/100`,
    `Found ${result.summary.totalFindings} issues (${result.summary.critical} critical, ${result.summary.high} high, ${result.summary.medium} medium, ${result.summary.low} low) across ${result.summary.lanesActive.length} lanes. Health score: ${result.summary.healthScore}/100.`,
    evidence, { ruleId: 'synthesis' });

  return {
    lens: 'synthesis',
    name: 'Synthesis Lens',
    findings: finding ? [finding] : [],
    filesScanned: reports.reduce((sum, r) => sum + r.filesScanned, 0),
    linesAnalyzed: totalLines,
    durationMs: Date.now() - start,
  };
}
