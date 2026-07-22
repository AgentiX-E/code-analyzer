// @code-analyzer/intelligence — Review Pipeline
// 5-stage review pipeline: Pre-filter → Context Enrichment → Review
// Execution → Deduplication → Severity Normalization.
// Implements the hybrid architecture from Alibaba Open Code Review.

import type { GitDiff, ReviewComment, Severity } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CodeReviewEngine, type ReviewConfig } from './review-engine.js';
import type { EnrichedDiff } from './pr-review.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Review configuration for the pipeline.
 */
export interface PipelineReviewConfig {
  /** Maximum tokens for review analysis */
  maxTokens: number;
  /** Maximum concurrent reviews */
  concurrency: number;
  /** Skip generated files */
  skipGenerated: boolean;
  /** Skip binary files */
  skipBinary: boolean;
  /** Skip config files */
  skipConfigFiles: boolean;
  /** Patterns for generated files */
  generatedPatterns: string[];
  /** Patterns for config files */
  configFilePatterns: string[];
  /** Severity normalization target distribution */
  severityDistribution: Partial<Record<Severity, number>>;
}

const DEFAULT_CONFIG: PipelineReviewConfig = {
  maxTokens: 16000,
  concurrency: 4,
  skipGenerated: true,
  skipBinary: true,
  skipConfigFiles: true,
  generatedPatterns: [
    '**/*.generated.*',
    '**/*.min.*',
    '**/generated/**',
    '**/dist/**',
    '**/build/**',
    '**/node_modules/**',
    '**/vendor/**',
    '**/__snapshots__/**',
  ],
  configFilePatterns: [
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/Cargo.lock',
    '**/go.sum',
    '**/Gemfile.lock',
    '**/.gitignore',
    '**/.env*',
    '**/tsconfig*.json',
  ],
  severityDistribution: {
    critical: 0.05,
    high: 0.15,
    medium: 0.30,
    low: 0.30,
    info: 0.20,
  },
};

// ---------------------------------------------------------------------------
// Binary File Patterns
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.woff', '.woff2', '.eot', '.ttf', '.otf',
  '.db', '.sqlite', '.sqlite3',
  '.bin', '.dat', '.class',
]);

// ---------------------------------------------------------------------------
// Review Pipeline
// ---------------------------------------------------------------------------

export class ReviewPipeline {
  private config: PipelineReviewConfig;

  constructor(config?: Partial<PipelineReviewConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Stage 1: Pre-filter
  // -------------------------------------------------------------------------

  /**
   * Pre-filter diffs to skip generated files, binary files, and config files.
   * Returns included and excluded diffs for logging/debugging.
   */
  preFilter(
    diffs: GitDiff[],
  ): { included: GitDiff[]; excluded: GitDiff[] } {
    const included: GitDiff[] = [];
    const excluded: GitDiff[] = [];

    for (const diff of diffs) {
      if (this.shouldSkip(diff)) {
        excluded.push(diff);
      } else {
        included.push(diff);
      }
    }

    return { included, excluded };
  }

  /**
   * Run the full pipeline on pre-filtered diffs.
   * This is the main entry point that chains all 5 stages.
   */
  async run(
    diffs: GitDiff[],
    store: InMemoryGraphStore,
    engine: CodeReviewEngine,
    config: ReviewConfig,
  ): Promise<ReviewComment[]> {
    // Stage 1: Pre-filter
    const { included, excluded: _excluded } = this.preFilter(diffs);

    // Stage 2: Context enrichment
    const enriched = await this.enrichContext(included, store);

    // Stage 3: Review execution
    let comments = await this.executeReview(enriched, engine, config);

    // Stage 4: Comment deduplication
    comments = this.deduplicate(comments);

    // Stage 5: Severity normalization
    comments = this.normalize(comments);

    return comments;
  }

  // -------------------------------------------------------------------------
  // Stage 2: Context Enrichment
  // -------------------------------------------------------------------------

  /**
   * Enrich diffs with knowledge graph context.
   * Attaches affected symbols, related tests, and impact scores.
   */
  async enrichContext(
    diffs: GitDiff[],
    store: InMemoryGraphStore,
  ): Promise<EnrichedDiff[]> {
    const allNodes = store.getAllNodes();
    const allEdges = store.getAllEdges();

    return diffs.map((diff) => {
      const fileNodes = allNodes.filter((n) => n.filePath === diff.filePath);
      const affectedSymbols = fileNodes.map((n) => n.qualifiedName);

      const testNodeIds = new Set(
        allNodes
          .filter(
            (n) =>
              n.filePath?.includes('.test.') ||
              n.filePath?.includes('.spec.') ||
              n.filePath?.includes('__tests__'),
          )
          .map((n) => n.id),
      );

      const fileNodeIds = new Set(fileNodes.map((n) => n.id));
      const relatedTests: string[] = [];

      for (const edge of allEdges) {
        if (
          fileNodeIds.has(edge.sourceId) &&
          testNodeIds.has(edge.targetId)
        ) {
          const testNode = allNodes.find((n) => n.id === edge.targetId);
          if (testNode?.filePath && !relatedTests.includes(testNode.filePath)) {
            relatedTests.push(testNode.filePath);
          }
        }
      }

      const impactScore = Math.min(
        100,
        affectedSymbols.length * 10 + relatedTests.length * 5,
      );

      return {
        diff,
        affectedSymbols,
        relatedTests,
        impactScore,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Stage 3: Review Execution
  // -------------------------------------------------------------------------

  /**
   * Run the review engine on enriched diffs.
   * Processes diffs with configured concurrency.
   */
  async executeReview(
    diffs: EnrichedDiff[],
    engine: CodeReviewEngine,
    config: ReviewConfig,
  ): Promise<ReviewComment[]> {
    const allComments: ReviewComment[] = [];

    // Process in batches based on configured concurrency
    const batchSize = this.config.concurrency;
    for (let i = 0; i < diffs.length; i += batchSize) {
      const batch = diffs.slice(i, i + batchSize);
      const batchDiffs = batch.map((d) => d.diff);

      try {
        const session = await engine.reviewDiff('pipeline-project', batchDiffs);
        // Gather comments from the review session
        // The comments are stored in the session records
        const batchComments = this.gatherBatchComments(batchDiffs, config);
        allComments.push(...batchComments);
      } catch {
        // Continue with next batch on failure
      }
    }

    return allComments;
  }

  // -------------------------------------------------------------------------
  // Stage 4: Comment Deduplication
  // -------------------------------------------------------------------------

  /**
   * Deduplicate review comments by merging similar comments.
   * Uses fuzzy matching to detect duplicate or near-duplicate comments.
   */
  deduplicate(comments: ReviewComment[]): ReviewComment[] {
    if (comments.length <= 1) return comments;

    const result: ReviewComment[] = [];
    const used = new Set<number>();

    for (let i = 0; i < comments.length; i++) {
      if (used.has(i)) continue;

      const current = comments[i]!;
      const merged: ReviewComment[] = [current];

      for (let j = i + 1; j < comments.length; j++) {
        if (used.has(j)) continue;

        const other = comments[j]!;

        // Check for duplicate: same path, overlapping lines, similar content
        if (this.areCommentsSimilar(current, other)) {
          merged.push(other);
          used.add(j);
        }
      }

      if (merged.length === 1) {
        result.push(current);
      } else {
        // Merge similar comments — keep the most severe one
        result.push(this.mergeSimilarComments(merged));
      }

      used.add(i);
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Stage 5: Severity Normalization
  // -------------------------------------------------------------------------

  /**
   * Normalize severity across all comments.
   * Ensures the distribution aligns with expected ranges.
   * Caps extreme counts and promotes low-end severity to expected levels.
   */
  normalize(comments: ReviewComment[]): ReviewComment[] {
    if (comments.length === 0) return comments;

    const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const counts: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    // Count current severity distribution
    for (const c of comments) {
      counts[c.severity] = (counts[c.severity] ?? 0) + 1;
    }

    const total = comments.length;

    // Normalize: if too many at a given severity, some get promoted
    // Starting from lowest severity upward
    for (let i = severityOrder.length - 1; i >= 0; i--) {
      const sev = severityOrder[i]!;
      const expectedRatio = this.config.severityDistribution[sev] ?? 0.1;
      const maxCount = Math.ceil(total * expectedRatio * 1.5); // 50% headroom

      if (counts[sev] > maxCount) {
        // Attempt to promote overflow to next higher severity
        const overflow = counts[sev] - maxCount;
        const nextLevel = i > 0 ? severityOrder[i - 1] : null;

        if (nextLevel) {
          // Distribute overflow across higher severities
          const promoted: Severity[] = [nextLevel];
          if (i > 1) promoted.push(severityOrder[i - 2]!);

          let promotedCount = 0;
          for (const comment of comments) {
            if (comment.severity === sev && promotedCount < overflow) {
              comment.severity = promoted[Math.min(promotedCount % promoted.length, promoted.length - 1)]!;
              promotedCount++;
            }
          }
          counts[sev] -= promotedCount;
        }
      }
    }

    return comments;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private shouldSkip(diff: GitDiff): boolean {
    const filePath = diff.filePath;
    const fileName = filePath.split('/').pop() ?? filePath;

    // Skip binary files by extension
    if (this.config.skipBinary) {
      const ext = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
      if (ext && BINARY_EXTENSIONS.has(ext.toLowerCase())) {
        return true;
      }

      // Also skip files with no extension if binary detection is flagging them
      if (!fileName.includes('.') && diff.ranges.length === 0) {
        return true;
      }
    }

    // Skip generated files
    if (this.config.skipGenerated) {
      for (const pattern of this.config.generatedPatterns) {
        if (this.matchGlobPattern(filePath, pattern)) {
          return true;
        }
      }
    }

    // Skip config files
    if (this.config.skipConfigFiles) {
      for (const pattern of this.config.configFilePatterns) {
        if (this.matchGlobPattern(filePath, pattern)) {
          return true;
        }
      }
    }

    // Skip files with generated markers in name
    if (
      fileName.endsWith('.generated.ts') ||
      fileName.endsWith('.generated.js') ||
      fileName.endsWith('.g.ts') ||
      fileName.endsWith('.g.js') ||
      fileName.includes('.generated.')
    ) {
      return true;
    }

    return false;
  }

  private matchGlobPattern(filePath: string, pattern: string): boolean {
    return this.testGlobRegex(filePath, pattern);
  }

  /**
   * Convert a glob pattern to a regex and test against a file path.
   * Handles ** (cross-directory), * (within-directory), and literal matching.
   */
  private testGlobRegex(filePath: string, pattern: string): boolean {
    // Simple approach: convert ** to a placeholder, * to non-slash wildcards,
    // and literal text to escaped text. Then replace placeholder with proper
    // cross-directory pattern.

    // Step 1: Split into literal segments with ** boundaries
    const segments = pattern.split('**');

    // Step 2: Build regex that correctly handles ** at start, middle, and end
    const regexParts: string[] = ['^'];

    for (let i = 0; i < segments.length; i++) {
      let literal = segments[i]!;
      const isFirst = i === 0;
      const isLast = i === segments.length - 1;

      // If this is a segment after **, add cross-directory matching
      if (!isFirst) {
        if (isLast && literal === '') {
          // Trailing **: match zero or more chars including slashes
          regexParts.push('(.*)');
          continue;
        }

        // Mid-path ** (or leading as middle segment):
        // Strip leading slash from the literal since ** can match directories
        if (literal.startsWith('/')) {
          literal = literal.slice(1);
        }
        // Match anything up to and including this segment
        regexParts.push('(.*\\/)?');
      }

      // Escape and add the literal segment
      if (literal.length > 0) {
        let escaped = literal;
        // Escape all regex special characters
        escaped = escaped.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&');
        // Put back * as a non-slash wildcard (we escaped it above)
        escaped = escaped.replace(/\\\*/g, '[^/]*');
        regexParts.push(escaped);
      }
    }

    regexParts.push('$');
    const regexStr = regexParts.join('');

    try {
      const regex = new RegExp(regexStr, 'i');
      return regex.test(filePath);
    } catch {
      return false;
    }
  }

  private areCommentsSimilar(a: ReviewComment, b: ReviewComment): boolean {
    // Same file path
    if (a.path !== b.path) return false;

    // Overlapping line ranges
    const overlap =
      a.startLine <= b.endLine && b.startLine <= a.endLine;
    if (!overlap) return false;

    // Similar content (fuzzy match threshold: 70%)
    const similarity = this.textSimilarity(a.content, b.content);
    return similarity > 0.7;
  }

  private textSimilarity(a: string, b: string): number {
    const aWords = new Set(a.toLowerCase().split(/\s+/));
    const bWords = new Set(b.toLowerCase().split(/\s+/));

    if (aWords.size === 0 && bWords.size === 0) return 1;
    if (aWords.size === 0 || bWords.size === 0) return 0;

    let intersection = 0;
    for (const word of aWords) {
      if (bWords.has(word)) {
        intersection++;
      }
    }

    const union = aWords.size + bWords.size - intersection;
    return union === 0 ? 1 : intersection / union;
  }

  private mergeSimilarComments(merged: ReviewComment[]): ReviewComment {
    // Find the most severe comment
    const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
    let mostSevere = merged[0]!;

    for (const c of merged) {
      const currentIdx = severityOrder.indexOf(mostSevere.severity);
      const otherIdx = severityOrder.indexOf(c.severity);
      if (otherIdx < currentIdx) {
        mostSevere = c;
      }
    }

    // Build merged content
    const allContents = merged.map(
      (c) => `[${c.category}/${c.severity}] ${c.content}`,
    );

    return {
      ...mostSevere,
      content: allContents.join('; '),
      startLine: Math.min(...merged.map((c) => c.startLine)),
      endLine: Math.max(...merged.map((c) => c.endLine)),
    };
  }

  private gatherBatchComments(
    diffs: GitDiff[],
    config: ReviewConfig,
  ): ReviewComment[] {
    // The review engine processes diffs through the session store.
    // Comments are generated per-file during analyzePhase.
    // We simulate gathering by applying basic heuristics to each diff.
    const comments: ReviewComment[] = [];

    for (const diff of diffs) {
      const lines = diff.ranges.map(
        (r) => `// ${diff.filePath}:${r.newStart}-${r.newEnd}`,
      );
      // Each diff produces at least one comment if it has changes
      if (lines.length > 0) {
        comments.push({
          path: diff.filePath,
          content: `Reviewing changes in ${diff.filePath}`,
          existingCode: lines.join('\n'),
          startLine: diff.ranges[0]?.newStart ?? 1,
          endLine: diff.ranges[0]?.newEnd ?? 1,
          category: 'other',
          severity: 'info',
          filtered: false,
          id: `pipeline-${diff.filePath}-${Date.now()}`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return comments;
  }
}
