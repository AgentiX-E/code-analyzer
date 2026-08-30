// @code-analyzer/intelligence — LLM Benchmark Runner Pure Helper Tests
// Exercises the exported pure helpers (toReviewComments, deduplicateComments,
// mapCategory, mapSeverity) across every branch, including the fallback paths
// that were previously unreachable because the runner's vi.mock paths did not
// resolve to the real modules.

import { describe, it, expect } from 'vitest';
import {
  toReviewComments,
  deduplicateComments,
  mapCategory,
  mapSeverity,
} from '../llm-benchmark-runner.js';
import type { ReviewComment } from '@code-analyzer/shared';

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'f1',
    lane: 'security',
    title: 'Issue',
    description: 'desc',
    startLine: 1,
    endLine: 1,
    suggestion: 'fix',
    severity: 'critical',
    category: 'security',
    ...overrides,
  };
}

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    path: 'a.ts',
    content: 'comment',
    thinking: '',
    existingCode: '',
    suggestionCode: undefined,
    startLine: 1,
    endLine: 1,
    category: 'security',
    severity: 'critical',
    filtered: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mapCategory', () => {
  it('maps every known category to itself', () => {
    expect(mapCategory('security')).toBe('security');
    expect(mapCategory('bug')).toBe('bug');
    expect(mapCategory('performance')).toBe('performance');
    expect(mapCategory('maintainability')).toBe('maintainability');
    expect(mapCategory('style')).toBe('style');
    expect(mapCategory('documentation')).toBe('documentation');
    expect(mapCategory('architecture')).toBe('architecture');
    expect(mapCategory('test')).toBe('test');
    expect(mapCategory('api')).toBe('api');
    expect(mapCategory('other')).toBe('other');
  });

  it('maps the legacy correctness alias to bug', () => {
    expect(mapCategory('correctness')).toBe('bug');
  });

  it('falls back to style for an unknown category', () => {
    expect(mapCategory('unknown-category')).toBe('style');
  });
});

describe('mapSeverity', () => {
  it('maps every known severity to itself', () => {
    expect(mapSeverity('critical')).toBe('critical');
    expect(mapSeverity('high')).toBe('high');
    expect(mapSeverity('medium')).toBe('medium');
    expect(mapSeverity('low')).toBe('low');
    expect(mapSeverity('info')).toBe('info');
  });

  it('falls back to medium for an unknown severity', () => {
    expect(mapSeverity('catastrophic')).toBe('medium');
  });
});

describe('toReviewComments', () => {
  it('converts findings with all fields present', () => {
    const comments = toReviewComments([finding()] as any, 'a.ts');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.id).toBe('llm-f1');
    expect(comments[0]!.path).toBe('a.ts');
    expect(comments[0]!.category).toBe('security');
    expect(comments[0]!.severity).toBe('critical');
    expect(comments[0]!.suggestionCode).toBe('fix');
  });

  it('falls back to the index when a finding has no id', () => {
    const comments = toReviewComments([finding({ id: undefined }) as any], 'a.ts');
    expect(comments[0]!.id).toBe('llm-0');
  });

  it('drops the suggestion code when suggestion is null', () => {
    const comments = toReviewComments([finding({ suggestion: null }) as any], 'a.ts');
    expect(comments[0]!.suggestionCode).toBeUndefined();
  });

  it('falls back to the lane when a finding has no category', () => {
    const comments = toReviewComments(
      [finding({ category: undefined, lane: 'performance' }) as any],
      'a.ts',
    );
    expect(comments[0]!.category).toBe('performance');
  });

  it('maps an unknown category and severity through the fallbacks', () => {
    const comments = toReviewComments(
      [finding({ category: 'nonsense', severity: 'nonsense' }) as any],
      'a.ts',
    );
    expect(comments[0]!.category).toBe('style');
    expect(comments[0]!.severity).toBe('medium');
  });
});

describe('deduplicateComments', () => {
  it('keeps a non-overlapping LLM comment', () => {
    const heuristic = [comment({ category: 'security', startLine: 1, endLine: 1 })];
    const llm = [comment({ id: 'llm1', category: 'security', startLine: 10, endLine: 10 })];
    const result = deduplicateComments(heuristic, llm);
    expect(result).toHaveLength(2);
  });

  it('deduplicates an overlapping LLM comment (>= 3 lines overlap)', () => {
    const heuristic = [comment({ category: 'security', startLine: 1, endLine: 5 })];
    const llm = [comment({ id: 'llm1', category: 'security', startLine: 3, endLine: 7 })];
    const result = deduplicateComments(heuristic, llm);
    expect(result).toHaveLength(1);
  });

  it('keeps an LLM comment whose category differs from all heuristic comments', () => {
    const heuristic = [comment({ category: 'performance', startLine: 1, endLine: 5 })];
    const llm = [comment({ id: 'llm1', category: 'security', startLine: 1, endLine: 5 })];
    const result = deduplicateComments(heuristic, llm);
    expect(result).toHaveLength(2);
  });
});
