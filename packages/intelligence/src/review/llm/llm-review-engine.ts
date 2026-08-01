// @code-analyzer/intelligence — LLM Review Engine
// Orchestrates LLM-powered code review across multiple lanes.

import type {
  ReviewComment,
  ReviewCategory,
  Severity,
  GitDiff,
} from '@code-analyzer/shared';
import type { LLMProvider, CompletionOptions } from './provider.js';
import {
  LANE_PROMPTS,
  LANE_LABELS,
  parseLLMResponse,
  type PromptContext,
  type ReviewLane,
  type LLMFinding,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for controlling LLM review behavior. */
export interface LLMReviewOptions {
  /** Which review lanes to execute. Defaults to all 5. */
  lanes?: ReviewLane[];
  /** Maximum tokens per review lane completion. Defaults to 4096. */
  maxTokensPerLane?: number;
  /** Run lanes in parallel (true) or sequentially (false). Defaults to true. */
  parallel?: boolean;
  /** Maximum diff content length in characters before truncation. Defaults to 8000. */
  maxDiffLength?: number;
  /** LLM temperature for completions. Defaults to 0.3. */
  temperature?: number;
  /** Timeout per lane request in milliseconds. Defaults to 120000. */
  laneTimeout?: number;
}

/** Result of an LLM review for a single diff. */
export interface LLMReviewResult {
  /** The file path that was reviewed. */
  filePath: string;
  /** The review lane that produced this result. */
  lane: ReviewLane;
  /** The findings produced by this lane. */
  findings: LLMFinding[];
  /** Whether the lane execution succeeded (false indicates an error). */
  success: boolean;
  /** Error message if the lane execution failed. */
  error?: string;
  /** Execution time in milliseconds. */
  durationMs: number;
  /** Optional token usage tracking. */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<LLMReviewOptions> = {
  lanes: ['security', 'architecture', 'performance', 'maintainability', 'testing'],
  maxTokensPerLane: 4096,
  parallel: true,
  maxDiffLength: 8000,
  temperature: 0.3,
  laneTimeout: 120_000,
};

// ---------------------------------------------------------------------------
// LLM Review Engine
// ---------------------------------------------------------------------------

export class LLMReviewEngine {
  private readonly options: Required<LLMReviewOptions>;

  constructor(
    private readonly provider: LLMProvider,
    options?: LLMReviewOptions,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Review a single git diff using LLM-powered analysis.
   * Runs the specified review lanes and returns aggregated results.
   */
  async reviewDiff(
    diff: GitDiff,
    fileContext?: string,
  ): Promise<LLMReviewResult[]> {
    const diffContent = this.buildDiffContent(diff);

    const ctx: PromptContext = {
      diffContent: this.truncateDiff(diffContent),
      filePath: diff.filePath,
      changeType: diff.changeType,
      fileContext,
    };

    const lanes = this.options.lanes;

    if (this.options.parallel) {
      return this.runLanesParallel(ctx, lanes);
    }
    return this.runLanesSequential(ctx, lanes);
  }

  /**
   * Review a git diff and convert LLM findings to ReviewComment format,
   * compatible with the existing heuristic review engine output.
   */
  async reviewDiffAsComments(
    diff: GitDiff,
    fileContext?: string,
  ): Promise<ReviewComment[]> {
    const results = await this.reviewDiff(diff, fileContext);
    return this.convertToReviewComments(diff, results);
  }

  // -------------------------------------------------------------------------
  // Lane Execution
  // -------------------------------------------------------------------------

  private async runLanesParallel(
    ctx: PromptContext,
    lanes: ReviewLane[],
  ): Promise<LLMReviewResult[]> {
    const promises = lanes.map((lane) => this.executeLane(ctx, lane));
    return Promise.all(promises);
  }

  private async runLanesSequential(
    ctx: PromptContext,
    lanes: ReviewLane[],
  ): Promise<LLMReviewResult[]> {
    const results: LLMReviewResult[] = [];
    for (const lane of lanes) {
      const result = await this.executeLane(ctx, lane);
      results.push(result);
    }
    return results;
  }

  private async executeLane(
    ctx: PromptContext,
    lane: ReviewLane,
  ): Promise<LLMReviewResult> {
    const startTime = Date.now();

    try {
      const promptFn = LANE_PROMPTS[lane];
      if (!promptFn) {
        return {
          filePath: ctx.filePath,
          lane,
          findings: [],
          success: false,
          error: `Unknown review lane: ${lane}`,
          durationMs: Date.now() - startTime,
        };
      }

      const prompt = promptFn(ctx);

      const llmOptions: CompletionOptions = {
        maxTokens: this.options.maxTokensPerLane,
        temperature: this.options.temperature,
        timeout: this.options.laneTimeout,
      };

      const result = await this.provider.complete(prompt, llmOptions);
      const findings = this.filterFindings(parseLLMResponse(result.content), ctx);

      return {
        filePath: ctx.filePath,
        lane,
        findings,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        filePath: ctx.filePath,
        lane,
        findings: [],
        success: false,
        error: message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Finding Filtering & Conversion
  // -------------------------------------------------------------------------

  /**
   * Filter LLM findings to ensure they reference valid line ranges
   * within the diff content.
   */
  private filterFindings(findings: LLMFinding[], ctx: PromptContext): LLMFinding[] {
    const lines = ctx.diffContent.split('\n');
    const maxLine = lines.length;

    return findings
      .filter((f) => {
        // Must have valid line numbers
        if (f.startLine < 1 || f.endLine < 1) return false;
        if (f.startLine > maxLine) return false;
        // End line cannot exceed the diff
        if (f.endLine > maxLine) {
          f.endLine = maxLine;
        }
        // Start must be before or equal to end
        if (f.startLine > f.endLine) {
          f.startLine = f.endLine;
        }
        return true;
      })
      .map((f) => ({
        ...f,
        // Normalize severity
        severity: this.normalizeSeverity(f.severity),
        // Normalize category
        category: this.normalizeCategory(f.category),
      }));
  }

  /**
   * Convert LLM review results to the standard ReviewComment format.
   */
  convertToReviewComments(
    diff: GitDiff,
    results: LLMReviewResult[],
  ): ReviewComment[] {
    const comments: ReviewComment[] = [];
    const now = new Date().toISOString();

    for (const result of results) {
      if (!result.success) continue;

      for (const finding of result.findings) {
        const rangeText = this.extractRangeText(diff, finding);

        comments.push({
          id: `llm-${result.lane}-${comments.length}-${Date.now()}`,
          path: diff.filePath,
          content: finding.title,
          thinking: `${finding.description}\n\n[Review Lane: ${LANE_LABELS[result.lane]}]`,
          existingCode: rangeText,
          suggestionCode: finding.suggestion ?? undefined,
          startLine: finding.startLine,
          endLine: finding.endLine,
          category: finding.category,
          severity: finding.severity,
          filtered: false,
          createdAt: now,
        });
      }
    }

    return comments;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Build a text representation of a git diff for the LLM prompt. */
  private buildDiffContent(diff: GitDiff): string {
    const parts: string[] = [];
    parts.push(`// File: ${diff.filePath}`);
    parts.push(`// Change type: ${diff.changeType}`);

    if (diff.oldPath) {
      parts.push(`// Old path: ${diff.oldPath}`);
    }

    for (const range of diff.ranges) {
      parts.push(
        `@@ -${range.oldStart},${range.oldEnd} +${range.newStart},${range.newEnd} @@ (${range.changeType})`,
      );
    }

    return parts.join('\n');
  }

  /** Truncate diff content to fit within the configured context window. */
  private truncateDiff(content: string): string {
    if (content.length <= this.options.maxDiffLength) {
      return content;
    }

    const half = Math.floor(this.options.maxDiffLength / 2);
    const start = content.slice(0, half);
    const end = content.slice(content.length - half);
    return `${start}\n\n... [${content.length - this.options.maxDiffLength} characters truncated] ...\n\n${end}`;
  }

  /** Extract relevant code text for a specific finding from the diff. */
  private extractRangeText(diff: GitDiff, finding: LLMFinding): string {
    const parts: string[] = [];
    for (const range of diff.ranges) {
      parts.push(
        `[Lines ${range.oldStart}-${range.oldEnd} -> ${range.newStart}-${range.newEnd}] ${range.changeType}`,
      );
    }
    return parts.length > 0 ? parts.join('\n') : `Line ${finding.startLine}-${finding.endLine}`;
  }

  /** Normalize severity string to valid Severity type. */
  private normalizeSeverity(raw: string): Severity {
    const valid: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const lower = raw.toLowerCase();
    if (valid.includes(lower as Severity)) {
      return lower as Severity;
    }
    return 'medium';
  }

  /** Normalize category string to valid ReviewCategory type. */
  private normalizeCategory(raw: string): ReviewCategory {
    const valid: ReviewCategory[] = [
      'bug', 'security', 'performance', 'maintainability',
      'test', 'style', 'documentation', 'architecture', 'other',
    ];
    const lower = raw.toLowerCase();
    if (valid.includes(lower as ReviewCategory)) {
      return lower as ReviewCategory;
    }
    return 'other';
  }
}
