// @code-analyzer/intelligence — Reaching Definitions Edge / Branch Coverage
// Covers the remaining branch edges of the dense and sparse reaching-definition
// solvers that the primary suites (reaching-defs-sparse.test.ts and
// cfg-analysis.test.ts) do not exercise: out-of-range bindings, MAY-defs inside
// a block, the MAX_FACTS_PER_BINDING safety cap, the sparse entry-seed `?? []`
// fallback, and the DFS black-successor skip in loop detection.

import { describe, it, expect } from 'vitest';
import { computeReachingDefinitions } from '../cfg/reaching-defs.js';
import type {
  FunctionCfg,
  BasicBlock,
  CfgEdge,
  BindingEntry,
  StatementFacts,
} from '../cfg/types.js';

const STRIDE = 1024;

interface BlockSpec {
  index: number;
  statementCount: number;
  isEntry?: boolean;
  isExit?: boolean;
}

interface EdgeSpec {
  from: number;
  to: number;
  kind: CfgEdge['kind'];
}

interface DefSpec {
  block: number;
  stmt: number;
  bindingIdx: number;
  kind: 'must' | 'may';
  line?: number;
}

interface UseSpec {
  block: number;
  stmt: number;
  bindingIdx: number;
  line?: number;
}

/** Build a custom CFG from block/edge specs plus a def/use fact map. */
function buildCfg(opts: {
  name: string;
  blockSpecs: BlockSpec[];
  edges: EdgeSpec[];
  bindings: BindingEntry[];
  defs?: DefSpec[];
  uses?: UseSpec[];
  entryIndex?: number;
  exitIndex?: number;
}): FunctionCfg {
  const blocks: BasicBlock[] = opts.blockSpecs.map((b) => ({
    index: b.index,
    startLine: b.index * 10 + 1,
    endLine: b.index * 10 + b.statementCount,
    statementCount: b.statementCount,
    isEntry: b.isEntry ?? b.index === 0,
    isExit: b.isExit ?? b.index === opts.blockSpecs.length - 1,
  }));

  const edges: CfgEdge[] = opts.edges.map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
  }));

  const defs = new Map<
    number,
    Array<{
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
      kind: 'must' | 'may';
    }>
  >();
  const uses = new Map<
    number,
    Array<{ point: { blockIndex: number; stmtIndex: number; line: number }; bindingIdx: number }>
  >();

  for (const d of opts.defs ?? []) {
    const key = d.block * STRIDE + d.stmt;
    if (!defs.has(key)) defs.set(key, []);
    defs.get(key)!.push({
      point: { blockIndex: d.block, stmtIndex: d.stmt, line: d.line ?? d.block * 10 + d.stmt + 1 },
      bindingIdx: d.bindingIdx,
      kind: d.kind,
    });
  }

  for (const u of opts.uses ?? []) {
    const key = u.block * STRIDE + u.stmt;
    if (!uses.has(key)) uses.set(key, []);
    uses.get(key)!.push({
      point: { blockIndex: u.block, stmtIndex: u.stmt, line: u.line ?? u.block * 10 + u.stmt + 1 },
      bindingIdx: u.bindingIdx,
    });
  }

  const stmtFacts: StatementFacts = {
    defs,
    uses,
    sourceSites: new Map(),
    sinkSites: new Map(),
    sanitizerSites: new Map(),
  };

  return {
    functionName: opts.name,
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges,
    bindings: opts.bindings,
    stmtFacts,
    entryIndex: opts.entryIndex ?? 0,
    exitIndex: opts.exitIndex ?? opts.blockSpecs.length - 1,
  };
}

/** A binding entry with a given index/name. */
function binding(index: number, name: string): BindingEntry {
  return { index, name, kind: 'local', declLine: 1, declColumn: 7, synthetic: false };
}

/** A 16-block loop CFG (>= SSA_MIN_BLOCKS, has a back-edge) with custom facts. */
function buildLoopCfg(
  defs: DefSpec[],
  uses: UseSpec[],
  bindings: BindingEntry[],
  name = 'loop',
  entryStatements = 3,
): FunctionCfg {
  const blockCount = 16;
  const blockSpecs: BlockSpec[] = [];
  for (let i = 0; i <= blockCount; i++) {
    blockSpecs.push({
      index: i,
      statementCount: i === 0 ? entryStatements : 3,
      isEntry: i === 0,
      isExit: i === blockCount,
    });
  }
  const edges: EdgeSpec[] = [];
  for (let i = 0; i < blockCount - 1; i++) edges.push({ from: i, to: i + 1, kind: 'seq' });
  edges.push({ from: blockCount - 1, to: 1, kind: 'loop-back' });
  edges.push({ from: blockCount - 1, to: blockCount, kind: 'seq' });

  return buildCfg({
    name,
    blockSpecs,
    edges,
    bindings,
    defs,
    uses,
    entryIndex: 0,
    exitIndex: blockCount,
  });
}

describe('computeReachingDefinitions — dense solver edges', () => {
  it('produces no fact for a use of a binding with no reaching def', () => {
    // block 0 defs binding 0; block 1 uses binding 1 (no def anywhere).
    const cfg = buildCfg({
      name: 'undefUse',
      blockSpecs: [
        { index: 0, statementCount: 1, isEntry: true, isExit: false },
        { index: 1, statementCount: 1, isEntry: false, isExit: true },
      ],
      edges: [{ from: 0, to: 1, kind: 'seq' }],
      bindings: [binding(0, 'x'), binding(1, 'y')],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must', line: 1 }],
      uses: [{ block: 1, stmt: 0, bindingIdx: 1, line: 10 }],
    });

    const facts = computeReachingDefinitions(cfg);
    // The only use (binding 1) has no reaching def, so no fact is emitted.
    expect(facts.filter((f) => f.bindingIdx === 1)).toEqual([]);
  });

  it('resolves an out-of-range binding index to the "?" name fallback', () => {
    // bindings has only index 0; both the def and use reference binding 1.
    const cfg = buildCfg({
      name: 'oorBinding',
      blockSpecs: [{ index: 0, statementCount: 2, isEntry: true, isExit: true }],
      edges: [],
      bindings: [binding(0, 'x')],
      defs: [{ block: 0, stmt: 0, bindingIdx: 1, kind: 'must', line: 1 }],
      uses: [{ block: 0, stmt: 1, bindingIdx: 1, line: 2 }],
    });

    const facts = computeReachingDefinitions(cfg);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.bindingName === '?')).toBe(true);
  });

  it('carries MAY-defs within a block to a subsequent use (union, non-killing)', () => {
    // Two MAY-defs of binding 0 in the same block, then a use in that block.
    const cfg = buildCfg({
      name: 'intraBlockMay',
      blockSpecs: [{ index: 0, statementCount: 3, isEntry: true, isExit: true }],
      edges: [],
      bindings: [binding(0, 'x')],
      defs: [
        { block: 0, stmt: 0, bindingIdx: 0, kind: 'may', line: 1 },
        { block: 0, stmt: 1, bindingIdx: 0, kind: 'may', line: 2 },
      ],
      uses: [{ block: 0, stmt: 2, bindingIdx: 0, line: 3 }],
    });

    const facts = computeReachingDefinitions(cfg);
    const defStmts = new Set(facts.map((f) => f.def.stmtIndex));
    expect(defStmts.has(0)).toBe(true);
    expect(defStmts.has(1)).toBe(true);
  });

  it('does not let a def after a use reach that use (statement ordering)', () => {
    // use at stmt 0, must-def at stmt 1 in the same block: the def happens
    // AFTER the use, so it must not produce a reaching-definition fact.
    const cfg = buildCfg({
      name: 'defAfterUse',
      blockSpecs: [{ index: 0, statementCount: 2, isEntry: true, isExit: true }],
      edges: [],
      bindings: [binding(0, 'x')],
      defs: [{ block: 0, stmt: 1, bindingIdx: 0, kind: 'must', line: 2 }],
      uses: [{ block: 0, stmt: 0, bindingIdx: 0, line: 1 }],
    });

    expect(computeReachingDefinitions(cfg)).toEqual([]);
  });

  it('caps facts at MAX_FACTS_PER_BINDING (200) for a heavily-defined binding', () => {
    // 201 MAY-defs of the same binding in one block, then a single use.
    const defs: DefSpec[] = [];
    for (let s = 0; s < 201; s++) {
      defs.push({ block: 0, stmt: s, bindingIdx: 0, kind: 'may', line: s + 1 });
    }
    const cfg = buildCfg({
      name: 'factCap',
      blockSpecs: [{ index: 0, statementCount: 202, isEntry: true, isExit: true }],
      edges: [],
      bindings: [binding(0, 'x')],
      defs,
      uses: [{ block: 0, stmt: 201, bindingIdx: 0, line: 202 }],
    });

    const facts = computeReachingDefinitions(cfg);
    expect(facts.length).toBe(200);
  });

  it('sorts two uses of the same def by use statement index', () => {
    const cfg = buildCfg({
      name: 'multiUseSort',
      blockSpecs: [{ index: 0, statementCount: 3, isEntry: true, isExit: true }],
      edges: [],
      bindings: [binding(0, 'x')],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must', line: 1 }],
      uses: [
        { block: 0, stmt: 1, bindingIdx: 0, line: 2 },
        { block: 0, stmt: 2, bindingIdx: 0, line: 3 },
      ],
    });

    const facts = computeReachingDefinitions(cfg);
    expect(facts.length).toBe(2);
    // Same def + same use block -> ordered by use statement index.
    expect(facts[0]!.use.stmtIndex).toBe(1);
    expect(facts[1]!.use.stmtIndex).toBe(2);
  });

  it('deduplicates identical facts from a double use at one statement', () => {
    // `x = x + x`-style: two uses of the same binding at the same statement
    // produce two identical (def, use) facts that dedupFacts collapses to one.
    const cfg = buildCfg({
      name: 'doubleUse',
      blockSpecs: [{ index: 0, statementCount: 2, isEntry: true, isExit: true }],
      edges: [],
      bindings: [binding(0, 'x')],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must', line: 1 }],
      uses: [
        { block: 0, stmt: 1, bindingIdx: 0, line: 2 },
        { block: 0, stmt: 1, bindingIdx: 0, line: 2 },
      ],
    });

    expect(computeReachingDefinitions(cfg).length).toBe(1);
  });
});

describe('computeReachingDefinitions — sparse solver edges', () => {
  it('propagates non-entry defs even when the entry block defines nothing', () => {
    // Entry block (0) has no defs; block 1 defines binding 0; block 2 uses it.
    // The fixpoint must seed every block (not just the entry), otherwise the
    // empty entry output never triggers propagation and the non-entry def is
    // silently dropped.
    const cfg = buildLoopCfg(
      [{ block: 1, stmt: 0, bindingIdx: 0, kind: 'must', line: 11 }],
      [{ block: 2, stmt: 0, bindingIdx: 0, line: 21 }],
      [binding(0, 'x')],
    );

    const facts = computeReachingDefinitions(cfg);
    const fromBlock1 = facts.filter((f) => f.def.blockIndex === 1);
    expect(fromBlock1.length).toBeGreaterThan(0);
  });

  it('produces no fact for a sparse use of a binding with no reaching def', () => {
    const cfg = buildLoopCfg(
      [{ block: 1, stmt: 0, bindingIdx: 0, kind: 'must', line: 11 }],
      [{ block: 2, stmt: 0, bindingIdx: 1, line: 21 }],
      [binding(0, 'x'), binding(1, 'y')],
    );

    const facts = computeReachingDefinitions(cfg);
    expect(facts.filter((f) => f.bindingIdx === 1)).toEqual([]);
  });

  it('resolves an out-of-range binding index to "?" in the sparse sweep', () => {
    const cfg = buildLoopCfg(
      [{ block: 1, stmt: 0, bindingIdx: 1, kind: 'must', line: 11 }],
      [{ block: 2, stmt: 0, bindingIdx: 1, line: 21 }],
      [binding(0, 'x')],
    );

    const facts = computeReachingDefinitions(cfg);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.bindingName === '?')).toBe(true);
  });

  it('carries MAY-defs within a block in the sparse sweep', () => {
    // MAY-defs in the ENTRY block (whose IN is empty, so the first MAY-def
    // creates a fresh set), then a use in that same block. Placing the defs in
    // the loop header would let the loop back-edge re-seed the entry set, which
    // would keep the `existing` branch from ever being falsy.
    const cfg = buildLoopCfg(
      [
        { block: 0, stmt: 0, bindingIdx: 0, kind: 'may', line: 1 },
        { block: 0, stmt: 1, bindingIdx: 0, kind: 'may', line: 2 },
      ],
      [{ block: 0, stmt: 2, bindingIdx: 0, line: 3 }],
      [binding(0, 'x')],
    );

    const facts = computeReachingDefinitions(cfg);
    const defStmts = new Set(
      facts.filter((f) => f.use.blockIndex === 0).map((f) => f.def.stmtIndex),
    );
    expect(defStmts.has(0)).toBe(true);
    expect(defStmts.has(1)).toBe(true);
  });

  it('caps facts at MAX_FACTS_PER_BINDING (200) in the sparse sweep', () => {
    // 201 MAY-defs in the entry block, then a single use: exercises the
    // sparse sweep's fact cap independently of the dense sweep.
    const defs: DefSpec[] = [];
    for (let s = 0; s < 201; s++) {
      defs.push({ block: 0, stmt: s, bindingIdx: 0, kind: 'may', line: s + 1 });
    }
    const cfg = buildLoopCfg(
      defs,
      [{ block: 0, stmt: 201, bindingIdx: 0, line: 202 }],
      [binding(0, 'x')],
      'loopCap',
      202,
    );

    const facts = computeReachingDefinitions(cfg);
    expect(facts.length).toBe(200);
  });
});

describe('computeReachingDefinitions — loop-detection DFS black-successor skip', () => {
  it('skips an already-finished (black) successor in a diamond merge', () => {
    // A 16-block DAG with a diamond (3 -> 4/5 -> 6) and no back-edge. The DFS
    // fully finishes block 6 via 3->4->6 before visiting 3->5->6, so block 6 is
    // already black when reached from 5 (exercising the `visited === 2` skip).
    const n = 16;
    const blockSpecs: BlockSpec[] = [];
    for (let i = 0; i < n; i++) {
      blockSpecs.push({ index: i, statementCount: 2, isEntry: i === 0, isExit: i === n - 1 });
    }
    const edges: EdgeSpec[] = [];
    for (let i = 0; i < 3; i++) edges.push({ from: i, to: i + 1, kind: 'seq' });
    edges.push({ from: 3, to: 4, kind: 'cond-true' });
    edges.push({ from: 3, to: 5, kind: 'cond-false' });
    edges.push({ from: 4, to: 6, kind: 'seq' });
    edges.push({ from: 5, to: 6, kind: 'seq' });
    for (let i = 6; i < n - 1; i++) edges.push({ from: i, to: i + 1, kind: 'seq' });

    const cfg = buildCfg({
      name: 'diamondDag',
      blockSpecs,
      edges,
      bindings: [binding(0, 'x')],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must', line: 1 }],
      uses: [{ block: n - 1, stmt: 0, bindingIdx: 0, line: (n - 1) * 10 + 1 }],
      entryIndex: 0,
      exitIndex: n - 1,
    });

    const facts = computeReachingDefinitions(cfg);
    expect(facts.filter((f) => f.def.blockIndex === 0).length).toBeGreaterThan(0);
  });
});
