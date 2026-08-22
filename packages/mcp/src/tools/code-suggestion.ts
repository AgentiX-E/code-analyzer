// @code-analyzer/mcp — Code Suggestion Tool
// Generates fix suggestions for review findings with code transformation
// proposals and syntax validation.

import type { McpToolDefinition } from './registry.js';
import type { ReviewComment, ReviewCategory } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single code transformation suggestion */
export interface CodeSuggestion {
  id: string;
  findingId: string;
  category: ReviewCategory | string;
  title: string;
  description: string;
  /** The original code snippet */
  beforeCode: string;
  /** The suggested replacement code */
  afterCode: string;
  /** The file path where the change should be applied */
  filePath: string;
  /** Starting line number of the change */
  startLine: number;
  /** Ending line number of the change */
  endLine: number;
  /** Estimated effort to implement */
  effort: 'trivial' | 'small' | 'medium' | 'large';
  /** Whether the suggestion is auto-applicable */
  isAutoApplicable: boolean;
  /** Syntax validation result */
  syntaxValid: boolean;
  /** Any warnings about the suggestion */
  warnings: string[];
}

/** Aggregated suggestion report */
export interface SuggestionReport {
  projectId: string;
  totalFindings: number;
  totalSuggestions: number;
  autoApplicableCount: number;
  suggestions: CodeSuggestion[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const codeSuggestionTool: McpToolDefinition = {
  name: 'code_suggestion',
  description:
    'Generate fix suggestions for review findings. Supports code transformation suggestions with syntax validation, effort estimation, and auto-applicability detection.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID.',
      },
      reviewComments: {
        type: 'string',
        description: 'JSON string of review comments to generate suggestions for.',
      },
      maxSuggestions: {
        type: 'number',
        description: 'Maximum number of suggestions to generate (default: 10).',
        default: 10,
      },
      language: {
        type: 'string',
        description: 'Target language for code suggestions.',
        default: 'typescript',
      },
    },
    required: ['projectId', 'reviewComments'],
  },
  handler: async (args: Record<string, unknown>) => {
    const { projectId, reviewComments, maxSuggestions, language } = args;

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

    const max = (maxSuggestions as number) ?? 10;
    const lang = (language as string) ?? 'typescript';
    const report = generateSuggestions(projectId as string, comments, max, lang);

    return {
      content: [{ type: 'text', text: formatSuggestionReport(report) }],
      metadata: {
        projectId,
        totalFindings: report.totalFindings,
        totalSuggestions: report.totalSuggestions,
        autoApplicableCount: report.autoApplicableCount,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Core Suggestion Generation
// ---------------------------------------------------------------------------

/**
 * Generate code fix suggestions from review comments.
 */
export function generateSuggestions(
  projectId: string,
  comments: ReviewComment[],
  maxSuggestions: number = 10,
  language: string = 'typescript',
): SuggestionReport {
  const suggestions: CodeSuggestion[] = [];

  for (const comment of comments) {
    if (suggestions.length >= maxSuggestions) break;

    const suggestion = generateSuggestionForComment(comment, language);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  const autoApplicable = suggestions.filter((s) => s.isAutoApplicable).length;

  return {
    projectId,
    totalFindings: comments.length,
    totalSuggestions: suggestions.length,
    autoApplicableCount: autoApplicable,
    suggestions,
    summary: generateSuggestionSummary(suggestions),
  };
}

// ---------------------------------------------------------------------------
// Per-Comment Suggestion Generation
// ---------------------------------------------------------------------------

/**
 * Generate a fix suggestion for a single review comment.
 */
export function generateSuggestionForComment(
  comment: ReviewComment,
  language: string = 'typescript',
): CodeSuggestion | null {
  if (!comment.content && !comment.existingCode) return null;

  const base = createSuggestionTemplate(comment, language);
  if (!base) return null;

  // Validate the suggestion's syntax
  const validation = validateSuggestionSyntax(base, language);

  const suggestion: CodeSuggestion = {
    ...base,
    syntaxValid: validation.valid,
    warnings: validation.warnings,
  };

  return suggestion;
}

// ---------------------------------------------------------------------------
// Suggestion Templates
// ---------------------------------------------------------------------------

/**
 * Create a suggestion template based on the review comment category.
 */
export function createSuggestionTemplate(
  comment: ReviewComment,
  language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> | null {
  const id = `suggestion_${comment.id}_${Date.now()}`;

  const base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> = {
    id,
    findingId: comment.id,
    category: comment.category,
    title: '',
    description: comment.content,
    beforeCode: comment.existingCode || '',
    afterCode: '',
    filePath: comment.path,
    startLine: comment.startLine,
    endLine: comment.endLine,
    effort: 'small',
    isAutoApplicable: false,
  };

  switch (comment.category) {
    case 'bug':
      return createBugFixSuggestion(base, comment, language);
    case 'security':
      return createSecuritySuggestion(base, comment, language);
    case 'performance':
      return createPerformanceSuggestion(base, comment, language);
    case 'maintainability':
      return createMaintainabilitySuggestion(base, comment, language);
    case 'style':
      return createStyleSuggestion(base, comment, language);
    case 'test':
      return createTestSuggestion(base, comment, language);
    case 'documentation':
      return createDocumentationSuggestion(base, comment, language);
    default:
      return createGenericSuggestion(base, comment, language);
  }
}

// ---------------------------------------------------------------------------
// Category-Specific Suggestions
// ---------------------------------------------------------------------------

function createBugFixSuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = 'Fix Potential Bug';
  base.effort = 'medium';

  // Use suggestionCode if provided — it's the most specific fix
  if (comment.suggestionCode) {
    base.afterCode = comment.suggestionCode;
    base.isAutoApplicable = true;
  } else if (comment.existingCode) {
    // Add null/undefined checks
    if (comment.existingCode.includes('.')) {
      const variable = comment.existingCode.split('.')[0]!;
      base.afterCode =
        language === 'typescript' || language === 'javascript'
          ? `if (${variable} != null) {\n  ${comment.existingCode}\n} else {\n  // Handle null/undefined case\n  throw new Error('${variable} is required');\n}`
          : `if ${variable} is not None:\n    ${comment.existingCode}\nelse:\n    raise ValueError("${variable} is required")`;
      base.isAutoApplicable = false;
    } else {
      base.afterCode = `// FIX: ${comment.content}\n${comment.existingCode}`;
    }
  } else {
    base.afterCode = `// TODO: Fix — ${comment.content}`;
  }

  return base;
}

function createSecuritySuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  _language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = 'Security Fix';
  base.effort = 'medium';

  if (comment.existingCode) {
    const code = comment.existingCode;
    if (code.includes('innerHTML') || code.includes('dangerouslySetInnerHTML')) {
      base.afterCode = code
        .replace(/innerHTML/g, 'textContent')
        .replace(/dangerouslySetInnerHTML/g, 'children');
      base.isAutoApplicable = true;
    } else if (code.includes('eval(') || code.includes('exec(')) {
      base.afterCode = `// WARNING: Avoid using eval/exec. Consider a safer alternative.\n// Original: ${code}\n// Recommended: Use a parser or validator instead.`;
      base.isAutoApplicable = false;
    } else if (code.includes('password') || code.includes('secret') || code.includes('token')) {
      base.afterCode = `// WARNING: Hardcoded credentials detected.\n// Replace with environment variable or secrets manager.\n${code.replace(/['\"].*['\"]/g, 'process.env.SECRET')}`;
      base.isAutoApplicable = false;
    } else {
      base.afterCode = `// SECURITY FIX: ${comment.content}\n${comment.existingCode}`;
    }
  } else {
    base.afterCode = `// TODO: Apply security fix — ${comment.content}`;
  }

  return base;
}

function createPerformanceSuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  _language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = 'Performance Optimization';
  base.effort = 'small';

  if (comment.existingCode) {
    const code = comment.existingCode;
    if (code.includes('.forEach(') || code.includes('for (') || code.includes('while (')) {
      base.afterCode = `// OPTIMIZE: Consider caching or memoizing the result.\n${code}`;
      base.isAutoApplicable = false;
    } else if (code.includes('await ') && code.includes('.map(')) {
      base.afterCode = code.replace('.map(', '.map(async ');
      base.afterCode = `await Promise.all(${base.afterCode})`;
      base.isAutoApplicable = true;
    } else {
      base.afterCode = `// PERFORMANCE: ${comment.content}\n${code}`;
    }
  } else {
    base.afterCode = `// TODO: Optimize — ${comment.content}`;
  }

  return base;
}

function createMaintainabilitySuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  _language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = 'Improve Maintainability';
  base.effort = 'medium';

  if (comment.existingCode) {
    // Suggest extracting complex logic
    if (comment.existingCode.split('\n').length > 5) {
      base.afterCode = `// REFACTOR: Extract into a separate function for clarity.\nfunction processItem(input: unknown): unknown {\n  // TODO: Move the logic here\n  return input;\n}\n\n${comment.existingCode}`;
    } else {
      base.afterCode = `// MAINTAINABILITY: ${comment.content}\n${comment.existingCode}`;
    }
  } else {
    base.afterCode = `// TODO: Improve maintainability — ${comment.content}`;
  }

  return base;
}

function createStyleSuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  _language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = 'Style Fix';
  base.effort = 'trivial';
  base.isAutoApplicable = true;

  if (comment.suggestionCode) {
    base.afterCode = comment.suggestionCode;
  } else if (comment.existingCode) {
    base.afterCode = comment.existingCode.trim();
  } else {
    base.afterCode = `// STYLE: ${comment.content}`;
  }

  return base;
}

function createTestSuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  _language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = 'Add Test Coverage';
  base.effort = 'medium';

  base.afterCode =
    comment.suggestionCode ??
    `// TODO: Add test for: ${comment.content}\n// describe('...', () => {\n//   it('should handle the edge case', () => {\n//     // Add test implementation\n//   });\n// });`;

  return base;
}

function createDocumentationSuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  _language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = 'Add Documentation';
  base.effort = 'trivial';
  base.isAutoApplicable = true;

  base.afterCode =
    comment.suggestionCode ??
    `/**\n * ${comment.content}\n * @returns {void}\n */\n${comment.existingCode}`;

  return base;
}

function createGenericSuggestion(
  base: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  comment: ReviewComment,
  _language: string,
): Omit<CodeSuggestion, 'syntaxValid' | 'warnings'> {
  base.title = `Fix: ${comment.category}`;
  base.effort = 'small';

  base.afterCode = comment.suggestionCode ?? `// FIX: ${comment.content}\n${comment.existingCode}`;

  return base;
}

// ---------------------------------------------------------------------------
// Syntax Validation
// ---------------------------------------------------------------------------

/**
 * Validate the syntax of a generated code suggestion.
 * Performs basic structural checks for common languages.
 */
export function validateSuggestionSyntax(
  suggestion: Omit<CodeSuggestion, 'syntaxValid' | 'warnings'>,
  language: string,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for empty code
  if (!suggestion.afterCode || suggestion.afterCode.trim().length === 0) {
    warnings.push('Suggestion contains empty code.');
    return { valid: false, warnings };
  }

  // Check for unmatched braces/brackets
  const openBraces = (suggestion.afterCode.match(/\{/g) ?? []).length;
  const closeBraces = (suggestion.afterCode.match(/\}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    warnings.push(`Unmatched braces: ${openBraces} opening vs ${closeBraces} closing.`);
  }

  const openParens = (suggestion.afterCode.match(/\(/g) ?? []).length;
  const closeParens = (suggestion.afterCode.match(/\)/g) ?? []).length;
  if (openParens !== closeParens) {
    warnings.push(`Unmatched parentheses: ${openParens} opening vs ${closeParens} closing.`);
  }

  const openBrackets = (suggestion.afterCode.match(/\[/g) ?? []).length;
  const closeBrackets = (suggestion.afterCode.match(/\]/g) ?? []).length;
  if (openBrackets !== closeBrackets) {
    warnings.push(`Unmatched brackets: ${openBrackets} opening vs ${closeBrackets} closing.`);
  }

  // Check for empty blocks
  if (/\{\s*\}/.test(suggestion.afterCode)) {
    warnings.push('Code contains an empty block, which may be unintentional.');
  }

  // Check for TODO placeholders
  if (suggestion.afterCode.includes('TODO') && !suggestion.afterCode.includes('FIX:')) {
    warnings.push('Suggestion contains TODO markers that need manual resolution.');
  }

  // Language-specific checks
  if (language === 'typescript' || language === 'javascript') {
    // Check for semicolons in JS-like languages
    if (!suggestion.afterCode.includes(';') && suggestion.afterCode.length > 50) {
      warnings.push('No semicolons found in the suggestion — verify statement termination.');
    }

    // Check for console.log in production suggestions
    if (suggestion.afterCode.includes('console.log')) {
      warnings.push('Suggestion contains console.log which should be removed in production code.');
    }
  } else if (language === 'python') {
    // Check for mixed tabs/spaces
    if (suggestion.afterCode.includes('\t')) {
      warnings.push('Tab characters detected in Python code — use spaces for indentation.');
    }
  }

  // Only mark invalid if there are structural errors (unmatched braces/parens/brackets)
  const hasStructuralError = warnings.some(
    (w) =>
      w.includes('Unmatched braces') ||
      w.includes('Unmatched parentheses') ||
      w.includes('Unmatched brackets') ||
      w.includes('empty code'),
  );

  return { valid: !hasStructuralError, warnings };
}

// ---------------------------------------------------------------------------
// Summary & Formatting
// ---------------------------------------------------------------------------

/**
 * Generate a summary of the suggestion report.
 */
export function generateSuggestionSummary(suggestions: CodeSuggestion[]): string {
  if (suggestions.length === 0) {
    return 'No fix suggestions generated. All findings may already be resolved or are informational only.';
  }

  const autoCount = suggestions.filter((s) => s.isAutoApplicable).length;
  const byCategory = new Map<string, number>();
  const byEffort = new Map<string, number>();

  for (const s of suggestions) {
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
    byEffort.set(s.effort, (byEffort.get(s.effort) ?? 0) + 1);
  }

  const parts: string[] = [];
  parts.push(`Generated ${suggestions.length} fix suggestion(s) from review findings.`);
  parts.push(`${autoCount} suggestion(s) are auto-applicable.`);

  const effortSummary = [...byEffort.entries()]
    .sort((a, b) => {
      const order = { trivial: 0, small: 1, medium: 2, large: 3 };
      return (order[a[0] as keyof typeof order] ?? 4) - (order[b[0] as keyof typeof order] ?? 4);
    })
    .map(([effort, count]) => `${count} ${effort}`);
  if (effortSummary.length > 0) {
    parts.push(`Effort distribution: ${effortSummary.join(', ')}.`);
  }

  return parts.join(' ');
}

/**
 * Format the suggestion report as a markdown string.
 */
export function formatSuggestionReport(report: SuggestionReport): string {
  const lines: string[] = [];

  lines.push('## Code Fix Suggestions');
  lines.push('');
  lines.push(`**Project:** ${report.projectId}`);
  lines.push(`**Findings Reviewed:** ${report.totalFindings}`);
  lines.push(`**Suggestions Generated:** ${report.totalSuggestions}`);
  lines.push(`**Auto-Applicable:** ${report.autoApplicableCount}`);
  lines.push('');
  lines.push('### Summary');
  lines.push(report.summary);
  lines.push('');

  if (report.suggestions.length === 0) {
    return lines.join('\n');
  }

  for (const suggestion of report.suggestions) {
    const autoLabel = suggestion.isAutoApplicable ? '[Auto]' : '[Manual]';
    const effortIcon =
      suggestion.effort === 'trivial'
        ? '⚡'
        : suggestion.effort === 'small'
          ? '🔧'
          : suggestion.effort === 'medium'
            ? '🔨'
            : '🏗️';
    const validIcon = suggestion.syntaxValid ? '✅' : '⚠️';

    lines.push(`### ${autoLabel} ${suggestion.title} ${effortIcon} ${validIcon}`);
    lines.push(`- **File:** \`${suggestion.filePath}\``);
    lines.push(`- **Lines:** ${suggestion.startLine}-${suggestion.endLine}`);
    lines.push(`- **Category:** ${suggestion.category}`);
    lines.push(`- **Effort:** ${suggestion.effort}`);
    lines.push(`- **Description:** ${suggestion.description}`);
    lines.push('');

    if (suggestion.beforeCode) {
      lines.push('**Before:**');
      lines.push('```');
      lines.push(suggestion.beforeCode);
      lines.push('```');
      lines.push('');
    }

    lines.push('**After:**');
    lines.push('```');
    lines.push(suggestion.afterCode);
    lines.push('```');
    lines.push('');

    if (suggestion.warnings.length > 0) {
      lines.push('**Warnings:**');
      for (const warning of suggestion.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export default codeSuggestionTool;
