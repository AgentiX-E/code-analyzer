// @code-analyzer/mcp — Code Review Tools

import type { ToolResult } from './registry.js';

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

export async function reviewDiff(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as ReviewDiffParams;
  const projectId = params.projectId;
  const diff = params.diff;
  const fromRef = params.fromRef ?? 'HEAD~1';
  const toRef = params.toRef ?? 'HEAD';
  const severity = params.severity ?? 'medium';
  const categories = params.categories;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        projectId,
        range: { from: fromRef, to: toRef },
        hasDiff: Boolean(diff),
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
        note: 'Code review requires an LLM backend for in-depth analysis',
      }, null, 2),
    }],
  };
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

export async function reviewFile(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as ReviewFileParams;
  const projectId = params.projectId;
  const filePath = params.filePath;
  const content = params.content;
  const severity = params.severity ?? 'medium';

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
        note: 'File-level review requires an LLM backend',
      }, null, 2),
    }],
  };
}
