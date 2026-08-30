// @ts-nocheck
// @code-analyzer/intelligence — Taint pipeline branch coverage: the call-graph
// builder's edge-kind filter, callee self-match skip, and the block-line
// fallback.

import { describe, it, expect } from 'vitest';
import { buildCallGraph } from '../security/taint-pipeline.js';
import type { FunctionCfg, CfgEdge } from '../cfg/types.js';

function makeCfg(fnName: string, edges: CfgEdge[]): FunctionCfg {
  return {
    functionName: fnName,
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 1, statementCount: 1, isEntry: true, isExit: false },
      { index: 1, startLine: 2, endLine: 2, statementCount: 1, isEntry: false, isExit: true },
    ],
    edges,
    bindings: [],
    entryIndex: 0,
    exitIndex: 1,
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
  };
}

describe('buildCallGraph', () => {
  it('skips sequential and cond-true edges and maps the rest to call edges', () => {
    const cfgA = makeCfg('a', [
      { from: 0, to: 1, kind: 'seq' },
      { from: 0, to: 1, kind: 'cond-true' },
      { from: 0, to: 1, kind: 'cond-false' },
      { from: 1, to: 0, kind: 'loop-back' },
      { from: 99, to: 0, kind: 'return' },
    ]);
    const cfgB = makeCfg('b', []);
    const edges = buildCallGraph(
      new Map([
        ['a', cfgA],
        ['b', cfgB],
      ]),
    );

    // Three non-seq/non-cond-true edges from 'a', each mapped to the single
    // other callee 'b' (self-reference 'a' is skipped).
    expect(edges.length).toBe(3);
    expect(edges.every((e) => e.callerQn === 'a' && e.calleeQn === 'b')).toBe(true);
  });
});
