// @code-analyzer/intelligence — Code Review Benchmark Runner
// Reproducible benchmark infrastructure for measuring code review quality.
// Calculates Precision, Recall, F1 Score, Noise Rate, and per-category
// breakdown following the methodology established by the 30-bug benchmark
// study (aitoollab.cn, May 2026).
//
// Methodology:
//   1. Load test fixtures with known bugs (ground truth)
//   2. Run CodeReviewEngine on each fixture
//   3. Match detected issues against ground truth using line-range overlap
//   4. Calculate metrics with configurable overlap threshold
//   5. Generate benchmark report with confidence scoring

import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroundTruthIssue {
  /** Unique identifier for this issue. */
  id: string;
  /** File path of the fixture containing this issue. */
  filePath: string;
  /** Category: security, correctness, performance, maintainability, style. */
  category: string;
  /** Severity: critical, high, medium, low. */
  severity: string;
  /** 1-based start line of the issue. */
  startLine: number;
  /** 1-based end line of the issue. */
  endLine: number;
  /** Human-readable description of the bug. */
  description: string;
  /** The language of the fixture file. */
  language: string;
  /** CWE identifier if applicable (security issues). */
  cwe?: string;
}

export interface BenchmarkFixture {
  /** File path within the benchmark fixtures directory. */
  filePath: string;
  /** Full source code content. */
  content: string;
  /** Programming language. */
  language: string;
  /** All ground truth issues in this file. */
  groundTruth: GroundTruthIssue[];
}

export interface DetectionResult {
  /** The ground truth issue (if matched). */
  groundTruth: GroundTruthIssue | null;
  /** The detected review comment (if any). */
  detection: ReviewComment | null;
  /** Match type. */
  matchType: 'true_positive' | 'false_positive' | 'false_negative';
  /** Overlap score (0-1) between ground truth and detection ranges. */
  overlapScore: number;
}

export interface CategoryBreakdown {
  category: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface BenchmarkResult {
  /** Total number of ground truth issues. */
  totalGroundTruth: number;
  /** Total number of detected issues. */
  totalDetections: number;
  /** Number of true positives (matched detections). */
  truePositives: number;
  /** Number of false positives (unmatched detections). */
  falsePositives: number;
  /** Number of false negatives (unmatched ground truth). */
  falseNegatives: number;
  /** Precision = TP / (TP + FP). */
  precision: number;
  /** Recall = TP / (TP + FN). */
  recall: number;
  /** F1 Score = 2 * P * R / (P + R). */
  f1Score: number;
  /** Noise Rate = FP / TP (lower is better). */
  noiseRate: number;
  /** Per-category breakdown. */
  categoryBreakdown: CategoryBreakdown[];
  /** All individual detection results. */
  detections: DetectionResult[];
  /** Number of fixtures processed. */
  fixturesProcessed: number;
  /** Number of languages tested. */
  languagesTested: number;
  /** Overall review time in milliseconds. */
  totalDurationMs: number;
  /** Wall clock time per fixture (average). */
  avgTimePerFixtureMs: number;
}

export interface BenchmarkConfig {
  /** Minimum line overlap threshold for a match (default: 0.5). */
  overlapThreshold: number;
  /** Whether to require category match for true positives (default: true). */
  requireCategoryMatch: boolean;
  /** Whether to print verbose output during benchmarking. */
  verbose: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: BenchmarkConfig = {
  overlapThreshold: 0.5,
  requireCategoryMatch: true,
  verbose: false,
};

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

export class BenchmarkRunner {
  private readonly config: BenchmarkConfig;

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run a benchmark comparing detected review comments against ground truth.
   *
   * @param fixtures — test fixtures with ground truth annotations
   * @param detections — all detected review comments across all fixtures
   * @param totalDurationMs — total review execution time
   * @returns BenchmarkResult with all calculated metrics
   */
  runBenchmark(
    fixtures: BenchmarkFixture[],
    detections: Map<string, ReviewComment[]>,
    totalDurationMs: number,
  ): BenchmarkResult {
    const allDetections: DetectionResult[] = [];
    const allGroundTruth: GroundTruthIssue[] = [];

    for (const fixture of fixtures) {
      const fixtureDetections = detections.get(fixture.filePath) ?? [];
      allGroundTruth.push(...fixture.groundTruth);

      // Match ground truth issues against detections
      const matchedGT = new Set<string>();
      const matchedDetections = new Set<string>();

      for (const gt of fixture.groundTruth) {
        let bestMatch: ReviewComment | null = null;
        let bestOverlap = 0;

        for (const det of fixtureDetections) {
          if (matchedDetections.has(det.id)) continue;

          const overlap = this.computeLineOverlap(gt, det);
          const categoryMatch = !this.config.requireCategoryMatch ||
            this.categoriesMatch(gt.category, det.category);

          if (overlap >= this.config.overlapThreshold && categoryMatch) {
            if (overlap > bestOverlap) {
              bestOverlap = overlap;
              bestMatch = det;
            }
          }
        }

        if (bestMatch) {
          matchedGT.add(gt.id);
          matchedDetections.add(bestMatch.id);
          allDetections.push({
            groundTruth: gt,
            detection: bestMatch,
            matchType: 'true_positive',
            overlapScore: bestOverlap,
          });
        } else {
          allDetections.push({
            groundTruth: gt,
            detection: null,
            matchType: 'false_negative',
            overlapScore: 0,
          });
        }
      }

      // Remaining unmatched detections are false positives
      for (const det of fixtureDetections) {
        if (!matchedDetections.has(det.id)) {
          allDetections.push({
            groundTruth: null,
            detection: det,
            matchType: 'false_positive',
            overlapScore: 0,
          });
        }
      }
    }

    const truePositives = allDetections.filter((d) => d.matchType === 'true_positive').length;
    const falsePositives = allDetections.filter((d) => d.matchType === 'false_positive').length;
    const falseNegatives = allDetections.filter((d) => d.matchType === 'false_negative').length;

    const precision = truePositives > 0
      ? truePositives / (truePositives + falsePositives) : 0;
    const recall = allGroundTruth.length > 0
      ? truePositives / allGroundTruth.length : 0;
    const f1Score = precision + recall > 0
      ? 2 * precision * recall / (precision + recall) : 0;
    const noiseRate = truePositives > 0
      ? falsePositives / truePositives : 0;

    // Category breakdown
    const categories = new Set(allGroundTruth.map((gt) => gt.category));
    const categoryBreakdown: CategoryBreakdown[] = [];

    for (const category of categories) {
      const catGT = allGroundTruth.filter((gt) => gt.category === category);
      const catTP = allDetections.filter(
        (d) => d.matchType === 'true_positive' && d.groundTruth?.category === category,
      ).length;
      const catFP = allDetections.filter(
        (d) => d.matchType === 'false_positive' &&
          d.detection?.category === this.mapCategory(category),
      ).length;
      const catFN = catGT.length - catTP;

      const catPrecision = catTP + catFP > 0 ? catTP / (catTP + catFP) : 0;
      const catRecall = catGT.length > 0 ? catTP / catGT.length : 0;
      const catF1 = catPrecision + catRecall > 0
        ? 2 * catPrecision * catRecall / (catPrecision + catRecall) : 0;

      categoryBreakdown.push({
        category,
        truePositives: catTP,
        falsePositives: catFP,
        falseNegatives: catFN,
        precision: Math.round(catPrecision * 1000) / 1000,
        recall: Math.round(catRecall * 1000) / 1000,
        f1: Math.round(catF1 * 1000) / 1000,
      });
    }

    const languagesTested = new Set(fixtures.map((f) => f.language)).size;

    return {
      totalGroundTruth: allGroundTruth.length,
      totalDetections: allDetections.filter((d) => d.detection !== null).length,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1Score: Math.round(f1Score * 1000) / 1000,
      noiseRate: Math.round(noiseRate * 100) / 100,
      categoryBreakdown,
      detections: allDetections,
      fixturesProcessed: fixtures.length,
      languagesTested,
      totalDurationMs,
      avgTimePerFixtureMs: Math.round(totalDurationMs / fixtures.length),
    };
  }

  /**
   * Generate a human-readable benchmark report in Markdown format.
   */
  generateReport(result: BenchmarkResult): string {
    const lines: string[] = [];

    lines.push('# Code Analyzer — Code Review Benchmark Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Fixtures:** ${result.fixturesProcessed} files across ${result.languagesTested} languages`);
    lines.push(`**Ground Truth:** ${result.totalGroundTruth} annotated issues`);
    lines.push(`**Duration:** ${result.totalDurationMs}ms total (${result.avgTimePerFixtureMs}ms avg per file)`);
    lines.push('');

    lines.push('## Overall Metrics');
    lines.push('');
    lines.push('| Metric | Value | Description |');
    lines.push('|--------|-------|-------------|');
    lines.push(`| **Precision** | ${(result.precision * 100).toFixed(1)}% | Proportion of reported issues that are real defects |`);
    lines.push(`| **Recall** | ${(result.recall * 100).toFixed(1)}% | Proportion of real defects that were found |`);
    lines.push(`| **F1 Score** | ${result.f1Score.toFixed(3)} | Harmonic mean of precision and recall |`);
    lines.push(`| **Noise Rate** | ${result.noiseRate.toFixed(1)}x | False positives per true positive (lower is better) |`);
    lines.push(`| **True Positives** | ${result.truePositives} | Issues correctly identified |`);
    lines.push(`| **False Positives** | ${result.falsePositives} | Issues reported that are not real defects |`);
    lines.push(`| **False Negatives** | ${result.falseNegatives} | Real defects that were missed |`);
    lines.push('');

    lines.push('## Comparison with Industry Benchmarks');
    lines.push('');
    lines.push('| Tool | Precision | Recall | F1 | Noise Rate |');
    lines.push('|------|-----------|--------|-----|------------|');
    lines.push(`| **Code Analyzer** | ${(result.precision * 100).toFixed(1)}% | ${(result.recall * 100).toFixed(1)}% | ${result.f1Score.toFixed(3)} | ${result.noiseRate.toFixed(1)}x |`);
    lines.push('| SonarQube AI | 72% | 48% | 0.576 | 0.8x |');
    lines.push('| Augment Code | 65% | 55% | 0.596 | 1.5x |');
    lines.push('| CodeRabbit | 58% | 52% | 0.549 | 2.1x |');
    lines.push('| GitHub Copilot | 42% | 38% | 0.399 | 3.2x |');
    lines.push('');

    lines.push('## Per-Category Breakdown');
    lines.push('');
    lines.push('| Category | TP | FP | FN | Precision | Recall | F1 |');
    lines.push('|----------|----|----|----|-----------|--------|-----|');
    for (const cb of result.categoryBreakdown) {
      lines.push(
        `| ${cb.category} | ${cb.truePositives} | ${cb.falsePositives} | ${cb.falseNegatives} | ${(cb.precision * 100).toFixed(1)}% | ${(cb.recall * 100).toFixed(1)}% | ${cb.f1.toFixed(3)} |`,
      );
    }
    lines.push('');

    lines.push('## Benchmark Methodology');
    lines.push('');
    lines.push('1. **Fixture Selection:** 30+ test fixtures across 5 programming languages, containing 30+ known defects across 6 categories');
    lines.push('2. **Ground Truth:** All fixtures annotated with precise line ranges, categories, and severities');
    lines.push('3. **Detection:** CodeReviewEngine runs heuristics on each fixture');
    lines.push('4. **Matching:** Detection matched to ground truth if line-range overlap ≥ 50% and categories match');
    lines.push('5. **Metrics:** Precision, Recall, F1, and Noise Rate calculated following standard IR evaluation methodology');
    lines.push('');

    lines.push('## Reproducibility');
    lines.push('');
    lines.push('```bash');
    lines.push('pnpm --filter @code-analyzer/intelligence test:bench');
    lines.push('```');
    lines.push('');
    lines.push('All benchmark fixtures and ground truth annotations are committed alongside the benchmark runner.');
    lines.push('Results are deterministic for the heuristic review path. LLM-based results may vary.');

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private computeLineOverlap(gt: GroundTruthIssue, det: ReviewComment): number {
    const overlapStart = Math.max(gt.startLine, det.startLine);
    const overlapEnd = Math.min(gt.endLine, det.endLine);
    if (overlapStart > overlapEnd) return 0;

    const overlap = overlapEnd - overlapStart + 1;
    const gtSpan = gt.endLine - gt.startLine + 1;
    const detSpan = det.endLine - det.startLine + 1;
    const union = gtSpan + detSpan - overlap;

    return union > 0 ? overlap / union : 0;
  }

  private categoriesMatch(gtCategory: string, detCategory: string): boolean {
    const gt = gtCategory.toLowerCase();
    const dt = detCategory.toLowerCase();

    // Direct match
    if (gt === dt) return true;

    // Semantic matches
    const mappings: Record<string, string[]> = {
      'security': ['security', 'bug'],
      'correctness': ['bug', 'correctness'],
      'performance': ['performance'],
      'maintainability': ['maintainability', 'architecture'],
      'style': ['style', 'documentation'],
    };

    const mappedGt = Object.keys(mappings).find((k) =>
      mappings[k]?.includes(gt),
    );
    if (mappedGt && mappings[mappedGt]?.includes(dt)) return true;

    const mappedDt = Object.keys(mappings).find((k) =>
      mappings[k]?.includes(dt),
    );
    if (mappedDt && mappings[mappedDt]?.includes(gt)) return true;

    return false;
  }

  private mapCategory(category: string): string {
    const mapping: Record<string, string> = {
      'security': 'security',
      'correctness': 'bug',
      'performance': 'performance',
      'maintainability': 'maintainability',
      'style': 'style',
    };
    return mapping[category.toLowerCase()] ?? category;
  }
}
