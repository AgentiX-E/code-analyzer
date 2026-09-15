// @code-analyzer/ca-bench — Benchmark Types

export interface BenchmarkSuite {
  name: string;
  description: string;
  run(): Promise<BenchmarkResult>;
}

export interface BenchmarkResult {
  suite: string;
  metrics: Record<string, number>;
  thresholds: Record<string, { min?: number; max?: number; target: number }>;
  passed: boolean;
  details: string[];
}

export interface MutantAnalysis {
  file: string;
  line: number;
  original: string;
  mutation: string;
  killed: boolean;
  testThatKills?: string;
}

export interface LLMReviewCase {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: string;
  expectedFindings: string[];
  description: string;
}

// ---------------------------------------------------------------------------
// Suite and fixture types
//
// These four were imported by the fixtures and suites but never declared, so the harness could not compile.
// Each shape below is read off its uses rather than invented: the property names come from the object
// literals that populate the arrays, and from what the suites push and return.
// ---------------------------------------------------------------------------

/** A cross-repo relation the detector is expected to find (see `fixtures/cross-repo-relations`). */
export interface CrossRepoRelation {
  sourceRepo: string;
  sourceFile: string;
  sourceSymbol: string;
  targetRepo: string;
  targetFile: string;
  targetSymbol: string;
  relationType: string;
}

/** A labelled text pair for the embedding-quality suite (see `fixtures/semantic-pairs`). */
export interface EmbeddingPair {
  id: string;
  textA: string;
  textB: string;
  expectedSimilarity: 'high' | 'medium' | 'low';
  /** Floor for pairs expected to be similar; low-similarity pairs carry `maxCosSimilarity` instead. */
  minCosSimilarity?: number;
  /** Ceiling for pairs expected to be dissimilar. */
  maxCosSimilarity?: number;
}

/** One number a suite reports, as pushed into `measurements`. */
export interface Measurement {
  name: string;
  value: number;
  unit: string;
}

/** What a suite returns; `details` carries whatever that suite wants the report to show. */
export interface SuiteResult {
  suiteId: string;
  suiteName: string;
  durationMs: number;
  passed: boolean;
  measurements: Measurement[];
  details: Record<string, unknown>;
}
