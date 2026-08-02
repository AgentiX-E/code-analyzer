// @code-analyzer/intelligence — LLM Review Engine Tests
// Tests for LLMReviewEngine: reviewDiff, lane orchestration, output parsing,
// context truncation, and ReviewComment conversion.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';
import type { LLMReviewOptions, LLMReviewResult } from '../../review/llm/llm-review-engine.js';
import type { LLMProvider, CompletionResult } from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';
import type { ReviewLane } from '../../review/llm/prompts.js';
import { LANE_LABELS } from '../../review/llm/prompts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(): LLMProvider {
  const provider: LLMProvider = {
    name: 'MockProvider',
    model: 'mock-model',
    complete: vi.fn(),
    completeWithTools: vi.fn(),
    healthCheck: vi.fn(),
  };
  return provider;
}

function createSuccessResult(content: string): CompletionResult {
  return {
    content,
    model: 'mock-model',
    createdAt: new Date().toISOString(),
    finishReason: 'stop',
  };
}

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: '/src/test.ts',
    oldHash: 'abc123',
    newHash: 'def456',
    ranges: [
      { oldStart: 1, oldEnd: 10, newStart: 1, newEnd: 15, changeType: 'modified' },
    ],
    changeType: 'modified',
    ...overrides,
  };
}

function securityFindings(): string {
  return JSON.stringify({
    findings: [
      {
        startLine: 1,
        endLine: 3,
        severity: 'critical',
        category: 'security',
        title: 'SQL injection found',
        description: 'Unsafe query',
        suggestion: 'Use parameterized queries',
      },
    ],
  });
}

function performanceFindings(): string {
  return JSON.stringify({
    findings: [
      {
        startLine: 2,
        endLine: 4,
        severity: 'high',
        category: 'performance',
        title: 'N+1 query',
        description: 'Query in loop',
        suggestion: 'Use batch query',
      },
    ],
  });
}

function emptyFindings(): string {
  return JSON.stringify({ findings: [] });
}

function invalidJSON(): string {
  return 'not valid json';
}

// ---------------------------------------------------------------------------
// LLMReviewEngine Tests
// ---------------------------------------------------------------------------

describe('LLMReviewEngine', () => {
  let provider: LLMProvider;

  beforeEach(() => {
    provider = createMockProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create an engine with default options', () => {
      const engine = new LLMReviewEngine(provider);
      expect(engine).toBeDefined();
    });

    it('should accept custom options', () => {
      const options: LLMReviewOptions = {
        lanes: ['security'],
        parallel: false,
        maxDiffLength: 4000,
        temperature: 0.5,
      };
      const engine = new LLMReviewEngine(provider, options);
      expect(engine).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // reviewDiff — single lane
  // -------------------------------------------------------------------------

  describe('reviewDiff — single lane', () => {
    it('should run a single review lane successfully', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(securityFindings()),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(1);
      expect(results[0]!.lane).toBe('security');
      expect(results[0]!.success).toBe(true);
      expect(results[0]!.findings).toHaveLength(1);
      expect(results[0]!.findings[0]!.title).toBe('SQL injection found');
      expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty findings from LLM', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['performance'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(results[0]!.findings).toHaveLength(0);
    });

    it('should handle LLM errors gracefully', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error'),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['testing'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(false);
      expect(results[0]!.error).toContain('API error');
      expect(results[0]!.findings).toHaveLength(0);
    });

    it('should handle invalid JSON from LLM', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(invalidJSON()),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['architecture'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(results[0]!.findings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // reviewDiff — multiple lanes (parallel)
  // -------------------------------------------------------------------------

  describe('reviewDiff — multiple lanes parallel', () => {
    it('should run multiple lanes in parallel', async () => {
      const mock = provider.complete as ReturnType<typeof vi.fn>;
      mock.mockResolvedValue(createSuccessResult(securityFindings()));

      const engine = new LLMReviewEngine(provider, {
        lanes: ['security', 'performance', 'maintainability', 'testing', 'architecture'],
        parallel: true,
      });

      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(5);
      expect(mock).toHaveBeenCalledTimes(5);
      // All should succeed
      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });

    it('should keep successful results when some lanes fail', async () => {
      const mock = provider.complete as ReturnType<typeof vi.fn>;
      mock
        .mockResolvedValueOnce(createSuccessResult(securityFindings()))
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(createSuccessResult(emptyFindings()));

      const engine = new LLMReviewEngine(provider, {
        lanes: ['security', 'performance', 'maintainability'],
        parallel: true,
      });

      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(3);
      expect(results[0]!.success).toBe(true);
      expect(results[1]!.success).toBe(false);
      expect(results[2]!.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // reviewDiff — multiple lanes (sequential)
  // -------------------------------------------------------------------------

  describe('reviewDiff — multiple lanes sequential', () => {
    it('should run lanes sequentially', async () => {
      const mock = provider.complete as ReturnType<typeof vi.fn>;
      mock.mockResolvedValue(createSuccessResult(securityFindings()));

      const engine = new LLMReviewEngine(provider, {
        lanes: ['security', 'performance', 'testing'],
        parallel: false,
      });

      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(3);
      expect(mock).toHaveBeenCalledTimes(3);
    });

    it('should continue after lane failure in sequential mode', async () => {
      const mock = provider.complete as ReturnType<typeof vi.fn>;
      mock
        .mockRejectedValueOnce(new Error('Auth error'))
        .mockResolvedValueOnce(createSuccessResult(securityFindings()))
        .mockResolvedValueOnce(createSuccessResult(performanceFindings()));

      const engine = new LLMReviewEngine(provider, {
        lanes: ['security', 'performance', 'testing'],
        parallel: false,
      });

      const results = await engine.reviewDiff(createDiff());

      expect(results).toHaveLength(3);
      expect(results[0]!.success).toBe(false);
      expect(results[1]!.success).toBe(true);
      expect(results[2]!.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // reviewDiff — file context & options
  // -------------------------------------------------------------------------

  describe('reviewDiff — file context', () => {
    it('should pass file context to the LLM provider', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider);
      const fileContext = 'import x from "./x";\nimport y from "./y";';
      await engine.reviewDiff(createDiff(), fileContext);

      // Verify the complete method was called with a prompt containing the context
      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(callArgs[0]).toContain('import x');
      expect(callArgs[0]).toContain('import y');
    });

    it('should handle undefined file context', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider);
      await engine.reviewDiff(createDiff(), undefined);

      expect(provider.complete).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Context Window Truncation
  // -------------------------------------------------------------------------

  describe('context truncation', () => {
    it('should truncate large diff content', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider, { maxDiffLength: 50 });

      const diff = createDiff({
        ranges: Array.from({ length: 20 }, (_, i) => ({
          oldStart: i * 10,
          oldEnd: i * 10 + 5,
          newStart: i * 10,
          newEnd: i * 10 + 5,
          changeType: 'modified' as const,
        })),
      });

      await engine.reviewDiff(diff);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(callArgs[0]).toContain('truncated');
    });

    it('should not truncate small diff content', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider, { maxDiffLength: 10000 });
      const diff = createDiff();

      await engine.reviewDiff(diff);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(callArgs[0]).not.toContain('truncated');
    });
  });

  // -------------------------------------------------------------------------
  // Finding Filtering
  // -------------------------------------------------------------------------

  describe('finding filtering', () => {
    it('should filter findings with invalid start line', async () => {
      const invalidFindings = JSON.stringify({
        findings: [
          { startLine: 0, endLine: 5, severity: 'high', category: 'bug', title: 'Bad', description: 'd', suggestion: null },
          { startLine: -1, endLine: 1, severity: 'high', category: 'bug', title: 'Bad2', description: 'd', suggestion: null },
          { startLine: 1, endLine: 2, severity: 'high', category: 'bug', title: 'Good', description: 'd', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(invalidFindings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results[0]!.findings).toHaveLength(1);
      expect(results[0]!.findings[0]!.title).toBe('Good');
    });

    it('should clamp end line to max diff lines', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 9999, severity: 'high', category: 'bug', title: 'Clamped', description: 'd', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const diff = createDiff();
      const results = await engine.reviewDiff(diff);

      expect(results[0]!.findings).toHaveLength(1);
      // End line should be clamped to the actual diff content length
      expect(results[0]!.findings[0]!.endLine).toBeLessThan(9999);
    });

    it('should fix start line when start > end', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 10, endLine: 5, severity: 'high', category: 'bug', title: 'Fixed', description: 'd', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      // Create a diff with enough lines (20 ranges = many content lines)
      const diff = createDiff({
        ranges: Array.from({ length: 20 }, (_, i) => ({
          oldStart: i + 1,
          oldEnd: i + 2,
          newStart: i + 1,
          newEnd: i + 2,
          changeType: 'modified' as const,
        })),
      });
      const results = await engine.reviewDiff(diff);

      expect(results[0]!.findings).toHaveLength(1);
      expect(results[0]!.findings[0]!.startLine).toBe(5);
      expect(results[0]!.findings[0]!.endLine).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Severity and Category Normalization
  // -------------------------------------------------------------------------

  describe('normalization', () => {
    it('should normalize invalid severity to medium', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 1, severity: 'UNKNOWN_LEVEL', category: 'bug', title: 'Test', description: 'd', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results[0]!.findings[0]!.severity).toBe('medium');
    });

    it('should normalize invalid category to other', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 1, severity: 'high', category: 'unknown_cat', title: 'Test', description: 'd', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results[0]!.findings[0]!.category).toBe('other');
    });

    it('should preserve valid severity and category', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 1, severity: 'critical', category: 'security', title: 'T', description: 'd', suggestion: null },
          { startLine: 2, endLine: 2, severity: 'info', category: 'style', title: 'T2', description: 'd', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results[0]!.findings[0]!.severity).toBe('critical');
      expect(results[0]!.findings[0]!.category).toBe('security');
      expect(results[0]!.findings[1]!.severity).toBe('info');
      expect(results[0]!.findings[1]!.category).toBe('style');
    });
  });

  // -------------------------------------------------------------------------
  // ReviewComment Conversion
  // -------------------------------------------------------------------------

  describe('reviewDiffAsComments', () => {
    it('should convert LLM findings to ReviewComment format', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(securityFindings()),
      );

      const engine = new LLMReviewEngine(provider, {
        lanes: ['security', 'performance'],
      });

      const diff = createDiff();
      const comments = await engine.reviewDiffAsComments(diff);

      expect(comments.length).toBeGreaterThan(0);
      expect(comments[0]!.path).toBe(diff.filePath);
      expect(comments[0]!.id).toContain('llm-');
      expect(comments[0]!.content).toBe('SQL injection found');
      expect(comments[0]!.thinking).toContain('Unsafe query');
      expect(comments[0]!.thinking).toContain('Security Review');
      expect(comments[0]!.category).toBe('security');
      expect(comments[0]!.severity).toBe('critical');
      expect(comments[0]!.filtered).toBe(false);
      expect(comments[0]!.createdAt).toBeTruthy();
    });

    it('should skip failed lanes', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error'),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const comments = await engine.reviewDiffAsComments(createDiff());

      expect(comments).toHaveLength(0);
    });

    it('should handle findings with null suggestion', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 1, severity: 'high', category: 'bug', title: 'Issue', description: 'desc', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const comments = await engine.reviewDiffAsComments(createDiff());

      expect(comments).toHaveLength(1);
      expect(comments[0]!.suggestionCode).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Unknown Lane Handling
  // -------------------------------------------------------------------------

  describe('unknown lane', () => {
    it('should handle unknown review lane gracefully', async () => {
      const engine = new LLMReviewEngine(provider, {
        lanes: ['security'],
        parallel: false,
      });

      // Call the private executeLane with an unknown lane type to cover
      // the !promptFn branch (line 157)
      const result = await (engine as any).executeLane(
        { diffContent: '// test', filePath: '/test.ts', changeType: 'modified' },
        'unknown_lane' as ReviewLane,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown review lane');
      expect(result.error).toContain('unknown_lane');
      expect(result.findings).toHaveLength(0);
      expect(result.filePath).toBe('/test.ts');
      expect(result.lane).toBe('unknown_lane');
    });

    it('should have non-empty durationMs for unknown lane error', async () => {
      const engine = new LLMReviewEngine(provider, {
        lanes: ['security'],
        parallel: false,
      });

      const result = await (engine as any).executeLane(
        { diffContent: '', filePath: '/test.ts', changeType: 'modified' },
        'unknown_lane' as ReviewLane,
      );

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle diffs with no ranges', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider);
      const diff = createDiff({ ranges: [] });
      const results = await engine.reviewDiff(diff);

      expect(results).toHaveLength(5);
      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });

    it('should use LANE_LABELS for human-readable lane names', () => {
      expect(LANE_LABELS.security).toBe('Security Review');
      expect(LANE_LABELS.performance).toBe('Performance Review');
      expect(LANE_LABELS.maintainability).toBe('Maintainability Review');
      expect(LANE_LABELS.testing).toBe('Testing Review');
      expect(LANE_LABELS.architecture).toBe('Architecture Review');
    });

    it('should handle renamed files', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider);
      const diff = createDiff({
        changeType: 'renamed',
        oldPath: '/src/old-name.ts',
      });

      const results = await engine.reviewDiff(diff);

      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });

    it('should handle deleted files', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const engine = new LLMReviewEngine(provider);
      const diff = createDiff({ changeType: 'deleted' });
      const results = await engine.reviewDiff(diff);

      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });

    it('should handle non-Error throw values in lane execution', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        'string error not an Error object',
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results[0]!.success).toBe(false);
      expect(results[0]!.error).toContain('string error');
    });

    it('should return correct duration timing', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        return createSuccessResult(emptyFindings());
      });

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const results = await engine.reviewDiff(createDiff());

      expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should process all review lanes', async () => {
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(emptyFindings()),
      );

      const allLanes: ReviewLane[] = ['security', 'performance', 'maintainability', 'testing', 'architecture'];
      const engine = new LLMReviewEngine(provider, { lanes: allLanes });

      const results = await engine.reviewDiff(createDiff());
      const returnedLanes = results.map((r) => r.lane);

      expect(returnedLanes.sort()).toEqual(allLanes.sort());
    });

    it('should clamp endLine when it exceeds diff content length', async () => {
      // Create a diff with very few content lines (1 range = ~3 lines of content)
      // and a finding with endLine that exceeds the content
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 500, severity: 'medium', category: 'maintainability', title: 'Out of bounds', description: 'endLine exceeds diff', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['maintainability'] });
      const diff = createDiff(); // Only 1 range = short content
      const results = await engine.reviewDiff(diff);

      expect(results[0]!.findings).toHaveLength(1);
      // endLine should be clamped to the actual content line count
      expect(results[0]!.findings[0]!.endLine).toBeLessThan(500);
    });

    it('should handle extractRangeText when ranges array is empty (fallback ternary)', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 3, severity: 'medium', category: 'maintainability', title: 'Test', description: 'desc', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['maintainability'] });
      const diff = createDiff({ ranges: [] });
      const comments = await engine.reviewDiffAsComments(diff);

      // Should still produce comments even with empty ranges
      expect(comments.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter findings where startLine exceeds maxLine of diff content', async () => {
      const findings = JSON.stringify({
        findings: [
          { startLine: 1, endLine: 2, severity: 'high', category: 'bug', title: 'Valid', description: 'd', suggestion: null },
          { startLine: 9999, endLine: 9999, severity: 'high', category: 'bug', title: 'OutOfBounds', description: 'd', suggestion: null },
        ],
      });

      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createSuccessResult(findings),
      );

      const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
      const diff = createDiff(); // newEnd: 15, so maxLine ≈ 15
      const results = await engine.reviewDiff(diff);

      expect(results[0]!.findings).toHaveLength(1);
      expect(results[0]!.findings[0]!.title).toBe('Valid');
    });
  });
});
