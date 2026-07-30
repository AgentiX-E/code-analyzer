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
