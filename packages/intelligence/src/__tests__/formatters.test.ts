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
});
