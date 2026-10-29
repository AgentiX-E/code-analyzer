// Reachability, from the propagator's side of the contract.
//
// **The property is narrow on purpose**: a definition whose value the file's arithmetic decides does not carry taint,
// and a line a constant condition closes is not read. Everything else about the analysis stays as it was, which is why
// each case below is paired with the same CFG *without* the facts and shown to report the flow.

import { describe, expect, it } from 'vitest';

import { TaintPropagator } from '../security/taint-propagator.js';

import type { DefUseFact, FunctionCfg, StatementFacts } from '../cfg/types.js';

/**
 * `param` on line 2, `bar` written on line 3 from it, a sink reading `bar` on line 4.
 *
 * One block, so the only thing deciding the outcome is the reachability facts - which is what makes it a test of them
 * rather than of block layout.
 */
function linearCfg(extra: Partial<StatementFacts> = {}): FunctionCfg {
  const defs = new Map([
    [1, [{ point: { blockIndex: 0, stmtIndex: 1, line: 2 }, bindingIdx: 0, kind: 'may' as const }]],
    [2, [{ point: { blockIndex: 0, stmtIndex: 2, line: 3 }, bindingIdx: 1, kind: 'may' as const }]],
  ]);

  return {
    functionName: 'handle',
    filePath: 'T.java',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 5, statementCount: 5, isEntry: true, isExit: true },
    ],
    edges: [],
    bindings: [
      { index: 0, name: 'param', kind: 'local', declLine: 2, declColumn: 0, synthetic: false },
      { index: 1, name: 'bar', kind: 'local', declLine: 3, declColumn: 0, synthetic: false },
    ],
    stmtFacts: {
      defs,
      uses: new Map([[2, [{ point: { blockIndex: 0, stmtIndex: 2, line: 3 }, bindingIdx: 0 }]]]),
      sourceSites: new Map([
        [
          1,
          {
            bindingIdx: 0,
            point: { blockIndex: 0, stmtIndex: 1, line: 2 },
            category: 'remote-input',
            description: 'request.getParameter',
            line: 2,
          },
        ],
      ]),
      sinkSites: new Map([
        [
          3,
          {
            point: { blockIndex: 0, stmtIndex: 3, line: 4 },
            kind: 'html',
            description: 'getWriter().println',
            line: 4,
          },
        ],
      ]),
      sanitizerSites: new Map(),
      ...extra,
    },
    entryIndex: 0,
    exitIndex: 0,
  };
}

/** `param` reaches the statement that writes `bar`, and `bar` reaches the sink. */
const FACTS: DefUseFact[] = [
  {
    bindingIdx: 0,
    def: { blockIndex: 0, stmtIndex: 1, line: 2 },
    use: { blockIndex: 0, stmtIndex: 2, line: 3 },
    bindingName: 'param',
  },
  {
    bindingIdx: 1,
    def: { blockIndex: 0, stmtIndex: 2, line: 3 },
    use: { blockIndex: 0, stmtIndex: 3, line: 4 },
    bindingName: 'bar',
  },
];

describe('a definition that folds to a constant carries no taint', () => {
  it('reports the flow when nothing says what the definition holds', () => {
    const result = new TaintPropagator().analyze(linearCfg(), FACTS);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.sanitized).toBe(false);
  });

  it('reports nothing when the definition is a constant', () => {
    const cfg = linearCfg({ constantDefs: new Map([[2, new Set([1])]]) });
    const result = new TaintPropagator().analyze(cfg, FACTS);
    // **The flow ends at the definition, not at the sink** — there is no state left for the sink statement to receive.
    expect(result.findings).toHaveLength(0);
  });

  it('still reports when the constant is a different binding on the same statement', () => {
    // A statement can write two names; only the one that folds is suppressed.
    const cfg = linearCfg({ constantDefs: new Map([[2, new Set([0])]]) });
    const result = new TaintPropagator().analyze(cfg, FACTS);
    expect(result.findings).toHaveLength(1);
  });

  it('does not seed a source whose own definition folds', () => {
    const cfg = linearCfg({ constantDefs: new Map([[1, new Set([0])]]) });
    const result = new TaintPropagator().analyze(cfg, FACTS);
    expect(result.findings).toHaveLength(0);
  });
});

describe('a line a constant condition closes is not read', () => {
  it('ignores a source on a dead line', () => {
    const cfg = linearCfg({ unreachableLines: new Set([2]) });
    const result = new TaintPropagator().analyze(cfg, FACTS);
    expect(result.findings).toHaveLength(0);
  });

  it('ignores a use on a dead line', () => {
    const cfg = linearCfg({ unreachableLines: new Set([3]) });
    const result = new TaintPropagator().analyze(cfg, FACTS);
    expect(result.findings).toHaveLength(0);
  });

  it('leaves a reachable line alone when a different one is dead', () => {
    const cfg = linearCfg({ unreachableLines: new Set([99]) });
    const result = new TaintPropagator().analyze(cfg, FACTS);
    expect(result.findings).toHaveLength(1);
  });
});

describe('the two facts together', () => {
  it('suppresses a flow that both a constant definition and a dead line describe', () => {
    const cfg = linearCfg({
      constantDefs: new Map([[2, new Set([1])]]),
      unreachableLines: new Set([2, 3]),
    });
    expect(new TaintPropagator().analyze(cfg, FACTS).findings).toHaveLength(0);
  });
});
