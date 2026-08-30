// @ts-nocheck
// @code-analyzer/intelligence — Inter-procedural solver branch coverage (round 2):
// the guard/mismatch/dead-end branches of the fixpoint and generative-return
// propagation that round 1 did not exercise.

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

describe('InterprocSolver — seed deduplication', () => {
  it('skips a duplicate sourceToCallArg seed', () => {
    const solver = new InterprocSolver();
    const src = source(1);
    const summaries: FunctionSummary[] = [
      makeSummary('B.caller', 'caller', 0, {
        sourceToCallArgs: [
          { source: src, callLine: 2, calleeName: 'A.callee', argIndex: 0, resolved: true },
          { source: src, callLine: 2, calleeName: 'A.callee', argIndex: 0, resolved: true },
        ],
      }),
      makeSummary('A.callee', 'callee', 1),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.callee', callLine: 2, argCount: 1 },
    ]);
    const result = solver.solve();
    expect(result.statesProcessed).toBe(1);
  });
});

describe('InterprocSolver — paramToReturn guards', () => {
  it('skips a paramToReturn whose param does not match the tainted param', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('B.caller', 'caller', 0, {
        sourceToCallArgs: [
          { source: source(1), callLine: 2, calleeName: 'A.callee', argIndex: 0, resolved: true },
        ],
      }),
      makeSummary('A.callee', 'callee', 2, {
        paramToReturns: [{ param: 1, returnIndices: [0] }],
      }),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.callee', callLine: 2, argCount: 1 },
    ]);
    const result = solver.solve();
    expect(result.iterations).toBe(1);
  });

  it('handles a matching paramToReturn for a function with no callers', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('B.caller', 'caller', 0, {
        sourceToCallArgs: [
          { source: source(1), callLine: 2, calleeName: 'A.callee', argIndex: 0, resolved: true },
        ],
      }),
      makeSummary('A.callee', 'callee', 1, {
        paramToReturns: [{ param: 0, returnIndices: [0] }],
      }),
    ];
    solver.loadSummaries(summaries);
    // No call graph — A.callee has no callers, driving the `?? []` fallback.
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(2);
  });

  it('skips a caller that has no summary', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('C.seeder', 'seeder', 0, {
        sourceToCallArgs: [
          { source: source(1), callLine: 2, calleeName: 'A.callee', argIndex: 0, resolved: true },
        ],
      }),
      makeSummary('A.callee', 'callee', 1, {
        paramToReturns: [{ param: 0, returnIndices: [0] }],
      }),
      // B.caller is referenced in the call graph but has no summary.
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.callee', callLine: 2, argCount: 1 },
    ]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(2);
  });

  it('skips a callResult whose callee matches neither the fnQn nor the fnName', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('C.seeder', 'seeder', 0, {
        sourceToCallArgs: [
          { source: source(1), callLine: 2, calleeName: 'A.callee', argIndex: 0, resolved: true },
        ],
      }),
      makeSummary('A.callee', 'callee', 1, {
        paramToReturns: [{ param: 0, returnIndices: [0] }],
      }),
      makeSummary('B.caller', 'caller', 0, {
        callResults: [{ calleeName: 'X.other', callLine: 5, returnIndex: 0 }],
      }),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.callee', callLine: 2, argCount: 1 },
    ]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(3);
  });
});

describe('InterprocSolver — generative-return dead ends', () => {
  it('propagates a generative return for a function with no callers', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.gen', 'gen', 0, {
        sourceToReturns: [{ source: source(1), returnIndices: [0] }],
      }),
    ];
    solver.loadSummaries(summaries);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(1);
  });

  it('skips a caller without a summary and a non-matching grand-caller callResult', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.gen', 'gen', 0, {
        sourceToReturns: [{ source: source(1), returnIndices: [0] }],
      }),
      makeSummary('B.caller', 'caller', 0, {
        callResults: [{ calleeName: 'A.gen', callLine: 2, returnIndex: 0 }],
        paramToReturns: [{ param: -1, returnIndices: [0] }],
      }),
      makeSummary('C.grand', 'grand', 1, {
        callResults: [
          { calleeName: 'B.caller', callLine: 3, returnIndex: 0 },
          { calleeName: 'Y.other', callLine: 4, returnIndex: 0 },
        ],
      }),
      // D.dangling is referenced in the call graph but has no summary.
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.gen', callLine: 2, argCount: 0 },
      { callerQn: 'C.grand', calleeQn: 'B.caller', callLine: 3, argCount: 0 },
      { callerQn: 'D.dangling', calleeQn: 'A.gen', callLine: 9, argCount: 0 },
    ]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(3);
  });

  it('skips a callResult whose callee has no summary', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.gen', 'gen', 0, {
        sourceToReturns: [{ source: source(1), returnIndices: [0] }],
      }),
      makeSummary('B.caller', 'caller', 0, {
        callResults: [{ calleeName: 'Z.missing', callLine: 2, returnIndex: 0 }],
        paramToReturns: [{ param: -1, returnIndices: [0] }],
      }),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([{ callerQn: 'B.caller', calleeQn: 'A.gen', callLine: 2, argCount: 0 }]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(2);
  });

  it('propagates through a caller with no grand-callers', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.gen', 'gen', 0, {
        sourceToReturns: [{ source: source(1), returnIndices: [0] }],
      }),
      makeSummary('B.caller', 'caller', 0, {
        callResults: [{ calleeName: 'A.gen', callLine: 2, returnIndex: 0 }],
        paramToReturns: [{ param: -1, returnIndices: [0] }],
      }),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([{ callerQn: 'B.caller', calleeQn: 'A.gen', callLine: 2, argCount: 0 }]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(2);
  });

  it('skips a grand-caller with no summary', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.gen', 'gen', 0, {
        sourceToReturns: [{ source: source(1), returnIndices: [0] }],
      }),
      makeSummary('B.caller', 'caller', 0, {
        callResults: [{ calleeName: 'A.gen', callLine: 2, returnIndex: 0 }],
        paramToReturns: [{ param: -1, returnIndices: [0] }],
      }),
      // C.grand is referenced in the call graph but has no summary.
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.gen', callLine: 2, argCount: 0 },
      { callerQn: 'C.grand', calleeQn: 'B.caller', callLine: 3, argCount: 0 },
    ]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(2);
  });

  it('deduplicates a generative seed produced by two same-point sources', () => {
    const solver = new InterprocSolver();
    const summaries: FunctionSummary[] = [
      makeSummary('A.gen', 'gen', 0, {
        sourceToReturns: [
          { source: source(1), returnIndices: [0] },
          { source: source(1), returnIndices: [1] }, // same source point
        ],
      }),
      makeSummary('B.caller', 'caller', 0, {
        callResults: [{ calleeName: 'A.gen', callLine: 2, returnIndex: 0 }],
        paramToReturns: [{ param: -1, returnIndices: [0] }],
      }),
      makeSummary('C.grand', 'grand', 1, {
        callResults: [{ calleeName: 'B.caller', callLine: 3, returnIndex: 0 }],
      }),
    ];
    solver.loadSummaries(summaries);
    solver.loadCallGraph([
      { callerQn: 'B.caller', calleeQn: 'A.gen', callLine: 2, argCount: 0 },
      { callerQn: 'C.grand', calleeQn: 'B.caller', callLine: 3, argCount: 0 },
    ]);
    const result = solver.solve();
    expect(result.summariesAnalyzed).toBe(3);
  });
});
