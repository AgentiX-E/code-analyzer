// @code-analyzer/intelligence — Post-Dominator Branch Tests
// Exercises the edge cases of computePostDominators and postDominates that the
// happy-path CFG fixtures do not reach: empty CFG, out-of-range exit index,
// unreachable forward successors, and the defensive guards inside the
// postDominates ipdom-chain walk.

import { describe, it, expect } from 'vitest';
import { computePostDominators, postDominates } from '../cfg/post-dominators.js';
import type { FunctionCfg, BasicBlock, CfgEdge, CfgEdgeKind } from '../cfg/types.js';

/** Build a minimal FunctionCfg from an explicit block list and edge list. */
function makeCfg(
  blockCount: number,
  edges: Array<{ from: number; to: number; kind: CfgEdgeKind }>,
  exitIndex: number,
): FunctionCfg {
  const blocks: BasicBlock[] = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push({
      index: i,
      startLine: i * 10 + 1,
      endLine: i * 10 + 5,
      statementCount: 2,
      isEntry: i === 0,
      isExit: i === exitIndex,
    });
  }
  return {
    functionName: 'cfg',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges: edges.map((e) => ({ ...e })),
    bindings: [],
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
    entryIndex: 0,
    exitIndex,
  };
}

describe('computePostDominators — empty and invalid-exit edge cases', () => {
  it('returns an empty tree for a CFG with no blocks', () => {
    const cfg = makeCfg(0, [], -1);
    const tree = computePostDominators(cfg);
    expect(tree.ipdom).toEqual([]);
  });

  it('returns all NO_IPDOM when the exit index is >= block count', () => {
    // 3 blocks but exitIndex=3 is out of range.
    const cfg = makeCfg(3, [{ from: 0, to: 1, kind: 'seq' }], 3);
    const tree = computePostDominators(cfg);
    expect(tree.ipdom).toEqual([-1, -1, -1]);
  });

  it('returns all NO_IPDOM when the exit index is negative', () => {
    const cfg = makeCfg(3, [{ from: 0, to: 1, kind: 'seq' }], -1);
    const tree = computePostDominators(cfg);
    expect(tree.ipdom).toEqual([-1, -1, -1]);
  });
});

describe('computePostDominators — unreachable forward successor', () => {
  it('skips an unreachable first forward successor when seeding newIdom', () => {
    // Block 0 branches to an unreachable block 1 (no path to exit) and a
    // reachable block 2. When processing block 0, the first forward successor
    // (block 1) has ipdom === NO_IPDOM, forcing the newIdom scan to continue
    // past it and pick block 2.
    //
    //   0 ─┬─> 1 (dead: no outgoing edges)
    //      └─> 2 ─> 3 (exit)
    const cfg = makeCfg(
      4,
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 2, to: 3, kind: 'seq' },
      ],
      3,
    );

    const tree = computePostDominators(cfg);
    // Block 0 is post-dominated by block 2; block 1 (unreachable) has no
    // post-dominator; exit (3) is the root.
    expect(tree.ipdom).toEqual([2, -1, 3, -1]);
  });
});

describe('postDominates — ipdom-chain walk guards', () => {
  it('returns false when the chain hits NO_IPDOM', () => {
    // ipdom[1] = NO_IPDOM, so walking from block 1 terminates immediately.
    const tree = { ipdom: [1, -1] };
    expect(postDominates(tree, 0, 1)).toBe(false);
  });

  it('returns false when the chain hits a self-cycle (cycle guard)', () => {
    // ipdom[1] === 1 forms a self-loop; the cycle guard must stop the walk.
    const tree = { ipdom: [1, 1] };
    expect(postDominates(tree, 0, 1)).toBe(false);
  });

  it('returns false when a multi-node cycle exhausts the walk budget', () => {
    // ipdom = [1, 2, 0] forms a 3-cycle with no exit; the loop-exhausted
    // fallthrough (not NO_IPDOM, not a self-cycle) returns false.
    const tree = { ipdom: [1, 2, 0] };
    expect(postDominates(tree, 5, 0)).toBe(false);
  });

  it('returns true when the target is reached up the chain', () => {
    const tree = { ipdom: [1, 3, 3, -1] };
    expect(postDominates(tree, 3, 0)).toBe(true);
    expect(postDominates(tree, 1, 0)).toBe(true);
  });
});
