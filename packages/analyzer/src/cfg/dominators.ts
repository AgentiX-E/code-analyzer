// @code-analyzer/analyzer — Dominator Analysis
// Computes dominators, immediate dominators, dominator trees, and
// dominance frontiers for Control Flow Graphs.
//
// Uses the Cooper-Harvey-Kennedy algorithm for computing dominators
// and immediate dominators in O(N²) worst-case, O(N log N) typical.

import type { ControlFlowGraph } from './cfg-types.js';

/**
 * Compute the set of dominators for each block in the CFG.
 * Block A dominates block B if every path from the entry block to B
 * must go through A.
 *
 * @param cfg - The control flow graph
 * @returns Map from block ID to the set of block IDs that dominate it
 */
export function computeDominators(cfg: ControlFlowGraph): Map<number, Set<number>> {
  const blockIds = cfg.blocks.map((b) => b.id);
  const n = cfg.blocks.length;

  if (n === 0) return new Map();

  // Initialize: entry block dominates only itself; all others dominate all blocks
  const dom = new Map<number, Set<number>>();
  const allBlocks = new Set(blockIds);

  for (const block of cfg.blocks) {
    if (block.id === cfg.entryBlockId) {
      dom.set(block.id, new Set([block.id]));
    } else {
      dom.set(block.id, new Set(allBlocks));
    }
  }

  // Iterate until fixed point
  let changed = true;
  while (changed) {
    changed = false;

    for (const block of cfg.blocks) {
      if (block.id === cfg.entryBlockId) continue;

      // New dominators = intersection of predecessors' dominators ∪ {block}
      const preds = cfg.blocks.filter((b) => b.successors.includes(block.id));
      if (preds.length === 0) continue;

      let newDom: Set<number> | null = null;

      for (const pred of preds) {
        const predDom = dom.get(pred.id);
        if (!predDom) continue;
        if (newDom === null) {
          newDom = new Set(predDom);
        } else {
          newDom = intersectSets(newDom, predDom);
        }
      }

      if (newDom === null) continue;
      newDom.add(block.id);

      const oldDom = dom.get(block.id);
      if (!oldDom || !setEquals(oldDom, newDom)) {
        dom.set(block.id, newDom);
        changed = true;
      }
    }
  }

  return dom;
}

/**
 * Compute the immediate dominator for each block.
 * The immediate dominator of block B is the unique node that strictly
 * dominates B but does not strictly dominate any other strict dominator of B.
 *
 * @param cfg - The control flow graph
 * @returns Map from block ID to its immediate dominator block ID.
 *          -1 indicates no immediate dominator (entry block).
 */
export function computeImmediateDominators(cfg: ControlFlowGraph): Map<number, number> {
  const dominators = computeDominators(cfg);
  const idom = new Map<number, number>();

  for (const block of cfg.blocks) {
    if (block.id === cfg.entryBlockId) {
      idom.set(block.id, -1);
      continue;
    }

    const doms = dominators.get(block.id);
    if (!doms || doms.size <= 1) {
      idom.set(block.id, -1);
      continue;
    }

    // Strict dominators: dominators excluding the block itself
    const strictDoms = new Set(doms);
    strictDoms.delete(block.id);

    // Immediate dominator: the strict dominator that dominates all other strict dominators
    let best: number | null = null;
    for (const d of strictDoms) {
      if (best === null) {
        best = d;
        continue;
      }

      const bestDoms = dominators.get(best);
      const currDoms = dominators.get(d);

      if (bestDoms && !bestDoms.has(d) && currDoms && currDoms.has(best)) {
        // d dominates best, so d is a better candidate (more "immediate")
        best = d;
      }
    }

    idom.set(block.id, best ?? -1);
  }

  return idom;
}

/**
 * Build a dominator tree from the CFG.
 * Returns a structure where each entry maps a block to the list of blocks
 * it immediately dominates (its children in the dominator tree).
 *
 * @param cfg - The control flow graph
 * @returns Object with `children` (Map<blockId, children[]>) and `parent` (Map<blockId, parent>)
 */
export function buildDominatorTree(cfg: ControlFlowGraph): {
  children: Map<number, number[]>;
  parent: Map<number, number>;
} {
  const idom = computeImmediateDominators(cfg);
  const children = new Map<number, number[]>();
  const parent = new Map<number, number>();

  for (const block of cfg.blocks) {
    children.set(block.id, []);
    parent.set(block.id, -1);
  }

  for (const [blockId, immediateDom] of idom) {
    if (immediateDom >= 0) {
      parent.set(blockId, immediateDom);
      const childList = children.get(immediateDom);
      if (childList) {
        childList.push(blockId);
      }
    }
  }

  return { children, parent };
}

/**
 * Compute dominance frontiers for all blocks in the CFG.
 * The dominance frontier of a block B is the set of blocks where B's
 * dominance stops: blocks that B does not strictly dominate but that
 * have a predecessor dominated by B.
 *
 * Used for SSA construction and control dependence analysis.
 *
 * @param cfg - The control flow graph
 * @returns Map from block ID to the set of blocks in its dominance frontier
 */
export function computeDominanceFrontiers(cfg: ControlFlowGraph): Map<number, Set<number>> {
  const frontiers = new Map<number, Set<number>>();
  const idom = computeImmediateDominators(cfg);

  // Initialize empty frontier for each block
  for (const block of cfg.blocks) {
    frontiers.set(block.id, new Set());
  }

  // For each edge A -> B in CFG:
  //   Walk up the dominator tree from A until we find an immediate
  //   dominator of B. Add each block along the way to B's frontier
  //   until we reach idom(B).
  for (const block of cfg.blocks) {
    const predDom = computeDominators(cfg);

    for (const succId of block.successors) {
      // Find all blocks whose frontier should include succId
      let runner = block.id;
      const succIdom = idom.get(succId);

      while (runner !== succIdom && runner >= 0) {
        const frontier = frontiers.get(runner);
        if (frontier) {
          frontier.add(succId);
        }
        runner = idom.get(runner) ?? -1;
      }
    }
  }

  return frontiers;
}

/**
 * Find back edges in the CFG (edges where the target dominates the source).
 * Back edges are essential for identifying loops.
 *
 * @param cfg - The control flow graph
 * @returns Array of [sourceId, targetId] pairs representing back edges
 */
export function findBackEdges(cfg: ControlFlowGraph): Array<[number, number]> {
  const backEdges: Array<[number, number]> = [];
  const dominators = computeDominators(cfg);

  for (const block of cfg.blocks) {
    for (const succId of block.successors) {
      const blockDoms = dominators.get(block.id);
      // Back edge: target dominates source → source's dominator set contains target
      if (blockDoms && succId !== block.id && blockDoms.has(succId)) {
        backEdges.push([block.id, succId]);
      }
    }
  }

  return backEdges;
}

/**
 * Identify natural loops in the CFG.
 * A natural loop has a single entry point (the loop header) and at
 * least one back edge to the header.
 *
 * @param cfg - The control flow graph
 * @returns Map from loop header block ID to array of block IDs in the loop
 */
export function findNaturalLoops(cfg: ControlFlowGraph): Map<number, number[]> {
  const loops = new Map<number, number[]>();
  const backEdges = findBackEdges(cfg);
  const dominators = computeDominators(cfg);

  for (const [sourceId, targetId] of backEdges) {
    // targetId is the loop header
    let loop = loops.get(targetId);
    if (!loop) {
      loop = [targetId];
      loops.set(targetId, loop);
    }

    // Add source to the loop if not already present
    if (!loop.includes(sourceId)) {
      loop.push(sourceId);
    }

    // Add all blocks between header and source on back-edge paths
    const stack = [sourceId];
    const visited = new Set<number>([targetId, sourceId]);

    while (stack.length > 0) {
      const current = stack.pop()!;
      const preds = cfg.blocks.filter((b) => b.successors.includes(current));

      for (const pred of preds) {
        if (!visited.has(pred.id)) {
          visited.add(pred.id);

          // Check if pred is dominated by the loop header
          const predDoms = dominators.get(pred.id);
          if (predDoms && predDoms.has(targetId)) {
            if (!loop!.includes(pred.id)) {
              loop!.push(pred.id);
            }
            stack.push(pred.id);
          }
        }
      }
    }
  }

  return loops;
}

// ---------------------------------------------------------------------------
// Set utilities
// ---------------------------------------------------------------------------

function intersectSets(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set<number>();
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const val of smaller) {
    if (larger.has(val)) result.add(val);
  }
  return result;
}

function setEquals(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const val of a) {
    if (!b.has(val)) return false;
  }
  return true;
}
