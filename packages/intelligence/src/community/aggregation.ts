// @code-analyzer/intelligence — Community Aggregation (Louvain/Leiden Phase 2)
// Builds reduced graphs from community partitions for hierarchical
// community detection. Used by both Louvain and Leiden detectors.

/**
 * A weighted adjacency structure for the reduced graph.
 * Maps source community ID → { target community ID → edge weight }
 */
export interface ReducedGraph {
  /** Nodes in the reduced graph (community IDs). */
  nodes: number[];
  /** Adjacency: source community → Map<target community, weight>. */
  adjacency: Map<number, Map<number, number>>;
  /** Total edge weight in the reduced graph. */
  totalWeight: number;
  /** Maps reduced-graph node ID → list of original node IDs. */
  communityMembers: Map<number, number[]>;
}

/**
 * Build a reduced graph from a community partition.
 *
 * Each community becomes a node. Edge weight between two communities
 * is the sum of edge weights between all nodes in those communities.
 * Self-loops represent internal community edges.
 *
 * @param originalAdj - Original graph adjacency (node → Map<neighbor, weight>)
 * @param nodeToCommunity - Maps each original node to its community ID
 * @param originalDegrees - Node degrees in the original graph
 * @returns Reduced graph ready for the next Louvain/Leiden pass
 */
export function buildReducedGraph(
  originalAdj: Map<number, Map<number, number>>,
  nodeToCommunity: Map<number, number>,
  _originalDegrees: Map<number, number>,
): ReducedGraph {
  // Collect communities
  const communities = new Set<number>();
  for (const [, comm] of nodeToCommunity) {
    communities.add(comm);
  }

  // Build community membership
  const communityMembers = new Map<number, number[]>();
  for (const [nodeId, comm] of nodeToCommunity) {
    const members = communityMembers.get(comm) ?? [];
    members.push(nodeId);
    communityMembers.set(comm, members);
  }

  // Build adjacency for reduced graph
  const adjacency = new Map<number, Map<number, number>>();
  for (const comm of communities) {
    adjacency.set(comm, new Map());
  }

  let totalWeight = 0;

  // Aggregate edges between communities
  for (const [nodeId, neighbors] of originalAdj) {
    const commA = nodeToCommunity.get(nodeId);
    if (commA === undefined) continue;

    for (const [neighborId, weight] of neighbors) {
      const commB = nodeToCommunity.get(neighborId);
      if (commB === undefined) continue;

      // Add edge weight between communities A and B
      const commEdges = adjacency.get(commA)!;
      commEdges.set(commB, (commEdges.get(commB) ?? 0) + weight);
      totalWeight += weight;
    }
  }

  // Normalize: total weight counted twice (A→B and B→A)
  totalWeight = Math.round(totalWeight / 2);

  return {
    nodes: [...communities],
    adjacency,
    totalWeight,
    communityMembers,
  };
}

/**
 * Map community-level partition back to original node IDs.
 *
 * After running community detection on a reduced graph, the results
 * are community-of-communities. This mapping flattens them back to
 * the original node level.
 *
 * @param reducedNodeToComm - Node→community mapping in the reduced graph
 * @param communityMembers - Maps each reduced-graph node to original nodes
 * @returns Node→community mapping in the original graph space
 */
export function mapToOriginalNodes(
  reducedNodeToComm: Map<number, number>,
  communityMembers: Map<number, number[]>,
): Map<number, number> {
  const result = new Map<number, number>();

  for (const [reducedNode, superCommunity] of reducedNodeToComm) {
    const members = communityMembers.get(reducedNode) ?? [];
    for (const originalNode of members) {
      result.set(originalNode, superCommunity);
    }
  }

  return result;
}

/**
 * Run one complete Louvain pass with hierarchical aggregation.
 *
 * 1. Run local moving (Phase 1)
 * 2. Build reduced graph (Phase 2)
 * 3. Re-run on reduced graph (recursive)
 * 4. Map results back to original nodes
 *
 * @param adjacency - Original graph adjacency
 * @param degrees - Original node degrees
 * @param maxLevels - Maximum aggregation levels (default: 5)
 * @returns Final community assignment and modularity
 */
export function louvainWithAggregation(
  adjacency: Map<number, Map<number, number>>,
  degrees: Map<number, number>,
  localMoving: (
    adj: Map<number, Map<number, number>>,
    degs: Map<number, number>,
    initialPartition?: Map<number, number>,
  ) => { partition: Map<number, number>; modularity: number; improved: boolean },
  maxLevels: number = 5,
): {
  partition: Map<number, number>;
  modularity: number;
  levels: number;
} {
  // Level 0: Run on original graph
  const level0 = localMoving(adjacency, degrees);
  if (!level0.improved || maxLevels <= 1) {
    return {
      partition: level0.partition,
      modularity: level0.modularity,
      levels: 1,
    };
  }

  let currentPartition = level0.partition;
  let currentModularity = level0.modularity;
  let levels = 1;

  // Store original members for final mapping
  let members: Map<number, number[]> | null = null;

  for (let level = 1; level < maxLevels; level++) {
    // Build reduced graph
    const reduced = buildReducedGraph(adjacency, currentPartition, degrees);
    if (reduced.nodes.length <= 1) break; // Cannot aggregate further

    // Save membership for final mapping
    members = reduced.communityMembers;

    // Run local moving on reduced graph
    const reducedResult = localMoving(reduced.adjacency, new Map());
    if (!reducedResult.improved) break;

    // Map back to original node space
    currentPartition = mapToOriginalNodes(reducedResult.partition, members);
    currentModularity = reducedResult.modularity;
    levels++;
  }

  return {
    partition: currentPartition,
    modularity: currentModularity,
    levels,
  };
}
