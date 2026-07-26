// @code-analyzer/intelligence — GitHub Check Run Manager Tests

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GitHubCheckRunManager,
} from '../github/check-run.js';
import type { CheckRunOptions } from '../github/check-run.js';
import { GitHubApiClient } from '../github/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createManager(options?: Partial<CheckRunOptions>): GitHubCheckRunManager {
  const client = new GitHubApiClient({ token: 'ghp_test' });
  return new GitHubCheckRunManager({ client, ...options });
}

// Mock cross-repo review result for formatting tests
function mockReviewResult(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      riskLevel: 'medium',
      mergeRecommendation: 'approve-with-caution',
      reposImpacted: 3,
      recommendations: [
        'Update shared-lib dependency in service-a',
        'Add integration tests for cross-repo API changes',
      ],
      ...overrides.summary,
    },
    apiBreakingChanges: [
      { type: 'signature_changed', description: 'UserService.login() parameter changed', filePath: 'src/user.ts', startLine: 42, endLine: 42 },
      { type: 'removed', description: 'Config.getSecret() was removed', filePath: 'src/config.ts', startLine: 15, endLine: 15 },
    ],
    crossRepoImpact: [
      { sourceFile: 'src/user.ts', sourceLine: 42, targetRepo: 'org/service-b', description: 'UserService.login signature change affects service-b authentication' },
    ],
    dependencyCompatibility: [
      { type: 'major_mismatch', message: 'shared-lib: ^2.0.0 vs ^1.5.0', filePath: 'package.json', startLine: 12, endLine: 12 },
    ],
    reviewIssues: [
      { severity: 'high', title: 'Security: Unsanitized input', message: 'User input not sanitized at line 42', path: 'src/user.ts', startLine: 42, endLine: 42 },
      { severity: 'medium', title: 'Performance: N+1 query', message: 'Loop query at line 88', path: 'src/repo.ts', startLine: 88, endLine: 88 },
      { severity: 'low', title: 'Style: Missing JSDoc', message: 'Public method lacks documentation', path: 'src/user.ts', startLine: 50, endLine: 50 },
    ],
    testImpact: [
      { testFile: 'tests/user.test.ts', affectedSymbols: ['UserService.login'] },
      { testFile: 'tests/auth-e2e.test.ts', affectedSymbols: ['AuthMiddleware', 'UserService'] },
    ],
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('GitHubCheckRunManager', () => {
  describe('constructor', () => {
    it('should create with default name', () => {
      const manager = createManager();
      expect(manager).toBeInstanceOf(GitHubCheckRunManager);
    });

    it('should create with custom name', () => {
      const manager = createManager({ name: 'Custom Check' });
      expect(manager).toBeInstanceOf(GitHubCheckRunManager);
    });
  });

  // -----------------------------------------------------------------------
  // formatAnnotations
  // -----------------------------------------------------------------------

  describe('formatAnnotations', () => {
    let manager: GitHubCheckRunManager;

    beforeEach(() => {
      manager = createManager();
    });

    it('should return annotations for API breaking changes', () => {
      const result = mockReviewResult();
      const annotations = manager.formatAnnotations(result);

      const breakingAnnotations = annotations.filter((a) => a.annotation_level === 'failure');
      expect(breakingAnnotations.length).toBeGreaterThanOrEqual(1);
      expect(breakingAnnotations[0].message).toContain('[BREAKING]');
    });

    it('should return annotations for cross-repo impact', () => {
      const result = mockReviewResult();
      const annotations = manager.formatAnnotations(result);

      const impactAnnotations = annotations.filter(
        (a) => a.title?.includes('Cross-Repo Impact'),
      );
      expect(impactAnnotations.length).toBeGreaterThanOrEqual(1);
    });

    it('should return annotations for review issues with correct severity mapping', () => {
      const result = mockReviewResult();
      const annotations = manager.formatAnnotations(result);

      // High severity → failure
      const highAnnotations = annotations.filter(
        (a) => a.title?.includes('Security:'),
      );
      expect(highAnnotations.length).toBeGreaterThanOrEqual(1);
      expect(highAnnotations[0].annotation_level).toBe('failure');

      // Medium severity → warning
      const mediumAnnotations = annotations.filter(
        (a) => a.title?.includes('Performance:'),
      );
      expect(mediumAnnotations.length).toBeGreaterThanOrEqual(1);
      expect(mediumAnnotations[0].annotation_level).toBe('warning');

      // Low severity → notice
      const lowAnnotations = annotations.filter(
        (a) => a.title?.includes('Style:'),
      );
      expect(lowAnnotations.length).toBeGreaterThanOrEqual(1);
      expect(lowAnnotations[0].annotation_level).toBe('notice');
    });

    it('should return annotations for test impact', () => {
      const result = mockReviewResult();
      const annotations = manager.formatAnnotations(result);

      const testAnnotations = annotations.filter(
        (a) => a.title?.includes('Test Impact'),
      );
      expect(testAnnotations.length).toBeGreaterThanOrEqual(1);
      expect(testAnnotations[0].annotation_level).toBe('notice');
    });

    it('should handle empty result gracefully', () => {
      const result = mockReviewResult({
        apiBreakingChanges: [],
        crossRepoImpact: [],
        dependencyCompatibility: [],
        reviewIssues: [],
        testImpact: [],
      });
      const annotations = manager.formatAnnotations(result);
      expect(annotations).toEqual([]);
    });

    it('should not exceed GitHub annotation limit principles', () => {
      // Create a result with many issues
      const manyIssues = Array.from({ length: 100 }, (_, i) => ({
        severity: 'low' as const,
        title: `Issue ${i}`,
        message: `Test issue ${i}`,
        path: `src/file${i}.ts`,
        startLine: i,
        endLine: i,
      }));
      const result = mockReviewResult({ reviewIssues: manyIssues });
      const annotations = manager.formatAnnotations(result);
      // The manager generates them all; the caller slices to 50
      expect(annotations.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // determineConclusion
  // -----------------------------------------------------------------------

  describe('determineConclusion', () => {
    let manager: GitHubCheckRunManager;

    beforeEach(() => {
      manager = createManager();
    });

    it('should return success for approve', () => {
      const result = mockReviewResult({ summary: { mergeRecommendation: 'approve' } });
      expect(manager.determineConclusion(result)).toBe('success');
    });

    it('should return neutral for approve-with-caution', () => {
      const result = mockReviewResult({ summary: { mergeRecommendation: 'approve-with-caution' } });
      expect(manager.determineConclusion(result)).toBe('neutral');
    });

    it('should return failure for request-changes', () => {
      const result = mockReviewResult({ summary: { mergeRecommendation: 'request-changes' } });
      expect(manager.determineConclusion(result)).toBe('failure');
    });

    it('should return action_required for block', () => {
      const result = mockReviewResult({ summary: { mergeRecommendation: 'block' } });
      expect(manager.determineConclusion(result)).toBe('action_required');
    });

    it('should default to neutral for unknown', () => {
      const result = mockReviewResult({ summary: { mergeRecommendation: 'unknown-status' } });
      expect(manager.determineConclusion(result)).toBe('neutral');
    });
  });

  // -----------------------------------------------------------------------
  // formatSummary
  // -----------------------------------------------------------------------

  describe('formatSummary', () => {
    let manager: GitHubCheckRunManager;

    beforeEach(() => {
      manager = createManager();
    });

    it('should include risk level in summary', () => {
      const result = mockReviewResult();
      const summary = manager.formatSummary(result);
      expect(summary).toContain('MEDIUM');
    });

    it('should include merge recommendation', () => {
      const result = mockReviewResult();
      const summary = manager.formatSummary(result);
      expect(summary).toContain('approve-with-caution');
    });

    it('should include repos impacted count', () => {
      const result = mockReviewResult();
      const summary = manager.formatSummary(result);
      expect(summary).toContain('3');
    });

    it('should include API breaking changes section', () => {
      const result = mockReviewResult();
      const summary = manager.formatSummary(result);
      expect(summary).toContain('API Breaking Changes');
    });

    it('should include cross-repo impact section', () => {
      const result = mockReviewResult();
      const summary = manager.formatSummary(result);
      expect(summary).toContain('Cross-Repo Impact');
    });

    it('should handle empty breaking changes', () => {
      const result = mockReviewResult({ apiBreakingChanges: [] });
      const summary = manager.formatSummary(result);
      expect(summary).not.toContain('API Breaking Changes');
    });
  });

  // -----------------------------------------------------------------------
  // formatDetailedText
  // -----------------------------------------------------------------------

  describe('formatDetailedText', () => {
    let manager: GitHubCheckRunManager;

    beforeEach(() => {
      manager = createManager();
    });

    it('should include recommendations', () => {
      const result = mockReviewResult();
      const text = manager.formatDetailedText(result);
      expect(text).toContain('Update shared-lib dependency');
      expect(text).toContain('Add integration tests');
    });

    it('should include dependency compatibility section', () => {
      const result = mockReviewResult();
      const text = manager.formatDetailedText(result);
      expect(text).toContain('shared-lib');
    });

    it('should include test impact section', () => {
      const result = mockReviewResult();
      const text = manager.formatDetailedText(result);
      expect(text).toContain('user.test.ts');
    });
  });
});
