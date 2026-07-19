import { describe, it, expect } from 'vitest';
import {
  MarkdownFormatter,
  JsonFormatter,
  HtmlFormatter,
} from '../report/formatters.js';
import type { AnalysisReport } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    id: 'report-1',
    type: 'pr-review',
    title: 'Test Report',
    createdAt: '2025-01-15T10:00:00Z',
    scope: { type: 'project', projectId: 'proj-1' },
    summary: {
      overallScore: 85,
      riskLevel: 'medium',
      totalFindings: 3,
      criticalFindings: 0,
      highFindings: 1,
      mediumFindings: 2,
      lowFindings: 0,
      keyTakeaways: ['1 high severity issue found.'],
      mergeRecommendation: 'request-changes',
      mergeRationale: '1 high severity issue needs attention.',
    },
    findings: [
      {
        id: 'f-1',
        category: 'bug',
        severity: 'high',
        title: 'Null reference possible',
        description: 'A variable may be null when accessed.',
        filePath: 'src/main.ts',
        lineRange: [42, 42],
        evidence: 'const x = maybeNull.value;',
        relatedFindings: [],
      },
      {
        id: 'f-2',
        category: 'maintainability',
        severity: 'medium',
        title: 'Function too long',
        description: 'Function exceeds recommended length.',
        filePath: 'src/utils.ts',
        lineRange: [10, 80],
        evidence: 'function process() { ... }',
        relatedFindings: [],
      },
    ],
    recommendations: [
      {
        id: 'rec-1',
        priority: 1,
        title: 'Fix null reference',
        description: 'Add null check before accessing variable.',
        estimatedEffort: 'small',
        affectedFiles: ['src/main.ts'],
        actionItems: [{ description: 'Add null guard' }],
        risksAddressed: ['bug'],
        references: [],
      },
    ],
    metrics: {
      linesChanged: 150,
      filesChanged: 5,
      symbolsAffected: 3,
      routesAffected: 0,
      testsImpacted: 2,
      complexityDelta: 3,
      coverageDelta: -1.5,
      complianceScore: 85,
      reviewDuration: 1200,
      tokenUsage: 5000,
    },
    metadata: {
      repository: 'org/repo',
      branch: 'feat/x',
      baseBranch: 'main',
      commitSha: 'abc123def',
      author: 'dev1',
      reviewer: 'dev2',
      standardsApplied: ['typescript-coding'],
      rulesApplied: ['ts-no-any'],
      generatorVersion: '0.1.0',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Markdown Formatter
// ---------------------------------------------------------------------------

describe('MarkdownFormatter', () => {
  const formatter = new MarkdownFormatter();

  it('should have correct mime type and extension', () => {
    expect(formatter.mimeType).toBe('text/markdown');
    expect(formatter.extension).toBe('md');
  });

  it('should produce valid markdown with title', () => {
    const report = makeReport();
    const md = formatter.format(report);
    expect(md).toContain('# Test Report');
  });

  it('should include summary table', () => {
    const report = makeReport();
    const md = formatter.format(report);
    expect(md).toContain('## Summary');
    expect(md).toContain('| Overall Score |');
    expect(md).toContain('| Risk Level |');
  });

  it('should include findings section', () => {
    const report = makeReport();
    const md = formatter.format(report);
    expect(md).toContain('## Findings');
    expect(md).toContain('Null reference possible');
  });

  it('should include recommendations', () => {
    const report = makeReport();
    const md = formatter.format(report);
    expect(md).toContain('## Recommendations');
    expect(md).toContain('Fix null reference');
  });

  it('should include metrics table when metrics exist', () => {
    const report = makeReport({ metrics: { linesChanged: 100, filesChanged: 3, symbolsAffected: 0, routesAffected: 0, testsImpacted: 0, complexityDelta: 0, coverageDelta: 0, complianceScore: 90, reviewDuration: 0, tokenUsage: 0 } });
    const md = formatter.format(report);
    expect(md).toContain('## Metrics');
    expect(md).toContain('| Lines Changed |');
  });

  it('should handle empty findings', () => {
    const report = makeReport({ findings: [] });
    const md = formatter.format(report);
    // Should not crash
    const lines = md.split('\n');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('should handle empty recommendations', () => {
    const report = makeReport({ recommendations: [] });
    const md = formatter.format(report);
    expect(md).not.toContain('## Recommendations');
  });

  it('should include PR scope info when type is pr', () => {
    const report = makeReport({
      scope: { type: 'pr', prNumber: 42, baseRef: 'main', headRef: 'feature' },
    });
    const md = formatter.format(report);
    expect(md).toContain('#42');
    expect(md).toContain('(main');
    expect(md).toContain('feature');
  });

  it('should not include PR scope info for project type', () => {
    const report = makeReport({
      scope: { type: 'project', projectId: 'proj-1' },
    });
    const md = formatter.format(report);
    expect(md).not.toContain('**PR:**');
  });

  it('should render key takeaways when present', () => {
    const report = makeReport({
      summary: {
        ...makeReport().summary,
        keyTakeaways: ['Finding 1', 'Finding 2', 'Important note'],
      },
    });
    const md = formatter.format(report);
    expect(md).toContain('### Key Takeaways');
    expect(md).toContain('- Finding 1');
    expect(md).toContain('- Finding 2');
    expect(md).toContain('- Important note');
  });

  it('should not render key takeaways when empty', () => {
    const report = makeReport({
      summary: {
        ...makeReport().summary,
        keyTakeaways: [],
      },
    });
    const md = formatter.format(report);
    expect(md).not.toContain('### Key Takeaways');
  });

  it('should not include metrics section when all metrics are zero', () => {
    const report = makeReport({
      metrics: {
        linesChanged: 0,
        filesChanged: 0,
        symbolsAffected: 0,
        routesAffected: 0,
        testsImpacted: 0,
        complexityDelta: 0,
        coverageDelta: 0,
        complianceScore: 90,
        reviewDuration: 0,
        tokenUsage: 0,
      },
    });
    const md = formatter.format(report);
    expect(md).not.toContain('## Metrics');
  });

  it('should include metrics section when linesChanged > 0', () => {
    const report = makeReport({
      metrics: {
        ...makeReport().metrics,
        linesChanged: 10,
        filesChanged: 0,
      },
    });
    const md = formatter.format(report);
    expect(md).toContain('## Metrics');
  });

  it('should include metrics section when filesChanged > 0', () => {
    const report = makeReport({
      metrics: {
        ...makeReport().metrics,
        linesChanged: 0,
        filesChanged: 5,
      },
    });
    const md = formatter.format(report);
    expect(md).toContain('## Metrics');
  });

  it('should render findings with all severity levels', () => {
    const report = makeReport({
      findings: [
        { id: 'f-crit', category: 'bug', severity: 'critical', title: 'Critical bug', description: '', filePath: 'a.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-high', category: 'bug', severity: 'high', title: 'High bug', description: '', filePath: 'b.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-med', category: 'bug', severity: 'medium', title: 'Medium bug', description: '', filePath: 'c.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-low', category: 'bug', severity: 'low', title: 'Low bug', description: '', filePath: 'd.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-info', category: 'bug', severity: 'info', title: 'Info bug', description: '', filePath: 'e.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
      ],
    });
    const md = formatter.format(report);
    expect(md).toContain('Critical Severity');
    expect(md).toContain('High Severity');
    expect(md).toContain('Medium Severity');
    expect(md).toContain('Low Severity');
    expect(md).toContain('Info Severity');
  });

  it('should include standardRef in findings when present', () => {
    const report = makeReport({
      findings: [{
        id: 'f-1',
        category: 'bug',
        severity: 'high',
        title: 'Test finding',
        description: 'Description',
        filePath: 'src/test.ts',
        lineRange: [1, 1],
        evidence: 'code',
        standardRef: 'STD-001',
        relatedFindings: [],
      }],
      recommendations: [],
    });
    const md = formatter.format(report);
    expect(md).toContain('STD-001');
  });

  it('should include lineRange in findings when present', () => {
    const report = makeReport({
      findings: [{
        id: 'f-1',
        category: 'bug',
        severity: 'high',
        title: 'Test',
        description: 'Desc',
        filePath: 'src/test.ts',
        lineRange: [42, 100],
        evidence: 'code',
        relatedFindings: [],
      }],
      recommendations: [],
    });
    const md = formatter.format(report);
    expect(md).toContain('L42-L100');
  });

  it('should include finding description when present', () => {
    const report = makeReport({
      findings: [{
        id: 'f-1',
        category: 'bug',
        severity: 'high',
        title: 'Test',
        description: 'A detailed description',
        filePath: 'src/test.ts',
        lineRange: null,
        evidence: '',
        relatedFindings: [],
      }],
      recommendations: [],
    });
    const md = formatter.format(report);
    expect(md).toContain('A detailed description');
  });

  it('should format score with green emoji for high scores', () => {
    const report = makeReport({
      summary: { ...makeReport().summary, overallScore: 95 },
    });
    const md = formatter.format(report);
    expect(md).toContain('\u{1F7E2}');
  });

  it('should format score with yellow emoji for medium-high scores', () => {
    const report = makeReport({
      summary: { ...makeReport().summary, overallScore: 75 },
    });
    const md = formatter.format(report);
    expect(md).toContain('\u{1F7E1}');
  });

  it('should format score with orange emoji for medium-low scores', () => {
    const report = makeReport({
      summary: { ...makeReport().summary, overallScore: 55 },
    });
    const md = formatter.format(report);
    expect(md).toContain('\u{1F7E0}');
  });

  it('should format score with red emoji for low scores', () => {
    const report = makeReport({
      summary: { ...makeReport().summary, overallScore: 30 },
    });
    const md = formatter.format(report);
    expect(md).toContain('\u{1F534}');
  });

  it('should include merge rationale', () => {
    const report = makeReport();
    const md = formatter.format(report);
    expect(md).toContain('1 high severity issue needs attention.');
  });

  it('should handle report with description in recommendations', () => {
    const report = makeReport({
      recommendations: [{
        id: 'rec-desc',
        priority: 1,
        title: 'With Description',
        description: 'A detailed recommendation description',
        estimatedEffort: 'small',
        affectedFiles: ['a.ts'],
        actionItems: [],
        risksAddressed: [],
        references: [],
      }],
    });
    const md = formatter.format(report);
    expect(md).toContain('A detailed recommendation description');
  });
});

// ---------------------------------------------------------------------------
// JSON Formatter
// ---------------------------------------------------------------------------

describe('JsonFormatter', () => {
  const formatter = new JsonFormatter();

  it('should have correct mime type and extension', () => {
    expect(formatter.mimeType).toBe('application/json');
    expect(formatter.extension).toBe('json');
  });

  it('should produce valid JSON', () => {
    const report = makeReport();
    const json = formatter.format(report);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('report-1');
    expect(parsed.type).toBe('pr-review');
  });

  it('should include all report sections', () => {
    const report = makeReport();
    const json = formatter.format(report);
    const parsed = JSON.parse(json);
    expect(parsed.summary).toBeDefined();
    expect(parsed.findings).toBeDefined();
    expect(parsed.recommendations).toBeDefined();
    expect(parsed.metrics).toBeDefined();
    expect(parsed.metadata).toBeDefined();
  });

  it('should pretty-print with 2-space indentation', () => {
    const report = makeReport();
    const json = formatter.format(report);
    const lines = json.split('\n');
    expect(lines[1]).toMatch(/^  "/); // Second line should be indented
  });
});

// ---------------------------------------------------------------------------
// HTML Formatter
// ---------------------------------------------------------------------------

describe('HtmlFormatter', () => {
  const formatter = new HtmlFormatter();

  it('should have correct mime type and extension', () => {
    expect(formatter.mimeType).toBe('text/html');
    expect(formatter.extension).toBe('html');
  });

  it('should produce valid HTML document', () => {
    const report = makeReport();
    const html = formatter.format(report);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
  });

  it('should include report title', () => {
    const report = makeReport();
    const html = formatter.format(report);
    expect(html).toContain('<title>Test Report</title>');
    expect(html).toContain('<h1>Test Report</h1>');
  });

  it('should include summary table', () => {
    const report = makeReport();
    const html = formatter.format(report);
    expect(html).toContain('<table>');
    expect(html).toContain('Risk Level');
  });

  it('should include CSS styles', () => {
    const report = makeReport();
    const html = formatter.format(report);
    expect(html).toContain('<style>');
    expect(html).toContain('font-family');
  });

  it('should escape HTML special characters', () => {
    const report = makeReport({
      title: 'Test <script>alert("xss")</script> Report',
      findings: [{
        id: 'f-1',
        category: 'bug',
        severity: 'high',
        title: 'XSS & Injection',
        description: 'Check for <div> tags',
        filePath: 'src/main.ts',
        lineRange: [1, 1],
        evidence: '<script>alert(1)</script>',
        relatedFindings: [],
      }],
    });
    const html = formatter.format(report);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should render key takeaways in HTML', () => {
    const report = makeReport({
      summary: {
        ...makeReport().summary,
        keyTakeaways: ['Important note 1', 'Critical finding'],
      },
    });
    const html = formatter.format(report);
    expect(html).toContain('Key Takeaways');
    expect(html).toContain('Important note 1');
    expect(html).toContain('Critical finding');
  });

  it('should not render key takeaways when empty in HTML', () => {
    const report = makeReport({
      summary: {
        ...makeReport().summary,
        keyTakeaways: [],
      },
    });
    const html = formatter.format(report);
    expect(html).not.toContain('Key Takeaways');
  });

  it('should render findings with lineRange in HTML', () => {
    const report = makeReport({
      findings: [{
        id: 'f-range',
        category: 'bug',
        severity: 'high',
        title: 'Test with range',
        description: 'Description',
        filePath: 'src/test.ts',
        lineRange: [10, 50],
        evidence: 'code',
        relatedFindings: [],
      }],
      recommendations: [],
    });
    const html = formatter.format(report);
    expect(html).toContain('L10-L50');
  });

  it('should render findings without lineRange in HTML', () => {
    const report = makeReport({
      findings: [{
        id: 'f-no-range',
        category: 'bug',
        severity: 'medium',
        title: 'No range test',
        description: 'Description',
        filePath: 'src/test.ts',
        lineRange: null,
        evidence: '',
        relatedFindings: [],
      }],
      recommendations: [],
    });
    const html = formatter.format(report);
    expect(html).toContain('No range test');
    expect(html).not.toContain('Lines:');
  });

  it('should render recommendations with description in HTML', () => {
    const report = makeReport({
      recommendations: [{
        id: 'rec-desc',
        priority: 1,
        title: 'With Desc',
        description: 'HTML recommendation description text',
        estimatedEffort: 'medium',
        affectedFiles: ['a.ts'],
        actionItems: [{ description: 'Action 1', file: 'a.ts' }, { description: 'Action 2' }],
        risksAddressed: ['bug'],
        references: [],
      }],
    });
    const html = formatter.format(report);
    expect(html).toContain('HTML recommendation description text');
    expect(html).toContain('Action 1');
    expect(html).toContain('Action 2');
  });

  it('should render recommendations without description in HTML', () => {
    const report = makeReport({
      recommendations: [{
        id: 'rec-no-desc',
        priority: 1,
        title: 'No Desc',
        description: '',
        estimatedEffort: 'small',
        affectedFiles: ['a.ts'],
        actionItems: [],
        risksAddressed: [],
        references: [],
      }],
    });
    const html = formatter.format(report);
    expect(html).toContain('No Desc');
  });

  it('should render footer in HTML', () => {
    const report = makeReport();
    const html = formatter.format(report);
    expect(html).toContain('Generated by Code Analyzer');
    expect(html).toContain('footer');
  });

  it('should render all severity levels as HTML', () => {
    const report = makeReport({
      findings: [
        { id: 'f-1', category: 'bug', severity: 'critical', title: 'Crit', description: '', filePath: 'a.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-2', category: 'bug', severity: 'high', title: 'High', description: '', filePath: 'b.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-3', category: 'bug', severity: 'medium', title: 'Med', description: '', filePath: 'c.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-4', category: 'bug', severity: 'low', title: 'Low', description: '', filePath: 'd.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
        { id: 'f-5', category: 'bug', severity: 'info', title: 'Info', description: '', filePath: 'e.ts', lineRange: [1, 1], evidence: '', relatedFindings: [] },
      ],
      recommendations: [],
    });
    const html = formatter.format(report);
    expect(html).toContain('severity-critical');
    expect(html).toContain('severity-high');
    expect(html).toContain('severity-medium');
    expect(html).toContain('severity-low');
    expect(html).toContain('severity-info');
  });

  it('should handle mergeRationale in HTML', () => {
    const report = makeReport();
    const html = formatter.format(report);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('1 high severity issue needs attention.');
  });

  it('should escape double quotes in HTML', () => {
    const report = makeReport({
      title: 'Test "quoted" title',
    });
    const html = formatter.format(report);
    expect(html).toContain('&quot;quoted&quot;');
  });
});
