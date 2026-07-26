// @code-analyzer/intelligence — GitHub Check Run Manager Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { GitHubCheckRunManager } from '../github/check-run.js';
import type { CheckRunOptions } from '../github/check-run.js';
import { GitHubApiClient } from '../github/client.js';
import type { CrossRepoReviewResult } from '../cross-repo/cross-repo-pr-review.js';

function createManager(options?: Partial<CheckRunOptions>): GitHubCheckRunManager {
  const client = new GitHubApiClient({ token: 'ghp_test' });
  return new GitHubCheckRunManager({ client, ...options });
}

function mockResult(overrides: Partial<CrossRepoReviewResult> = {}): CrossRepoReviewResult {
  return {
    sourceRepo: 'org/service-a',
    prComments: [
      { id: '1', path: 'src/user.ts', content: 'User input not sanitized', existingCode: '', startLine: 42, endLine: 42, category: 'security', severity: 'high', filtered: false, createdAt: new Date().toISOString() },
      { id: '2', path: 'src/repo.ts', content: 'Loop query at line 88', existingCode: '', startLine: 88, endLine: 88, category: 'performance', severity: 'medium', filtered: false, createdAt: new Date().toISOString() },
      { id: '3', path: 'src/user.ts', content: 'Public method lacks documentation', existingCode: '', startLine: 50, endLine: 50, category: 'style', severity: 'low', filtered: false, createdAt: new Date().toISOString() },
    ],
    crossRepoImpacts: [
      { affectedRepo: 'org/service-b', affectedSymbols: ['UserService'], impactLevel: 'high', description: 'Login signature change', suggestedActions: ['Update callers'] },
    ],
    apiBreakingChanges: [
      { symbol: 'UserService.login', changeType: 'signature_changed', description: 'Parameter changed', affectedInRepos: ['org/service-b'], suggestedFix: 'Update signature' },
      { symbol: 'Config.getSecret', changeType: 'removed', description: 'Method removed', affectedInRepos: ['org/service-b'], suggestedFix: 'Use Config.getSecure instead' },
    ],
    testPredictions: [
      { repo: 'org/service-b', testFiles: ['tests/user.test.ts', 'tests/auth-e2e.test.ts'], reason: 'UserService.login changed', confidence: 'high' },
    ],
    summary: {
      sourceRepo: 'org/service-a',
      crossRepoRisk: 'medium',
      reposImpacted: 3,
      breakingChanges: 2,
      recommendations: ['Update shared-lib dependency', 'Add integration tests'],
      mergeRecommendation: 'approve-with-caution',
    },
    ...overrides,
  };
}

describe('GitHubCheckRunManager', () => {
  describe('constructor', () => {
    it('should create with default name', () => {
      expect(createManager()).toBeInstanceOf(GitHubCheckRunManager);
    });

    it('should create with custom name', () => {
      expect(createManager({ name: 'Custom Check' })).toBeInstanceOf(GitHubCheckRunManager);
    });
  });

  // -----------------------------------------------------------------------
  // formatAnnotations
  // -----------------------------------------------------------------------

  describe('formatAnnotations', () => {
    let manager: GitHubCheckRunManager;
    beforeEach(() => { manager = createManager(); });

    it('should return annotations for API breaking changes', () => {
      const annotations = manager.formatAnnotations(mockResult());
      const breaking = annotations.filter(a => a.annotation_level === 'failure');
      expect(breaking.length).toBeGreaterThanOrEqual(2);
      expect(breaking[0].message).toContain('[BREAKING]');
    });

    it('should return annotations for cross-repo impact', () => {
      const annotations = manager.formatAnnotations(mockResult());
      const impact = annotations.filter(a => a.title?.includes('Cross-Repo Impact'));
      expect(impact.length).toBeGreaterThanOrEqual(1);
    });

    it('should return annotations for review issues by severity mapping', () => {
      const annotations = manager.formatAnnotations(mockResult());
      const high = annotations.filter(a => a.title?.includes('[high]'));
      expect(high.length).toBeGreaterThanOrEqual(1);
      expect(high[0].annotation_level).toBe('failure');
    });

    it('should map medium to warning annotation level', () => {
      const annotations = manager.formatAnnotations(mockResult());
      const medium = annotations.filter(a => a.title?.includes('[medium]'));
      expect(medium.length).toBeGreaterThanOrEqual(1);
      expect(medium[0].annotation_level).toBe('warning');
    });

    it('should return annotations for test impact', () => {
      const annotations = manager.formatAnnotations(mockResult());
      const test = annotations.filter(a => a.title?.includes('Test Impact'));
      expect(test.length).toBeGreaterThanOrEqual(1);
      expect(test[0].annotation_level).toBe('notice');
    });

    it('should handle empty result gracefully', () => {
      const annotations = manager.formatAnnotations(mockResult({
        apiBreakingChanges: [], crossRepoImpacts: [], prComments: [], testPredictions: [],
      }));
      expect(annotations).toEqual([]);
    });

    it('should generate many annotations for result with many issues', () => {
      const manyComments = Array.from({ length: 60 }, (_, i) => ({
        id: `${i}`, path: `src/file${i}.ts`, content: `Issue ${i}`, existingCode: '',
        startLine: i, endLine: i, category: 'style' as const, severity: 'low' as const,
        filtered: false, createdAt: new Date().toISOString(),
      }));
      const annotations = manager.formatAnnotations(mockResult({ prComments: manyComments, apiBreakingChanges: [], crossRepoImpacts: [], testPredictions: [] }));
      expect(annotations.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // determineConclusion
  // -----------------------------------------------------------------------

  describe('determineConclusion', () => {
    let manager: GitHubCheckRunManager;
    beforeEach(() => { manager = createManager(); });

    it('should return success for approve', () => {
      expect(manager.determineConclusion(mockResult({ summary: { ...mockResult().summary, mergeRecommendation: 'approve' } }))).toBe('success');
    });

    it('should return neutral for approve-with-caution', () => {
      expect(manager.determineConclusion(mockResult({ summary: { ...mockResult().summary, mergeRecommendation: 'approve-with-caution' } }))).toBe('neutral');
    });

    it('should return failure for request-changes', () => {
      expect(manager.determineConclusion(mockResult({ summary: { ...mockResult().summary, mergeRecommendation: 'request-changes' } }))).toBe('failure');
    });

    it('should return action_required for block', () => {
      expect(manager.determineConclusion(mockResult({ summary: { ...mockResult().summary, mergeRecommendation: 'block' } }))).toBe('action_required');
    });

    it('should default to neutral for unknown', () => {
      const r = mockResult();
      r.summary.mergeRecommendation = 'unknown-status' as any;
      expect(manager.determineConclusion(r)).toBe('neutral');
    });
  });

  // -----------------------------------------------------------------------
  // formatSummary
  // -----------------------------------------------------------------------

  describe('formatSummary', () => {
    let manager: GitHubCheckRunManager;
    beforeEach(() => { manager = createManager(); });

    it('should include risk level', () => {
      const summary = manager.formatSummary(mockResult());
      expect(summary).toContain('MEDIUM');
    });

    it('should include merge recommendation', () => {
      const summary = manager.formatSummary(mockResult());
      expect(summary).toContain('approve-with-caution');
    });

    it('should include repos impacted count', () => {
      const summary = manager.formatSummary(mockResult());
      expect(summary).toContain('3');
    });

    it('should include API breaking changes section', () => {
      const summary = manager.formatSummary(mockResult());
      expect(summary).toContain('API Breaking Changes');
    });

    it('should include cross-repo impact section', () => {
      const summary = manager.formatSummary(mockResult());
      expect(summary).toContain('Cross-Repo Impact');
    });

    it('should handle empty breaking changes', () => {
      const summary = manager.formatSummary(mockResult({ apiBreakingChanges: [] }));
      expect(summary).not.toContain('API Breaking Changes');
    });
  });

  // -----------------------------------------------------------------------
  // formatDetailedText
  // -----------------------------------------------------------------------

  describe('formatDetailedText', () => {
    let manager: GitHubCheckRunManager;
    beforeEach(() => { manager = createManager(); });

    it('should include recommendations', () => {
      const text = manager.formatDetailedText(mockResult());
      expect(text).toContain('Update shared-lib dependency');
      expect(text).toContain('Add integration tests');
    });

    it('should include test impact section', () => {
      const text = manager.formatDetailedText(mockResult());
      expect(text).toContain('user.test.ts');
    });
  });
});
