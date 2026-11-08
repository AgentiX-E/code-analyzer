// @code-analyzer/mcp — ToolContext
// Wraps the InMemoryGraphStore and all analysis services for use by tool handlers.

import {
  createQueryEmbedder,
  embedderUnavailableReason,
  hasSimilaritySpace,
} from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  HybridSearchEngine,
  CodeReviewEngine,
  PRReviewEngine,
  ImpactAnalyzer,
  RepoGroupManager,
  FederatedSearchEngine,
  CrossRepoIndexer,
  CrossRepoPRReviewEngine,
  createLLMProvider,
  expandToVector,
} from '@code-analyzer/intelligence';

import type {
  EmbeddingBackendName,
  PipelineOrchestrator,
  PipelineResult,
  QueryEmbedder,
} from '@code-analyzer/analyzer';
import type { InterprocTaintFinding, LLMProvider } from '@code-analyzer/intelligence';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** What the semantic half turned out to be: the engine, the space, and whether that space can order anything. */
export interface SemanticSearchWiring {
  engine: HybridSearchEngine;
  /** The space the index holds: `onnx`, `api`, `deterministic`, or `none` when it holds no named vectors. */
  backend: string;
  /** The function that puts a text into the index's space, or `null` when nothing can. **Expansion needs it.** */
  embed: ((text: string) => Promise<Float32Array>) | null;
  /** Whether the vectors behind this index can order anything. **False means the semantic half did not run.** */
  semantic: boolean;
  /** Why the semantic half did not run, in one sentence, or `null` when it did. */
  reason: string | null;
}

/** What a context can be given beside the store. */
export interface ToolContextOptions {
  /** The provider, or `null` for a deployment with none. **`undefined` means "whatever the environment configures".** */
  llm?: LLMProvider | null;
  /**
   * How a text is projected into the index's space, defaulting to `createQueryEmbedder`.
   *
   * **A seam, because the model that produced an index is not always reachable from here.** A deployment can hold its
   * own embedder - a local server, a pinned model file, a test that needs a space with similarity on a machine with no
   * key and no 137 MB model - and `createQueryEmbedder` already takes a loader for the same reason. Without it the only
   * hybrid search reachable offline would be the hash one, which ranks nothing.
   */
  queryEmbedderLoader?: (backend: EmbeddingBackendName) => Promise<QueryEmbedder | null>;
}

/** Context provided to every MCP tool handler. Wraps all core services. */
export interface ToolContext {
  /** The underlying graph store. All tool data lives here. */
  store: InMemoryGraphStore;

  /**
   * The directory a project was indexed from, or `null` when nothing recorded one.
   *
   * **The store holds symbols and never bytes**, so a tool that promises code has to reach the filesystem — and the
   * filesystem path it needs is the one `analyze_repository` was given, which nothing kept. `get_code_snippet` answered
   * `// Code snippet not available in current session` for every call it ever received, including the ones a fixture
   * indexed from a temporary directory in the same process could have answered by opening the file.
   */
  projectRoot(projectId: string): string | null;

  /** Record the directory a project was indexed from. Called by `analyze_repository`, the only caller that knows it. */
  setProjectRoot(projectId: string, root: string): void;

  /** Hybrid search engine (BM25 + vector). Lazy initialized. */
  getSearchEngine(): HybridSearchEngine;

  /**
   * The same engine with the semantic half wired, if the index holds vectors **that can rank**.
   *
   * **`getSearchEngine()` alone is lexical**, and until this existed the vectors the pipeline computed were reachable
   * from nothing but a benchmark: `registerEmbeddings` had exactly one caller, in a test. **The query side is built from
   * the space the index recorded** - a cosine between two models is noise - and when no vectors are present this returns
   * the lexical engine unchanged, which is the honest answer rather than a silent downgrade.
   *
   * **`semantic` is the third state, and it is not the same as `backend !== 'none'`.** An index written by the hash
   * fallback holds vectors and names its space, and every cosine over them is a draw: the product fused that list into
   * the ranking at equal weight and lost **55 of 99 questions for 3** on the pinned corpus. So a space that cannot rank
   * reports `semantic: false` with the reason, registers nothing, and the search answers lexically.
   */
  getSemanticSearchEngine(): Promise<SemanticSearchWiring>;

  /**
   * A query rewritten as the code it describes, in the index's space.
   *
   * **`null` is an answer, not a failure**: no vectors, no embedder or no provider all mean "search the question as
   * written", which every caller can still do. Optional, so a context built by a test does not have to implement it.
   */
  expandQuery?(query: string): Promise<{ vector: Float32Array; hypothesis: string } | null>;

  /**
   * The configured provider, or `null`. **Optional, and `null` is the ordinary state of a machine without a key.**
   *
   * Exposed because a stage that needs the provider itself - reranking asks for an ordering rather than a vector - has
   * no other way to reach it, and building a second one at the call site would put the vendor choice back in two
   * places.
   */
  getLLMProvider?(): LLMProvider | null;

  /** Code review engine (heuristics-based). Lazy initialized. */
  getReviewEngine(): CodeReviewEngine;

  /** PR review engine (standards + impact + review). Lazy initialized. */
  getPRReviewEngine(): PRReviewEngine;

  /** Impact analyzer (BFS-based dependency traversal). Lazy initialized. */
  getImpactAnalyzer(): ImpactAnalyzer;

  /** Pipeline orchestrator for running analysis phases. Lazy initialized. */
  getPipeline(): Promise<PipelineOrchestrator>;

  /**
   * Inter-procedural taint findings from the last pipeline run.
   *
   * They live here rather than in `phaseData` because they have to outlive the run: a tool asked for taint analysis
   * hours after indexing must still find the result. Empty until a run produces them, which is distinguishable from
   * "no findings" only by whether a run has happened — see `taintAnalysis`, which reports the method it used.
   */
  taintFindings: readonly InterprocTaintFinding[];

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
  getDependencyTree(
    projectId: string,
    symbolQname: string,
    maxDepth?: number,
  ): DependencyTreeNode | null;

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
  private _semantic: Promise<SemanticSearchWiring> | null = null;
  private _llm: LLMProvider | null | undefined;
  private readonly llmOverride?: LLMProvider | null;
  private readonly queryEmbedderLoader: (
    backend: EmbeddingBackendName,
  ) => Promise<QueryEmbedder | null>;
  private _reviewEngine: CodeReviewEngine | null = null;
  private _prReviewEngine: PRReviewEngine | null = null;
  private _impactAnalyzer: ImpactAnalyzer | null = null;
  private _pipeline: PipelineOrchestrator | null = null;

  /** @see ToolContext.taintFindings */
  taintFindings: readonly InterprocTaintFinding[] = [];
  private _repoGroupManager: RepoGroupManager | null = null;
  private _federatedSearch: FederatedSearchEngine | null = null;
  private _crossRepoIndexer: CrossRepoIndexer | null = null;
  private _crossRepoPrReview: CrossRepoPRReviewEngine | null = null;
  public currentAnalysis?: PipelineResult;
  /** Where each project's files are, keyed by the id it was indexed under. */
  private readonly projectRoots = new Map<string, string>();

  constructor(store: InMemoryGraphStore, options: ToolContextOptions = {}) {
    this.store = store;
    this.llmOverride = options.llm;
    this.queryEmbedderLoader =
      options.queryEmbedderLoader ?? ((backend) => createQueryEmbedder(backend));
  }

  /**
   * Record the directory a project was indexed from.
   *
   * Called by `analyze_repository`, which is the only place that knows it. **A project indexed before this existed has
   * no root, and `projectRoot` returns `null` rather than guessing** — a guess would read someone else's files.
   */
  setProjectRoot(projectId: string, root: string): void {
    this.projectRoots.set(projectId, root);
  }

  projectRoot(projectId: string): string | null {
    return this.projectRoots.get(projectId) ?? null;
  }

  getSearchEngine(): HybridSearchEngine {
    if (!this._searchEngine) {
      this._searchEngine = new HybridSearchEngine(this.store);
      this._searchEngine.initialize();
    }
    return this._searchEngine;
  }

  getSemanticSearchEngine(): Promise<SemanticSearchWiring> {
    // **Cached as a promise, not as a value**: two tool calls arriving together must register the embedder once.
    this._semantic ??= this.wireSemanticSearch();
    return this._semantic;
  }

  /**
   * The provider this context uses, built on first use.
   *
   * **`undefined` in the options means "use what the deployment configured"**, `null` means "there is none" - the
   * difference is what lets a test exercise the absence without unsetting an environment variable.
   */
  private llmProvider(): LLMProvider | null {
    if (this._llm === undefined) {
      this._llm = this.llmOverride === undefined ? createLLMProvider() : this.llmOverride;
    }
    return this._llm;
  }

  /** @see ToolContext.getLLMProvider */
  getLLMProvider(): LLMProvider | null {
    return this.llmProvider();
  }

  /** @see ToolContext.expandQuery */
  async expandQuery(query: string): Promise<{ vector: Float32Array; hypothesis: string } | null> {
    const { embed } = await this.getSemanticSearchEngine();
    if (!embed) return null;
    const provider = this.llmProvider();
    if (!provider) return null;
    const expanded = await expandToVector(query, provider, embed);
    // **A hypothesis too short to be one leaves the query as it was** — see `expandToVector`.
    return expanded.hypothesis.length > 0
      ? { vector: expanded.vector, hypothesis: expanded.hypothesis }
      : null;
  }

  private async wireSemanticSearch(): Promise<SemanticSearchWiring> {
    const engine = this.getSearchEngine();

    // **Which space the index is in is a property of the data**, written by the embed phase beside the vectors, so a
    // consumer that loads a graph from elsewhere can still build a matching query embedder.
    let backend: string | null = null;
    const vectors = new Map<number, Float32Array>();
    for (const node of this.store.getAllNodes()) {
      const properties = node.properties as
        { embedding?: unknown; embeddingBackend?: unknown } | undefined;
      const vector = properties?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) continue;
      vectors.set(node.id, Float32Array.from(vector));
      if (backend === null && typeof properties?.embeddingBackend === 'string') {
        backend = properties.embeddingBackend;
      }
    }
    // **No vectors is the ordinary state and needs no reason**: an index whose pipeline produced none is lexical, and
    // saying "the semantic half did not run" about it would be a sentence with nothing behind it.
    if (vectors.size === 0) {
      return { engine, backend: 'none', embed: null, semantic: false, reason: null };
    }
    // A vector whose space nobody named **cannot be compared with a query**, so the honest answer is `none` rather
    // than a cosine against whatever backend happens to be reachable - which is the mismatch that published 0.638.
    if (backend === null) {
      return {
        engine,
        backend: 'none',
        embed: null,
        semantic: false,
        reason:
          'the index holds vectors but names no space for them, so no query can be projected into it',
      };
    }

    // **The defect this branch exists for, stated as the branch it is.** With no model file and no key - a fresh
    // install, and every machine that runs this repository's tests - the embed phase writes a hash of each text and
    // labels it `deterministic`. Those vectors exist, the space has a name, and a cosine between two of them is a draw
    // from a distribution centred on zero: fusing that list at equal weight answered **55 of 99 frozen questions worse
    // than the lexical list alone** on the pinned corpus, with MRR **0.0570 against 0.1990**. A space that cannot rank
    // is not a weak arm to be weighted; it is the absence of one, and the search below answers without it.
    if (!hasSimilaritySpace(backend as EmbeddingBackendName)) {
      return {
        engine,
        backend,
        embed: null,
        semantic: false,
        reason:
          `the index's vectors are a hash of each text (${backend}), not a model: a cosine between two of them is ` +
          'a draw, so nothing was ranked by them',
      };
    }

    const queryEmbedder = await this.queryEmbedderLoader(backend as EmbeddingBackendName);
    if (!queryEmbedder) {
      return {
        // **The space is still named**, because "the index holds no vectors" and "the index holds `api` vectors this
        // machine cannot join" are two different facts and only one of them is fixed by installing a model.
        engine,
        backend,
        embed: null,
        semantic: false,
        reason:
          embedderUnavailableReason() ??
          `the index holds ${backend} vectors and no embedder for that space is reachable here`,
      };
    }
    // **The mismatch is checked here as well as inside `createQueryEmbedder`**, because a loader is supplied by the
    // caller and a caller can be wrong: a query vector from another space is the defect that published 0.638 as a
    // semantic figure, and a seam that trusts its own input would reintroduce it one layer up.
    if (queryEmbedder.backend !== backend) {
      return {
        engine,
        backend,
        embed: null,
        semantic: false,
        reason: `the index holds ${backend} vectors and the embedder offered produces ${queryEmbedder.backend}`,
      };
    }

    const embed = (text: string): Promise<Float32Array> => queryEmbedder.embed(text);
    engine.registerEmbeddings((nodeId) => vectors.get(nodeId) ?? null, embed);
    return { engine, backend: queryEmbedder.backend, embed, semantic: true, reason: null };
  }

  getReviewEngine(): CodeReviewEngine {
    if (!this._reviewEngine) {
      this._reviewEngine = new CodeReviewEngine(this.store, { allowMetadataFallback: true });
    }
    return this._reviewEngine;
  }

  getPRReviewEngine(): PRReviewEngine {
    if (!this._prReviewEngine) {
      this._prReviewEngine = new PRReviewEngine(this.getReviewEngine(), this.store);
    }
    return this._prReviewEngine;
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
      this._crossRepoIndexer = new CrossRepoIndexer(this.store, this.getRepoGroupManager());
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
    return this.store
      .getAllNodes()
      .filter((n) => n.projectId === projectId && n.filePath === filePath);
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

  getDependencyTree(
    _projectId: string,
    symbolQname: string,
    maxDepth: number = 3,
  ): DependencyTreeNode | null {
    const node = this.store.getNodeByQualifiedName(symbolQname);
    if (!node) return null;

    const bfs = this.store.bfs(node.id, maxDepth);

    // Build tree from BFS results
    const nodeMap = new Map<number, DependencyTreeNode>();

    for (const bfsNode of bfs.nodes) {
      // Invariant: bfs() adds an id to `visited` and writes its `pathLengths` entry
      // together at both insertion sites (the source node and every newly discovered
      // neighbour), and it filters `nodes` out of that same `visited` set. Every
      // reported node therefore carries a path length and the `?? 0` fallback that
      // used to sit here was unreachable.
      const depth = bfs.pathLengths.get(bfsNode.id)!;
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
      // Invariant: bfs() records only the edge that discovered each node, and only
      // after both of its endpoints are in `visited`. insertEdge() rejects edges whose
      // endpoints are absent and deleteNode() cascades to every connected edge, so both
      // endpoints are always present in `nodeMap` and the `if (parent && child)` guard
      // that used to sit here could never take its false branch.
      const parent = nodeMap.get(bfsEdge.sourceId)!;
      const child = nodeMap.get(bfsEdge.targetId)!;
      parent.children.push(child);
    }

    // Return the root
    // Invariant: the queried node was resolved from this store and bfs() was handed its
    // own id, so bfs() visits it and reports it in `nodes`; no await separates the two
    // calls, so the node cannot be deleted in between.
    return nodeMap.get(node.id)!;
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
