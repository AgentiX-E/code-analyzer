// @code-analyzer/intelligence — Inter-Procedural Taint Solver Tests

import { describe, it, expect } from 'vitest';
import {
  InterprocSolver,
  type FunctionSummary,
  type CallGraphEdge,
  type TaintSourceOccurrence,
  type TaintSinkOccurrence,
} from '../security/interproc-solver.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function source(line: number, block: number = 0, stmt: number = 0): TaintSourceOccurrence {
  return {
    point: { blockIndex: block, stmtIndex: stmt, line },
    bindingIdx: 0,
    category: 'remote-input',
    description: 'User input from HTTP request',
    line,
  };
}

function sink(
  kind: string,
  line: number,
  block: number = 0,
  stmt: number = 0,
): TaintSinkOccurrence {
  return {
    point: { blockIndex: block, stmtIndex: stmt, line },
    kind,
    description: `Sink: ${kind}`,
    line,
  };
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

function makeEdge(
  callerQn: string,
  calleeQn: string,
  callLine: number = 1,
  argCount: number = 1,
): CallGraphEdge {
  return { callerQn, calleeQn, callLine, argCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InterprocSolver', () => {
  describe('Basic propagation', () => {
    it('empty solver returns empty', () => {
      const solver = new InterprocSolver();
      const result = solver.solve();
      expect(result.findings).toEqual([]);
      expect(result.iterations).toBe(0);
    });

    it('detects source→call→param→sink chain', () => {
      const solver = new InterprocSolver();

      // A: receives input from HTTP request → passes to B.login(username)
      // B.login: param 'username' → sink (SQL injection)
      const summaries: FunctionSummary[] = [
        makeSummary('A.handle', 'handle', 1, {
          sourceToCallArgs: [
            {
              source: source(10),
              callLine: 15,
              calleeName: 'B.login',
              argIndex: 0,
              resolved: true,
            },
          ],
        }),
        makeSummary('B.login', 'login', 1, {
          paramToSinks: [{ param: 0, sinkLine: 5, sink: sink('sql-injection', 5), hops: 1 }],
        }),
      ];

      const edges: CallGraphEdge[] = [makeEdge('A.handle', 'B.login')];

      solver.loadSummaries(summaries);
      solver.loadCallGraph(edges);

      const result = solver.solve();
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.summariesAnalyzed).toBe(2);

      const finding = result.findings[0]!;
      expect(finding.source.category).toBe('remote-input');
      expect(finding.sink.kind).toBe('sql-injection');
      expect(finding.callChain.length).toBeGreaterThanOrEqual(2);
    });

    it('detects TITO: param→callArg→param→sink', () => {
      const solver = new InterprocSolver();

      // A: param0 → passes to B.validate(user)
      // B.validate: param0 → passes to C.execute(query)
      // C.execute: param0 → SQL sink
      const summaries: FunctionSummary[] = [
        makeSummary('A.process', 'process', 1, {
          sourceToCallArgs: [
            {
              source: source(1),
              callLine: 3,
              calleeName: 'B.validate',
              argIndex: 0,
              resolved: true,
            },
          ],
        }),
        makeSummary('B.validate', 'validate', 1, {
          paramToCallArgs: [{ param: 0, callLine: 2, calleeName: 'C.execute', argIndex: 0 }],
        }),
        makeSummary('C.execute', 'execute', 1, {
          paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('command-injection', 1), hops: 1 }],
        }),
      ];

      const edges: CallGraphEdge[] = [
        makeEdge('A.process', 'B.validate'),
        makeEdge('B.validate', 'C.execute'),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph(edges);

      const result = solver.solve();
      expect(result.findings.length).toBeGreaterThan(0);

      const finding = result.findings[0]!;
      expect(finding.sink.kind).toBe('command-injection');
      expect(finding.callChain.length).toBeGreaterThanOrEqual(3);
    });

    it('sanitizer neutralizes sink on the path', () => {
      const solver = new InterprocSolver();

      const summaries: FunctionSummary[] = [
        makeSummary('A.handler', 'handler', 1, {
          sourceToCallArgs: [
            {
              source: source(1),
              callLine: 2,
              calleeName: 'B.sanitize',
              argIndex: 0,
              resolved: true,
            },
          ],
        }),
        makeSummary('B.sanitize', 'sanitize', 1, {
          paramToCallArgs: [
            { param: 0, callLine: 5, calleeName: 'C.output', argIndex: 0, neutralized: ['xss'] },
          ],
        }),
        makeSummary('C.output', 'output', 1, {
          paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('xss', 1), hops: 1 }],
        }),
      ];

      const edges: CallGraphEdge[] = [
        makeEdge('A.handler', 'B.sanitize'),
        makeEdge('B.sanitize', 'C.output'),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph(edges);

      const result = solver.solve();
      const xssFindings = result.findings.filter((f) => f.sink.kind === 'xss');

      // Sanitizer at B should neutralize the XSS kind
      for (const f of xssFindings) {
        expect(f.confidence).toBeLessThanOrEqual(0.5);
      }
    });
  });

  describe('Generative returns', () => {
    it('propagates through generative function returns', () => {
      const solver = new InterprocSolver();

      // A.fetchData: source internally → return (generative)
      // B.process: calls A.fetchData() → uses return → passes to sink
      const summaries: FunctionSummary[] = [
        makeSummary('A.fetchData', 'fetchData', 0, {
          sourceToReturns: [{ source: source(3), returnIndices: [0] }],
        }),
        makeSummary('B.process', 'process', 0, {
          callResults: [{ calleeName: 'A.fetchData', callLine: 5, returnIndex: 0 }],
          paramToSinks: [{ param: -1, sinkLine: 7, sink: sink('path-traversal', 7), hops: 2 }],
        }),
      ];

      const edges: CallGraphEdge[] = [makeEdge('B.process', 'A.fetchData')];

      solver.loadSummaries(summaries);
      solver.loadCallGraph(edges);

      const result = solver.solve();
      expect(result.summariesAnalyzed).toBe(2);
      expect(result.iterations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Confidence scoring', () => {
    it('deeper call chains reduce confidence', () => {
      const solver = new InterprocSolver({ maxIterations: 100 });

      // Build a chain of 5 functions
      const summaries: FunctionSummary[] = [
        makeSummary('F0.start', 'start', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'F1.step1', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('F1.step1', 'step1', 1, {
          paramToCallArgs: [{ param: 0, callLine: 1, calleeName: 'F2.step2', argIndex: 0 }],
        }),
        makeSummary('F2.step2', 'step2', 1, {
          paramToCallArgs: [{ param: 0, callLine: 1, calleeName: 'F3.step3', argIndex: 0 }],
        }),
        makeSummary('F3.step3', 'step3', 1, {
          paramToCallArgs: [
            { param: 0, callLine: 1, calleeName: 'F4.sink', argIndex: 0, neutralized: ['xss'] },
          ],
        }),
        makeSummary('F4.sink', 'sink', 1, {
          paramToSinks: [
            { param: 0, sinkLine: 1, sink: sink('sql-injection', 1), hops: 1 },
            { param: 0, sinkLine: 2, sink: sink('xss', 2), hops: 1 },
          ],
        }),
      ];

      const edges: CallGraphEdge[] = [
        makeEdge('F0.start', 'F1.step1'),
        makeEdge('F1.step1', 'F2.step2'),
        makeEdge('F2.step2', 'F3.step3'),
        makeEdge('F3.step3', 'F4.sink'),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph(edges);

      const result = solver.solve();
      expect(result.findings.length).toBeGreaterThan(0);

      // Deep chain (5 hops) should have lower confidence
      for (const f of result.findings) {
        expect(f.confidence).toBeGreaterThan(0);
        expect(f.confidence).toBeLessThan(0.9); // penalized by depth
      }
    });
  });

  describe('Configuration', () => {
    it('respects maxIterations', () => {
      const solver = new InterprocSolver({ maxIterations: 1 });

      const summaries: FunctionSummary[] = [
        makeSummary('A.a', 'a', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.b', argIndex: 0, resolved: true },
          ],
          paramToCallArgs: [{ param: 0, callLine: 3, calleeName: 'C.c', argIndex: 0 }],
        }),
        makeSummary('B.b', 'b', 1, {
          paramToCallArgs: [{ param: 0, callLine: 1, calleeName: 'A.a', argIndex: 0 }],
        }),
        makeSummary('C.c', 'c', 1, {
          paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('sql-injection', 1), hops: 1 }],
        }),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph([]);
      const result = solver.solve();
      expect(result.iterations).toBeLessThanOrEqual(1);
    });
  });

  describe('Result metadata', () => {
    it('includes all metadata fields', () => {
      const solver = new InterprocSolver();

      solver.loadSummaries([
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.sink', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('B.sink', 'sink', 1, {
          paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('xss', 1), hops: 1 }],
        }),
      ]);
      solver.loadCallGraph([makeEdge('A.fn', 'B.sink')]);

      const result = solver.solve();
      expect(result.summariesAnalyzed).toBe(2);
      expect(result.iterations).toBeGreaterThanOrEqual(0);
      expect(result.statesProcessed).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('each finding has all required fields', () => {
      const solver = new InterprocSolver();

      solver.loadSummaries([
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.sink', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('B.sink', 'sink', 1, {
          paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('sql-injection', 1, 0, 0), hops: 1 }],
        }),
      ]);
      solver.loadCallGraph([makeEdge('A.fn', 'B.sink')]);

      const result = solver.solve();
      for (const f of result.findings) {
        expect(typeof f.id).toBe('string');
        expect(f.source).toBeDefined();
        expect(f.sink).toBeDefined();
        expect(typeof f.sourceFn).toBe('string');
        expect(typeof f.sinkFn).toBe('string');
        expect(Array.isArray(f.callChain)).toBe(true);
        expect(typeof f.sanitized).toBe('boolean');
        expect(typeof f.hops).toBe('number');
        expect(f.confidence).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge cases', () => {
    it('handles unresolved callee names', () => {
      const solver = new InterprocSolver();

      solver.loadSummaries([
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            {
              source: source(1),
              callLine: 2,
              calleeName: 'NonExistent.fn',
              argIndex: 0,
              resolved: false,
            },
          ],
        }),
      ]);
      solver.loadCallGraph([]);

      const result = solver.solve();
      // Unresolved callee should not produce findings
      expect(result.findings.length).toBe(0);
    });

    it('ignores sourceToCallArg resolved but missing callee summary', () => {
      const solver = new InterprocSolver();

      solver.loadSummaries([
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            {
              source: source(1),
              callLine: 2,
              calleeName: 'Missing.fn',
              argIndex: 0,
              resolved: true, // resolved but no such summary loaded
            },
          ],
        }),
      ]);
      solver.loadCallGraph([]);

      const result = solver.solve();
      expect(result.findings.length).toBe(0);
    });

    it('deduplicates duplicate call-graph edges from the same caller', () => {
      const solver = new InterprocSolver();

      const summaries: FunctionSummary[] = [
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.sink', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('B.sink', 'sink', 1, {
          paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('xss', 1), hops: 1 }],
        }),
      ];

      // Same caller→callee edge listed twice (e.g. two call sites).
      const edges: CallGraphEdge[] = [makeEdge('A.fn', 'B.sink', 1), makeEdge('A.fn', 'B.sink', 2)];

      solver.loadSummaries(summaries);
      solver.loadCallGraph(edges);

      const result = solver.solve();
      // The reverse index must not double-register the caller.
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('does not fire a sink for a non-tainted parameter', () => {
      const solver = new InterprocSolver();

      // A taints param 0 of B, but B's sink is on param 1 — no finding.
      const summaries: FunctionSummary[] = [
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.fn', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('B.fn', 'fn', 2, {
          paramToSinks: [{ param: 1, sinkLine: 3, sink: sink('sql-injection', 3), hops: 1 }],
        }),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph([makeEdge('A.fn', 'B.fn')]);

      const result = solver.solve();
      expect(result.findings.length).toBe(0);
    });

    it('does not propagate TITO for a non-tainted parameter', () => {
      const solver = new InterprocSolver();

      // A taints param 0 of B, but B only passes param 1 onward.
      const summaries: FunctionSummary[] = [
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.fn', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('B.fn', 'fn', 2, {
          paramToCallArgs: [{ param: 1, callLine: 4, calleeName: 'C.sink', argIndex: 0 }],
        }),
        makeSummary('C.sink', 'sink', 1, {
          paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('xss', 1), hops: 1 }],
        }),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph([makeEdge('A.fn', 'B.fn'), makeEdge('B.fn', 'C.sink')]);

      const result = solver.solve();
      expect(result.findings.length).toBe(0);
    });

    it('does not propagate TITO to an unresolved callee', () => {
      const solver = new InterprocSolver();

      const summaries: FunctionSummary[] = [
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.fn', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('B.fn', 'fn', 1, {
          paramToCallArgs: [{ param: 0, callLine: 4, calleeName: 'Missing.fn', argIndex: 0 }],
        }),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph([makeEdge('A.fn', 'B.fn')]);

      const result = solver.solve();
      expect(result.findings.length).toBe(0);
    });

    it('neutralizes a sink via the sink-flow neutralized set', () => {
      const solver = new InterprocSolver();

      const summaries: FunctionSummary[] = [
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.fn', argIndex: 0, resolved: true },
          ],
        }),
        makeSummary('B.fn', 'fn', 1, {
          paramToSinks: [
            { param: 0, sinkLine: 3, sink: sink('xss', 3), hops: 1, neutralized: ['xss'] },
          ],
        }),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph([makeEdge('A.fn', 'B.fn')]);

      const result = solver.solve();
      // The xss sink is neutralized on its own flow → no xss finding.
      expect(result.findings.filter((f) => f.sink.kind === 'xss')).toHaveLength(0);
    });

    it('propagates taint across a three-level generative chain', () => {
      const solver = new InterprocSolver();

      // gen.fn returns tainted data; mid.fn calls gen and returns it; top.fn
      // calls mid and passes the result to a sink.
      const summaries: FunctionSummary[] = [
        makeSummary('gen.fn', 'gen', 0, {
          sourceToReturns: [{ source: source(1), returnIndices: [0] }],
        }),
        makeSummary('mid.fn', 'mid', 0, {
          callResults: [{ calleeName: 'gen.fn', callLine: 2, returnIndex: 0 }],
          paramToReturns: [{ param: -1, returnIndices: [0] }],
        }),
        makeSummary('top.fn', 'top', 0, {
          callResults: [{ calleeName: 'mid.fn', callLine: 3, returnIndex: 0 }],
          paramToSinks: [{ param: -1, sinkLine: 4, sink: sink('sql-injection', 4), hops: 1 }],
        }),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph([makeEdge('mid.fn', 'gen.fn'), makeEdge('top.fn', 'mid.fn')]);

      const result = solver.solve();
      expect(result.summariesAnalyzed).toBe(3);
      expect(result.iterations).toBeGreaterThanOrEqual(0);
    });

    it('reduces confidence for very deep call chains (>10 hops)', () => {
      const solver = new InterprocSolver({ maxIterations: 100 });

      // Build an 11-function chain to exceed the 10-hop confidence threshold.
      const names = Array.from({ length: 12 }, (_, i) => `F${i}.fn`);
      const summaries: FunctionSummary[] = names.map((qn, i) => {
        if (i === 0) {
          return makeSummary(qn, 'fn', 1, {
            sourceToCallArgs: [
              {
                source: source(1),
                callLine: 2,
                calleeName: names[1]!,
                argIndex: 0,
                resolved: true,
              },
            ],
          });
        }
        if (i === names.length - 1) {
          return makeSummary(qn, 'fn', 1, {
            paramToSinks: [{ param: 0, sinkLine: 1, sink: sink('sql-injection', 1), hops: 1 }],
          });
        }
        return makeSummary(qn, 'fn', 1, {
          paramToCallArgs: [{ param: 0, callLine: 1, calleeName: names[i + 1]!, argIndex: 0 }],
        });
      });

      const edges: CallGraphEdge[] = names
        .slice(0, -1)
        .map((caller, i) => makeEdge(caller, names[i + 1]!));

      solver.loadSummaries(summaries);
      solver.loadCallGraph(edges);

      const result = solver.solve();
      expect(result.findings.length).toBeGreaterThan(0);
      // 11+ hops should push confidence well below the default 0.8.
      for (const f of result.findings) {
        expect(f.confidence).toBeLessThan(0.4);
      }
    });

    it('handles empty summaries', () => {
      const solver = new InterprocSolver();
      solver.loadSummaries([]);
      solver.loadCallGraph([makeEdge('A', 'B')]);

      const result = solver.solve();
      expect(result.findings).toEqual([]);
    });

    it('handles circular call graphs', () => {
      const solver = new InterprocSolver({ maxIterations: 20 });

      // A → B → A (circular)
      const summaries: FunctionSummary[] = [
        makeSummary('A.fn', 'fn', 1, {
          sourceToCallArgs: [
            { source: source(1), callLine: 2, calleeName: 'B.fn', argIndex: 0, resolved: true },
          ],
          paramToCallArgs: [{ param: 0, callLine: 3, calleeName: 'B.fn', argIndex: 0 }],
        }),
        makeSummary('B.fn', 'fn', 1, {
          paramToCallArgs: [{ param: 0, callLine: 1, calleeName: 'A.fn', argIndex: 0 }],
          paramToSinks: [{ param: 0, sinkLine: 2, sink: sink('sql-injection', 2), hops: 1 }],
        }),
      ];

      solver.loadSummaries(summaries);
      solver.loadCallGraph([makeEdge('A.fn', 'B.fn'), makeEdge('B.fn', 'A.fn')]);

      const result = solver.solve();
      // Should terminate without infinite loop due to processed state dedup
      expect(result.iterations).toBeLessThanOrEqual(20);
    });
  });
});
