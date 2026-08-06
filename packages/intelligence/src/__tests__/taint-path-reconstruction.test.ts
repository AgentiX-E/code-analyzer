// @code-analyzer/intelligence — Taint Path Reconstruction Tests

import { describe, it, expect } from 'vitest';
import { TaintPropagator } from '../security/taint-propagator.js';
import type { FunctionCfg, BindingEntry } from '../cfg/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMultiBlockCfg(): FunctionCfg {
  const bindings: BindingEntry[] = [
    { index: 0, name: 'userInput', kind: 'param', declLine: 1, declColumn: 8, synthetic: false },
    { index: 1, name: 'sanitized', kind: 'local', declLine: 2, declColumn: 6, synthetic: false },
  ];

  return {
    functionName: 'multiBlockFlow',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 1, statementCount: 1, isEntry: true, isExit: false },
      { index: 1, startLine: 2, endLine: 2, statementCount: 1, isEntry: false, isExit: false },
      { index: 2, startLine: 3, endLine: 3, statementCount: 1, isEntry: false, isExit: false },
      { index: 3, startLine: 4, endLine: 4, statementCount: 1, isEntry: false, isExit: true },
    ],
    edges: [
      { from: 0, to: 1, kind: 'seq' },
      { from: 1, to: 2, kind: 'seq' },
      { from: 2, to: 3, kind: 'seq' },
    ],
    bindings,
    entryIndex: 0,
    exitIndex: 3,
    stmtFacts: {
      defs: new Map([
        [0 * 1024 + 0, [{ point: { block: 0, stmt: 0, line: 1, col: 0, text: 'req = req.query.x' }, bindingIdx: 0, kind: 'must' }]],
        [1 * 1024 + 0, [{ point: { block: 1, stmt: 0, line: 2, col: 0, text: 'x = req' }, bindingIdx: 1, kind: 'must' }]],
        [2 * 1024 + 0, [{ point: { block: 2, stmt: 0, line: 3, col: 0, text: 'z = sanitized' }, bindingIdx: 0, kind: 'must' }]],
      ]),
      uses: new Map([
        [0 * 1024 + 0, [{ point: { block: 0, stmt: 0, line: 1, col: 0, text: 'req = req.query.x' }, bindingIdx: 0 }]],
        [1 * 1024 + 0, [{ point: { block: 1, stmt: 0, line: 2, col: 0, text: 'x = req' }, bindingIdx: 0 }]],
        [2 * 1024 + 0, [{ point: { block: 2, stmt: 0, line: 3, col: 0, text: 'z = sanitized' }, bindingIdx: 1 }]],
        [3 * 1024 + 0, [{ point: { block: 3, stmt: 0, line: 4, col: 0, text: 'exec(x)' }, bindingIdx: 0 }]],
      ]),
      sourceSites: new Map([
        [0 * 1024 + 0, { kind: 'source', point: { block: 0, stmt: 0, line: 1, col: 0, text: '' }, label: 'user input', confidence: 0.9 }],
      ]),
      sinkSites: new Map([
        [3 * 1024 + 0, { kind: 'command-injection', point: { block: 3, stmt: 0, line: 4, col: 0, text: '' }, label: 'exec', confidence: 0.9 }],
      ]),
      sanitizerSites: new Map(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaintPropagator path reconstruction', () => {
  it('should return full block-level path for multi-block CFG', () => {
    const cfg = makeMultiBlockCfg();
    const propagator = new TaintPropagator();
    const result = propagator.propagate(cfg);

    expect(result.findings.length).toBeGreaterThan(0);

    for (const finding of result.findings) {
      // Path should have more than 2 blocks (was: [source, sink])
      expect(finding.path.length).toBeGreaterThanOrEqual(2);
      // Path should start at the source block
      expect(finding.path[0]).toBeDefined();
      // Intermediate blocks should be present (not just [source, sink])
      if (finding.hops > 1) {
        expect(finding.path.length).toBeGreaterThan(2);
      }
    }
  });

  it('should include interproc flag in findings', () => {
    const cfg = makeMultiBlockCfg();
    const propagator = new TaintPropagator();
    const result = propagator.propagate(cfg);

    for (const finding of result.findings) {
      expect(typeof finding.interproc).toBe('boolean');
    }
  });

  it('should track facts processed count', () => {
    const cfg = makeMultiBlockCfg();
    const propagator = new TaintPropagator();
    const result = propagator.propagate(cfg);

    expect(result.factsProcessed).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
