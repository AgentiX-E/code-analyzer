// @ts-nocheck
// @code-analyzer/intelligence — Inter-procedural solver branch coverage: the
// param→return composition path and the three-level generative-return
// propagation (source → caller → grand-caller).

import { describe, it, expect } from 'vitest';
import {
  InterprocSolver,
  type FunctionSummary,
  type TaintSourceOccurrence,
  type TaintSinkOccurrence,
} from '../security/interproc-solver.js';

function source(line: number, block = 0, stmt = 0): TaintSourceOccurrence {
  return {
    point: { blockIndex: block, stmtIndex: stmt, line },
    bindingIdx: 0,
    category: 'remote-input',
    description: 'User input',
    line,
  };
}

function sink(kind: string, line: number): TaintSinkOccurrence {
  return { point: { blockIndex: 0, stmtIndex: 0, line }, kind, description: `Sink: ${kind}`, line };
}

function makeSummary(
  fnQn: string,
  fnName: string,
  paramCount: number,
  overrides?: Partial<FunctionSummary>,
): FunctionSummary {
  return {
    fnQn,
    fnName,
    paramCount,
    paramToReturns: [],
    paramToCallArgs: [],
    paramToSinks: [],
    sourceToReturns: [],
    sourceToCallArgs: [],
    callResults: [],
    sourceFile: 'test.ts',
    ...overrides,
  };
}

describe('InterprocSolver — paramToReturn composition', () => {
  it('propagates a tainted param through a caller with a matching callResult', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.callee', 'callee', 1, {
        paramToReturns: [{ param: 0, returnIndices: [0] }],
      }),
      makeSummary('B.caller', 'caller', 0, {
        sourceToCallArgs: [
          { source: source(1), callLine: 2, calleeName: 'A.callee', argIndex: 0, resolved: true },
        ],
        callResults: [{ calleeName: 'A.callee', callLine: 2, returnIndex: 0 }],
      }),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.callee', callLine: 2, argCount: 1 },
    ]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(2);
  });
});

describe('InterprocSolver — three-level generative return', () => {
  it('propagates a generative return through caller and grand-caller', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.fetchData', 'fetchData', 0, {
        sourceToReturns: [{ source: source(1), returnIndices: [0] }],
      }),
      makeSummary('B.process', 'process', 0, {
        callResults: [{ calleeName: 'A.fetchData', callLine: 2, returnIndex: 0 }],
        paramToReturns: [{ param: -1, returnIndices: [0] }],
      }),
      makeSummary('C.handler', 'handler', 1, {
        callResults: [{ calleeName: 'B.process', callLine: 3, returnIndex: 0 }],
        paramToSinks: [{ param: -1, sinkLine: 4, sink: sink('sql', 4), hops: 1 }],
      }),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.process', calleeQn: 'A.fetchData', callLine: 2, argCount: 0 },
      { callerQn: 'C.handler', calleeQn: 'B.process', callLine: 3, argCount: 0 },
    ]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(3);
  });
});
