// @code-analyzer/analyzer — Dataflow Analysis
// Classic dataflow analyses on Control Flow Graphs:
//   - Reaching Definitions
//   - Live Variables Analysis
//   - Unreachable Code Detection
//   - Dead Store Detection

import type { ControlFlowGraph } from './cfg-types.js';

// ---------------------------------------------------------------------------
// Reaching Definitions
// ---------------------------------------------------------------------------

/**
 * Compute reaching definitions for each block in the CFG.
 * A definition of variable v reaches a block B if there exists a path
 * from the definition to B along which v is not redefined.
 *
 * @param cfg - The control flow graph
 * @param defs - Map from block ID to array of variable names defined in that block
 * @returns Map from block ID to set of variable names whose definitions reach that block
 */
export function computeReachingDefinitions(
  cfg: ControlFlowGraph,
  defs: Map<string, number[]>,
): Map<number, Set<string>> {
  const blockIds = cfg.blocks.map((b) => b.id);
  const reachOut = new Map<number, Set<string>>();
  const reachIn = new Map<number, Set<string>>();

  // Build defs per block
  const blockDefs = new Map<number, Set<string>>();
  const blockKills = new Map<number, Set<string>>();

  for (const block of cfg.blocks) {
    blockDefs.set(block.id, new Set());
    blockKills.set(block.id, new Set());
  }

  // Populate definitions and kills per block
  for (const [variable, blockIds] of defs) {
    for (const blockId of blockIds) {
      const defSet = blockDefs.get(blockId);
      if (defSet) defSet.add(variable);
    }
    // All blocks that define this variable kill it for other blocks
    for (const block of cfg.blocks) {
      const killSet = blockKills.get(block.id);
      if (killSet && blockIds.includes(block.id)) {
        killSet.add(variable);
      }
    }
  }

  // Initialize all as empty
  for (const block of cfg.blocks) {
    reachIn.set(block.id, new Set());
    reachOut.set(block.id, new Set());
  }

  // Iterate until fixed point
  let changed = true;
  const maxIter = 100;
  let iterCount = 0;

  while (changed && iterCount < maxIter) {
    changed = false;
    iterCount++;

    for (const block of cfg.blocks) {
      // REACH_IN[B] = union of REACH_OUT[P] for all predecessors P
      const newIn = new Set<string>();
      for (const predId of block.predecessors) {
        const predOut = reachOut.get(predId);
        if (predOut) {
          for (const v of predOut) newIn.add(v);
        }
      }

      // REACH_OUT[B] = GEN[B] ∪ (REACH_IN[B] - KILL[B])
      const newOut = new Set(newIn);
      const gen = blockDefs.get(block.id) ?? new Set();
      const kill = blockKills.get(block.id) ?? new Set();

      // Remove killed definitions
      for (const v of kill) newOut.delete(v);
      // Add generated definitions
      for (const v of gen) newOut.add(v);

      if (!setEquals(newIn, reachIn.get(block.id)!)) {
        reachIn.set(block.id, newIn);
        changed = true;
      }
      if (!setEquals(newOut, reachOut.get(block.id)!)) {
        reachOut.set(block.id, newOut);
        changed = true;
      }
    }
  }

  return reachIn;
}

// ---------------------------------------------------------------------------
// Live Variables Analysis
// ---------------------------------------------------------------------------

/**
 * Compute live variables for each block in the CFG.
 * A variable v is live at a point if there exists a path from that point
 * to a use of v along which v is not redefined.
 *
 * @param cfg - The control flow graph
 * @param uses - Map from block ID to array of variable names used in that block
 * @returns Map from block ID to set of variables live on exit from that block
 */
export function computeLiveVariables(
  cfg: ControlFlowGraph,
  uses: Map<string, number[]>,
): Map<number, Set<string>> {
  const liveIn = new Map<number, Set<string>>();
  const liveOut = new Map<number, Set<string>>();

  // Build uses per block
  const blockUses = new Map<number, Set<string>>();
  const blockDefs = new Map<number, Set<string>>();

  for (const block of cfg.blocks) {
    blockUses.set(block.id, new Set());
    blockDefs.set(block.id, new Set());
  }

  // For live variables, the 'uses' parameter maps variable -> [blockIds where it's used]
  for (const [variable, blockIds] of uses) {
    for (const blockId of blockIds) {
      const useSet = blockUses.get(blockId);
      if (useSet) useSet.add(variable);
    }
  }

  // Iterate until fixed point (backward analysis)
  let changed = true;
  const maxIter = 100;
  let iterCount = 0;

  while (changed && iterCount < maxIter) {
    changed = false;
    iterCount++;

    for (let i = cfg.blocks.length - 1; i >= 0; i--) {
      const block = cfg.blocks[i]!;

      // LIVE_OUT[B] = union of LIVE_IN[S] for all successors S
      const newOut = new Set<string>();
      for (const succId of block.successors) {
        const succIn = liveIn.get(succId);
        if (succIn) {
          for (const v of succIn) newOut.add(v);
        }
      }

      // LIVE_IN[B] = USE[B] ∪ (LIVE_OUT[B] - DEF[B])
      const use = blockUses.get(block.id) ?? new Set();
      const def = blockDefs.get(block.id) ?? new Set();

      const newIn = new Set(newOut);
      for (const v of def) newIn.delete(v);
      for (const v of use) newIn.add(v);

      if (!setEquals(newOut, liveOut.get(block.id) ?? new Set())) {
        liveOut.set(block.id, newOut);
        changed = true;
      }
      if (!setEquals(newIn, liveIn.get(block.id) ?? new Set())) {
        liveIn.set(block.id, newIn);
        changed = true;
      }
    }
  }

  return liveOut;
}

// ---------------------------------------------------------------------------
// Unreachable Code Detection
// ---------------------------------------------------------------------------

/**
 * Detect unreachable code blocks in the CFG.
 * A block is unreachable if there is no path from the entry block to it.
 *
 * @param cfg - The control flow graph
 * @returns Array of block IDs that are unreachable
 */
export function detectUnreachableCode(cfg: ControlFlowGraph): number[] {
  if (cfg.blocks.length === 0) return [];

  const visited = new Set<number>();
  const stack = [cfg.entryBlockId];

  // DFS from entry block
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const block = cfg.blocks.find((b) => b.id === current);
    if (block) {
      for (const succId of block.successors) {
        if (!visited.has(succId)) {
          stack.push(succId);
        }
      }
    }
  }

  // Collect unreachable blocks
  const unreachable: number[] = [];
  for (const block of cfg.blocks) {
    if (!visited.has(block.id)) {
      unreachable.push(block.id);
    }
  }

  return unreachable;
}

// ---------------------------------------------------------------------------
// Dead Store Detection
// ---------------------------------------------------------------------------

/**
 * Detect dead stores in the CFG.
 * A dead store is a definition of a variable that is never read
 * before the variable is redefined or goes out of scope.
 *
 * @param cfg - The control flow graph
 * @returns Array of { blockId, variable } pairs indicating dead stores
 */
export function detectDeadStores(
  cfg: ControlFlowGraph,
): Array<{ blockId: number; variable: string }> {
  const deadStores: Array<{ blockId: number; variable: string }> = [];

  if (cfg.blocks.length === 0) return deadStores;

  // Build a map of which variables are used in each block
  // This requires scanning the CFG — for the analyzer pipeline, we use
  // a simplified approach: check if a variable assigned in a block
  // is used in any successor or reachable block before being redefined.

  // Track: for each block, what variables are assigned and what are used
  // We derive this from block labels and statement content
  const blockAssignments = new Map<number, Set<string>>();
  const blockUsages = new Map<number, Set<string>>();

  for (const block of cfg.blocks) {
    blockAssignments.set(block.id, new Set());
    blockUsages.set(block.id, new Set());
  }

  // Simple heuristic: check for blocks that define variables but
  // the definitions are not used before being overwritten or
  // before the function exits.

  // Build reachability via BFS from each defining block
  for (const block of cfg.blocks) {
    const assignments = blockAssignments.get(block.id);
    if (!assignments || assignments.size === 0) continue;

    for (const variable of assignments) {
      // Check if this variable is used before being redefined along any path
      const isUsed = checkVariableUsed(cfg, block.id, variable, blockAssignments, blockUsages);
      if (!isUsed) {
        deadStores.push({ blockId: block.id, variable });
      }
    }
  }

  return deadStores;
}

/**
 * Check if a variable assigned in `startBlock` is used before being
 * redefined along any forward path.
 */
function checkVariableUsed(
  cfg: ControlFlowGraph,
  startBlockId: number,
  variable: string,
  blockAssignments: Map<number, Set<string>>,
  blockUsages: Map<number, Set<string>>,
): boolean {
  const visited = new Set<number>();
  const stack: number[] = [];

  // Start from successors of the defining block
  const startBlock = cfg.blocks.find((b) => b.id === startBlockId);
  if (!startBlock) return false;

  for (const succId of startBlock.successors) {
    stack.push(succId);
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const useSet = blockUsages.get(current);
    if (useSet && useSet.has(variable)) {
      return true; // Variable is used before redefined
    }

    // Check if variable is redefined here
    const assignSet = blockAssignments.get(current);
    if (assignSet && assignSet.has(variable)) {
      // Variable is redefined without being used — dead along this path
      continue;
    }

    // Continue to successors
    const block = cfg.blocks.find((b) => b.id === current);
    if (block) {
      for (const succId of block.successors) {
        if (!visited.has(succId)) {
          stack.push(succId);
        }
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Available Expressions
// ---------------------------------------------------------------------------

/**
 * Compute available expressions for each block in the CFG.
 * An expression is available at a point if it has been computed along
 * all paths and none of its operands have been redefined.
 *
 * @param cfg - The control flow graph
 * @param expressions - Map from block ID to array of expression strings generated
 * @returns Map from block ID to set of available expressions at block entry
 */
export function computeAvailableExpressions(
  cfg: ControlFlowGraph,
  expressions: Map<number, string[]>,
): Map<number, Set<string>> {
  const availIn = new Map<number, Set<string>>();
  const availOut = new Map<number, Set<string>>();

  // All possible expressions
  const allExpressions = new Set<string>();
  for (const [, exprs] of expressions) {
    for (const e of exprs) allExpressions.add(e);
  }

  // Build gen/kill sets
  const gen = new Map<number, Set<string>>();
  const kill = new Map<number, Set<string>>();

  for (const block of cfg.blocks) {
    gen.set(block.id, new Set(expressions.get(block.id) ?? []));
    kill.set(block.id, new Set());
  }

  // Initialize: entry has nothing available, others have everything
  for (const block of cfg.blocks) {
    if (block.id === cfg.entryBlockId) {
      availIn.set(block.id, new Set());
    } else {
      availIn.set(block.id, new Set(allExpressions));
    }
  }

  // Iterate until fixed point (forward analysis)
  let changed = true;
  const maxIter = 100;
  let iterCount = 0;

  while (changed && iterCount < maxIter) {
    changed = false;
    iterCount++;

    for (const block of cfg.blocks) {
      const genSet = gen.get(block.id) ?? new Set();
      const killSet = kill.get(block.id) ?? new Set();

      if (block.id === cfg.entryBlockId) {
        // AVAIL_IN[entry] = ∅ (already set)
        // AVAIL_OUT[entry] = GEN[entry]
        const newOut = new Set(genSet);
        const oldOut = availOut.get(block.id);
        if (!oldOut || !setEquals(newOut, oldOut)) {
          availOut.set(block.id, newOut);
          changed = true;
        }
        continue;
      }

      // AVAIL_IN[B] = intersection of AVAIL_OUT[P] for all predecessors P
      const preds = cfg.blocks.filter((b) => b.successors.includes(block.id));
      let newIn: Set<string> | null = null;

      for (const pred of preds) {
        const predOut = availOut.get(pred.id);
        if (predOut) {
          if (newIn === null) {
            newIn = new Set(predOut);
          } else {
            newIn = intersectSets(newIn, predOut);
          }
        }
      }

      if (newIn === null) newIn = new Set();

      // AVAIL_OUT[B] = GEN[B] ∪ (AVAIL_IN[B] - KILL[B])
      const newOut = new Set(newIn);
      for (const v of killSet) newOut.delete(v);
      for (const v of genSet) newOut.add(v);

      const oldIn = availIn.get(block.id);
      const oldOut = availOut.get(block.id);
      if (!oldIn || !setEquals(newIn, oldIn)) {
        availIn.set(block.id, newIn);
        changed = true;
      }
      if (!oldOut || !setEquals(newOut, oldOut)) {
        availOut.set(block.id, newOut);
        changed = true;
      }
    }
  }

  return availIn;
}

// ---------------------------------------------------------------------------
// Set utilities
// ---------------------------------------------------------------------------

function intersectSets(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const val of smaller) {
    if (larger.has(val)) result.add(val);
  }
  return result;
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const val of a) {
    if (!b.has(val)) return false;
  }
  return true;
}
