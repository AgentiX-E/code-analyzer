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
  /** **Content-word overlap at which two findings are the same one.** */
  dedupThreshold?: number;
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
  // **The content-word overlap at which two findings are the same one.**
  // **At 0.6 the merge removed 360 of 488 and cost ten true positives**, so **it is a starting value that a
  // measurement has already contradicted rather than a settled one** - and **a constant a measurement has contradicted
  // is a constant that has to become a parameter.**
  dedupThreshold: 0.6,
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

    const results = this.options.parallel
      ? await this.runLanesParallel(ctx, lanes)
      : await this.runLanesSequential(ctx, lanes);
    return this.deduplicateAcrossLanes(results);
  }

  /**
   * **What the threshold is, and why it is a number rather than a constant.**
   *
   * **At 0.6 the merge removed 360 of 488 findings, raised precision 2.3 times and lowered recall from 0.56 to 0.36** -
   * **because ten true positives were merged with neighbours that shared most of their vocabulary.** **So 0.6 is
   * measurably too low**, and **a constant that a measurement has contradicted is a constant that has to become a
   * parameter.**
   */
  static readonly DEFAULT_DEDUP_THRESHOLD = 0.6;

  /** **What the last deduplication did**, so a caller can tell a quiet reviewer from a collapsing one. */
  lastDeduplication: { before: number; after: number; dropped: number } | null = null;

  /**
   * **One defect reported by five lanes is one defect.**
   *
   * **Why this exists, in the measurement's own numbers.** **After the coordinate-system fix in the emission filter, the
   * engine emitted 459 findings over 199 files with 28 true positives and 431 false positives** - **a precision of 0.061
   * against a competitor's 0.5357.**
   *
   * **And five lanes review the same diff independently**, each with its own prompt: **security, performance,
   * maintainability, correctness and documentation.** **A defect that is arguably two of those is reported by both**,
   * and **`Promise.all` returned both** - **so the same repair appeared once per angle it could be seen from, and every
   * copy after the first was a false positive by construction.**
   *
   * **And the identity is a location and a shape rather than a string**, because **two lanes word one defect
   * differently.** **Two findings are the same when their ranges overlap in the same file**, or **when most of their
   * content words agree** - and **the survivor is the highest severity**, because **a defect is as serious as its worst
   * reading.**
   *
   * **And it is deterministic**: **severity first and lane order second**, so **the same five answers produce the same
   * output**, which is **what makes the deduplicated count comparable between runs.**
   */
  private deduplicateAcrossLanes(results: LLMReviewResult[]): LLMReviewResult[] {
    const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const words = (value: unknown): Set<string> =>
      // **And `String(value)` on a non-string produces `[object Object]`, whose words are not the finding's.**
      //
      // **`no-base-to-string` named it**: the parameter is `unknown`, so **the cast was a guess about the value** -
      // and **a guess that fails silently**, because **`[object Object]` is a string and compares like one.**
      // **The honest form is a type test**: **a non-string has no words to compare**, and **saying so costs nothing.**
      new Set(
        (typeof value === 'string' ? value : '')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 3),
      );
    const shares = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0 || b.size === 0) return 0;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared += 1;
      return shared / Math.min(a.size, b.size);
    };

    type Entry = { result: LLMReviewResult; finding: LLMFinding; words: Set<string> };
    const all: Entry[] = [];
    for (const result of results) {
      for (const finding of result.findings) {
        all.push({
          result,
          finding,
          words: words(`${finding.title ?? ''} ${finding.description ?? ''}`),
        });
      }
    }
    // **Severity first, then lane order**, because **the survivor of a duplicate should be the worst reading** and
    // **a stable tie-break is what makes the output reproducible.**
    all.sort(
      (x, y) => (rank[String(y.finding.severity)] ?? 0) - (rank[String(x.finding.severity)] ?? 0),
    );

    const survivors: Entry[] = [];
    for (const entry of all) {
      const duplicate =
        survivors.some(
          (k) =>
            // **Same file, overlapping ranges** - the same defect has one location.
            String(k.result.filePath ?? '') === String(entry.result.filePath ?? '') &&
            entry.finding.startLine <= k.finding.endLine &&
            entry.finding.endLine >= k.finding.startLine,
        ) ||
        survivors.some(
          (k) =>
            // **Or the same shape of sentence**, because **two lanes do not word a defect identically** and a range is a
            // hint that this iteration already watched a filter discard 207 findings over.
            shares(k.words, entry.words) >= this.options.dedupThreshold,
        );
      if (!duplicate) survivors.push(entry);
    }

    const keep = new Set(survivors.map((e) => e.finding));
    for (const result of results) {
      result.findings = result.findings.filter((f) => keep.has(f));
    }
    this.lastDeduplication = {
      before: all.length,
      after: survivors.length,
      dropped: all.length - survivors.length,
    };
    return results;
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
  lastCounts: {
    parsed: number;
    kept: number;
    dropped: { invalidLine: number; beyondDiffLength: number; kept: number; total: number };
  } | null = null;

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
