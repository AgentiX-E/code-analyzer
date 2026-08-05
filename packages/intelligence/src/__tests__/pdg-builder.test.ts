// @code-analyzer/intelligence — PDG Builder Tests

import { describe, it, expect } from 'vitest';
import { buildPdg } from '../cfg/pdg-builder.js';
import type { FunctionCfg, BindingEntry } from '../cfg/types.js';

// ---------------------------------------------------------------------------
// Helpers: build minimal FunctionCfg for testing
// ---------------------------------------------------------------------------

function makeCfg(
  fnName: string,
  blocks: Array<{ idx: number; entry?: boolean; exit?: boolean; stmts: number; startLine: number; endLine: number }>,
  edges: Array<{ from: number; to: number; kind: 'seq' | 'cond-true' | 'cond-false' | 'loop-back' }>,
  defs: Array<{ block: number; stmt: number; binding: number; kind: 'must' | 'may' }>,
  uses: Array<{ block: number; stmt: number; binding: number }>,
): FunctionCfg {
  const entryBlock = blocks.find((b) => b.entry)?.idx ?? 0;
  const exitBlock = blocks.find((b) => b.exit)?.idx ?? -1;

  const bindings: BindingEntry[] = [];
  // Collect unique binding indices
  const seenBindings = new Set<number>();
  for (const d of defs) seenBindings.add(d.binding);
  for (const u of uses) seenBindings.add(u.binding);
  for (const idx of seenBindings) {
    bindings.push({
      index: idx,
      name: `v${idx}`,
      kind: 'local',
      declLine: 0,
      declColumn: 0,
      synthetic: false,
    });
  }

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
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
    })),
    bindings,
    entryIndex: entryBlock,
    exitIndex: exitBlock,
    stmtFacts: {
      defs: buildStmtMap(defs.map((d) => ({
        key: d.block * 1024 + d.stmt,
        val: {
          point: { block: d.block, stmt: d.stmt, line: 0, col: 0, text: '' },
          bindingIdx: d.binding,
          kind: d.kind,
        },
      }))),
      uses: buildStmtMap(uses.map((u) => ({
        key: u.block * 1024 + u.stmt,
        val: {
          point: { block: u.block, stmt: u.stmt, line: 0, col: 0, text: '' },
          bindingIdx: u.binding,
        },
      }))),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
  };
}

function buildStmtMap<T>(items: Array<{ key: number; val: T }>): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const arr = map.get(item.key) ?? [];
    arr.push(item.val);
    map.set(item.key, arr);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPdg', () => {
  it('should build PDG for linear CFG with def-use chain', () => {
    const cfg = makeCfg(
      'linear',
      [
        { idx: 0, entry: true, stmts: 2, startLine: 1, endLine: 2 },
        { idx: 1, exit: true, stmts: 1, startLine: 3, endLine: 3 },
      ],
      [
        { from: 0, to: 1, kind: 'seq' },
      ],
      [
        { block: 0, stmt: 0, binding: 0, kind: 'must' },
      ],
      [
        { block: 1, stmt: 0, binding: 0 },
      ],
    );

    const pdg = buildPdg(cfg, 'test.ts', 'linear');

    expect(pdg.functionName).toBe('linear');
    expect(pdg.nodeCount).toBeGreaterThanOrEqual(2); // at least def and use nodes
    expect(pdg.edgeCount).toBeGreaterThan(0); // should have data edge
    expect(pdg.dataFacts.length).toBeGreaterThan(0);
  });

  it('should produce control dependence edges for if-else CFG', () => {
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
      [],
      [],
    );

    const pdg = buildPdg(cfg, 'test.ts', 'branch');

    // Should have control dependence edges (at least one cond edge from block 0)
    expect(pdg.controlEdges.length).toBeGreaterThan(0);
    expect(pdg.nodeCount).toBeGreaterThan(0);
  });

  it('should query control dependence correctly', () => {
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
      [],
      [],
    );

    const pdg = buildPdg(cfg, 'test.ts', 'branch');
    const result = pdg.queryControl({ controllerBlock: 0, direction: 'dependents' });

    // Block 0 should have dependents (blocks 1 and 2 via cond-true/cond-false)
    expect(result.controlEdges.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('should query data dependence correctly', () => {
    const cfg = makeCfg(
      'dataflow',
      [
        { idx: 0, entry: true, stmts: 1, startLine: 1, endLine: 1 },
        { idx: 1, exit: true, stmts: 1, startLine: 2, endLine: 2 },
      ],
      [{ from: 0, to: 1, kind: 'seq' }],
      [{ block: 0, stmt: 0, binding: 0, kind: 'must' }],
      [{ block: 1, stmt: 0, binding: 0 }],
    );

    const pdg = buildPdg(cfg, 'test.ts', 'dataflow');
    const result = pdg.queryData({
      bindingIdx: 0,
      blockIndex: 0,
      stmtIndex: 0,
      direction: 'defs',
    });

    expect(result.dataFacts.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('should handle empty CFG', () => {
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
        defSites: [],
        useSites: [],
        sourceSites: [],
        sinkSites: [],
        sanitizerSites: [],
      },
    };

    const pdg = buildPdg(cfg, 'test.ts', 'empty');
    expect(pdg.nodeCount).toBe(0);
    expect(pdg.edgeCount).toBe(0);
  });

  it('should have entry and exit nodes for non-empty CFG', () => {
    const cfg = makeCfg(
      'func',
      [
        { idx: 0, entry: true, exit: true, stmts: 1, startLine: 1, endLine: 1 },
      ],
      [],
      [],
      [],
    );

    const pdg = buildPdg(cfg, 'test.ts', 'func');
    // Should have at least entry + exit nodes
    expect(pdg.nodeCount).toBeGreaterThanOrEqual(2);
  });

  it('should handle loop CFG with back-edge', () => {
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
      [],
      [],
    );

    const pdg = buildPdg(cfg, 'test.ts', 'loop');
    expect(pdg.controlEdges.length).toBeGreaterThan(0);

    // Check for loop-carried edges
    const loopEdges = pdg.edges.filter((e) => e.kind === 'loop-carried');
    expect(loopEdges.length).toBeGreaterThan(0);
  });

  it('should support getControlDependents', () => {
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
      [],
      [],
    );

    const pdg = buildPdg(cfg, 'test.ts', 'branch');

    // Any node with control dependents should have at least 1
    const nodeIds = pdg.nodes.map((n) => n.nodeId);
    const hasDependents = nodeIds.some((id) => pdg.getControlDependents(id).length > 0);
    expect(hasDependents).toBe(true);
  });
});
