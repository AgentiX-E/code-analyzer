import { describe, it, expect } from 'vitest';
import { TaintPipeline } from '../security/taint-pipeline.js';
import type { FunctionCfg } from '../cfg/types.js';
import type { CallGraphEdge } from '../security/interproc-solver.js';

function cfg(fnName: string): FunctionCfg {
  return {
    functionName: fnName,
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
}

describe('TaintPipeline', () => {
  it('creates instance', () => {
    expect(new TaintPipeline()).toBeDefined();
    expect(typeof new TaintPipeline().analyze).toBe('function');
  });

  it('returns result for empty input', () => {
    const p = new TaintPipeline();
    const r = p.analyze(new Map(), []);
    expect(r).toBeDefined();
    expect(r.findings).toBeDefined();
    expect(Array.isArray(r.findings)).toBe(true);
  });

  it('returns result for single function', () => {
    const m = new Map<string, FunctionCfg>();
    m.set('fn', cfg('fn'));
    const r = new TaintPipeline().analyze(m, []);
    expect(r.findings).toBeDefined();
  });

  it('returns stats object', () => {
    const r = new TaintPipeline().analyze(new Map(), []);
    expect(r.stats).toBeDefined();
    expect(r.stats).toBeDefined();
  });

  it('handles cross-function call graph', () => {
    const m = new Map<string, FunctionCfg>();
    m.set('A::a', cfg('a'));
    m.set('B::b', cfg('b'));
    const cg: CallGraphEdge[] = [{ callerQn: 'A::a', calleeQn: 'B::b', callLine: 1, argCount: 1 }];
    const r = new TaintPipeline().analyze(m, cg);
    expect(r.findings).toBeDefined();
  });

  it('handles circular call graph', () => {
    const m = new Map<string, FunctionCfg>();
    m.set('A::a', cfg('a'));
    m.set('B::b', cfg('b'));
    const cg: CallGraphEdge[] = [
      { callerQn: 'A::a', calleeQn: 'B::b', callLine: 1, argCount: 1 },
      { callerQn: 'B::b', calleeQn: 'A::a', callLine: 2, argCount: 1 },
    ];
    const r = new TaintPipeline().analyze(m, cg);
    expect(r.stats).toBeDefined();
  });
});
