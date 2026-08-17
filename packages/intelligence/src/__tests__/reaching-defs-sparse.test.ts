// @code-analyzer/intelligence — Reaching Definitions Sparse Solver Tests
// Exercises the SSA-sparse solver (Cytron dominance frontiers + φ-placement +
// renaming) which is selected when a CFG has >= SSA_MIN_BLOCKS (16) blocks AND
// a reachable loop. The dense solver is already covered by cfg-analysis.test.ts.

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

/** Build a custom CFG from block/edge specs plus a def/use fact map. */
function buildCfg(opts: {
  name: string;
  blockSpecs: BlockSpec[];
  edges: EdgeSpec[];
  bindings: BindingEntry[];
  defs?: Array<{ block: number; stmt: number; bindingIdx: number; kind: 'must' | 'may'; line?: number }>;
  uses?: Array<{ block: number; stmt: number; bindingIdx: number; line?: number }>;
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

  const defs = new Map<number, Array<{ point: { blockIndex: number; stmtIndex: number; line: number }; bindingIdx: number; kind: 'must' | 'may' }>>();
  const uses = new Map<number, Array<{ point: { blockIndex: number; stmtIndex: number; line: number }; bindingIdx: number }>>();

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

/** Build a loop CFG with a configurable number of blocks (>= 16 triggers sparse). */
function buildLargeLoopCfg(blockCount: number): FunctionCfg {
  // Structure: B0(entry) → B1 → B2 → ... → B{N-2} → B{N-1}(loop body) → loop-back → B1
  //             B{N-2} → cond-false → B{N}(exit)
  // To have a loop, the last body block loops back to B1.
  const blockSpecs: BlockSpec[] = [];
  for (let i = 0; i <= blockCount; i++) {
    blockSpecs.push({
      index: i,
      statementCount: 2,
      isEntry: i === 0,
      isExit: i === blockCount,
    });
  }

  const edges: EdgeSpec[] = [];
  for (let i = 0; i < blockCount - 1; i++) {
    edges.push({ from: i, to: i + 1, kind: 'seq' });
  }
  // Loop back-edge from B{blockCount-1} → B1
  edges.push({ from: blockCount - 1, to: 1, kind: 'loop-back' });
  // Exit edge from B{blockCount-1} → B{blockCount}
  edges.push({ from: blockCount - 1, to: blockCount, kind: 'seq' });

  const defs = [
    { block: 0, stmt: 0, bindingIdx: 0, kind: 'must' as const, line: 1 },
    { block: blockCount - 1, stmt: 0, bindingIdx: 0, kind: 'must' as const, line: blockCount * 10 + 1 },
  ];
  const uses = [
    { block: 1, stmt: 0, bindingIdx: 0, line: 11 },
    { block: blockCount, stmt: 0, bindingIdx: 0, line: blockCount * 10 + 1 },
  ];

  return buildCfg({
    name: `largeLoop${blockCount}`,
    blockSpecs,
    edges,
    bindings: [{ index: 0, name: 'x', kind: 'local', declLine: 1, declColumn: 7, synthetic: false }],
    defs,
    uses,
    entryIndex: 0,
    exitIndex: blockCount,
  });
}

describe('computeReachingDefinitions — SSA-sparse solver', () => {
  it('selects sparse solver for >=16 blocks with a loop and produces facts', () => {
    const cfg = buildLargeLoopCfg(16);
    expect(cfg.blocks.length).toBeGreaterThanOrEqual(16);

    const facts = computeReachingDefinitions(cfg);

    // Both def sites (B0 and B15) should reach uses.
    expect(facts.length).toBeGreaterThan(0);

    // The binding name should be resolved correctly.
    const xFacts = facts.filter((f) => f.bindingName === 'x');
    expect(xFacts.length).toBeGreaterThan(0);
  });

  it('produces a def from the loop body back to the loop header use (loop-carried)', () => {
    const cfg = buildLargeLoopCfg(16);
    const facts = computeReachingDefinitions(cfg);

    // The loop-body def (block 15) should reach the loop-header use (block 1)
    // in a later iteration.
    const loopCarried = facts.filter(
      (f) => f.def.blockIndex === 15 && f.use.blockIndex === 1,
    );
    expect(loopCarried.length).toBeGreaterThan(0);
  });

  it('produces a def from entry to the first use (before loop)', () => {
    const cfg = buildLargeLoopCfg(16);
    const facts = computeReachingDefinitions(cfg);

    const fromEntry = facts.filter((f) => f.def.blockIndex === 0);
    expect(fromEntry.length).toBeGreaterThan(0);
  });

  it('handles a diamond (branch/merge) with >=16 blocks', () => {
    // Build 16 blocks where the middle has a diamond: B7 → B8 (true) and B7 → B9 (false), both → B10.
    const blockSpecs: BlockSpec[] = [];
    for (let i = 0; i < 16; i++) {
      blockSpecs.push({ index: i, statementCount: 2, isEntry: i === 0, isExit: i === 15 });
    }
    const edges: EdgeSpec[] = [];
    for (let i = 0; i < 7; i++) edges.push({ from: i, to: i + 1, kind: 'seq' });
    edges.push({ from: 7, to: 8, kind: 'cond-true' });
    edges.push({ from: 7, to: 9, kind: 'cond-false' });
    edges.push({ from: 8, to: 10, kind: 'seq' });
    edges.push({ from: 9, to: 10, kind: 'seq' });
    for (let i = 10; i < 15; i++) edges.push({ from: i, to: i + 1, kind: 'seq' });
    // Add a loop back-edge to force sparse selection.
    edges.push({ from: 14, to: 1, kind: 'loop-back' });
    edges.push({ from: 14, to: 15, kind: 'seq' });

    const cfg = buildCfg({
      name: 'diamondLoop',
      blockSpecs,
      edges,
      bindings: [
        { index: 0, name: 'a', kind: 'local', declLine: 1, declColumn: 7, synthetic: false },
        { index: 1, name: 'b', kind: 'local', declLine: 1, declColumn: 7, synthetic: false },
      ],
      defs: [
        { block: 0, stmt: 0, bindingIdx: 0, kind: 'must' },
        { block: 8, stmt: 0, bindingIdx: 1, kind: 'must' },
        { block: 9, stmt: 0, bindingIdx: 1, kind: 'must' },
      ],
      uses: [
        { block: 10, stmt: 0, bindingIdx: 1 },
      ],
    });

    const facts = computeReachingDefinitions(cfg);
    expect(facts.length).toBeGreaterThan(0);

    // The use at B10 should see a def from B8 OR B9 (the diamond merge).
    const bUse = facts.filter((f) => f.use.blockIndex === 10);
    expect(bUse.length).toBeGreaterThan(0);
  });

  it('returns empty when there are defs but no uses', () => {
    const cfg = buildCfg({
      name: 'defsOnly',
      blockSpecs: [{ index: 0, statementCount: 1, isEntry: true, isExit: true }],
      edges: [],
      bindings: [{ index: 0, name: 'x', kind: 'local', declLine: 1, declColumn: 1, synthetic: false }],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must' }],
    });
    expect(computeReachingDefinitions(cfg)).toEqual([]);
  });

  it('returns empty when there are uses but no defs', () => {
    const cfg = buildCfg({
      name: 'usesOnly',
      blockSpecs: [{ index: 0, statementCount: 1, isEntry: true, isExit: true }],
      edges: [],
      bindings: [{ index: 0, name: 'x', kind: 'local', declLine: 1, declColumn: 1, synthetic: false }],
      uses: [{ block: 0, stmt: 0, bindingIdx: 0 }],
    });
    expect(computeReachingDefinitions(cfg)).toEqual([]);
  });

  it('handles MAY-defs (union, non-killing) correctly', () => {
    // A MAY-def should NOT kill previous defs; both reach the subsequent use.
    const blockSpecs: BlockSpec[] = [
      { index: 0, statementCount: 3, isEntry: true, isExit: false },
      { index: 1, statementCount: 1, isEntry: false, isExit: true },
    ];
    const cfg = buildCfg({
      name: 'mayDef',
      blockSpecs,
      edges: [{ from: 0, to: 1, kind: 'seq' }],
      bindings: [{ index: 0, name: 'y', kind: 'local', declLine: 1, declColumn: 1, synthetic: false }],
      defs: [
        { block: 0, stmt: 0, bindingIdx: 0, kind: 'must', line: 1 },
        { block: 0, stmt: 1, bindingIdx: 0, kind: 'may', line: 2 },
      ],
      uses: [{ block: 1, stmt: 0, bindingIdx: 0, line: 10 }],
    });

    const facts = computeReachingDefinitions(cfg);
    // The use should have reaching defs from BOTH the must-def (stmt 0) and may-def (stmt 1).
    const defStmts = new Set(facts.map((f) => f.def.stmtIndex));
    expect(defStmts.has(0)).toBe(true);
    expect(defStmts.has(1)).toBe(true);
  });

  it('produces sorted, deduplicated facts', () => {
    const cfg = buildLargeLoopCfg(16);
    const facts = computeReachingDefinitions(cfg);

    const seen = new Set<string>();
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i]!;
      const key = `${f.def.blockIndex}:${f.def.stmtIndex}:${f.use.blockIndex}:${f.use.stmtIndex}:${f.bindingIdx}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);

      if (i > 0) {
        const prev = facts[i - 1]!;
        const prevKey = prev.def.blockIndex * 1000 + prev.def.stmtIndex;
        const currKey = f.def.blockIndex * 1000 + f.def.stmtIndex;
        expect(currKey).toBeGreaterThanOrEqual(prevKey);
      }
    }
  });
});
