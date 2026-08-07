// @code-analyzer/intelligence — LLM Benchmark Runner Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock declarations
// ---------------------------------------------------------------------------

const mockStore = class {
  nodes = new Map();
  edges = new Map();
};
const mockProvider = class {};

vi.mock('../review/llm/provider.js', () => {
  class MockDeepSeekProvider {}
  return { DeepSeekProvider: MockDeepSeekProvider };
});
vi.mock('../review/llm/llm-review-engine.js', () => {
  class MockLLMReviewEngine {
    reviewDiff() {
      return Promise.resolve([{
        filePath: 'test.ts',
        lane: 'security',
        findings: [{
          id: 'f1', lane: 'security', title: 'Issue', description: 'desc',
          startLine: 1, endLine: 1, suggestion: 'fix', severity: 'critical', category: 'security',
        }],
        success: true,
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }]);
    }
  }
  return { LLMReviewEngine: MockLLMReviewEngine };
});
vi.mock('../review/review-engine.js', () => {
  class MockCodeReviewEngine {
    reviewFile() {
      return Promise.resolve([{
        id: 'heur-1', path: 'test.ts', content: 'comment', thinking: '',
        existingCode: '', startLine: 1, endLine: 1, category: 'security',
        severity: 'critical', filtered: false, createdAt: new Date().toISOString(),
      }]);
    }
  }
  return { CodeReviewEngine: MockCodeReviewEngine };
});
vi.mock('../code-review-benchmark.js', () => {
  class MockBenchmarkRunner {
    runBenchmark() {
      return {
        totalFixtures: 2, totalIssues: 2, totalDetections: 3,
        totalGroundTruth: 2,
        truePositives: 2, falsePositives: 1, falseNegatives: 0,
        precision: 0.667, recall: 1.0, f1Score: 0.8, noiseRate: 0.5,
        durationMs: 100, matchResults: [],
        fixturesProcessed: 2,
        languagesTested: 1,
        totalDurationMs: 100,
        avgTimePerFixtureMs: 50,
        detections: [],
        categoryBreakdown: [{
          category: 'security', truePositives: 2, falsePositives: 1,
          falseNegatives: 0, precision: 0.667, recall: 1.0, f1: 0.8,
        }],
      };
    }
  }
  return { BenchmarkRunner: MockBenchmarkRunner };
});
vi.mock('../benchmark-fixtures.js', () => ({
  ALL_BENCHMARK_FIXTURES: [
    {
      filePath: 'fixtures/test/sql-injection.ts',
      language: 'typescript',
      content: 'const q = `SELECT * FROM users WHERE id = "${userId}"`;\n',
      groundTruth: [{
        id: 'SQL-001', filePath: 'fixtures/test/sql-injection.ts',
        category: 'security', severity: 'critical', startLine: 1, endLine: 1,
        description: 'SQL injection', language: 'typescript',
      }],
    },
    {
      filePath: 'fixtures/test/xss.ts',
      language: 'typescript',
      content: 'element.innerHTML = userInput;\n',
      groundTruth: [{
        id: 'XSS-001', filePath: 'fixtures/test/xss.ts',
        category: 'security', severity: 'high', startLine: 1, endLine: 1,
        description: 'XSS via innerHTML', language: 'typescript',
      }],
    },
  ],
}));
vi.mock('@code-analyzer/infra', () => {
  class MockInMemoryGraphStore {
    nodes = new Map();
    edges = new Map();
  }
  return { InMemoryGraphStore: MockInMemoryGraphStore };
});

import { runLLMBenchmark, generateLLMComparisonReport } from '../llm-benchmark-runner.js';
import type { LLMBenchmarkResult } from '../llm-benchmark-runner.js';
import type { BenchmarkResult } from '../code-review-benchmark.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBenchmarkResult(overrides: any = {}): BenchmarkResult {
  return {
    totalGroundTruth: overrides.totalGroundTruth ?? 2,
    totalDetections: overrides.totalDetections ?? 4,
    truePositives: overrides.truePositives ?? 2,
    falsePositives: overrides.falsePositives ?? 2,
    falseNegatives: overrides.falseNegatives ?? 0,
    precision: overrides.precision ?? 0.5,
    recall: overrides.recall ?? 1.0,
    f1Score: overrides.f1Score ?? 0.667,
    noiseRate: overrides.noiseRate ?? 1.0,
    totalDurationMs: overrides.totalDurationMs ?? 250,
    avgTimePerFixtureMs: overrides.avgTimePerFixtureMs ?? 125,
    fixturesProcessed: overrides.fixturesProcessed ?? 2,
    languagesTested: overrides.languagesTested ?? 1,
    detections: overrides.detections ?? [],
    categoryBreakdown: overrides.categoryBreakdown ?? [
      { category: 'security', truePositives: 2, falsePositives: 2, falseNegatives: 0, precision: 0.5, recall: 1.0, f1: 0.667 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests: generateLLMComparisonReport
// ---------------------------------------------------------------------------

describe('generateLLMComparisonReport', () => {
  let baseResult: LLMBenchmarkResult;

  beforeEach(() => {
    baseResult = {
      heuristic: makeBenchmarkResult({
        precision: 0.4, recall: 0.8, f1Score: 0.533, noiseRate: 1.5,
      }),
      combined: makeBenchmarkResult({
        precision: 0.7, recall: 0.9, f1Score: 0.787, noiseRate: 0.8,
      }),
      llmOnly: makeBenchmarkResult({
        precision: 0.6, recall: 0.5, f1Score: 0.545, noiseRate: 1.2,
      }),
      tokenUsage: {
        totalPromptTokens: 5000,
        totalCompletionTokens: 2000,
        totalTokens: 7000,
        avgTokensPerFixture: 3500,
      },
      llmDurationMs: 15000,
      fixturesWithLLM: 2,
    };
  });

  it('generates a report with correct header', () => {
    const report = generateLLMComparisonReport(baseResult);
    expect(report).toContain('# Code Analyzer — LLM-Enhanced Benchmark Report');
    expect(report).toContain('**Generated:**');
    expect(report).toContain('**Fixtures processed:** 2');
    expect(report).toContain('**Total tokens:** 7000');
    expect(report).toContain('**Avg tokens/fixture:** 3500');
  });

  it('includes comparison table with precision, recall, F1, noise', () => {
    const report = generateLLMComparisonReport(baseResult);
    expect(report).toContain('**Precision**');
    expect(report).toContain('40.0%');
    expect(report).toContain('70.0%');
    expect(report).toContain('**Recall**');
    expect(report).toContain('**F1 Score**');
    expect(report).toContain('**Noise Rate**');
  });

  it('includes industry comparison table', () => {
    const report = generateLLMComparisonReport(baseResult);
    expect(report).toContain('Industry Comparison');
    expect(report).toContain('Code Analyzer (combined)');
    expect(report).toContain('SonarQube AI');
    expect(report).toContain('GitHub Copilot');
  });

  it('includes per-category breakdown', () => {
    const report = generateLLMComparisonReport(baseResult);
    expect(report).toContain('Per-Category Breakdown');
    expect(report).toContain('security');
  });

  it('includes token efficiency section', () => {
    const report = generateLLMComparisonReport(baseResult);
    expect(report).toContain('Token Efficiency');
    expect(report).toContain('Cost estimate');
  });

  it('handles zero token usage', () => {
    const zeroResult: LLMBenchmarkResult = {
      ...baseResult,
      tokenUsage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, avgTokensPerFixture: 0 },
      fixturesWithLLM: 0,
    };
    const report = generateLLMComparisonReport(zeroResult);
    expect(report).toContain('**Total tokens:** 0');
  });

  it('shows positive delta for improvement', () => {
    const improved: LLMBenchmarkResult = {
      ...baseResult,
      heuristic: makeBenchmarkResult({ precision: 0.2, recall: 0.5, f1Score: 0.286 }),
      combined: makeBenchmarkResult({ precision: 0.8, recall: 0.9, f1Score: 0.847 }),
    };
    const report = generateLLMComparisonReport(improved);
    expect(report).toContain('+');
  });

  it('shows negative delta for regression', () => {
    const degraded: LLMBenchmarkResult = {
      ...baseResult,
      heuristic: makeBenchmarkResult({ precision: 0.8, recall: 0.9, f1Score: 0.847 }),
      combined: makeBenchmarkResult({ precision: 0.5, recall: 0.6, f1Score: 0.545 }),
    };
    const report = generateLLMComparisonReport(degraded);
    expect(report).toContain('-');
  });

  it('handles zero precision edge case', () => {
    const zeroPrec: LLMBenchmarkResult = {
      ...baseResult,
      heuristic: makeBenchmarkResult({ precision: 0, recall: 0, f1Score: 0, noiseRate: 0 }),
      combined: makeBenchmarkResult({ precision: 0.5, recall: 0.5, f1Score: 0.5, noiseRate: 0.5 }),
    };
    const report = generateLLMComparisonReport(zeroPrec);
    expect(report).toContain('0.0%');
  });

  it('includes LLM duration in seconds', () => {
    const report = generateLLMComparisonReport(baseResult);
    expect(report).toContain('15.0s');
  });

  it('rounds LLM duration to one decimal', () => {
    const result: LLMBenchmarkResult = { ...baseResult, llmDurationMs: 12345 };
    const report = generateLLMComparisonReport(result);
    expect(report).toContain('12.3s');
  });

  it('has cost estimate with dollar format', () => {
    const report = generateLLMComparisonReport(baseResult);
    expect(report).toMatch(/\$0\.\d{4}/);
  });

  it('generates report with multiple categories', () => {
    const multi: LLMBenchmarkResult = {
      ...baseResult,
      combined: makeBenchmarkResult({
        precision: 0.8, recall: 0.85, f1Score: 0.824, noiseRate: 0.4,
        categoryBreakdown: [
          { category: 'security', truePositives: 3, falsePositives: 1, falseNegatives: 0, precision: 0.75, recall: 1.0, f1: 0.857 },
          { category: 'performance', truePositives: 2, falsePositives: 0, falseNegatives: 1, precision: 1.0, recall: 0.667, f1: 0.8 },
          { category: 'maintainability', truePositives: 1, falsePositives: 2, falseNegatives: 0, precision: 0.333, recall: 1.0, f1: 0.5 },
        ],
      }),
    };
    const report = generateLLMComparisonReport(multi);
    expect(report).toContain('security');
    expect(report).toContain('performance');
    expect(report).toContain('maintainability');
  });
});

// ---------------------------------------------------------------------------
// Tests: runLLMBenchmark
// ---------------------------------------------------------------------------

describe('runLLMBenchmark', () => {
  const gitOps = {} as any;

  it('runs and returns complete LLMBenchmarkResult', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result).toBeDefined();
    expect(result.heuristic).toBeDefined();
    expect(result.combined).toBeDefined();
    expect(result.llmOnly).toBeDefined();
    expect(result.tokenUsage).toBeDefined();
    expect(result.fixturesWithLLM).toBeGreaterThanOrEqual(0);
    expect(typeof result.llmDurationMs).toBe('number');
  });

  it('reports heuristic benchmark result with valid metrics', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result.heuristic.precision).toBeGreaterThanOrEqual(0);
    expect(result.heuristic.recall).toBeGreaterThanOrEqual(0);
    expect(result.heuristic.f1Score).toBeGreaterThanOrEqual(0);
  });

  it('reports combined benchmark result with valid metrics', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result.combined.f1Score).toBeGreaterThanOrEqual(0);
    expect(result.combined.precision).toBeGreaterThanOrEqual(0);
  });

  it('produces llmOnly benchmark result', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result.llmOnly).toBeDefined();
    expect(typeof result.llmOnly.f1Score).toBe('number');
  });

  it('returns token usage statistics', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result.tokenUsage).toBeDefined();
    expect(typeof result.tokenUsage.totalTokens).toBe('number');
    expect(typeof result.tokenUsage.avgTokensPerFixture).toBe('number');
  });

  it('tracks fixturesWithLLM count', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result.fixturesWithLLM).toBeGreaterThanOrEqual(0);
  });

  it('measures LLM duration as a non-negative number', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result.llmDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('works with empty graph store', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    expect(result).toBeDefined();
    expect(result.heuristic).toBeDefined();
  });

  it('runs successfully with mock provider', async () => {
    const store = new (mockStore as any)() as any;
    const provider = new (mockProvider as any)() as any;

    const result = await runLLMBenchmark(provider, store, gitOps);

    // Basic sanity: all three result sections should be present
    expect(result.heuristic.fixturesProcessed).toBeGreaterThanOrEqual(0);
    expect(result.combined.fixturesProcessed).toBeGreaterThanOrEqual(0);
    expect(result.llmOnly.fixturesProcessed).toBeGreaterThanOrEqual(0);
  });
});
