// @code-analyzer/intelligence — Control Dependence Graph
// Computes control dependence edges using the Cytron-Ferrante-Rosen-Wegman-Zadeck
// formulation: "control dependence IS the dominance frontier of the REVERSE CFG."
//
// Algorithm (from Cytron et al. 1991, §6):
//   1. Build arm senses: which blocks have explicit cond-true/cond-false edges
//   2. Build post-dom tree children
//   3. Build reverse-CFG edge mapping
//   4. Compute post-dominance frontier (PDF) bottom-up
//   5. For each block X, every CFG predecessor A where ipdom[A] ≠ X:
//      → A is control-dependent on X
//   6. Label edges 'T' or 'F' based on CFG edge kind
//
// Edge labels follow the rule:
//   - cond-true / switch-case → 'T'
//   - cond-false → 'F'
//   - seq / loop-back / fallthrough → complement of explicit arm
//
// Loop headers have SELF-edges (controller === dependent) because
// "the loop predicate gates its own re-execution."

import type { FunctionCfg, CfgEdge, CfgEdgeKind, ControlDepEdge, CdgLabel } from './types.js';
import { computePostDominators, NO_IPDOM, postDominates } from './post-dominators.js';

// ---------------------------------------------------------------------------
// Core Algorithm
// ---------------------------------------------------------------------------

/**
 * Compute control dependence edges for a function CFG.
 *
 * @param cfg — Function control flow graph
 * @param maxEdges — Maximum number of CDG edges to compute (default: 5000)
 * @returns Sorted control dependence edges
 */
export function computeControlDependence(
  cfg: FunctionCfg,
  maxEdges: number = 5000,
): ControlDepEdge[] {
  const n = cfg.blocks.length;
  if (n === 0) return [];

  const postDom = computePostDominators(cfg);
  const { ipdom } = postDom;

  // Step 1: Build arm senses — which blocks have explicit cond-true/cond-false arms
  const armSenses = buildArmSenses(cfg);

  // Step 2: Build post-dom tree children
  const pdomChildren: number[][] = Array.from({ length: n }, () => []);
  for (let b = 0; b < n; b++) {
    const p = ipdom[b]!;
    if (p !== NO_IPDOM) {
      pdomChildren[p]!.push(b);
    }
  }

  // Step 3: Build reverse-CFG inEdges (needed: which blocks read from block X as controller)
  const revInEdges: Array<Array<{ from: number; kind: CfgEdgeKind }>> =
    Array.from({ length: n }, () => []);
  for (const edge of cfg.edges) {
    revInEdges[edge.to]!.push({ from: edge.from, kind: edge.kind });
  }

  // Step 4: Compute post-dominance frontier bottom-up
  // PDF[X] = Map<controllerBlock, Set<CdgLabel>>
  // For each Z where Z ∈ domTree, and each CFG predecessor A of Z:
  //   if ipdom[A] ≠ X (i.e., X does not post-dominate A):
  //     → A is control-dependent on X
  const pdf: Map<number, Set<CdgLabel>>[] = Array.from({ length: n }, () => new Map());

  // Bottom-up DFS on post-dom tree (iterative post-order)
  const postOrder = pdomPostOrder(pdomChildren, cfg.exitIndex, n);

  for (const x of postOrder) {
    if (x === cfg.exitIndex) continue; // EXIT has no outgoing control dependence

    // PDF_local: for every block Z where Z ∈ {blocks whose ipdom = x}
    // For each CFG predecessor A of Z:
    //   If ipdom[A] ≠ x → (A, x, label) added to PDF[x]
    for (const z of [x, ...(pdomChildren[x] ?? [])]) {
      for (const { from: a, kind } of revInEdges[z]!) {
        // Check: does X NOT post-dominate A?
        if (ipdom[a] !== x && !postDominates(postDom, x, a)) {
          const label = labelForEdge(kind, armSenses[a]!);
          const labels = pdf[x]!.get(a) ?? new Set();
          labels.add(label);
          pdf[x]!.set(a, labels);
        }
      }
    }

    // PDF_up: inherit children's frontiers, but filter controllers
    for (const z of (pdomChildren[x] ?? [])) {
      for (const [a, labels] of pdf[z]!) {
        // Only inherit A if X does NOT post-dominate A
        if (!postDominates(postDom, x, a)) {
          const existing = pdf[x]!.get(a) ?? new Set();
          for (const label of labels) {
            existing.add(label);
          }
          pdf[x]!.set(a, existing);
        }
      }
    }
  }

  // Step 5: Emit edges from PDF maps
  const edges: ControlDepEdge[] = [];

  for (let x = 0; x < n; x++) {
    for (const [dependent, labels] of pdf[x]!) {
      for (const label of labels) {
        edges.push({
          controllerBlock: x,
          dependentBlock: dependent,
          label,
        });
      }
    }
  }

  // Sort: by controller, then dependent, then label
  edges.sort((a, b) => {
    if (a.controllerBlock !== b.controllerBlock)
      return a.controllerBlock - b.controllerBlock;
    if (a.dependentBlock !== b.dependentBlock)
      return a.dependentBlock - b.dependentBlock;
    return a.label.localeCompare(b.label);
  });

  // Apply cap
  return edges.slice(0, maxEdges);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Arm senses for a block: which explicit branch arms does it have? */
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

/**
 * Resolve the CDG label for a CFG edge kind.
 *
 * Direct mapping:
 *   cond-true, switch-case → 'T'
 *   cond-false → 'F'
 *
 * Ambiguous (seq/loop-back/fallthrough): complement of explicit arm.
 *   - If controller has hasTrueArm → 'F' (fall-through is the false arm)
 *   - If controller has hasFalseArm → 'T' (e.g., do/while loop-back is true)
 *   - If neither → 'F' (default)
 */
function labelForEdge(kind: CfgEdgeKind, senses: ArmSenses): CdgLabel {
  if (kind === 'cond-true' || kind === 'switch-case') return 'T';
  if (kind === 'cond-false') return 'F';

  // Ambiguous edge: complement of the explicit arm
  if (senses.hasTrueArm) return 'F';
  if (senses.hasFalseArm) return 'T';
  return 'F'; // default fallback
}

/**
 * Iterative post-order traversal of the post-dominator tree.
 * Returns blocks in bottom-up order (children before parents).
 */
function pdomPostOrder(
  children: number[][],
  root: number,
  n: number,
): number[] {
  const postOrder: number[] = [];
  if (root < 0 || root >= n) return postOrder;

  const visited = new Uint8Array(n);
  const stack: Array<{ node: number; nextChild: number }> = [
    { node: root, nextChild: 0 },
  ];
  visited[root] = 1;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const ch = children[frame.node] ?? [];

    let found = false;
    while (frame.nextChild < ch.length) {
      const child = ch[frame.nextChild]!;
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

  // postOrder is already children-before-parents (DFS post-order)
  return postOrder;
}
