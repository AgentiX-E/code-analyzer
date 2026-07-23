/**
 * Tests for the search command.
 */

import { describe, it, expect } from 'vitest';
import {
  searchGraph,
  formatSearchResult,
  type SearchOutput,
} from '../commands/search.js';

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
      results: [{
        id: 1,
        name: 'UserModel',
        type: 'class',
        file: 'src/models/user.ts',
        line: 10,
        score: 0.82,
        snippet: 'export class UserModel {',
      }],
    };
    const output = formatSearchResult(withSnippet, 'text');
    expect(output).toContain('export class UserModel');
  });
});
