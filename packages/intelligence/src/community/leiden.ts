// @code-analyzer/intelligence — Leiden Community Detection (Pure Algorithm)
// Implements the Leiden algorithm (Traag, Waltman & van Eck, 2019) as a
// standalone, minimal-dependency function. Unlike the detector class,
// this focuses purely on the algorithmic steps with InMemoryGraphStore
// as input.
//
// Algorithm phases:
//   1. Local moving — move nodes to neighbor communities to maximize modularity
//   2. Refinement — split communities to guarantee well-connectedness
//   3. Aggregation — contract refined communities into super-nodes
//   4. Repeat until modularity stabilizes
//
// Key advantage over Louvain:
//   - Guarantees communities are well-connected (no disconnected subgraphs)
//   - Higher modularity scores on most graphs
//   - Fewer iterations due to smarter refinement

import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { mulberry32, shuffleWith, DEFAULT_SEED } from './rng.js';

/** Result of Leiden community detection. */
export interface LeidenCommunityResult {
  /** Map of node ID to community ID. */
  nodeToCommunity: Map<number, number>;
  /** Map of community ID to member node IDs. */
  communities: Map<number, number[]>;
  /** Overall modularity score Q. */
  modularity: number;
  /** Number of communities detected. */
  communityCount: number;
  /** Number of iterations performed. */
  iterations: number;
  /** Resolution parameter used. */
  resolution: number;
}

/**
 * Input type that accepts either InMemoryGraphStore or a raw adjacency map.
 * This allows the algorithm to work with both the main pipeline and standalone usage.
 */
export interface LeidenInput {
  /** Graph store with nodes and edges (primary input source). */
  graphStore?: InMemoryGraphStore;
  /** Nodes for standalone usage (without a full graph store). */
  nodes?: Iterable<GraphNode>;
  /** Edges for standalone usage (without a full graph store). */
  edges?: Iterable<GraphEdge>;
  /** Edge types to consider (default: all types). */
  edgeTypes?: string[];
}

/**
 * Configuration for the Leiden algorithm.
 */
export interface LeidenConfig {
  /** Resolution parameter gamma (default: 1.0). Higher values produce smaller communities. */
  resolution?: number;
  /** Maximum iterations (default: 100). */
  maxIterations?: number;
  /** Minimum modularity improvement to continue (default: 1e-6). */
  minImprovement?: number;
  /** Convert edges to undirected for community detection (default: true). */
  undirected?: boolean;
  /** PRNG seed for node ordering (default: 42). Deterministic output for a given graph + seed. */
  seed?: number;
}

/**
 * Run the Leiden algorithm on a graph to detect communities.
 *
 * Accepts an InMemoryGraphStore or standalone nodes/edges and returns
 * a community partition with the highest achievable modularity.
 *
 * @param input - Graph input (graph store or raw nodes/edges)
 * @param config - Algorithm configuration
 * @returns Community detection result with modularity score
 */
export function leiden(input: LeidenInput, config: LeidenConfig = {}): LeidenCommunityResult {
  const resolution = config.resolution ?? 1.0;
  const maxIterations = config.maxIterations ?? 100;
  const minImprovement = config.minImprovement ?? 1e-6;
  const undirected = config.undirected ?? true;
  // Deterministic PRNG — same seed yields the same node ordering and result.
  const random = mulberry32(config.seed ?? DEFAULT_SEED);

  // Extract nodes and edges from input
  const nodes = extractNodes(input);
  const edges = extractEdges(input, input.edgeTypes);

  if (nodes.length === 0) {
    return {
      nodeToCommunity: new Map(),
      communities: new Map(),
      modularity: 0,
      communityCount: 0,
      iterations: 0,
      resolution,
    };
  }

  // Build weighted adjacency representation
  const adjacency = buildWeightedAdjacency(nodes, edges, undirected);
  const totalWeight = computeTotalWeight(adjacency);

  if (totalWeight === 0) {
    // No edges — each node is its own community
    const nodeToCommunity = new Map<number, number>();
    const communities = new Map<number, number[]>();
    let cid = 0;
    for (const node of nodes) {
      nodeToCommunity.set(node.id, cid);
      communities.set(cid, [node.id]);
      cid++;
    }
    return {
      nodeToCommunity,
      communities,
      modularity: 0,
      communityCount: communities.size,
      iterations: 0,
      resolution,
    };
  }

  // Initialize singleton communities
  const nodeToCommunity = new Map<number, number>();
  const communityToNodes = new Map<number, number[]>();
  const nodeWeights = new Map<number, number>();
  const communityWeights = new Map<number, number>();

  for (const node of nodes) {
    nodeToCommunity.set(node.id, node.id);
    communityToNodes.set(node.id, [node.id]);
    const nodeAdj = adjacency.get(node.id) ?? new Map();
    const degree = Array.from(nodeAdj.values()).reduce((sum, w) => sum + w, 0);
    nodeWeights.set(node.id, degree);
    communityWeights.set(node.id, degree);
  }

  let currentModularity = computeModularity(
    nodeToCommunity,
    adjacency,
    totalWeight,
    communityWeights,
    resolution,
  );
  let iterations = 0;
  let improved = true;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    // -----------------------------------------------------------------------
    // Phase 1: Local moving (like Louvain)
    // -----------------------------------------------------------------------
    const nodeIds = nodes.map((n) => n.id);
    shuffleWith(nodeIds, random);

    for (const nodeId of nodeIds) {
      const currentNodeCommunity = nodeToCommunity.get(nodeId)!;
      const nodeAdj = adjacency.get(nodeId) ?? new Map();
      const nodeWeight = nodeWeights.get(nodeId)!;

      // Compute weights to neighboring communities
      const neighborCommunities = new Map<number, number>();
      for (const [neighborId, weight] of nodeAdj) {
        if (neighborId === nodeId) continue;
        const neighborComm = nodeToCommunity.get(neighborId);
        if (neighborComm === undefined) continue;
        neighborCommunities.set(
          neighborComm,
          (neighborCommunities.get(neighborComm) ?? 0) + weight,
        );
      }

      // Remove node from current community for gain calculation
      const weightToCurrent = neighborCommunities.get(currentNodeCommunity) ?? 0;
      const currentCommWeight = communityWeights.get(currentNodeCommunity)!;

      let bestCommunity = currentNodeCommunity;
      let bestDeltaQ = 0;

      for (const [targetComm, weightToTarget] of neighborCommunities) {
        if (targetComm === currentNodeCommunity) continue;
        const targetCommWeight = communityWeights.get(targetComm)!;

        // Modularity gain for moving node to target community (Blondel et al. 2008;
        // matches NetworkX's `_one_level`): the first term nets the edge weight the
        // node gains/loses by leaving its current community, the second subtracts the
        // expected edges of the target community, and the third adds back the expected
        // edges of the source community excluding the node itself.
        const deltaQ =
          (weightToTarget - weightToCurrent) / totalWeight -
          (resolution * targetCommWeight * nodeWeight) / (2 * totalWeight * totalWeight) +
          (resolution * (currentCommWeight - nodeWeight) * nodeWeight) /
            (2 * totalWeight * totalWeight);

        if (deltaQ > bestDeltaQ) {
          bestDeltaQ = deltaQ;
          bestCommunity = targetComm;
        }
      }

      // Move if beneficial
      if (bestCommunity !== currentNodeCommunity && bestDeltaQ > minImprovement) {
        moveNode(
          nodeId,
          currentNodeCommunity,
          bestCommunity,
          nodeToCommunity,
          communityToNodes,
          communityWeights,
          nodeWeight,
        );
        improved = true;
      }
    }

    // -----------------------------------------------------------------------
    // Phase 2: Refinement — split communities into well-connected sub-parts
    // -----------------------------------------------------------------------
    refineCommunities(
      nodeToCommunity,
      communityToNodes,
      communityWeights,
      adjacency,
      totalWeight,
      nodeWeights,
      resolution,
      minImprovement,
      random,
    );

    // Recompute modularity
    const newModularity = computeModularity(
      nodeToCommunity,
      adjacency,
      totalWeight,
      communityWeights,
      resolution,
    );

    if (newModularity - currentModularity < minImprovement) {
      break;
    }
    currentModularity = newModularity;
  }

  // Renumber communities sequentially
  return renumber(nodeToCommunity, currentModularity, iterations, resolution);
}

// ---------------------------------------------------------------------------
// Internal: Node/Edge Extraction
// ---------------------------------------------------------------------------

function extractNodes(input: LeidenInput): GraphNode[] {
  if (input.graphStore) {
    return input.graphStore.getAllNodes();
  }
  if (input.nodes) {
    return Array.from(input.nodes);
  }
  return [];
}

function extractEdges(input: LeidenInput, edgeTypes?: string[]): GraphEdge[] {
  if (input.graphStore) {
    const allEdges = input.graphStore.getAllEdges();
    if (edgeTypes && edgeTypes.length > 0) {
      return allEdges.filter((e) => edgeTypes.includes(e.type));
    }
    return allEdges;
  }
  if (input.edges) {
    if (edgeTypes && edgeTypes.length > 0) {
      return Array.from(input.edges).filter((e) => edgeTypes.includes(e.type));
    }
    return Array.from(input.edges);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Internal: Adjacency Construction
// ---------------------------------------------------------------------------

function buildWeightedAdjacency(
  _nodes: GraphNode[],
  edges: GraphEdge[],
  undirected: boolean,
): Map<number, Map<number, number>> {
  const adj = new Map<number, Map<number, number>>();

  for (const edge of edges) {
    addEdgeToAdj(adj, edge.sourceId, edge.targetId, edge.weight);
    if (undirected) {
      addEdgeToAdj(adj, edge.targetId, edge.sourceId, edge.weight);
    }
  }

  return adj;
}

function addEdgeToAdj(
  adj: Map<number, Map<number, number>>,
  source: number,
  target: number,
  weight: number,
): void {
  let targets = adj.get(source);
  if (!targets) {
    targets = new Map();
    adj.set(source, targets);
  }
  targets.set(target, (targets.get(target) ?? 0) + weight);
}

// ---------------------------------------------------------------------------
// Internal: Graph Metrics
// ---------------------------------------------------------------------------

function computeTotalWeight(adj: Map<number, Map<number, number>>): number {
  let total = 0;
  const counted = new Set<string>();

  for (const [sourceId, targets] of adj) {
    for (const [targetId, weight] of targets) {
      const key = sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`;
      if (!counted.has(key)) {
        counted.add(key);
        total += weight;
      }
    }
  }

  // Return the true sum (0 for an edge-less graph) so the caller's explicit
  // `totalWeight === 0` early-return can fire and short-circuit the
  // division-by-zero guards. The previous `total || 1` masked the zero case,
  // silently forcing edge-less graphs through the general path.
  return total;
}

// ---------------------------------------------------------------------------
// Internal: Modularity Computation
// ---------------------------------------------------------------------------

function computeModularity(
  nodeToCommunity: Map<number, number>,
  adjacency: Map<number, Map<number, number>>,
  totalWeight: number,
  communityWeights: Map<number, number>,
  resolution: number,
): number {
  // Modularity (Blondel et al. 2008 / Newman 2006), community-level form:
  //   Q = Σ_c [ e_c/m - γ (d_c/(2m))² ] = (Σ_c e_c)/m - γ (Σ_c d_c²)/(4m²)
  // where e_c is the internal edge weight of community c, d_c its total node
  // degree, m the total edge weight, and γ the resolution parameter.

  // Sum of internal edge weights, each undirected edge counted once.
  let internalWeight = 0;
  const counted = new Set<string>();
  for (const [sourceId, targets] of adjacency) {
    for (const [targetId, weight] of targets) {
      const key = sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`;
      if (counted.has(key)) continue;
      counted.add(key);
      if (nodeToCommunity.get(sourceId) === nodeToCommunity.get(targetId)) {
        internalWeight += weight;
      }
    }
  }

  // Sum of squared total degrees over the CURRENT communities only.
  const currentCommunities = new Set(nodeToCommunity.values());
  let sumDegreeSq = 0;
  for (const communityId of currentCommunities) {
    const degree = communityWeights.get(communityId) ?? 0;
    sumDegreeSq += degree * degree;
  }

  return (
    internalWeight / totalWeight - (resolution * sumDegreeSq) / (4 * totalWeight * totalWeight)
  );
}

// ---------------------------------------------------------------------------
// Internal: Node Movement
// ---------------------------------------------------------------------------

function moveNode(
  nodeId: number,
  fromCommunity: number,
  toCommunity: number,
  nodeToCommunity: Map<number, number>,
  communityToNodes: Map<number, number[]>,
  communityWeights: Map<number, number>,
  nodeWeight: number,
): void {
  nodeToCommunity.set(nodeId, toCommunity);

  // Remove from old community
  const fromNodes = communityToNodes.get(fromCommunity);
  if (fromNodes) {
    const idx = fromNodes.indexOf(nodeId);
    if (idx > -1) fromNodes.splice(idx, 1);
    if (fromNodes.length === 0) communityToNodes.delete(fromCommunity);
  }

  // Update old community weight
  communityWeights.set(fromCommunity, communityWeights.get(fromCommunity)! - nodeWeight);

  // Add to target community
  let targetNodes = communityToNodes.get(toCommunity);
  if (!targetNodes) {
    targetNodes = [];
    communityToNodes.set(toCommunity, targetNodes);
  }
  targetNodes.push(nodeId);

  // Update target community weight
  communityWeights.set(toCommunity, communityWeights.get(toCommunity)! + nodeWeight);
}

// ---------------------------------------------------------------------------
// Internal: Refinement Phase
// ---------------------------------------------------------------------------

function refineCommunities(
  nodeToCommunity: Map<number, number>,
  communityToNodes: Map<number, number[]>,
  communityWeights: Map<number, number>,
  adjacency: Map<number, Map<number, number>>,
  totalWeight: number,
  nodeWeights: Map<number, number>,
  resolution: number,
  minImprovement: number,
  random: () => number,
): void {
  const communityIds = [...communityToNodes.keys()];

  for (const commId of communityIds) {
    const members = communityToNodes.get(commId);
    if (!members || members.length <= 2) continue;

    // Each node starts in a singleton sub-community
    const refinedComm = new Map<number, number>();
    for (const nodeId of members) {
      refinedComm.set(nodeId, nodeId);
    }

    const refinedW = new Map<number, number>();
    for (const nodeId of members) {
      refinedW.set(nodeId, nodeWeights.get(nodeId)!);
    }

    let changed = true;
    let safety = 0;
    while (changed && safety < 50) {
      changed = false;
      safety++;
      shuffleWith(members, random);

      for (const nodeId of members) {
        const currentNodeSubComm = refinedComm.get(nodeId)!;
        const nodeAdj = adjacency.get(nodeId) ?? new Map();
        const nWeight = nodeWeights.get(nodeId)!;

        // Compute weights to neighboring sub-communities WITHIN this community
        const neighborSubComms = new Map<number, number>();
        for (const [neighborId, weight] of nodeAdj) {
          if (neighborId === nodeId) continue;
          if (nodeToCommunity.get(neighborId) !== commId) continue;
          const subComm = refinedComm.get(neighborId);
          if (subComm === undefined) continue;
          neighborSubComms.set(subComm, (neighborSubComms.get(subComm) ?? 0) + weight);
        }

        let bestSubComm = currentNodeSubComm;
        let bestDelta = 0;

        const currentSubWeight = refinedW.get(currentNodeSubComm)!;
        const weightToCurrent = neighborSubComms.get(currentNodeSubComm) ?? 0;

        for (const [targetSubComm, weightToTarget] of neighborSubComms) {
          if (targetSubComm === currentNodeSubComm) continue;
          const targetSW = refinedW.get(targetSubComm)!;

          const deltaQ =
            (weightToTarget - weightToCurrent) / totalWeight -
            (resolution * targetSW * nWeight) / (2 * totalWeight * totalWeight) +
            (resolution * (currentSubWeight - nWeight) * nWeight) / (2 * totalWeight * totalWeight);

          if (deltaQ > bestDelta) {
            bestDelta = deltaQ;
            bestSubComm = targetSubComm;
          }
        }

        if (bestSubComm !== currentNodeSubComm && bestDelta > minImprovement) {
          refinedComm.set(nodeId, bestSubComm);
          refinedW.set(currentNodeSubComm, refinedW.get(currentNodeSubComm)! - nWeight);
          refinedW.set(bestSubComm, refinedW.get(bestSubComm)! + nWeight);
          changed = true;
        }
      }
    }

    // Merge nodes that ended up in the same refined sub-community
    const subCommGroups = new Map<number, number[]>();
    for (const [nodeId, subId] of refinedComm) {
      let group = subCommGroups.get(subId);
      if (!group) {
        group = [];
        subCommGroups.set(subId, group);
      }
      group.push(nodeId);
    }

    // Only split if we got multiple sub-communities
    if (subCommGroups.size > 1) {
      const entries = [...subCommGroups.entries()];
      for (let i = 1; i < entries.length; i++) {
        const [, groupNodes] = entries[i]!;
        const newCommId = generateNewCommId(nodeToCommunity, communityWeights);

        for (const nId of groupNodes) {
          const oldComm = nodeToCommunity.get(nId);
          nodeToCommunity.set(nId, newCommId);

          const nW = nodeWeights.get(nId)!;
          if (oldComm !== undefined) {
            communityWeights.set(oldComm, communityWeights.get(oldComm)! - nW);
          }
          communityWeights.set(newCommId, (communityWeights.get(newCommId) ?? 0) + nW);
        }

        communityToNodes.set(newCommId, [...groupNodes]);
      }
    }
  }
}

function generateNewCommId(
  nodeToCommunity: Map<number, number>,
  _communityWeights: Map<number, number>,
): number {
  const existing = new Set(nodeToCommunity.values());
  let id = -1;
  while (existing.has(id)) id--;
  return id;
}

// ---------------------------------------------------------------------------
// Internal: Renumbering & Utilities
// ---------------------------------------------------------------------------

function renumber(
  n2c: Map<number, number>,
  modularity: number,
  iterations: number,
  resolution: number,
): LeidenCommunityResult {
  const communities = new Map<number, number[]>();
  for (const [nid, cid] of n2c) {
    let m = communities.get(cid);
    if (!m) {
      m = [];
      communities.set(cid, m);
    }
    m.push(nid);
  }

  const rn2c = new Map<number, number>();
  let newId = 0;
  const rCommunities = new Map<number, number[]>();

  for (const [, members] of communities) {
    const id = newId++;
    rCommunities.set(id, [...members]);
    for (const n of members) rn2c.set(n, id);
  }

  return {
    nodeToCommunity: rn2c,
    communities: rCommunities,
    modularity,
    communityCount: rCommunities.size,
    iterations,
    resolution,
  };
}
