// @code-analyzer/intelligence — PDG Builder Branch-Coverage Tests
// Exercises the internal buildGraph/findBlockNode branches that the
// control-dependence-focused and data-dependence-focused suites do not reach:
// a branching controller block that also carries def/use facts, duplicate
// def sites (getNode de-duplication), and the query API fallback for unknown
// node ids.

import { describe, it, expect } from 'vitest';
import { buildPdg } from '../cfg/pdg-builder.js';
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

/** Build a CFG with def/use facts, optionally branching. */
function makeDataCfg(opts: {
  name?: string;
  blockSpecs: BlockSpec[];
  edges: EdgeSpec[];
  defs?: Array<{ block: number; stmt: number; bindingIdx: number; kind: 'must' | 'may' }>;
  uses?: Array<{ block: number; stmt: number; bindingIdx: number }>;
  bindings?: Array<{ index: number; name: string }>;
}): FunctionCfg {
  const blocks: BasicBlock[] = opts.blockSpecs.map((b) => ({
    index: b.index,
    startLine: b.index * 10 + 1,
    endLine: b.index * 10 + b.statementCount,
    statementCount: b.statementCount,
    isEntry: b.isEntry ?? b.index === 0,
    isExit: b.isExit ?? b.index === opts.blockSpecs.length - 1,
  }));

  const edges: CfgEdge[] = opts.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind }));

  const defs = new Map<
    number,
    Array<{
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
      kind: 'must' | 'may';
    }>
  >();
  for (const d of opts.defs ?? []) {
    const key = d.block * STRIDE + d.stmt;
    if (!defs.has(key)) defs.set(key, []);
    defs.get(key)!.push({
      point: { blockIndex: d.block, stmtIndex: d.stmt, line: d.block * 10 + d.stmt + 1 },
      bindingIdx: d.bindingIdx,
      kind: d.kind,
    });
  }

  const uses = new Map<
    number,
    Array<{
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
    }>
  >();
  for (const u of opts.uses ?? []) {
    const key = u.block * STRIDE + u.stmt;
    if (!uses.has(key)) uses.set(key, []);
    uses.get(key)!.push({
      point: { blockIndex: u.block, stmtIndex: u.stmt, line: u.block * 10 + u.stmt + 1 },
      bindingIdx: u.bindingIdx,
    });
  }

  const bindings: BindingEntry[] = (opts.bindings ?? [{ index: 0, name: 'x' }]).map((b) => ({
    index: b.index,
    name: b.name,
    kind: 'local',
    declLine: 1,
    declColumn: 1,
    synthetic: false,
  }));

  const stmtFacts: StatementFacts = {
    defs,
    uses,
    sourceSites: new Map(),
    sinkSites: new Map(),
    sanitizerSites: new Map(),
  };

  return {
    functionName: opts.name ?? 'data',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges,
    bindings,
    stmtFacts,
    entryIndex: 0,
    exitIndex: opts.blockSpecs.length - 1,
  };
}

describe('buildPdg — branching controller with def/use facts', () => {
  it('stitches data edges and control edges without dropping duplicate def sites', () => {
    const cfg = makeDataCfg({
      name: 'branchAndData',
      blockSpecs: [
        { index: 0, statementCount: 1, isEntry: true },
        { index: 1, statementCount: 2 },
        { index: 2, statementCount: 1, isExit: true },
      ],
      edges: [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 2, kind: 'seq' },
      ],
      // A single def at (0,0) reaches two uses in block 1, producing two data
      // facts that share the same def site — the second lookup must de-dupe.
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must' }],
      uses: [
        { block: 1, stmt: 0, bindingIdx: 0 },
        { block: 1, stmt: 1, bindingIdx: 0 },
      ],
    });

    const pdg = buildPdg(cfg, 'test.ts');

    // Both data facts resolve: def(0,0) → use(1,0) and def(0,0) → use(1,1).
    const dataEdges = pdg.edges.filter((e) => e.kind === 'data');
    expect(dataEdges.length).toBe(2);

    // The controller block is a real 'def' node (findBlockNode preferKind hit),
    // and the target block is a real 'use' node (stmtIndex >= 0 scoring hit).
    const controlEdges = pdg.controlEdges;
    expect(controlEdges.length).toBeGreaterThan(0);

    // No duplicate nodes: the shared def site yields exactly one node.
    const defNodes = pdg.nodes.filter((n) => n.blockIndex === 0 && n.stmtIndex === 0);
    expect(defNodes.length).toBe(1);
  });

  it('getControlDependents returns [] for an unknown node id', () => {
    const cfg = makeDataCfg({
      name: 'branchAndData',
      blockSpecs: [
        { index: 0, statementCount: 1, isEntry: true },
        { index: 1, statementCount: 1 },
        { index: 2, statementCount: 1, isExit: true },
      ],
      edges: [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 2, kind: 'seq' },
      ],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must' }],
      uses: [{ block: 1, stmt: 0, bindingIdx: 0 }],
    });

    const pdg = buildPdg(cfg, 'test.ts');
    // A node id beyond the populated range triggers the `node ? [...] : []`
    // fallback instead of an out-of-bounds read.
    expect(pdg.getControlDependents(9999)).toEqual([]);
    expect(pdg.getControlDependents(-1)).toEqual([]);
  });
});
