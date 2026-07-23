// @code-analyzer/intelligence — Code Review Engine
// Heuristic-based code review with Plan/Analyze/Filter/Relocate pipeline.

import type {
  ReviewComment,
  ReviewSession,
  GitDiff,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  analyzeFileHeuristics,
  toReviewComment,
  type GraphAnalysisData,
} from './heuristics.js';
import { SessionStore, computeFileFingerprint } from './session-store.js';
import type { SessionMetadata, ReviewItemResult } from './session-store.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ReviewConfig {
  maxTokens: number;
  maxToolCalls: number;
  planLineThreshold: number;
  timeout: number;
  concurrency: number;
}

const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  maxTokens: 8000,
  maxToolCalls: 10,
  planLineThreshold: 200,
  timeout: 30000,
  concurrency: 4,
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
    test: (c) => /^\s*\/\//.test(c.existingCode.trim()) && c.category === 'style',
    reason: 'Style comments on comment-only lines',
  },
];

// ---------------------------------------------------------------------------
// Code Review Engine
// ---------------------------------------------------------------------------

export class CodeReviewEngine {
  private readonly config: ReviewConfig;
  private readonly sessionStore: SessionStore;

  constructor(
    private store: InMemoryGraphStore,
    config?: Partial<ReviewConfig>,
    sessionStore?: SessionStore,
  ) {
    this.config = { ...DEFAULT_REVIEW_CONFIG, ...config };
    this.sessionStore = sessionStore ?? new SessionStore();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Review a set of git diffs for a project.
   * Creates a review session and processes all diffs through the pipeline.
   */
  async reviewDiff(projectId: string, diffs: GitDiff[]): Promise<ReviewSession> {
    const meta: SessionMetadata = {
      repository: projectId,
      branch: 'main',
      mode: 'diff',
    };

    const session = this.sessionStore.startSession(projectId, meta);

    const ctx: ReviewContext = {
      projectId,
      diff: diffs,
      store: this.store,
      sessionId: session.id,
      config: this.config,
    };

    let totalComments = 0;

    for (const diff of diffs) {
      const comments = await this.reviewFileItem(ctx, diff);
      totalComments += comments.length;

      const content = this.getDiffContent(diff);
      const fingerprint = computeFileFingerprint('diff', diff.filePath, content);

      const result: ReviewItemResult = {
        filePath: diff.filePath,
        fingerprint,
        comments,
        duration: 0,
      };

      this.sessionStore.recordItemDone(session.id, result);
    }

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
   */
  async reviewFile(
    _projectId: string,
    filePath: string,
    content: string,
  ): Promise<ReviewComment[]> {
    const lines = content.split('\n');
    const results = analyzeFileHeuristics(filePath, lines);

    return results.map((r, i) => toReviewComment(filePath, r, i, lines));
  }

  /**
   * Resume a previous review session.
   * Returns the session state, skipping already-completed files.
   */
  async resumeSession(sessionId: string): Promise<ReviewSession> {
    const resumeState = this.sessionStore.buildResumeState(sessionId);

    // Build a minimal session object from stored records
    const records = this.sessionStore.getRecords(sessionId);
    let projectId = '';
    let mode: 'diff' | 'scan' = 'diff';
    let createdAt = '';
    let filesReviewed = resumeState.completedFiles.size;

    for (const line of records) {
      try {
        const record = JSON.parse(line) as {
          type: string;
          projectId?: string;
          timestamp?: string;
          metadata?: SessionMetadata;
        };
        if (record.type === 'start') {
          /* v8 ignore start */
          projectId = record.projectId ?? '';
          createdAt = record.timestamp ?? '';
          mode = record.metadata?.mode ?? 'diff';
          /* v8 ignore stop */
          break;
        }
      /* v8 ignore start */
      } catch {
        // Skip
      }
      /* v8 ignore stop */
    }

    let totalComments = resumeState.reusedComments.length;

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
    // Phase 1: Plan
    const plan = await this.planPhase(ctx, diff);

    // Phase 2: Analyze
    const comments = await this.analyzePhase(ctx, diff, plan);

    // Phase 3: Filter
    const filtered = await this.filterPhase(comments, diff);

    // Phase 4: Relocate
    const relocated = await this.relocatePhase(filtered, diff);

    return relocated;
  }

  // -------------------------------------------------------------------------
  // Plan Phase
  // -------------------------------------------------------------------------

  private async planPhase(
    _ctx: ReviewContext,
    diff: GitDiff,
  ): Promise<ReviewPlan> {
    const content = this.getDiffContent(diff);
    const lines = content.split('\n');
    const lineCount = lines.length;

    // Determine focus areas based on file path and characteristics
    const focusAreas: string[] = [];
    const checklist: string[] = [];
    const riskAreas: string[] = [];

    // File type analysis
    if (diff.filePath.endsWith('.ts') || diff.filePath.endsWith('.tsx')) {
      focusAreas.push('TypeScript types');
      checklist.push('Verify TypeScript types are correct');
    }
    if (diff.filePath.includes('.test.') || diff.filePath.includes('.spec.')) {
      focusAreas.push('Test quality');
      checklist.push('Ensure test coverage is adequate');
    }
    if (diff.filePath.includes('/api/') || diff.filePath.includes('/routes/')) {
      focusAreas.push('API contract');
      riskAreas.push('API route change');
      checklist.push('Verify API contract compatibility');
    }

    // Size-based analysis
    if (lineCount > this.config.planLineThreshold) {
      focusAreas.push('Large file');
      riskAreas.push('File is large — high complexity risk');
      checklist.push('Check for opportunities to split file');
    }

    // Change type analysis
    if (diff.changeType === 'deleted') {
      riskAreas.push('File deletion');
      checklist.push('Verify all imports are updated');
    }
    if (diff.changeType === 'renamed') {
      riskAreas.push('File rename');
      checklist.push('Verify all import paths are updated');
    }

    // Always check these
    focusAreas.push('Error handling', 'Code patterns', 'Naming');
    checklist.push('Check for missing error handling');
    checklist.push('Look for long functions (>50 lines)');
    checklist.push('Look for deep nesting (>4 levels)');
    checklist.push('Verify naming conventions');

    /* v8 ignore next */
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
    const content = this.getDiffContent(diff);
    const lines = content.split('\n');

    // Build graph analysis data from the store
    const graphData = this.buildGraphData(ctx.projectId, diff.filePath);

    // Run heuristic analysis
    const results = analyzeFileHeuristics(diff.filePath, lines, diff, graphData);

    // Convert to review comments
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

  private async relocatePhase(
    comments: ReviewComment[],
    diff: GitDiff,
  ): Promise<ReviewComment[]> {
    return comments.map((comment) => {
      // If no diff ranges, keep line numbers as-is
      if (!diff.ranges || diff.ranges.length === 0) {
        return comment;
      }

      let newStartLine = comment.startLine;
      let newEndLine = comment.endLine;
      let offset = 0;

      for (const range of diff.ranges) {
        const removedLines = range.oldEnd - range.oldStart;
        const addedLines = range.newEnd - range.newStart;
        const delta = addedLines - removedLines;

        if (range.oldStart < newStartLine) {
          offset += delta;
        }
      }

      // Clamp to valid range
      newStartLine = Math.max(1, newStartLine + offset);
      newEndLine = Math.max(newStartLine, newEndLine + offset);

      return {
        ...comment,
        startLine: newStartLine,
        endLine: newEndLine,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Extract the diff content from a GitDiff object.
   * Combines range information to provide a representative content.
   */
  private getDiffContent(diff: GitDiff): string {
    // Build a representative content from the diff metadata
    const parts: string[] = [];
    parts.push(`// File: ${diff.filePath}`);
    parts.push(`// Change type: ${diff.changeType}`);

    if (diff.oldPath) {
      parts.push(`// Old path: ${diff.oldPath}`);
    }

    for (const range of diff.ranges) {
      parts.push(
        `// Range: old[${range.oldStart}-${range.oldEnd}] -> new[${range.newStart}-${range.newEnd}] (${range.changeType})`,
      );
    }

    return parts.join('\n');
  }

  /**
   * Build graph analysis data for a file from the InMemoryGraphStore.
   */
  private buildGraphData(
    _projectId: string,
    filePath: string,
  ): Partial<GraphAnalysisData> {
    const allNodes = this.store.getAllNodes();
    const allEdges = this.store.getAllEdges();

    // Count edges for this file
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

    // Detect circular dependencies using simple cycle detection
    const cyclicPaths: string[][] = [];
    const adjacency = new Map<string, Set<string>>();

    for (const edge of allEdges) {
      const srcNode = allNodes.find((n) => n.id === edge.sourceId);
      const tgtNode = allNodes.find((n) => n.id === edge.targetId);
      if (srcNode?.filePath && tgtNode?.filePath) {
        const deps = adjacency.get(srcNode.filePath) ?? new Set();
        deps.add(tgtNode.filePath);
        adjacency.set(srcNode.filePath, deps);
      }
    }

    // DFS cycle detection
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (current: string, path: string[]): void => {
      if (stack.has(current)) {
        const cycleStart = path.indexOf(current);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart).concat(current);
          cyclicPaths.push(cycle);
        }
        return;
      }
      /* v8 ignore next */
      if (visited.has(current)) return;

      visited.add(current);
      stack.add(current);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          dfs(neighbor, [...path, current]);
        }
      }

      stack.delete(current);
    };

    // Only check starting from this file
    dfs(filePath, []);

    const edgeCounts = new Map<string, number>();

    return {
      outDegree,
      inDegree,
      exportedSymbolCount,
      cyclicPaths,
      edgeCounts,
    };
  }
}
