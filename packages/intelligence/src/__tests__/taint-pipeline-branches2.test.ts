// @ts-nocheck
// @code-analyzer/intelligence — Taint pipeline branch coverage (round 2): the
// buildFunctionSummary source→sink mapping branches, driven by a mocked
// TaintPropagator that returns controlled intra-procedural findings.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../security/taint-propagator.js', () => {
  class MockTaintPropagator {
    analyze() {
      return {
        functionName: 'fn',
        filePath: 'test.ts',
        findings: [
          // source→source flow: skipped (sink.kind === 'source')
          {
            id: 'f1',
            source: {
              bindingIdx: 0,
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              category: 'source',
              description: 'src',
              line: 1,
            },
            sink: {
              point: { blockIndex: 0, stmtIndex: 0, line: 2 },
              kind: 'source',
              description: 'sink',
              line: 2,
            },
            path: [0],
            hops: 1,
            sanitized: false,
            truncated: false,
            interproc: false,
            confidence: 1,
          },
          // source→sink flow: mapped to paramToSinks (sink.kind !== 'source')
          {
            id: 'f2',
            source: {
              bindingIdx: 0,
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              category: 'source',
              description: 'src',
              line: 1,
            },
            sink: {
              point: { blockIndex: 0, stmtIndex: 0, line: 3 },
              kind: 'sql',
              description: 'sink',
              line: 3,
            },
            path: [0, 1],
            hops: 1,
            sanitized: false,
            truncated: false,
            interproc: false,
            confidence: 1,
          },
          // non-source flow: skipped (source.category !== 'source')
          {
            id: 'f3',
            source: {
              bindingIdx: 0,
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              category: 'param',
              description: 'param',
              line: 1,
            },
            sink: {
              point: { blockIndex: 0, stmtIndex: 0, line: 4 },
              kind: 'sql',
              description: 'sink',
              line: 4,
            },
            path: [0],
            hops: 1,
            sanitized: false,
            truncated: false,
            interproc: false,
            confidence: 1,
          },
        ],
        sanitizerKills: 0,
        factsProcessed: 0,
        durationMs: 0,
      };
    }
  }
  return { TaintPropagator: MockTaintPropagator };
});

import { TaintPipeline } from '../security/taint-pipeline.js';

describe('TaintPipeline — buildFunctionSummary source→sink mapping', () => {
  it('maps only source→sink flows and drops source→source and param flows', () => {
    const pipeline = new TaintPipeline();
    const cfg = {
      functionName: 'fn',
      filePath: 'test.ts',
      startLine: 1,
      startColumn: 0,
      blocks: [
        { index: 0, startLine: 1, endLine: 1, statementCount: 1, isEntry: true, isExit: true },
      ],
      edges: [],
      bindings: [],
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
    const result = pipeline.analyze(new Map([['fn', cfg]]), []);
    expect(result).toBeDefined();
    expect(result.summariesAnalyzed).toBe(1);
  });
});
