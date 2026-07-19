// @code-analyzer/intelligence — IoU Overlap Detector
// Prevents duplicate PR comments by detecting overlapping regions
// using Intersection over Union (IoU) metric.

// ---------------------------------------------------------------------------
// Public Interface
// ---------------------------------------------------------------------------

export interface CommentRegion {
  filePath: string;
  startLine: number;
  endLine: number;
  commentId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_IOU_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// IoUOverlapDetector
// ---------------------------------------------------------------------------

export class IoUOverlapDetector {
  /**
   * Detect if a new comment overlaps with any existing comment.
   * Uses IoU (Intersection over Union) metric.
   * Only compares comments in the same file.
   *
   * @param newComment - The comment to check
   * @param existingComments - Previously posted comments
   * @param threshold - IoU threshold above which comments are overlapping (default: 0.5)
   * @returns The overlapping existing comment, or null if no overlap
   */
  detectOverlap(
    newComment: CommentRegion,
    existingComments: CommentRegion[],
    threshold: number = DEFAULT_IOU_THRESHOLD,
  ): CommentRegion | null {
    for (const existing of existingComments) {
      if (existing.filePath !== newComment.filePath) {
        continue;
      }

      const iou = this.computeIoU(newComment, existing);
      if (iou > threshold) {
        return existing;
      }
    }

    return null;
  }

  /**
   * Filter out new comments that overlap with any existing comments.
   *
   * @param newComments - Candidate comments to be filtered
   * @param existingComments - Previously posted comments
   * @returns Comments that do NOT overlap with any existing comment
   */
  filterOverlapping(
    newComments: CommentRegion[],
    existingComments: CommentRegion[],
  ): CommentRegion[] {
    return newComments.filter(
      (newComment) =>
        this.detectOverlap(newComment, existingComments) === null,
    );
  }

  /**
   * Compute the Intersection over Union (IoU) of two comment regions.
   *
   * IoU = |A ∩ B| / |A ∪ B|
   *
   * Only computes IoU for comments in the same file; returns 0 for
   * comments in different files.
   *
   * @param a - First comment region
   * @param b - Second comment region
   * @returns IoU value in range [0, 1]
   */
  computeIoU(a: CommentRegion, b: CommentRegion): number {
    // Comments in different files cannot overlap
    if (a.filePath !== b.filePath) {
      return 0;
    }

    const intersectionStart = Math.max(a.startLine, b.startLine);
    const intersectionEnd = Math.min(a.endLine, b.endLine);

    // No overlap
    if (intersectionStart > intersectionEnd) {
      return 0;
    }

    const intersection = intersectionEnd - intersectionStart + 1;

    const unionStart = Math.min(a.startLine, b.startLine);
    const unionEnd = Math.max(a.endLine, b.endLine);
    const union = unionEnd - unionStart + 1;

    // Guard against division by zero (should not happen with valid inputs)
    if (union === 0) {
      return 0;
    }

    return intersection / union;
  }
}
