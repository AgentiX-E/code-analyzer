// @code-analyzer/intelligence — Flow Search Engine
// Searches through code flow graphs (call chains, data flow) using
// depth-limited graph traversal with relevance-based result ranking.
// Integrates with the knowledge graph to follow edges and discover
// connected code entities.

import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge, RelationshipType } from '@code-analyzer/shared';
import { EDGE_ACCESSES, EDGE_CALLS, EDGE_DATA_FLOWS, EDGE_DEFINES, EDGE_EXTENDS, EDGE_HANDLES, EDGE_IMPLEMENTS, EDGE_IMPORTS, EDGE_INSTANTIATES } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A node discovered during flow traversal */
export interface FlowNode {
  /** Node ID in the knowledge graph */
  nodeId: number;
  /** Node name */
  name: string;
  /** Node label (Function, Class, etc.) */
  label: string;
  /** File path */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Distance from the starting node (number of edges) */
  depth: number;
}

/** A flow path through the graph */
export interface FlowPath {
  /** Ordered sequence of nodes in the path */
  nodes: FlowNode[];
  /** Relevance score (0-100) */
  score: number;
  /** Types of edges traversed */
  edgeTypes: RelationshipType[];
  /** Description of the flow */
  description: string;
}

/** A ranked flow search result */
export interface FlowSearchResult {
  /** The discovered node */
  node: FlowNode;
  /** Relevance score (0-100) */
  score: number;
  /** The path from origin to this node */
  path: FlowNode[];
  /** Match reason */
  matchReason: string;
}

/** Options for flow search */
export interface FlowSearchOptions {
  /** Maximum traversal depth (default: 5) */
  maxDepth?: number;
  /** Maximum number of results (default: 50) */
  maxResults?: number;
  /** Edge types to follow (default: CALLS, IMPORTS, DATA_FLOWS) */
  edgeTypes?: RelationshipType[];
  /** Direction: 'forward' = follow outgoing edges, 'backward' = incoming, 'both' */
  direction?: 'forward' | 'backward' | 'both';
  /** Filter results by node label */
  nodeLabels?: string[];
  /** Filter results by file path pattern */
  filePattern?: string;
  /** Minimum relevance score (0-100, default: 0) */
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Flow Search Engine
// ---------------------------------------------------------------------------

const DEFAULT_FLOW_EDGES: RelationshipType[] = [
  EDGE_CALLS,
  EDGE_IMPORTS,
  EDGE_DATA_FLOWS,
  EDGE_DEFINES,
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
  EDGE_HANDLES,
  EDGE_ACCESSES,
  EDGE_INSTANTIATES,
];

export class FlowSearchEngine {
  private store: InMemoryGraphStore;

  constructor(store: InMemoryGraphStore) {
    this.store = store;
  }

  /**
   * Search from a starting node, following flow edges to discover
   * connected entities. Returns ranked results based on relevance.
   */
  search(
    startNodeIds: number[],
    options?: FlowSearchOptions,
  ): FlowSearchResult[] {
    const maxDepth = options?.maxDepth ?? 5;
    const maxResults = options?.maxResults ?? 50;
    const edgeTypes = options?.edgeTypes ?? DEFAULT_FLOW_EDGES;
    const direction = options?.direction ?? 'forward';
    const minScore = options?.minScore ?? 0;

    if (startNodeIds.length === 0) return [];

    const edgeTypeSet = new Set(edgeTypes);
    const allResults: FlowSearchResult[] = [];

    for (const startId of startNodeIds) {
      const startNode = this.store.getNode(startId);
      if (!startNode) continue;

      const projectId = startNode.projectId;

      const startFlowNode: FlowNode = {
        nodeId: startNode.id,
        name: startNode.name,
        label: startNode.label,
        filePath: startNode.filePath ?? '',
        line: startNode.startLine ?? 0,
        depth: 0,
      };

      // BFS traversal
      const visited = new Set<number>();
      visited.add(startId);

      const queue: Array<{
        nodeId: number;
        path: FlowNode[];
        depth: number;
        edgeTypes: RelationshipType[];
      }> = [{ nodeId: startId, path: [startFlowNode], depth: 0, edgeTypes: [] }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxDepth) continue;

        // Get edges based on direction
        const edges = this.getEdges(current.nodeId, direction, edgeTypeSet, projectId);

        for (const edge of edges) {
          const nextId = this.resolveNextNode(edge, current.nodeId, direction);

          if (visited.has(nextId)) continue;
          visited.add(nextId);

          const nextNode = this.store.getNode(nextId);
          if (!nextNode) continue;

          // Apply label filter
          if (
            options?.nodeLabels &&
            options.nodeLabels.length > 0 &&
            !options.nodeLabels.includes(nextNode.label)
          ) {
            continue;
          }

          // Apply file pattern filter
          if (
            options?.filePattern &&
            nextNode.filePath &&
            !matchesSimplePattern(nextNode.filePath, options.filePattern)
          ) {
            continue;
          }

          const flowNode: FlowNode = {
            nodeId: nextNode.id,
            name: nextNode.name,
            label: nextNode.label,
            filePath: nextNode.filePath ?? '',
            line: nextNode.startLine ?? 0,
            depth: current.depth + 1,
          };

          const newPath = [...current.path, flowNode];
          const newEdgeTypes = [...current.edgeTypes, edge.type];
          const score = this.computeScore(flowNode, current.depth + 1, newEdgeTypes);

          if (score >= minScore) {
            allResults.push({
              node: flowNode,
              score,
              path: newPath,
              matchReason: this.describeMatch(flowNode, edge.type, current.depth + 1),
            });
          }

          if (allResults.length >= maxResults * startNodeIds.length) {
            return this.rankResults(allResults, maxResults);
          }

          if (current.depth + 1 < maxDepth) {
            queue.push({
              nodeId: nextId,
              path: newPath,
              depth: current.depth + 1,
              edgeTypes: newEdgeTypes,
            });
          }
        }
      }
    }

    return this.rankResults(allResults, maxResults);
  }

  /**
   * Find all callers of a given function (backward search).
   */
  findCallers(
    functionNodeId: number,
    maxDepth: number = 3,
    maxResults: number = 20,
  ): FlowSearchResult[] {
    return this.search([functionNodeId], {
      maxDepth,
      maxResults,
      edgeTypes: [EDGE_CALLS, EDGE_IMPORTS],
      direction: 'backward',
    });
  }

  /**
   * Find all callees of a given function (forward search).
   */
  findCallees(
    functionNodeId: number,
    maxDepth: number = 3,
    maxResults: number = 20,
  ): FlowSearchResult[] {
    return this.search([functionNodeId], {
      maxDepth,
      maxResults,
      edgeTypes: [EDGE_CALLS],
      direction: 'forward',
    });
  }

  /**
   * Find the shortest path between two nodes in the flow graph.
   */
  findShortestPath(
    sourceNodeId: number,
    targetNodeId: number,
    maxDepth: number = 10,
  ): FlowPath | null {
    const sourceNode = this.store.getNode(sourceNodeId);
    if (!sourceNode) return null;

    if (sourceNodeId === targetNodeId) {
      return {
        nodes: [{
          nodeId: sourceNode.id,
          name: sourceNode.name,
          label: sourceNode.label,
          filePath: sourceNode.filePath ?? '',
          line: sourceNode.startLine ?? 0,
          depth: 0,
        }],
        score: 100,
        edgeTypes: [],
        description: 'Source and target are the same node',
      };
    }

    const projectId = sourceNode.projectId;
    const visited = new Set<number>();
    visited.add(sourceNodeId);

    const startFlowNode: FlowNode = {
      nodeId: sourceNode.id,
      name: sourceNode.name,
      label: sourceNode.label,
      filePath: sourceNode.filePath ?? '',
      line: sourceNode.startLine ?? 0,
      depth: 0,
    };

    const queue: Array<{
      nodeId: number;
      path: FlowNode[];
      depth: number;
      edgeTypes: RelationshipType[];
    }> = [{
      nodeId: sourceNodeId,
      path: [startFlowNode],
      depth: 0,
      edgeTypes: [],
    }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const edges = this.getEdges(
        current.nodeId,
        'both',
        new Set(DEFAULT_FLOW_EDGES),
        projectId,
      );

      for (const edge of edges) {
        const nextId = edge.sourceId === current.nodeId ? edge.targetId : edge.sourceId;
        if (visited.has(nextId)) continue;
        visited.add(nextId);

        const nextNode = this.store.getNode(nextId);
        if (!nextNode) continue;

        const flowNode: FlowNode = {
          nodeId: nextNode.id,
          name: nextNode.name,
          label: nextNode.label,
          filePath: nextNode.filePath ?? '',
          line: nextNode.startLine ?? 0,
          depth: current.depth + 1,
        };

        const newPath = [...current.path, flowNode];
        const newEdgeTypes = [...current.edgeTypes, edge.type];

        if (nextId === targetNodeId) {
          return {
            nodes: newPath,
            score: Math.max(0, 100 - current.depth * 10),
            edgeTypes: newEdgeTypes,
            description: `Path found with ${current.depth + 1} hops: ${newPath.map(n => n.name).join(' → ')}`,
          };
        }

        if (current.depth + 1 < maxDepth) {
          queue.push({
            nodeId: nextId,
            path: newPath,
            depth: current.depth + 1,
            edgeTypes: newEdgeTypes,
          });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Find all flow paths starting from a set of nodes.
   * Returns full paths rather than individual results.
   */
  findFlowPaths(
    startNodeIds: number[],
    maxDepth: number = 5,
  ): FlowPath[] {
    const results = this.search(startNodeIds, {
      maxDepth,
      maxResults: 200,
      direction: 'forward',
    });

    // Group by path
    const pathMap = new Map<string, FlowPath>();
    for (const result of results) {
      const key = result.path.map(n => n.nodeId).join(':');
      if (!pathMap.has(key)) {
        pathMap.set(key, {
          nodes: result.path,
          score: result.score,
          edgeTypes: [],
          description: result.matchReason,
        });
      }
    }

    return Array.from(pathMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private getEdges(
    nodeId: number,
    direction: 'forward' | 'backward' | 'both',
    edgeTypeSet: Set<RelationshipType>,
    projectId: string,
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];

    if (direction === 'forward' || direction === 'both') {
      const outgoing = this.store.queryEdges({
        projectId,
        sourceId: nodeId,
        limit: 1000,
      });
      for (const edge of outgoing.items) {
        if (edgeTypeSet.has(edge.type)) {
          edges.push(edge);
        }
      }
    }

    if (direction === 'backward' || direction === 'both') {
      const incoming = this.store.queryEdges({
        projectId,
        targetId: nodeId,
        limit: 1000,
      });
      for (const edge of incoming.items) {
        if (edgeTypeSet.has(edge.type)) {
          // Avoid duplicates for 'both' direction
          if (!edges.some(e => e.id === edge.id)) {
            edges.push(edge);
          }
        }
      }
    }

    return edges;
  }

  private resolveNextNode(
    edge: GraphEdge,
    currentNodeId: number,
    _direction: 'forward' | 'backward' | 'both',
  ): number {
    // If current node is the target of this edge, the next node is the source
    // (we're traversing backward along the edge)
    if (edge.targetId === currentNodeId) {
      return edge.sourceId;
    }
    // Otherwise, current node is the source, next is the target
    return edge.targetId;
  }

  private computeScore(
    _node: FlowNode,
    depth: number,
    edgeTypes: RelationshipType[],
  ): number {
    // Base score decreases with depth
    let score = Math.max(10, 100 - depth * 15);

    // Bonus for direct CALLS edges (strong relationship)
    const lastEdge = edgeTypes[edgeTypes.length - 1];
    if (lastEdge === EDGE_CALLS) score += 10;
    if (lastEdge === EDGE_EXTENDS || lastEdge === EDGE_IMPLEMENTS) score += 15;
    if (lastEdge === EDGE_DATA_FLOWS) score += 5;

    // Penalty for weak relationships
    if (lastEdge === EDGE_IMPORTS) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  private describeMatch(
    node: FlowNode,
    edgeType: RelationshipType,
    depth: number,
  ): string {
    const edgeDesc: Record<string, string> = {
      CALLS: 'calls',
      IMPORTS: 'imports',
      DATA_FLOWS: 'data flows to',
      DEFINES: 'defines',
      EXTENDS: 'extends',
      IMPLEMENTS: 'implements',
      HANDLES: 'handles',
      ACCESSES: 'accesses',
      INSTANTIATES: 'instantiates',
    };

    const verb = edgeDesc[edgeType] ?? 'connects to';
    return `${verb} ${node.name} (${node.label}) at depth ${depth}`;
  }

  private rankResults(
    results: FlowSearchResult[],
    maxResults: number,
  ): FlowSearchResult[] {
    return results
      .sort((a, b) => {
        // Sort by score descending, then by depth ascending
        if (b.score !== a.score) return b.score - a.score;
        return a.node.depth - b.node.depth;
      })
      .slice(0, maxResults);
  }
}

/**
 * Simple glob-like pattern matching for file paths.
 */
function matchesSimplePattern(filePath: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return filePath.includes(pattern);
  }

  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');

  try {
    return new RegExp(regexStr).test(filePath);
    /* v8 ignore start -- defensive catch for invalid regex, unreachable with escaped input */
  } catch {
    return filePath.includes(pattern.replace(/\*/g, ''));
  }
  /* v8 ignore stop */
}