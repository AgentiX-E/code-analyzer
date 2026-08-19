import { describe, it, expect } from 'vitest';
import {
  computeDominators,
  computeImmediateDominators,
  buildDominatorTree,
  computeDominanceFrontiers,
  findBackEdges,
  findNaturalLoops,
} from '../cfg/dominators.js';
import { CfgBuilder } from '../cfg/cfg-builder.js';
import type { BasicBlock, ControlFlowGraph } from '../cfg/cfg-types.js';

function makeBlock(id: number, successors: number[], opts?: Partial<BasicBlock>): BasicBlock {
  return {
    id,
    label: `block_${id}`,
    statements: opts?.statements ?? 3,
    successors,
    predecessors: [],
    startLine: opts?.startLine ?? id * 10 + 1,
    endLine: opts?.endLine ?? id * 10 + 5,
  };
}

function makeCfg(
  name: string,
  blocks: Array<Omit<BasicBlock, 'predecessors'>>,
  entryId?: number,
  exitId?: number,
): ControlFlowGraph {
  return new CfgBuilder().buildFromBlocks(name, 'test.ts', blocks, entryId, exitId);
}

describe('computeDominators — edge cases', () => {
  it('returns an empty map for an empty CFG', () => {
    const cfg = makeCfg('empty', []);
    expect(computeDominators(cfg).size).toBe(0);
    expect(computeImmediateDominators(cfg).size).toBe(0);
    expect(buildDominatorTree(cfg).children.size).toBe(0);
    expect(computeDominanceFrontiers(cfg).size).toBe(0);
    expect(findBackEdges(cfg)).toEqual([]);
    expect(findNaturalLoops(cfg).size).toBe(0);
  });

  it('skips a disconnected block with no predecessors', () => {
    // Block 2 has no incoming edge, so it is skipped during the fixpoint
    // iteration (its dominator set stays at the "all blocks" seed).
    const cfg = makeCfg('disconnected', [makeBlock(0, [1]), makeBlock(1, []), makeBlock(2, [])]);
    const doms = computeDominators(cfg);
    // The reachable block is dominated by the entry block.
    expect(doms.get(1)?.has(0)).toBe(true);
    // The disconnected block keeps its "all blocks" seed (never refined).
    expect(doms.get(2)?.size).toBe(3);
  });
});

describe('computeImmediateDominators — edge cases', () => {
  it('resolves the immediate dominator when strict dominators are unordered', () => {
    // Declaring the entry block last makes the disconnected block 2 keep a
    // non-ancestor-first dominator set ({1, 0}), exercising the branch where
    // the current best already dominates the candidate.
    const cfg = makeCfg(
      'idom_unordered',
      [makeBlock(1, [0]), makeBlock(2, []), makeBlock(0, [1])],
      0,
    );
    const idom = computeImmediateDominators(cfg);
    expect(idom.get(0)).toBe(-1);
    expect(idom.get(1)).toBe(0);
  });
});

describe('findNaturalLoops — multi back-edge loops', () => {
  it('merges multiple back edges into one loop and skips re-added predecessors', () => {
    // Header 1 with two back edges (2->1 and 3->1). Block 2 is re-encountered
    // as a predecessor of 3 during traversal, exercising the "already in loop"
    // guard.
    const cfg = makeCfg('double_back', [
      makeBlock(0, [1]),
      makeBlock(1, [2]),
      makeBlock(2, [1, 3]),
      makeBlock(3, [1]),
    ]);
    const loops = findNaturalLoops(cfg);
    expect(loops.has(1)).toBe(true);
    expect(loops.get(1)).toContain(2);
    expect(loops.get(1)).toContain(3);
  });

  it('skips a back-edge source already in the loop and an undominated predecessor', () => {
    // Nested cycles produce back edges [2,1], [3,1], [3,2]. The second back
    // edge to header 1 has source 3 already in loop 1 (added during the first
    // traversal), and walking block 3 reaches predecessor 1 which is NOT
    // dominated by header 2.
    const cfg = makeCfg('nested_cycles', [
      makeBlock(0, [1]),
      makeBlock(1, [2]),
      makeBlock(2, [1, 3]),
      makeBlock(3, [1, 2]),
    ]);
    const loops = findNaturalLoops(cfg);
    expect(loops.get(1)).toEqual(expect.arrayContaining([1, 2, 3]));
  });
});

describe('intersectSets — size swap', () => {
  it('swaps the smaller set when the running intersection is larger', () => {
    // Block 4 has predecessors 2 ({0,1,2}) and 3 ({0,3}); intersecting the
    // larger running set with the smaller predecessor set triggers the swap.
    const cfg = makeCfg('swap', [
      makeBlock(0, [1, 3]),
      makeBlock(1, [2]),
      makeBlock(2, [4]),
      makeBlock(3, [4]),
      makeBlock(4, []),
    ]);
    const doms = computeDominators(cfg);
    expect(doms.get(4)).toEqual(new Set([0, 4]));
  });
});
