/* v8 ignore file -- @preserve */
// @code-analyzer/mcp — Benchmark Tools

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
  },
};

export async function runBenchmark(args: Record<string, unknown>, _store?: unknown): Promise<ToolResult> {
  const params = args as unknown as RunBenchmarkParams;
  const category = params.category as ReviewCategory | undefined;
  const severity = params.severity as Severity | undefined;

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
