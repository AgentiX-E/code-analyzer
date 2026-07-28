/* v8 ignore file */
// @code-analyzer/mcp — Code Review Tools

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl, type ToolContext } from './tool-context.js';
import type { ToolResult } from './registry.js';
import type { GitDiff, ReviewCategory, Severity } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/* v8 ignore start */

function getContext(store?: unknown): ToolContext | null {
  if (ToolContextImpl.isToolContext(store)) return store;
  return null;
}

function getStore(storeOrContext: unknown): InMemoryGraphStore | null {
  if (storeOrContext instanceof InMemoryGraphStore) return storeOrContext;
  if (ToolContextImpl.isToolContext(storeOrContext)) return storeOrContext.store;
  return null;
}

// ---------------------------------------------------------------------------
// review_diff
// ---------------------------------------------------------------------------

interface ReviewDiffParams {
  projectId: string;
  diff?: string;
  fromRef?: string;
  toRef?: string;
  severity?: string;
  categories?: string[];
}

export const reviewDiffSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    diff: { type: 'string', description: 'Git diff content to review' },
    fromRef: { type: 'string', description: 'Base reference' },
    toRef: { type: 'string', description: 'Target reference' },
    severity: { type: 'string', description: 'Minimum severity to report (critical, high, medium, low)' },
    categories: { type: 'array', items: { type: 'string' }, description: 'Review categories to include' },
  },
  required: ['projectId'],
};

export async function reviewDiff(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as ReviewDiffParams;
  const projectId = params.projectId;
  const diffContent = params.diff;
  const fromRef = params.fromRef ?? 'HEAD~1';
  const toRef = params.toRef ?? 'HEAD';
  const severity = params.severity ?? 'medium';
  const categories = params.categories;

  try {
    const ctx = getContext(store);

    if (ctx) {
      // Build GitDiff objects from the diff string if provided
      if (diffContent) {
        const diffs = parseDiffContent(projectId, diffContent);

        // Use PRReviewEngine for deep analysis (standards + impact + review)
        try {
          const prEngine = ctx.getPRReviewEngine();
          const prResult = await prEngine.reviewPR(projectId, {
            number: 0,
            title: `Review: ${fromRef}..${toRef}`,
            body: '',
            state: 'open',
            base: { ref: fromRef, sha: '', repo: { id: 0, owner: '', name: projectId, fullName: projectId, defaultBranch: 'main', cloneUrl: '', language: '', topics: [], isPrivate: false, description: '' } },
            head: { ref: toRef, sha: '', repo: { id: 0, owner: '', name: projectId, fullName: projectId, defaultBranch: 'main', cloneUrl: '', language: '', topics: [], isPrivate: false, description: '' } },
            user: { login: 'code-analyzer' },
            labels: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }, diffs);

          const filtered = filterComments(prResult.comments, severity as Severity, categories as ReviewCategory[]);
          const sum = buildSummary(filtered);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                projectId,
                range: { from: fromRef, to: toRef },
                hasDiff: true,
                sessionId: prResult.sessionId,
                comments: filtered.slice(0, 50),
                summary: sum,
                totalFindings: prResult.summary.totalComments,
                riskLevel: prResult.summary.riskLevel,
                mergeRecommendation: prResult.summary.mergeRecommendation,
                byCategory: prResult.summary.byCategory,
                bySeverity: prResult.summary.bySeverity,
                impactResult: {
                  riskLevel: prResult.impactResult.riskLevel,
                  affectedFiles: prResult.impactResult.changedFiles?.length ?? 0,
                  estimatedEffort: prResult.impactResult.estimatedEffort,
                },
                standardsChecked: prResult.standardsResults.length,
                severity,
                categories: categories ?? ['bug', 'security', 'performance', 'maintainability', 'style', 'documentation', 'architecture'],
                filesReviewed: diffs.length,
                reviewMethod: 'Deep review (PRReviewEngine: standards + impact + heuristics)',
                actionableRecommendations: generateActionableRecommendations(prResult.summary),
              }, null, 2),
            }],
          };
        } catch {
          // PRReviewEngine failed — fall back to basic review engine
        }

        // Fallback: use basic CodeReviewEngine
        const reviewEngine = ctx.getReviewEngine();
        const session = await reviewEngine.reviewDiff(projectId, diffs);

        const allComments = extractCommentsFromSession(session);
        const filtered = filterComments(allComments, severity as Severity, categories as ReviewCategory[]);
        const sum = buildSummary(filtered);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              projectId,
              range: { from: fromRef, to: toRef },
              hasDiff: true,
              comments: filtered,
              summary: sum,
              severity,
              categories: categories ?? ['bug', 'security', 'performance', 'maintainability', 'style', 'documentation', 'architecture'],
              sessionId: session.id,
              filesReviewed: session.filesReviewed,
              reviewMethod: 'Basic code review (heuristics)',
            }, null, 2),
          }],
        };
      }

      // No diff content — run heuristic analysis on what we know
      const heuristicsResults = runBasicHeuristics(projectId, ctx);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            range: { from: fromRef, to: toRef },
            hasDiff: false,
            comments: heuristicsResults.comments,
            summary: heuristicsResults.summary,
            severity,
            categories: categories ?? ['bug', 'security', 'performance', 'maintainability', 'style', 'documentation', 'architecture'],
            note: 'No diff content provided. Supply diff content for full analysis.',
          }, null, 2),
        }],
      };
    }

    // Fallback: basic analysis
    const graphStore = getStore(store);
    if (graphStore) {
      const integrity = graphStore.validateIntegrity(projectId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            range: { from: fromRef, to: toRef },
            hasDiff: false,
            comments: [],
            summary: {
              total: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              info: 0,
            },
            severity,
            categories: categories ?? ['bug', 'security', 'performance', 'maintainability', 'style', 'documentation', 'architecture'],
            graphIntegrity: integrity,
            note: 'Graph data available. Supply diff content for in-depth review.',
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          range: { from: fromRef, to: toRef },
          hasDiff: Boolean(diffContent),
          comments: [],
          summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          severity,
          categories: categories ?? ['bug', 'security', 'performance', 'maintainability', 'style', 'documentation', 'architecture'],
          note: 'No graph store or ToolContext available',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Review error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// review_file
// ---------------------------------------------------------------------------

interface ReviewFileParams {
  projectId: string;
  filePath: string;
  content?: string;
  severity?: string;
}

export const reviewFileSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    filePath: { type: 'string', description: 'File path to review' },
    content: { type: 'string', description: 'File content (optional, auto-detected if not provided)' },
    severity: { type: 'string', description: 'Minimum severity to report' },
  },
  required: ['projectId', 'filePath'],
};

export async function reviewFile(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as ReviewFileParams;
  const projectId = params.projectId;
  const filePath = params.filePath;
  const content = params.content;
  const severity = params.severity ?? 'medium';

  try {
    const ctx = getContext(store);

    if (ctx && content) {
      const reviewEngine = ctx.getReviewEngine();
      const comments = await reviewEngine.reviewFile(projectId, filePath, content);

      const filtered = filterComments(comments as unknown[], severity as Severity);
      const summary = buildSummary(filtered);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            filePath,
            hasContent: true,
            comments: filtered,
            summary,
            severity,
            reviewMethod: 'Heuristics-based code review',
          }, null, 2),
        }],
      };
    }

    if (ctx) {
      // No content provided — analyze from graph data
      const fileNodes = ctx.getFileSymbols(projectId, filePath);

      const fileComments = analyzeFileFromGraph(filePath, fileNodes);
      const filtered = filterComments(fileComments, severity as Severity);
      const summary = buildSummary(filtered);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            filePath,
            hasContent: false,
            comments: filtered,
            summary,
            severity,
            symbolsInFile: fileNodes.length,
            note: 'Graph-based analysis. Provide file content for detailed review.',
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          filePath,
          hasContent: Boolean(content),
          comments: [],
          summary: { total: 0, files: 1 },
          severity,
          note: 'File-level review requires a graph store with indexed data',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Review error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse raw git diff content into GitDiff objects. */
function parseDiffContent(_projectId: string, rawDiff: string): GitDiff[] {
  const diffs: GitDiff[] = [];
  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    let filePath = '';
    let oldPath: string | undefined;
    let changeType: GitDiff['changeType'] = 'modified';

    for (const line of lines) {
      if (line.startsWith('--- ')) {
        oldPath = line.replace('--- a/', '').trim();
      }
      if (line.startsWith('+++ ')) {
        filePath = line.replace('+++ b/', '').trim();
      }
      if (line.startsWith('new file mode')) {
        changeType = 'added';
      }
      if (line.startsWith('deleted file mode')) {
        changeType = 'deleted';
      }
      if (line.startsWith('rename from')) {
        changeType = 'renamed';
      }
    }

    if (filePath) {
      // Extract change ranges from @@ lines
      const ranges: GitDiff['ranges'] = [];
      for (const line of lines) {
        const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          const oldStart = parseInt(match[1]!, 10);
          const oldCount = parseInt(match[2] ?? '1', 10);
          const newStart = parseInt(match[3]!, 10);
          const newCount = parseInt(match[4] ?? '1', 10);

          ranges.push({
            oldStart,
            oldEnd: oldStart + oldCount,
            newStart,
            newEnd: newStart + newCount,
            changeType: (oldCount > 0 && newCount > 0) ? 'modified' : oldCount > 0 ? 'removed' : 'added',
          });
        }
      }

      diffs.push({
        filePath,
        oldHash: '',
        newHash: '',
        oldPath,
        changeType,
        ranges: ranges.length > 0 ? ranges : [{
          oldStart: 1,
          oldEnd: 1,
          newStart: 1,
          newEnd: 1,
          changeType: 'modified',
        }],
      });
    }
  }

  return diffs;
}

function extractCommentsFromSession(session: { id?: string; commentsGenerated?: number; filesReviewed?: number }): unknown[] {
  // Session stores item_done records in the session store (JSONL).
  // Each record contains the item (file review) with its comments.
  // Return a basic extraction — the actual comments are accessible via
  // the session store's getRecords method.
  const comments: unknown[] = [];

  if (session.commentsGenerated && session.commentsGenerated > 0) {
    // Session exists and has comments — signal that real review data is available
    comments.push({
      id: `session-info-${Date.now()}`,
      path: `[review session: ${session.id}]`,
      content: `Review session completed: ${session.commentsGenerated} comments across ${session.filesReviewed ?? 0} files`,
      thinking: 'Review comments are stored in the session store (JSONL). Use session store API to retrieve individual file reviews with comment details.',
      startLine: 0,
      endLine: 0,
      category: 'documentation' as const,
      severity: 'info' as const,
      filtered: false,
    });
  }

  return comments;
}

function filterComments(comments: any[], minSeverity?: string, categories?: string[]): any[] {
  const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const minOrder = minSeverity ? (severityOrder[minSeverity] ?? 2) : 2;

  return comments.filter((c: any) => {
    const sev = severityOrder[c.severity] ?? 2;
    if (sev < minOrder) return false;
    if (categories && categories.length > 0 && c.category) {
      if (!categories.includes(c.category)) return false;
    }
    return true;
  });
}

function buildSummary(comments: any[]): Record<string, number> {
  const summary = { total: comments.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const c of comments) {
    const key = c.severity as string;
    if (key in summary) {
      (summary as any)[key]++;
    }
  }
  return summary;
}

function runBasicHeuristics(projectId: string, ctx: ToolContext): { comments: unknown[]; summary: Record<string, number> } {
  const comments: unknown[] = [];
  const allNodes = ctx.store.getAllNodes().filter(n => n.projectId === projectId);

  // Check for high-complexity functions
  for (const node of allNodes) {
    if (node.complexity && node.complexity > 20) {
      comments.push({
        id: `h-${node.id}`,
        path: node.filePath ?? '',
        content: `High complexity function: ${node.name}`,
        thinking: `Function "${node.qualifiedName}" has cyclomatic complexity ${node.complexity} (threshold: 10). Consider refactoring into smaller functions.`,
        startLine: node.startLine ?? 0,
        endLine: node.endLine ?? 0,
        category: 'maintainability',
        severity: 'high',
        filtered: false,
      });
    }
  }

  // Check for nodes with many dependents
  for (const node of allNodes) {
    const incoming = ctx.store.getEdgesForNode(node.id, 'CALLS', 'in');
    if (incoming.length > 15) {
      comments.push({
        id: `h-coupling-${node.id}`,
        path: node.filePath ?? '',
        content: `High coupling: ${node.name} used by ${incoming.length} callers`,
        thinking: `Symbol "${node.qualifiedName}" has ${incoming.length} incoming CALLS edges, indicating high coupling. Consider refactoring.`,
        startLine: node.startLine ?? 0,
        endLine: node.endLine ?? 0,
        category: 'architecture',
        severity: 'high',
        filtered: false,
      });
    }
  }

  return {
    comments,
    summary: buildSummary(comments),
  };
}

function analyzeFileFromGraph(filePath: string, fileNodes: import('@code-analyzer/shared').GraphNode[]): unknown[] {
  const comments: unknown[] = [];

  if (fileNodes.length === 0) {
    comments.push({
      id: `f-empty-${Date.now()}`,
      path: filePath,
      content: 'No symbols found in file',
      thinking: `File "${filePath}" has no indexed symbols. The file may be empty, or not yet analyzed.`,
      startLine: 1,
      endLine: 1,
      category: 'maintainability',
      severity: 'low',
      filtered: false,
    });
    return comments;
  }

  // Check for large file (many symbols)
  if (fileNodes.length > 50) {
    comments.push({
      id: `f-large-${Date.now()}`,
      path: filePath,
      content: `Large file: ${fileNodes.length} symbols defined`,
      thinking: `File "${filePath}" defines ${fileNodes.length} symbols. Consider splitting into multiple smaller files.`,
      startLine: 1,
      endLine: 1,
      category: 'maintainability',
      severity: 'medium',
      filtered: false,
    });
  }

  // Check for deeply nested functions
  for (const node of fileNodes) {
    if (node.complexity && node.complexity > 15) {
      comments.push({
        id: `f-complex-${node.id}`,
        path: filePath,
        content: `Complex function: ${node.name} (complexity: ${node.complexity})`,
        thinking: `Function "${node.qualifiedName}" has cyclomatic complexity ${node.complexity}.`,
        startLine: node.startLine ?? 0,
        endLine: node.endLine ?? 0,
        category: 'maintainability',
        severity: node.complexity > 25 ? 'high' : 'medium',
        filtered: false,
      });
    }
  }

  return comments;
}

/**
 * Generate actionable recommendations from PR review summary.
 * Produces prioritized, concrete fix suggestions based on review findings.
 */
function generateActionableRecommendations(
  summary: { totalComments: number; riskLevel: string; mergeRecommendation: string; byCategory?: Record<string, number>; bySeverity?: Record<string, number> },
): Array<{ priority: string; action: string; detail: string }> {
  const recs: Array<{ priority: string; action: string; detail: string }> = [];

  if (summary.riskLevel === 'critical' || summary.riskLevel === 'high') {
    recs.push({
      priority: 'immediate',
      action: 'Do not merge — address critical issues first',
      detail: `${summary.bySeverity?.['critical'] ?? 0} critical and ${summary.bySeverity?.['high'] ?? 0} high severity findings require resolution before merge.`,
    });
  }

  if (summary.mergeRecommendation === 'request-changes' || summary.mergeRecommendation === 'block') {
    recs.push({
      priority: 'high',
      action: 'Request changes before merging',
      detail: 'Review all findings and resolve blocking issues. Add regression tests for affected code paths.',
    });
  }

  const bugCount = summary.byCategory?.['bug'] ?? 0;
  if (bugCount > 0) {
    recs.push({
      priority: bugCount > 3 ? 'high' : 'medium',
      action: `Fix ${bugCount} potential bug(s)`,
      detail: 'Add unit tests covering the edge cases identified. Verify input validation and error handling.',
    });
  }

  const securityCount = summary.byCategory?.['security'] ?? 0;
  if (securityCount > 0) {
    recs.push({
      priority: 'high',
      action: `Address ${securityCount} security concern(s)`,
      detail: 'Review for input sanitization, authentication, authorization, and data exposure issues. Run security scan.',
    });
  }

  const perfCount = summary.byCategory?.['performance'] ?? 0;
  if (perfCount > 0) {
    recs.push({
      priority: 'medium',
      action: `Optimize ${perfCount} performance issue(s)`,
      detail: 'Consider caching, lazy loading, or algorithmic improvements. Run performance benchmarks.',
    });
  }

  const maintCount = summary.byCategory?.['maintainability'] ?? 0;
  if (maintCount > 5) {
    recs.push({
      priority: 'medium',
      action: 'Refactor for maintainability',
      detail: `${maintCount} maintainability issues found. Extract complex functions, reduce nesting, improve naming.`,
    });
  }

  // Always include these best practices
  recs.push({
    priority: 'low',
    action: 'Ensure test coverage for changed code',
    detail: 'Add or update unit tests to cover new and modified code paths. Target >80% coverage on changed files.',
  });

  recs.push({
    priority: 'low',
    action: 'Update documentation',
    detail: 'Update API docs, changelog, and architecture decision records if public interfaces changed.',
  });

  return recs;
}

/* v8 ignore stop */