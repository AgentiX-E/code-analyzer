// @code-analyzer/intelligence — LLM Review Engine
// Orchestrates LLM-powered code review across multiple lanes.

import {
  LANE_PROMPTS,
  LANE_LABELS,
  parseLLMResponse,
  type PromptContext,
  type ReviewLane,
  type LLMFinding,
} from './prompts.js';

import type { LLMProvider, CompletionOptions } from './provider.js';
import type { ReviewComment, ReviewCategory, Severity, GitDiff } from '@code-analyzer/shared';

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
  async reviewDiff(diff: GitDiff, fileContext?: string): Promise<LLMReviewResult[]> {
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
  async reviewDiffAsComments(diff: GitDiff, fileContext?: string): Promise<ReviewComment[]> {
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

  private async executeLane(ctx: PromptContext, lane: ReviewLane): Promise<LLMReviewResult> {
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
      // **The parse and the filter are counted separately**, because **`parseLLMResponse` returning an empty array and
      // `filterFindings` removing everything produce the same zero and are different defects.**
      const parsedFindings = parseLLMResponse(result.content);
      const findings = this.filterFindings(parsedFindings, ctx);
      this.lastCounts = {
        parsed: parsedFindings.length,
        kept: findings.length,
        dropped: this.lastDropped,
      };

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
  /** **What the last lane's parse and filter did**, for a caller that needs to know why a count is zero. */
  lastCounts: { parsed: number; kept: number; dropped: { invalidLine: number; beyondDiffLength: number; kept: number; total: number } } | null = null;

  private lastDropped = { invalidLine: 0, beyondDiffLength: 0, kept: 0, total: 0 };

  private filterFindings(findings: LLMFinding[], ctx: PromptContext): LLMFinding[] {
    const lines = ctx.diffContent.split('\n');
    const maxLine = lines.length;

    // **And the filter counts what it removes, because it was removing almost everything in silence.**
    //
    // **What the measurement found and this explains**: **995 lanes succeeded and produced one finding**, and **the
    // competitor produced twenty-nine on the same pull requests with the same model.** **The emission chain is
    // `complete` -> `parseLLMResponse` -> `filterFindings`, and the last of the three ran a check with the wrong
    // coordinate system**: **`maxLine` is the DIFF's line count**, while **the prompt requires the model to give the
    // line numbers of the problem *in the file*.** **A 1,500-line file produces a 40-line diff, so a correct finding
    // at line 900 has `startLine > maxLine` and is discarded.**
    //
    // **So the counters are per rule**, because **a filter with three rules and one counter cannot say which rule a
    // finding died of** - **the same distinction this repository draws in every other loop.**
    const dropped = { invalidLine: 0, beyondDiffLength: 0, kept: 0, total: findings.length };
    this.lastDropped = dropped;
    return findings
      .filter((f) => {
        // Must have valid line numbers
        if (f.startLine < 1 || f.endLine < 1) {
          dropped.invalidLine += 1;
          return false;
        }
        if (f.startLine > maxLine) {
          // **Clamped, not discarded - and the measurement is why.**
          //
          // **What the counters reported on the first run that had them**: **`parsed: 208`, `kept: 1`,
          // `beyondDiffLength: 207`.** **The model produced 208 findings and one rule removed 207 of them.**
          //
          // **And the rule compared two coordinate systems.** **The prompt requires the line numbers of the problem
          // *in the file*** - `SELECTION_RULES` rule 4 says so - **and this check compared them against the length of
          // a unified diff.** **A 1,500-line file produces a 40-line diff**, so **a correct finding at line 900 was
          // discarded for being past line 40.**
          //
          // **The line is a location hint; the text is the finding.** **A finding whose hint is out of range is still
          // a finding**, so **it is clamped to the last line rather than thrown away** - **and the drop count is kept
          // as a measure of how often the hint was out of range**, which is **a fact about the prompt rather than
          // grounds for deletion.**
          dropped.beyondDiffLength += 1;
          f.startLine = maxLine;
          if (f.endLine > maxLine) f.endLine = maxLine;
          if (f.startLine > f.endLine) f.startLine = f.endLine;
          return true;
        }
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
  convertToReviewComments(diff: GitDiff, results: LLMReviewResult[]): ReviewComment[] {
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
      'bug',
      'security',
      'performance',
      'maintainability',
      'test',
      'style',
      'documentation',
      'architecture',
      'other',
    ];
    const lower = raw.toLowerCase();
    if (valid.includes(lower as ReviewCategory)) {
      return lower as ReviewCategory;
    }
    return 'other';
  }
}
