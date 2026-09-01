// @code-analyzer/intelligence — Taint pipeline branch coverage (round 3): the
// intra-procedural failure path (emptySummary) and the param-binding count.
// A mocked TaintPropagator throws for a marked CFG so the pipeline's catch
// branch degrades to an empty summary, and returns normally otherwise so
// buildFunctionSummary can count `param` bindings.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../security/taint-propagator.js', () => {
  class MockTaintPropagator {
    analyze(cfg: { functionName: string; filePath: string }) {
      if (cfg.functionName === 'boom') {
        throw new Error('intra-procedural analysis failed');
      }
      return {
        functionName: cfg.functionName,
        filePath: cfg.filePath,
        findings: [],
        sanitizerKills: 0,
        factsProcessed: 0,
        durationMs: 0,
      };
    }
  }
  return { TaintPropagator: MockTaintPropagator };
});

import { TaintPipeline } from '../security/taint-pipeline.js';
import type { FunctionCfg } from '../cfg/types.js';

function cfg(fnName: string, bindings: FunctionCfg['bindings']): FunctionCfg {
  return {
    functionName: fnName,
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 1, statementCount: 1, isEntry: true, isExit: true },
    ],
    edges: [],
    bindings,
    entryIndex: 0,
    exitIndex: 0,
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
  };
}

const paramBinding = {
  index: 0,
  name: 'arg',
  kind: 'param' as const,
  declLine: 1,
  declColumn: 0,
  synthetic: false,
};

describe('TaintPipeline — failure degradation and param counting', () => {
  it('degrades to an empty summary when intra-procedural analysis throws', () => {
    const pipeline = new TaintPipeline();
    const result = pipeline.analyze(new Map([['boom', cfg('boom', [paramBinding])]]), []);
    // The throwing CFG is skipped and replaced by an empty summary, so the
    // pipeline still completes with exactly one analyzed function.
    expect(result.summariesAnalyzed).toBe(1);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it('counts param bindings when building a function summary', () => {
    const pipeline = new TaintPipeline();
    const bindings: FunctionCfg['bindings'] = [
      paramBinding,
      {
        index: 1,
        name: 'local',
        kind: 'local',
        declLine: 2,
        declColumn: 0,
        synthetic: false,
      },
    ];
    const result = pipeline.analyze(new Map([['fn', cfg('fn', bindings)]]), []);
    expect(result.summariesAnalyzed).toBe(1);
  });
});
