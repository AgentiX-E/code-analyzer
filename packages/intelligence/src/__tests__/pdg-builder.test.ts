// @code-analyzer/intelligence — PDG Builder Tests (control-dependence focused)
// Data-dependence tested separately via reaching-defs integration tests.

import { describe, it, expect } from 'vitest';
import { buildPdg } from '../cfg/pdg-builder.js';
import type { FunctionCfg, BindingEntry } from '../cfg/types.js';

function makeCfg(
  fnName: string,
  blocks: Array<{
    idx: number;
    entry?: boolean;
    exit?: boolean;
    stmts: number;
    startLine: number;
    endLine: number;
  }>,
  edges: Array<{
    from: number;
    to: number;
    kind: 'seq' | 'cond-true' | 'cond-false' | 'loop-back';
  }>,
): FunctionCfg {
  const entryBlock = blocks.find((b) => b.entry)?.idx ?? 0;
  const exitBlock = blocks.find((b) => b.exit)?.idx ?? -1;
  const bindings: BindingEntry[] = [];

  return {
    functionName: fnName,
    filePath: 'test.ts',
    startLine: blocks[0]?.startLine ?? 1,
    startColumn: 0,
    blocks: blocks.map((b) => ({
      index: b.idx,
      startLine: b.startLine,
      endLine: b.endLine,
      statementCount: b.stmts,
      isEntry: b.entry ?? false,
      isExit: b.exit ?? false,
    })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    bindings,
    entryIndex: entryBlock,
    exitIndex: exitBlock,
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
  };
}

describe('buildPdg', () => {
  it('handles empty CFG', () => {
    const cfg: FunctionCfg = {
      functionName: 'empty',
      filePath: 'test.ts',
      startLine: 0,
      startColumn: 0,
      blocks: [],
      edges: [],
      bindings: [],
      entryIndex: -1,
      exitIndex: -1,
      stmtFacts: {
        defs: new Map(),
        uses: new Map(),
        sourceSites: new Map(),
        sinkSites: new Map(),
        sanitizerSites: new Map(),
      },
    };
    const pdg = buildPdg(cfg, 'test.ts');
    expect(pdg.nodeCount).toBe(2); // entry + exit sentinels
    expect(pdg.controlEdges.length).toBe(0);
  });

  it('has entry/exit nodes for linear CFG', () => {
    const cfg = makeCfg(
      'linear',
      [
        { idx: 0, entry: true, stmts: 1, startLine: 1, endLine: 1 },
        { idx: 1, exit: true, stmts: 1, startLine: 2, endLine: 2 },
      ],
      [{ from: 0, to: 1, kind: 'seq' }],
    );

    const pdg = buildPdg(cfg, 'test.ts');
    expect(pdg.nodeCount).toBeGreaterThanOrEqual(2);
    expect(pdg.functionName).toBe('linear');
  });

  it('produces control dependence for if-else', () => {
    const cfg = makeCfg(
      'branch',
      [
        { idx: 0, entry: true, stmts: 1, startLine: 1, endLine: 1 },
        { idx: 1, stmts: 1, startLine: 2, endLine: 2 },
        { idx: 2, stmts: 1, startLine: 3, endLine: 3 },
        { idx: 3, exit: true, stmts: 1, startLine: 4, endLine: 4 },
      ],
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 3, kind: 'seq' },
        { from: 2, to: 3, kind: 'seq' },
      ],
    );

    const pdg = buildPdg(cfg, 'test.ts');
    expect(pdg.controlEdges.length).toBeGreaterThan(0);
  });

  it('queries control dependence correctly', () => {
    const cfg = makeCfg(
      'branch',
      [
        { idx: 0, entry: true, stmts: 1, startLine: 1, endLine: 1 },
        { idx: 1, stmts: 1, startLine: 2, endLine: 2 },
        { idx: 2, stmts: 1, startLine: 3, endLine: 3 },
        { idx: 3, exit: true, stmts: 1, startLine: 4, endLine: 4 },
      ],
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 3, kind: 'seq' },
        { from: 2, to: 3, kind: 'seq' },
      ],
    );

    const pdg = buildPdg(cfg, 'test.ts');
    const r = pdg.queryControl({ controllerBlock: 0, direction: 'dependents' });
    expect(r.controlEdges.length).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
  });

  it('detects loop-carried edges in loop CFG', () => {
    const cfg = makeCfg(
      'loop',
      [
        { idx: 0, entry: true, stmts: 1, startLine: 1, endLine: 1 },
        { idx: 1, stmts: 1, startLine: 2, endLine: 2 },
        { idx: 2, exit: true, stmts: 1, startLine: 3, endLine: 3 },
      ],
      [
        { from: 0, to: 1, kind: 'seq' },
        { from: 1, to: 2, kind: 'cond-true' },
        { from: 1, to: 1, kind: 'loop-back' },
      ],
    );

    const pdg = buildPdg(cfg, 'test.ts');
    expect(pdg.controlEdges.length).toBeGreaterThan(0);

    const loopEdges = pdg.edges.filter((e) => e.kind === 'loop-carried');
    expect(loopEdges.length).toBeGreaterThan(0);
  });

  it('getControlDependents returns non-empty for branch nodes', () => {
    const cfg = makeCfg(
      'branch',
      [
        { idx: 0, entry: true, stmts: 1, startLine: 1, endLine: 1 },
        { idx: 1, stmts: 1, startLine: 2, endLine: 2 },
        { idx: 2, exit: true, stmts: 1, startLine: 3, endLine: 3 },
      ],
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 2, kind: 'seq' },
      ],
    );

    const pdg = buildPdg(cfg, 'test.ts');
    const hasDeps = pdg.nodes.some((n) => pdg.getControlDependents(n.nodeId).length > 0);
    expect(hasDeps).toBe(true);
  });
});
