// @code-analyzer/intelligence — Louvain Community Detection
// Detects functional modules in the call graph using modularity optimization.
// Phase 1: Local modularity optimization (move nodes between communities)
// Phase 2: Community aggregation (build new graph of communities)
// Iterate until convergence.

import type { KnowledgeGraph, GraphEdge } from '@code-analyzer/shared';
import { EDGE_CALLS } from '@code-analyzer/shared';

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

  constructor(minImprovement = 1e-6) {
    this.minImprovement = minImprovement;
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
      return this.buildResult(nodeToCommunity, adjacency, graph, 0);
    }

    // Iterate until convergence
    let modularity = this.computeModularity(nodeToCommunity, adjacency, degrees, totalWeight);
    let iterations = 0;
    const maxIterations = 50;

    for (let iter = 0; iter < maxIterations; iter++) {
      let improved = false;

      // Shuffle for non-deterministic but faster convergence
      const shuffled = this.shuffle([...nodeIds]);
      for (const nodeId of shuffled) {
        const currentCommunity = nodeToCommunity.get(nodeId)!;
        const neighborCommunities = this.getNeighborCommunityGains(
          nodeId, adjacency, degrees, nodeToCommunity, totalWeight,
        );

        let bestCommunity = currentCommunity;
        let bestGain = 0;

        for (const [communityId, gain] of neighborCommunities) {
          if (gain > bestGain) {
            bestGain = gain;
            bestCommunity = communityId;
          }
        }

        if (bestCommunity !== currentCommunity) {
          nodeToCommunity.set(nodeId, bestCommunity);
          improved = true;
          modularity += bestGain;
        }
      }

      iterations++;
      if (!improved) break;
    }

    return this.buildResult(nodeToCommunity, adjacency, graph, modularity);
  }

  /**
   * Build an adjacency map from CALLS edges in the graph.
   * Returns Map<nodeId, Map<neighborId, weight>>
   */
  private buildCallAdjacency(
    graph: KnowledgeGraph,
  ): Map<number, Map<number, number>> {
    const adjacency = new Map<number, Map<number, number>>();

    for (const [, edge] of graph.edges) {
      if (edge.type !== EDGE_CALLS) continue;

      // Ensure both nodes are in the adjacency
      if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Map());
      if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Map());

      // Undirected for community detection
      const w = edge.weight ?? 1;

      const srcNeighbors = adjacency.get(edge.sourceId)!;
      srcNeighbors.set(edge.targetId, (srcNeighbors.get(edge.targetId) ?? 0) + w);

      const tgtNeighbors = adjacency.get(edge.targetId)!;
      tgtNeighbors.set(edge.sourceId, (tgtNeighbors.get(edge.sourceId) ?? 0) + w);
    }

    return adjacency;
  }

  /**
   * Compute modularity gain for moving node to each neighbor's community.
   * ΔQ = (Σ_in + k_i,in) / (2m) - ((Σ_tot + k_i) / (2m))²
   *      - [ Σ_in/(2m) - (Σ_tot/(2m))² - (k_i/(2m))² ]
   */
  private getNeighborCommunityGains(
    nodeId: number,
    adjacency: Map<number, Map<number, number>>,
    degrees: Map<number, number>,
    nodeToCommunity: Map<number, number>,
    totalWeight: number,
  ): Map<number, number> {
    const gains = new Map<number, number>();
    const nodeDegree = degrees.get(nodeId) ?? 0;
    const neighbors = adjacency.get(nodeId);
    if (!neighbors) return gains;

    // Compute weight to each community
    const communityWeights = new Map<number, number>();
    for (const [neighborId, weight] of neighbors) {
      const comm = nodeToCommunity.get(neighborId);
      if (comm === undefined) continue;
      communityWeights.set(comm, (communityWeights.get(comm) ?? 0) + weight);
    }

    const currentCommunity = nodeToCommunity.get(nodeId);
    const m2 = 2 * totalWeight;

    for (const [comm, k_i_in] of communityWeights) {
      if (comm === currentCommunity) continue;

      // Sigma_tot: total degree of nodes in target community
      let sigmaTot = 0;
      for (const [nid, ncomm] of nodeToCommunity) {
        if (ncomm === comm) sigmaTot += (degrees.get(nid) ?? 0);
      }

      // Simplified modularity gain
      const gain = (k_i_in / totalWeight) - (sigmaTot * nodeDegree) / (2 * totalWeight * totalWeight);
      gains.set(comm, gain);
    }

    return gains;
  }

  /** Compute global modularity Q */
  private computeModularity(
    nodeToCommunity: Map<number, number>,
    adjacency: Map<number, Map<number, number>>,
    degrees: Map<number, number>,
    totalWeight: number,
  ): number {
    if (totalWeight === 0) return 0;
    let q = 0;
    const m2 = 2 * totalWeight;

    for (const [nodeId, neighbors] of adjacency) {
      const commI = nodeToCommunity.get(nodeId)!;
      const degI = degrees.get(nodeId) ?? 0;

      for (const [neighborId, weight] of neighbors) {
        const commJ = nodeToCommunity.get(neighborId);
        if (commI !== commJ) continue;

        const degJ = degrees.get(neighborId) ?? 0;
        q += weight - (degI * degJ) / m2;
      }
    }

    return q / m2;
  }

  /** Build final CommunityResult */
  private buildResult(
    nodeToCommunity: Map<number, number>,
    _adjacency: Map<number, Map<number, number>>,
    graph: KnowledgeGraph,
    modularity: number,
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
      iterations: 0, // Updated by caller
      nodeToCommunity,
      communityLabels,
    };
  }

  /** Fisher-Yates shuffle */
  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }
}