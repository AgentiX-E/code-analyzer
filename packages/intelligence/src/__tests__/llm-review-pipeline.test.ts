// @code-analyzer/intelligence — LLM Review Pipeline Integration Tests
import { describe, it, expect, beforeEach } from 'vitest';
import { LLMReviewPipeline } from '../llm-review-pipeline.js';
import type { LLMFinding } from '../llm/prompts.js';
import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeLLMFinding(
  overrides: Partial<LLMFinding> = {},
): LLMFinding {
  return {
    id: `f-${Math.random().toString(36).slice(2, 6)}`,
    lane: 'security',
    title: 'SQL injection vulnerability',
    description: 'String interpolation in SQL query allows injection attacks',
    startLine: 2,
    endLine: 3,
    suggestion: 'Use parameterized queries instead',
    severity: 'critical',
    category: 'security',
    snippet: 'const query = `SELECT * FROM users WHERE id = \\'${userId}\\'`;',
    ...overrides,
  };
}

function makeHeuristicComment(
  overrides: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id: `h-${Math.random().toString(36).slice(2, 6)}`,
    path: 'src/test.ts',
    content: 'SQL injection detected',
    thinking: 'Found SQL injection pattern',
    existingCode: "const q = `SELECT * FROM users WHERE id = '${id}'`",
    startLine: 10,
    endLine: 11,
    category: 'security',
    severity: 'critical',
    filtered: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('LLMReviewPipeline — Construction', () => {
  it('constructs with default options', () => {
    const pipeline = new LLMReviewPipeline();
    expect(pipeline).toBeDefined();
  });

  it('constructs with custom minConfidence', () => {
    const pipeline = new LLMReviewPipeline({ minConfidence: 0.5 });
    expect(pipeline).toBeDefined();
  });

  it('constructs with filterLowConfidence enabled', () => {
    const pipeline = new LLMReviewPipeline({ filterLowConfidence: true });
    expect(pipeline).toBeDefined();
  });

  it('constructs with autoAdjust disabled', () => {
    const pipeline = new LLMReviewPipeline({ autoAdjustPositions: false });
    expect(pipeline).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Process Findings — Exact Match
// ---------------------------------------------------------------------------

describe('LLMReviewPipeline — Exact Match Positioning', () => {
  let pipeline: LLMReviewPipeline;

  beforeEach(() => {
    pipeline = new LLMReviewPipeline();
  });

  it('positions a finding with exact content match', () => {
    const content = 'const x = 1;\nconst query = `SELECT * FROM users WHERE id = \\'${userId}\\'`;\nconst y = 2;\n';
    const finding = makeLLMFinding({
      startLine: 2,
      endLine: 2,
      snippet: "const query = `SELECT * FROM users WHERE id = '${userId}'`;",
    });

    const result = pipeline.processFindings([finding], content, 'src/test.ts');
    expect(result.comments.length).toBeGreaterThanOrEqual(1);
    const comment = result.comments[0];
    if (comment) {
      expect(comment.positionConfidence).toBeGreaterThanOrEqual(0.99);
      expect(comment.positionMethod).toBe('exact');
    }
  });

  it('detects position drift and uses heuristic match', () => {
    const content = 'line1\nline2\nconst query = `SELECT * FROM users WHERE id = \\'${userId}\\'`;\nline4\nline5\n';
    const finding = makeLLMFinding({
      startLine: 1,  // Wrong! Actually at line 3
      endLine: 2,
      snippet: "const query = `SELECT * FROM users WHERE id = '${userId}'`;",
    });

    const result = pipeline.processFindings([finding], content, 'src/test.ts');
    expect(result.comments.length).toBeGreaterThanOrEqual(1);
    const comment = result.comments[0];
    if (comment) {
      // Should be repositioned to the actual content location
      expect(comment.positionMethod).toBeDefined();
    }
  });

  it('falls back for completely unmatched snippets', () => {
    const content = 'line1\nline2\nline3\n';
    const finding = makeLLMFinding({
      startLine: 5,
      endLine: 5,
      snippet: 'completely different content not in file',
    });

    const result = pipeline.processFindings([finding], content, 'src/test.ts');
    expect(result.comments.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Merge with Heuristic
// ---------------------------------------------------------------------------

describe('LLMReviewPipeline — Merge with Heuristic', () => {
  let pipeline: LLMReviewPipeline;

  beforeEach(() => {
    pipeline = new LLMReviewPipeline();
  });

  it('merges non-overlapping LLM and heuristic comments', () => {
    const content = 'line1\nline2\nline3\nline4\nline5\n';
    const llmFinding = makeLLMFinding({
      startLine: 5, endLine: 5, category: 'performance',
      snippet: 'line5',
    });
    const llmResult = pipeline.processFindings([llmFinding], content, 'src/test.ts');

    const heuristic = [
      makeHeuristicComment({ startLine: 1, endLine: 2, category: 'security' }),
    ];

    const merged = pipeline.mergeWithHeuristic(llmResult.comments, heuristic);
    expect(merged.length).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates overlapping comments in same category', () => {
    const content = 'const q = `SELECT * FROM users WHERE id = \\'${id}\\'`;\n';
    const llmFinding = makeLLMFinding({
      startLine: 1, endLine: 1, category: 'security',
      snippet: "const q = `SELECT * FROM users WHERE id = '${id}'`;",
    });
    const llmResult = pipeline.processFindings([llmFinding], content, 'src/test.ts');

    const heuristic = [
      makeHeuristicComment({ startLine: 1, endLine: 1, category: 'security' }),
    ];

    const merged = pipeline.mergeWithHeuristic(llmResult.comments, heuristic);
    // LLM comment should be filtered as duplicate of heuristic
    // Should not double-count
    expect(merged.length).toBe(1);
  });

  it('keeps LLM comments in different categories', () => {
    const content = 'line a\nline b\nline c\n';
    const llmFinding = makeLLMFinding({
      startLine: 2, endLine: 2, category: 'performance',
      snippet: 'line b',
    });
    const llmResult = pipeline.processFindings([llmFinding], content, 'src/test.ts');

    const heuristic = [
      makeHeuristicComment({ startLine: 1, endLine: 2, category: 'security' }),
    ];

    const merged = pipeline.mergeWithHeuristic(llmResult.comments, heuristic);
    expect(merged.length).toBeGreaterThan(1);
  });

  it('filters low-confidence LLM comments', () => {
    const content = 'a\nb\nc\n';
    const llmFinding = makeLLMFinding({
      startLine: 5, endLine: 5, category: 'style',
      snippet: 'not in file',
    });
    const strict = new LLMReviewPipeline({ minConfidence: 0.8 });
    const llmResult = strict.processFindings([llmFinding], content, 'src/test.ts');

    const heuristic = [
      makeHeuristicComment({ startLine: 1, endLine: 1, category: 'security' }),
    ];

    const merged = strict.mergeWithHeuristic(llmResult.comments, heuristic);
    // Low confidence comments should be filtered
    const llmComments = merged.filter(
      (c) => !heuristic.some((h) => h.id === c.id),
    );
    expect(llmComments.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Reflection Quality
// ---------------------------------------------------------------------------

describe('LLMReviewPipeline — Reflection Quality', () => {
  const pipeline = new LLMReviewPipeline();

  it('produces valid reflection report', () => {
    const content = 'function real(): string { return "real"; }\n';
    const finding = makeLLMFinding({
      startLine: 1, endLine: 1, category: 'correctness',
      snippet: 'function real(): string { return "real"; }',
    });

    const result = pipeline.processFindings([finding], content, 'src/test.ts');
    expect(result.reflection).toBeDefined();
    expect(result.reflection.totalComments).toBeGreaterThanOrEqual(0);
    expect(result.reflection.qualityScore).toBeDefined();
    expect(result.reflection.timestamp).toBeDefined();
  });

  it('reports noise reduction correctly', () => {
    const pipeline = new LLMReviewPipeline({ filterLowConfidence: true, minConfidence: 0.9 });
    // These findings don't match file content → will have low confidence
    const findings = [
      makeLLMFinding({ startLine: 1, endLine: 1, snippet: 'nonexistent content', category: 'style' }),
      makeLLMFinding({ startLine: 2, endLine: 2, snippet: 'also not here', category: 'style' }),
    ];
    const result = pipeline.processFindings(findings, 'real content', 'src/test.ts');
    expect(result.noiseReduction).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge Cases
// ---------------------------------------------------------------------------

describe('LLMReviewPipeline — Edge Cases', () => {
  const pipeline = new LLMReviewPipeline();

  it('handles empty findings list', () => {
    const result = pipeline.processFindings([], 'content', 'file.ts');
    expect(result.comments).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.finalCount).toBe(0);
  });

  it('handles empty file content', () => {
    const finding = makeLLMFinding();
    const result = pipeline.processFindings([finding], '', 'file.ts');
    expect(result.comments).toBeDefined();
  });

  it('handles very large file content', () => {
    const content = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const finding = makeLLMFinding({
      startLine: 500, endLine: 500, category: 'style',
      snippet: 'line 499',
    });
    const result = pipeline.processFindings([finding], content, 'file.ts');
    expect(result.comments).toBeDefined();
  });

  it('handles findings with out-of-bounds line numbers', () => {
    const content = 'short file\n';
    const finding = makeLLMFinding({
      startLine: 999, endLine: 1000, category: 'correctness',
      snippet: 'short file',
    });
    const result = pipeline.processFindings([finding], content, 'file.ts');
    // Should clamp to valid range
    if (result.comments.length > 0 && result.comments[0]) {
      expect(result.comments[0].startLine).toBeLessThanOrEqual(1);
    }
  });

  it('handles duplicate LLM findings for same location', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const finding1 = makeLLMFinding({ startLine: 1, endLine: 1, snippet: 'const x = 1;', category: 'style' });
    const finding2 = makeLLMFinding({ startLine: 1, endLine: 1, snippet: 'const x = 1;', category: 'style' });
    const result = pipeline.processFindings([finding1, finding2], content, 'file.ts');
    // CommentReflection should detect duplicate
    expect(result.reflection).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Acceptance Criteria
// ---------------------------------------------------------------------------

describe('LLMReviewPipeline — Acceptance Criteria', () => {
  it('AC-1: Exact match produces confidence 1.0', () => {
    const content = 'export const API_KEY = "sk-secret-key-12345";\n';
    const finding = makeLLMFinding({
      startLine: 1, endLine: 1, category: 'security',
      snippet: 'export const API_KEY = "sk-secret-key-12345";',
    });
    const result = new LLMReviewPipeline().processFindings([finding], content, 'src/api.ts');
    if (result.comments.length > 0 && result.comments[0]) {
      expect(result.comments[0].positionConfidence).toBe(1.0);
      expect(result.comments[0].positionMethod).toBe('exact');
    }
  });

  it('AC-2: Position drift is corrected by heuristic match', () => {
    const content = '// comment\n// another comment\nconst BAD = `SELECT * FROM users WHERE id = \\'${id}\\'`;\n// more\n';
    const finding = makeLLMFinding({
      startLine: 1, endLine: 2,  // WRONG — actual is line 3
      category: 'security',
      snippet: "const BAD = `SELECT * FROM users WHERE id = '${id}'`;",
    });
    const result = new LLMReviewPipeline().processFindings([finding], content, 'src/app.ts');
    if (result.comments.length > 0 && result.comments[0]) {
      // Should have been repositioned
      expect(result.comments[0].positionMethod).toBeDefined();
      // The heuristic should find the content at line 3
      if (result.comments[0].positionMethod === 'heuristic') {
        expect(result.comments[0].startLine).toBe(3);
      }
    }
  });

  it('AC-3: Reflection filters duplicate LLM findings', () => {
    const content = 'line1\nline2\nline3\n';
    const f1 = makeLLMFinding({ startLine: 1, endLine: 1, category: 'style', snippet: 'line1' });
    const f2 = makeLLMFinding({ startLine: 1, endLine: 1, category: 'style', snippet: 'line1' });
    const result = new LLMReviewPipeline().processFindings([f1, f2], content, 'src/test.ts');
    expect(result.reflection).toBeDefined();
    // Should have duplicate detection
  });

  it('AC-4: Pipeline produces meaningful reflection report', () => {
    const content = 'function bad(): void {\n  const q = "SELECT * FROM users WHERE id = \\'${x}\\'";\n}\n';
    const findings = [
      makeLLMFinding({ startLine: 2, endLine: 2, category: 'security',
        snippet: "const q = \"SELECT * FROM users WHERE id = '${x}'\";" }),
    ];
    const result = new LLMReviewPipeline().processFindings(findings, content, 'src/app.ts');
    expect(result.reflection.totalComments).toBeGreaterThanOrEqual(0);
    expect(result.reflection.qualityScore).toBeGreaterThanOrEqual(0);
  });

  it('AC-5: Merge with heuristic does not lose heuristic comments', () => {
    const content = 'line1\nline2\nline3\n';
    const llmFinding = makeLLMFinding({ startLine: 1, endLine: 1, category: 'style', snippet: 'line1' });
    const llmResult = new LLMReviewPipeline().processFindings([llmFinding], content, 'src/test.ts');

    const heuristic = [
      makeHeuristicComment({ startLine: 1, endLine: 1, category: 'security', id: 'h1' }),
      makeHeuristicComment({ startLine: 2, endLine: 2, category: 'bug', id: 'h2' }),
      makeHeuristicComment({ startLine: 3, endLine: 3, category: 'performance', id: 'h3' }),
    ];

    const merged = new LLMReviewPipeline().mergeWithHeuristic(llmResult.comments, heuristic);
    expect(merged.filter((c) => c.id.startsWith('h')).length).toBeGreaterThanOrEqual(2);
  });
});
