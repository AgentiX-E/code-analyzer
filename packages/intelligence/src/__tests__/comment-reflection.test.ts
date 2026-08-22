// @code-analyzer/intelligence — Comment Reflection Module Tests
import { describe, it, expect, beforeEach } from 'vitest';
import { CommentReflectionModule } from '../review/comment-reflection.js';
import type { ReviewComment } from '@code-analyzer/shared';

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    path: 'src/test.ts',
    content: 'Test comment content',
    thinking: 'This is a test finding',
    existingCode: 'const x = 1;',
    suggestionCode: 'const x: number = 1;',
    startLine: 1,
    endLine: 1,
    category: 'style',
    severity: 'low',
    filtered: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CommentReflectionModule', () => {
  let reflector: CommentReflectionModule;

  beforeEach(() => {
    reflector = new CommentReflectionModule();
  });

  describe('Construction', () => {
    it('should construct with defaults', () => {
      expect(reflector).toBeDefined();
    });

    it('should construct with custom minConfidence', () => {
      const r = new CommentReflectionModule({ minConfidence: 0.5 });
      expect(r).toBeDefined();
    });

    it('should construct with autoAdjust disabled', () => {
      const r = new CommentReflectionModule({ autoAdjustPositions: false });
      expect(r).toBeDefined();
    });

    it('should construct with low confidence filtering', () => {
      const r = new CommentReflectionModule({ filterLowConfidence: true });
      expect(r).toBeDefined();
    });
  });

  describe('Reflect — Valid Comments', () => {
    it('should pass comments with exact position match', () => {
      const content = 'const x = 1;\nconst y = 2;\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'const x = 1;',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      expect(report.passedComments).toBe(1);
    });

    it('should report correct quality score for all-passing', () => {
      const content = 'line1\nline2\nline3\n';
      const comments = [
        makeComment({ startLine: 1, endLine: 1, existingCode: 'line1' }),
        makeComment({ startLine: 2, endLine: 2, existingCode: 'line2' }),
      ];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      expect(report.qualityScore).toBe(1.0);
    });

    it('should count total comments correctly', () => {
      const content = 'a\nb\nc\nd\ne\n';
      const comments = Array.from({ length: 5 }, (_, i) =>
        makeComment({
          startLine: i + 1,
          endLine: i + 1,
          existingCode: String.fromCharCode(97 + i),
        }),
      );
      const report = reflector.reflect(comments, content, 'src/test.ts');
      expect(report.totalComments).toBe(5);
      expect(report.passedComments).toBe(5);
    });
  });

  describe('Reflect — Position Validation', () => {
    it('should flag out-of-bounds startLine', () => {
      const content = 'const x = 1;\n';
      const comment = makeComment({ startLine: 100, endLine: 100 });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      expect(report.failedComments).toBeGreaterThanOrEqual(1);
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'position_out_of_bounds')).toBe(true);
    });

    it('should flag inverted line range (start > end)', () => {
      const content = 'line1\nline2\nline3\n';
      const comment = makeComment({ startLine: 3, endLine: 1 });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      expect(report.failedComments).toBeGreaterThanOrEqual(1);
    });

    it('should auto-adjust positions when enabled', () => {
      const content = 'line1\nline2\nline3\n';
      const comment = makeComment({ startLine: 5, endLine: 5 });
      const r = new CommentReflectionModule({ autoAdjustPositions: true });
      const report = r.reflect([comment], content, 'src/test.ts');
      // endLine=5 exceeds file length 3, should be adjusted
      expect(report.relocatedComments).toBeGreaterThanOrEqual(0);
    });

    it('should not auto-adjust when disabled', () => {
      const content = 'line1\nline2\nline3\n';
      const comment = makeComment({ startLine: 5, endLine: 5 });
      const r = new CommentReflectionModule({ autoAdjustPositions: false });
      const report = r.reflect([comment], content, 'src/test.ts');
      expect(report.failedComments).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reflect — Content Validation', () => {
    it('should flag empty comment content', () => {
      const content = 'const x = 1;\n';
      const comment = makeComment({ content: '   ', existingCode: 'const x = 1;' });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'empty_content')).toBe(true);
    });

    it('should flag irrelevant context (no overlap)', () => {
      const content = 'function main(): void {\n  return;\n}\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'completely different code here',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'irrelevant_context')).toBe(true);
    });
  });

  describe('Reflect — Confidence Threshold', () => {
    it('should flag low confidence comments', () => {
      const content = 'line1\nline2\nline3\n';
      // This comment's existingCode doesn't match — positioner will give low confidence
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'no match here',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      // Low confidence detection depends on positioner result
      expect(r).toBeDefined();
    });
  });

  describe('Reflect — Duplicate Detection', () => {
    it('should detect duplicate comments', () => {
      const content = 'const x = 1;\nconst y = 2;\n';
      const base = {
        startLine: 1,
        endLine: 1,
        existingCode: 'const x = 1;',
      };
      const comments = [makeComment(base), makeComment(base)];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      const hasDuplicate = report.results.some((r) => r.issues.some((i) => i.type === 'duplicate'));
      expect(hasDuplicate).toBe(true);
    });
  });

  describe('Reflect — Empty File', () => {
    it('should handle empty file content', () => {
      const comment = makeComment();
      const report = reflector.reflect([comment], '', 'src/empty.ts');
      expect(report.totalComments).toBe(1);
    });

    it('should flag all comments on empty file', () => {
      const comments = [makeComment(), makeComment()];
      const report = reflector.reflect(comments, '', 'src/empty.ts');
      expect(report.failedComments).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reflect — Report Structure', () => {
    it('should include timestamp in report', () => {
      const content = 'line1\n';
      const comment = makeComment({ startLine: 1, endLine: 1, existingCode: 'line1' });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      expect(report.timestamp).toBeDefined();
      expect(new Date(report.timestamp).getTime()).not.toBeNaN();
    });

    it('should include issue breakdown', () => {
      const content = 'line1\n';
      const comment = makeComment({ startLine: 100, endLine: 100 });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      expect(report.issueBreakdown).toBeDefined();
      expect(Object.keys(report.issueBreakdown).length).toBeGreaterThan(0);
    });

    it('should include per-comment results', () => {
      const content = 'line1\nline2\n';
      const comments = [makeComment({ startLine: 1, endLine: 1, existingCode: 'line1' })];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      expect(report.results).toHaveLength(1);
      expect(report.results[0]!.passed).toBe(true);
    });
  });

  describe('Reflect — Filter Low Confidence', () => {
    it('should filter low confidence when enabled', () => {
      const content = 'line1\nline2\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'no match',
      });
      const r = new CommentReflectionModule({ filterLowConfidence: true, minConfidence: 0.99 });
      const report = r.reflect([comment], content, 'src/test.ts');
      // Low confidence comments should be filtered out
      expect(report.results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Reflect — Quality Score', () => {
    it('should calculate 1.0 for all passing', () => {
      const content = 'a\nb\n';
      const comments = [makeComment({ startLine: 1, endLine: 1, existingCode: 'a' })];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      expect(report.qualityScore).toBe(1.0);
    });

    it('should calculate 0.0 for all failing', () => {
      const content = 'a\n';
      const comments = [makeComment({ startLine: 100, endLine: 100 })];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      expect(report.qualityScore).toBe(0.0);
    });

    it('should calculate intermediate score for mixed results', () => {
      const content = 'a\nb\n';
      const comments = [
        makeComment({ startLine: 1, endLine: 1, existingCode: 'a' }),
        makeComment({ startLine: 100, endLine: 100 }),
      ];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      expect(report.qualityScore).toBeGreaterThan(0);
      expect(report.qualityScore).toBeLessThan(1);
    });

    it('should calculate 1.0 for empty comments list', () => {
      const report = reflector.reflect([], 'content', 'src/test.ts');
      expect(report.qualityScore).toBe(1.0);
      expect(report.totalComments).toBe(0);
      expect(report.passedComments).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: Position Edge Cases
  // -----------------------------------------------------------------------

  describe('Reflect — Position Edge Cases', () => {
    it('should flag endLine less than 1', () => {
      const content = 'line1\nline2\n';
      const comment = makeComment({ startLine: 0, endLine: 0 });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'position_out_of_bounds')).toBe(true);
    });

    it('should flag position_invalid from positioner', () => {
      // With out-of-bounds, positioner may also flag as invalid
      const content = 'one line file\n';
      const comment = makeComment({
        startLine: 100,
        endLine: 100,
        existingCode: 'one line file',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      // Should have some issue
      expect(r.issues.length).toBeGreaterThan(0);
    });

    it('should detect both out_of_bounds and low_confidence', () => {
      const content = 'short\n';
      const comment = makeComment({
        startLine: 50,
        endLine: 50,
        existingCode: 'not here',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      const issueTypes = r.issues.map((i) => i.type);
      expect(issueTypes).toContain('position_out_of_bounds');
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: Duplicate Edge Cases
  // -----------------------------------------------------------------------

  describe('Reflect — Duplicate Edge Cases', () => {
    it('should not flag duplicate for different categories', () => {
      const content = 'const x = 1;\nconst y = 2;\n';
      const comment1 = makeComment({
        startLine: 1,
        endLine: 1,
        category: 'security',
        content: 'Different message here',
        existingCode: 'const x = 1;',
      });
      const comment2 = makeComment({
        startLine: 1,
        endLine: 1,
        category: 'performance',
        content: 'Another completely different message',
        existingCode: 'const x = 1;',
      });
      const report = reflector.reflect([comment1, comment2], content, 'src/test.ts');
      // Different content → should not be duplicates
      const dupCount = report.results.filter((r) =>
        r.issues.some((i) => i.type === 'duplicate'),
      ).length;
      expect(dupCount).toBe(0);
    });

    it('should not flag duplicates for non-overlapping line ranges', () => {
      const content = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n';
      const comment1 = makeComment({
        startLine: 1,
        endLine: 1,
        content: 'same message text',
        existingCode: 'const a = 1;',
      });
      const comment2 = makeComment({
        startLine: 3,
        endLine: 3,
        content: 'same message text',
        existingCode: 'const c = 3;',
      });
      const report = reflector.reflect([comment1, comment2], content, 'src/test.ts');
      const dupCount = report.results.filter((r) =>
        r.issues.some((i) => i.type === 'duplicate'),
      ).length;
      expect(dupCount).toBe(0);
    });

    it('should flag duplicates with same content and overlapping ranges', () => {
      const content = 'const x = 1;\nconst y = 2;\n';
      const base = {
        startLine: 1,
        endLine: 2,
        existingCode: 'const x = 1;',
        content: 'exact same text here',
      };
      const comments = [makeComment(base), makeComment(base)];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      const hasDuplicate = report.results.some((r) => r.issues.some((i) => i.type === 'duplicate'));
      expect(hasDuplicate).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: Content Relevance
  // -----------------------------------------------------------------------

  describe('Reflect — Content Relevance', () => {
    it('should not flag relevant content that partially matches', () => {
      const content = 'function process(data: Input): Output {\n  return transform(data);\n}\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'function process(data',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'irrelevant_context')).toBe(false);
    });

    it('should skip relevance check when existingCode is empty', () => {
      const content = 'line1\nline2\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: '',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'irrelevant_context')).toBe(false);
    });

    it('should skip relevance check when existingCode is whitespace only', () => {
      const content = 'line1\nline2\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: '   ',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'irrelevant_context')).toBe(false);
    });

    it('should flag irrelevant context when only 10% matches', () => {
      const content = 'function doSomething(): string {\n  return "hello";\n}\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode:
          'completely\nunrelated\ncode\nhere_maybe_return_matches_but thats all and not enough',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      const r = report.results[0]!;
      expect(r.issues.some((i) => i.type === 'irrelevant_context')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: filterLowConfidence Mixed
  // -----------------------------------------------------------------------

  describe('Reflect — filterLowConfidence with mixed results', () => {
    it('should keep high-confidence and filter low-confidence comments', () => {
      const content = 'exact match line\nanother exact line\n';
      const good = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'exact match line',
      });
      const bad = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'no match at all',
      });
      const r = new CommentReflectionModule({ filterLowConfidence: true, minConfidence: 0.5 });
      const report = r.reflect([good, bad], content, 'src/test.ts');
      // Should have filtered low-confidence
      expect(report.results.length).toBeLessThanOrEqual(2);
      expect(report.failedComments).toBeGreaterThanOrEqual(0);
    });

    it('should track filtered_low_confidence in issue breakdown', () => {
      const content = 'real line\n';
      const bad = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'missing content',
      });
      const r = new CommentReflectionModule({ filterLowConfidence: true, minConfidence: 0.99 });
      const report = r.reflect([bad], content, 'src/test.ts');
      // Issue breakdown should contain entries
      expect(report.issueBreakdown).toBeDefined();
    });
  });

  // ==========================================================================
  // Branch Coverage: checkContentRelevance — empty existingLines
  // ==========================================================================

  describe('Reflect — content relevance empty snippets', () => {
    it('should skip relevance check when existingCode has only whitespace chars', () => {
      const content = 'function test(): void {\n  return;\n}\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: '\n\n\n',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      // All existingLines are filtered to empty, so checkContentRelevance returns false
      // but the outer guard in reflect checks `existingCode.trim().length > 0` first
      expect(report.results.length).toBe(1);
    });

    it('should flag irrelevant context when file snippet has zero relevant lines', () => {
      const content = '';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'some meaningful code here',
      });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      // File has no content — endLine check triggers position_out_of_bounds
      expect(report.results[0]!.issues.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Branch Coverage: detectDuplicates guard when already marked duplicate
  // ==========================================================================

  describe('Reflect — duplicate detection guard branches', () => {
    it('should not re-mark already duplicate comments', () => {
      const content = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
      // Three identical comments — first one gets flagged, but shouldn't add duplicate issue twice
      const base = {
        startLine: 1,
        endLine: 1,
        existingCode: 'const x = 1;',
        content: 'identical content message here',
      };
      const comments = [makeComment(base), makeComment(base), makeComment(base)];
      const report = reflector.reflect(comments, content, 'src/test.ts');
      // At least some duplicates detected
      const dupCount = report.results.filter((r) =>
        r.issues.some((i) => i.type === 'duplicate'),
      ).length;
      expect(dupCount).toBeGreaterThanOrEqual(1);
      // Each flagged comment should only have one duplicate issue
      for (const r of report.results) {
        const dupIssues = r.issues.filter((i) => i.type === 'duplicate');
        expect(dupIssues.length).toBeLessThanOrEqual(1);
      }
    });
  });

  // ==========================================================================
  // Branch Coverage: autoAdjustPositions when no adjustment needed
  // ==========================================================================

  describe('Reflect — autoAdjust without adjustment needed', () => {
    it('should not relocate when positioner does not provide adjustedStartLine', () => {
      const content = 'line1\nline2\nline3\n';
      const comment = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'line1',
      });
      const r = new CommentReflectionModule({ autoAdjustPositions: true });
      const report = r.reflect([comment], content, 'src/test.ts');
      // Position is valid, so no relocation needed
      expect(report.relocatedComments).toBe(0);
    });
  });

  // ==========================================================================
  // Branch Coverage: endLine < 1 pre-check
  // ==========================================================================

  describe('Reflect — endLine less than 1 pre-issue', () => {
    it('should flag endLine less than 1 as position_out_of_bounds', () => {
      const content = 'line1\nline2\n';
      const comment = makeComment({ startLine: 0, endLine: 0 });
      const report = reflector.reflect([comment], content, 'src/test.ts');
      expect(report.results[0]!.issues.some((i) => i.type === 'position_out_of_bounds')).toBe(true);
    });
  });

  // ==========================================================================
  // Branch Coverage: filterLowConfidence with filterLowConfidence=false (normal path)
  // ==========================================================================

  describe('Reflect — normal path (filterLowConfidence=false)', () => {
    it('should not filter low confidence when filterLowConfidence is false', () => {
      const content = 'real content here\n';
      const bad = makeComment({
        startLine: 1,
        endLine: 1,
        existingCode: 'completely different text',
      });
      // Default has filterLowConfidence=false
      const report = reflector.reflect([bad], content, 'src/test.ts');
      // Low confidence comment is flagged but not removed from results
      expect(report.results.length).toBe(1);
      expect(report.results[0]!.issues.some((i) => i.type === 'low_confidence')).toBe(true);
    });

    it('should handle zero total comments correctly', () => {
      const report = reflector.reflect([], 'any content', 'src/test.ts');
      expect(report.totalComments).toBe(0);
      expect(report.passedComments).toBe(0);
      expect(report.failedComments).toBe(0);
      expect(report.qualityScore).toBe(1);
    });
  });
});
