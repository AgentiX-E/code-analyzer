// @ts-nocheck
// @code-analyzer/mcp — Code Review Tools

import type { ToolResult } from './registry.js';

// ---------------------------------------------------------------------------
// review_diff
// ---------------------------------------------------------------------------

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
  const projectId = args.projectId as string;
  const diff = args.diff as string | undefined;
  const fromRef = (args.fromRef as string) ?? 'HEAD~1';
  const toRef = (args.toRef as string) ?? 'HEAD';
  const severity = (args.severity as string) ?? 'medium';
  const categories = args.categories as string[] | undefined;

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
  const projectId = args.projectId as string;
  const filePath = args.filePath as string;
  const content = args.content as string | undefined;
  const severity = (args.severity as string) ?? 'medium';

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
