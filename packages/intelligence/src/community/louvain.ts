// @code-analyzer/intelligence — Louvain Community Detection, **phase 1 only, and the header used to say otherwise**
//
// Detects functional modules in the call graph by local modularity optimisation: every node is moved to the
// neighbouring community that raises `Q` the most, passes repeat until no move does, and the partition with the best
// `Q` is returned.
//
// **What is not here, stated because the header claimed it for four iterations.** There is no second phase: Louvain's
// aggregation step builds a graph whose nodes are the communities so far and re-runs the local moving on it, and this
// module never does. The consequence is measurable and small on a chain, which is why it went unnoticed: two paths of
// four nodes joined by one weak edge stop at `2+2+2+2` (`Q` 0.3949) where the aggregate graph would reach `4+4`
// (`Q` 0.4677). A single-node move cannot merge two non-empty communities — it pays for the edges it abandons — so a
// local optimum of the phase-1 objective is not a local optimum of the partition space.
//
// **The production community detection is Leiden** (`@code-analyzer/core/community/leiden.ts`, called by
// `analyzer/pipeline/phases/communities.ts`), which has both phases plus a refinement step. This class is reachable
// only from its own tests and is kept for the comparison the community report publishes, not because a caller needs
// it; `tests/unit/architecture/module-reachability.test.ts` records that status.

import { mulberry32, DEFAULT_SEED } from '@code-analyzer/core';
import { EDGE_CALLS } from '@code-analyzer/shared';

import type { KnowledgeGraph } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommunityResult {
  /** communityId → array of nodeIds in that community */
  communities: Map<number, number[]>;
  /** Overall modularity score (Q) */
  modularity: number;
  /** Number of iterations until convergence */
  iterations: number;
  /** nodeId → communityId mapping */
  nodeToCommunity: Map<number, number>;
  /** Community labels based on most common node label */
  communityLabels: Map<number, string>;
}

// ---------------------------------------------------------------------------
// LouvainDetector
// ---------------------------------------------------------------------------

export class LouvainDetector {
  /** Minimum modularity improvement to continue iterating */
  private readonly minImprovement: number;
  /** Deterministic PRNG — same seed yields the same node ordering and result. */
  private readonly random: () => number;

  constructor(minImprovement = 1e-6, seed: number = DEFAULT_SEED) {
    this.minImprovement = minImprovement;
    this.random = mulberry32(seed);
  }

  /**
   * Detect communities in the knowledge graph using Louvain algorithm.
   * Uses CALLS edges as the primary relationship for community detection.
   *
   * @param graph — Knowledge graph with nodes and edges
   * @returns Community detection result
   */
  detectCommunities(graph: KnowledgeGraph): CommunityResult {
    // Build adjacency from CALLS edges
    const adjacency = this.buildCallAdjacency(graph);

    if (adjacency.size === 0) {
      return {
        communities: new Map(),
        modularity: 0,
        iterations: 0,
        nodeToCommunity: new Map(),
        communityLabels: new Map(),
      };
    }

    // Phase 1: Initialize each node in its own community
    const nodeToCommunity = new Map<number, number>();
    const nodeIds = Array.from(adjacency.keys());
    for (const [i, nodeId] of nodeIds.entries()) {
      nodeToCommunity.set(nodeId, i); // communityId starts at 0
    }

    // Compute total edge weight (m) and node degrees
    const degrees = new Map<number, number>();
    let totalWeight = 0;
    for (const [nodeId, neighbors] of adjacency) {
      let degree = 0;
      for (const [, w] of neighbors) {
        degree += w;
        totalWeight += w;
      }
      degrees.set(nodeId, degree);
    }
    totalWeight /= 2; // each edge counted twice

    if (totalWeight === 0) {
      return this.buildResult(nodeToCommunity, adjacency, graph, 0, 0);
    }

    // Iterate until convergence
    let modularity = this.computeModularity(nodeToCommunity, adjacency, degrees, totalWeight);
    let iterations = 0;
    const maxIterations = 50;

    // **The degree of every community, maintained as moves happen.** A move's gain needs the degree of the community
    // the node leaves and of the community it joins; recomputing either from the assignment would make one pass cost
    // `O(V²)` on a graph this repository actually analyses, and a pass that is too slow to run is a pass nobody runs.
    const communityDegree = new Map<number, number>();
    for (const nodeId of nodeIds) {
      const community = nodeToCommunity.get(nodeId)!;
      communityDegree.set(community, (communityDegree.get(community) ?? 0) + degrees.get(nodeId)!);
    }

    for (let iter = 0; iter < maxIterations; iter++) {
      let improved = false;
      const modularityBeforePass = modularity;

      // Shuffle for non-deterministic but faster convergence
      const shuffled = this.shuffle([...nodeIds]);
      for (const nodeId of shuffled) {
        const from = nodeToCommunity.get(nodeId)!;
        const degree = degrees.get(nodeId)!;
        const neighbours = adjacency.get(nodeId)!;

        // **One pass over the node's edges, bucketed by community**, because a move's gain needs two numbers from
        // that bucket: the weight to the community being joined, and the weight to the community being left.
        const weightTo = new Map<number, number>();
        for (const [neighbourId, weight] of neighbours) {
          const community = nodeToCommunity.get(neighbourId)!;
          weightTo.set(community, (weightTo.get(community) ?? 0) + weight);
        }
        const weightToFrom = weightTo.get(from) ?? 0;
        const fromWithout = (communityDegree.get(from) ?? 0) - degree;

        let bestTo = from;
        let bestGain = 0;
        for (const [to, weightToTo] of weightTo) {
          if (to === from) continue;
          const gain = this.gainOfMove(
            weightToTo,
            weightToFrom,
            degree,
            fromWithout,
            communityDegree.get(to) ?? 0,
            totalWeight,
          );
          if (gain > bestGain) {
            bestGain = gain;
            bestTo = to;
          }
        }

        if (bestTo !== from) {
          nodeToCommunity.set(nodeId, bestTo);
          communityDegree.set(from, fromWithout);
          communityDegree.set(bestTo, (communityDegree.get(bestTo) ?? 0) + degree);
          improved = true;
        }
      }

      iterations++;
      // **Q is a property of the partition, and this is the only place it is read from one.**
      //
      // The loop used to accumulate `bestGain` onto the initial Q, and `bestGain` is not a modularity: `gains` divides
      // a delta by `totalWeight` a second time, so the increment is `ΔQ / m`. Accumulating those over every move in
      // every pass produced a number that was a function of how far the search travelled rather than of what it
      // arrived at: **21.86 on `spring-petclinic`, where the upper bound is 1.** The greedy move rule still uses the
      // gain - it only has to order candidates - and the figure the result carries is recomputed from the assignment.
      modularity = this.computeModularity(nodeToCommunity, adjacency, degrees, totalWeight);
      // `minImprovement` is what the constructor documents: a pass that reshuffles
      // nodes for less than this much modularity is not worth another. Without this
      // the threshold was accepted and ignored, so a caller tuning it saw no change.
      if (!improved || modularity - modularityBeforePass < this.minImprovement) break;
    }

    return this.buildResult(nodeToCommunity, adjacency, graph, modularity, iterations);
  }

  /**
   * Build an adjacency map from CALLS edges in the graph.
   * Returns Map<nodeId, Map<neighborId, weight>>
   */
  private buildCallAdjacency(graph: KnowledgeGraph): Map<number, Map<number, number>> {
    const adjacency = new Map<number, Map<number, number>>();

    for (const [, edge] of graph.edges) {
      if (edge.type !== EDGE_CALLS) continue;

      // Ensure both nodes are in the adjacency
      if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Map());
      if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Map());

      // Undirected for community detection
      // Invariant: `GraphEdge.weight` is a required `number` (never undefined),
      // so the `?? 1` fallback is unreachable and removed here.
      const w = edge.weight;

      const srcNeighbors = adjacency.get(edge.sourceId)!;
      srcNeighbors.set(edge.targetId, (srcNeighbors.get(edge.targetId) ?? 0) + w);

      const tgtNeighbors = adjacency.get(edge.targetId)!;
      tgtNeighbors.set(edge.sourceId, (tgtNeighbors.get(edge.sourceId) ?? 0) + w);
    }

    return adjacency;
  }

  /**
   * The modularity a move from one community to another would add, from the definition.
   *
   * `ΔQ = (k_in − k_out)/m − k·(d_to − d_fromWithout)·1/(2m²)`, where `k_in` is the weight from the node to the
   * community it joins, `k_out` the weight to the community it leaves, `k` its degree, and `d_fromWithout` the degree
   * of the community it leaves **without** it.
   *
   * **The `k_out` term is the whole correction.** The previous rule scored a move by the weight it gained and the
   * size of the community it joined, and never charged the edges it abandoned: on a five-node clique it moved a node
   * out of a four-node community into a singleton at a *positive* score where the definition says the partition gets
   * worse, and the search then stopped there — a local optimum of the wrong objective, published as one of the right
   * one. `k²` cancels out of the algebra and is not in this expression on purpose.
   */
  private gainOfMove(
    weightToTarget: number,
    weightToSource: number,
    degree: number,
    sourceWithoutNode: number,
    targetDegree: number,
    totalWeight: number,
  ): number {
    const m2 = 2 * totalWeight * totalWeight;
    return (
      (weightToTarget - weightToSource) / totalWeight -
      (degree * (targetDegree - sourceWithoutNode)) / m2
    );
  }

  /**
   * Modularity of a partition, from its definition: `Q = Σ_c [ L_c/m − (d_c/2m)² ]`.
   *
   * **The null-model term is a property of the community, not of the edges inside it, and that is the difference
   * between a number and an artefact.** This used to walk the adjacency and add
   * `weight - degI·degJ/(2m)` only for edges whose two endpoints shared a community - so a community with no internal
   * edges contributed **nothing at all**, not even the penalty for existing. Splitting a clique into `4 + 1` then
   * scored `0.12` where the definition says `-0.08`, because the singleton's `−(1/5)²` was never charged. A search
   * that maximises the wrong objective is a search that prefers fragmentation, and the published figure was the
   * objective's opinion of itself rather than the partition's modularity.
   */
  private computeModularity(
    nodeToCommunity: Map<number, number>,
    adjacency: Map<number, Map<number, number>>,
    degrees: Map<number, number>,
    totalWeight: number,
  ): number {
    // Invariant: the only caller (detectCommunities) returns early when
    // `totalWeight === 0`, so this is always reached with a positive totalWeight.
    const m2 = 2 * totalWeight;
    // **Internal weight is counted twice, once per endpoint**, because the adjacency is symmetric - so `within / m2`
    // is the share of the graph's weight that sits inside the community, which is `L_c / m`.
    const internal = new Map<number, number>();
    const degreeSum = new Map<number, number>();
    for (const [nodeId, neighbours] of adjacency) {
      // Invariant: every adjacency key is also a degrees key, so `get` can never return `undefined` here.
      const community = nodeToCommunity.get(nodeId)!;
      degreeSum.set(community, (degreeSum.get(community) ?? 0) + degrees.get(nodeId)!);
      let within = 0;
      for (const [neighbourId, weight] of neighbours) {
        if (nodeToCommunity.get(neighbourId) === community) within += weight;
      }
      internal.set(community, (internal.get(community) ?? 0) + within);
    }

    let q = 0;
    // **Every community pays the null-model term, including one with no internal edge.** Iterating the degrees rather
    // than the edges is what makes a singleton cost something.
    for (const [community, total] of degreeSum) {
      q += (internal.get(community) ?? 0) / m2 - (total / m2) ** 2;
    }
    return q;
  }

  /** Build final CommunityResult */
  private buildResult(
    nodeToCommunity: Map<number, number>,
    _adjacency: Map<number, Map<number, number>>,
    graph: KnowledgeGraph,
    modularity: number,
    iterations: number,
  ): CommunityResult {
    // Group nodes by community
    const communities = new Map<number, number[]>();
    for (const [nodeId, communityId] of nodeToCommunity) {
      const members = communities.get(communityId) ?? [];
      members.push(nodeId);
      communities.set(communityId, members);
    }

    // Label communities by most common node label
    const communityLabels = new Map<number, string>();
    for (const [commId, members] of communities) {
      const labelCounts = new Map<string, number>();
      for (const nodeId of members) {
        const node = graph.nodes.get(nodeId);
        if (node) {
          labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1);
        }
      }
      let bestLabel = 'Mixed';
      let bestCount = 0;
      for (const [label, count] of labelCounts) {
        if (count > bestCount) {
          bestCount = count;
          bestLabel = label;
        }
      }
      communityLabels.set(commId, bestLabel);
    }

    return {
      communities,
      modularity,
      // **The passes it actually took.** This was hard-coded to `0` with the comment "updated by caller", and no
      // caller ever updated it: a field that always reads zero is a field nothing measures, and a reader comparing two
      // runs could not tell a converged partition from one stopped at `maxIterations`.
      iterations,
      nodeToCommunity,
      communityLabels,
    };
  }

  /** Fisher-Yates shuffle */
  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }
}
