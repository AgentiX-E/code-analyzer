// @code-analyzer/intelligence — Comment Positioner
// Precise line-level positioning for review comments, similar to OCR's
// comment positioning system.

import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PositionedComment extends ReviewComment {
  positionConfidence: number; // 0-1, how confident we are in the line position
  positionMethod: 'exact' | 'heuristic' | 'fallback';
}

export interface PositionResult {
  valid: boolean;
  reason?: string;
  adjustedStartLine?: number;
  adjustedEndLine?: number;
}

// ---------------------------------------------------------------------------
// Comment Positioner
// ---------------------------------------------------------------------------

export class CommentPositioner {
  /**
   * Takes a review comment and source file content, returns a positioned
   * comment with precise startLine/endLine resolved.
   *
   * Positioning strategies (tried in order):
   * 1. **exact** — the existingCode snippet matches the file content at the
   *    given lines exactly.
   * 2. **heuristic** — fuzzy-match the existingCode against the file content
   *    to find the most likely position.
   * 3. **fallback** — use the original line numbers with reduced confidence.
   */
  positionComment(
    comment: ReviewComment,
    fileContent: string,
  ): PositionedComment {
    const fileLines = fileContent.split('\n');
    const totalLines = fileLines.length;

    // Strategy 1: Exact match at the claimed position
    if (this.isExactMatch(comment, fileLines)) {
      return {
        ...comment,
        positionConfidence: 1.0,
        positionMethod: 'exact',
      };
    }

    // Strategy 2: Heuristic — search for the code snippet in the file
    const heuristicPos = this.findHeuristicPosition(comment, fileLines);
    if (heuristicPos) {
      return {
        ...comment,
        startLine: heuristicPos.start,
        endLine: heuristicPos.end,
        positionConfidence: heuristicPos.confidence,
        positionMethod: 'heuristic',
      };
    }

    // Strategy 3: Fallback — clamp to valid range
    const clampedStart = Math.min(comment.startLine, totalLines || 1);
    const clampedEnd = Math.min(
      Math.max(comment.endLine, clampedStart),
      totalLines || clampedStart,
    );

    return {
      ...comment,
      startLine: clampedStart,
      endLine: clampedEnd,
      positionConfidence: 0.2,
      positionMethod: 'fallback',
    };
  }

  /**
   * Validates that the positioned comment's line range points to valid code.
   * Returns a PositionResult indicating validity and any adjustments needed.
   */
  validatePosition(
    comment: PositionedComment,
    fileContent: string,
  ): PositionResult {
    const fileLines = fileContent.split('\n');
    const totalLines = fileLines.length;

    // Check for empty file (split('\n') on empty string gives [''])
    if (totalLines === 0 || (totalLines === 1 && fileLines[0] === '')) {
      return {
        valid: false,
        reason: 'File is empty — no valid position possible',
      };
    }

    // Check for invalid range (start > end)
    if (comment.startLine > comment.endLine) {
      return {
        valid: false,
        reason: `Invalid range: startLine ${comment.startLine} > endLine ${comment.endLine}`,
        adjustedStartLine: comment.endLine,
        adjustedEndLine: comment.endLine,
      };
    }

    // Check for out-of-bounds
    if (comment.startLine > totalLines) {
      return {
        valid: false,
        reason: `startLine ${comment.startLine} exceeds file length ${totalLines}`,
        adjustedStartLine: totalLines,
        adjustedEndLine: totalLines,
      };
    }

    if (comment.endLine > totalLines) {
      return {
        valid: true,
        reason: `endLine ${comment.endLine} exceeds file length ${totalLines}`,
        adjustedStartLine: comment.startLine,
        adjustedEndLine: totalLines,
      };
    }

    // Check that the range actually spans meaningful content
    const contentLines = fileLines.slice(
      comment.startLine - 1,
      comment.endLine,
    );
    const hasContent = contentLines.some(
      (line) => line.trim().length > 0,
    );

    if (!hasContent) {
      return {
        valid: false,
        reason: `Lines ${comment.startLine}-${comment.endLine} contain only whitespace`,
      };
    }

    return { valid: true };
  }

  /**
   * Returns the surrounding code context for a positioned comment.
   *
   * @param comment — the positioned comment
   * @param fileContent — the source file content
   * @param contextLines — number of lines of context above and below (default 2)
   */
  adjustContext(
    comment: PositionedComment,
    fileContent: string,
    contextLines = 2,
  ): string {
    const fileLines = fileContent.split('\n');
    const totalLines = fileLines.length;

    // Empty file: content is '' or has only one empty string element
    if (totalLines === 0 || (totalLines === 1 && fileLines[0] === '')) {
      return '';
    }

    const contextStart = Math.max(1, comment.startLine - contextLines);
    const contextEnd = Math.min(totalLines, comment.endLine + contextLines);

    const lines: string[] = [];
    for (let i = contextStart; i <= contextEnd; i++) {
      const marker =
        i >= comment.startLine && i <= comment.endLine ? '>' : ' ';
      lines.push(`${marker} ${String(i).padStart(4, ' ')}| ${fileLines[i - 1]}`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if the existingCode matches the file content at the claimed
   * startLine/endLine exactly.
   */
  private isExactMatch(
    comment: ReviewComment,
    fileLines: string[],
  ): boolean {
    const { startLine, endLine, existingCode } = comment;

    // Quick bounds check
    if (startLine < 1 || endLine > fileLines.length) {
      return false;
    }
    if (startLine > endLine) {
      return false;
    }

    // Normalize both for comparison
    const fileSnippet = fileLines.slice(startLine - 1, endLine).join('\n');
    const normalizedFile = fileSnippet.trim();
    const normalizedCode = existingCode.trim();

    return normalizedFile === normalizedCode && normalizedCode.length > 0;
  }

  /**
   * Fuzzy-match the existingCode against file content to find the most
   * likely position. Uses line-by-line similarity scoring.
   */
  private findHeuristicPosition(
    comment: ReviewComment,
    fileLines: string[],
  ): { start: number; end: number; confidence: number } | null {
    const existingLines = comment.existingCode.split('\n');
    const existingTrimmed = existingLines.map((l) => l.trim());

    // Remove empty leading/trailing lines from the snippet for matching
    const firstNonEmpty = existingTrimmed.findIndex((l) => l.length > 0);
    const lastNonEmpty = findLastIndex(existingTrimmed, (l) => l.length > 0);

    if (firstNonEmpty === -1) {
      return null;
    }

    const coreSnippet = existingTrimmed.slice(firstNonEmpty, lastNonEmpty + 1);

    let bestMatch: { start: number; end: number; confidence: number } | null =
      null;
    let bestScore = 0;

    // Slide a window over the file
    const windowSize = coreSnippet.length;
    for (let i = 0; i <= fileLines.length - windowSize; i++) {
      const windowLines = fileLines.slice(i, i + windowSize).map((l) => l.trim());
      const score = this.computeSimilarity(coreSnippet, windowLines);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          start: i + 1,
          end: i + existingLines.length,
          confidence: score,
        };
      }
    }

    // Require a minimum similarity threshold for heuristic matches
    if (bestMatch && bestScore >= 0.3) {
      return bestMatch;
    }

    return null;
  }

  /**
   * Compute similarity between two arrays of lines using Jaccard-like
   * token overlap on each line pair, then average across all lines.
   */
  private computeSimilarity(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) {
      return 0;
    }

    const minLen = Math.min(a.length, b.length);
    let totalScore = 0;

    for (let i = 0; i < minLen; i++) {
      const lineA = a[i];
      const lineB = b[i];
      if (!lineA || !lineB) continue;
      const tokensA = new Set(this.tokenize(lineA));
      const tokensB = new Set(this.tokenize(lineB));

      if (tokensA.size === 0 && tokensB.size === 0) {
        totalScore += 1; // Both empty = perfect match on this line
        continue;
      }

      const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
      const union = new Set([...tokensA, ...tokensB]);
      totalScore += intersection.size / union.size;
    }

    return totalScore / a.length;
  }

  /**
   * Tokenize a code line into meaningful tokens for comparison.
   */
  private tokenize(line: string): string[] {
    // Split on whitespace and common code separators
    return line
      .split(/[\s,;{}()[\].=+\-*/<>!&|^~?:@#]+/)
      .filter((t) => t.length > 0);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function findLastIndex<T>(
  arr: T[],
  predicate: (item: T) => boolean,
): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i];
    if (item && predicate(item)) {
      return i;
    }
  }
  return -1;
}
