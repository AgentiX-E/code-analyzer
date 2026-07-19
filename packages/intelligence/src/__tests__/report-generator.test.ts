import { describe, it, expect } from 'vitest';
import { ReportGenerator } from '../report/generator.js';
import type {
  ReviewComment,
  Finding,
  StandardsCheckResult,
  RuleCheckResult,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReviewComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'rc-1',
    path: 'src/test.ts',
    content: 'Use const instead of let for immutable variables.',
    suggestionCode: 'const x = 1;',
    existingCode: 'let x = 1;',
    startLine: 10,
    endLine: 10,
    thinking: 'Variable is never reassigned.',
    category: 'maintainability',
    severity: 'medium',
    filtered: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    category: 'bug',
    severity: 'high',
    title: 'Null reference risk',
    description: 'Potential null reference on line 42.',
    filePath: 'src/main.ts',
    lineRange: [42, 42],
    evidence: 'const x = maybeNull.value;',
    relatedFindings: [],
    ...overrides,
  };
}

function makeStandardsResult(overrides: Partial<StandardsCheckResult> = {}): StandardsCheckResult {
  return {
    standardId: 'typescript-coding',
    ruleResults: [],
    complianceScore: 85,
    filesChecked: 10,
    summary: { critical: 0, high: 1, medium: 3, low: 5, info: 0, passed: 10 },
    duration: 150,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PR Report
// ---------------------------------------------------------------------------

describe('ReportGenerator — PR Report', () => {
  const generator = new ReportGenerator();

  it('should generate a PR report with basic fields', () => {
    const report = generator.generatePRReport({
      projectId: 'proj-1',
      prNumber: 42,
      baseRef: 'main',
      headRef: 'feature/x',
      reviewComments: [],
      standardsResults: [],
      metrics: { linesChanged: 50 },
      repository: 'org/repo',
      branch: 'feature/x',
      commitSha: 'abc123',
      author: 'dev',
    });

    expect(report.type).toBe('pr-review');
    expect(report.scope.type).toBe('pr');
    expect(report.scope.prNumber).toBe(42);
    expect(report.metadata.repository).toBe('org/repo');
    expect(report.metadata.commitSha).toBe('abc123');
    expect(report.metrics.linesChanged).toBe(50);
  });

  it('should convert review comments to findings', () => {
    const comments = [
      makeReviewComment({ severity: 'high', category: 'bug', content: 'Potential bug' }),
      makeReviewComment({ id: 'rc-2', severity: 'critical', category: 'security', content: 'SQL injection' }),
    ];

    const report = generator.generatePRReport({
      projectId: 'proj-1',
      prNumber: 1,
      baseRef: 'main',
      headRef: 'feat',
      reviewComments: comments,
      standardsResults: [],
      metrics: {},
      repository: 'org/repo',
      branch: 'feat',
      commitSha: 'sha',
      author: 'dev',
    });

    expect(report.findings).toHaveLength(2);
    expect(report.summary.totalFindings).toBe(2);
    expect(report.summary.criticalFindings).toBe(1);
    expect(report.summary.highFindings).toBe(1);
  });

  it('should compute merge recommendation as block for critical findings', () => {
    const comments = [makeReviewComment({ severity: 'critical', category: 'security' })];
    const report = generator.generatePRReport({
      projectId: 'proj-1',
      prNumber: 1,
      baseRef: 'main',
      headRef: 'feat',
      reviewComments: comments,
      standardsResults: [],
      metrics: {},
      repository: 'org/repo',
      branch: 'feat',
      commitSha: 'sha',
      author: 'dev',
    });

    expect(report.summary.mergeRecommendation).toBe('block');
  });

  it('should compute merge recommendation as approve for clean PR', () => {
    const report = generator.generatePRReport({
      projectId: 'proj-1',
      prNumber: 1,
      baseRef: 'main',
      headRef: 'feat',
      reviewComments: [],
      standardsResults: [],
      metrics: {},
      repository: 'org/repo',
      branch: 'feat',
      commitSha: 'sha',
      author: 'dev',
    });

    expect(report.summary.mergeRecommendation).toBe('approve');
  });

  it('should include standards applied in metadata', () => {
    const report = generator.generatePRReport({
      projectId: 'proj-1',
      prNumber: 1,
      baseRef: 'main',
      headRef: 'feat',
      reviewComments: [],
      standardsResults: [makeStandardsResult()],
      metrics: {},
      repository: 'org/repo',
      branch: 'feat',
      commitSha: 'sha',
      author: 'dev',
    });

    expect(report.metadata.standardsApplied).toContain('typescript-coding');
  });

  it('should generate uniquely IDed reports', () => {
    const opts = {
      projectId: 'proj-1',
      prNumber: 1,
      baseRef: 'main',
      headRef: 'feat',
      reviewComments: [],
      standardsResults: [],
      metrics: {},
      repository: 'org/repo',
      branch: 'feat',
      commitSha: 'sha',
      author: 'dev',
    };

    const r1 = generator.generatePRReport(opts);
    const r2 = generator.generatePRReport(opts);

    expect(r1.id).not.toBe(r2.id);
  });
});

// ---------------------------------------------------------------------------
// Audit Report
// ---------------------------------------------------------------------------

describe('ReportGenerator — Audit Report', () => {
  const generator = new ReportGenerator();

  it('should generate an audit report', () => {
    const findings = [
      makeFinding({ severity: 'critical', category: 'security' }),
      makeFinding({ id: 'f-2', severity: 'high', category: 'performance' }),
      makeFinding({ id: 'f-3', severity: 'medium', category: 'maintainability' }),
    ];

    const report = generator.generateAuditReport({
      projectId: 'proj-1',
      findings,
      metrics: { complexityDelta: 5 },
      repository: 'org/repo',
    });

    expect(report.type).toBe('codebase-audit');
    expect(report.findings).toHaveLength(3);
    expect(report.summary.criticalFindings).toBe(1);
    expect(report.summary.highFindings).toBe(1);
    expect(report.summary.mediumFindings).toBe(1);
    expect(report.metrics.complexityDelta).toBe(5);
  });

  it('should set merge recommendation to request-changes for audit', () => {
    const report = generator.generateAuditReport({
      projectId: 'proj-1',
      findings: [makeFinding({ severity: 'low' })],
      metrics: {},
      repository: 'org/repo',
    });

    expect(report.summary.mergeRecommendation).toBe('request-changes');
  });

  it('should include key takeaways', () => {
    const report = generator.generateAuditReport({
      projectId: 'proj-1',
      findings: [makeFinding({ severity: 'critical', category: 'security' })],
      metrics: {},
      repository: 'org/repo',
    });

    expect(report.summary.keyTakeaways.length).toBeGreaterThan(0);
    expect(report.summary.keyTakeaways.some((t) => t.includes('critical'))).toBe(true);
  });

  it('should handle empty findings', () => {
    const report = generator.generateAuditReport({
      projectId: 'proj-1',
      findings: [],
      metrics: {},
      repository: 'org/repo',
    });

    expect(report.findings).toHaveLength(0);
    expect(report.summary.totalFindings).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Standards Report
// ---------------------------------------------------------------------------

describe('ReportGenerator — Standards Report', () => {
  const generator = new ReportGenerator();

  it('should generate a standards compliance report', () => {
    const standardsResults = [makeStandardsResult()];

    const report = generator.generateStandardsReport({
      projectId: 'proj-1',
      standardsResults,
      repository: 'org/repo',
    });

    expect(report.type).toBe('standards-compliance');
    expect(report.metrics.complianceScore).toBe(85);
    expect(report.metadata.standardsApplied).toContain('typescript-coding');
  });

  it('should compute average compliance score from multiple standards', () => {
    const results = [
      makeStandardsResult({ standardId: 'std-1', complianceScore: 100 }),
      makeStandardsResult({ standardId: 'std-2', complianceScore: 60 }),
    ];

    const report = generator.generateStandardsReport({
      projectId: 'proj-1',
      standardsResults: results,
      repository: 'org/repo',
    });

    expect(report.metrics.complianceScore).toBe(80);
    expect(report.summary.overallScore).toBe(80);
  });

  it('should approve with comments for high compliance scores', () => {
    const results = [makeStandardsResult({ complianceScore: 95 })];

    const report = generator.generateStandardsReport({
      projectId: 'proj-1',
      standardsResults: results,
      repository: 'org/repo',
    });

    expect(report.summary.mergeRecommendation).toBe('approve-with-comments');
  });

  it('should request changes for low compliance scores', () => {
    const results = [makeStandardsResult({ complianceScore: 50 })];

    const report = generator.generateStandardsReport({
      projectId: 'proj-1',
      standardsResults: results,
      repository: 'org/repo',
    });

    expect(report.summary.mergeRecommendation).toBe('request-changes');
  });

  it('should convert violations to findings', () => {
    const ruleResult: RuleCheckResult = {
      ruleId: 'ts-no-console-log',
      ruleDescription: 'No console.log',
      passed: false,
      severity: 'low',
      autoFixable: true,
      violations: [
        {
          filePath: 'src/app.ts',
          lineNumber: 10,
          message: 'No console.log',
          codeSnippet: 'console.log("debug");',
          standardRef: 'ts-no-console-log',
        },
        {
          filePath: 'src/util.ts',
          lineNumber: 5,
          message: 'No console.log',
          codeSnippet: 'console.log("test");',
          standardRef: 'ts-no-console-log',
        },
      ],
    };

    const results = [
      makeStandardsResult({ ruleResults: [ruleResult] }),
    ];

    const report = generator.generateStandardsReport({
      projectId: 'proj-1',
      standardsResults: results,
      repository: 'org/repo',
    });

    expect(report.findings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Architecture Report
// ---------------------------------------------------------------------------

describe('ReportGenerator — Architecture Report', () => {
  const generator = new ReportGenerator();

  it('should generate an architecture review report', () => {
    const findings = [makeFinding({ category: 'architecture', severity: 'critical' })];
    const report = generator.generateArchitectureReport({
      projectId: 'proj-1',
      findings,
      repository: 'org/repo',
    });

    expect(report.type).toBe('architecture-review');
    expect(report.summary.mergeRecommendation).toBe('block');
  });

  it('should set request-changes when no critical architecture findings', () => {
    const findings = [makeFinding({ category: 'architecture', severity: 'high' })];
    const report = generator.generateArchitectureReport({
      projectId: 'proj-1',
      findings,
      repository: 'org/repo',
    });

    expect(report.summary.mergeRecommendation).toBe('request-changes');
  });

  it('should include risk level in summary', () => {
    const findings = [makeFinding({ severity: 'critical' }), makeFinding({ id: 'f-2', severity: 'high' })];
    const report = generator.generateArchitectureReport({
      projectId: 'proj-1',
      findings,
      repository: 'org/repo',
    });

    expect(report.summary.riskLevel).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// Merge recommendation scoring
// ---------------------------------------------------------------------------

describe('ReportGenerator — merge recommendation', () => {
  const generator = new ReportGenerator();

  it('should block for critical findings', () => {
    const report = generator.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'main', headRef: 'feat',
      reviewComments: [makeReviewComment({ severity: 'critical' })],
      standardsResults: [],
      metrics: {},
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });
    expect(report.summary.mergeRecommendation).toBe('block');
  });

  it('should request changes for multiple high findings', () => {
    const comments = Array(5).fill(null).map((_, i) =>
      makeReviewComment({ id: `rc-${i}`, severity: 'high' }));
    const report = generator.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'main', headRef: 'feat',
      reviewComments: comments,
      standardsResults: [],
      metrics: {},
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });
    expect(report.summary.mergeRecommendation).toBe('request-changes');
  });

  it('should approve with comments for medium findings', () => {
    const comments = Array(6).fill(null).map((_, i) =>
      makeReviewComment({ id: `rc-${i}`, severity: 'medium' }));
    const report = generator.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'main', headRef: 'feat',
      reviewComments: comments,
      standardsResults: [],
      metrics: {},
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });
    expect(report.summary.mergeRecommendation).toBe('approve-with-comments');
  });

  it('should approve clean PRs', () => {
    const report = generator.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'main', headRef: 'feat',
      reviewComments: [],
      standardsResults: [],
      metrics: {},
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });
    expect(report.summary.mergeRecommendation).toBe('approve');
    expect(report.summary.mergeRationale).toContain('Approved');
    expect(report.summary.keyTakeaways).toContain('No issues found.');
  });
});

// ---------------------------------------------------------------------------
// Overall score computation
// ---------------------------------------------------------------------------

describe('ReportGenerator — overall scoring', () => {
  const generator = new ReportGenerator();

  it('should compute lower score for critical findings', () => {
    const r1 = generator.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'm', headRef: 'f',
      reviewComments: [makeReviewComment({ severity: 'critical' })],
      standardsResults: [],
      metrics: {},
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });

    const r2 = generator.generatePRReport({
      projectId: 'p', prNumber: 2, baseRef: 'm', headRef: 'f',
      reviewComments: [makeReviewComment({ severity: 'low' })],
      standardsResults: [],
      metrics: {},
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });

    expect(r1.summary.overallScore).toBeLessThan(r2.summary.overallScore);
  });

  it('should give full score for clean report', () => {
    const report = generator.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'm', headRef: 'f',
      reviewComments: [],
      standardsResults: [],
      metrics: {},
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });
    expect(report.summary.overallScore).toBe(100);
  });

  it('should factor compliance score into overall score', () => {
    const r1 = generator.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'm', headRef: 'f',
      reviewComments: [],
      standardsResults: [makeStandardsResult({ complianceScore: 100 })],
      metrics: { complianceScore: 100 },
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });

    const r2 = generator.generatePRReport({
      projectId: 'p', prNumber: 2, baseRef: 'm', headRef: 'f',
      reviewComments: [],
      standardsResults: [makeStandardsResult({ complianceScore: 50 })],
      metrics: { complianceScore: 50 },
      repository: 'r', branch: 'b', commitSha: 's', author: 'a',
    });

    expect(r1.summary.overallScore).toBeGreaterThan(r2.summary.overallScore);
  });
});
