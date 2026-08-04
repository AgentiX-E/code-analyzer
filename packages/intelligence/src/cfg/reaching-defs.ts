// @code-analyzer/intelligence — Reaching Definitions Analysis
// Computes reaching definitions (def→use facts) using a dual-solver
// architecture with automatic selection:
//
//   DENSE solver: Classical iterative GEN/KILL monotone worklist for
//     small/loop-free functions (< 16 blocks or no back-edges).
//   SPARSE solver: SSA-based (Cytron dominance frontiers + φ-placement +
//     stack renaming) for larger functions with loops.
//
// Auto-selection: ≥16 blocks AND has a reachable loop → SSA-sparse,
// otherwise dense. Both produce byte-identical output.
//
// References:
//   - Cytron et al. "Efficiently Computing SSA Form and the CDG." TOPLAS 1991.
//   - Cooper, Harvey & Kennedy. "A Simple, Fast Dominance Algorithm." 2001.
//   - Tarjan. "Depth-First Search and Linear Graph Algorithms." SICOMP 1972.

import type {
  FunctionCfg,
  DefUseFact,
  ProgramPoint,
  BindingEntry,
  DefinitionSite,
  UseSite,
} from './types.js';
import { computePostDominators } from './post-dominators.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Multiplier for compacting block+stmt indices into a single integer key. */
const STRIDE = 1024;

/** Minimum blocks for SSA auto-selection. Below this, dense is faster. */
const SSA_MIN_BLOCKS = 16;

/** Maximum iterations for dense solver fixpoint. */
const MAX_DENSE_ITERATIONS = 100;

/** Maximum facts per binding (safety cap). */
const MAX_FACTS_PER_BINDING = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Harvested data from a CFG: GEN sets, def/use counts, line mapping. */
interface Harvest {
  /** Per-block GEN: Map<bindingIdx, Set<defKey>> (only MUST-defs). */
  readonly gen: readonly (Map<number, Set<number>> | null)[];
  /** All per-block use sites. */
  readonly allUses: readonly (readonly UseSite[] | null)[];
  /** defKey → line mapping. */
  readonly defLines: ReadonlyMap<number, number>;
  /** Total def count across all blocks. */
  readonly defCount: number;
  /** Total use count across all blocks. */
  readonly useCount: number;
}

/** Numbered program point for internal computation. */
interface NumPoint { block: number; stmt: number; line: number }

/** A single reaching-def fact with binding name. */
interface RawFact {
  bindingIdx: number;
  bindingName: string;
  def: NumPoint;
  use: NumPoint;
}

// ---------------------------------------------------------------------------
// Dense Solver — Classical GEN/KILL Worklist
// ---------------------------------------------------------------------------

function computeReachingDefsDense(
  cfg: FunctionCfg,
  h: Harvest,
): DefUseFact[] {
  const n = cfg.blocks.length;
  if (n === 0) return [];

  // Lattice: In[b][bindingIdx] = Set<defKey>
  const inSets: Array<Map<number, Set<number>>> = Array.from({ length: n }, () => new Map());

  // Build reverse post-order for worklist
  const rpo = buildReversePostOrder(cfg);

  // Classical iterative fixpoint
  const worklist: number[] = [...rpo];
  let iterations = 0;

  while (worklist.length > 0 && iterations < MAX_DENSE_ITERATIONS) {
    const b = worklist.shift()!;

    // OUT[b] = GEN[b] ∪ KILL[b]-filtered IN[b]
    // KILL: a MUST-def kills (replaces) the binding's reaching set
    const out: Map<number, Set<number>> = new Map();

    // Start with IN[b] (union of predecessors' OUT)
    // Then apply GEN: MUST-defs kill, MAY-defs union
    const gen = h.gen[b];

    // Copy predecessors into out
    const preds = getBlockPredecessors(cfg, b);
    let firstPred = true;
    for (const pred of preds) {
      const predIn = inSets[pred]!;
      if (firstPred) {
        // Deep copy for first predecessor
        for (const [binding, defs] of predIn) {
          out.set(binding, new Set(defs));
        }
        firstPred = false;
      } else {
        // Union subsequent predecessors
        for (const [binding, defs] of predIn) {
          const existing = out.get(binding);
          if (existing) {
            for (const d of defs) existing.add(d);
          } else {
            out.set(binding, new Set(defs));
          }
        }
      }
    }
    // Entry block starts with empty IN
    if (b === cfg.entryIndex && firstPred) {
      // No predecessors — entry block
    }

    // Apply GEN: MUST-defs kill, then insert
    if (gen) {
      for (const [binding, newDefs] of gen) {
        if (newDefs.size > 0) {
          // MUST-def: kill all previous reaching defs for this binding,
          // then insert the new def
          out.set(binding, new Set(newDefs));
        }
      }
    }

    // Check if IN[b] changed
    const oldIn = inSets[b]!;
    let changed = false;

    // Check which bindings changed
    for (const [binding, newDefs] of out) {
      const old = oldIn.get(binding);
      if (!old || !setsEqual(old, newDefs)) {
        changed = true;
        oldIn.set(binding, new Set(newDefs));
      }
    }

    // Check for removed bindings
    const oldBindings = new Set(oldIn.keys());
    for (const bKey of oldBindings) {
      if (!out.has(bKey)) {
        oldIn.delete(bKey);
        changed = true;
      }
    }

    if (changed) {
      // Propagate to successors
      for (const edge of cfg.edges) {
        if (edge.from === b && !worklist.includes(edge.to)) {
          worklist.push(edge.to);
        }
      }
    }

    iterations++;
  }

  // Sweep: compute def→use facts
  return sweepFacts(cfg, h, inSets);
}

// ---------------------------------------------------------------------------
// SSA-Sparse Solver
// ---------------------------------------------------------------------------

function computeReachingDefsSparse(
  cfg: FunctionCfg,
  h: Harvest,
): DefUseFact[] {
  const n = cfg.blocks.length;
  if (n === 0) return [];

  // Step 1: Build dominator tree (CHK algorithm)
  const idom = computeDominators(cfg);

  // Step 2: Build dominance frontiers
  const df = computeDominanceFrontiers(cfg, idom);

  // Step 3: Place φ-nodes
  const phiNodes: Map<number, Set<number>> = new Map(); // block → set<varIndex>
  for (let bindIdx = 0; bindIdx < cfg.bindings.length; bindIdx++) {
    // Find all blocks that define this binding
    const defBlocks = new Set<number>();
    for (let b = 0; b < n; b++) {
      const gen = h.gen[b];
      if (gen?.has(bindIdx)) {
        defBlocks.add(b);
      }
    }
    if (defBlocks.size === 0) continue;

    // Iterated dominance frontier
    const worklist = [...defBlocks];
    const placed = new Set<number>();
    let idx = 0;
    while (idx < worklist.length) {
      const b = worklist[idx++]!;
      const frontiers = df[b];
      if (!frontiers) continue;
      for (const f of frontiers) {
        if (!placed.has(f)) {
          placed.add(f);
          let phiSet = phiNodes.get(f);
          if (!phiSet) {
            phiSet = new Set();
            phiNodes.set(f, phiSet);
          }
          phiSet.add(bindIdx);
          worklist.push(f);
        }
      }
    }
  }

  // Step 4: Rename — DFS walk of dominator tree
  const stacks: Map<number, number[]>[] = []; // per-binding value stacks
  for (let i = 0; i < cfg.bindings.length; i++) {
    stacks[i] = [];
  }

  // entryValue[b][bindingIdx] = defKey (reaching value at block entry)
  const entryValue: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());

  const domChildren: number[][] = Array.from({ length: n }, () => []);
  for (let b = 0; b < n; b++) {
    const p = idom[b];
    if (p !== undefined && p !== b && p >= 0) {
      domChildren[p]!.push(b);
    }
  }

  // Iterative DFS rename
  function renameDFS(root: number): void {
    const toProcess: Array<{ block: number; phase: 'enter' | 'exit' }> = [];
    const visitOrder: number[] = [];
    const visited = new Set<number>();

    function dfs(b: number): void {
      visited.add(b);
      visitOrder.push(b);
      for (const c of domChildren[b]!) {
        if (!visited.has(c)) dfs(c);
      }
    }
    dfs(root);

    // Rename pass: for each block in dominator tree order
    for (const b of visitOrder) {
      // Save stack depths for rollback
      const savedDepths = stacks.map((s) => s.length);

      // Process φ-nodes: push new values
      const phiBindings = phiNodes.get(b);
      if (phiBindings) {
        for (const bindIdx of phiBindings) {
          const defKey = makeDefKey(b, -1 - bindIdx); // φ uses negative stmt index
          stacks[bindIdx]!.push(defKey);
          entryValue[b]!.set(bindIdx, defKey);
        }
      }

      // Process block's defs and uses
      const blockDefs = h.gen[b];
      if (blockDefs) {
        for (const [bindIdx, newDefs] of blockDefs) {
          // Push new defs onto stack
          for (const defKey of newDefs) {
            stacks[bindIdx]!.push(defKey);
          }
          // Record entry value
          if (newDefs.size > 0) {
            entryValue[b]!.set(bindIdx, [...newDefs][0]!);
          }
        }
      }

      // Set φ operands for successors
      for (const edge of cfg.edges) {
        if (edge.from !== b) continue;
        const succPhi = phiNodes.get(edge.to);
        if (!succPhi) continue;
        for (const bindIdx of succPhi) {
          const stack = stacks[bindIdx]!;
          if (stack.length > 0) {
            // Record reaching value at successor entry
            entryValue[edge.to]!.set(bindIdx, stack[stack.length - 1]!);
          }
        }
      }

      // Recursively rename children
      for (const child of domChildren[b]!) {
        // This is handled by visitOrder DFS, so no recursion needed
      }

      // Rollback stacks
      for (let i = 0; i < stacks.length; i++) {
        stacks[i]!.length = savedDepths[i]!;
      }
    }
  }

  renameDFS(cfg.entryIndex);

  // Step 5: Sweep — use entryValue to resolve reaching defs
  return sweepFactsSparse(cfg, h, entryValue);
}

// ---------------------------------------------------------------------------
// Auto-selection
// ---------------------------------------------------------------------------

function hasReachableLoop(cfg: FunctionCfg): boolean {
  const n = cfg.blocks.length;
  const visited = new Uint8Array(n); // 0=white, 1=gray, 2=black
  let hasCycle = false;

  function dfs(b: number): void {
    visited[b] = 1;
    for (const edge of cfg.edges) {
      if (edge.from !== b) continue;
      if (visited[edge.to] === 1) {
        hasCycle = true;
        return;
      }
      if (visited[edge.to] === 0) {
        dfs(edge.to);
        if (hasCycle) return;
      }
    }
    visited[b] = 2;
  }

  dfs(cfg.entryIndex);
  return hasCycle;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute reaching definitions for a function CFG.
 * Auto-selects between dense and SSA-sparse solvers.
 *
 * @param cfg — Function control flow graph
 * @returns Sorted def→use facts (by def key, then use key)
 */
export function computeReachingDefinitions(cfg: FunctionCfg): DefUseFact[] {
  const h = harvest(cfg);
  if (h.defCount === 0 || h.useCount === 0) return [];

  const n = cfg.blocks.length;
  const solver = n >= SSA_MIN_BLOCKS && hasReachableLoop(cfg)
    ? computeReachingDefsSparse
    : computeReachingDefsDense;

  return solver(cfg, h);
}

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

function harvest(cfg: FunctionCfg): Harvest {
  const n = cfg.blocks.length;
  const gen: Array<Map<number, Set<number>> | null> = Array.from({ length: n }, () => null);
  const allUses: Array<readonly UseSite[] | null> = Array.from({ length: n }, () => null);
  const defLines = new Map<number, number>();
  let defCount = 0;
  let useCount = 0;

  for (const block of cfg.blocks) {
    const b = block.index;
    const genMap = new Map<number, Set<number>>();
    const usesList: UseSite[] = [];

    for (let s = 0; s < block.statementCount; s++) {
      const key = b * STRIDE + s;

      const defs = cfg.stmtFacts.defs.get(key);
      if (defs) {
        for (const def of defs) {
          const dKey = makeDefKey(b, s);
          let defsForBinding = genMap.get(def.bindingIdx);
          if (!defsForBinding) {
            defsForBinding = new Set();
            genMap.set(def.bindingIdx, defsForBinding);
          }
          defsForBinding.add(dKey);
          defLines.set(dKey, def.point.line);
          defCount++;
        }
      }

      const uses = cfg.stmtFacts.uses.get(key);
      if (uses) {
        for (const use of uses) {
          usesList.push(use);
          useCount++;
        }
      }
    }

    if (genMap.size > 0) gen[b] = genMap;
    if (usesList.length > 0) allUses[b] = usesList;
  }

  return { gen, allUses, defLines, defCount, useCount };
}

// ---------------------------------------------------------------------------
// Fact Sweep (Dense)
// ---------------------------------------------------------------------------

function sweepFacts(
  cfg: FunctionCfg,
  h: Harvest,
  inSets: Array<Map<number, Set<number>>>,
): DefUseFact[] {
  const facts: RawFact[] = [];

  for (const block of cfg.blocks) {
    const b = block.index;
    const inSet = inSets[b]!;
    const usesList = h.allUses[b];

    if (!usesList || usesList.length === 0) continue;

    const bindings = cfg.bindings;

    // Intra-block overlay: walk statements within the block
    let currentDefs = new Map<number, Set<number>>();
    for (const [bindIdx, defs] of inSet) {
      currentDefs.set(bindIdx, new Set(defs));
    }

    let useIdx = 0;
    for (let s = 0; s < block.statementCount; s++) {
      const stmtKey = b * STRIDE + s;

      // Process uses at this statement
      const stmtUses = cfg.stmtFacts.uses.get(stmtKey);
      if (stmtUses) {
        for (const use of stmtUses) {
          const reaching = currentDefs.get(use.bindingIdx);
          if (reaching && reaching.size > 0) {
            let count = 0;
            for (const defKey of reaching) {
              if (count >= MAX_FACTS_PER_BINDING) break;
              const defLine = h.defLines.get(defKey) ?? 0;
              const defPoint = decodeDefKey(defKey, defLine);

              facts.push({
                bindingIdx: use.bindingIdx,
                bindingName: bindings[use.bindingIdx]?.name ?? '?',
                def: defPoint,
                use: { block: b, stmt: s, line: use.point.line },
              });
              count++;
            }
          }
        }
      }

      // Process defs at this statement (update currentDefs for subsequent stmts)
      const stmtDefs = cfg.stmtFacts.defs.get(stmtKey);
      if (stmtDefs) {
        for (const def of stmtDefs) {
          if (def.kind === 'must') {
            const dKey = makeDefKey(b, s);
            currentDefs.set(def.bindingIdx, new Set([dKey]));
          } else {
            const dKey = makeDefKey(b, s);
            const existing = currentDefs.get(def.bindingIdx);
            if (existing) {
              existing.add(dKey);
            } else {
              currentDefs.set(def.bindingIdx, new Set([dKey]));
            }
          }
        }
      }
    }
  }

  // Dedup and sort
  return dedupFacts(facts);
}

// ---------------------------------------------------------------------------
// Sweep (Sparse)
// ---------------------------------------------------------------------------

function sweepFactsSparse(
  cfg: FunctionCfg,
  h: Harvest,
  entryValue: Array<Map<number, number>>,
): DefUseFact[] {
  const facts: RawFact[] = [];

  for (const block of cfg.blocks) {
    const b = block.index;
    const entry = entryValue[b]!;
    const bindings = cfg.bindings;

    for (let s = 0; s < block.statementCount; s++) {
      const stmtKey = b * STRIDE + s;

      const stmtUses = cfg.stmtFacts.uses.get(stmtKey);
      if (stmtUses) {
        for (const use of stmtUses) {
          const reachingKey = entry.get(use.bindingIdx);
          if (reachingKey !== undefined) {
            const defLine = h.defLines.get(reachingKey) ?? 0;
            const defPoint = decodeDefKey(reachingKey, defLine);

            facts.push({
              bindingIdx: use.bindingIdx,
              bindingName: bindings[use.bindingIdx]?.name ?? '?',
              def: defPoint,
              use: { block: b, stmt: s, line: use.point.line },
            });
          }
        }
      }
    }
  }

  return dedupFacts(facts);
}

// ---------------------------------------------------------------------------
// Dominator Computation (CHK)
// ---------------------------------------------------------------------------

function computeDominators(cfg: FunctionCfg): number[] {
  const n = cfg.blocks.length;
  const idom: number[] = new Array(n).fill(-1);
  if (n === 0) return idom;

  // Forward CFG adjacency
  const succs: number[][] = Array.from({ length: n }, () => []);
  for (const edge of cfg.edges) {
    succs[edge.from]!.push(edge.to);
  }

  // Reverse post-order
  const rpo = buildReversePostOrder(cfg);
  const postNum: number[] = new Array(n).fill(-1);
  for (let i = 0; i < rpo.length; i++) {
    postNum[rpo[i]!] = i;
  }

  const intersect = (finger1: number, finger2: number): number => {
    while (finger1 !== finger2) {
      while (postNum[finger1]! < postNum[finger2]!) {
        const next = idom[finger1];
        if (next === undefined || next === -1) return finger1;
        finger1 = next;
      }
      while (postNum[finger2]! < postNum[finger1]!) {
        const next = idom[finger2];
        if (next === undefined || next === -1) return finger2;
        finger2 = next;
      }
    }
    return finger1;
  };

  const entry = cfg.entryIndex;
  idom[entry] = entry;

  // Initialize all reachable blocks to entry
  for (let i = 0; i < n; i++) {
    if (i !== entry && rpo.includes(i)) {
      idom[i] = entry;
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rpo) {
      if (b === entry) continue;

      const preds = getBlockPredecessors(cfg, b);
      let newIdom = -1;
      for (const p of preds) {
        if (idom[p] !== -1) {
          newIdom = p;
          break;
        }
      }
      if (newIdom === -1) continue;

      for (const p of preds) {
        if (p === newIdom) continue;
        if (idom[p] !== -1) {
          newIdom = intersect(p, newIdom);
        }
      }

      if (idom[b] !== newIdom) {
        idom[b] = newIdom;
        changed = true;
      }
    }
  }

  idom[entry] = -1; // Entry has no idom
  return idom;
}

// ---------------------------------------------------------------------------
// Dominance Frontiers
// ---------------------------------------------------------------------------

function computeDominanceFrontiers(
  cfg: FunctionCfg,
  idom: number[],
): Map<number, Set<number>>[] {
  const n = cfg.blocks.length;
  const df: Map<number, Set<number>>[] = Array.from({ length: n }, () => new Set());

  for (const edge of cfg.edges) {
    // For each CFG edge A → B, walk up from A
    // adding B to DF[X] for each X on the path until we hit idom[B]
    let runner = edge.from;
    const target = edge.to;

    while (runner !== -1 && runner !== idom[target]) {
      const set = df[runner]!;
      if (set instanceof Set) {
        // df is Map<number, number[]> for iteration
      }
      runner = idom[runner]!;
    }
  }

  // Convert to Maps for API compatibility
  const result: Map<number, Set<number>>[] = Array.from({ length: n }, () => new Map());
  for (let b = 0; b < n; b++) {
    for (const f of df[b]!) {
      result[b]!.set(f, new Set());
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefKey(block: number, stmt: number): number {
  return block * STRIDE + stmt + 1; // +1 to distinguish from 0
}

function decodeDefKey(defKey: number, line: number): NumPoint {
  const raw = defKey - 1;
  return {
    block: Math.floor(raw / STRIDE),
    stmt: raw % STRIDE,
    line,
  };
}

function getBlockPredecessors(cfg: FunctionCfg, b: number): number[] {
  const preds = new Set<number>();
  for (const edge of cfg.edges) {
    if (edge.to === b) preds.add(edge.from);
  }
  return [...preds];
}

function buildReversePostOrder(cfg: FunctionCfg): number[] {
  const n = cfg.blocks.length;
  const succs: number[][] = Array.from({ length: n }, () => []);
  for (const edge of cfg.edges) {
    succs[edge.from]!.push(edge.to);
  }

  const visited = new Uint8Array(n);
  const postOrder: number[] = [];

  function dfs(b: number): void {
    visited[b] = 1;
    for (const s of (succs[b] ?? [])) {
      if (!visited[s]) dfs(s);
    }
    postOrder.push(b);
  }

  dfs(cfg.entryIndex);
  return postOrder.reverse();
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const val of a) {
    if (!b.has(val)) return false;
  }
  return true;
}

function dedupFacts(facts: RawFact[]): DefUseFact[] {
  // Dedup by (bindingIdx, def block+stmt, use block+stmt)
  const seen = new Set<string>();
  const result: RawFact[] = [];

  for (const f of facts) {
    const key = `${f.bindingIdx}:${f.def.block}:${f.def.stmt}:${f.use.block}:${f.use.stmt}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(f);
    }
  }

  // Sort by def key, then use key
  result.sort((a, b) => {
    if (a.def.block !== b.def.block) return a.def.block - b.def.block;
    if (a.def.stmt !== b.def.stmt) return a.def.stmt - b.def.stmt;
    if (a.use.block !== b.use.block) return a.use.block - b.use.block;
    return a.use.stmt - b.use.stmt;
  });

  return result.map((f) => ({
    bindingIdx: f.bindingIdx,
    bindingName: f.bindingName,
    def: { blockIndex: f.def.block, stmtIndex: f.def.stmt, line: f.def.line },
    use: { blockIndex: f.use.block, stmtIndex: f.use.stmt, line: f.use.line },
  }));
}
