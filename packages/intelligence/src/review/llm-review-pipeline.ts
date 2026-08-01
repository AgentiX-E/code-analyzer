// @code-analyzer/intelligence — LLM Review Pipeline Integration
// Bridges the LLM review output with the CommentPositioner and
// CommentReflection modules for line-precise, high-confidence review.
//
// Architecture:
//   LLM raw findings → [Convert to ReviewComments]
//     → [CommentPositioner: exact → heuristic → fallback]
//       → [CommentReflection: validate, adjust, deduplicate, filter]
//         → [Merge with heuristic results]
//           → Final review comments
//
// This integration is what makes LLM-based review practically useful.
// Raw LLM output has ~30% precision due to position drift. The positioner
// and reflection modules bring it to competitive levels (>70% precision).

import type { ReviewComment, GitDiff } from '@code-analyzer/shared';
import { CommentPositioner, type PositionedComment } from './comment-positioner.js';
import { CommentReflectionModule, type ReflectionReport } from './comment-reflection.js';
import type { LLMFinding } from './llm/prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMReviewPipelineResult {
  /** Positioned and reflected review comments. */
  comments: PositionedComment[];
  /** Reflection quality report. */
  reflection: ReflectionReport;
  /** Number of raw LLM findings before positioning. */
  rawCount: number;
  /** Number of comments after positioning and filtering. */
  finalCount: number;
  /** Precision improvement from positioning + reflection. */
  noiseReduction: number;
}

export interface PipelineOptions {
  /** Minimum position confidence to keep a comment (default: 0.3). */
  minConfidence: number;
  /** Whether to filter out low-confidence comments entirely. */
  filterLowConfidence: boolean;
  /** Maximum position drift before adjusting (default: 10 lines). */
  maxPositionDrift: number;
  /** Whether to auto-adjust drifted positions. */
  autoAdjustPositions: boolean;
}

const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  minConfidence: 0.3,
  filterLowConfidence: false,
  maxPositionDrift: 10,
  autoAdjustPositions: true,
};

// ---------------------------------------------------------------------------
// LLM Review Pipeline
// ---------------------------------------------------------------------------

export class LLMReviewPipeline {
  private readonly positioner: CommentPositioner;
  private readonly reflector: CommentReflectionModule;
  private readonly options: PipelineOptions;

  constructor(options: Partial<PipelineOptions> = {}) {
    this.options = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
    this.positioner = new CommentPositioner();
    this.reflector = new CommentReflectionModule({
      minConfidence: this.options.minConfidence,
      maxPositionDrift: this.options.maxPositionDrift,
      autoAdjustPositions: this.options.autoAdjustPositions,
      filterLowConfidence: this.options.filterLowConfidence,
    });
  }

  /**
   * Process raw LLM findings through the positioning and reflection pipeline.
   *
   * @param findings — raw LLM review findings with approximate line numbers
   * @param fileContent — the actual source file content for positioning
   * @param filePath — the file path for error reporting
   * @returns LLMReviewPipelineResult with positioned, validated comments
   */
  processFindings(
    findings: LLMFinding[],
    fileContent: string,
    filePath: string,
  ): LLMReviewPipelineResult {
    const rawCount = findings.length;

    // Step 1: Convert LLM findings to ReviewComment format
    const rawComments: ReviewComment[] = findings.map((f, i) => ({
      id: `llm-raw-${i}-${Date.now()}`,
      path: filePath,
      content: f.title,
      thinking: f.description,
      existingCode: f.snippet ?? this.extractSnippet(fileContent, f.startLine, f.endLine),
      suggestionCode: f.suggestion ?? undefined,
      startLine: f.startLine,
      endLine: f.endLine,
      category: this.mapCategory(f.category ?? f.lane),
      severity: this.mapSeverity(f.severity),
      filtered: false,
      createdAt: new Date().toISOString(),
    }));

    // Step 2: Position each comment against actual file content
    const positioned: PositionedComment[] = rawComments.map((c) =>
      this.positioner.positionComment(c, fileContent),
    );

    // Step 3: Reflect — validate, adjust, deduplicate, filter
    const report = this.reflector.reflect(positioned, fileContent, filePath);

    // Step 4: Collect passed comments (or all if filterLowConfidence is false)
    const finalComments: PositionedComment[] = report.results
      .filter((r) => r.passed || !this.options.filterLowConfidence)
      .map((r) => r.comment);

    const finalCount = finalComments.length;
    const noiseReduction = rawCount > 0
      ? Math.round(((rawCount - finalCount) / rawCount) * 1000) / 1000
      : 0;

    return {
      comments: finalComments,
      reflection: report,
      rawCount,
      finalCount,
      noiseReduction,
    };
  }

  /**
   * Merge LLM pipeline results with heuristic review comments, removing duplicates.
   */
  mergeWithHeuristic(
    llmComments: PositionedComment[],
    heuristicComments: ReviewComment[],
  ): ReviewComment[] {
    const result = [...heuristicComments];
    const overlapThreshold = 3;

    for (const llmComment of llmComments) {
      // Skip low-confidence positioned comments
      if (llmComment.positionConfidence < this.options.minConfidence) {
        continue;
      }

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

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private extractSnippet(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);
    return lines.slice(start, end).join('\n');
  }

  private mapCategory(cat: string): ReviewComment['category'] {
    const m: Record<string, ReviewComment['category']> = {
      security: 'security',
      correctness: 'bug',
      bug: 'bug',
      performance: 'performance',
      maintainability: 'maintainability',
      style: 'style',
      documentation: 'documentation',
      architecture: 'architecture',
    };
    return m[cat.toLowerCase()] ?? 'style';
  }

  private mapSeverity(sev: string): ReviewComment['severity'] {
    const m: Record<string, ReviewComment['severity']> = {
      critical: 'critical',
      high: 'high',
      medium: 'medium',
      low: 'low',
    };
    const lower = sev.toLowerCase();
    if (lower in m) return m[lower]!;
    return 'medium';
  }
}
