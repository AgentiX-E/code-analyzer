// @code-analyzer/intelligence — Comment Reflection Module
// Post-review validation system that audits review comment quality.
// Validates position accuracy, content relevance, rule compliance,
// and adjusts positioning drift. Generates a reflection report
// summarizing review quality metrics.

import type { ReviewComment } from '@code-analyzer/shared';
import { CommentPositioner, type PositionedComment } from './comment-positioner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReflectionResult {
  /** Original comment (may be adjusted). */
  comment: PositionedComment;
  /** Whether the comment passed all quality checks. */
  passed: boolean;
  /** Specific quality issues found. */
  issues: ReflectionIssue[];
  /** Adjusted position if drift was detected. */
  adjustedPosition?: { startLine: number; endLine: number };
}

export interface ReflectionIssue {
  /** Type of quality issue detected. */
  type: 'position_invalid' | 'position_out_of_bounds' | 'empty_content' |
       'duplicate' | 'low_confidence' | 'irrelevant_context';
  /** Human-readable description of the issue. */
  message: string;
  /** Severity of the issue. */
  severity: 'error' | 'warning' | 'info';
}

export interface ReflectionReport {
  /** Total number of comments reviewed. */
  totalComments: number;
  /** Number of comments that passed all checks. */
  passedComments: number;
  /** Number of comments with issues. */
  failedComments: number;
  /** Number of comments with adjusted positions. */
  relocatedComments: number;
  /** Overall quality score (0-1). */
  qualityScore: number;
  /** Breakdown by issue type. */
  issueBreakdown: Record<string, number>;
  /** Per-comment results. */
  results: ReflectionResult[];
  /** Timestamp of the reflection run. */
  timestamp: string;
}

export interface ReflectionOptions {
  /** Minimum confidence threshold (comments below this are flagged). */
  minConfidence: number;
  /** Maximum line distance for position validation (lines beyond this are relocated). */
  maxPositionDrift: number;
  /** Whether to auto-adjust positions that drift (default: true). */
  autoAdjustPositions: boolean;
  /** Whether to filter out low-confidence comments (default: false). */
  filterLowConfidence: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: ReflectionOptions = {
  minConfidence: 0.3,
  maxPositionDrift: 10,
  autoAdjustPositions: true,
  filterLowConfidence: false,
};

// ---------------------------------------------------------------------------
// Comment Reflection Module
// ---------------------------------------------------------------------------

export class CommentReflectionModule {
  private readonly positioner: CommentPositioner;
  private readonly options: ReflectionOptions;

  constructor(options: Partial<ReflectionOptions> = {}) {
    this.positioner = new CommentPositioner();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Reflect on a set of review comments against the actual file content.
   * Validates positions, detects drift, filters low-quality comments,
   * and generates a quality report.
   *
   * @param comments — review comments to validate
   * @param fileContent — the actual file content at the target state
   * @param filePath — the file path these comments refer to
   * @returns ReflectionReport with quality metrics and adjusted comments
   */
  reflect(
    comments: ReviewComment[],
    fileContent: string,
    filePath: string,
  ): ReflectionReport {
    const fileLines = fileContent.split('\n');
    const totalLines = fileLines.length;

    // Pre-position: run raw bounds and inverted-range checks on original comments
    // BEFORE CommentPositioner clamps them — so we catch genuine out-of-bounds.
    const preIssues: Map<number, ReflectionIssue[]> = new Map();
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i]!;
      const raw: ReflectionIssue[] = [];

      if (c.startLine > c.endLine) {
        raw.push({
          type: 'position_out_of_bounds',
          message: `Inverted line range: startLine ${c.startLine} > endLine ${c.endLine}`,
          severity: 'error',
        });
      }

      if (c.startLine > totalLines || c.endLine < 1) {
        raw.push({
          type: 'position_out_of_bounds',
          message: `startLine ${c.startLine} exceeds file length ${totalLines}`,
          severity: 'error',
        });
      }

      if (raw.length > 0) {
        preIssues.set(i, raw);
      }
    }

    const positioned = comments.map((c) =>
      this.positioner.positionComment(c, fileContent),
    );

    const results: ReflectionResult[] = [];
    let passedComments = 0;
    let failedComments = 0;
    let relocatedComments = 0;
    const issueBreakdown: Record<string, number> = {};

    for (let i = 0; i < positioned.length; i++) {
      const comment = positioned[i]!;
      const issues: ReflectionIssue[] = [...(preIssues.get(i) ?? [])];

      // Check 1: Position validity
      const posResult = this.positioner.validatePosition(comment, fileContent);
      if (!posResult.valid) {
        issues.push({
          type: 'position_invalid',
          message: posResult.reason ?? 'Invalid comment position',
          severity: 'error',
        });
      }

      // Check 3: Empty content
      if (!comment.content || comment.content.trim().length === 0) {
        issues.push({
          type: 'empty_content',
          message: 'Comment content is empty',
          severity: 'warning',
        });
      }

      // Check 4: Low confidence
      if (comment.positionConfidence < this.options.minConfidence) {
        issues.push({
          type: 'low_confidence',
          message: `Position confidence ${comment.positionConfidence.toFixed(2)} below threshold ${this.options.minConfidence}`,
          severity: 'warning',
        });
      }

      // Check 5: Context relevance — verify existingCode has some overlap with file content
      if (comment.existingCode && comment.existingCode.trim().length > 0) {
        const contentOverlap = this.checkContentRelevance(
          comment.existingCode,
          fileContent,
          comment.startLine,
          comment.endLine,
        );
        if (!contentOverlap) {
          issues.push({
            type: 'irrelevant_context',
            message: 'Comment context does not match file content at claimed position',
            severity: 'warning',
          });
        }
      }

      // Determine if comment passed
      const hasErrors = issues.some((i) => i.severity === 'error');
      const passed = !hasErrors;

      if (passed) {
        passedComments++;
      } else {
        failedComments++;
      }

      // Auto-adjust positions if enabled
      let adjustedPosition: { startLine: number; endLine: number } | undefined;
      if (this.options.autoAdjustPositions && posResult.adjustedStartLine !== undefined) {
        adjustedPosition = {
          startLine: posResult.adjustedStartLine,
          endLine: posResult.adjustedEndLine ?? comment.endLine,
        };
        relocatedComments++;
      }

      // Track issue breakdown
      for (const issue of issues) {
        issueBreakdown[issue.type] = (issueBreakdown[issue.type] ?? 0) + 1;
      }

      results.push({
        comment: adjustedPosition
          ? { ...comment, ...adjustedPosition, positionMethod: 'heuristic' as const, positionConfidence: 0.5 }
          : comment,
        passed,
        issues,
        adjustedPosition,
      });
    }

    // Detect duplicates
    const duplicateResults = this.detectDuplicates(results);
    for (const dup of duplicateResults) {
      if (!dup.passed) {
        failedComments++;
      }
      issueBreakdown['duplicate'] = (issueBreakdown['duplicate'] ?? 0) + 1;
    }

    // Filter low confidence if enabled
    if (this.options.filterLowConfidence) {
      const filtered = results.filter((r) => {
        const isLowConf = r.comment.positionConfidence < this.options.minConfidence;
        if (isLowConf) {
          failedComments++;
          issueBreakdown['filtered_low_confidence'] = (issueBreakdown['filtered_low_confidence'] ?? 0) + 1;
        }
        return !isLowConf;
      });

      const qualityScore = this.calculateQualityScore(
        passedComments,
        failedComments,
        results.length,
      );

      return {
        totalComments: comments.length,
        passedComments,
        failedComments,
        relocatedComments,
        qualityScore,
        issueBreakdown,
        results: filtered,
        timestamp: new Date().toISOString(),
      };
    }

    const qualityScore = this.calculateQualityScore(
      passedComments,
      failedComments,
      results.length,
    );

    return {
      totalComments: comments.length,
      passedComments,
      failedComments,
      relocatedComments,
      qualityScore,
      issueBreakdown,
      results,
      timestamp: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if the existingCode snippet has meaningful overlap with the
   * file content at the claimed position.
   */
  private checkContentRelevance(
    existingCode: string,
    fileContent: string,
    startLine: number,
    endLine: number,
  ): boolean {
    const fileLines = fileContent.split('\n');
    const existingLines = existingCode
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (existingLines.length === 0) return false;

    const fileSnippet = fileLines
      .slice(startLine - 1, endLine)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (fileSnippet.length === 0) return false;

    // Check if at least 30% of existing code lines appear in the file snippet
    let matchCount = 0;
    for (const line of existingLines) {
      if (fileSnippet.some((fl) => fl.includes(line) || line.includes(fl))) {
        matchCount++;
      }
    }

    return matchCount / existingLines.length >= 0.3;
  }

  /**
   * Detect duplicate comments by comparing content similarity and
   * line range overlap.
   */
  private detectDuplicates(results: ReflectionResult[]): ReflectionResult[] {
    const duplicates: ReflectionResult[] = [];
    const overlapThreshold = 1;

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const a = results[i]!;
        const b = results[j]!;

        const lineOverlap = Math.max(
          0,
          Math.min(a.comment.endLine, b.comment.endLine) -
            Math.max(a.comment.startLine, b.comment.startLine) +
            1,
        );

        const contentSimilarity = this.contentSimilarity(
          a.comment.content,
          b.comment.content,
        );

        if (lineOverlap >= overlapThreshold && contentSimilarity >= 0.7) {
          if (!a.issues.some((iss) => iss.type === 'duplicate')) {
            a.issues.push({
              type: 'duplicate',
              message: `Duplicate of comment with similar content at overlapping range`,
              severity: 'warning',
            });
            a.passed = false;
          }
          if (!duplicates.includes(a)) {
            duplicates.push(a);
          }
        }
      }
    }

    return duplicates;
  }

  /**
   * Compute content similarity between two strings using
   * token-based Jaccard similarity.
   */
  private contentSimilarity(a: string, b: string): number {
    const tokensA = new Set(
      a.toLowerCase().split(/[\s,;:.!?()[\]{}'"]+/).filter((t) => t.length > 2),
    );
    const tokensB = new Set(
      b.toLowerCase().split(/[\s,;:.!?()[\]{}'"]+/).filter((t) => t.length > 2),
    );

    if (tokensA.size === 0 && tokensB.size === 0) return 1;
    const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
    const union = new Set([...tokensA, ...tokensB]);

    return intersection.size / union.size;
  }

  /**
   * Calculate overall quality score based on passed/failed ratio.
   */
  private calculateQualityScore(
    passed: number,
    failed: number,
    total: number,
  ): number {
    if (total === 0) return 1;
    return Math.round((passed / total) * 100) / 100;
  }
}
