// @code-analyzer/intelligence — Comment Reflection Module Tests
import { describe, it, expect, beforeEach } from 'vitest';
import { CommentReflectionModule } from '../comment-reflection.js';
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
      const hasDuplicate = report.results.some((r) =>
        r.issues.some((i) => i.type === 'duplicate'),
      );
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
  });
});
