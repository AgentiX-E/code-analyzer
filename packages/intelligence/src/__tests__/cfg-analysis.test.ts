// @code-analyzer/intelligence — CFG Analysis Tests
// Comprehensive tests for post-dominators, control dependence, and reaching definitions.

import { describe, it, expect } from 'vitest';
import { computePostDominators, postDominates, NO_IPDOM } from '../cfg/post-dominators.js';
import { computeControlDependence } from '../cfg/control-dependence.js';
import { computeReachingDefinitions } from '../cfg/reaching-defs.js';
import type {
  FunctionCfg,
  BasicBlock,
  CfgEdge,
  BindingEntry,
  StatementFacts,
} from '../cfg/types.js';

// ---------------------------------------------------------------------------
// Test Fixtures — CFG Builders
// ---------------------------------------------------------------------------

/** Build a simple linear CFG: entry → A → B → exit */
function buildLinearCfg(blocks: number): FunctionCfg {
  const cfgBlocks: BasicBlock[] = [];
  const cfgEdges: CfgEdge[] = [];

  for (let i = 0; i < blocks; i++) {
    cfgBlocks.push({
      index: i,
      startLine: i * 10 + 1,
      endLine: i * 10 + 5,
      statementCount: 3,
      isEntry: i === 0,
      isExit: i === blocks - 1,
    });
    if (i < blocks - 1) {
      cfgEdges.push({ from: i, to: i + 1, kind: 'seq' });
    }
  }

  return {
    functionName: `linear${blocks}`,
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks: cfgBlocks,
    edges: cfgEdges,
    bindings: [],
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
    entryIndex: 0,
    exitIndex: blocks - 1,
  };
}

/** Build a simple if-then-else CFG:
 *  B0(entry) → cond-true→B1(then) → B3(exit)
 *             → cond-false→B2(else) → B3(exit)
 */
function buildIfElseCfg(): FunctionCfg {
  const blocks: BasicBlock[] = [
    { index: 0, startLine: 1, endLine: 3, statementCount: 2, isEntry: true, isExit: false },
    { index: 1, startLine: 5, endLine: 7, statementCount: 2, isEntry: false, isExit: false },
    { index: 2, startLine: 9, endLine: 11, statementCount: 2, isEntry: false, isExit: false },
    { index: 3, startLine: 13, endLine: 15, statementCount: 2, isEntry: false, isExit: true },
  ];

  const edges: CfgEdge[] = [
    { from: 0, to: 1, kind: 'cond-true' },
    { from: 0, to: 2, kind: 'cond-false' },
    { from: 1, to: 3, kind: 'seq' },
    { from: 2, to: 3, kind: 'seq' },
  ];

  const defs = new Map();
  const uses = new Map();

  // B0: def param 'x', use param 'x' for comparison
  defs.set(0 * 1024 + 0, [
    { point: { blockIndex: 0, stmtIndex: 0, line: 1 }, bindingIdx: 0, kind: 'must' },
  ]);
  uses.set(0 * 1024 + 1, [{ point: { blockIndex: 0, stmtIndex: 1, line: 2 }, bindingIdx: 0 }]);
  // B1: def temp 'y'
  defs.set(1 * 1024 + 0, [
    { point: { blockIndex: 1, stmtIndex: 0, line: 5 }, bindingIdx: 1, kind: 'must' },
  ]);
  // B2: def temp 'z'
  defs.set(2 * 1024 + 0, [
    { point: { blockIndex: 2, stmtIndex: 0, line: 9 }, bindingIdx: 2, kind: 'must' },
  ]);

  const stmtFacts: StatementFacts = {
    defs,
    uses,
    sourceSites: new Map(),
    sinkSites: new Map(),
    sanitizerSites: new Map(),
  };

  return {
    functionName: 'ifElse',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges,
    bindings: [
      { index: 0, name: 'x', kind: 'param', declLine: 1, declColumn: 15, synthetic: false },
      { index: 1, name: 'y', kind: 'local', declLine: 5, declColumn: 7, synthetic: false },
      { index: 2, name: 'z', kind: 'local', declLine: 9, declColumn: 7, synthetic: false },
    ],
    stmtFacts,
    entryIndex: 0,
    exitIndex: 3,
  };
}

/** Build a loop CFG:
 *  B0(entry) → B1(loop header) → cond-true→B2(body) → loop-back→B1
 *                                → cond-false→B3(exit)
 */
function buildLoopCfg(): FunctionCfg {
  const blocks: BasicBlock[] = [
    { index: 0, startLine: 1, endLine: 3, statementCount: 2, isEntry: true, isExit: false },
    { index: 1, startLine: 5, endLine: 7, statementCount: 2, isEntry: false, isExit: false },
    { index: 2, startLine: 9, endLine: 11, statementCount: 2, isEntry: false, isExit: false },
    { index: 3, startLine: 13, endLine: 15, statementCount: 2, isEntry: false, isExit: true },
  ];

  const edges: CfgEdge[] = [
    { from: 0, to: 1, kind: 'seq' },
    { from: 1, to: 2, kind: 'cond-true' },
    { from: 1, to: 3, kind: 'cond-false' },
    { from: 2, to: 1, kind: 'loop-back' },
  ];

  const defs = new Map();
  const uses = new Map();
  // B0: def 'i' = 0
  defs.set(0 * 1024 + 0, [
    { point: { blockIndex: 0, stmtIndex: 0, line: 1 }, bindingIdx: 0, kind: 'must' },
  ]);
  // B1: use 'i' in condition
  uses.set(1 * 1024 + 0, [{ point: { blockIndex: 1, stmtIndex: 0, line: 5 }, bindingIdx: 0 }]);
  // B2: def 'i' = i + 1 (MUST-def, killing)
  defs.set(2 * 1024 + 0, [
    { point: { blockIndex: 2, stmtIndex: 0, line: 9 }, bindingIdx: 0, kind: 'must' },
  ]);

  const stmtFacts: StatementFacts = {
    defs,
    uses,
    sourceSites: new Map(),
    sinkSites: new Map(),
    sanitizerSites: new Map(),
  };

  return {
    functionName: 'loop',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges,
    bindings: [
      { index: 0, name: 'i', kind: 'local', declLine: 1, declColumn: 7, synthetic: false },
    ],
    stmtFacts,
    entryIndex: 0,
    exitIndex: 3,
  };
}

// ---------------------------------------------------------------------------
// Post-dominators Tests
// ---------------------------------------------------------------------------

describe('computePostDominators', () => {
  it('handles empty CFG', () => {
    const empty: FunctionCfg = {
      functionName: 'empty',
      filePath: 'test.ts',
      startLine: 1,
      startColumn: 1,
      blocks: [],
      edges: [],
      bindings: [],
      stmtFacts: {
        defs: new Map(),
        uses: new Map(),
        sourceSites: new Map(),
        sinkSites: new Map(),
        sanitizerSites: new Map(),
      },
      entryIndex: 0,
      exitIndex: -1,
    };
    const tree = computePostDominators(empty);
    expect(tree.ipdom).toEqual([]);
  });

  it('computes post-dominators for linear CFG', () => {
    // Blocks: 0 → 1 → 2 → 3 (exit)
    // Post-dom: 2 post-dominates 0,1,2; 1 post-dominates 0,1
    const cfg = buildLinearCfg(4);
    const tree = computePostDominators(cfg);

    // In a linear chain 0→1→2→3(exit):
    // ipdom[0] = 1, ipdom[1] = 2, ipdom[2] = 3, ipdom[3] = -1
    expect(tree.ipdom[0]).toBe(1);
    expect(tree.ipdom[1]).toBe(2);
    expect(tree.ipdom[2]).toBe(3);
    expect(tree.ipdom[3]).toBe(NO_IPDOM);
  });

  it('computes post-dominators for if-else CFG', () => {
    const cfg = buildIfElseCfg();
    const tree = computePostDominators(cfg);

    // B0 post-dominates nothing (can go either B1 or B2)
    // B3(exit): ipdom = -1
    // B1 → B3(seq), B2 → B3(seq)
    // ipdom[1] = 3, ipdom[2] = 3
    // B0 has two paths to exit: through B1 or B2, only B3 post-dominates B0
    expect(tree.ipdom[3]).toBe(NO_IPDOM);
    expect(tree.ipdom[1]).toBe(3);
    expect(tree.ipdom[2]).toBe(3);
    // B0's immediate post-dominator is B3 (since B3 is the first point where all paths converge)
    expect(tree.ipdom[0]).toBe(3);
  });

  it('postDominates check works correctly', () => {
    const cfg = buildLinearCfg(4);
    const tree = computePostDominators(cfg);

    // In linear: 3 post-dominates everything, 2 post-dominates 0,1,2
    expect(postDominates(tree, 3, 0)).toBe(true);
    expect(postDominates(tree, 3, 1)).toBe(true);
    expect(postDominates(tree, 3, 2)).toBe(true);
    expect(postDominates(tree, 2, 0)).toBe(true);
    expect(postDominates(tree, 2, 1)).toBe(true);
    expect(postDominates(tree, 1, 0)).toBe(true);
    // 1 does NOT post-dominate 2
    expect(postDominates(tree, 1, 2)).toBe(false);
    // 0 does NOT post-dominate 1
    expect(postDominates(tree, 0, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Control Dependence Tests
// ---------------------------------------------------------------------------

describe('computeControlDependence', () => {
  it('handles empty CFG', () => {
    const empty: FunctionCfg = {
      functionName: 'empty',
      filePath: 'test.ts',
      startLine: 1,
      startColumn: 1,
      blocks: [],
      edges: [],
      bindings: [],
      stmtFacts: {
        defs: new Map(),
        uses: new Map(),
        sourceSites: new Map(),
        sinkSites: new Map(),
        sanitizerSites: new Map(),
      },
      entryIndex: 0,
      exitIndex: -1,
    };
    const edges = computeControlDependence(empty);
    expect(edges).toEqual([]);
  });

  it('linear CFG has no control dependence', () => {
    const cfg = buildLinearCfg(4);
    const edges = computeControlDependence(cfg);
    // In a purely sequential CFG, no block is control-dependent on another
    expect(edges).toEqual([]);
  });

  it('if-else has correct control dependence', () => {
    const cfg = buildIfElseCfg();
    const edges = computeControlDependence(cfg);

    // B1 and B2 should be control-dependent on B0
    // B1 is on 'T' branch, B2 is on 'F' branch
    const b1Deps = edges.filter((e) => e.dependentBlock === 1);
    const b2Deps = edges.filter((e) => e.dependentBlock === 2);

    expect(b1Deps.length).toBeGreaterThan(0);
    expect(b2Deps.length).toBeGreaterThan(0);
    if (b1Deps.length > 0) expect(b1Deps[0]!.controllerBlock).toBe(0);
    if (b2Deps.length > 0) expect(b2Deps[0]!.controllerBlock).toBe(0);
  });

  it('loop has correct control dependence', () => {
    const cfg = buildLoopCfg();
    const edges = computeControlDependence(cfg);

    // B2(body) is control-dependent on B1(header)
    // B1 is control-dependent on itself (loop header self-edge)
    expect(edges.length).toBeGreaterThan(0);

    // Loop body (B2) depends on loop header (B1)
    const b2Deps = edges.filter((e) => e.dependentBlock === 2);
    expect(b2Deps.length).toBeGreaterThan(0);

    // Loop header self-edge
    const selfEdges = edges.filter((e) => e.controllerBlock === e.dependentBlock);
    const hasSelfEdge = selfEdges.length > 0;
    // Loop headers should have self-edges (the predicate gates its own re-execution)
    expect(hasSelfEdge).toBe(true);
  });

  it('respects maxEdges cap', () => {
    const cfg = buildIfElseCfg();
    const edges = computeControlDependence(cfg, 1);
    expect(edges.length).toBeLessThanOrEqual(1);
  });

  it('edges are sorted by controller, dependent, label', () => {
    const cfg = buildIfElseCfg();
    const edges = computeControlDependence(cfg);

    for (let i = 1; i < edges.length; i++) {
      const prev = edges[i - 1]!;
      const curr = edges[i]!;

      if (prev.controllerBlock === curr.controllerBlock) {
        if (prev.dependentBlock === curr.dependentBlock) {
          expect(prev.label.localeCompare(curr.label)).toBeLessThanOrEqual(0);
        } else {
          expect(prev.dependentBlock).toBeLessThanOrEqual(curr.dependentBlock);
        }
      } else {
        expect(prev.controllerBlock).toBeLessThan(curr.controllerBlock);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Reaching Definitions Tests
// ---------------------------------------------------------------------------

describe('computeReachingDefinitions', () => {
  it('handles empty CFG', () => {
    const empty: FunctionCfg = {
      functionName: 'empty',
      filePath: 'test.ts',
      startLine: 1,
      startColumn: 1,
      blocks: [],
      edges: [],
      bindings: [],
      stmtFacts: {
        defs: new Map(),
        uses: new Map(),
        sourceSites: new Map(),
        sinkSites: new Map(),
        sanitizerSites: new Map(),
      },
      entryIndex: 0,
      exitIndex: -1,
    };
    const facts = computeReachingDefinitions(empty);
    expect(facts).toEqual([]);
  });

  it('tracks reaching definition in linear CFG', () => {
    const cfg = buildIfElseCfg();
    const facts = computeReachingDefinitions(cfg);

    // 'x' is defined in B0 and used in B0 — reaching def should exist
    expect(facts.length).toBeGreaterThan(0);

    // Verify we have a fact for binding 'x'
    const xFacts = facts.filter((f) => f.bindingName === 'x');
    expect(xFacts.length).toBeGreaterThan(0);
  });

  it('handles killing definitions in loops', () => {
    const cfg = buildLoopCfg();
    const facts = computeReachingDefinitions(cfg);

    // Loop: 'i' defined in B0, killed in B2, used in B1
    expect(facts.length).toBeGreaterThan(0);

    const iFacts = facts.filter((f) => f.bindingName === 'i');
    // Should have at least one reaching def for 'i'
    expect(iFacts.length).toBeGreaterThan(0);

    // Some facts should point from B0-def to B1-use (before loop)
    const fromB0 = iFacts.filter((f) => f.def.blockIndex === 0);
    expect(fromB0.length).toBeGreaterThan(0);

    // Some facts should point from B2-def to B1-use (loop iteration)
    const fromB2 = iFacts.filter((f) => f.def.blockIndex === 2);
    expect(fromB2.length).toBeGreaterThan(0);
  });

  it('facts are sorted by def then use', () => {
    const cfg = buildIfElseCfg();
    const facts = computeReachingDefinitions(cfg);

    for (let i = 1; i < facts.length; i++) {
      const prev = facts[i - 1]!;
      const curr = facts[i]!;

      const prevDefKey = prev.def.blockIndex * 1000 + prev.def.stmtIndex;
      const currDefKey = curr.def.blockIndex * 1000 + curr.def.stmtIndex;

      if (prevDefKey === currDefKey) {
        const prevUseKey = prev.use.blockIndex * 1000 + prev.use.stmtIndex;
        const currUseKey = curr.use.blockIndex * 1000 + curr.use.stmtIndex;
        expect(prevUseKey).toBeLessThanOrEqual(currUseKey);
      } else {
        expect(prevDefKey).toBeLessThan(currDefKey);
      }
    }
  });

  it('facts are deduplicated', () => {
    const cfg = buildIfElseCfg();
    const facts = computeReachingDefinitions(cfg);

    // Check for no duplicate (def, use, bindingIdx) triples
    const seen = new Set<string>();
    for (const f of facts) {
      const key = `${f.def.blockIndex}:${f.def.stmtIndex}:${f.use.blockIndex}:${f.use.stmtIndex}:${f.bindingIdx}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('each fact has required fields', () => {
    const cfg = buildIfElseCfg();
    const facts = computeReachingDefinitions(cfg);

    for (const f of facts) {
      expect(typeof f.bindingIdx).toBe('number');
      expect(typeof f.bindingName).toBe('string');
      expect(f.bindingName.length).toBeGreaterThan(0);
      expect(typeof f.def.blockIndex).toBe('number');
      expect(typeof f.def.stmtIndex).toBe('number');
      expect(typeof f.use.blockIndex).toBe('number');
      expect(typeof f.use.stmtIndex).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: CFG Analysis Pipeline
// ---------------------------------------------------------------------------

describe('CFG Analysis Pipeline', () => {
  it('post-dominators + control dependence work together', () => {
    const cfg = buildIfElseCfg();
    const postDom = computePostDominators(cfg);
    const cdg = computeControlDependence(cfg);

    // Post-dominators should have been computed
    expect(postDom.ipdom.length).toBe(cfg.blocks.length);

    // CDG should use post-dominator info correctly
    // B1 and B2 are on different branches of B0
    const b1Cds = cdg.filter((e) => e.dependentBlock === 1);
    const b2Cds = cdg.filter((e) => e.dependentBlock === 2);

    // At least B1 and B2 should be control-dependent
    expect(b1Cds.length + b2Cds.length).toBeGreaterThanOrEqual(2);
  });

  it('reaching defs and control dependence co-exist', () => {
    const cfg = buildIfElseCfg();
    const rd = computeReachingDefinitions(cfg);
    const cdg = computeControlDependence(cfg);

    // Both analyses should produce results for non-trivial CFG
    expect(rd.length).toBeGreaterThan(0);
    expect(cdg.length).toBeGreaterThan(0);
  });

  it('loop CFG produces coherent PDG analysis', () => {
    const cfg = buildLoopCfg();
    const postDom = computePostDominators(cfg);
    const cdg = computeControlDependence(cfg);
    const rd = computeReachingDefinitions(cfg);

    // All three analyses should produce results
    expect(postDom.ipdom.length).toBe(4);

    // Loop header should have self-edge in CDG
    const selfEdges = cdg.filter((e) => e.controllerBlock === e.dependentBlock);
    expect(selfEdges.length).toBe(1);

    // Reaching defs should track 'i' through the loop
    const iFacts = rd.filter((f) => f.bindingName === 'i');
    expect(iFacts.length).toBeGreaterThan(0);
  });
});
