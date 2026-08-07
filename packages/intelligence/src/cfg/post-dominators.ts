// @code-analyzer/intelligence — Post-Dominator Tree
// Computes immediate post-dominators using the Cooper-Harvey-Kennedy
// "A Simple, Fast Dominance Algorithm" (2001) run on the REVERSE CFG
// rooted at the EXIT block.
//
// Post-dominators are exactly the DOMINATORS of the REVERSE CFG
// rooted at EXIT. We use CHK over Lengauer-Tarjan because per-function
// CFGs are typically small (<100 blocks) and CHK has lower constant
// factors with simpler implementation.

import type { FunctionCfg, PostDomTree } from './types.js';

/** Sentinel value for no immediate post-dominator. */
export const NO_IPDOM = -1;

// ---------------------------------------------------------------------------
// Core Algorithm
// ---------------------------------------------------------------------------

/**
 * Compute the immediate post-dominator tree for a function CFG.
 *
 * Algorithm: Cooper-Harvey-Kennedy (CHK) on the reverse CFG.
 *   - Post-dominators are computed as dominators of the reverse CFG.
 *   - The reverse CFG is built from CFG edges reversed, rooted at EXIT.
 *   - Unreachable blocks (from EXIT in reverse) get NO_IPDOM.
 *
 * Complexity: O(N²) worst case, O(N × log N) typical.
 *
 * @param cfg — Function control flow graph
 * @returns Post-dominator tree
 */
export function computePostDominators(cfg: FunctionCfg): PostDomTree {
  const n = cfg.blocks.length;
  if (n === 0) return { ipdom: [] };

  // Build reverse CFG adjacency: reverseSuccs[b] = blocks that have edges TO b
  // (these are the successors in the reverse CFG)
  const revSuccs: number[][] = Array.from({ length: n }, () => []);
  for (const edge of cfg.edges) {
    revSuccs[edge.to]!.push(edge.from);
  }

  // Build predecessor list for the reverse CFG (needed for CHK algorithm)
  // predsInRevCfg[b] = predecessors of b in the reverse CFG
  // = blocks c where revSuccs[c] contains b
  const predsInRevCfg: number[][] = Array.from({ length: n }, () => []);
  for (let b = 0; b < n; b++) {
    for (const succ of revSuccs[b]!) {
      predsInRevCfg[succ]!.push(b);
    }
  }

  // Post-order traversal of the reverse CFG starting from EXIT
  const postOrder = computeReversePostOrder(revSuccs, cfg.exitIndex, n);

  // Intersect operation: walk up the dominator chain
  // Find the deepest common ancestor in the ipdom tree
  const intersect = (finger1: number, finger2: number, ipdom: number[], postNum: number[]): number => {
    while (finger1 !== finger2) {
      let moved = false;
      // Climb the finger that is further from root (higher postnum = processed later)
      while (postNum[finger1]! < postNum[finger2]!) {
        const next = ipdom[finger1]!;
        if (next === finger1 || next === NO_IPDOM) break; // reached root
        finger1 = next;
        moved = true;
      }
      while (postNum[finger2]! < postNum[finger1]!) {
        const next = ipdom[finger2]!;
        if (next === finger2 || next === NO_IPDOM) break;
        finger2 = next;
        moved = true;
      }
      // If neither finger moved, both are at roots — converge
      if (!moved) break;
    }
    return finger1;
  };

  // Map block → post-order number (position in reverse post-order)
  const postNum: number[] = new Array(n).fill(-1);
  for (let i = 0; i < postOrder.length; i++) {
    postNum[postOrder[i]!] = i;
  }

  // Initialize: all reachable blocks start with ipdom = exit
  const ipdom: number[] = new Array(n).fill(NO_IPDOM);
  const exitBlock = cfg.exitIndex;
  if (exitBlock < 0 || exitBlock >= n) return { ipdom };

  // Seed: EXIT dominates itself (temporarily, will be reset)
  ipdom[exitBlock] = exitBlock;

  // Flag for reachability in the reverse CFG
  const reachable = new Set<number>(postOrder);

  // Initialize reachable non-exit blocks to exit
  for (let i = 0; i < n; i++) {
    if (i !== exitBlock && reachable.has(i)) {
      ipdom[i] = exitBlock;
    }
  }

  // CHK fixpoint iteration
  let changed = true;
  while (changed) {
    changed = false;

    // Iterate in reverse post-order (skip root)
    for (let i = 0; i < postOrder.length; i++) {
      const b = postOrder[i]!;
      if (b === exitBlock) continue; // skip root
      if (!reachable.has(b)) continue;

      // Find first processed predecessor in reverse CFG
      let newIdom = NO_IPDOM;
      for (const pred of predsInRevCfg[b]!) {
        if (ipdom[pred] !== NO_IPDOM) {
          newIdom = pred;
          break;
        }
      }
      if (newIdom === NO_IPDOM) continue;

      // Intersect all other processed predecessors
      for (const pred of predsInRevCfg[b]!) {
        if (pred === newIdom) continue;
        if (ipdom[pred] !== NO_IPDOM) {
          newIdom = intersect(pred, newIdom, ipdom, postNum);
        }
      }

      if (ipdom[b] !== newIdom) {
        ipdom[b] = newIdom;
        changed = true;
      }
    }
  }

  // Reset: EXIT has NO_IPDOM (it has no post-dominator)
  /* v8 ignore next — exit block is always present in a valid CFG */
  if (exitBlock >= 0 && exitBlock < n) {
    ipdom[exitBlock] = NO_IPDOM;
  }

  return { ipdom };
}

/**
 * Post-dominates check: does block p post-dominate block b?
 * Walks up the ipdom chain from b. Zero-allocation.
 */
export function postDominates(tree: PostDomTree, p: number, b: number): boolean {
  const { ipdom } = tree;
  let current = b;
  // Walk up the ipdom chain
  for (let safety = 0; safety < ipdom.length; safety++) {
    if (current === p) return true;
    const next = ipdom[current]!;
    if (next === NO_IPDOM) return false;
    if (next === current) return false; // cycle guard
    current = next;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Post-order Computation
// ---------------------------------------------------------------------------

/**
 * Compute reverse post-order (i.e., post-order of the REVERSE CFG)
 * starting from EXIT block. Uses iterative DFS with explicit stack
 * to avoid recursion stack overflow on large CFGs.
 */
function computeReversePostOrder(
  revSuccs: number[][],
  exitIndex: number,
  n: number,
): number[] {
  const postOrder: number[] = [];
  if (exitIndex < 0 || exitIndex >= n) return postOrder;

  const visited = new Uint8Array(n);
  const stack: Array<{ node: number; nextChild: number }> = [];

  // Start DFS from EXIT
  visited[exitIndex] = 1;
  stack.push({ node: exitIndex, nextChild: 0 });

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const children = revSuccs[frame.node]!;

    let found = false;
    while (frame.nextChild < children.length) {
      const child = children[frame.nextChild]!;
      frame.nextChild++;
      if (!visited[child]) {
        visited[child] = 1;
        stack.push({ node: child, nextChild: 0 });
        found = true;
        break;
      }
    }

    if (!found) {
      postOrder.push(frame.node);
      stack.pop();
    }
  }

  // PostOrder.reverse() = Reverse Post Order
  return postOrder.reverse();
}
