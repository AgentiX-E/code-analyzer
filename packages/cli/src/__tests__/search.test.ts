/**
 * Tests for the search command.
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { searchGraph, formatSearchResult, type SearchOutput } from '../commands/search.js';

describe('searchGraph', () => {
  it('should return structured output for a query', async () => {
    const result = await searchGraph({ query: 'function' });
    expect(result.success).toBe(true);
    expect(result.query).toBe('function');
    expect(result.results).toBeInstanceOf(Array);
    expect(typeof result.totalResults).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should accept limit option', async () => {
    const result = await searchGraph({ query: 'class', limit: 10 });
    expect(result.results.length).toBeLessThanOrEqual(10);
  });

  it('should accept type filter', async () => {
    const result = await searchGraph({ query: 'test', type: 'function' });
    expect(result.results.every((r) => r.type === 'function')).toBe(true);
  });

  it('should handle verbose option', async () => {
    const result = await searchGraph({ query: 'export', verbose: true });
    // should not crash
    expect(result.success).toBe(true);
  });

  it('should return results sorted by score', async () => {
    const result = await searchGraph({ query: 'main', limit: 10 });
    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i].score).toBeLessThanOrEqual(result.results[i - 1].score);
    }
  });

  it('should handle empty query gracefully', async () => {
    const result = await searchGraph({ query: '' });
    expect(result.success).toBe(true);
    expect(result.results).toBeInstanceOf(Array);
  });

  it('should handle store errors gracefully', async () => {
    const mockStore = {
      searchFts: vi.fn().mockImplementation(() => {
        throw new Error('FTS index corrupted');
      }),
    };
    const result = await searchGraph(
      { query: 'error-test' },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('FTS index corrupted');
    expect(result.query).toBe('error-test');
    expect(result.results).toEqual([]);
  });

  it('should handle non-Error throw in store', async () => {
    const mockStore = {
      searchFts: vi.fn().mockImplementation(() => {
        throw 'String error';
      }),
    };
    const result = await searchGraph(
      { query: 'string-error' },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('String error');
  });

  it('should include snippet when verbose and store returns content', async () => {
    const mockStore = {
      searchFts: vi.fn().mockReturnValue([
        {
          id: 1,
          name: 'UserService',
          type: 'class',
          label: 'class',
          file: 'src/UserService.ts',
          line: 5,
          score: 0.95,
          content: '/** User service for authentication */\nexport class UserService {',
        },
      ]),
    };
    const result = await searchGraph(
      { query: 'UserService', verbose: true },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.success).toBe(true);
    expect(result.results[0].snippet).toBeDefined();
    expect(result.results[0].snippet?.length).toBeGreaterThan(0);
  });

  it('should filter results by type when type option is provided', async () => {
    const mockStore = {
      searchFts: vi.fn().mockReturnValue([
        { id: 1, name: 'calculate', type: 'function', file: 'a.ts', line: 1, score: 0.9 },
        { id: 2, name: 'User', type: 'class', file: 'b.ts', line: 2, score: 0.8 },
        { id: 3, name: 'render', type: 'function', file: 'c.ts', line: 3, score: 0.7 },
      ]),
    };
    const result = await searchGraph(
      { query: 'test', type: 'function' },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.results.length).toBe(2);
    expect(result.results.every((r) => r.type === 'function')).toBe(true);
  });

  it('should accept a store parameter instead of creating one', async () => {
    const mockStore = {
      searchFts: vi
        .fn()
        .mockReturnValue([
          { id: 42, name: 'testFn', type: 'function', file: 'test.ts', line: 1, score: 1.0 },
        ]),
    };
    const result = await searchGraph(
      { query: 'search' },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.success).toBe(true);
    expect(result.results[0].id).toBe(42);
  });

  it('should use fallback values when store returns incomplete data', async () => {
    const mockStore = {
      searchFts: vi
        .fn()
        .mockReturnValue([{}, { name: 'partialFn' }, { type: 'class', label: 'interface' }]),
    };
    const result = await searchGraph(
      { query: 'incomplete' },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.success).toBe(true);
    expect(result.results.length).toBe(3);
    // First result: all defaults
    expect(result.results[0].id).toBe(0);
    expect(result.results[0].name).toBe('unknown');
    expect(result.results[0].type).toBe('unknown');
    expect(result.results[0].file).toBe('');
    expect(result.results[0].line).toBe(1);
    expect(result.results[0].score).toBe(0);
    // Second result: partial
    expect(result.results[1].name).toBe('partialFn');
  });

  it('should return empty results for a valid store with no matches', async () => {
    const mockStore = {
      searchFts: vi.fn().mockReturnValue([]),
    };
    const result = await searchGraph(
      { query: 'nonexistent' },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.success).toBe(true);
    expect(result.results.length).toBe(0);
    expect(result.totalResults).toBe(0);
  });

  it('should handle verbose with missing content gracefully', async () => {
    const mockStore = {
      searchFts: vi
        .fn()
        .mockReturnValue([
          { id: 1, name: 'fn', type: 'function', file: 'a.ts', line: 1, score: 0.9 },
        ]),
    };
    const result = await searchGraph(
      { query: 'fn', verbose: true },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.results[0].snippet).toBe('');
  });

  it('should filter mixed types correctly', async () => {
    const mockStore = {
      searchFts: vi.fn().mockReturnValue([
        { id: 1, name: 'fn1', type: 'function', file: 'a.ts', line: 1, score: 0.9 },
        { id: 2, name: 'Cls1', type: 'class', file: 'b.ts', line: 2, score: 0.8 },
        { id: 3, name: 'fn2', type: 'function', file: 'c.ts', line: 3, score: 0.7 },
        { id: 4, name: 'Cls2', type: 'class', file: 'd.ts', line: 4, score: 0.6 },
      ]),
    };
    const result = await searchGraph(
      { query: 'test', type: 'class' },
      mockStore as unknown as InMemoryGraphStore,
    );
    expect(result.results.length).toBe(2);
    expect(result.results.every((r) => r.type === 'class')).toBe(true);
    expect(result.results[0].score).toBe(0.8);
    expect(result.results[1].score).toBe(0.6);
  });
});

describe('formatSearchResult', () => {
  const sampleOutput: SearchOutput = {
    success: true,
    query: 'export',
    results: [
      {
        id: 1,
        name: 'calculateTotal',
        type: 'function',
        file: 'src/utils.ts',
        line: 42,
        score: 0.95,
      },
      {
        id: 2,
        name: 'UserModel',
        type: 'class',
        file: 'src/models/user.ts',
        line: 10,
        score: 0.82,
        snippet: 'export class UserModel {',
      },
    ],
    totalResults: 2,
    duration: 15,
  };

  it('should format as JSON', () => {
    const output = formatSearchResult(sampleOutput, 'json');
    const parsed = JSON.parse(output);
    expect(parsed.query).toBe('export');
    expect(parsed.results.length).toBe(2);
  });

  it('should format as text', () => {
    const output = formatSearchResult(sampleOutput, 'text');
    expect(output).toContain('export');
    expect(output).toContain('calculateTotal');
    expect(output).toContain('function');
    expect(output).toContain('src/utils.ts');
    expect(output).toContain('0.95');
  });

  it('should format as summary', () => {
    const output = formatSearchResult(sampleOutput, 'summary');
    expect(output).toContain('2 results');
    expect(output).toContain('export');
    expect(output).toContain('15ms');
  });

  it('should show error message', () => {
    const errorOutput: SearchOutput = {
      ...sampleOutput,
      success: false,
      error: 'Search index not available',
      results: [],
      totalResults: 0,
    };
    const output = formatSearchResult(errorOutput, 'text');
    expect(output).toContain('Search index not available');
  });

  it('should show snippet in verbose mode', () => {
    const withSnippet: SearchOutput = {
      ...sampleOutput,
      results: [
        {
          id: 1,
          name: 'UserModel',
          type: 'class',
          file: 'src/models/user.ts',
          line: 10,
          score: 0.82,
          snippet: 'export class UserModel {',
        },
      ],
    };
    const output = formatSearchResult(withSnippet, 'text');
    expect(output).toContain('export class UserModel');
  });

  it('should handle result without file path', () => {
    const noFile: SearchOutput = {
      ...sampleOutput,
      results: [
        {
          id: 1,
          name: 'orphanFn',
          type: 'function',
          file: '',
          line: 1,
          score: 0.5,
        },
      ],
      totalResults: 1,
    };
    const output = formatSearchResult(noFile, 'text');
    expect(output).toContain('orphanFn');
    expect(output).not.toContain('File: :1');
  });
});
