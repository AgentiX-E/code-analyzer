// @code-analyzer/mcp — Benchmark Tool Tests
// Exercises the legacy review-quality benchmark path (category/severity
// filtering) which is the deterministic, store-independent branch.

import { describe, it, expect } from 'vitest';
import { runBenchmark, runBenchmarkSchema } from '../tools/benchmark.js';

describe('runBenchmark', () => {
  it('exposes a valid schema with suite and format enums', () => {
    expect(runBenchmarkSchema.properties.suite.enum).toContain('review-quality');
    expect(runBenchmarkSchema.properties.format.enum).toContain('json');
  });

  it('runs the legacy benchmark when filtered by category', async () => {
    const r = await runBenchmark({ category: 'bug' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('Per-Case Results');
  });

  it('runs the legacy benchmark when filtered by severity', async () => {
    const r = await runBenchmark({ severity: 'high' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('Per-Case Results');
  });

  it('runs the legacy benchmark when filtered by category and severity', async () => {
    const r = await runBenchmark({ category: 'security', severity: 'critical' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('Per-Case Results');
  });
});
