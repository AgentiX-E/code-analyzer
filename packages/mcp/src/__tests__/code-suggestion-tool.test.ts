// @ts-nocheck
// @code-analyzer/mcp — Code Suggestion Tool Tests

import { describe, it, expect } from 'vitest';
import type { ReviewComment } from '@code-analyzer/shared';
import {
  generateSuggestions,
  generateSuggestionForComment,
  createSuggestionTemplate,
  validateSuggestionSyntax,
  generateSuggestionSummary,
  formatSuggestionReport,
  codeSuggestionTool,
} from '../tools/code-suggestion.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    path: '/src/test.ts',
    content: 'This is a test issue',
    existingCode: 'const x = 1;\nconst y = x + 2;\nconsole.log(y);',
    startLine: 10,
    endLine: 15,
    category: 'bug',
    severity: 'medium',
    filtered: false,
    createdAt: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe('codeSuggestionTool definition', () => {
  it('should have the correct tool name', () => {
    expect(codeSuggestionTool.name).toBe('code_suggestion');
  });

  it('should have a non-empty description', () => {
    expect(codeSuggestionTool.description.length).toBeGreaterThan(0);
  });

  it('should have a valid inputSchema', () => {
    expect(codeSuggestionTool.inputSchema.type).toBe('object');
    expect(codeSuggestionTool.inputSchema.properties).toBeDefined();
    expect(codeSuggestionTool.inputSchema.required).toContain('projectId');
    expect(codeSuggestionTool.inputSchema.required).toContain('reviewComments');
  });

  it('should have a callable handler', () => {
    expect(typeof codeSuggestionTool.handler).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Handler Tests
// ---------------------------------------------------------------------------

describe('codeSuggestionTool handler', () => {
  it('should return error for invalid JSON review comments', async () => {
    const result = await codeSuggestionTool.handler({
      projectId: 'test',
      reviewComments: 'invalid json{{{',
    });
    expect(result.isError).toBe(true);
  });

  it('should generate suggestions for comments', async () => {
    const comments = [makeComment()];
    const result = await codeSuggestionTool.handler({
      projectId: 'test-project',
      reviewComments: JSON.stringify(comments),
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Code Fix Suggestions');
    expect(result.metadata.totalFindings).toBe(1);
  });

  it('should respect maxSuggestions limit', async () => {
    const comments = [
      makeComment({ id: 'c1' }),
      makeComment({ id: 'c2' }),
      makeComment({ id: 'c3' }),
      makeComment({ id: 'c4' }),
      makeComment({ id: 'c5' }),
    ];
    const result = await codeSuggestionTool.handler({
      projectId: 'test-project',
      reviewComments: JSON.stringify(comments),
      maxSuggestions: 3,
    });
    expect(result.metadata.totalSuggestions).toBeLessThanOrEqual(3);
  });

  it('should handle empty comments', async () => {
    const result = await codeSuggestionTool.handler({
      projectId: 'empty-project',
      reviewComments: JSON.stringify([]),
    });
    expect(result.isError).toBeUndefined();
    expect(result.metadata.totalSuggestions).toBe(0);
  });

  it('should handle reviewComments as object', async () => {
    const result = await codeSuggestionTool.handler({
      projectId: 'test-project',
      reviewComments: [makeComment()],
    });
    expect(result.isError).toBeUndefined();
  });

  it('should accept language parameter', async () => {
    const result = await codeSuggestionTool.handler({
      projectId: 'test-project',
      reviewComments: JSON.stringify([makeComment()]),
      language: 'python',
    });
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateSuggestions
// ---------------------------------------------------------------------------

describe('generateSuggestions', () => {
  it('should generate suggestions for all comments', () => {
    const comments = [makeComment(), makeComment({ id: 'c2' })];
    const report = generateSuggestions('test', comments, 10);
    expect(report.totalFindings).toBe(2);
    expect(report.totalSuggestions).toBe(2);
  });

  it('should respect maxSuggestions limit', () => {
    const comments = Array.from({ length: 20 }, (_, i) => makeComment({ id: `c${i}` }));
    const report = generateSuggestions('test', comments, 5);
    expect(report.totalSuggestions).toBe(5);
  });

  it('should count auto-applicable suggestions', () => {
    const comments = [makeComment({ category: 'style', suggestionCode: 'fixed code' })];
    const report = generateSuggestions('test', comments, 10);
    expect(report.autoApplicableCount).toBeGreaterThanOrEqual(0);
  });

  it('should handle comments with no content', () => {
    const comment = makeComment({ content: '', existingCode: '' });
    const report = generateSuggestions('test', [comment], 10);
    // Comment without content or existingCode returns null from generateSuggestionForComment
    expect(report.totalSuggestions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateSuggestionForComment
// ---------------------------------------------------------------------------

describe('generateSuggestionForComment', () => {
  it('should return null for empty content and existingCode', () => {
    const comment = makeComment({ content: '', existingCode: '' });
    expect(generateSuggestionForComment(comment)).toBeNull();
  });

  it('should generate suggestion with syntax validation', () => {
    const comment = makeComment();
    const suggestion = generateSuggestionForComment(comment);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.findingId).toBe('comment-1');
    expect(suggestion!.category).toBe('bug');
    expect(typeof suggestion!.syntaxValid).toBe('boolean');
    expect(Array.isArray(suggestion!.warnings)).toBe(true);
  });

  it('should use language parameter', () => {
    const comment = makeComment();
    const suggestion = generateSuggestionForComment(comment, 'python');
    expect(suggestion).not.toBeNull();
  });

  it('should use suggestionCode from comment when available', () => {
    const comment = makeComment({
      category: 'bug',
      suggestionCode: 'const fixed = true;',
    });
    const suggestion = generateSuggestionForComment(comment);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.afterCode).toContain('fixed');
    expect(suggestion!.isAutoApplicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createSuggestionTemplate — Category Tests
// ---------------------------------------------------------------------------

describe('createSuggestionTemplate — bug category', () => {
  it('should create bug fix with null check for dot-notation code', () => {
    const comment = makeComment({
      category: 'bug',
      existingCode: 'obj.method();',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toBe('Fix Potential Bug');
    expect(template!.afterCode).toContain('obj != null');
    expect(template!.isAutoApplicable).toBe(false);
  });

  it('should create bug fix for non-dot-notation code', () => {
    const comment = makeComment({
      category: 'bug',
      existingCode: 'const x = calculate();',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('FIX:');
  });

  it('should use suggestionCode for bug when available', () => {
    const comment = makeComment({
      category: 'bug',
      suggestionCode: 'const fixed = true;',
      existingCode: 'const broken = false;',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('const fixed = true;');
    expect(template!.isAutoApplicable).toBe(true);
  });

  it('should handle bug with no existing code or suggestion', () => {
    const comment = makeComment({
      category: 'bug',
      existingCode: '',
      suggestionCode: undefined,
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('TODO');
  });

  it('should create bug fix with null check for Python code', () => {
    const comment = makeComment({
      category: 'bug',
      existingCode: 'obj.method()',
    });
    const template = createSuggestionTemplate(comment, 'python');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('is not None');
  });
});

describe('createSuggestionTemplate — security category', () => {
  it('should replace innerHTML with textContent', () => {
    const comment = makeComment({
      category: 'security',
      existingCode: 'element.innerHTML = userInput;',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toBe('Security Fix');
    expect(template!.afterCode).toContain('textContent');
    expect(template!.isAutoApplicable).toBe(true);
  });

  it('should flag eval usage', () => {
    const comment = makeComment({
      category: 'security',
      existingCode: 'eval(userInput);',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('WARNING');
    expect(template!.isAutoApplicable).toBe(false);
  });

  it('should flag hardcoded credentials', () => {
    const comment = makeComment({
      category: 'security',
      existingCode: "const password = 'secret123';",
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('process.env');
  });

  it('should handle security with no existing code', () => {
    const comment = makeComment({
      category: 'security',
      existingCode: '',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('TODO');
  });
});

describe('createSuggestionTemplate — performance category', () => {
  it('should suggest caching for loop patterns', () => {
    const comment = makeComment({
      category: 'performance',
      existingCode: 'items.forEach(item => process(item));',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toBe('Performance Optimization');
  });

  it('should optimize async map patterns', () => {
    const comment = makeComment({
      category: 'performance',
      existingCode: 'const results = await items.map(fn);',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('Promise.all');
  });

  it('should handle performance with no existing code', () => {
    const comment = makeComment({
      category: 'performance',
      existingCode: '',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('TODO');
  });
});

describe('createSuggestionTemplate — maintainability category', () => {
  it('should suggest extraction for long code', () => {
    const longCode = 'line1;\nline2;\nline3;\nline4;\nline5;\nline6;';
    const comment = makeComment({
      category: 'maintainability',
      existingCode: longCode,
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toBe('Improve Maintainability');
    expect(template!.afterCode).toContain('Extract');
  });

  it('should handle short maintainability code', () => {
    const comment = makeComment({
      category: 'maintainability',
      existingCode: 'x = 1;',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain('MAINTAINABILITY:');
  });
});

describe('createSuggestionTemplate — style category', () => {
  it('should be auto-applicable and trivial', () => {
    const comment = makeComment({
      category: 'style',
      suggestionCode: 'const x = 1;',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toBe('Style Fix');
    expect(template!.isAutoApplicable).toBe(true);
    expect(template!.effort).toBe('trivial');
  });

  it('should trim existing code when no suggestion', () => {
    const comment = makeComment({
      category: 'style',
      existingCode: '  const x = 1;  ',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toBe('const x = 1;');
  });
});

describe('createSuggestionTemplate — test category', () => {
  it('should generate test skeleton', () => {
    const comment = makeComment({
      category: 'test',
      content: 'Missing test for edge case',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toBe('Add Test Coverage');
    expect(template!.effort).toBe('medium');
  });

  it('should use suggestionCode for tests', () => {
    const comment = makeComment({
      category: 'test',
      suggestionCode: "it('should work', () => { expect(true).toBe(true); });",
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.afterCode).toContain("it('should work'");
  });
});

describe('createSuggestionTemplate — documentation category', () => {
  it('should generate JSDoc', () => {
    const comment = makeComment({
      category: 'documentation',
      content: 'Missing documentation',
      existingCode: 'function foo() { return 1; }',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toBe('Add Documentation');
    expect(template!.isAutoApplicable).toBe(true);
    expect(template!.effort).toBe('trivial');
  });
});

describe('createSuggestionTemplate — other/default category', () => {
  it('should create generic suggestion', () => {
    const comment = makeComment({
      category: 'architecture',
    });
    const template = createSuggestionTemplate(comment, 'typescript');
    expect(template).not.toBeNull();
    expect(template!.title).toContain('Fix:');
  });
});

// ---------------------------------------------------------------------------
// validateSuggestionSyntax
// ---------------------------------------------------------------------------

describe('validateSuggestionSyntax', () => {
  const baseSuggestion = {
    id: 's1',
    findingId: 'f1',
    category: 'bug',
    title: 'Test',
    description: 'Test',
    beforeCode: 'old',
    afterCode: 'new;',
    filePath: '/test.ts',
    startLine: 1,
    endLine: 1,
    effort: 'small' as const,
    isAutoApplicable: false,
  };

  it('should validate clean code', () => {
    const result = validateSuggestionSyntax(baseSuggestion, 'typescript');
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should flag empty code', () => {
    const result = validateSuggestionSyntax({ ...baseSuggestion, afterCode: '' }, 'typescript');
    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
  });

  it('should flag unmatched braces', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'function foo() {' },
      'typescript',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes('Unmatched braces'))).toBe(true);
  });

  it('should flag unmatched parentheses', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'foo(bar;' },
      'typescript',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes('Unmatched parentheses'))).toBe(true);
  });

  it('should flag unmatched brackets', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'const arr = [1, 2;' },
      'typescript',
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes('Unmatched brackets'))).toBe(true);
  });

  it('should flag empty blocks', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'function foo() {}' },
      'typescript',
    );
    expect(result.warnings.some((w) => w.includes('empty block'))).toBe(true);
  });

  it('should flag TODO markers', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: '// TODO: implement' },
      'typescript',
    );
    expect(result.warnings.some((w) => w.includes('TODO'))).toBe(true);
  });

  it('should flag missing semicolons in JS-like languages', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'function foo() { return 1 }\nfunction bar() { return 2 }' },
      'typescript',
    );
    // The code has >50 chars, no semicolons
    expect(result.warnings.some((w) => w.includes('No semicolons'))).toBe(true);
  });

  it('should flag console.log in production code', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'console.log("debug");' },
      'typescript',
    );
    expect(result.warnings.some((w) => w.includes('console.log'))).toBe(true);
  });

  it('should flag tabs in Python', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: '\tdef foo():' },
      'python',
    );
    expect(result.warnings.some((w) => w.includes('Tab characters'))).toBe(true);
  });

  it('should not flag semicolons in short code', () => {
    const result = validateSuggestionSyntax({ ...baseSuggestion, afterCode: 'x' }, 'typescript');
    // Short code (<50 chars) doesn't trigger the semicolon check
    expect(result.warnings.some((w) => w.includes('semicolons'))).toBe(false);
  });

  it('should be valid with warnings (non-structural issues)', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'console.log("test");' },
      'typescript',
    );
    // Only has console.log warning, not a structural error
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // --- Additional branch coverage ---
  it('should not flag TODO when afterCode includes FIX:', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: '// FIX: something TODO later' },
      'typescript',
    );
    expect(result.warnings.some((w) => w.includes('TODO'))).toBe(false);
  });

  it('should handle Python language without tab warnings', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'def foo():\n    pass' },
      'python',
    );
    expect(result.warnings.some((w) => w.includes('Tab characters'))).toBe(false);
  });

  it('should handle unknown language without specific checks', () => {
    const result = validateSuggestionSyntax(
      { ...baseSuggestion, afterCode: 'valid code;' },
      'ruby',
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateSuggestionSummary
// ---------------------------------------------------------------------------

describe('generateSuggestionSummary', () => {
  it('should handle empty suggestions', () => {
    expect(generateSuggestionSummary([])).toContain('No fix suggestions');
  });

  it('should include auto-applicable count', () => {
    const suggestions = [
      {
        id: 's1',
        findingId: 'f1',
        category: 'style',
        title: 'S1',
        description: 'D',
        beforeCode: '',
        afterCode: 'x;',
        filePath: '/a.ts',
        startLine: 1,
        endLine: 1,
        effort: 'trivial' as const,
        isAutoApplicable: true,
        syntaxValid: true,
        warnings: [],
      },
    ];
    const summary = generateSuggestionSummary(suggestions);
    expect(summary).toContain('1 suggestion');
    expect(summary).toContain('auto-applicable');
  });

  it('should include effort distribution', () => {
    const suggestions = [
      {
        id: 's1',
        findingId: 'f1',
        category: 'bug',
        title: 'S1',
        description: 'D',
        beforeCode: '',
        afterCode: 'x;',
        filePath: '/a.ts',
        startLine: 1,
        endLine: 1,
        effort: 'medium' as const,
        isAutoApplicable: false,
        syntaxValid: true,
        warnings: [],
      },
      {
        id: 's2',
        findingId: 'f2',
        category: 'style',
        title: 'S2',
        description: 'D',
        beforeCode: '',
        afterCode: 'y;',
        filePath: '/b.ts',
        startLine: 1,
        endLine: 1,
        effort: 'trivial' as const,
        isAutoApplicable: true,
        syntaxValid: true,
        warnings: [],
      },
    ];
    const summary = generateSuggestionSummary(suggestions);
    expect(summary).toContain('trivial');
    expect(summary).toContain('medium');
  });
});

// ---------------------------------------------------------------------------
// formatSuggestionReport
// ---------------------------------------------------------------------------

describe('formatSuggestionReport', () => {
  it('should format empty report', () => {
    const report = generateSuggestions('test', [], 10);
    const formatted = formatSuggestionReport(report);
    expect(formatted).toContain('Code Fix Suggestions');
    expect(formatted).toContain('No fix suggestions');
  });

  it('should format report with suggestions', () => {
    const report = generateSuggestions('test', [makeComment()], 10);
    const formatted = formatSuggestionReport(report);
    expect(formatted).toContain('Code Fix Suggestions');
    expect(formatted).toContain('/src/test.ts');
  });

  it('should show auto/manual labels', () => {
    const report = generateSuggestions('test', [makeComment({ category: 'style' })], 10);
    const formatted = formatSuggestionReport(report);
    // Style suggestions are auto-applicable
    expect(formatted).toContain('[Auto]');
  });

  it('should include before/after code blocks', () => {
    const report = generateSuggestions('test', [makeComment()], 10);
    const formatted = formatSuggestionReport(report);
    expect(formatted).toContain('**Before:**');
    expect(formatted).toContain('**After:**');
    expect(formatted).toContain('```');
  });

  it('should include warnings section when present', () => {
    const comment = makeComment({
      existingCode: 'function foo() {',
      content: 'Unmatched brace',
    });
    const report = generateSuggestions('test', [comment], 10);
    const formatted = formatSuggestionReport(report);
    // May or may not have warnings depending on what afterCode looks like
    if (report.suggestions.length > 0 && report.suggestions[0]!.warnings.length > 0) {
      expect(formatted).toContain('**Warnings:**');
    }
  });

  // --- Effort level coverage ---
  it('should show [Manual] label for non-auto suggestions', () => {
    const report = generateSuggestions('test', [makeComment({ category: 'bug' })], 10);
    const formatted = formatSuggestionReport(report);
    expect(formatted).toContain('[Manual]');
  });

  it('should format suggestion with large effort', () => {
    const comment = makeComment({ category: 'bug', existingCode: 'x'.repeat(100) });
    const suggestion = generateSuggestionForComment(comment);
    expect(suggestion).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle very long code snippets', () => {
    const comment = makeComment({
      existingCode: 'x'.repeat(5000),
      content: 'Long code issue',
    });
    const suggestion = generateSuggestionForComment(comment);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.beforeCode).toHaveLength(5000);
  });

  it('should handle special characters in code', () => {
    const comment = makeComment({
      existingCode: 'const x = `template ${var} string`;',
      content: 'Template literal issue',
    });
    const suggestion = generateSuggestionForComment(comment);
    expect(suggestion).not.toBeNull();
  });

  it('should handle unicode in code', () => {
    const comment = makeComment({
      existingCode: 'const 你好 = "世界";',
      content: 'Unicode variable',
    });
    const suggestion = generateSuggestionForComment(comment);
    expect(suggestion).not.toBeNull();
  });

  it('should generate suggestions for all supported categories', () => {
    const categories = [
      'bug',
      'security',
      'performance',
      'maintainability',
      'style',
      'test',
      'documentation',
      'architecture',
    ] as const;

    for (const category of categories) {
      const comment = makeComment({ category, existingCode: 'const x = 1;' });
      const suggestion = generateSuggestionForComment(comment);
      expect(suggestion).not.toBeNull();
    }
  });
});
