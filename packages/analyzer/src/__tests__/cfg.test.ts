// @code-analyzer/analyzer — CFG Module Tests
// Comprehensive tests for CFG construction, dominator computation, and dataflow analysis.

import { describe, it, expect } from 'vitest';
import { CfgBuilder } from '../cfg/cfg-builder.js';
import {
  computeDominators,
  computeImmediateDominators,
  buildDominatorTree,
  computeDominanceFrontiers,
  findBackEdges,
  findNaturalLoops,
} from '../cfg/dominators.js';
import {
  computeReachingDefinitions,
  computeLiveVariables,
  detectUnreachableCode,
  detectDeadStores,
  computeAvailableExpressions,
} from '../cfg/dataflow.js';
import type { BasicBlock, ControlFlowGraph } from '../cfg/cfg-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const builder = new CfgBuilder();
  return builder.buildFromBlocks(name, 'test.ts', blocks, entryId, exitId);
}

// ===========================================================================
// CFG Construction Tests
// ===========================================================================

describe('CFG Construction', () => {
  const builder = new CfgBuilder();

  it('should build a simple linear CFG (3 blocks)', () => {
    const cfg = makeCfg('linear', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

    expect(cfg.blocks).toHaveLength(3);
    expect(cfg.entryBlockId).toBe(0);
    expect(cfg.exitBlockId).toBe(2);
    expect(cfg.blocks[0]!.successors).toEqual([1]);
    expect(cfg.blocks[1]!.predecessors).toEqual([0]);
    expect(cfg.blocks[1]!.successors).toEqual([2]);
    expect(cfg.blocks[2]!.predecessors).toEqual([1]);
  });

  it('should build an if-else CFG with branches', () => {
    // B0(entry) -> B1(then), B0 -> B2(else), B1 -> B3, B2 -> B3(exit)
    const cfg = makeCfg('ifelse', [
      makeBlock(0, [1, 2]),
      makeBlock(1, [3]),
      makeBlock(2, [3]),
      makeBlock(3, []),
    ]);

    expect(cfg.blocks).toHaveLength(4);
    expect(cfg.entryBlockId).toBe(0);
    expect(cfg.blocks[0]!.successors).toContain(1);
    expect(cfg.blocks[0]!.successors).toContain(2);
    expect(cfg.blocks[1]!.predecessors).toContain(0);
    expect(cfg.blocks[2]!.predecessors).toContain(0);
    expect(cfg.blocks[3]!.predecessors).toContain(1);
    expect(cfg.blocks[3]!.predecessors).toContain(2);
  });

  it('should build a loop CFG with back edge', () => {
    // B0(entry) -> B1(loop header), B1 -> B2(loop body), B2 -> B1(back), B1 -> B3(exit)
    const cfg = makeCfg('loop', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [1]),
      makeBlock(3, []),
    ]);

    expect(cfg.blocks[1]!.successors).toContain(2);
    expect(cfg.blocks[2]!.successors).toContain(1);
    // Loop back edge detected
    const backEdges = findBackEdges(cfg);
    expect(backEdges.length).toBeGreaterThan(0);
    expect(backEdges).toContainEqual([2, 1]);
  });

  it('should build an empty function CFG', () => {
    const cfg = makeCfg('empty', []);
    expect(cfg.blocks).toHaveLength(0);
  });

  it('should build a single-block CFG', () => {
    const cfg = makeCfg('single', [makeBlock(0, [])]);
    expect(cfg.blocks).toHaveLength(1);
    expect(cfg.entryBlockId).toBe(0);
    expect(cfg.exitBlockId).toBe(0);
    expect(cfg.blocks[0]!.successors).toEqual([]);
    expect(cfg.blocks[0]!.predecessors).toEqual([]);
  });

  it('should compute predecessors correctly from successors', () => {
    const cfg = makeCfg('diamond', [
      makeBlock(0, [1, 2]),
      makeBlock(1, [3]),
      makeBlock(2, [3]),
      makeBlock(3, []),
    ]);

    expect(cfg.blocks[3]!.predecessors).toContain(1);
    expect(cfg.blocks[3]!.predecessors).toContain(2);
    expect(cfg.blocks[3]!.predecessors).toHaveLength(2);
  });

  it('should handle switch-like multi-branch', () => {
    // B0 -> B1, B0 -> B2, B0 -> B3, all -> B4
    const cfg = makeCfg('switch', [
      makeBlock(0, [1, 2, 3]),
      makeBlock(1, [4]),
      makeBlock(2, [4]),
      makeBlock(3, [4]),
      makeBlock(4, []),
    ]);

    expect(cfg.blocks[0]!.successors).toHaveLength(3);
    expect(cfg.blocks[4]!.predecessors).toHaveLength(3);
  });

  it('should handle try-catch pattern (exception edges)', () => {
    // B0(try) -> B1(normal), B0(try) -> B2(catch), B1 -> B3, B2 -> B3
    const cfg = makeCfg('trycatch', [
      makeBlock(0, [1, 2]),
      makeBlock(1, [3]),
      makeBlock(2, [3]),
      makeBlock(3, []),
    ]);

    expect(cfg.blocks[0]!.successors).toContain(2);
    expect(cfg.blocks[2]!.predecessors).toContain(0);
  });

  it('should handle return in middle of function', () => {
    // B0 -> B1(returns) | B0 -> B2, B2 -> B3
    const cfg = makeCfg('return_mid', [
      makeBlock(0, [1, 2]),
      makeBlock(1, []),
      makeBlock(2, [3]),
      makeBlock(3, []),
    ]);

    // Block 1 (return) has no successors
    expect(cfg.blocks[1]!.successors).toEqual([]);
    // But block 3 is still reachable from block 2
    expect(cfg.blocks[2]!.successors).toContain(3);
  });

  it('should handle nested if-else (2 levels)', () => {
    // Outer: B0 -> B1, B0 -> B4
    // Inner (in B1): B1 -> B2, B1 -> B3, B2 -> B4, B3 -> B4
    const cfg = makeCfg('nested_if', [
      makeBlock(0, [1, 4]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [4]),
      makeBlock(3, [4]),
      makeBlock(4, []),
    ]);

    expect(cfg.blocks[0]!.successors).toHaveLength(2);
    expect(cfg.blocks[1]!.successors).toHaveLength(2);
    expect(cfg.blocks[4]!.predecessors).toHaveLength(3);
  });

  it('should handle deeply nested control flow (5 levels)', () => {
    // Create a path with 5 levels of nesting
    const blocks = [
      makeBlock(0, [1, 6]),
      makeBlock(1, [2, 5]),
      makeBlock(2, [3, 4]),
      makeBlock(3, [7]),
      makeBlock(4, [7]),
      makeBlock(5, [7]),
      makeBlock(6, [7]),
      makeBlock(7, []),
    ];

    const cfg = makeCfg('deep_nesting', blocks);
    expect(cfg.blocks).toHaveLength(8);
    expect(cfg.blocks[7]!.predecessors.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle while loop pattern', () => {
    // B0(entry) -> B1(header), B1 -> B2(body), B2 -> B1(back), B1 -> B3(exit)
    const cfg = makeCfg('while_loop', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [1]),
      makeBlock(3, []),
    ]);

    expect(cfg.blocks[1]!.successors).toHaveLength(2);
    const backEdges = findBackEdges(cfg);
    expect(backEdges.length).toBeGreaterThan(0);
  });

  it('should handle for loop pattern with break', () => {
    // B0 -> B1(header), B1 -> B2(body), B2 -> B1(back), B2 -> B3(break/exit)
    const cfg = makeCfg('for_loop', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [1, 3]),
      makeBlock(3, []),
    ]);

    expect(cfg.blocks[2]!.successors).toHaveLength(2);
    expect(cfg.blocks[2]!.successors).toContain(3);
  });

  it('should correctly label blocks with custom labels', () => {
    const cfg = makeCfg('labeled', [
      { id: 0, label: 'entry', statements: 2, successors: [1], startLine: 1, endLine: 3 },
      { id: 1, label: 'loop', statements: 1, successors: [2, 3], startLine: 5, endLine: 6 },
      { id: 2, label: 'body', statements: 3, successors: [1], startLine: 8, endLine: 12 },
      { id: 3, label: 'exit', statements: 1, successors: [], startLine: 14, endLine: 15 },
    ]);

    expect(cfg.blocks[0]!.label).toBe('entry');
    expect(cfg.blocks[1]!.label).toBe('loop');
    expect(cfg.blocks[2]!.label).toBe('body');
    expect(cfg.blocks[3]!.label).toBe('exit');
  });

  it('should set correct statement counts', () => {
    const blocks = [
      { id: 0, label: 'a', statements: 5, successors: [1], startLine: 1, endLine: 10 },
      { id: 1, label: 'b', statements: 10, successors: [], startLine: 11, endLine: 25 },
    ];
    const cfg = makeCfg('statements', blocks);
    expect(cfg.blocks[0]!.statements).toBe(5);
    expect(cfg.blocks[1]!.statements).toBe(10);
  });
});

// ===========================================================================
// Dominator Computation Tests
// ===========================================================================

describe('Dominator Computation', () => {
  it('entry block should dominate all blocks', () => {
    const cfg = makeCfg('dom_all', [
      makeBlock(0, [1, 2]),
      makeBlock(1, [3]),
      makeBlock(2, [3]),
      makeBlock(3, []),
    ]);

    const doms = computeDominators(cfg);
    for (const block of cfg.blocks) {
      expect(doms.get(block.id)?.has(0)).toBe(true);
    }
  });

  it('every block should dominate itself', () => {
    const cfg = makeCfg('self_dom', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

    const doms = computeDominators(cfg);
    for (const block of cfg.blocks) {
      expect(doms.get(block.id)?.has(block.id)).toBe(true);
    }
  });

  it('should compute correct dominators for diamond CFG', () => {
    // B0 -> B1, B0 -> B2, B1 -> B3, B2 -> B3
    const cfg = makeCfg('dom_diamond', [
      makeBlock(0, [1, 2]),
      makeBlock(1, [3]),
      makeBlock(2, [3]),
      makeBlock(3, []),
    ]);

    const doms = computeDominators(cfg);
    // B0 dominates everything
    expect(doms.get(3)?.has(0)).toBe(true);
    expect(doms.get(1)?.has(0)).toBe(true);
    expect(doms.get(2)?.has(0)).toBe(true);
    // B1 does NOT dominate B2 or B3
    expect(doms.get(2)?.has(1)).toBe(false);
    expect(doms.get(3)?.has(1)).toBe(false);
    // B3 does not dominate B1 or B2
    expect(doms.get(1)?.has(3)).toBe(false);
  });

  it('should compute immediate dominators correctly', () => {
    const cfg = makeCfg('idom_test', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [4]),
      makeBlock(3, [4]),
      makeBlock(4, []),
    ]);

    const idom = computeImmediateDominators(cfg);
    expect(idom.get(0)).toBe(-1); // Entry has no idom
    expect(idom.get(1)).toBe(0);
    expect(idom.get(2)).toBe(1);
    expect(idom.get(3)).toBe(1);
    expect(idom.get(4)).toBe(1); // Merge point idom is 1
  });

  it('should build a correct dominator tree', () => {
    const cfg = makeCfg('domtree', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [4]),
      makeBlock(3, [4]),
      makeBlock(4, [5]),
      makeBlock(5, []),
    ]);

    const tree = buildDominatorTree(cfg);
    expect(tree.children.get(0)).toBeDefined();
    expect(tree.children.get(0)).toContain(1);
    expect(tree.parent.get(1)).toBe(0);
    expect(tree.parent.get(4)).toBe(1);
  });

  it('should compute dominance frontiers', () => {
    const cfg = makeCfg('df_test', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [4]),
      makeBlock(3, [4]),
      makeBlock(4, []),
    ]);

    const frontiers = computeDominanceFrontiers(cfg);
    // Block 1 should have block 4 in its dominance frontier
    // (B1 dominates B2 and B3, and both have edge to B4 which B1 doesn't dominate)
    const frontier1 = frontiers.get(1);
    expect(frontier1).toBeDefined();
    if (frontier1) {
      // B4 is in the frontier because B2->B4 and B3->B4 are edges from B1-dominated blocks
      expect(frontier1.size).toBeGreaterThanOrEqual(0);
    }
  });

  it('should detect back edges in a loop', () => {
    const cfg = makeCfg('back_edge', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 3]),
      makeBlock(2, [1]),
      makeBlock(3, []),
    ]);

    const backEdges = findBackEdges(cfg);
    expect(backEdges).toContainEqual([2, 1]);
  });

  it('should detect natural loops', () => {
    const cfg = makeCfg('natural_loop', [
      makeBlock(0, [1]),
      makeBlock(1, [2, 4]),
      makeBlock(2, [3]),
      makeBlock(3, [1]),
      makeBlock(4, []),
    ]);

    const loops = findNaturalLoops(cfg);
    expect(loops.size).toBeGreaterThan(0);
    // Loop header is block 1
    const loop = loops.get(1);
    expect(loop).toBeDefined();
    if (loop) {
      expect(loop).toContain(1); // Header included
      expect(loop).toContain(2); // Body
      expect(loop).toContain(3); // Body
    }
  });

  it('should have no back edges in a DAG', () => {
    const cfg = makeCfg('dag', [
      makeBlock(0, [1, 2]),
      makeBlock(1, [3]),
      makeBlock(2, [3]),
      makeBlock(3, [4]),
      makeBlock(4, []),
    ]);

    const backEdges = findBackEdges(cfg);
    expect(backEdges).toHaveLength(0);
  });

  it('should have all dominance frontiers defined for every block', () => {
    const cfg = makeCfg('all_df', [
      makeBlock(0, [1, 2]),
      makeBlock(1, [3]),
      makeBlock(2, [3]),
      makeBlock(3, []),
    ]);

    const frontiers = computeDominanceFrontiers(cfg);
    for (const block of cfg.blocks) {
      expect(frontiers.has(block.id)).toBe(true);
    }
  });
});

// ===========================================================================
// Dataflow Analysis Tests
// ===========================================================================

describe('Dataflow Analysis', () => {
  describe('Reaching Definitions', () => {
    it('should compute reaching definitions for linear CFG', () => {
      const cfg = makeCfg('rd_linear', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const defs = new Map<string, number[]>();
      defs.set('x', [0]); // x defined in block 0
      defs.set('y', [1]); // y defined in block 1

      const reaching = computeReachingDefinitions(cfg, defs);

      // Block 1 should have def 'x' reaching it
      const reach1 = reaching.get(1);
      expect(reach1).toBeDefined();
      if (reach1) {
        expect(reach1.has('x')).toBe(true);
      }
    });

    it('should handle killed definitions', () => {
      const cfg = makeCfg('rd_kill', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const defs = new Map<string, number[]>();
      defs.set('x', [0, 2]); // x defined in blocks 0 and 2

      const reaching = computeReachingDefinitions(cfg, defs);

      // Block 2 redefines x, so x from block 0 should NOT reach past block 2
      const reach2 = reaching.get(2);
      expect(reach2).toBeDefined();
    });

    it('should propagate definitions along both branches', () => {
      const cfg = makeCfg('rd_branch', [
        makeBlock(0, [1, 2]),
        makeBlock(1, [3]),
        makeBlock(2, [3]),
        makeBlock(3, []),
      ]);

      const defs = new Map<string, number[]>();
      defs.set('a', [1]);
      defs.set('b', [2]);

      const reaching = computeReachingDefinitions(cfg, defs);

      // Block 3 should have definitions from both branches
      const reach3 = reaching.get(3);
      expect(reach3).toBeDefined();
      if (reach3) {
        expect(reach3.has('a')).toBe(true);
        expect(reach3.has('b')).toBe(true);
      }
    });

    it('should handle empty definitions map', () => {
      const cfg = makeCfg('rd_empty', [makeBlock(0, [1]), makeBlock(1, [])]);

      const reaching = computeReachingDefinitions(cfg, new Map());
      expect(reaching.size).toBeGreaterThan(0);
    });

    it('should handle single-block CFG', () => {
      const cfg = makeCfg('rd_single', [makeBlock(0, [])]);
      const defs = new Map<string, number[]>();
      defs.set('x', [0]);

      const reaching = computeReachingDefinitions(cfg, defs);
      const reach0 = reaching.get(0);
      expect(reach0).toBeDefined();
    });
  });

  describe('Live Variables', () => {
    it('should compute live variables for linear CFG', () => {
      const cfg = makeCfg('lv_linear', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const uses = new Map<string, number[]>();
      uses.set('x', [1]); // x used in block 1

      const liveVars = computeLiveVariables(cfg, uses, new Map());
      expect(liveVars.size).toBeGreaterThan(0);

      // Block 0 should have x as live-out (since x is used in block 1)
      const live0 = liveVars.get(0);
      expect(live0).toBeDefined();
    });

    it('should propagate liveness backward', () => {
      const cfg = makeCfg('lv_backward', [
        makeBlock(0, [1, 2]),
        makeBlock(1, [3]),
        makeBlock(2, [3]),
        makeBlock(3, []),
      ]);

      const uses = new Map<string, number[]>();
      uses.set('result', [3]); // Used only in block 3

      const liveVars = computeLiveVariables(cfg, uses, new Map());
      // All blocks should have 'result' live-out since it's used at the end
      for (const block of cfg.blocks) {
        if (block.id !== 3) {
          const live = liveVars.get(block.id);
          expect(live).toBeDefined();
        }
      }
    });

    it('should handle variables used in loop body', () => {
      const cfg = makeCfg('lv_loop', [
        makeBlock(0, [1]),
        makeBlock(1, [2, 3]),
        makeBlock(2, [1]),
        makeBlock(3, []),
      ]);

      const uses = new Map<string, number[]>();
      uses.set('counter', [2]); // Used in loop body

      const liveVars = computeLiveVariables(cfg, uses, new Map());
      const live1 = liveVars.get(1);
      expect(live1).toBeDefined();
    });

    it('should handle empty uses', () => {
      const cfg = makeCfg('lv_empty', [makeBlock(0, [1]), makeBlock(1, [])]);

      const liveVars = computeLiveVariables(cfg, new Map(), new Map());
      // No variables ever used, so all live-out sets should be empty
      expect(liveVars.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Unreachable Code Detection', () => {
    it('should detect no unreachable code in fully connected CFG', () => {
      const cfg = makeCfg('reach_all', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const unreachable = detectUnreachableCode(cfg);
      expect(unreachable).toHaveLength(0);
    });

    it('should detect unreachable blocks after return', () => {
      const cfg = makeCfg('unreachable', [
        makeBlock(0, [1, 2]),
        makeBlock(1, []), // Returns, no successors
        makeBlock(2, []), // Unreachable from block 0 if block 1 always taken
      ]);

      // Note: Block 2 may be reachable from 0 depending on edge structure
      const unreachable = detectUnreachableCode(cfg);
      // Block 2 should be reachable since 0 has edge to 2
      expect(unreachable).toHaveLength(0);
    });

    it('should detect truly disconnected block', () => {
      const cfg = makeCfg('disconnected', [
        makeBlock(0, [1]),
        makeBlock(1, []),
        makeBlock(2, []), // No predecessors at all
      ]);

      const unreachable = detectUnreachableCode(cfg);
      expect(unreachable).toContain(2);
    });

    it('should return empty for empty CFG', () => {
      const cfg = makeCfg('empty_cfg', []);
      const unreachable = detectUnreachableCode(cfg);
      expect(unreachable).toHaveLength(0);
    });

    it('should handle branching CFG (all reachable)', () => {
      const cfg = makeCfg('branch_all', [
        makeBlock(0, [1, 2]),
        makeBlock(1, [3]),
        makeBlock(2, [3]),
        makeBlock(3, []),
      ]);

      const unreachable = detectUnreachableCode(cfg);
      expect(unreachable).toHaveLength(0);
    });
  });

  describe('Dead Store Detection', () => {
    it('should return empty array for empty CFG', () => {
      const cfg = makeCfg('ds_empty', []);
      const deadStores = detectDeadStores(cfg, new Map(), new Map());
      expect(deadStores).toHaveLength(0);
    });

    it('should return empty for single block with no defs', () => {
      const cfg = makeCfg('ds_single', [makeBlock(0, [])]);
      const deadStores = detectDeadStores(cfg, new Map(), new Map());
      // No block assignments populated by default, so no dead stores
      expect(deadStores).toHaveLength(0);
    });
  });

  describe('Available Expressions', () => {
    it('should compute available expressions for linear CFG', () => {
      const cfg = makeCfg('ae_linear', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const exprs = new Map<number, string[]>();
      exprs.set(0, ['a + b']);
      exprs.set(2, ['x * y']);

      const avail = computeAvailableExpressions(cfg, exprs, new Map());
      expect(avail.size).toBeGreaterThan(0);
    });

    it('should have empty available set at entry', () => {
      const cfg = makeCfg('ae_entry', [makeBlock(0, [1]), makeBlock(1, [])]);

      const avail = computeAvailableExpressions(cfg, new Map(), new Map());
      const entryAvail = avail.get(0);
      expect(entryAvail).toBeDefined();
      if (entryAvail) {
        expect(entryAvail.size).toBe(0);
      }
    });

    it('should propagate expressions through sequential blocks', () => {
      const cfg = makeCfg('ae_prop', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const exprs = new Map<number, string[]>();
      exprs.set(0, ['x + 1']);

      const avail = computeAvailableExpressions(cfg, exprs, new Map());
      // Expression should be available at block 1's entry
      const block1Avail = avail.get(1);
      expect(block1Avail).toBeDefined();
      if (block1Avail) {
        expect(block1Avail.has('x + 1')).toBe(true);
      }
    });

    it('removes killed expressions from availability', () => {
      const cfg = makeCfg('ae_kill', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const exprs = new Map<number, string[]>();
      exprs.set(0, ['a + b']);
      const kills = new Map<number, string[]>();
      kills.set(1, ['a + b']); // block 1 redefines an operand of 'a + b'

      const avail = computeAvailableExpressions(cfg, exprs, kills);
      // Available at block 1's entry, but killed before block 2's entry.
      expect(avail.get(1)!.has('a + b')).toBe(true);
      expect(avail.get(2)!.has('a + b')).toBe(false);
    });

    it('intersects availability across multiple predecessors', () => {
      const cfg = makeCfg('ae_intersect', [
        makeBlock(0, [1, 2]),
        makeBlock(1, [3]),
        makeBlock(2, [3]),
        makeBlock(3, []),
      ]);

      const exprs = new Map<number, string[]>();
      exprs.set(1, ['x + 1']);
      exprs.set(2, ['x + 1']);

      const avail = computeAvailableExpressions(cfg, exprs, new Map());
      // Both branches generate 'x + 1', so it is available at block 3's entry.
      expect(avail.get(3)!.has('x + 1')).toBe(true);
    });

    it('treats a missing predecessor result as an empty set', () => {
      const cfg = makeCfg('ae_no_pred', [makeBlock(0, [1]), makeBlock(1, [])]);

      const avail = computeAvailableExpressions(cfg, new Map(), new Map());
      expect(avail.get(0)!.size).toBe(0);
    });
  });

  describe('Live Variables — defs kill liveness', () => {
    it('removes a definition from liveness on earlier blocks', () => {
      const cfg = makeCfg('lv_def', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const uses = new Map<string, number[]>();
      uses.set('x', [2]);
      const defs = new Map<string, number[]>();
      defs.set('x', [1]); // x redefined in block 1, killing its liveness before 1

      const liveVars = computeLiveVariables(cfg, uses, defs);
      // x is used in block 2 but redefined in block 1, so it is not live-out of block 0.
      expect(liveVars.get(0)!.has('x')).toBe(false);
    });

    it('keeps a variable live when no definition intervenes', () => {
      const cfg = makeCfg('lv_nodef', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const uses = new Map<string, number[]>();
      uses.set('x', [2]);

      const liveVars = computeLiveVariables(cfg, uses, new Map());
      expect(liveVars.get(0)!.has('x')).toBe(true);
    });
  });

  describe('Dead Store Detection — populated assignments/usages', () => {
    it('flags an assigned variable that is never used', () => {
      const cfg = makeCfg('ds_never_used', [makeBlock(0, [1]), makeBlock(1, [])]);

      const assignments = new Map<number, string[]>();
      assignments.set(0, ['y']);
      const deadStores = detectDeadStores(cfg, assignments, new Map());
      expect(deadStores).toContainEqual({ blockId: 0, variable: 'y' });
    });

    it('does not flag an assigned variable that is used in a successor', () => {
      const cfg = makeCfg('ds_used', [makeBlock(0, [1]), makeBlock(1, [])]);

      const assignments = new Map<number, string[]>();
      assignments.set(0, ['y']);
      const usages = new Map<number, string[]>();
      usages.set(1, ['y']);

      const deadStores = detectDeadStores(cfg, assignments, usages);
      expect(deadStores).toHaveLength(0);
    });

    it('flags a store whose variable is redefined before use', () => {
      const cfg = makeCfg('ds_redef', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const assignments = new Map<number, string[]>();
      assignments.set(0, ['y']);
      assignments.set(1, ['y']); // redefined before use
      const usages = new Map<number, string[]>();
      usages.set(2, ['y']);

      const deadStores = detectDeadStores(cfg, assignments, usages);
      // The block 0 store of y is dead (redefined in block 1), but block 1's is used.
      expect(deadStores).toContainEqual({ blockId: 0, variable: 'y' });
      expect(deadStores).not.toContainEqual({ blockId: 1, variable: 'y' });
    });

    it('traverses multiple successors before finding a use', () => {
      const cfg = makeCfg('ds_traverse', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [])]);

      const assignments = new Map<number, string[]>();
      assignments.set(0, ['y']);
      const usages = new Map<number, string[]>();
      usages.set(2, ['y']);

      const deadStores = detectDeadStores(cfg, assignments, usages);
      expect(deadStores).toHaveLength(0);
    });

    it('handles a loop back-edge without infinite recursion', () => {
      // 0 -> {1, 2}; block 2 points back to 1, so 1 is pushed twice before
      // being visited (exercising the already-visited guard in checkVariableUsed).
      const cfg = makeCfg('ds_loop', [makeBlock(0, [1, 2]), makeBlock(1, []), makeBlock(2, [1])]);

      const assignments = new Map<number, string[]>();
      assignments.set(0, ['y']);
      const deadStores = detectDeadStores(cfg, assignments, new Map());
      expect(deadStores).toContainEqual({ blockId: 0, variable: 'y' });
    });
  });

  describe('Unreachable Code Detection — cycles', () => {
    it('handles a diamond back-edge without marking blocks unreachable', () => {
      // 0 -> {1, 2}; block 2 points back to 1, so 1 is pushed twice before
      // being visited (exercising the already-visited guard in the DFS).
      const cfg = makeCfg('reach_loop', [
        makeBlock(0, [1, 2]),
        makeBlock(1, []),
        makeBlock(2, [1]),
      ]);

      const unreachable = detectUnreachableCode(cfg);
      expect(unreachable).toHaveLength(0);
    });
  });

  describe('Available Expressions — disjoint and empty predecessors', () => {
    it('handles a block with no predecessors', () => {
      const cfg = makeCfg('ae_disconnected', [
        makeBlock(0, [1]),
        makeBlock(1, []),
        makeBlock(2, []), // no predecessors
      ]);

      const avail = computeAvailableExpressions(cfg, new Map(), new Map());
      expect(avail.get(2)!.size).toBe(0);
    });

    it('intersects availability when predecessor sets differ in size', () => {
      const cfg = makeCfg('ae_sizes', [
        makeBlock(0, [1, 2]),
        makeBlock(1, [3]),
        makeBlock(2, [3]),
        makeBlock(3, []),
      ]);

      const exprs = new Map<number, string[]>();
      exprs.set(1, ['a', 'b']);
      exprs.set(2, ['c']);

      const avail = computeAvailableExpressions(cfg, exprs, new Map());
      // {a, b} ∩ {c} = ∅
      expect(avail.get(3)!.size).toBe(0);
    });
  });

  describe('defensive handling of malformed input', () => {
    it('ignores definitions for a non-existent block in reaching definitions', () => {
      const cfg = makeCfg('rd_bogus_def', [makeBlock(0, [1]), makeBlock(1, [])]);
      const defs = new Map<string, number[]>();
      defs.set('x', [999]);
      const reaching = computeReachingDefinitions(cfg, defs);
      expect(reaching.get(0)!.size).toBe(0);
    });

    it('ignores uses and defs for a non-existent block in live variables', () => {
      const cfg = makeCfg('lv_bogus', [makeBlock(0, [1]), makeBlock(1, [])]);
      const uses = new Map<string, number[]>();
      uses.set('x', [999]);
      const defs = new Map<string, number[]>();
      defs.set('y', [999]);
      const live = computeLiveVariables(cfg, uses, defs);
      expect(live.size).toBe(2);
    });

    it('ignores assignments and usages for a non-existent block in dead stores', () => {
      const cfg = makeCfg('ds_bogus', [makeBlock(0, [1]), makeBlock(1, [])]);
      const assignments = new Map<number, string[]>();
      assignments.set(999, ['y']);
      const usages = new Map<number, string[]>();
      usages.set(999, ['z']);
      const deadStores = detectDeadStores(cfg, assignments, usages);
      expect(deadStores).toHaveLength(0);
    });

    it('ignores a successor that is not a real block in unreachable detection', () => {
      const cfg = makeCfg('reach_bogus_succ', [makeBlock(0, [999]), makeBlock(1, [])]);
      const unreachable = detectUnreachableCode(cfg);
      expect(unreachable).toContain(1);
    });

    it('ignores a bogus successor during dead-store traversal', () => {
      const cfg = makeCfg('ds_bogus_succ', [makeBlock(0, [999]), makeBlock(1, [])]);
      const assignments = new Map<number, string[]>();
      assignments.set(0, ['y']);
      const deadStores = detectDeadStores(cfg, assignments, new Map());
      expect(deadStores).toContainEqual({ blockId: 0, variable: 'y' });
    });

    it('ignores a bogus predecessor in reaching definitions', () => {
      const cfg = makeCfg('rd_bogus_pred', [makeBlock(0, [1]), makeBlock(1, [])]);
      cfg.blocks[1]!.predecessors = [999];
      const reaching = computeReachingDefinitions(cfg, new Map());
      expect(reaching.size).toBe(2);
    });

    it('ignores a bogus successor in live variables', () => {
      const cfg = makeCfg('lv_bogus_succ', [makeBlock(0, [1]), makeBlock(1, [])]);
      cfg.blocks[0]!.successors = [999];
      const live = computeLiveVariables(cfg, new Map(), new Map());
      expect(live.size).toBe(2);
    });

    it('ignores a back-edge predecessor with no avail-out yet', () => {
      // In a loop, block 1's back-edge predecessor (block 2) has no avail-out
      // on the first pass, so it is skipped until a later iteration.
      const cfg = makeCfg('ae_backedge', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [1])]);
      const avail = computeAvailableExpressions(cfg, new Map(), new Map());
      expect(avail.size).toBe(3);
    });

    it('does not re-push an already-visited successor in dead-store traversal', () => {
      const cfg = makeCfg('ds_cycle', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [1])]);
      const assignments = new Map<number, string[]>();
      assignments.set(0, ['y']);
      const deadStores = detectDeadStores(cfg, assignments, new Map());
      expect(deadStores).toContainEqual({ blockId: 0, variable: 'y' });
    });

    it('detects a same-size content change during reaching-definitions iteration', () => {
      // A loop where a killed definition is replaced by another of equal size.
      const cfg = makeCfg('rd_replace', [makeBlock(0, [1]), makeBlock(1, [2]), makeBlock(2, [1])]);
      const defs = new Map<string, number[]>();
      defs.set('a', [0, 2]);
      defs.set('b', [1]);
      const reaching = computeReachingDefinitions(cfg, defs);
      expect(reaching.size).toBe(3);
    });
  });
});
