// @code-analyzer/intelligence — LLM-Enhanced Benchmark Runner
// Runs the full review pipeline (heuristic + LLM) against all 20 benchmark
// fixtures using the DeepSeek provider. Measures combined Precision, Recall,
// F1, and token usage. Generates a comparison against heuristic-only results.
//
// IMPORTANT: DEEPSEEK_API_KEY must be set in .env (NOT committed to git).
// The provider reads from process.env['DEEPSEEK_API_KEY'].

import { DeepSeekProvider, type LLMProvider } from '../../review/llm/provider.js';
import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';
import { CodeReviewEngine, type GitOperations } from '../../review/review-engine.js';
import { BenchmarkRunner } from '../code-review-benchmark.js';
import { ALL_BENCHMARK_FIXTURES } from '../benchmark-fixtures.js';
import type { BenchmarkResult } from '../code-review-benchmark.js';
import type { ReviewComment, GitDiff } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// LLM Benchmark Runner
// ---------------------------------------------------------------------------

export interface LLMBenchmarkResult {
  /** Heuristic-only benchmark results. */
  heuristic: BenchmarkResult;
  /** Combined heuristic + LLM benchmark results. */
  combined: BenchmarkResult;
  /** LLM-only benchmark results. */
  llmOnly: BenchmarkResult;
  /** Token usage statistics. */
  tokenUsage: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    avgTokensPerFixture: number;
  };
  /** Total wall-clock time for LLM review. */
  llmDurationMs: number;
  /** Number of fixtures that had LLM review enabled. */
  fixturesWithLLM: number;
}

/**
 * Run the full LLM-enhanced benchmark against all fixtures.
 *
 * @param provider — LLMProvider instance (e.g., DeepSeekProvider)
 * @param store — InMemoryGraphStore (may be empty for fixture-only review)
 * @param gitOps — GitOperations for reading fixture content
 * @returns LLMBenchmarkResult with comparison data
 */
export async function runLLMBenchmark(
  provider: LLMProvider,
  store: InMemoryGraphStore,
  gitOps: GitOperations,
): Promise<LLMBenchmarkResult> {
  const runner = new BenchmarkRunner();
  const startTime = Date.now();

  // Phase 1: Heuristic-only analysis of all fixtures
  const heuristicDetections = new Map<string, ReviewComment[]>();

  for (const fixture of ALL_BENCHMARK_FIXTURES) {
    const engine = new CodeReviewEngine(
      store as never,
      { allowMetadataFallback: true },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const comments = await engine.reviewFile(
      'benchmark',
      fixture.filePath,
      fixture.content,
    );
    heuristicDetections.set(fixture.filePath, comments);
  }

  const heuristicResult = runner.runBenchmark(
    ALL_BENCHMARK_FIXTURES,
    heuristicDetections,
    Date.now() - startTime,
  );

  // Phase 2: LLM-enhanced analysis with provider
  const llmEngine = new LLMReviewEngine(provider, {
    lanes: ['security', 'correctness', 'performance', 'maintainability', 'style'],
    parallel: false,
    maxTokensPerLane: 2048,
    temperature: 0.2,
  });

  const llmDetections = new Map<string, ReviewComment[]>();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let fixturesWithLLM = 0;

  const llmStartTime = Date.now();

  for (const fixture of ALL_BENCHMARK_FIXTURES) {
    try {
      const gitDiff: GitDiff = {
        filePath: fixture.filePath,
        changeType: 'modified',
        ranges: [
          {
            oldStart: 1,
            oldEnd: fixture.content.split('\n').length,
            newStart: 1,
            newEnd: fixture.content.split('\n').length,
            changeType: 'modified',
          },
        ],
        content: fixture.content,
      };

      const llmResult = await llmEngine.reviewDiff(gitDiff, fixture.content);
      const llmComments = toReviewComments(llmResult.findings, fixture.filePath);

      // Merge with heuristic detections
      const merged = deduplicateComments(
        heuristicDetections.get(fixture.filePath) ?? [],
        llmComments,
      );
      llmDetections.set(fixture.filePath, merged);
      fixturesWithLLM++;

      if (llmResult.tokenUsage) {
        totalPromptTokens += llmResult.tokenUsage.promptTokens;
        totalCompletionTokens += llmResult.tokenUsage.completionTokens;
        totalTokens += llmResult.tokenUsage.totalTokens;
      }
    } catch (err) {
      // LLM review failed for this fixture — use heuristic-only results
      llmDetections.set(
        fixture.filePath,
        heuristicDetections.get(fixture.filePath) ?? [],
      );
    }
  }

  const llmDurationMs = Date.now() - llmStartTime;

  // Phase 3: Calculate combined benchmark
  const combinedResult = runner.runBenchmark(
    ALL_BENCHMARK_FIXTURES,
    llmDetections,
    Date.now() - startTime,
  );

  // Phase 4: LLM-only benchmark (without heuristic)
  const llmOnlyDetections = new Map<string, ReviewComment[]>();
  for (const fixture of ALL_BENCHMARK_FIXTURES) {
    const combined = llmDetections.get(fixture.filePath) ?? [];
    const heuristic = heuristicDetections.get(fixture.filePath) ?? [];
    const llmOnly = combined.filter(
      (c) => !heuristic.some((h) => h.id === c.id),
    );
    llmOnlyDetections.set(fixture.filePath, llmOnly);
  }

  const llmOnlyResult = runner.runBenchmark(
    ALL_BENCHMARK_FIXTURES,
    llmOnlyDetections,
    Date.now() - startTime,
  );

  return {
    heuristic: heuristicResult,
    combined: combinedResult,
    llmOnly: llmOnlyResult,
    tokenUsage: {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      avgTokensPerFixture: fixturesWithLLM > 0
        ? Math.round(totalTokens / fixturesWithLLM)
        : 0,
    },
    llmDurationMs,
    fixturesWithLLM,
  };
}

/**
 * Generate a markdown comparison report between heuristic and LLM-enhanced results.
 */
export function generateLLMComparisonReport(result: LLMBenchmarkResult): string {
  const lines: string[] = [];

  lines.push('# Code Analyzer — LLM-Enhanced Benchmark Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Provider:** DeepSeek (deepseek-chat)`);
  lines.push(`**Fixtures processed:** ${result.fixturesWithLLM}`);
  lines.push(`**LLM duration:** ${(result.llmDurationMs / 1000).toFixed(1)}s`);
  lines.push(`**Total tokens:** ${result.tokenUsage.totalTokens}`);
  lines.push(`**Avg tokens/fixture:** ${result.tokenUsage.avgTokensPerFixture}`);
  lines.push('');

  lines.push('## Results: Heuristic vs Combined (Heuristic + LLM)');
  lines.push('');
  lines.push('| Metric | Heuristic Only | Heuristic + LLM | Delta |');
  lines.push('|--------|:---:|:---:|:---:|');
  lines.push(
    `| **Precision** | ${(result.heuristic.precision * 100).toFixed(1)}% | ${(result.combined.precision * 100).toFixed(1)}% | ${deltaStr(result.heuristic.precision, result.combined.precision)} |`,
  );
  lines.push(
    `| **Recall** | ${(result.heuristic.recall * 100).toFixed(1)}% | ${(result.combined.recall * 100).toFixed(1)}% | ${deltaStr(result.heuristic.recall, result.combined.recall)} |`,
  );
  lines.push(
    `| **F1 Score** | ${result.heuristic.f1Score.toFixed(3)} | ${result.combined.f1Score.toFixed(3)} | ${deltaStr(result.heuristic.f1Score, result.combined.f1Score)} |`,
  );
  lines.push(
    `| **Noise Rate** | ${result.heuristic.noiseRate.toFixed(1)}x | ${result.combined.noiseRate.toFixed(1)}x | ${deltaStr(-result.heuristic.noiseRate, -result.combined.noiseRate)} |`,
  );
  lines.push('');

  lines.push('## Industry Comparison (Heuristic + LLM)');
  lines.push('');
  lines.push('| Tool | Precision | Recall | F1 | Noise | Cost |');
  lines.push('|------|:---:|:---:|:---:|:---:|:---:|');
  lines.push(
    `| **Code Analyzer (combined)** | ${(result.combined.precision * 100).toFixed(1)}% | ${(result.combined.recall * 100).toFixed(1)}% | ${result.combined.f1Score.toFixed(3)} | ${result.combined.noiseRate.toFixed(1)}x | ~${result.tokenUsage.totalTokens} tokens |`,
  );
  lines.push(
    `| **Code Analyzer (heuristic)** | ${(result.heuristic.precision * 100).toFixed(1)}% | ${(result.heuristic.recall * 100).toFixed(1)}% | ${result.heuristic.f1Score.toFixed(3)} | ${result.heuristic.noiseRate.toFixed(1)}x | $0 |`,
  );
  lines.push('| SonarQube AI | 72% | 48% | 0.576 | 0.8x | API cost |');
  lines.push('| Augment Code | 65% | 55% | 0.596 | 1.5x | $48/mo |');
  lines.push('| CodeRabbit | 58% | 52% | 0.549 | 2.1x | $12/mo |');
  lines.push('| GitHub Copilot | 42% | 38% | 0.399 | 3.2x | $10/mo |');
  lines.push('');

  lines.push('## Per-Category Breakdown (Heuristic + LLM)');
  lines.push('');
  lines.push('| Category | TP | FP | FN | Precision | Recall | F1 |');
  lines.push('|----------|:--:|:--:|:--:|:---:|:---:|:---:|');
  for (const cb of result.combined.categoryBreakdown) {
    lines.push(
      `| ${cb.category} | ${cb.truePositives} | ${cb.falsePositives} | ${cb.falseNegatives} | ${(cb.precision * 100).toFixed(0)}% | ${(cb.recall * 100).toFixed(0)}% | ${cb.f1.toFixed(3)} |`,
    );
  }
  lines.push('');

  lines.push('## Token Efficiency');
  lines.push('');
  lines.push(`- **Total tokens consumed:** ${result.tokenUsage.totalTokens}`);
  lines.push(`- **Prompt tokens:** ${result.tokenUsage.totalPromptTokens}`);
  lines.push(`- **Completion tokens:** ${result.tokenUsage.totalCompletionTokens}`);
  lines.push(`- **Average per fixture:** ${result.tokenUsage.avgTokensPerFixture}`);
  lines.push(`- **Cost estimate:** ~$${(result.tokenUsage.totalTokens * 0.00000014).toFixed(4)} (DeepSeek pricing)`);
  lines.push('');

  return lines.join('\n');
}

function deltaStr(a: number, b: number): string {
  const delta = b - a;
  const sign = delta >= 0 ? '+' : '';
  const pct = a !== 0 ? ((delta / Math.abs(a)) * 100).toFixed(1) : '0.0';
  return `${sign}${pct}%`;
}

function toReviewComments(
  findings: Array<{
    id: string;
    lane: string;
    title: string;
    description: string;
    startLine: number;
    endLine: number;
    suggestion: string | null;
    severity: string;
    category: string;
  }>,
  filePath: string,
): ReviewComment[] {
  return findings.map((f) => ({
    id: `llm-${f.id}`,
    path: filePath,
    content: f.title,
    thinking: f.description,
    existingCode: '',
    suggestionCode: f.suggestion ?? undefined,
    startLine: f.startLine,
    endLine: f.endLine,
    category: mapCategory(f.category ?? f.lane),
    severity: mapSeverity(f.severity),
    filtered: false,
    createdAt: new Date().toISOString(),
  }));
}

function deduplicateComments(
  heuristic: ReviewComment[],
  llm: ReviewComment[],
): ReviewComment[] {
  const result = [...heuristic];
  const overlapThreshold = 3;

  for (const llmComment of llm) {
    const isDuplicate = result.some((hc) => {
      if (hc.category !== llmComment.category) return false;
      const overlap = Math.max(
        0,
        Math.min(hc.endLine, llmComment.endLine) -
          Math.max(hc.startLine, llmComment.startLine) +
          1,
      );
      return overlap >= overlapThreshold;
    });

    if (!isDuplicate) {
      result.push(llmComment);
    }
  }

  return result;
}

function mapCategory(cat: string): ReviewComment['category'] {
  const m: Record<string, ReviewComment['category']> = {
    security: 'security',
    correctness: 'bug',
    bug: 'bug',
    performance: 'performance',
    maintainability: 'maintainability',
    style: 'style',
    documentation: 'documentation',
    architecture: 'architecture',
  };
  return m[cat.toLowerCase()] ?? 'style';
}

function mapSeverity(sev: string): ReviewComment['severity'] {
  const m: Record<string, ReviewComment['severity']> = {
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
  };
  return m[sev.toLowerCase()] ?? 'medium';
}
