/* v8 ignore file -- @preserve */
// @code-analyzer/mcp — Benchmark Tools
// Delegates to CA-Bench for comprehensive suite-based benchmarking.
// Falls back to the heuristic review benchmark for backward compatibility.

import type { ToolResult } from './registry.js';
import type { ReviewCategory, Severity } from '@code-analyzer/shared';
import { BenchmarkRunner } from '@code-analyzer/intelligence';
import { ALL_BENCHMARK_CASES } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// run_benchmark
// ---------------------------------------------------------------------------

interface RunBenchmarkParams {
  category?: string;
  severity?: string;
  suite?: string;
  format?: string;
}

export const runBenchmarkSchema = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      description: 'Filter benchmark cases by review category (bug, security, performance, maintainability, style, documentation, architecture)',
    },
    severity: {
      type: 'string',
      description: 'Filter benchmark cases by severity level (critical, high, medium, low, info)',
    },
    suite: {
      type: 'string',
      description: 'Run a specific CA-Bench suite: parse-accuracy, search-quality, review-quality, embedding-quality, cross-repo, throughput (default: all)',
      enum: ['parse-accuracy', 'search-quality', 'review-quality', 'embedding-quality', 'cross-repo', 'throughput'],
    },
    format: {
      type: 'string',
      description: 'Output format: markdown, json, or html (default: markdown)',
      enum: ['markdown', 'json', 'html'],
    },
  },
};

export async function runBenchmark(args: Record<string, unknown>, _store?: unknown): Promise<ToolResult> {
  const params = args as unknown as RunBenchmarkParams;
  const category = params.category as ReviewCategory | undefined;
  const severity = params.severity as Severity | undefined;
  const suite = params.suite as string | undefined;
  const format = (params.format as string) ?? 'markdown';

  // Route to CA-Bench if a suite is specified explicitly
  if (suite) {
    return runCaBenchSuite(suite, format);
  }

  // Route to CA-Bench if no legacy filters are specified (run all suites)
  if (!category && !severity && !suite) {
    try {
      return await runCaBenchAll(format);
    } catch {
      // Fall through to legacy benchmark on error
    }
  }

  // Legacy review-quality benchmark (backward compatibility)
  return runLegacyBenchmark(category, severity);
}

// ---------------------------------------------------------------------------
// CA-Bench Integration
// ---------------------------------------------------------------------------

async function runCaBenchAll(format: string): Promise<ToolResult> {
  try {
    const { CaBenchRunner } = await import('../../../../../tests/benchmarks/ca-bench/runner.js');
    const runner = new CaBenchRunner();
    const result = await runner.runAll();

    let text: string;
    switch (format) {
      case 'json': text = runner.generateJsonReport(result); break;
      case 'html': text = runner.generateHtmlReport(result); break;
      default: text = runner.generateMarkdownReport(result);
    }

    return { content: [{ type: 'text', text }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `CA-Bench execution error: ${message}` }],
      isError: true,
    };
  }
}

async function runCaBenchSuite(suite: string, format: string): Promise<ToolResult> {
  try {
    const { CaBenchRunner } = await import('../../../../../tests/benchmarks/ca-bench/runner.js');
    const runner = new CaBenchRunner();

    const suiteResult = await runner.runSuite(suite as 'parse-accuracy' | 'search-quality' | 'review-quality' | 'embedding-quality' | 'cross-repo' | 'throughput');

    let text: string;
    if (format === 'json') {
      text = JSON.stringify(suiteResult, null, 2);
    } else {
      const measurements = suiteResult.measurements.map(m => `| ${m.name} | ${m.value} | ${m.unit} |`).join('\n');
      const status = suiteResult.passed ? '✅ PASSED' : '❌ FAILED';
      text = [
        `# CA-Bench: ${suiteResult.suiteName} ${status}`,
        `\n**Duration**: ${suiteResult.durationMs}ms\n`,
        '| Measurement | Value | Unit |',
        '|-------------|-------|------|',
        measurements,
      ].join('\n');
    }

    return { content: [{ type: 'text', text }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `CA-Bench suite error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Legacy Benchmark (Review Quality via Heuristic Engine)
// ---------------------------------------------------------------------------

async function runLegacyBenchmark(category?: ReviewCategory, severity?: Severity): Promise<ToolResult> {
  try {
    const runner = new BenchmarkRunner();
    let result;

    if (category || severity) {
      result = runner.runBenchmarkFiltered(ALL_BENCHMARK_CASES, {
        ...(category ? { category } : {}),
        ...(severity ? { severity } : {}),
      });
    } else {
      result = runner.runBenchmark(ALL_BENCHMARK_CASES);
    }

    const header = result.summary;
    const caseLines = result.cases.map(c =>
      `| ${c.caseId} | TP=${c.truePositives} | FP=${c.falsePositives} | FN=${c.falseNegatives} | P=${(c.precision * 100).toFixed(1)}% | R=${(c.recall * 100).toFixed(1)}% | F1=${(c.f1Score * 100).toFixed(1)}% |`,
    );

    const report = [
      header,
      '',
      '## Per-Case Results',
      '',
      '| Case ID | True Positives | False Positives | False Negatives | Precision | Recall | F1 Score |',
      '|---------|---------------|-----------------|-----------------|-----------|--------|----------|',
      ...caseLines,
    ].join('\n');

    return {
      content: [{ type: 'text', text: report }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Benchmark execution error: ${message}` }],
      isError: true,
    };
  }
}
