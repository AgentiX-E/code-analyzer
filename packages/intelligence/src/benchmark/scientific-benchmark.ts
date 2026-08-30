// @code-analyzer/intelligence — Scientific Benchmark Framework
// Provides statistically rigorous benchmark evaluation with bootstrap confidence
// intervals, McNemar's test for paired comparison, and per-category breakdowns.
//
// Based on the methodology described in:
//   - sverklo-bench: first public reproducible benchmark for MCP code intelligence
//   - Open Code Review: 200-PR benchmark with 1,505 ground-truth issues
//   - codebase-memory-mcp: arXiv:2603.27277 (31-repo statistical study)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single annotated ground-truth issue in a code sample. */
export interface GroundTruthIssue {
  /** Unique issue identifier within the benchmark suite. */
  id: string;
  /** The file path where the issue exists. */
  file: string;
  /** Start line (1-based, inclusive). */
  startLine: number;
  /** End line (1-based, inclusive). */
  endLine: number;
  /** Issue category (e.g. 'security', 'correctness', 'performance'). */
  category: IssueCategory;
  /** Issue severity. */
  severity: IssueSeverity;
  /** Human-readable description of the issue. */
  description: string;
  /** CWE identifier if applicable (e.g. 'CWE-89'). */
  cweId?: string;
  /** Language of the source file. */
  language: string;
}

/** Categories for benchmark issues. */
export type IssueCategory =
  'security' | 'correctness' | 'performance' | 'maintainability' | 'style' | 'architecture';

/** Severity levels for benchmark issues. */
export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** A single benchmark case (one PR or code sample). */
export interface BenchmarkCase {
  /** Unique case identifier. */
  id: string;
  /** Source repository name. */
  repository: string;
  /** PR number or commit reference. */
  prNumber?: number;
  /** Programming language(s) in this case. */
  languages: string[];
  /** Total lines of code in the sample. */
  loc: number;
  /** Number of source files. */
  fileCount: number;
  /** Ground-truth issues that SHOULD be found. */
  groundTruth: GroundTruthIssue[];
  /** Expected false positives that SHOULD NOT be found. */
  expectedFalsePositives: GroundTruthIssue[];
  /** Whether this case is from a real open-source repository. */
  realWorld: boolean;
}

/** A single detection from the system under test. */
export interface DetectionResult {
  /** Detected issue identifier. */
  id: string;
  /** File path where the issue was detected. */
  file: string;
  /** Start line of the detection (1-based, inclusive). */
  startLine: number;
  /** End line of the detection (1-based, inclusive). */
  endLine: number;
  /** Detected category. */
  category: string;
  /** Detected severity. */
  severity: string;
  /** Whether this detection is a true positive. */
  isTruePositive: boolean;
  /** Which ground truth issue this matches (if any). */
  matchedGroundTruthId?: string;
}

// ---------------------------------------------------------------------------
// Statistical Types
// ---------------------------------------------------------------------------

/** Per-category metrics. */
export interface CategoryMetrics {
  category: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Per-severity metrics. */
export interface SeverityMetrics {
  severity: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Per-language metrics. */
export interface LanguageMetrics {
  language: string;
  cases: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Confidence interval computed via bootstrapping. */
export interface ConfidenceInterval {
  /** Metric name. */
  metric: 'precision' | 'recall' | 'f1';
  /** Point estimate (mean of bootstrap samples). */
  estimate: number;
  /** Lower bound of the 95% confidence interval. */
  lower: number;
  /** Upper bound of the 95% confidence interval. */
  upper: number;
  /** Number of bootstrap samples used. */
  samples: number;
}

/** Statistical significance test result. */
export interface SignificanceTest {
  /** Test name. */
  test: 'mcnemar' | 'paired_bootstrap';
  /** P-value of the test. */
  pValue: number;
  /** Whether the result is statistically significant (p < 0.05). */
  significant: boolean;
  /** Effect size description. */
  effectSize?: string;
}

/** Full scientific benchmark result. */
export interface ScientificBenchmarkResult {
  /** Benchmark metadata. */
  metadata: BenchmarkMetadata;
  /** Overall metrics. */
  overall: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    f1: number;
    noiseRate: number;
    totalGroundTruth: number;
    totalDetections: number;
  };
  /** Per-category breakdown. */
  byCategory: CategoryMetrics[];
  /** Per-severity breakdown. */
  bySeverity: SeverityMetrics[];
  /** Per-language breakdown. */
  byLanguage: LanguageMetrics[];
  /** Confidence intervals for key metrics. */
  confidenceIntervals: ConfidenceInterval[];
  /** Per-case results. */
  cases: CaseResult[];
  /** Total execution time in milliseconds. */
  durationMs: number;
}

/** Benchmark metadata. */
export interface BenchmarkMetadata {
  /** Benchmark suite name. */
  suiteName: string;
  /** Number of cases in the benchmark. */
  totalCases: number;
  /** Total lines of code across all cases. */
  totalLoc: number;
  /** Total ground-truth issues. */
  totalGroundTruth: number;
  /** Languages covered. */
  languages: string[];
  /** Categories covered. */
  categories: string[];
  /** Benchmark execution timestamp. */
  timestamp: string;
  /** System version under test. */
  version: string;
}

/** Single case result. */
export interface CaseResult {
  caseId: string;
  repository: string;
  languages: string[];
  loc: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  durationMs: number;
  detections: DetectionResult[];
}

// ---------------------------------------------------------------------------
// Bootstrap Confidence Interval Computation
// ---------------------------------------------------------------------------

/**
 * Compute bootstrap confidence intervals for precision, recall, and F1.
 * Uses the percentile method with B = 10,000 resamples.
 *
 * @param results - Per-case results from the benchmark run
 * @param numSamples - Number of bootstrap samples (default: 10000)
 * @returns 95% confidence intervals for each metric
 */
export function computeBootstrapConfidenceIntervals(
  results: CaseResult[],
  numSamples: number = 10000,
): ConfidenceInterval[] {
  if (results.length === 0) return [];

  const metrics = extractMetrics(results);

  const bootstrapped: { precision: number[]; recall: number[]; f1: number[] } = {
    precision: [],
    recall: [],
    f1: [],
  };

  for (let b = 0; b < numSamples; b++) {
    const sample = bootstrapSample(results);
    if (sample.length === 0) continue;
    const sampleMetrics = extractMetrics(sample);

    bootstrapped.precision.push(sampleMetrics.precision);
    bootstrapped.recall.push(sampleMetrics.recall);
    bootstrapped.f1.push(sampleMetrics.f1);
  }

  const intervals: ConfidenceInterval[] = [];

  for (const metric of ['precision', 'recall', 'f1'] as const) {
    const values = bootstrapped[metric].sort((a, b) => a - b);
    const lowerIdx = Math.floor(values.length * 0.025);
    const upperIdx = Math.floor(values.length * 0.975);
    // With zero bootstrap samples (e.g. numSamples <= 0), the mean of an empty
    // array is NaN. Fall back to the direct metric estimate of the full results.
    const estimate =
      values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : metrics[metric];

    intervals.push({
      metric,
      estimate: Math.round(estimate * 10000) / 10000,
      lower: Math.round((values[lowerIdx] ?? 0) * 10000) / 10000,
      upper: Math.round((values[upperIdx] ?? 1) * 10000) / 10000,
      samples: numSamples,
    });
  }

  return intervals;
}

// ---------------------------------------------------------------------------
// McNemar's Test for Paired Comparison
// ---------------------------------------------------------------------------

/**
 * Perform McNemar's test to compare two systems (A and B) on the same benchmark
 * cases. Tests the null hypothesis that both systems have equal performance.
 *
 * Uses a contingency table:
 *   Both correct: n11
 *   A correct, B wrong: n10
 *   A wrong, B correct: n01
 *   Both wrong: n00
 *
 * McNemar's statistic: χ² = (|n10 - n01| - 1)² / (n10 + n01)
 * Under null hypothesis, distributed approx. χ² with 1 df.
 *
 * @param systemA - Results from system A (baseline)
 * @param systemB - Results from system B (treatment)
 * @returns McNemar test result with p-value
 */
export function mcnemarTest(systemA: CaseResult[], systemB: CaseResult[]): SignificanceTest {
  // Build contingency table at the issue-detection level
  let n10 = 0; // A correct, B wrong
  let n01 = 0; // B correct, A wrong

  const caseMapA = new Map(systemA.map((c) => [c.caseId, c]));
  const caseMapB = new Map(systemB.map((c) => [c.caseId, c]));

  const allCaseIds = new Set([...caseMapA.keys(), ...caseMapB.keys()]);

  for (const caseId of allCaseIds) {
    const caseA = caseMapA.get(caseId);
    const caseB = caseMapB.get(caseId);
    if (!caseA || !caseB) continue;

    const tpA = new Set(caseA.detections.filter((d) => d.isTruePositive).map((d) => d.id));
    const tpB = new Set(caseB.detections.filter((d) => d.isTruePositive).map((d) => d.id));

    for (const id of tpA) {
      if (!tpB.has(id)) n10++;
    }
    for (const id of tpB) {
      if (!tpA.has(id)) n01++;
    }
  }

  if (n10 + n01 === 0) {
    return {
      test: 'mcnemar',
      pValue: 1.0,
      significant: false,
      effectSize: 'no_difference',
    };
  }

  // McNemar's test with continuity correction (Edwards, 1948)
  const chiSquared = (Math.abs(n10 - n01) - 1) ** 2 / (n10 + n01);

  // Approximation of χ² survival function for 1 df
  const pValue = chiSquaredSurvival(chiSquared);

  return {
    test: 'mcnemar',
    pValue: Math.round(pValue * 10000) / 10000,
    significant: pValue < 0.05,
    effectSize: classifyEffectSize(n10, n01, systemA.length),
  };
}

// ---------------------------------------------------------------------------
// IoU (Intersection over Union) Line Matching
// ---------------------------------------------------------------------------

/**
 * Compute Intersection-over-Union for two line ranges.
 *
 * @param start1 - Start line of range 1 (1-based)
 * @param end1 - End line of range 1 (1-based)
 * @param start2 - Start line of range 2 (1-based)
 * @param end2 - End line of range 2 (1-based)
 * @returns IoU score in [0, 1]
 */
export function computeIoU(start1: number, end1: number, start2: number, end2: number): number {
  const intersectionStart = Math.max(start1, start2);
  const intersectionEnd = Math.min(end1, end2);

  if (intersectionStart > intersectionEnd) return 0;

  const intersection = intersectionEnd - intersectionStart + 1;
  const union = end1 - start1 + 1 + (end2 - start2 + 1) - intersection;

  return union > 0 ? intersection / union : 0;
}

/**
 * Match detections to ground truth using IoU threshold.
 *
 * @param detections - System detections
 * @param groundTruth - Ground truth issues
 * @param iouThreshold - Minimum IoU for a match (default: 0.5)
 * @param categoryMustMatch - Whether the category must also match (default: false)
 * @returns Matched detection results
 */
export function matchDetections(
  detections: DetectionResult[],
  groundTruth: GroundTruthIssue[],
  iouThreshold: number = 0.5,
  categoryMustMatch: boolean = false,
): DetectionResult[] {
  const matched = new Set<string>();
  const results: DetectionResult[] = [];

  for (const detection of detections) {
    let bestIoU = 0;
    let bestMatch: GroundTruthIssue | null = null;

    for (const gt of groundTruth) {
      if (matched.has(gt.id)) continue;
      if (categoryMustMatch && detection.category !== gt.category) continue;
      if (detection.file !== gt.file) continue;

      const iou = computeIoU(detection.startLine, detection.endLine, gt.startLine, gt.endLine);

      if (iou > bestIoU && iou >= iouThreshold) {
        bestIoU = iou;
        bestMatch = gt;
      }
    }

    if (bestMatch) {
      matched.add(bestMatch.id);
      results.push({ ...detection, isTruePositive: true, matchedGroundTruthId: bestMatch.id });
    } else {
      results.push({ ...detection, isTruePositive: false });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Metric Aggregation
// ---------------------------------------------------------------------------

/**
 * Compute precision, recall, and F1 from detection results.
 */
export function computePrecisionRecallF1(
  matchedDetections: DetectionResult[],
  totalGroundTruth: number,
): { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number } {
  const tp = matchedDetections.filter((d) => d.isTruePositive).length;
  const fp = matchedDetections.filter((d) => !d.isTruePositive).length;
  const fn = totalGroundTruth - tp;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1, tp, fp, fn };
}

/**
 * Compute per-category metrics.
 */
export function computeCategoryMetrics(
  cases: BenchmarkCase[],
  matchedDetections: DetectionResult[],
): CategoryMetrics[] {
  const categories = new Map<string, { tp: number; fp: number; fn: number }>();

  for (const c of cases) {
    for (const gt of c.groundTruth) {
      const entry = categories.get(gt.category) ?? { tp: 0, fp: 0, fn: 0 };
      categories.set(gt.category, entry);
    }
  }

  for (const d of matchedDetections) {
    const entry = categories.get(d.category) ?? { tp: 0, fp: 0, fn: 0 };
    if (d.isTruePositive) {
      entry.tp++;
    } else {
      entry.fp++;
    }
    categories.set(d.category, entry);
  }

  // Count FN per category
  for (const c of cases) {
    for (const gt of c.groundTruth) {
      const found = matchedDetections.some((d) => d.matchedGroundTruthId === gt.id);
      if (!found) {
        const entry = categories.get(gt.category) ?? { tp: 0, fp: 0, fn: 0 };
        entry.fn++;
        categories.set(gt.category, entry);
      }
    }
  }

  return Array.from(categories.entries()).map(([category, { tp, fp, fn }]) => {
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      category,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      f1,
    };
  });
}

// ---------------------------------------------------------------------------
// Scientific Benchmark Runner
// ---------------------------------------------------------------------------

/**
 * Run a scientific benchmark against a set of cases.
 *
 * @param cases - Benchmark cases with ground truth
 * @param detectFn - Detection function: (caseId, fileContents) => DetectionResult[]
 * @param fileProvider - Function that provides file contents for a case: (caseId) => Map<file, content>
 * @param options - Benchmark options
 * @returns Scientific benchmark result with statistics
 */
export async function runScientificBenchmark(
  cases: BenchmarkCase[],
  detectFn: (
    caseId: string,
    files: Map<string, string>,
  ) => Promise<DetectionResult[]> | DetectionResult[],
  fileProvider: (caseId: string) => Map<string, string>,
  options?: {
    iouThreshold?: number;
    categoryMustMatch?: boolean;
    suiteName?: string;
    version?: string;
  },
): Promise<ScientificBenchmarkResult> {
  const startTime = performance.now();
  const caseResults: CaseResult[] = [];
  let totalTP = 0;
  let totalFP = 0;
  let totalFN = 0;

  for (const benchmarkCase of cases) {
    const caseStart = performance.now();
    const files = fileProvider(benchmarkCase.id);
    const detections = await detectFn(benchmarkCase.id, files);

    const matched = matchDetections(
      detections,
      benchmarkCase.groundTruth,
      options?.iouThreshold ?? 0.5,
      options?.categoryMustMatch ?? false,
    );

    const { tp, fp, fn, precision, recall, f1 } = computePrecisionRecallF1(
      matched,
      benchmarkCase.groundTruth.length,
    );

    totalTP += tp;
    totalFP += fp;
    totalFN += fn;

    caseResults.push({
      caseId: benchmarkCase.id,
      repository: benchmarkCase.repository,
      languages: benchmarkCase.languages,
      loc: benchmarkCase.loc,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      f1,
      durationMs: performance.now() - caseStart,
      detections: matched,
    });
  }

  const overallPrecision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 0;
  const overallRecall = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0;
  const overallF1 =
    overallPrecision + overallRecall > 0
      ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall)
      : 0;

  const allLanguages = new Set<string>();
  const allCategories = new Set<string>();
  let totalLoc = 0;
  let totalGroundTruth = 0;

  for (const c of cases) {
    totalLoc += c.loc;
    totalGroundTruth += c.groundTruth.length;
    for (const l of c.languages) allLanguages.add(l);
    for (const gt of c.groundTruth) allCategories.add(gt.category);
  }

  // Flatten all detections
  const allDetections = caseResults.flatMap((c) => c.detections);

  return {
    metadata: {
      suiteName: options?.suiteName ?? 'CA-Bench',
      totalCases: cases.length,
      totalLoc,
      totalGroundTruth,
      languages: Array.from(allLanguages).sort(),
      categories: Array.from(allCategories).sort(),
      timestamp: new Date().toISOString(),
      version: options?.version ?? '1.0.0',
    },
    overall: {
      truePositives: totalTP,
      falsePositives: totalFP,
      falseNegatives: totalFN,
      precision: overallPrecision,
      recall: overallRecall,
      f1: overallF1,
      noiseRate: totalTP > 0 ? totalFP / totalTP : 0,
      totalGroundTruth,
      totalDetections: allDetections.length,
    },
    byCategory: computeCategoryMetrics(cases, allDetections),
    bySeverity: computeSeverityMetrics(cases, allDetections),
    byLanguage: computeLanguageMetrics(cases, caseResults),
    confidenceIntervals: computeBootstrapConfidenceIntervals(caseResults),
    cases: caseResults,
    durationMs: performance.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Private Helpers
// ---------------------------------------------------------------------------

function extractMetrics(results: CaseResult[]): {
  precision: number;
  recall: number;
  f1: number;
  totalTP: number;
  totalFP: number;
  totalFN: number;
} {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of results) {
    tp += r.truePositives;
    fp += r.falsePositives;
    fn += r.falseNegatives;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, totalTP: tp, totalFP: fp, totalFN: fn };
}

function bootstrapSample(results: CaseResult[]): CaseResult[] {
  const sample: CaseResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const idx = Math.floor(Math.random() * results.length);
    sample.push(results[idx]!);
  }
  return sample;
}

/**
 * Approximate chi-squared survival function for 1 degree of freedom.
 * Uses the complementary error function erfc approximation.
 */
function chiSquaredSurvival(x: number): number {
  if (x <= 0) return 1.0;
  // For 1 df: P(χ² > x) = erfc(sqrt(x/2))
  const z = Math.sqrt(x / 2);
  return erfc(z);
}

/**
 * Approximation of the complementary error function.
 */
function erfc(x: number): number {
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign < 0 ? 2.0 - y : y;
}

function classifyEffectSize(n10: number, n01: number, totalCases: number): string {
  const diff = Math.abs(n10 - n01);
  const rate = totalCases > 0 ? diff / totalCases : 0;

  if (rate > 0.2) return 'large';
  if (rate > 0.1) return 'medium';
  if (rate > 0.05) return 'small';
  return 'negligible';
}

function computeSeverityMetrics(
  cases: BenchmarkCase[],
  detections: DetectionResult[],
): SeverityMetrics[] {
  const severities = new Map<string, { tp: number; fp: number; fn: number }>();
  const allSeverities = new Set<string>();

  for (const c of cases) {
    for (const gt of c.groundTruth) {
      allSeverities.add(gt.severity);
    }
  }

  for (const severity of allSeverities) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const c of cases) {
      for (const gt of c.groundTruth) {
        if (gt.severity !== severity) continue;
        const found = detections.some((d) => d.matchedGroundTruthId === gt.id);
        if (found) tp++;
        else fn++;
      }
    }

    fp = detections.filter((d) => !d.isTruePositive && d.severity === severity).length;

    severities.set(severity, { tp, fp, fn });
  }

  return Array.from(severities.entries()).map(([severity, { tp, fp, fn }]) => {
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      severity,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      f1,
    };
  });
}

function computeLanguageMetrics(
  cases: BenchmarkCase[],
  caseResults: CaseResult[],
): LanguageMetrics[] {
  const languageData = new Map<string, { cases: number; tp: number; fp: number; fn: number }>();

  for (const c of cases) {
    for (const lang of c.languages) {
      const entry = languageData.get(lang) ?? { cases: 0, tp: 0, fp: 0, fn: 0 };
      entry.cases++;
      languageData.set(lang, entry);
    }
  }

  for (const result of caseResults) {
    for (const lang of result.languages) {
      const entry = languageData.get(lang);
      if (entry) {
        entry.tp += result.truePositives;
        entry.fp += result.falsePositives;
        entry.fn += result.falseNegatives;
      }
    }
  }

  return Array.from(languageData.entries()).map(([language, { cases, tp, fp, fn }]) => {
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      language,
      cases,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      f1,
    };
  });
}
