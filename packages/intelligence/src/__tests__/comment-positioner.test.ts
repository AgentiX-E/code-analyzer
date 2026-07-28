// @code-analyzer/intelligence — Comment Positioner Tests

import { describe, it, expect } from 'vitest';
import { CommentPositioner } from '../review/comment-positioner.js';
import type {
  PositionedComment,
  PositionResult,
} from '../review/comment-positioner.js';
import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function positioner(): CommentPositioner {
  return new CommentPositioner();
}

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: 'src/app.ts',
    content: 'Use const instead of let',
    existingCode: 'let x = 1;',
    startLine: 3,
    endLine: 3,
    category: 'style',
    severity: 'low',
    filtered: false,
    id: 'comment-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function positioned(
  overrides: Partial<PositionedComment> = {},
): PositionedComment {
  return {
    path: 'src/app.ts',
    content: 'Use const instead of let',
    existingCode: 'let x = 1;',
    startLine: 3,
    endLine: 3,
    category: 'style',
    severity: 'low',
    filtered: false,
    id: 'comment-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    positionConfidence: 1.0,
    positionMethod: 'exact',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// positionComment — Exact match
// ---------------------------------------------------------------------------

describe('positionComment', () => {
  describe('exact match', () => {
    it('resolves exact match when existingCode matches file content at claimed position', () => {
      const fileContent = 'line1\nline2\nlet x = 1;\nline4\n';
      const comment = makeComment({
        existingCode: 'let x = 1;',
        startLine: 3,
        endLine: 3,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('exact');
      expect(result.positionConfidence).toBe(1.0);
      expect(result.startLine).toBe(3);
      expect(result.endLine).toBe(3);
    });

    it('matches multi-line code snippets exactly', () => {
      const fileContent = 'a\nb\nfunction foo() {\n  return 1;\n}\ne';
      const comment = makeComment({
        existingCode: 'function foo() {\n  return 1;\n}',
        startLine: 3,
        endLine: 5,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('exact');
      expect(result.positionConfidence).toBe(1.0);
    });

    it('matches code with leading/trailing whitespace variance', () => {
      const fileContent = 'line1\n  const x = 1;  \nline3';
      const comment = makeComment({
        existingCode: '  const x = 1;  ',
        startLine: 2,
        endLine: 2,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('exact');
      expect(result.positionConfidence).toBe(1.0);
    });
  });

  describe('heuristic match', () => {
    it('finds code snippet elsewhere in file when position is wrong', () => {
      const fileContent = 'line1\nline2\nlet x = 1;\nline4\nline5';
      const comment = makeComment({
        existingCode: 'let x = 1;',
        startLine: 1, // wrong position
        endLine: 1,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('heuristic');
      expect(result.positionConfidence).toBeGreaterThan(0.3);
      expect(result.startLine).toBe(3);
    });

    it('finds multi-line snippet via heuristic', () => {
      const fileContent = [
        'import foo from "bar";',
        '',
        'function doThing() {',
        '  const result = compute();',
        '  return result;',
        '}',
        '',
        'export default doThing;',
      ].join('\n');

      const comment = makeComment({
        existingCode: 'function doThing() {\n  const result = compute();\n  return result;\n}',
        startLine: 10, // wrong
        endLine: 13,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('heuristic');
      expect(result.startLine).toBe(3);
      expect(result.endLine).toBe(6);
    });

    it('returns fallback when no good heuristic match found', () => {
      const fileContent = 'line1\nline2\nline3\nline4';
      const comment = makeComment({
        existingCode: 'completely_different_code_here();',
        startLine: 2,
        endLine: 2,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('fallback');
      expect(result.positionConfidence).toBe(0.2);
    });
  });

  describe('fallback', () => {
    it('clamps out-of-bounds startLine to file length', () => {
      const fileContent = 'a\nb\nc';
      const comment = makeComment({
        existingCode: 'let x = 1;',
        startLine: 10,
        endLine: 10,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('fallback');
      expect(result.positionConfidence).toBe(0.2);
      expect(result.startLine).toBe(3);
      expect(result.endLine).toBe(3);
    });

    it('clamps endLine to be at least startLine', () => {
      const fileContent = 'a\nb\nc';
      const comment = makeComment({
        existingCode: 'let x = 1;',
        startLine: 5,
        endLine: 1,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('fallback');
      expect(result.startLine).toBe(3);
      expect(result.endLine).toBe(3);
    });

    it('handles empty file content', () => {
      const fileContent = '';
      const comment = makeComment({
        existingCode: 'let x = 1;',
        startLine: 1,
        endLine: 1,
      });

      const result = positioner().positionComment(comment, fileContent);

      expect(result.positionMethod).toBe('fallback');
      expect(result.startLine).toBe(1);
      expect(result.endLine).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// validatePosition
// ---------------------------------------------------------------------------

describe('validatePosition', () => {
  it('returns valid for a correctly positioned comment', () => {
    const fileContent = 'line1\nline2\nlet x = 1;\nline4';
    const comment = positioned({ startLine: 3, endLine: 3 });

    const result = positioner().validatePosition(comment, fileContent);

    expect(result.valid).toBe(true);
  });

  it('returns invalid for empty file', () => {
    const comment = positioned({ startLine: 1, endLine: 1 });

    const result = positioner().validatePosition(comment, '');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('returns invalid for whitespace-only lines in range', () => {
    const fileContent = '   \n\t\n   \nline4';
    const comment = positioned({ startLine: 1, endLine: 3 });

    const result = positioner().validatePosition(comment, fileContent);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('whitespace');
  });

  it('adjusts endLine when it exceeds file length', () => {
    const fileContent = 'line1\nline2';
    const comment = positioned({ startLine: 1, endLine: 5 });

    const result = positioner().validatePosition(comment, fileContent);

    expect(result.valid).toBe(true);
    expect(result.adjustedEndLine).toBe(2);
  });

  it('returns invalid when startLine exceeds file length', () => {
    const fileContent = 'line1\nline2';
    const comment = positioned({ startLine: 10, endLine: 12 });

    const result = positioner().validatePosition(comment, fileContent);

    expect(result.valid).toBe(false);
    expect(result.adjustedStartLine).toBe(2);
    expect(result.adjustedEndLine).toBe(2);
  });

  it('returns invalid when startLine > endLine', () => {
    const fileContent = 'line1\nline2\nline3';
    const comment = positioned({ startLine: 3, endLine: 1 });

    const result = positioner().validatePosition(comment, fileContent);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('startLine');
  });

  it('handles file with only empty string line', () => {
    const comment = positioned({ startLine: 1, endLine: 1 });

    const result = positioner().validatePosition(comment, '\n');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('whitespace');
  });
});

// ---------------------------------------------------------------------------
// adjustContext
// ---------------------------------------------------------------------------

describe('adjustContext', () => {
  it('returns surrounding context with markers', () => {
    const fileContent = 'line1\nline2\nlet x = 1;\nline4\nline5';
    const comment = positioned({ startLine: 3, endLine: 3 });

    const result = positioner().adjustContext(comment, fileContent);

    expect(result).toContain('>');
    expect(result).toContain('let x = 1;');
    expect(result).toContain('line2');
    expect(result).toContain('line4');
  });

  it('uses default 2 lines of context', () => {
    const fileContent = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj';
    const comment = positioned({ startLine: 5, endLine: 6 });

    const result = positioner().adjustContext(comment, fileContent);

    // Context: lines 3-8 (5±2=3 to 6+2=8)
    const lines = result.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('3');
    expect(lines[5]).toContain('8');
  });

  it('accepts custom context line count', () => {
    const fileContent = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj';
    const comment = positioned({ startLine: 5, endLine: 5 });

    const result = positioner().adjustContext(comment, fileContent, 1);

    const lines = result.split('\n');
    expect(lines).toHaveLength(3); // lines 4, 5, 6
  });

  it('clamps context to file bounds', () => {
    const fileContent = 'a\nb\nc';
    const comment = positioned({ startLine: 1, endLine: 1 });

    const result = positioner().adjustContext(comment, fileContent, 5);

    const lines = result.split('\n');
    expect(lines).toHaveLength(3); // only 3 lines in file
  });

  it('marks the target lines with > marker', () => {
    const fileContent = 'line1\nline2\nline3\nline4\nline5';
    const comment = positioned({ startLine: 2, endLine: 4 });

    const result = positioner().adjustContext(comment, fileContent, 0);

    const lines = result.split('\n');
    expect(lines[0]).toMatch(/^>.*2/); // line 2 is target
    expect(lines[1]).toMatch(/^>.*3/); // line 3 is target
    expect(lines[2]).toMatch(/^>.*4/); // line 4 is target
  });

  it('returns empty string for empty file', () => {
    const comment = positioned({ startLine: 1, endLine: 1 });

    const result = positioner().adjustContext(comment, '');

    expect(result).toBe('');
  });

  it('preserves position metadata in positioned comments', () => {
    const fileContent = 'a\nb\nc';
    const comment = positioned({
      positionConfidence: 0.85,
      positionMethod: 'heuristic',
      startLine: 2,
      endLine: 2,
    });

    const result = positioner().adjustContext(comment, fileContent);

    expect(result).toContain('b');
  });
  it('handles heuristic with all-empty-line existingCode', () => {
    const fileContent = 'a\nb\nc';
    const comment = makeComment({
      existingCode: '\n\n\n',
      startLine: 2,
      endLine: 4,
    });

    const result = positioner().positionComment(comment, fileContent);

    expect(result.positionMethod).toBe('fallback');
  });

  it('handles startLine equal to endLine when both are out of bounds', () => {
    const fileContent = 'a\nb';
    const comment = makeComment({
      existingCode: 'let x = 1;',
      startLine: 10,
      endLine: 10,
    });

    const result = positioner().positionComment(comment, fileContent);

    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(2);
  });

  it('clamps startLine to 1 when file is empty', () => {
    const comment = makeComment({
      existingCode: 'let x = 1;',
      startLine: 5,
      endLine: 10,
    });

    const result = positioner().positionComment(comment, '');

    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles comment on first line of file', () => {
    const fileContent = 'const x = 1;\nline2\nline3';
    const comment = makeComment({
      existingCode: 'const x = 1;',
      startLine: 1,
      endLine: 1,
    });

    const result = positioner().positionComment(comment, fileContent);

    expect(result.positionMethod).toBe('exact');
    expect(result.startLine).toBe(1);
  });

  it('handles comment on last line of file', () => {
    const fileContent = 'line1\nline2\nconst y = 2;';
    const comment = makeComment({
      existingCode: 'const y = 2;',
      startLine: 3,
      endLine: 3,
    });

    const result = positioner().positionComment(comment, fileContent);

    expect(result.positionMethod).toBe('exact');
    expect(result.startLine).toBe(3);
  });

  it('handles single-line file', () => {
    const fileContent = 'const x = 1;';
    const comment = makeComment({
      existingCode: 'const x = 1;',
      startLine: 1,
      endLine: 1,
    });

    const result = positioner().positionComment(comment, fileContent);

    expect(result.positionMethod).toBe('exact');
  });

  it('handles very large existingCode snippet that spans many lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const fileContent = lines.join('\n');
    const snippetLines = lines.slice(10, 30);
    const comment = makeComment({
      existingCode: snippetLines.join('\n'),
      startLine: 11,
      endLine: 30,
    });

    const result = positioner().positionComment(comment, fileContent);

    expect(result.positionMethod).toBe('exact');
  });
});
