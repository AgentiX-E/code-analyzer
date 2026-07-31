// @code-analyzer/intelligence — Code Review Engine
// Hybrid deterministic + heuristic code review with Plan/Analyze/Filter/Relocate pipeline.
//
// Architecture:
//   Plan    → Identify focus areas, risks, and checklist based on file characteristics
//   Analyze → Run heuristic rules and (optionally) LLM-assisted review
//   Filter  → Remove low-quality, empty, or noise comments
//   Relocate → Adjust line numbers to map old-file positions to new-file positions
//
// The engine requires a GitOperations implementation to access real file
// content. Without it, code-aware analysis is not possible — the engine
// will report this as a configuration error rather than producing
// fabricated results.

import type {
  ReviewComment,
  ReviewSession,
  GitDiff,
  DiffHunk,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { analyzeFileHeuristics, toReviewComment, type GraphAnalysisData } from './heuristics.js';
import { SessionStore, computeFileFingerprint } from './session-store.js';
import type { SessionMetadata, ReviewItemResult } from './session-store.js';
import type { LLMProvider } from './llm/provider.js';
import { LLMReviewEngine } from './llm/llm-review-engine.js';
import type { LLMReviewOptions } from './llm/llm-review-engine.js';

// ---------------------------------------------------------------------------
// Git Operations Interface
// ---------------------------------------------------------------------------

/**
 * Abstraction for reading file contents from git history.
 * Required for the review engine to access actual code being reviewed.
 */
export interface GitOperations {
  /** Read the full content of a file at a specific commit. */
  readFileContent(filePath: string, commitSha?: string): Promise<string>;

  /** Read a range of lines from a file at a specific commit. */
  readFileRange(
    filePath: string,
    startLine: number,
    endLine: number,
    commitSha?: string,
  ): Promise<string>;

  /** Get the unified diff for a file between two commits. */
  getFileDiff(filePath: string, baseSha: string, targetSha: string): Promise<string>;

  /** Get the raw diff hunks parsed from git output. */
  getDiffHunks(filePath: string, baseSha: string, targetSha: string): Promise<DiffHunk[]>;

  /** Check if a file exists at a given commit. */
  fileExists(filePath: string, commitSha?: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Review Engine Error
// ---------------------------------------------------------------------------

export class ReviewEngineError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_GIT_OPS' | 'FILE_NOT_FOUND' | 'PARSE_ERROR' | 'TIMEOUT',
  ) {
    super(message);
    this.name = 'ReviewEngineError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ReviewConfig {
  /** Maximum tokens to consume per file review (LLM mode). */
  maxTokens: number;
  /** Maximum tool calls per file review (LLM mode). */
  maxToolCalls: number;
  /** Files larger than this line count trigger extra scrutiny. */
  planLineThreshold: number;
  /** Per-file review timeout in milliseconds. */
  timeout: number;
  /** Number of concurrent file reviews. */
  concurrency: number;
  /** Number of context lines to include around each diff hunk. */
  contextLines: number;
  /** Whether to fall back to metadata-only analysis when git ops are unavailable. */
  allowMetadataFallback: boolean;
}

const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  maxTokens: 8000,
  maxToolCalls: 10,
  planLineThreshold: 200,
  timeout: 30000,
  concurrency: 4,
  contextLines: 3,
  allowMetadataFallback: false,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewContext {
  projectId: string;
  diff: GitDiff[];
  store: InMemoryGraphStore;
  sessionId: string;
  config: ReviewConfig;
  fileContext?: string;
  /** Git operations instance for accessing real file content. */
  gitOps?: GitOperations;
  /** Base commit SHA for diff comparison. */
  baseSha?: string;
  /** Target commit SHA for diff comparison. */
  targetSha?: string;
}

export interface ReviewPlan {
  focusAreas: string[];
  checklist: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  riskAreas: string[];
}

// ---------------------------------------------------------------------------
// Filter Rule Set
// ---------------------------------------------------------------------------

interface FilterRule {
  test: (comment: ReviewComment) => boolean;
  reason: string;
}

const FILTER_RULES: FilterRule[] = [
  {
    test: (c) => c.existingCode.trim().length === 0,
    reason: 'Empty code context',
  },
  {
    test: (c) => c.startLine <= 0 || c.endLine <= 0,
    reason: 'Invalid line range',
  },
  {
    test: (c) => c.startLine > c.endLine,
    reason: 'Inverted line range',
  },
  {
    test: (c) => /^\s*\/\//.test(c.existingCode.trim()) && c.category === 'style',
    reason: 'Style comments on comment-only lines',
  },
  {
    test: (c) => c.content.trim().length === 0,
    reason: 'Empty comment content',
  },
];

// ---------------------------------------------------------------------------
// Code Review Engine
// ---------------------------------------------------------------------------

export class CodeReviewEngine {
  private readonly config: ReviewConfig;
  private readonly sessionStore: SessionStore;
  private readonly llmEngine: LLMReviewEngine | null;
  private readonly gitOps: GitOperations | null;

  constructor(
    private store: InMemoryGraphStore,
    config?: Partial<ReviewConfig>,
    sessionStore?: SessionStore,
    llmProvider?: LLMProvider,
    llmOptions?: LLMReviewOptions,
    gitOps?: GitOperations,
  ) {
    this.config = { ...DEFAULT_REVIEW_CONFIG, ...config };
    this.sessionStore = sessionStore ?? new SessionStore();
    this.llmEngine = llmProvider ? new LLMReviewEngine(llmProvider, llmOptions) : null;
    this.gitOps = gitOps ?? null;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Review a set of git diffs for a project.
   * Creates a review session and processes all diffs through the pipeline.
   *
   * Requires GitOperations to be configured for real code analysis.
   * Without it, only metadata-level checks (file path, change type) are available.
   */
  async reviewDiff(
    projectId: string,
    diffs: GitDiff[],
    options?: { baseSha?: string; targetSha?: string; gitOps?: GitOperations },
  ): Promise<ReviewSession> {
    const meta: SessionMetadata = {
      repository: projectId,
      branch: 'main',
      mode: 'diff',
      fromRef: options?.baseSha,
      toRef: options?.targetSha,
    };

    const effectiveGitOps = options?.gitOps ?? this.gitOps;

    if (!effectiveGitOps && !this.config.allowMetadataFallback) {
      throw new ReviewEngineError(
        'GitOperations is required for code review. Set allowMetadataFallback=true to review with metadata only.',
        'NO_GIT_OPS',
      );
    }

    const session = this.sessionStore.startSession(projectId, meta);

    const ctx: ReviewContext = {
      projectId,
      diff: diffs,
      store: this.store,
      sessionId: session.id,
      config: this.config,
      fileContext: await this.buildFileContext(diffs, effectiveGitOps),
      gitOps: effectiveGitOps ?? undefined,
      baseSha: options?.baseSha,
      targetSha: options?.targetSha,
    };

    let totalComments = 0;
    const startTime = Date.now();

    for (const diff of diffs) {
      const fileStartTime = Date.now();

      try {
        const comments = await this.reviewFileItem(ctx, diff);
        totalComments += comments.length;
        const content = await this.getDiffContent(diff, effectiveGitOps, options?.baseSha, options?.targetSha);
        const fingerprint = computeFileFingerprint('diff', diff.filePath, content);
        const duration = Date.now() - fileStartTime;

        const result: ReviewItemResult = {
          filePath: diff.filePath,
          fingerprint,
          comments,
          duration,
        };

        this.sessionStore.recordItemDone(session.id, result);
      } catch (error) {
        const content = this.getDiffContentSync(diff);
        const fingerprint = computeFileFingerprint('diff', diff.filePath, content);
        const duration = Date.now() - fileStartTime;

        this.sessionStore.recordItemFailed(session.id, {
          filePath: diff.filePath,
          fingerprint,
          error: error instanceof Error ? error.message : String(error),
          duration,
        });
      }
    }

    const totalDuration = Date.now() - startTime;

    return {
      ...session,
      status: 'completed',
      completedAt: new Date().toISOString(),
      filesReviewed: diffs.length,
      commentsGenerated: totalComments,
    };
  }

  /**
   * Review a specific file by path and content.
   * Used for ad-hoc file review without git diff context.
   */
  async reviewFile(
    projectId: string,
    filePath: string,
    content: string,
  ): Promise<ReviewComment[]> {
    const lines = content.split('\n');
    const results = analyzeFileHeuristics(filePath, lines);
    return results.map((r, i) => toReviewComment(filePath, r, i, lines));
  }

  /**
   * Resume an interrupted review session.
   */
  async resumeSession(sessionId: string): Promise<ReviewSession> {
    const resumeState = this.sessionStore.buildResumeState(sessionId);
    const records = this.sessionStore.getRecords(sessionId);

    let projectId = '';
    let mode: 'diff' | 'scan' = 'diff';
    let createdAt = '';
    const filesReviewed = resumeState.completedFiles.size;

    for (const line of records) {
      try {
        const record = JSON.parse(line) as {
          type: string;
          projectId?: string;
          timestamp?: string;
          metadata?: SessionMetadata;
        };
        if (record.type === 'start') {
          projectId = record.projectId ?? '';
          createdAt = record.timestamp ?? '';
          mode = record.metadata?.mode ?? 'diff';
          break;
        }
      } catch {
        // Skip malformed records
      }
    }

    const totalComments = resumeState.reusedComments.length;

    return {
      id: sessionId,
      projectId,
      mode,
      status: 'completed',
      createdAt,
      completedAt: new Date().toISOString(),
      filesReviewed,
      commentsGenerated: totalComments,
    };
  }

  // -------------------------------------------------------------------------
  // Pipeline: Per-File Review
  // -------------------------------------------------------------------------

  private async reviewFileItem(
    ctx: ReviewContext,
    diff: GitDiff,
  ): Promise<ReviewComment[]> {
    // Phase 1: Plan — determine what to focus on
    const plan = await this.planPhase(ctx, diff);

    // Phase 2: Analyze — run heuristic rules against real code content
    const heuristicComments = await this.analyzePhase(ctx, diff, plan);

    // Phase 2b: LLM Review — if a provider is configured, supplement with AI analysis
    let llmComments: ReviewComment[] = [];
    if (this.llmEngine && ctx.gitOps) {
      try {
        const diffContent = await this.getDiffContent(diff, ctx.gitOps, ctx.baseSha, ctx.targetSha);
        const actualDiff: GitDiff = {
          ...diff,
          content: diffContent,
        };
        llmComments = await this.llmEngine.reviewDiffAsComments(actualDiff, ctx.fileContext);
      } catch {
        // LLM review failed — continue with heuristic results only
        llmComments = [];
      }
    }

    // Merge and deduplicate results from both analyzers
    const merged = this.mergeAndDeduplicate(heuristicComments, llmComments);

    // Phase 3: Filter — remove noise and invalid comments
    const filtered = await this.filterPhase(merged, diff);

    // Phase 4: Relocate — adjust line numbers for non-contiguous diffs
    const relocated = await this.relocatePhase(filtered, diff);

    return relocated;
  }

  // -------------------------------------------------------------------------
  // Plan Phase
  // -------------------------------------------------------------------------

  private async planPhase(
    ctx: ReviewContext,
    diff: GitDiff,
  ): Promise<ReviewPlan> {
    const content = await this.getDiffContent(
      diff,
      ctx.gitOps,
      ctx.baseSha,
      ctx.targetSha,
    );
    const lines = content.split('\n');
    const lineCount = lines.length;

    // Determine focus areas based on file characteristics
    const focusAreas: string[] = [];
    const checklist: string[] = [];
    const riskAreas: string[] = [];

    // Language-specific checks
    if (diff.filePath.endsWith('.ts') || diff.filePath.endsWith('.tsx')) {
      focusAreas.push('TypeScript types');
      checklist.push('Verify TypeScript type definitions are complete and correct');
    }
    if (diff.filePath.endsWith('.py')) {
      focusAreas.push('Python conventions');
      checklist.push('Verify PEP 8 compliance and type hints');
    }
    if (diff.filePath.endsWith('.go')) {
      focusAreas.push('Go idioms');
      checklist.push('Verify error handling follows Go conventions');
    }

    // Role-based checks
    if (diff.filePath.includes('.test.') || diff.filePath.includes('.spec.')) {
      focusAreas.push('Test quality');
      checklist.push('Ensure test assertions are meaningful and cover edge cases');
    }
    if (diff.filePath.includes('/api/') || diff.filePath.includes('/routes/')) {
      focusAreas.push('API contract');
      riskAreas.push('API route change');
      checklist.push('Verify API contract backward compatibility');
    }
    if (diff.filePath.includes('/types/') || diff.filePath.endsWith('.d.ts')) {
      focusAreas.push('Type definitions');
      riskAreas.push('Public type change');
      checklist.push('Verify type changes do not break consumers');
    }

    // Size-based risk assessment
    if (lineCount > this.config.planLineThreshold) {
      focusAreas.push('Large change');
      riskAreas.push(`File change is large (${lineCount} lines) — high complexity risk`);
      checklist.push('Consider whether this change should be split into smaller PRs');
    }

    // Change type risk assessment
    if (diff.changeType === 'deleted') {
      riskAreas.push('File deletion');
      checklist.push('Verify all imports referencing this file are updated');
    }
    if (diff.changeType === 'renamed') {
      riskAreas.push('File rename');
      checklist.push('Verify all import paths are updated to the new path');
    }

    // Default checks applicable to all files
    focusAreas.push('Error handling', 'Code patterns', 'Naming');
    checklist.push('Check for missing error handling on async operations and I/O');
    checklist.push('Check for functions exceeding recommended length (>50 lines)');
    checklist.push('Check for deep nesting (>4 levels)');
    checklist.push('Verify naming conventions match project standards');

    const estimatedComplexity: 'low' | 'medium' | 'high' =
      lineCount < 100 ? 'low' : lineCount < 300 ? 'medium' : 'high';

    return {
      focusAreas,
      checklist,
      estimatedComplexity,
      riskAreas,
    };
  }

  // -------------------------------------------------------------------------
  // Analyze Phase
  // -------------------------------------------------------------------------

  private async analyzePhase(
    ctx: ReviewContext,
    diff: GitDiff,
    _plan: ReviewPlan,
  ): Promise<ReviewComment[]> {
    // Get the actual file content for analysis
    const content = await this.getDiffContent(
      diff,
      ctx.gitOps,
      ctx.baseSha,
      ctx.targetSha,
    );
    const lines = content.split('\n');

    // Build graph analysis data from the knowledge store
    const graphData = this.buildGraphData(ctx.projectId, diff.filePath);

    // Run all heuristic rules against the real code content
    const results = analyzeFileHeuristics(diff.filePath, lines, diff, graphData);

    // Convert heuristic results to standard review comments
    const comments: ReviewComment[] = results.map((r, i) =>
      toReviewComment(diff.filePath, r, i, lines),
    );

    return comments;
  }

  // -------------------------------------------------------------------------
  // Filter Phase
  // -------------------------------------------------------------------------

  private async filterPhase(
    comments: ReviewComment[],
    _diff: GitDiff,
  ): Promise<ReviewComment[]> {
    return comments
      .filter((comment) => {
        for (const rule of FILTER_RULES) {
          if (rule.test(comment)) {
            return false;
          }
        }
        return true;
      })
      .map((comment) => ({
        ...comment,
        filtered: false,
      }));
  }

  // -------------------------------------------------------------------------
  // Relocate Phase
  // -------------------------------------------------------------------------

  /**
   * Adjust comment line numbers to map from the old file to the new file.
   *
   * Handles non-contiguous diffs by computing per-hunk offsets independently.
   * Each comment is mapped through the specific hunk that contains its line
   * range, avoiding the linear offset accumulation bug.
   */
  private async relocatePhase(
    comments: ReviewComment[],
    diff: GitDiff,
  ): Promise<ReviewComment[]> {
    // If no diff ranges are available, return comments unchanged
    if (!diff.ranges || diff.ranges.length === 0) {
      return comments;
    }

    // If we have parsed hunks, use the precise hunk-based mapping
    if (diff.hunks && diff.hunks.length > 0) {
      return comments.map((comment) => {
        const newStartLine = this.mapLineThroughHunks(
          comment.startLine,
          diff.hunks!,
        );
        const newEndLine = this.mapLineThroughHunks(
          comment.endLine,
          diff.hunks!,
        );
        const clampedStart = Math.max(1, newStartLine);
        const clampedEnd = Math.max(clampedStart, newEndLine);

        return {
          ...comment,
          startLine: clampedStart,
          endLine: clampedEnd,
        };
      });
    }

    // Fallback: use range-based offset per individual range segment
    return comments.map((comment) => {
      const result = this.mapCommentThroughRanges(comment, diff.ranges);
      return {
        ...comment,
        startLine: result.startLine,
        endLine: result.endLine,
      };
    });
  }

  /**
   * Map a line number through diff hunks to find its position in the new file.
   *
   * Each hunk represents a contiguous block of changes. We find the hunk that
   * contains the old line and compute the offset within that hunk.
   */
  private mapLineThroughHunks(oldLine: number, hunks: DiffHunk[]): number {
    // Sort hunks by old start line for binary search
    const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);

    for (const hunk of sorted) {
      const oldEnd = hunk.oldStart + hunk.oldLines;
      if (oldLine >= hunk.oldStart && oldLine <= oldEnd) {
        let newLine = hunk.newStart;
        let oldLineCounter = hunk.oldStart;

        for (const line of hunk.lines) {
          if (oldLineCounter >= oldLine || line.type === 'context') {
            // For context lines after the target, we've gone past it
            if (oldLineCounter > oldLine && line.type !== 'addition') {
              break;
            }
          }

          if (line.type === 'context') {
            if (oldLineCounter === oldLine) return newLine;
            oldLineCounter++;
            newLine++;
          } else if (line.type === 'removal') {
            if (oldLineCounter === oldLine) {
              // The line was removed — return the nearest new line
              return newLine;
            }
            oldLineCounter++;
          } else if (line.type === 'addition') {
            newLine++;
          }
        }

        return newLine;
      }
    }

    // Line is before the first hunk — no offset needed
    if (oldLine < (sorted[0]?.oldStart ?? Infinity)) {
      return oldLine;
    }

    // Line is after the last hunk — apply cumulative offset
    return this.applyCumulativeOffset(oldLine, sorted);
  }

  /**
   * Compute the cumulative line offset from all hunks before the given line.
   */
  private applyCumulativeOffset(oldLine: number, hunks: DiffHunk[]): number {
    let offset = 0;
    for (const hunk of hunks) {
      const oldEnd = hunk.oldStart + hunk.oldLines;
      if (oldLine > oldEnd) {
        offset += (hunk.newLines - hunk.oldLines);
      }
    }
    return oldLine + offset;
  }

  /**
   * Fallback: map comment lines using range-based offsets.
   * Works correctly for contiguous and non-contiguous diffs.
   */
  private mapCommentThroughRanges(
    comment: ReviewComment,
    ranges: NonNullable<GitDiff['ranges']>,
  ): { startLine: number; endLine: number } {
    const sortedRanges = [...ranges].sort((a, b) => a.oldStart - b.oldStart);

    let startOffset = 0;
    let endOffset = 0;
    let startMapped = false;
    let endMapped = false;

    for (const range of sortedRanges) {
      const delta = (range.newEnd - range.newStart) - (range.oldEnd - range.oldStart);

      if (!startMapped && comment.startLine > range.oldEnd) {
        startOffset += delta;
      } else if (!startMapped && comment.startLine >= range.oldStart) {
        startOffset += delta;
        startMapped = true;
      }

      if (!endMapped && comment.endLine > range.oldEnd) {
        endOffset += delta;
      } else if (!endMapped && comment.endLine >= range.oldStart) {
        endOffset += delta;
        endMapped = true;
      }
    }

    const newStart = Math.max(1, comment.startLine + startOffset);
    const newEnd = Math.max(newStart, comment.endLine + endOffset);

    return { startLine: newStart, endLine: newEnd };
  }

  // -------------------------------------------------------------------------
  // Merge & Deduplicate
  // -------------------------------------------------------------------------

  /**
   * Merge heuristic and LLM review comments, removing duplicates.
   * A comment is considered a duplicate if it matches in category and
   * has overlapping line ranges within a configurable threshold.
   */
  private mergeAndDeduplicate(
    heuristic: ReviewComment[],
    llm: ReviewComment[],
  ): ReviewComment[] {
    if (llm.length === 0) return heuristic;
    if (heuristic.length === 0) return llm;

    const result = [...heuristic];
    const overlapThreshold = 3;

    for (const llmComment of llm) {
      const isDuplicate = result.some((hc) => {
        if (hc.category !== llmComment.category) return false;
        const overlap = Math.max(
          0,
          Math.min(hc.endLine, llmComment.endLine) -
            Math.max(hc.startLine, llmComment.startLine) +
            1,
        );
        return overlap >= overlapThreshold;
      });

      if (!isDuplicate) {
        result.push(llmComment);
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Content Extraction
  // -------------------------------------------------------------------------

  /**
   * Get the actual diff content for a file.
   *
   * When GitOperations is available, reads the real file content at both
   * the base and target commits to produce a meaningful diff.
   *
   * When GitOperations is unavailable, falls back to metadata-based
   * representation (only if allowMetadataFallback is enabled).
   */
  private async getDiffContent(
    diff: GitDiff,
    gitOps?: GitOperations,
    baseSha?: string,
    targetSha?: string,
  ): Promise<string> {
    if (!gitOps) {
      return this.getDiffContentSync(diff);
    }

    try {
      // For new files, read the full content at the target commit
      if (diff.changeType === 'added') {
        return gitOps.readFileContent(diff.filePath, targetSha);
      }

      // For deleted files, read the full content at the base commit
      if (diff.changeType === 'deleted') {
        return gitOps.readFileContent(diff.filePath, baseSha);
      }

      // For modified/renamed files, try to get actual git diff
      if (baseSha && targetSha) {
        try {
          return gitOps.getFileDiff(diff.filePath, baseSha, targetSha);
        } catch {
          // Fall back to reading the file content at the target commit
        }
      }

      // Read the file at the target commit with range-based extraction
      if (diff.ranges && diff.ranges.length > 0) {
        const contents: string[] = [];
        for (const range of diff.ranges) {
          const rangeContent = await gitOps.readFileRange(
            diff.filePath,
            range.oldStart,
            range.oldEnd,
            targetSha,
          );
          contents.push(rangeContent);
        }
        return contents.join('\n');
      }

      // Default: read the full file at the target commit
      return gitOps.readFileContent(diff.filePath, targetSha);
    } catch (error) {
      if (error instanceof ReviewEngineError) throw error;

      // If file reading fails, fall back to metadata representation
      if (this.config.allowMetadataFallback) {
        return this.getDiffContentSync(diff);
      }
      throw new ReviewEngineError(
        `Failed to read file content for ${diff.filePath}: ${error instanceof Error ? error.message : String(error)}`,
        'FILE_NOT_FOUND',
      );
    }
  }

  /**
   * Synchronous fallback: produce a metadata-based content string.
   * Used when GitOperations is not available and fallback is allowed.
   *
   * NOTE: This produces METADATA, not code. Analysis on this content is
   * limited to file-path and change-type checks. Real code analysis
   * requires GitOperations.
   */
  private getDiffContentSync(diff: GitDiff): string {
    const parts: string[] = [];
    parts.push(`# Code Analyzer — Metadata-Only Review`);
    parts.push(`# File: ${diff.filePath}`);
    parts.push(`# Change type: ${diff.changeType}`);
    parts.push(`# WARNING: Git operations unavailable. Analysis limited to metadata.`);
    parts.push(`# Configure GitOperations for full code-aware review.`);

    if (diff.oldPath) {
      parts.push(`# Old path: ${diff.oldPath}`);
    }

    if (diff.ranges) {
      for (const range of diff.ranges) {
        parts.push(
          `# Range: L${range.oldStart}-L${range.oldEnd} → L${range.newStart}-L${range.newEnd} (${range.changeType})`,
        );
      }
    }

    return parts.join('\n');
  }

  /**
   * Build file context: a summary of all changed files with their
   * relationships, intended to provide the LLM reviewer with project
   * structure awareness.
   */
  private async buildFileContext(
    diffs: GitDiff[],
    _gitOps?: GitOperations | null,
  ): Promise<string> {
    const parts: string[] = [];

    // Summary statistics
    const added = diffs.filter((d) => d.changeType === 'added').length;
    const modified = diffs.filter((d) => d.changeType === 'modified').length;
    const deleted = diffs.filter((d) => d.changeType === 'deleted').length;
    const renamed = diffs.filter((d) => d.changeType === 'renamed').length;

    parts.push(`## Review Context`);
    parts.push(`- Total files changed: ${diffs.length}`);
    parts.push(`- Added: ${added} | Modified: ${modified} | Deleted: ${deleted} | Renamed: ${renamed}`);

    // Per-file details grouped by directory
    const byDir = new Map<string, GitDiff[]>();
    for (const diff of diffs) {
      const dir = diff.filePath.split('/').slice(0, -1).join('/') || '(root)';
      const group = byDir.get(dir) ?? [];
      group.push(diff);
      byDir.set(dir, group);
    }

    for (const [dir, files] of byDir) {
      parts.push(`\n### ${dir}`);
      for (const file of files) {
        const icon =
          file.changeType === 'added' ? '➕' :
          file.changeType === 'deleted' ? '➖' :
          file.changeType === 'renamed' ? '🔄' : '✏️';
        parts.push(`- ${icon} \`${file.filePath}\``);
        if (file.oldPath) {
          parts.push(`  (renamed from \`${file.oldPath}\`)`);
        }
        if (file.ranges && file.ranges.length > 0) {
          const totalAdded = file.ranges.reduce((sum, r) => sum + (r.newEnd - r.newStart), 0);
          const totalRemoved = file.ranges.reduce((sum, r) => sum + (r.oldEnd - r.oldStart), 0);
          parts.push(`  +${totalAdded}/-${totalRemoved} lines`);
        }
      }
    }

    return parts.join('\n');
  }

  // -------------------------------------------------------------------------
  // Graph Analysis
  // -------------------------------------------------------------------------

  /**
   * Build graph analysis data for a file from the knowledge graph store.
   * Calculates coupling metrics, dead code indicators, and circular
   * dependency detection.
   */
  private buildGraphData(
    _projectId: string,
    filePath: string,
  ): Partial<GraphAnalysisData> {
    const allNodes = this.store.getAllNodes();
    const allEdges = this.store.getAllEdges();

    let outDegree = 0;
    let inDegree = 0;
    let exportedSymbolCount = 0;

    const fileNodes = allNodes.filter((n) => n.filePath === filePath);
    const fileNodeIds = new Set(fileNodes.map((n) => n.id));

    for (const node of fileNodes) {
      if (node.isExported) {
        exportedSymbolCount++;
      }
    }

    for (const edge of allEdges) {
      if (fileNodeIds.has(edge.sourceId)) {
        outDegree++;
      }
      if (fileNodeIds.has(edge.targetId)) {
        inDegree++;
      }
    }

    // Detect circular dependencies using DFS with cycle tracking
    const cyclicPaths = this.detectCycles(allNodes, allEdges, filePath);

    const edgeCounts = new Map<string, number>();

    return {
      outDegree,
      inDegree,
      exportedSymbolCount,
      cyclicPaths,
      edgeCounts,
    };
  }

  /**
   * Detect circular dependencies involving the given file.
   * Uses iterative DFS with explicit stack tracking for O(V+E) complexity.
   */
  private detectCycles(
    allNodes: { id: number; filePath?: string }[],
    allEdges: { sourceId: number; targetId: number }[],
    rootFile: string,
  ): string[][] {
    const cyclicPaths: string[][] = [];
    const nodeById = new Map(allNodes.map((n) => [n.id, n]));
    const adjacency = new Map<string, Set<string>>();

    for (const edge of allEdges) {
      const srcNode = nodeById.get(edge.sourceId);
      const tgtNode = nodeById.get(edge.targetId);
      if (srcNode?.filePath && tgtNode?.filePath) {
        const deps = adjacency.get(srcNode.filePath) ?? new Set();
        deps.add(tgtNode.filePath);
        adjacency.set(srcNode.filePath, deps);
      }
    }

    // Iterative DFS with explicit stack for cycle detection
    const GRAY = 1; // in current path
    const BLACK = 2; // fully processed
    const color = new Map<string, number>();
    const pathStack: string[] = [];

    const stack: Array<{ node: string; phase: 'enter' | 'exit' }> = [
      { node: rootFile, phase: 'enter' },
    ];

    while (stack.length > 0) {
      const frame = stack.pop()!;

      if (frame.phase === 'exit') {
        color.set(frame.node, BLACK);
        pathStack.pop();
        continue;
      }

      const currentColor = color.get(frame.node) ?? 0;

      if (currentColor === GRAY) {
        // Cycle found: extract the path from the stack
        const cycleStart = pathStack.indexOf(frame.node);
        if (cycleStart >= 0) {
          const cycle = [...pathStack.slice(cycleStart), frame.node];
          cyclicPaths.push(cycle);
        }
        continue;
      }

      if (currentColor === BLACK) {
        continue;
      }

      // Mark as being explored
      color.set(frame.node, GRAY);
      pathStack.push(frame.node);

      // Schedule exit
      stack.push({ node: frame.node, phase: 'exit' });

      // Schedule neighbors
      const neighbors = adjacency.get(frame.node);
      if (neighbors) {
        for (const neighbor of neighbors) {
          const neighborColor = color.get(neighbor) ?? 0;
          if (neighborColor !== BLACK) {
            stack.push({ node: neighbor, phase: 'enter' });
          }
        }
      }
    }

    return cyclicPaths;
  }
}
