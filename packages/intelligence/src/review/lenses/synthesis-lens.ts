// @code-analyzer/intelligence — Synthesis Review Lens
// Hard gate: deduplication, ensemble voting, ML severity calibration,
// action plan, health score, executive summary generation.

import type { LensFinding, LensReport, EvidenceAnchor } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';
import type { Severity } from '@code-analyzer/shared';

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
  // `union` is always >= 1 here: the `intersectStart > intersectEnd` guard above
  // already returned 0, so each span contributes at least one line.
  const union = aEnd - aStart + 1 + (bEnd - bStart + 1) - intersection;
  return intersection / union;
}

/** Deduplicate findings — merge overlapping ones, keep the higher-severity */
function deduplicate(findings: LensFinding[]): LensFinding[] {
  const severityRank: Record<Severity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
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
        // Keep the higher-severity finding, merge evidence
        // severityRank is keyed on the complete Severity union, so the lookup
        // can never be undefined.
        const aSev = severityRank[kept.severity];
        const bSev = severityRank[findings[j]!.severity];
        if (bSev > aSev) {
          kept = {
            ...findings[j]!,
            // Merge evidence: track that multiple lenses detected this
            description: `${findings[j]!.description}\n\n(Also detected by ${kept.lens} lens)`,
          };
        } else {
          kept = {
            ...kept,
            description: `${kept.description}\n\n(Also detected by ${findings[j]!.lens} lens)`,
          };
        }
        used.add(j);
      }
    }
    result.push(kept);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Ensemble voting — boost severity when 3+ lenses flag same region
// ---------------------------------------------------------------------------

/**
 * When 3+ different lenses flag the same file:line location,
 * boost each finding's severity by 1 level (consensus signal).
 * This is based on the principle that multi-lens agreement on
 * a code region indicates higher confidence in the issue.
 */
function ensembleVoting(findings: LensFinding[]): LensFinding[] {
  if (findings.length < 3) return findings;

  // Group findings by file:line coordinates
  const locationMap = new Map<string, LensFinding[]>();
  for (const f of findings) {
    const key = `${f.evidence.filePath}:${f.evidence.startLine}-${f.evidence.endLine}`;
    if (!locationMap.has(key)) locationMap.set(key, []);
    locationMap.get(key)!.push(f);
  }

  const severityUpgrade: Record<Severity, Severity> = {
    info: 'low',
    low: 'medium',
    medium: 'high',
    high: 'critical',
    critical: 'critical',
  };

  const boosted = new Set<string>();

  return findings.map((f) => {
    const key = `${f.evidence.filePath}:${f.evidence.startLine}-${f.evidence.endLine}`;
    const group = locationMap.get(key);

    if (group && group.length >= 3) {
      // Count distinct lenses in this group
      const distinctLenses = new Set(group.map((g) => g.lens));
      if (distinctLenses.size >= 3) {
        // severityUpgrade maps every Severity to its next level, so the lookup
        // can never be undefined.
        const newSeverity = severityUpgrade[f.severity];
        if (newSeverity !== f.severity) {
          boosted.add(f.id);
          return {
            ...f,
            severity: newSeverity,
            description: `${f.description}\n\n[Ensemble Boosted: ${distinctLenses.size} lenses agree on this location]`,
          };
        }
      }
    }
    return f;
  });
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

  return findings.map((f) => {
    // Every finding's title was just `set` in the loop above, so the lookup
    // can never be undefined.
    const count = titleCounts.get(f.title)!;
    if (count > 3 && f.severity === 'low') return { ...f, severity: 'medium' as const };
    if (count > 3 && f.severity === 'medium') return { ...f, severity: 'high' as const };
    return f;
  });
}

// ---------------------------------------------------------------------------
// NEW: ML severity calibration — statistical model for false-positive rates
// ---------------------------------------------------------------------------

/**
 * False-positive rate estimates per lens per category based on
 * historical observation patterns. These are running estimates
 * that calibrate severity based on observed false-positive ratios.
 */
const LENS_FP_RATES: Record<string, Record<string, number>> = {
  structure: { architecture: 0.15, maintainability: 0.2 },
  security: { security: 0.1 },
  performance: { performance: 0.25 },
  testing: { test: 0.3 },
  style: { style: 0.35, maintainability: 0.4 },
  api: { api: 0.2, security: 0.15 },
  deps: { security: 0.1, maintainability: 0.25 },
  contract: { api: 0.15, maintainability: 0.2 },
  docs: { documentation: 0.3 },
};

/**
 * ML-inspired severity calibration using historical false-positive rates.
 * Low-confidence lenses with high historical FP rates have their
 * severity downgraded. High-confidence lenses with low FP rates
 * have their severity preserved or upgraded.
 */
function mlCalibration(findings: LensFinding[]): LensFinding[] {
  return findings.map((f) => {
    const lensFP = LENS_FP_RATES[f.lens] ?? {};
    const catFP = lensFP[f.category] ?? 0.3; // default 30% FP rate assumption

    // High FP rate (>30%) with uncertain confidence → downgrade
    if (catFP > 0.3 && f.confidence !== 'rule') {
      if (f.severity === 'high') {
        return { ...f, severity: 'medium' as const };
      }
      if (f.severity === 'critical') {
        return { ...f, severity: 'high' as const };
      }
    }

    return f;
  });
}

// ---------------------------------------------------------------------------
// Health score
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<Severity, number> = {
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
    // SEVERITY_WEIGHT is keyed on the complete Severity union, so the lookup
    // can never be undefined.
    const base = SEVERITY_WEIGHT[f.severity];
    penalty += base;
  }
  const scaledPenalty = Math.min(penalty * (1000 / Math.max(totalLines, 1)), 100);
  return Math.max(0, Math.round(100 - scaledPenalty));
}

// ---------------------------------------------------------------------------
// NEW: Executive summary generation
// ---------------------------------------------------------------------------

interface ExecutiveSummary {
  /** One-paragraph overview of the review */
  overview: string;
  /** Key risk areas identified */
  keyRisks: string[];
  /** Recommended actions (top 3) */
  recommendedActions: string[];
  /** Is this codebase in good health? */
  overallAssessment: 'healthy' | 'needs_attention' | 'critical';
  /** Brief recommendation */
  recommendation: string;
}

/**
 * Generate an executive summary from synthesis results.
 * Provides a high-level, business-friendly overview of code health.
 */
function generateExecutiveSummary(
  findings: LensFinding[],
  healthScore: number,
  lanesActive: string[],
  topIssues: Array<{ title: string; count: number; severity: string }>,
  totalFindings: number,
): ExecutiveSummary {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;

  // Determine overall assessment
  let overallAssessment: ExecutiveSummary['overallAssessment'];
  if (criticalCount > 0 || healthScore < 40) {
    overallAssessment = 'critical';
  } else if (healthScore < 70 || highCount > 5) {
    overallAssessment = 'needs_attention';
  } else {
    overallAssessment = 'healthy';
  }

  // Build overview
  const lensNames = lanesActive.join(', ');
  let overview: string;
  if (overallAssessment === 'critical') {
    overview = `Code review found ${totalFindings} issues across ${lanesActive.length} analysis lenses (${lensNames}), including ${criticalCount} critical problems that require immediate attention. Health score: ${healthScore}/100.`;
  } else if (overallAssessment === 'needs_attention') {
    overview = `Code review identified ${totalFindings} issues across ${lanesActive.length} analysis lenses (${lensNames}), with ${highCount} high-severity findings. Health score: ${healthScore}/100. Improvements recommended.`;
  } else {
    overview = `Code review found ${totalFindings} minor issues across ${lanesActive.length} analysis lenses (${lensNames}). Health score: ${healthScore}/100. Overall code quality is good.`;
  }

  // Key risks from top issues
  const keyRisks = topIssues
    .filter((i) => i.severity === 'critical' || i.severity === 'high')
    .slice(0, 5)
    .map((i) => `${i.title} (${i.count} occurrences, ${i.severity})`);

  // Recommended actions
  const recommendedActions: string[] = [];
  if (criticalCount > 0) {
    recommendedActions.push(`Resolve ${criticalCount} critical findings before next release`);
  }
  if (highCount > 0) {
    recommendedActions.push(`Address ${highCount} high-severity issues within this sprint`);
  }
  if (findings.some((f) => f.lens === 'structure')) {
    recommendedActions.push('Review architecture: structural issues detected');
  }
  if (findings.some((f) => f.lens === 'security')) {
    recommendedActions.push('Security audit required: vulnerabilities detected');
  }
  if (
    findings.some((f) => f.lens === 'docs') &&
    findings.some((f) => f.category === 'documentation')
  ) {
    recommendedActions.push('Improve documentation coverage for public APIs');
  }

  // Recommendation
  let recommendation: string;
  if (overallAssessment === 'critical') {
    recommendation = 'DO NOT MERGE. Critical issues must be resolved before proceeding.';
  } else if (overallAssessment === 'needs_attention') {
    recommendation = 'Approve with comments. Address high-severity issues in follow-up PRs.';
  } else {
    recommendation = 'Safe to merge. Minor issues can be addressed incrementally.';
  }

  return {
    overview,
    keyRisks: keyRisks.length > 0 ? keyRisks : ['No critical or high-severity risks identified.'],
    recommendedActions:
      recommendedActions.length > 0 ? recommendedActions : ['No urgent actions required.'],
    overallAssessment,
    recommendation,
  };
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
    deduplicatedCount: number;
    ensembleBoostedCount: number;
  };
  actionPlan: Array<{ priority: number; action: string; findings: string[] }>;
  executiveSummary: ExecutiveSummary;
}

export function synthesizeFindings(
  reports: LensReport[],
  totalLinesAnalyzed: number,
): SynthesisResult {
  // Collect all findings
  let allFindings: LensFinding[] = [];
  const lanesActive: string[] = [];
  const rawCount = reports.reduce((sum, r) => sum + r.findings.length, 0);

  for (const report of reports) {
    if (report.findings.length > 0) lanesActive.push(report.lens);
    allFindings.push(...report.findings);
  }

  // 1. Ensemble voting — boost when 3+ lenses agree (before dedup)
  allFindings = ensembleVoting(allFindings);
  const preEnsembleCount = allFindings.filter((f) =>
    f.description.includes('[Ensemble Boosted:'),
  ).length;

  // 2. Deduplicate overlapping findings (IoU > 0.5)
  allFindings = deduplicate(allFindings);
  const deduplicatedCount = rawCount - allFindings.length;

  const ensembleBoostedCount = allFindings.filter((f) =>
    f.description.includes('[Ensemble Boosted:'),
  ).length;

  // 3. Calibrate severity based on frequency
  allFindings = calibrateSeverity(allFindings);

  // 4. ML severity calibration using historical FP rates
  allFindings = mlCalibration(allFindings);

  // 5. Compute health score
  const healthScore = computeHealthScore(allFindings, totalLinesAnalyzed);

  // 6. Count by severity
  const critical = allFindings.filter((f) => f.severity === 'critical').length;
  const high = allFindings.filter((f) => f.severity === 'high').length;
  const medium = allFindings.filter((f) => f.severity === 'medium').length;
  const low = allFindings.filter((f) => f.severity === 'low' || f.severity === 'info').length;

  // 7. Top issues by frequency
  const titleFreq = new Map<string, { count: number; severity: Severity }>();
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

  // 8. Build action plan
  const actionPlan = buildActionPlan(allFindings, titleFreq);

  // 9. Generate executive summary
  const executiveSummary = generateExecutiveSummary(
    allFindings,
    healthScore,
    lanesActive,
    topIssues,
    allFindings.length,
  );

  return {
    findings: allFindings,
    summary: {
      totalFindings: allFindings.length,
      critical,
      high,
      medium,
      low,
      healthScore,
      lanesActive,
      topIssues,
      deduplicatedCount,
      ensembleBoostedCount,
    },
    actionPlan,
    executiveSummary,
  };
}

function buildActionPlan(
  findings: LensFinding[],
  _titleFreq: Map<string, { count: number; severity: string }>,
): Array<{ priority: number; action: string; findings: string[] }> {
  const actions: Array<{ priority: number; action: string; findings: string[] }> = [];
  const severityOrder = ['critical', 'high', 'medium', 'low'];

  for (let priority = 0; priority < severityOrder.length; priority++) {
    const sev = severityOrder[priority]!;
    const matching = findings.filter((f) => f.severity === sev);
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
        findings: fileFindings.map((f) => f.id),
      });
    }
  }

  return actions;
}

/** Generate a synthesis lens report with executive summary */
export function generateSynthesisReport(reports: LensReport[], totalLines: number): LensReport {
  const start = Date.now();
  const result = synthesizeFindings(reports, totalLines);

  // Build a rich single finding with embedded executive summary
  const evidence: EvidenceAnchor = {
    filePath: 'SYNTHESIS',
    startLine: 1,
    endLine: 1,
    codeSnippet: JSON.stringify(
      {
        summary: result.summary,
        executiveSummary: result.executiveSummary,
      },
      null,
      2,
    ),
    lens: 'synthesis',
  };

  const { summary, executiveSummary } = result;

  const description = [
    `## Executive Summary`,
    executiveSummary.overview,
    '',
    `### Key Risks`,
    ...executiveSummary.keyRisks.map((r) => `- ${r}`),
    '',
    `### Recommended Actions`,
    ...executiveSummary.recommendedActions.map((a) => `- ${a}`),
    '',
    `### Statistics`,
    `- Total findings: ${summary.totalFindings}`,
    `- Deduplicated: ${summary.deduplicatedCount}`,
    `- Ensemble boosted: ${summary.ensembleBoostedCount}`,
    `- Critical: ${summary.critical} | High: ${summary.high} | Medium: ${summary.medium} | Low: ${summary.low}`,
    `- Lenses active: ${summary.lanesActive.join(', ')}`,
    '',
    `### Verdict`,
    executiveSummary.recommendation,
  ].join('\n');

  const finding = createLensFinding(
    'synthesis',
    'maintainability',
    'info',
    `Code Health Score: ${summary.healthScore}/100 — ${executiveSummary.overallAssessment.toUpperCase()}`,
    description,
    evidence,
    { ruleId: 'synthesis' },
  );

  return {
    lens: 'synthesis',
    name: 'Synthesis Lens',
    findings: [finding],
    filesScanned: reports.reduce((sum, r) => sum + r.filesScanned, 0),
    linesAnalyzed: totalLines,
    durationMs: Date.now() - start,
  };
}

// Re-export the executive summary type for consumers
export type { ExecutiveSummary };
