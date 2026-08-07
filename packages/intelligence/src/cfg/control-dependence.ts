// @code-analyzer/intelligence — Control Dependence Graph
// Computes control dependence edges for a function CFG.
//
// Algorithm (branch-based):
//   1. For each branching block C (≥2 CFG successors):
//      - Each non-exit direct successor S of C is control-dependent on C.
//      - Walk up the ipdom chain from S: each node D where C does NOT
//        post-dominate D is also control-dependent on C.
//   2. Loop header self-edges: if a block has a path through its successors
//      that leads back to itself, add a self-edge (controller=dependent=C).
//
// Edge labels follow:
//   - cond-true / switch-case → 'T'
//   - cond-false → 'F'
//   - seq / loop-back / fallthrough → complement of explicit arm

import type { FunctionCfg, CfgEdge, CfgEdgeKind, ControlDepEdge, CdgLabel } from './types.js';
import { computePostDominators, NO_IPDOM, postDominates } from './post-dominators.js';

// ---------------------------------------------------------------------------
// Core Algorithm
// ---------------------------------------------------------------------------

export function computeControlDependence(
  cfg: FunctionCfg,
  maxEdges: number = 5000,
): ControlDepEdge[] {
  const n = cfg.blocks.length;
  if (n === 0) return [];
  const exitIdx = cfg.exitIndex;

  const postDom = computePostDominators(cfg);
  const { ipdom } = postDom;
  const armSenses = buildArmSenses(cfg);

  // Build successor list per block
  const succs: Array<{ block: number; kind: CfgEdgeKind }[]> =
    Array.from({ length: n }, () => []);
  for (const edge of cfg.edges) {
    succs[edge.from]!.push({ block: edge.to, kind: edge.kind });
  }

  const edges: ControlDepEdge[] = [];
  const added = new Set<string>(); // dedup key: "ctrl→dep"

  for (let c = 0; c < n; c++) {
    // Only branching blocks (≥2 successors) emit control dependence
    if (succs[c]!.length < 2) continue;

    for (const { block: s, kind } of succs[c]!) {
      if (s === exitIdx || s < 0 || s >= n) continue;

      // Direct successors of a branching block are always control-dependent,
      // regardless of post-domination (important for loop bodies).
      {
        const label = labelForEdge(kind, armSenses[c]!);
        const key = `${c}:${s}:${label}`;
        if (!added.has(key)) {
          added.add(key);
          edges.push({ controllerBlock: c, dependentBlock: s, label });
        }
      }

      // Walk up ipdom chain from S — additional nodes that C does NOT
      // post-dominate are also control-dependent on C
      let cur = ipdom[s];
      if (cur === undefined) cur = NO_IPDOM;
      for (let limit = 0; limit < 100; limit++) {
        if (cur === NO_IPDOM || cur === exitIdx || cur === c) break;
        if (postDominates(postDom, c, cur)) break;

        const label = labelForEdge(kind, armSenses[c]!);
        const key = `${c}:${cur}:${label}`;
        if (!added.has(key)) {
          added.add(key);
          edges.push({ controllerBlock: c, dependentBlock: cur, label });
        }

        const next = ipdom[cur];
        if (next === NO_IPDOM || next === cur || next === cur) break;
        cur = next;
      }
    }
  }

  // Loop header self-edges: a block whose successors create a cycle
  // back to itself is control-dependent on itself
  for (let c = 0; c < n; c++) {
    if (c === exitIdx) continue;
    if (succs[c]!.length < 2) continue;
    if (hasCycleBack(c, cfg, new Set())) {
      const key = `${c}:${c}:T`;
      if (!added.has(key)) {
        added.add(key);
        edges.push({ controllerBlock: c, dependentBlock: c, label: 'T' });
      }
    }
  }

  // Sort: controller, then dependent, then label
  edges.sort((a, b) => {
    if (a.controllerBlock !== b.controllerBlock) return a.controllerBlock - b.controllerBlock;
    if (a.dependentBlock !== b.dependentBlock) return a.dependentBlock - b.dependentBlock;
    return a.label.localeCompare(b.label);
  });

  return edges.slice(0, maxEdges);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ArmSenses {
  hasTrueArm: boolean;
  hasFalseArm: boolean;
}

function buildArmSenses(cfg: FunctionCfg): ArmSenses[] {
  const n = cfg.blocks.length;
  const senses: ArmSenses[] = Array.from({ length: n }, () => ({
    hasTrueArm: false,
    hasFalseArm: false,
  }));
  for (const edge of cfg.edges) {
    if (edge.kind === 'cond-true' || edge.kind === 'switch-case') {
      senses[edge.from]!.hasTrueArm = true;
    }
    if (edge.kind === 'cond-false') {
      senses[edge.from]!.hasFalseArm = true;
    }
  }
  return senses;
}

function labelForEdge(kind: CfgEdgeKind, senses: ArmSenses): CdgLabel {
  if (kind === 'cond-true' || kind === 'switch-case') return 'T';
  if (kind === 'cond-false') return 'F';
  if (senses.hasTrueArm) return 'F';
  if (senses.hasFalseArm) return 'T';
  return 'F';
}

/** Check if a block has a cycle back to itself through its successor edges. */
function hasCycleBack(start: number, cfg: FunctionCfg, visited: Set<number>): boolean {
  if (visited.has(start)) return true;
  visited.add(start);

  const succs = cfg.edges.filter((e) => e.from === start).map((e) => e.to);
  for (const s of succs) {
    if (s === start) return true;
    if (hasCycleBack(s, cfg, visited)) return true;
  }
  visited.delete(start);
  return false;
}
