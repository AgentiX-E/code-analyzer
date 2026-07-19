import type {
  AnalysisReport,
  Finding,
  Recommendation,
  ReviewComment,
  ReportMetrics,
  StandardsCheckResult,
  RiskLevel,
  Severity,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Options interfaces
// ---------------------------------------------------------------------------

export interface PRReportOptions {
  projectId: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  reviewComments: ReviewComment[];
  standardsResults: StandardsCheckResult[];
  metrics: Partial<ReportMetrics>;
  repository: string;
  branch: string;
  commitSha: string;
  author: string;
}

export interface AuditReportOptions {
  projectId: string;
  findings: Finding[];
  metrics: Partial<ReportMetrics>;
  repository: string;
}

export interface StandardsReportOptions {
  projectId: string;
  standardsResults: StandardsCheckResult[];
  repository: string;
}

export interface ArchitectureReportOptions {
  projectId: string;
  findings: Finding[];
  repository: string;
}

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

const DEFAULT_METRICS: ReportMetrics = {
  linesChanged: 0,
  filesChanged: 0,
  symbolsAffected: 0,
  routesAffected: 0,
  testsImpacted: 0,
  complexityDelta: 0,
  coverageDelta: 0,
  complianceScore: 0,
  reviewDuration: 0,
  tokenUsage: 0,
};

// ---------------------------------------------------------------------------
// ReportGenerator
// ---------------------------------------------------------------------------

export class ReportGenerator {
  private idCounter = 0;

  /** Generate a unique report ID. */
  private nextId(type: string): string {
    this.idCounter++;
    return `${type}-${Date.now()}-${this.idCounter}`;
  }

  /** Generate a PR review report. */
  generatePRReport(options: PRReportOptions): AnalysisReport {
    const findings = this.convertCommentsToFindings(options.reviewComments, options.projectId);
    const severityCounts = this.countSeverities(findings);
    const mergeRecommendation = this.computeMergeRecommendation(
      severityCounts,
      options.standardsResults,
    );

    return {
      id: this.nextId('pr'),
      type: 'pr-review',
      title: `PR #${options.prNumber} Review — ${options.repository}`,
      createdAt: new Date().toISOString(),
      scope: {
        type: 'pr',
        projectId: options.projectId,
        prNumber: options.prNumber,
        baseRef: options.baseRef,
        headRef: options.headRef,
      },
      summary: {
        overallScore: this.computeOverallScore(severityCounts, options.metrics.complianceScore ?? 0),
        riskLevel: this.deriveRiskLevel(severityCounts),
        ...severityCounts,
        totalFindings: findings.length,
        keyTakeaways: this.computeKeyTakeaways(findings),
        mergeRecommendation,
        mergeRationale: this.computeMergeRationale(mergeRecommendation, severityCounts),
      },
      findings,
      recommendations: this.findingsToRecommendations(findings),
      metrics: { ...DEFAULT_METRICS, ...options.metrics },
      metadata: {
        repository: options.repository,
        branch: options.branch,
        baseBranch: options.baseRef,
        commitSha: options.commitSha,
        author: options.author,
        reviewer: '',
        standardsApplied: options.standardsResults.map((s) => s.standardId),
        rulesApplied: [],
        generatorVersion: '0.1.0',
      },
    };
  }

  /** Generate a codebase audit report. */
  generateAuditReport(options: AuditReportOptions): AnalysisReport {
    const severityCounts = this.countSeverities(options.findings);

    return {
      id: this.nextId('audit'),
      type: 'codebase-audit',
      title: `Codebase Audit — ${options.repository}`,
      createdAt: new Date().toISOString(),
      scope: { type: 'project', projectId: options.projectId },
      summary: {
        overallScore: this.computeOverallScore(severityCounts, options.metrics.complianceScore ?? 0),
        riskLevel: this.deriveRiskLevel(severityCounts),
        ...severityCounts,
        totalFindings: options.findings.length,
        keyTakeaways: this.computeKeyTakeaways(options.findings),
        mergeRecommendation: 'request-changes',
        mergeRationale: `Audit found ${severityCounts.criticalFindings} critical and ${severityCounts.highFindings} high severity issues.`,
      },
      findings: options.findings,
      recommendations: this.findingsToRecommendations(options.findings),
      metrics: { ...DEFAULT_METRICS, ...options.metrics },
      metadata: {
        repository: options.repository,
        branch: 'main',
        baseBranch: 'main',
        commitSha: '',
        author: '',
        reviewer: '',
        standardsApplied: [],
        rulesApplied: [],
        generatorVersion: '0.1.0',
      },
    };
  }

  /** Generate a standards compliance report. */
  generateStandardsReport(options: StandardsReportOptions): AnalysisReport {
    const allViolations = options.standardsResults.flatMap((sr) =>
      sr.ruleResults.flatMap((rr) => rr.violations),
    );
    const findings = this.violationsToFindings(allViolations, options.projectId);
    const severityCounts = this.countSeverities(findings);
    const avgComplianceScore =
      options.standardsResults.length > 0
        ? options.standardsResults.reduce((sum, sr) => sum + sr.complianceScore, 0) /
          options.standardsResults.length
        : 0;

    return {
      id: this.nextId('standards'),
      type: 'standards-compliance',
      title: `Standards Compliance Report — ${options.repository}`,
      createdAt: new Date().toISOString(),
      scope: { type: 'project', projectId: options.projectId },
      summary: {
        overallScore: Math.round(avgComplianceScore * 100) / 100,
        riskLevel: this.deriveRiskLevel(severityCounts),
        ...severityCounts,
        totalFindings: findings.length,
        keyTakeaways: this.computeStandardsKeyTakeaways(options.standardsResults),
        mergeRecommendation: avgComplianceScore >= 90 ? 'approve-with-comments' : 'request-changes',
        mergeRationale: `Average compliance score: ${Math.round(avgComplianceScore)}%.`,
      },
      findings,
      recommendations: this.findingsToRecommendations(findings),
      metrics: {
        ...DEFAULT_METRICS,
        complianceScore: Math.round(avgComplianceScore * 100) / 100,
      },
      metadata: {
        repository: options.repository,
        branch: 'main',
        baseBranch: 'main',
        commitSha: '',
        author: '',
        reviewer: '',
        standardsApplied: options.standardsResults.map((s) => s.standardId),
        rulesApplied: [],
        generatorVersion: '0.1.0',
      },
    };
  }

  /** Generate an architecture review report. */
  generateArchitectureReport(options: ArchitectureReportOptions): AnalysisReport {
    const severityCounts = this.countSeverities(options.findings);

    return {
      id: this.nextId('arch'),
      type: 'architecture-review',
      title: `Architecture Review — ${options.repository}`,
      createdAt: new Date().toISOString(),
      scope: { type: 'project', projectId: options.projectId },
      summary: {
        overallScore: this.computeOverallScore(severityCounts, 0),
        riskLevel: this.deriveRiskLevel(severityCounts),
        ...severityCounts,
        totalFindings: options.findings.length,
        keyTakeaways: this.computeKeyTakeaways(options.findings),
        mergeRecommendation: severityCounts.criticalFindings > 0 ? 'block' : 'request-changes',
        mergeRationale: `Architecture review found ${severityCounts.criticalFindings} critical issues.`,
      },
      findings: options.findings,
      recommendations: this.findingsToRecommendations(options.findings),
      metrics: { ...DEFAULT_METRICS },
      metadata: {
        repository: options.repository,
        branch: 'main',
        baseBranch: 'main',
        commitSha: '',
        author: '',
        reviewer: '',
        standardsApplied: [],
        rulesApplied: [],
        generatorVersion: '0.1.0',
      },
    };
  }

  // ---- Private helpers ----

  private convertCommentsToFindings(comments: ReviewComment[], projectId: string): Finding[] {
    return comments.map((c, idx) => ({
      id: `${projectId}-finding-${idx}`,
      category: c.category,
      severity: c.severity,
      title: c.content.substring(0, 80),
      description: c.content,
      filePath: c.path,
      lineRange: [c.startLine, c.endLine] as [number, number],
      evidence: c.existingCode,
      relatedFindings: [],
    }));
  }

  private violationsToFindings(violations: import('@code-analyzer/shared').Violation[], projectId: string): Finding[] {
    return violations.map((v, idx) => ({
      id: `${projectId}-violation-${idx}`,
      category: 'maintainability',
      severity: 'medium',
      title: v.message,
      description: v.message,
      filePath: v.filePath,
      lineRange: [v.lineNumber, v.lineNumber] as [number, number],
      standardRef: v.standardRef,
      evidence: v.codeSnippet,
      relatedFindings: [],
    }));
  }

  private countSeverities(findings: Finding[]): {
    criticalFindings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
  } {
    const counts = { criticalFindings: 0, highFindings: 0, mediumFindings: 0, lowFindings: 0 };
    for (const f of findings) {
      switch (f.severity) {
        case 'critical':
          counts.criticalFindings++;
          break;
        case 'high':
          counts.highFindings++;
          break;
        case 'medium':
          counts.mediumFindings++;
          break;
        case 'low':
        case 'info':
          counts.lowFindings++;
          break;
      }
    }
    return counts;
  }

  private computeMergeRecommendation(
    severityCounts: ReturnType<ReportGenerator['countSeverities']>,
    standardsResults: StandardsCheckResult[],
  ): 'approve' | 'approve-with-comments' | 'request-changes' | 'block' {
    const minCompliance = standardsResults.length > 0
      ? Math.min(...standardsResults.map((s) => s.complianceScore))
      : 100;

    if (severityCounts.criticalFindings > 0 || minCompliance < 50) return 'block';
    if (severityCounts.highFindings > 3 || minCompliance < 70) return 'request-changes';
    if (severityCounts.mediumFindings > 5 || minCompliance < 90) return 'approve-with-comments';
    return 'approve';
  }

  private computeMergeRationale(
    recommendation: string,
    severityCounts: ReturnType<ReportGenerator['countSeverities']>,
  ): string {
    switch (recommendation) {
      case 'block':
        return `Blocking: ${severityCounts.criticalFindings} critical issues must be resolved.`;
      case 'request-changes':
        return `Requesting changes: ${severityCounts.highFindings} high severity issues need attention.`;
      case 'approve-with-comments':
        return `Approved with comments: ${severityCounts.mediumFindings} minor suggestions.`;
      case 'approve':
        return 'All checks passed. Approved.';
      default:
        return '';
    }
  }

  private computeOverallScore(
    severityCounts: ReturnType<ReportGenerator['countSeverities']>,
    complianceScore: number,
  ): number {
    const maxScore = 100;
    const criticalPenalty = severityCounts.criticalFindings * 20;
    const highPenalty = severityCounts.highFindings * 10;
    const mediumPenalty = severityCounts.mediumFindings * 3;
    const lowPenalty = severityCounts.lowFindings * 1;

    const penalty = criticalPenalty + highPenalty + mediumPenalty + lowPenalty;

    if (complianceScore > 0) {
      return Math.max(0, Math.round(((complianceScore * 0.6) + (Math.max(0, maxScore - penalty) * 0.4)) * 100) / 100);
    }

    return Math.max(0, Math.round((maxScore - penalty) * 100) / 100);
  }

  private deriveRiskLevel(
    severityCounts: ReturnType<ReportGenerator['countSeverities']>,
  ): RiskLevel {
    if (severityCounts.criticalFindings > 0) return 'critical';
    if (severityCounts.highFindings > 2) return 'high';
    if (severityCounts.mediumFindings > 5) return 'medium';
    return 'low';
  }

  private computeKeyTakeaways(findings: Finding[]): string[] {
    if (findings.length === 0) return ['No issues found.'];

    const takeways: string[] = [];
    const critical = findings.filter((f) => f.severity === 'critical');
    const high = findings.filter((f) => f.severity === 'high');

    if (critical.length > 0) {
      takeways.push(`${critical.length} critical issue(s) found requiring immediate attention.`);
    }
    if (high.length > 0) {
      takeways.push(`${high.length} high severity issue(s) should be addressed before merge.`);
    }

    const categories = new Map<string, number>();
    for (const f of findings) {
      categories.set(f.category, (categories.get(f.category) ?? 0) + 1);
    }

    const topCategory = [...categories.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCategory) {
      takeways.push(`Most findings are in the "${topCategory[0]}" category (${topCategory[1]} issues).`);
    }

    if (takeways.length === 0) {
      takeways.push(`${findings.length} total finding(s).`);
    }

    return takeways;
  }

  private computeStandardsKeyTakeaways(results: StandardsCheckResult[]): string[] {
    if (results.length === 0) return ['No standards checked.'];

    const takeways: string[] = [];
    const totalFiles = results.reduce((sum, r) => sum + r.filesChecked, 0);
    const totalViolations = results.reduce(
      (sum, r) =>
        sum +
        r.summary.critical +
        r.summary.high +
        r.summary.medium +
        r.summary.low +
        r.summary.info,
      0,
    );

    takeways.push(`${results.length} standard(s) applied across ${totalFiles} file(s).`);
    takeways.push(`${totalViolations} total violation(s) found.`);

    const bestStandard = [...results].sort((a, b) => b.complianceScore - a.complianceScore)[0];
    const worstStandard = [...results].sort((a, b) => a.complianceScore - b.complianceScore)[0];

    if (bestStandard && worstStandard && results.length > 1) {
      takeways.push(
        `Best: "${bestStandard.standardId}" (${bestStandard.complianceScore}%). Worst: "${worstStandard.standardId}" (${worstStandard.complianceScore}%).`,
      );
    }

    return takeways;
  }

  private findingsToRecommendations(findings: Finding[]): Recommendation[] {
    if (findings.length === 0) return [];

    // Group by severity and category
    const groups = new Map<string, Finding[]>();
    for (const f of findings) {
      const key = `${f.severity}:${f.category}`;
      const group = groups.get(key) ?? [];
      group.push(f);
      groups.set(key, group);
    }

    return [...groups.entries()].map(([key, group], idx) => {
      const [severity, category] = key.split(':');
      const resolvedCategory = category ?? 'other';
      const severityOrder: Record<Severity, number> = { critical: 1, high: 1, medium: 2, low: 3, info: 3 };
      const priority = (severityOrder[severity as Severity] ?? 3) as 1 | 2 | 3;

      return {
        id: `rec-${idx}`,
        priority,
        title: `Address ${group.length} ${severity} ${resolvedCategory} issue(s)`,
        description: `${group.length} finding(s) in the "${resolvedCategory}" category with ${severity} severity.`,
        estimatedEffort: this.estimateEffortFromFindings(group) as 'trivial' | 'small' | 'medium' | 'large' | 'xlarge',
        affectedFiles: [...new Set(group.map((f) => f.filePath))],
        actionItems: group.map((f) => ({
          description: f.title,
          file: f.filePath,
          lineRange: f.lineRange ?? undefined,
        })),
        risksAddressed: [resolvedCategory],
        references: [],
      };
    });
  }

  private estimateEffortFromFindings(findings: Finding[]): string {
    if (findings.length <= 2) return 'trivial';
    if (findings.length <= 5) return 'small';
    if (findings.length <= 10) return 'medium';
    if (findings.length <= 20) return 'large';
    return 'xlarge';
  }
}
