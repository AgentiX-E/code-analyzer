// @ts-nocheck
// @code-analyzer/intelligence — Scientific benchmark branch coverage: the
// language-metrics zero-detection fallbacks via a full benchmark run with empty
// detections.

import { describe, it, expect } from 'vitest';
import { runScientificBenchmark } from '../benchmark/scientific-benchmark.js';

function makeCase(languages: string[]): any {
  return {
    id: 'c1',
    repository: 'repo',
    languages,
    loc: 10,
    fileCount: 1,
    groundTruth: [],
    expectedFalsePositives: [],
    realWorld: false,
  };
}

describe('runScientificBenchmark — language metrics fallbacks', () => {
  it('reports zero precision/recall/f1 for a language with no detections', async () => {
    const result = await runScientificBenchmark(
      [makeCase(['typescript'])],
      async () => [],
      () => new Map(),
    );
    expect(result.byLanguage).toHaveLength(1);
    expect(result.byLanguage[0].precision).toBe(0);
    expect(result.byLanguage[0].recall).toBe(0);
    expect(result.byLanguage[0].f1).toBe(0);
  });
});
