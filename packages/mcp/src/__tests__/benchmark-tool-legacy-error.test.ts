// @code-analyzer/mcp — Legacy Benchmark Error Handling Tests
// Exercises the error reporting path of runLegacyBenchmark by mocking the
// @code-analyzer/intelligence BenchmarkRunner to throw (both Error and
// non-Error values).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const legacyMode = vi.hoisted(() => ({ mode: 'none' as 'none' | 'error' | 'string' }));

vi.mock('@code-analyzer/intelligence', () => ({
  BenchmarkRunner: class {
    runBenchmark() {
      return throwLegacy(legacyMode.mode);
    }
    runBenchmarkFiltered() {
      return throwLegacy(legacyMode.mode);
    }
  },
  ALL_BENCHMARK_CASES: [],
}));

function throwLegacy(mode: string): { summary: string; cases: unknown[] } {
  if (mode === 'error') throw new Error('legacy boom');
  if (mode === 'string') throw 'legacy string failure';
  return { summary: 'summary', cases: [] };
}

import { runBenchmark } from '../tools/benchmark.js';

describe('runBenchmark — legacy error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyMode.mode = 'none';
  });

  it('reports Error messages from the legacy benchmark', async () => {
    legacyMode.mode = 'error';
    const r = await runBenchmark({ category: 'bug' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('legacy boom');
  });

  it('stringifies non-Error failures from the legacy benchmark', async () => {
    legacyMode.mode = 'string';
    const r = await runBenchmark({ category: 'bug' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('legacy string failure');
  });
});
