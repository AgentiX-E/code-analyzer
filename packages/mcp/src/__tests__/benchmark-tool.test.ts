// @code-analyzer/mcp — Benchmark Tool Tests
// Covers the CA-Bench suite/all paths (mocked dynamic import), the legacy
// heuristic benchmark (category/severity filtering), and the fallback from
// CA-Bench to legacy when the optional runner is unavailable.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBenchmark, runBenchmarkSchema } from '../tools/benchmark.js';

const caBench = vi.hoisted(() => ({
  runAll: vi.fn(),
  runSuite: vi.fn(),
  generateJsonReport: vi.fn(),
  generateHtmlReport: vi.fn(),
  generateMarkdownReport: vi.fn(),
}));

vi.mock('../../../../tests/benchmarks/ca-bench/runner.js', () => ({
  CaBenchRunner: class {
    runAll() {
      return caBench.runAll();
    }
    runSuite(name: string) {
      return caBench.runSuite(name);
    }
    generateJsonReport(result: unknown) {
      return caBench.generateJsonReport(result);
    }
    generateHtmlReport(result: unknown) {
      return caBench.generateHtmlReport(result);
    }
    generateMarkdownReport(result: unknown) {
      return caBench.generateMarkdownReport(result);
    }
  },
}));

describe('runBenchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

describe('runBenchmark — CA-Bench suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caBench.runSuite.mockResolvedValue({
      suiteName: 'review-quality',
      passed: true,
      durationMs: 10,
      measurements: [{ name: 'precision', value: 0.9, unit: 'score' }],
    });
  });

  it('routes an explicit suite to the CA-Bench suite runner', async () => {
    const r = await runBenchmark({ suite: 'review-quality' });
    expect(caBench.runSuite).toHaveBeenCalledWith('review-quality');
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('review-quality');
  });

  it('renders a markdown table for non-JSON formats', async () => {
    const r = await runBenchmark({ suite: 'review-quality', format: 'markdown' });
    expect(r.content[0].text).toContain('✅ PASSED');
    expect(r.content[0].text).toContain('precision');
  });

  it('renders a failure status when the suite does not pass', async () => {
    caBench.runSuite.mockResolvedValue({
      suiteName: 'review-quality',
      passed: false,
      durationMs: 10,
      measurements: [],
    });
    const r = await runBenchmark({ suite: 'review-quality', format: 'markdown' });
    expect(r.content[0].text).toContain('❌ FAILED');
  });

  it('serializes the suite result as JSON when requested', async () => {
    const r = await runBenchmark({ suite: 'review-quality', format: 'json' });
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.suiteName).toBe('review-quality');
  });

  it('reports Error messages from the suite runner', async () => {
    caBench.runSuite.mockRejectedValue(new Error('suite boom'));
    const r = await runBenchmark({ suite: 'review-quality' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('suite boom');
  });

  it('stringifies non-Error failures from the suite runner', async () => {
    caBench.runSuite.mockRejectedValue('raw string failure');
    const r = await runBenchmark({ suite: 'review-quality' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('raw string failure');
  });
});

describe('runBenchmark — CA-Bench run-all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caBench.runAll.mockResolvedValue({ title: 'CA-Bench' });
    caBench.generateMarkdownReport.mockReturnValue('# markdown report');
    caBench.generateJsonReport.mockReturnValue('{}');
    caBench.generateHtmlReport.mockReturnValue('<html></html>');
  });

  it('runs all suites and renders markdown by default', async () => {
    const r = await runBenchmark({});
    expect(caBench.runAll).toHaveBeenCalled();
    expect(caBench.generateMarkdownReport).toHaveBeenCalled();
    expect(r.content[0].text).toBe('# markdown report');
  });

  it('renders a JSON report when requested', async () => {
    const r = await runBenchmark({ format: 'json' });
    expect(caBench.generateJsonReport).toHaveBeenCalled();
    expect(r.content[0].text).toBe('{}');
  });

  it('renders an HTML report when requested', async () => {
    const r = await runBenchmark({ format: 'html' });
    expect(caBench.generateHtmlReport).toHaveBeenCalled();
    expect(r.content[0].text).toBe('<html></html>');
  });

  it('falls back to the legacy benchmark when CA-Bench fails', async () => {
    caBench.runAll.mockRejectedValue(new Error('all boom'));
    const r = await runBenchmark({});
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('Per-Case Results');
  });
});
