// @code-analyzer/intelligence — IoU Overlap Detector Tests

import { describe, it, expect } from 'vitest';
import { IoUOverlapDetector } from '../impact/iou-overlap.js';
import type { CommentRegion } from '../impact/iou-overlap.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRegion(
  overrides: Partial<CommentRegion> = {},
): CommentRegion {
  return {
    filePath: '/src/app.ts',
    startLine: 10,
    endLine: 20,
    commentId: 'comment-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeIoU Tests
// ---------------------------------------------------------------------------

describe('IoUOverlapDetector.computeIoU', () => {
  const detector = new IoUOverlapDetector();

  it('should return 1.0 for identical regions', () => {
    const a = createRegion();
    const b = createRegion();
    expect(detector.computeIoU(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for non-overlapping regions', () => {
    const a = createRegion({ startLine: 1, endLine: 5 });
    const b = createRegion({ startLine: 10, endLine: 15 });
    expect(detector.computeIoU(a, b)).toBe(0);
  });

  it('should return 0 for adjacent but non-overlapping regions', () => {
    const a = createRegion({ startLine: 1, endLine: 5 });
    const b = createRegion({ startLine: 6, endLine: 10 });
    expect(detector.computeIoU(a, b)).toBe(0);
  });

  it('should compute partial overlap correctly', () => {
    // Region a: lines 1-10 (10 lines)
    // Region b: lines 5-15 (11 lines)
    // Intersection: 5-10 (6 lines)
    // Union: 1-15 (15 lines)
    // IoU = 6/15 = 0.4
    const a = createRegion({ startLine: 1, endLine: 10 });
    const b = createRegion({ startLine: 5, endLine: 15 });
    expect(detector.computeIoU(a, b)).toBeCloseTo(0.4, 5);
  });

  it('should compute IoU when one region fully contains another', () => {
    // Region a: lines 1-20 (20 lines)
    // Region b: lines 5-10 (6 lines)
    // Intersection: 5-10 (6 lines)
    // Union: 1-20 (20 lines)
    // IoU = 6/20 = 0.3
    const a = createRegion({ startLine: 1, endLine: 20 });
    const b = createRegion({ startLine: 5, endLine: 10 });
    expect(detector.computeIoU(a, b)).toBeCloseTo(0.3, 5);
  });

  it('should return 0 for different files', () => {
    const a = createRegion({ filePath: '/src/a.ts' });
    const b = createRegion({ filePath: '/src/b.ts' });
    expect(detector.computeIoU(a, b)).toBe(0);
  });

  it('should handle single-line regions', () => {
    const a = createRegion({ startLine: 5, endLine: 5 });
    const b = createRegion({ startLine: 5, endLine: 5 });
    expect(detector.computeIoU(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should handle single-line non-overlapping regions', () => {
    const a = createRegion({ startLine: 5, endLine: 5 });
    const b = createRegion({ startLine: 10, endLine: 10 });
    expect(detector.computeIoU(a, b)).toBe(0);
  });

  it('should be symmetric (IoU(a,b) == IoU(b,a))', () => {
    const a = createRegion({ startLine: 1, endLine: 8 });
    const b = createRegion({ startLine: 3, endLine: 12 });
    const ab = detector.computeIoU(a, b);
    const ba = detector.computeIoU(b, a);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('should handle large overlap (> 0.9)', () => {
    const a = createRegion({ startLine: 1, endLine: 100 });
    const b = createRegion({ startLine: 1, endLine: 98 });
    // Intersection: 1-98 (98), Union: 1-100 (100), IoU = 0.98
    expect(detector.computeIoU(a, b)).toBeCloseTo(0.98, 5);
  });

  it('should handle tiny overlap', () => {
    const a = createRegion({ startLine: 1, endLine: 100 });
    const b = createRegion({ startLine: 99, endLine: 105 });
    // Intersection: 99-100 (2), Union: 1-105 (105), IoU = 2/105 ≈ 0.019
    expect(detector.computeIoU(a, b)).toBeCloseTo(0.019, 2);
  });
});

// ---------------------------------------------------------------------------
// detectOverlap Tests
// ---------------------------------------------------------------------------

describe('IoUOverlapDetector.detectOverlap', () => {
  const detector = new IoUOverlapDetector();

  it('should detect overlap above threshold', () => {
    const existing = [createRegion({ startLine: 1, endLine: 10 })];
    const newComment = createRegion({ startLine: 5, endLine: 15 });

    const result = detector.detectOverlap(newComment, existing, 0.3);
    expect(result).not.toBeNull();
    expect(result!.commentId).toBe('comment-1');
  });

  it('should return null when overlap is below threshold', () => {
    const existing = [createRegion({ startLine: 1, endLine: 10 })];
    const newComment = createRegion({ startLine: 5, endLine: 15 });

    const result = detector.detectOverlap(newComment, existing, 0.6);
    // IoU = 6/15 = 0.4, threshold = 0.6, so null
    expect(result).toBeNull();
  });

  it('should return the first overlapping comment', () => {
    const existing = [
      createRegion({
        commentId: 'first',
        startLine: 1,
        endLine: 10,
      }),
      createRegion({
        commentId: 'second',
        startLine: 5,
        endLine: 15,
      }),
    ];
    const newComment = createRegion({ startLine: 1, endLine: 10 });

    const result = detector.detectOverlap(newComment, existing);
    expect(result).not.toBeNull();
    expect(result!.commentId).toBe('first');
  });

  it('should use default threshold of 0.5', () => {
    const existing = [createRegion({ startLine: 1, endLine: 10 })];
    // IoU = 6/15 = 0.4, default threshold 0.5 → no overlap
    const newComment = createRegion({ startLine: 5, endLine: 15 });
    const result = detector.detectOverlap(newComment, existing);
    expect(result).toBeNull();
  });

  it('should ignore comments in different files', () => {
    const existing = [
      createRegion({ filePath: '/src/other.ts', startLine: 1, endLine: 10 }),
    ];
    const newComment = createRegion({ startLine: 1, endLine: 10 });

    const result = detector.detectOverlap(newComment, existing);
    expect(result).toBeNull();
  });

  it('should handle empty existing comments', () => {
    const newComment = createRegion();
    const result = detector.detectOverlap(newComment, []);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterOverlapping Tests
// ---------------------------------------------------------------------------

describe('IoUOverlapDetector.filterOverlapping', () => {
  const detector = new IoUOverlapDetector();

  it('should filter out overlapping comments', () => {
    // existing: 1-12, new: 5-15 → IoU = (12-5+1)/(15-1+1) = 8/15 ≈ 0.53 > 0.5
    const existing = [createRegion({ startLine: 1, endLine: 12 })];
    const newComments = [
      createRegion({ commentId: 'should-keep', startLine: 30, endLine: 40 }),
      createRegion({ commentId: 'should-drop', startLine: 5, endLine: 15 }),
    ];

    const filtered = detector.filterOverlapping(newComments, existing);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.commentId).toBe('should-keep');
  });

  it('should keep all comments when no overlap', () => {
    const existing = [createRegion({ startLine: 1, endLine: 10 })];
    const newComments = [
      createRegion({ commentId: 'a', startLine: 30, endLine: 40 }),
      createRegion({ commentId: 'b', startLine: 50, endLine: 60 }),
    ];

    const filtered = detector.filterOverlapping(newComments, existing);
    expect(filtered).toHaveLength(2);
  });

  it('should drop all comments when all overlap', () => {
    // existing: 5-20. new1: 1-15, new2: 8-25
    // IoU(5-20, 1-15) = (15-5+1)/(20-1+1) = 11/20 = 0.55 > 0.5
    // IoU(5-20, 8-25) = (20-8+1)/(25-5+1) = 13/21 ≈ 0.62 > 0.5
    const existing = [createRegion({ startLine: 5, endLine: 20 })];
    const newComments = [
      createRegion({ commentId: 'a', startLine: 1, endLine: 15 }),
      createRegion({ commentId: 'b', startLine: 8, endLine: 25 }),
    ];

    const filtered = detector.filterOverlapping(newComments, existing);
    expect(filtered).toHaveLength(0);
  });

  it('should handle empty input arrays', () => {
    const result = detector.filterOverlapping([], []);
    expect(result).toEqual([]);

    const newComments = [createRegion()];
    const result2 = detector.filterOverlapping(newComments, []);
    expect(result2).toHaveLength(1);
  });

  it('should not filter comments from different files', () => {
    const existing = [
      createRegion({ filePath: '/src/other.ts', startLine: 1, endLine: 10 }),
    ];
    const newComments = [createRegion({ startLine: 1, endLine: 10 })];

    const filtered = detector.filterOverlapping(newComments, existing);
    expect(filtered).toHaveLength(1);
  });
});
