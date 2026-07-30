// CA-Bench — Shared Types
// Core type definitions for the comprehensive Code Analyzer benchmark suite.

/** Supported benchmark suites. */
export type SuiteId =
  | 'parse-accuracy'
  | 'search-quality'
  | 'review-quality'
  | 'embedding-quality'
  | 'cross-repo'
  | 'throughput';

/** Single measurement within a benchmark run. */
export interface Measurement {
  name: string;
  value: number;
  unit: string;
  metadata?: Record<string, string>;
}

/** Result of a single benchmark suite run. */
export interface SuiteResult {
  suiteId: SuiteId;
  suiteName: string;
  durationMs: number;
  passed: boolean;
  measurements: Measurement[];
  details?: Record<string, unknown>;
  errors?: string[];
}

/** Aggregate CA-Bench run result across all suites. */
export interface CaBenchResult {
  timestamp: string;
  version: string;
  suites: SuiteResult[];
  aggregate: CaBenchAggregate;
  warnings: string[];
}

/** Aggregate metrics computed across all benchmark suites. */
export interface CaBenchAggregate {
  totalDurationMs: number;
  suitesPassed: number;
  suitesFailed: number;
  overallScore: number;
  categoryScores: Record<string, number>;
  thresholds: Record<string, { target: number; actual: number; met: boolean }>;
}

/** Configuration for a benchmark suite. */
export interface SuiteConfig {
  /** Whether to run this suite (default true). */
  enabled: boolean;
  /** Timeout in milliseconds for the entire suite. */
  timeoutMs: number;
  /** Warning threshold below which the measurement is flagged. */
  thresholds: Record<string, number>;
}

/** Configuration for the CA-Bench runner. */
export interface CaBenchConfig {
  suites: Record<SuiteId, SuiteConfig>;
  outputDir?: string;
  failOnWarning?: boolean;
}

/** A canonical code snippet fixture for parse accuracy benchmarks. */
export interface ParseFixture {
  language: string;
  fileName: string;
  code: string;
  expectedSymbols: string[];
  minSymbolsToDetect: number;
}

/** A search quality ground-truth entry. */
export interface SearchGroundTruth {
  query: string;
  expectedResults: string[];
  relevanceGrades: Record<string, number>;
}

/** An embedding quality test pair. */
export interface EmbeddingPair {
  id: string;
  textA: string;
  textB: string;
  expectedSimilarity: 'high' | 'medium' | 'low';
  minCosSimilarity?: number;
  maxCosSimilarity?: number;
}

/** Cross-repo relationship test case. */
export interface CrossRepoRelation {
  sourceRepo: string;
  sourceFile: string;
  sourceSymbol: string;
  targetRepo: string;
  targetFile: string;
  targetSymbol: string;
  relationType: string;
}
