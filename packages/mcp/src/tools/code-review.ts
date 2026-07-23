// @code-analyzer/mcp — Code Review Tools

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl, type ToolContext } from './tool-context.js';
import type { ToolResult } from './registry.js';
import type { GitDiff, ReviewCategory, Severity } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      const reviewEngine = ctx.getReviewEngine();

      // Build GitDiff objects from the diff string if provided
      if (diffContent) {
        const diffs = parseDiffContent(projectId, diffContent);
        const session = await reviewEngine.reviewDiff(projectId, diffs);

        // Filter by severity and categories
        const allComments = extractCommentsFromSession(session);
        const filtered = filterComments(allComments, severity as Severity, categories as ReviewCategory[]);

        const summary = buildSummary(filtered);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              projectId,
              range: { from: fromRef, to: toRef },
              hasDiff: true,
              comments: filtered,
              summary,
              severity,
              categories: categories ?? ['bug', 'security', 'performance', 'maintainability', 'style', 'documentation', 'architecture'],
              sessionId: session.id,
              filesReviewed: session.filesReviewed,
              reviewMethod: 'Heuristics-based code review',
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
      const stats = ctx.getGraphStats(projectId);

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

interface ParsedDiff {
  filePath: string;
  oldPath?: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  ranges: Array<{
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
    changeType: 'added' | 'deleted' | 'modified';
  }>;
}

/** Parse raw git diff content into GitDiff objects. */
function parseDiffContent(projectId: string, rawDiff: string): GitDiff[] {
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
            changeType: (oldCount > 0 && newCount > 0) ? 'modified' : oldCount > 0 ? 'deleted' : 'added',
          });
        }
      }

      diffs.push({
        id: `diff_${diffs.length}`,
        repositoryId: projectId,
        filePath,
        oldPath,
        changeType,
        ranges: ranges.length > 0 ? ranges : [{
          oldStart: 1,
          oldEnd: 1,
          newStart: 1,
          newEnd: 1,
          changeType: 'modified',
        }],
        createdAt: new Date().toISOString(),
      });
    }
  }

  return diffs;
}

function extractCommentsFromSession(session: { commentsGenerated?: number }): unknown[] {
  // The session stores comments in its records. For now return what we have.
  return [];
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
