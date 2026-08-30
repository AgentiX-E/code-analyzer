// @ts-nocheck
// @code-analyzer/intelligence — Review Swarm Branch-Coverage Tests (2)
// Directly exercises the private `generateMCPPrompt`, `adversarialValidate`,
// and `synthesize` methods to reach the remaining uncovered branches: the
// finding-property interpolation in the MCP prompt (long code snippet,
// graph-context callers/related-tests/cross-repo refs, suggestion), the
// non-style comment-line fall-through, the docs-missing-jsdoc down-rank, and
// the request-changes decision for 4+ high-severity findings.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ReviewSwarm } from '../review/review-swarm.js';

function makeFinding(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'f1',
    lens: 'security',
    category: 'security',
    severity: 'high',
    confidence: 'rule',
    title: 'T',
    description: 'D',
    autoFixable: false,
    evidence: {
      filePath: '/src/a.ts',
      startLine: 10,
      endLine: 10,
      codeSnippet: 'eval(code)',
      lens: 'security',
    },
    ...overrides,
  };
}

function makeReport(findings: any[], lens = 'security', name = 'Security Lens'): any {
  return {
    lens,
    name,
    findings,
    filesScanned: 1,
    linesAnalyzed: 10,
    durationMs: 5,
  };
}

describe('ReviewSwarm — remaining branch coverage', () => {
  let store: InMemoryGraphStore;
  let swarm: ReviewSwarm;

  beforeEach(() => {
    store = new InMemoryGraphStore(':memory:');
    swarm = new ReviewSwarm(store, { parallel: false, minSeverity: 'info' });
  });

  describe('generateMCPPrompt — finding property interpolation', () => {
    it('renders the ellipsis, callers, and suggestion for high-confidence findings', () => {
      const longCode = 'const ' + 'x'.repeat(120) + ' = 1;';
      const finding = makeFinding({
        confidence: 'rule',
        evidence: {
          filePath: '/src/a.ts',
          startLine: 1,
          endLine: 1,
          codeSnippet: longCode,
          lens: 'security',
        },
        graphContext: {
          callers: ['callerA', 'callerB'],
          callees: [],
          relatedTests: [],
          crossRepoRefs: [],
        },
        suggestion: 'Use a shorter identifier',
      });
      const result: any = {
        lensReports: [makeReport([finding])],
        comments: [],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
          byCategory: { security: 1 },
          byLens: { security: 1 },
          filesScanned: 1,
          linesAnalyzed: 10,
          evidenceRejected: 0,
          adversarialRejected: 0,
          iouDeduped: 0,
          needsLLMValidation: 0,
        },
        decision: {
          canMerge: true,
          recommendation: 'approve',
          reason: '',
          blockingCount: 0,
          requiredCorrections: [],
        },
        actionPlan: [],
        totalDurationMs: 1,
      };

      const prompt = swarm.generateMCPPrompt(result, 'Test PR');
      expect(prompt).toContain('...'); // long codeSnippet triggers the ellipsis
      expect(prompt).toContain('Callers: callerA, callerB');
      expect(prompt).toContain('Suggested Fix: Use a shorter identifier');
    });

    it('renders related-tests, cross-repo refs, and ellipsis for heuristic findings', () => {
      const longCode = 'const ' + 'y'.repeat(150) + ' = 2;';
      const finding = makeFinding({
        lens: 'performance',
        category: 'performance',
        confidence: 'heuristic',
        evidence: {
          filePath: '/src/b.ts',
          startLine: 1,
          endLine: 1,
          codeSnippet: longCode,
          lens: 'performance',
        },
        graphContext: {
          callers: [],
          callees: [],
          relatedTests: ['testB'],
          crossRepoRefs: ['repoX'],
        },
      });
      const result: any = {
        lensReports: [makeReport([finding], 'performance', 'Performance Lens')],
        comments: [],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 1, info: 0 },
          byCategory: { performance: 1 },
          byLens: { performance: 1 },
          filesScanned: 1,
          linesAnalyzed: 10,
          evidenceRejected: 0,
          adversarialRejected: 0,
          iouDeduped: 0,
          needsLLMValidation: 1,
        },
        decision: {
          canMerge: true,
          recommendation: 'approve',
          reason: '',
          blockingCount: 0,
          requiredCorrections: [],
        },
        actionPlan: [],
        totalDurationMs: 1,
      };

      const prompt = swarm.generateMCPPrompt(result, 'Test PR');
      expect(prompt).toContain('Related Tests: testB');
      expect(prompt).toContain('Cross-Repo: repoX');
    });
  });

  describe('adversarialValidate — comment-line fall-through', () => {
    it('keeps a non-style, non-security comment-line finding as low confidence', () => {
      const finding = makeFinding({
        lens: 'docs',
        category: 'documentation',
        confidence: 'rule',
        evidence: {
          filePath: '/src/a.ts',
          startLine: 1,
          endLine: 1,
          codeSnippet: '// export function process(): void {}',
          lens: 'docs',
        },
      });
      const keep = (swarm as any).adversarialValidate(finding);
      expect(keep).toBe(true);
      expect(finding.confidence).toBe('low');
    });
  });

  describe('adversarialValidate — docs-missing-jsdoc Props down-rank', () => {
    it('down-ranks a missing-JSDoc finding on a Props interface', () => {
      const finding = makeFinding({
        lens: 'docs',
        category: 'documentation',
        severity: 'high',
        confidence: 'rule',
        evidence: {
          filePath: '/src/Button.tsx',
          startLine: 1,
          endLine: 1,
          codeSnippet: 'export interface ButtonProps { label: string }',
          lens: 'docs',
          ruleId: 'docs-missing-jsdoc',
        },
      });
      const keep = (swarm as any).adversarialValidate(finding);
      expect(keep).toBe(true);
      expect(finding.confidence).toBe('low');
    });
  });

  describe('synthesize — request-changes decision', () => {
    it('recommends request-changes for 4+ high findings with no criticals', () => {
      const findings = [10, 20, 30, 40].map((line) =>
        makeFinding({
          id: `perf-${line}`,
          lens: 'performance',
          category: 'performance',
          severity: 'high',
          confidence: 'rule',
          evidence: {
            filePath: '/src/x.ts',
            startLine: line,
            endLine: line,
            codeSnippet: 'for (let i = 0; i < n; i++) { process(arr[i]); }',
            lens: 'performance',
          },
        }),
      );
      const result = (swarm as any).synthesize([
        makeReport(findings, 'performance', 'Performance Lens'),
      ]);
      expect(result.summary.bySeverity.high).toBe(4);
      expect(result.summary.bySeverity.critical).toBe(0);
      expect(result.decision.recommendation).toBe('request-changes');
      expect(result.decision.canMerge).toBe(true);
    });
  });
});
