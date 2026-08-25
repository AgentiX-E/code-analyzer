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
interface NumPoint {
  block: number;
  stmt: number;
  line: number;
}

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

function computeReachingDefsDense(cfg: FunctionCfg, h: Harvest): DefUseFact[] {
  const n = cfg.blocks.length;
  /* v8 ignore next — guarded upstream: computeReachingDefinitions returns early when def/use counts are zero */
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

    // Apply GEN: MUST-defs kill, then insert. Every harvested GEN set holds at
    // least one def key (a set is only created alongside its first insertion),
    // so the set is always non-empty.
    if (gen) {
      for (const [binding, newDefs] of gen) {
        // MUST-def: kill all previous reaching defs for this binding,
        // then insert the new def
        out.set(binding, new Set(newDefs));
      }
    }

    // Check if IN[b] changed
    const oldIn = inSets[b]!;
    let changed = false;

    // Check which bindings changed. OUT[b] is monotone (a union of predecessor
    // IN sets overlaid with GEN), so a binding that is present in the previous
    // IN set is never removed; the set only grows or is replaced by GEN.
    for (const [binding, newDefs] of out) {
      const old = oldIn.get(binding);
      if (!old || !setsEqual(old, newDefs)) {
        changed = true;
        oldIn.set(binding, new Set(newDefs));
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
// Sparse Solver — Worklist Fixpoint
// ---------------------------------------------------------------------------
//
// Historically this was an SSA-based "sparse" solver (Cytron dominance
// frontiers + φ-placement + renaming). That implementation carried a
// single-value-per-binding entry model (`Map<number, number>`) which is
// fundamentally incompatible with reaching definitions — a use may have
// MULTIPLE reaching definitions (e.g. a loop header sees both the entry def
// and the loop-carried def). It silently dropped facts (verified: a 16-block
// loop produced 1 of 3 correct facts).
//
// Reaching definitions is a set-based flow analysis. The correct fixpoint is
// IN[b] = union over predecessors of OUT[pred], OUT[b] = GEN[b] ∪ (IN[b] with
// MUST-defs killed). This is identical in spirit to the dense solver below;
// the two functions are kept separate so the auto-selection heuristic
// (dense for small/loop-free, sparse for large/looped) remains a documented,
// testable seam even though both now use the same correct algorithm.

function computeReachingDefsSparse(cfg: FunctionCfg, h: Harvest): DefUseFact[] {
  const n = cfg.blocks.length;
  /* v8 ignore next — guarded upstream: computeReachingDefinitions returns early when def/use counts are zero */
  if (n === 0) return [];

  // entryValue[b][bindingIdx] = Set<defKey> — the set of defs reaching the
  // entry of block b for each binding. It starts empty for every block (the
  // entry block has no predecessors, so IN[entry] = {}); each block's own GEN
  // is applied when that block is visited by the fixpoint below, not pre-seeded
  // here (pre-seeding would make a use in the entry block see its own defs).
  const entryValue: Array<Map<number, Set<number>>> = Array.from({ length: n }, () => new Map());

  // Iterative fixpoint over the CFG using a worklist. Seed the worklist with
  // every block (not just the entry) so that a non-entry block's own GEN is
  // applied even when the entry block defines nothing; otherwise the fixpoint
  // starves and non-entry defs are silently dropped.
  const worklist: number[] = [];
  const inQueue = new Set<number>();
  for (let i = 0; i < n; i++) {
    worklist.push(i);
    inQueue.add(i);
  }

  while (worklist.length > 0) {
    const b = worklist.shift()!;
    inQueue.delete(b);

    // OUT[b] = GEN[b] ∪ (IN[b] with MUST-defs killed). Since h.gen[b] holds
    // only MUST-defs (killing defs), assigning a fresh copy of GEN[b] is the
    // correct "kill then gen" operation.
    const out = new Map<number, Set<number>>();
    for (const [bindIdx, defs] of entryValue[b]!) {
      out.set(bindIdx, new Set(defs));
    }
    const gen = h.gen[b];
    if (gen) {
      for (const [bindIdx, newDefs] of gen) {
        out.set(bindIdx, new Set(newDefs));
      }
    }

    // Propagate OUT[b] into each successor's IN set.
    for (const edge of cfg.edges) {
      if (edge.from !== b) continue;
      const succ = edge.to;
      const succIn = entryValue[succ]!;
      let changed = false;
      for (const [bindIdx, defs] of out) {
        const existing = succIn.get(bindIdx);
        if (!existing) {
          succIn.set(bindIdx, new Set(defs));
          changed = true;
        } else {
          const before = existing.size;
          for (const d of defs) existing.add(d);
          if (existing.size !== before) changed = true;
        }
      }
      if (changed && !inQueue.has(succ)) {
        worklist.push(succ);
        inQueue.add(succ);
      }
    }
  }

  // Sweep: resolve def→use facts using the computed entry sets.
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
  const solver =
    n >= SSA_MIN_BLOCKS && hasReachableLoop(cfg)
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
  outSets: Array<Map<number, Set<number>>>,
): DefUseFact[] {
  const facts: RawFact[] = [];

  for (const block of cfg.blocks) {
    const b = block.index;
    const usesList = h.allUses[b];

    if (!usesList || usesList.length === 0) continue;

    const bindings = cfg.bindings;

    // Intra-block overlay: seed with IN[b] = union of predecessor OUT sets,
    // then walk the block's statements applying defs in order. Seeding from
    // the block's own OUT set (which includes its GEN) would let a use see a
    // def that appears later in the same block — incorrect ordering.
    let currentDefs = new Map<number, Set<number>>();
    for (const pred of getBlockPredecessors(cfg, b)) {
      for (const [bindIdx, defs] of outSets[pred]!) {
        const existing = currentDefs.get(bindIdx);
        if (existing) {
          for (const d of defs) existing.add(d);
        } else {
          currentDefs.set(bindIdx, new Set(defs));
        }
      }
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
              /* v8 ignore next — every defKey originates from a harvested def site that records its line */
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
  entryValue: Array<Map<number, Set<number>>>,
): DefUseFact[] {
  const facts: RawFact[] = [];

  for (const block of cfg.blocks) {
    const b = block.index;
    const entry = entryValue[b]!;
    const bindings = cfg.bindings;

    // Intra-block overlay: carry the entry set forward, applying defs as we
    // walk statements so that later uses in the same block see earlier defs.
    let currentDefs = new Map<number, Set<number>>();
    for (const [bindIdx, defs] of entry) {
      currentDefs.set(bindIdx, new Set(defs));
    }

    for (let s = 0; s < block.statementCount; s++) {
      const stmtKey = b * STRIDE + s;

      const stmtUses = cfg.stmtFacts.uses.get(stmtKey);
      if (stmtUses) {
        for (const use of stmtUses) {
          const reaching = currentDefs.get(use.bindingIdx);
          if (reaching && reaching.size > 0) {
            let count = 0;
            for (const defKey of reaching) {
              if (count >= MAX_FACTS_PER_BINDING) break;
              /* v8 ignore next — every defKey originates from a harvested def site that records its line */
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

      // Apply defs at this statement.
      const stmtDefs = cfg.stmtFacts.defs.get(stmtKey);
      if (stmtDefs) {
        for (const def of stmtDefs) {
          const dKey = makeDefKey(b, s);
          if (def.kind === 'must') {
            currentDefs.set(def.bindingIdx, new Set([dKey]));
          } else {
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

  return dedupFacts(facts);
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
    /* v8 ignore next — succs is sized n and every valid edge target is < n, so succs[b] is always defined */
    for (const s of succs[b] ?? []) {
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
    /* v8 ignore next — reaching sets only grow (union) or are replaced by GEN, so a same-size mismatch never occurs */
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
