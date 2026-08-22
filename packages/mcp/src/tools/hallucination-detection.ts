// @code-analyzer/mcp — Hallucination Detection Tool
// Validates review comments against source code to detect fabricated or
// incorrect references — non-existent symbols, wrong line numbers, and
// mismatched file paths.

import type { McpToolDefinition } from './registry.js';
import type { ReviewComment, GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of validating a single review comment against the codebase */
export interface ValidationResult {
  commentId: string;
  isValid: boolean;
  issues: ValidationIssue[];
  confidence: number;
}

/** A specific issue found during validation */
export interface ValidationIssue {
  type:
    | 'non_existent_file'
    | 'non_existent_symbol'
    | 'line_out_of_range'
    | 'mismatched_content'
    | 'fabricated_reference';
  severity: 'error' | 'warning';
  message: string;
  detail?: string;
}

/** Full hallucination detection output */
export interface HallucinationReport {
  projectId: string;
  totalComments: number;
  validComments: number;
  hallucinatedComments: number;
  overallConfidence: number;
  results: ValidationResult[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const hallucinationDetectionTool: McpToolDefinition = {
  name: 'hallucination_detection',
  description:
    'Validate review comments against the source code knowledge graph. Detects fabricated line numbers, non-existent symbols, mismatched file paths, and other hallucinated content.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to validate against.',
      },
      reviewComments: {
        type: 'string',
        description: 'JSON string of review comments to validate.',
      },
      sourceNodes: {
        type: 'string',
        description: 'Optional JSON string of source graph nodes for validation context.',
      },
      strictMode: {
        type: 'boolean',
        description: 'Enable strict validation mode for more aggressive hallucination detection.',
        default: false,
      },
    },
    required: ['projectId', 'reviewComments'],
  },
  handler: async (args: Record<string, unknown>) => {
    const { projectId, reviewComments, sourceNodes, strictMode } = args;

    let comments: ReviewComment[];
    try {
      comments =
        typeof reviewComments === 'string'
          ? JSON.parse(reviewComments)
          : (reviewComments as ReviewComment[]);
    } catch {
      return {
        content: [{ type: 'text', text: 'Error: Invalid review comments JSON.' }],
        isError: true,
      };
    }

    let nodes: GraphNode[] = [];
    if (sourceNodes) {
      try {
        nodes =
          typeof sourceNodes === 'string' ? JSON.parse(sourceNodes) : (sourceNodes as GraphNode[]);
      } catch {
        // If sourceNodes parsing fails, continue with empty nodes
        // — this means we can't validate against specific symbols
      }
    }

    const strict = (strictMode as boolean) ?? false;
    const report = detectHallucinations(projectId as string, comments, nodes, strict);

    return {
      content: [{ type: 'text', text: formatHallucinationReport(report) }],
      metadata: {
        projectId,
        totalComments: report.totalComments,
        validComments: report.validComments,
        hallucinatedComments: report.hallucinatedComments,
        overallConfidence: report.overallConfidence,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Core Hallucination Detection
// ---------------------------------------------------------------------------

/**
 * Detect hallucinated content in review comments by validating against
 * known source code symbols and file structure.
 */
export function detectHallucinations(
  projectId: string,
  comments: ReviewComment[],
  sourceNodes: GraphNode[] = [],
  strictMode: boolean = false,
): HallucinationReport {
  const results: ValidationResult[] = [];

  // Build lookup maps from source nodes
  const knownFiles = new Set<string>();
  const knownSymbols = new Map<string, GraphNode>();
  const fileLineRanges = new Map<string, { startLine: number; endLine: number }>();

  for (const node of sourceNodes) {
    if (node.filePath) {
      knownFiles.add(node.filePath);
      const existing = fileLineRanges.get(node.filePath);
      if (existing) {
        existing.startLine = Math.min(existing.startLine, node.startLine ?? 1);
        existing.endLine = Math.max(existing.endLine, node.endLine ?? 1);
      } else {
        fileLineRanges.set(node.filePath, {
          startLine: node.startLine ?? 1,
          endLine: node.endLine ?? 1,
        });
      }
    }
    if (node.qualifiedName) {
      knownSymbols.set(node.qualifiedName, node);
    }
  }

  for (const comment of comments) {
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, strictMode);
    results.push({
      commentId: comment.id,
      isValid: issues.every((i) => i.severity !== 'error'),
      issues,
      confidence: computeValidationConfidence(issues),
    });
  }

  const validCount = results.filter((r) => r.isValid).length;
  const hallucinatedCount = results.length - validCount;
  const overallConfidence =
    results.length > 0 ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length : 1.0;

  return {
    projectId,
    totalComments: comments.length,
    validComments: validCount,
    hallucinatedComments: hallucinatedCount,
    overallConfidence: Math.round(overallConfidence * 1000) / 1000,
    results,
    summary: generateDetectionSummary(results),
  };
}

// ---------------------------------------------------------------------------
// Comment Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single review comment against known codebase facts.
 */
export function validateComment(
  comment: ReviewComment,
  knownFiles: Set<string>,
  knownSymbols: Map<string, GraphNode>,
  fileLineRanges: Map<string, { startLine: number; endLine: number }>,
  strictMode: boolean = false,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check 1: File path validation
  if (!comment.path || comment.path.trim() === '') {
    issues.push({
      type: 'non_existent_file',
      severity: 'error',
      message: 'Comment references an empty or missing file path.',
    });
  } else if (knownFiles.size > 0 && !knownFiles.has(comment.path)) {
    // Check for partial path match
    const partialMatch = [...knownFiles].some(
      (f) => f.includes(comment.path) || comment.path.includes(f),
    );
    if (!partialMatch) {
      issues.push({
        type: 'non_existent_file',
        severity: strictMode ? 'error' : 'warning',
        message: `File "${comment.path}" not found in the codebase.`,
        detail: 'The referenced file does not match any known source file.',
      });
    }
  }

  // Check 2: Line number validation
  if (comment.startLine > 0 && knownFiles.size > 0 && knownFiles.has(comment.path)) {
    const range = fileLineRanges.get(comment.path);
    if (range) {
      if (comment.startLine > range.endLine) {
        issues.push({
          type: 'line_out_of_range',
          severity: 'error',
          message: `Line ${comment.startLine} is beyond file end at line ${range.endLine}.`,
          detail: `File "${comment.path}" only has ${range.endLine} lines.`,
        });
      } else if (comment.endLine > range.endLine) {
        issues.push({
          type: 'line_out_of_range',
          severity: 'warning',
          message: `End line ${comment.endLine} exceeds file range (ends at ${range.endLine}).`,
          detail: `The referenced range may extend beyond the actual file.`,
        });
      }
    }
  } else if (comment.startLine < 0) {
    issues.push({
      type: 'line_out_of_range',
      severity: 'error',
      message: `Invalid negative line number: ${comment.startLine}.`,
    });
  } else if (comment.startLine === 0 && strictMode) {
    issues.push({
      type: 'line_out_of_range',
      severity: 'warning',
      message: 'Line number is 0, which may indicate a fabricated reference.',
    });
  }

  // Check 3: Content and symbol validation
  if (
    (comment.content === '' || (comment.content != null && comment.content.trim().length === 0)) &&
    strictMode
  ) {
    issues.push({
      type: 'mismatched_content',
      severity: 'warning',
      message: 'Comment has empty content, which may indicate hallucinated output.',
    });
  }

  // Check 4: Validate referenced symbols in content
  if (knownSymbols.size > 0 && comment.content) {
    const symbolPattern = /`([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)`/g;
    let match;
    while ((match = symbolPattern.exec(comment.content)) !== null) {
      const symbolName = match[1]!;
      // Check if this symbol exists in the codebase
      const exists =
        knownSymbols.has(symbolName) ||
        [...knownSymbols.keys()].some((k) => k.endsWith(symbolName));
      if (!exists && strictMode) {
        issues.push({
          type: 'non_existent_symbol',
          severity: 'warning',
          message: `Referenced symbol "${symbolName}" not found in codebase.`,
          detail: 'This may indicate the AI fabricated a non-existent code reference.',
        });
      }
    }
  }

  // Check 5: Existing code content validation
  if (
    (comment.existingCode === '' ||
      (comment.existingCode != null && comment.existingCode.trim().length === 0)) &&
    strictMode
  ) {
    issues.push({
      type: 'fabricated_reference',
      severity: 'warning',
      message: 'Comment has empty existingCode, which may indicate fabricated context.',
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Confidence Computation
// ---------------------------------------------------------------------------

/**
 * Compute a confidence score for a validation result.
 * Each error reduces confidence significantly; warnings reduce it slightly.
 */
export function computeValidationConfidence(issues: ValidationIssue[]): number {
  if (issues.length === 0) return 1.0;

  let confidence = 1.0;
  for (const issue of issues) {
    if (issue.severity === 'error') {
      confidence -= 0.25;
    } else {
      confidence -= 0.1;
    }
  }

  return Math.max(0, Math.round(confidence * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Summary Generation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable summary of hallucination detection results.
 */
export function generateDetectionSummary(results: ValidationResult[]): string {
  if (results.length === 0) {
    return 'No review comments to validate.';
  }

  const valid = results.filter((r) => r.isValid).length;
  const hallucinated = results.filter((r) => !r.isValid).length;

  if (hallucinated === 0) {
    return `All ${valid} comment(s) passed validation — no hallucinated content detected.`;
  }

  // Count issue types
  const issueTypeCounts = new Map<string, number>();
  for (const result of results) {
    for (const issue of result.issues) {
      issueTypeCounts.set(issue.type, (issueTypeCounts.get(issue.type) ?? 0) + 1);
    }
  }

  const parts: string[] = [];
  parts.push(`${hallucinated} of ${results.length} comment(s) contain potential hallucinations.`);

  if (issueTypeCounts.has('non_existent_file')) {
    parts.push(`${issueTypeCounts.get('non_existent_file')} reference(s) to non-existent files.`);
  }
  if (issueTypeCounts.has('line_out_of_range')) {
    parts.push(`${issueTypeCounts.get('line_out_of_range')} line number(s) out of valid range.`);
  }
  if (issueTypeCounts.has('non_existent_symbol')) {
    parts.push(
      `${issueTypeCounts.get('non_existent_symbol')} reference(s) to non-existent symbols.`,
    );
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Report Formatting
// ---------------------------------------------------------------------------

/**
 * Format the hallucination detection report as a markdown string.
 */
export function formatHallucinationReport(report: HallucinationReport): string {
  const lines: string[] = [];

  lines.push('## Hallucination Detection Report');
  lines.push('');
  lines.push(`**Project:** ${report.projectId}`);
  lines.push(`**Comments Validated:** ${report.totalComments}`);
  lines.push(
    `**Valid:** ${report.validComments} | **Hallucinated:** ${report.hallucinatedComments}`,
  );
  lines.push(`**Overall Confidence:** ${(report.overallConfidence * 100).toFixed(1)}%`);
  lines.push('');
  lines.push(`### Summary`);
  lines.push(report.summary);
  lines.push('');

  // Detailed results for hallucinated comments
  const hallucinated = report.results.filter((r) => !r.isValid);
  if (hallucinated.length > 0) {
    lines.push('### Flagged Comments');
    lines.push('');
    for (const result of hallucinated) {
      lines.push(`**Comment ID:** ${result.commentId}`);
      lines.push(`**Confidence:** ${(result.confidence * 100).toFixed(1)}%`);
      lines.push('');
      for (const issue of result.issues) {
        const prefix = issue.severity === 'error' ? '[ERROR]' : '[WARNING]';
        lines.push(`- ${prefix} (${issue.type}): ${issue.message}`);
        if (issue.detail) {
          lines.push(`  > ${issue.detail}`);
        }
      }
      lines.push('');
    }
  }

  // Valid comments
  const validResults = report.results.filter((r) => r.isValid);
  if (validResults.length > 0) {
    lines.push('### Valid Comments');
    lines.push('');
    for (const result of validResults) {
      lines.push(
        `- Comment \`${result.commentId}\`: ${(result.confidence * 100).toFixed(0)}% confidence`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default hallucinationDetectionTool;
