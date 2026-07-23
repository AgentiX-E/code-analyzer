// @code-analyzer/mcp — ToolContext
// Wraps the InMemoryGraphStore and all analysis services for use by tool handlers.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  HybridSearchEngine,
  CodeReviewEngine,
  ImpactAnalyzer,
  RepoGroupManager,
  FederatedSearchEngine,
  CrossRepoIndexer,
  CrossRepoPRReviewEngine,
} from '@code-analyzer/intelligence';
import type { PipelineOrchestrator } from '@code-analyzer/analyzer';
import type { PipelineResult } from '@code-analyzer/analyzer';
import type {
  GraphNode,
  GraphEdge,
  NodeLabel,
  RepoGroup,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Context provided to every MCP tool handler. Wraps all core services. */
export interface ToolContext {
  /** The underlying graph store. All tool data lives here. */
  store: InMemoryGraphStore;

  /** Hybrid search engine (BM25 + vector). Lazy initialized. */
  getSearchEngine(): HybridSearchEngine;

  /** Code review engine (heuristics-based). Lazy initialized. */
  getReviewEngine(): CodeReviewEngine;

  /** Impact analyzer (BFS-based dependency traversal). Lazy initialized. */
  getImpactAnalyzer(): ImpactAnalyzer;

  /** Pipeline orchestrator for running analysis phases. Lazy initialized. */
  getPipeline(): Promise<PipelineOrchestrator>;

  /** Repository group manager — CRUD for repo groups with persistence. */
  getRepoGroupManager(): RepoGroupManager;

  /** Federated search engine — cross-repo symbol search and duplicate detection. */
  getFederatedSearch(): FederatedSearchEngine;

  /** Cross-repo indexer — group indexing, impact analysis, contract detection. */
  getCrossRepoIndexer(): CrossRepoIndexer;

  /** Cross-repo PR review engine — reviews PRs with cross-repo awareness and dependency tracing. */
  getCrossRepoPRReviewEngine(): CrossRepoPRReviewEngine;

  /** Get node/edge counts and label distribution for the given project. */
  getGraphStats(projectId: string): GraphStats;

  /** Get all symbols defined in a specific file. */
  getFileSymbols(projectId: string, filePath: string): GraphNode[];

  /** Find all references to a symbol via reverse edge traversal. */
  findReferences(projectId: string, symbolQname: string): GraphNode[];

  /** BFS dependency tree from a node. */
  getDependencyTree(projectId: string, symbolQname: string, maxDepth?: number): DependencyTreeNode | null;

  /** Current analysis result if one is in progress. */
  currentAnalysis?: PipelineResult;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  labelDistribution: Array<{ label: string; count: number }>;
  relationshipDistribution: Array<{ type: string; count: number }>;
  projectId: string;
}

export interface DependencyTreeNode {
  node: {
    id: number;
    name: string;
    qualifiedName: string;
    label: string;
    filePath: string | null;
  };
  depth: number;
  children: DependencyTreeNode[];
}

// ---------------------------------------------------------------------------
// ToolContextImpl
// ---------------------------------------------------------------------------

export class ToolContextImpl implements ToolContext {
  public readonly store: InMemoryGraphStore;
  private _searchEngine: HybridSearchEngine | null = null;
  private _reviewEngine: CodeReviewEngine | null = null;
  private _impactAnalyzer: ImpactAnalyzer | null = null;
  private _pipeline: PipelineOrchestrator | null = null;
  private _repoGroupManager: RepoGroupManager | null = null;
  private _federatedSearch: FederatedSearchEngine | null = null;
  private _crossRepoIndexer: CrossRepoIndexer | null = null;
  private _crossRepoPrReview: CrossRepoPRReviewEngine | null = null;
  public currentAnalysis?: PipelineResult;

  constructor(store: InMemoryGraphStore) {
    this.store = store;
  }

  getSearchEngine(): HybridSearchEngine {
    if (!this._searchEngine) {
      this._searchEngine = new HybridSearchEngine(this.store);
      this._searchEngine.initialize();
    }
    return this._searchEngine;
  }

  getReviewEngine(): CodeReviewEngine {
    if (!this._reviewEngine) {
      this._reviewEngine = new CodeReviewEngine(this.store);
    }
    return this._reviewEngine;
  }

  getImpactAnalyzer(): ImpactAnalyzer {
    if (!this._impactAnalyzer) {
      this._impactAnalyzer = new ImpactAnalyzer(this.store);
    }
    return this._impactAnalyzer;
  }

  getRepoGroupManager(): RepoGroupManager {
    if (!this._repoGroupManager) {
      this._repoGroupManager = new RepoGroupManager();
    }
    return this._repoGroupManager;
  }

  getFederatedSearch(): FederatedSearchEngine {
    if (!this._federatedSearch) {
      this._federatedSearch = new FederatedSearchEngine(this.store);
    }
    return this._federatedSearch;
  }

  getCrossRepoIndexer(): CrossRepoIndexer {
    if (!this._crossRepoIndexer) {
      this._crossRepoIndexer = new CrossRepoIndexer(
        this.store,
        this.getRepoGroupManager(),
      );
    }
    return this._crossRepoIndexer;
  }

  getCrossRepoPRReviewEngine(): CrossRepoPRReviewEngine {
    if (!this._crossRepoPrReview) {
      this._crossRepoPrReview = new CrossRepoPRReviewEngine(
        this.getCrossRepoIndexer(),
        this.getRepoGroupManager(),
        this.getReviewEngine(),
      );
    }
    return this._crossRepoPrReview;
  }

  async getPipeline(): Promise<PipelineOrchestrator> {
    if (!this._pipeline) {
      const { PipelineOrchestrator: Orchestrator } = await import('@code-analyzer/analyzer');
      const { createAllPhases } = await import('@code-analyzer/analyzer');
      this._pipeline = new Orchestrator(createAllPhases());
    }
    return this._pipeline;
  }

  // -------------------------------------------------------------------------
  // Graph statistics
  // -------------------------------------------------------------------------

  getGraphStats(projectId: string): GraphStats {
    const nodes = this.store.getAllNodes().filter((n) => n.projectId === projectId);
    const edges = this.store.getAllEdges().filter((e) => e.projectId === projectId);

    // Count node labels
    const labelCounts = new Map<string, number>();
    for (const node of nodes) {
      labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1);
    }

    // Count relationship types
    const typeCounts = new Map<string, number>();
    for (const edge of edges) {
      typeCounts.set(edge.type, (typeCounts.get(edge.type) ?? 0) + 1);
    }

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      labelDistribution: Array.from(labelCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      relationshipDistribution: Array.from(typeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      projectId,
    };
  }

  // -------------------------------------------------------------------------
  // File symbols
  // -------------------------------------------------------------------------

  getFileSymbols(projectId: string, filePath: string): GraphNode[] {
    return this.store.getAllNodes().filter(
      (n) => n.projectId === projectId && n.filePath === filePath,
    );
  }

  // -------------------------------------------------------------------------
  // Find references via reverse edge traversal
  // -------------------------------------------------------------------------

  findReferences(projectId: string, symbolQname: string): GraphNode[] {
    const node = this.store.getNodeByQualifiedName(symbolQname);
    if (!node) return [];

    const incomingEdges = this.store.getEdgesForNode(node.id, undefined, 'in');
    const referenceNodes: GraphNode[] = [];

    for (const edge of incomingEdges) {
      const sourceNode = this.store.getNode(edge.sourceId);
      if (sourceNode && sourceNode.projectId === projectId) {
        referenceNodes.push(sourceNode);
      }
    }

    return referenceNodes;
  }

  // -------------------------------------------------------------------------
  // BFS dependency tree
  // -------------------------------------------------------------------------

  getDependencyTree(projectId: string, symbolQname: string, maxDepth: number = 3): DependencyTreeNode | null {
    const node = this.store.getNodeByQualifiedName(symbolQname);
    if (!node) return null;

    const bfs = this.store.bfs(node.id, maxDepth);

    // Build tree from BFS results
    const nodeMap = new Map<number, DependencyTreeNode>();

    for (const bfsNode of bfs.nodes) {
      const depth = bfs.pathLengths.get(bfsNode.id) ?? 0;
      nodeMap.set(bfsNode.id, {
        node: {
          id: bfsNode.id,
          name: bfsNode.name,
          qualifiedName: bfsNode.qualifiedName,
          label: bfsNode.label,
          filePath: bfsNode.filePath,
        },
        depth,
        children: [],
      });
    }

    // Link parent-child relationships based on edges
    for (const bfsEdge of bfs.edges) {
      const parent = nodeMap.get(bfsEdge.sourceId);
      const child = nodeMap.get(bfsEdge.targetId);
      if (parent && child) {
        parent.children.push(child);
      }
    }

    // Return the root
    return nodeMap.get(node.id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Check if a store parameter is an instance of ToolContext. */
  static isToolContext(value: unknown): value is ToolContext {
    return (
      typeof value === 'object' &&
      value !== null &&
      'store' in value &&
      'getSearchEngine' in value &&
      typeof (value as Record<string, unknown>)['getSearchEngine'] === 'function'
    );
  }

  /** Get store from a context or raw store parameter. */
  static getStore(storeOrContext: unknown): InMemoryGraphStore | null {
    if (storeOrContext instanceof InMemoryGraphStore) return storeOrContext;
    if (ToolContextImpl.isToolContext(storeOrContext)) return storeOrContext.store;
    return null;
  }
}
