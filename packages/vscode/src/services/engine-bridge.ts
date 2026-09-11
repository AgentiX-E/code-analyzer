// @code-analyzer/vscode — Engine Bridge
// Facade that bridges the VS Code extension to the bundled analyzer engine.
// Abstracts all intelligence-layer operations behind simplified methods.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InMemoryGraphStore, createGitOperations } from '@code-analyzer/infra';
import {
  HybridSearchEngine,
  CodeReviewEngine,
  StandardsEngine,
  ChangeDetector,
  ImpactAnalyzer,
  EmbeddingEngine,
} from '@code-analyzer/intelligence';
import type { GitDiff } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_TESTS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Public return types (simplified for vscode consumers)
// ---------------------------------------------------------------------------

export interface SearchResultItem {
  name: string;
  /**
   * Graph-qualified name. Every read model carries it because every affordance
   * built on these items — open the detail, follow the callers — re-queries the
   * graph, and the graph resolves a symbol by its qualified name only.
   */
  qualifiedName: string;
  filePath: string;
  label: string;
}

export interface ReviewCommentItem {
  severity: string;
  title: string;
  path: string;
  startLine: number;
  endLine: number;
  message: string;
}

/** A symbol reference carrying the identity the graph is queried by. */
export interface SymbolRefItem {
  name: string;
  /**
   * Graph-qualified name. Anything that re-queries the graph for this symbol —
   * `findCallees`, `findRelatedTests`, `getSymbolDetail` — resolves it through
   * the qualified name, never through the bare identifier.
   */
  qualifiedName: string;
  filePath: string;
  label: string;
}

export interface ChangedFileItem {
  path: string;
  status: string;
}

export interface ChangedSymbolItem {
  name: string;
  /**
   * Graph-qualified name. The impact analyzer resolves changed symbols through
   * it, so it must be the node's real qualified name rather than the bare
   * identifier.
   */
  qualifiedName: string;
  riskLevel: string;
}

export interface ImpactResultItem {
  riskLevel: string;
  affectedSymbols: number;
}

export interface TraceResultItem {
  name: string;
  /** Graph-qualified name — see SearchResultItem.qualifiedName. */
  qualifiedName: string;
  filePath: string;
}

export interface StandardsResultItem {
  passed: boolean;
  message: string;
}

export interface SymbolDetailItem {
  name: string;
  qualifiedName: string;
  filePath: string;
  signature?: string;
  docstring?: string;
  label: string;
  isExported: boolean;
}

export interface ComplexityMetricsItem {
  cyclomaticComplexity: number;
  linesOfCode: number;
  parameterCount: number;
  nestingDepth: number;
}

export interface SearchResultWithScore extends SearchResultItem {
  relevanceScore: number;
}

export type IndexingListener = () => void;

export type IndexingProgressListener = (state: IndexingState) => void;

export interface IndexingState {
  status: 'idle' | 'indexing' | 'ready' | 'error';
  symbolCount: number;
  progress: number;
}

// ---------------------------------------------------------------------------
// EngineBridge
// ---------------------------------------------------------------------------

export class EngineBridge {
  private store: InMemoryGraphStore;
  /**
   * Whether this bridge created the store and is therefore responsible for
   * closing it. A caller-supplied store outlives the bridge.
   */
  private readonly ownsStore: boolean;
  /** Set by dispose() when it closed a store this bridge owns. */
  private storeWasClosed = false;
  private searchEngine: HybridSearchEngine;
  private reviewEngine: CodeReviewEngine;
  private standards: StandardsEngine;
  private changeDetector: ChangeDetector;
  private impactAnalyzer: ImpactAnalyzer;
  private embedder: EmbeddingEngine;
  private initialized = false;
  private projectId: string | null = null;
  private workspaceRoot: string | null = null;
  private indexingListeners: IndexingListener[] = [];
  private progressListeners: IndexingProgressListener[] = [];

  constructor(context?: {
    globalStorageUri?: { fsPath: string };
    workspaceRoot?: string;
    /**
     * Graph to query. Defaults to a fresh in-memory store.
     *
     * The bridge is a read-only facade — it never inserts a node — so without a
     * way to hand it the graph that was built elsewhere, every query below reads
     * an empty store and every feature degrades to "no results". This seam is
     * what makes the facade usable by an indexer that owns the graph.
     */
    store?: InMemoryGraphStore;
  }) {
    this.workspaceRoot = context?.workspaceRoot ?? null;
    const dbPath = context?.globalStorageUri?.fsPath
      ? `${context.globalStorageUri.fsPath}/graph.db`
      : ':memory:';
    this.ownsStore = !context?.store;
    this.store = context?.store ?? new InMemoryGraphStore(dbPath);
    this.searchEngine = new HybridSearchEngine(this.store);
    this.reviewEngine = new CodeReviewEngine(this.store);
    this.standards = new StandardsEngine();
    this.changeDetector = new ChangeDetector(this.store);
    this.impactAnalyzer = new ImpactAnalyzer(this.store);
    this.embedder = new EmbeddingEngine();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // dispose() closes the graph, so re-initializing has to rebuild the store
    // and every component bound to it. Deriving that from state keeps the
    // recovery deterministic: the previous version detected the closed store by
    // letting "InMemoryGraphStore is closed" escape the first query and then
    // retried once, so recovery depended on the store continuing to throw on
    // use. A caller-supplied graph is never closed by this bridge, so it always
    // survives a re-initialize untouched.
    if (this.storeWasClosed) {
      this.store = new InMemoryGraphStore(':memory:');
      this.storeWasClosed = false;
      this.searchEngine = new HybridSearchEngine(this.store);
      this.reviewEngine = new CodeReviewEngine(this.store);
      this.changeDetector = new ChangeDetector(this.store);
      this.impactAnalyzer = new ImpactAnalyzer(this.store);
    }

    await this.embedder.initialize();
    this.searchEngine.initialize();
    this.initialized = true;
  }

  dispose(): void {
    if (this.ownsStore) {
      this.store.close();
      this.storeWasClosed = true;
    }
    this.embedder.dispose();
    this.initialized = false;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  // -------------------------------------------------------------------------
  // Indexing event listeners
  // -------------------------------------------------------------------------

  onIndexingComplete(fn: IndexingListener): void {
    this.indexingListeners.push(fn);
  }

  onIndexingProgress(fn: IndexingProgressListener): void {
    this.progressListeners.push(fn);
  }

  private notifyIndexingComplete(): void {
    for (const fn of this.indexingListeners) {
      fn();
    }
    this.notifyProgress({
      status: 'ready',
      symbolCount: this.store.getAllNodes().length,
      progress: 100,
    });
  }

  private notifyProgress(state: IndexingState): void {
    for (const fn of this.progressListeners) {
      fn(state);
    }
  }

  /**
   * Return the current indexing state for status bar display.
   */
  getIndexingState(): IndexingState {
    const nodeCount = this.store.getAllNodes().length;
    return {
      status: this.initialized ? 'ready' : 'idle',
      symbolCount: nodeCount,
      progress: this.initialized ? 100 : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async search(query: string): Promise<SearchResultItem[]> {
    if (!this.projectId) return [];
    const results = await this.searchEngine.search({
      query,
      projectId: this.projectId,
      limit: 10,
    });
    return results.map((r) => ({
      name: r.node.name,
      qualifiedName: r.node.qualifiedName,
      filePath: r.node.filePath ?? '',
      label: r.node.label,
    }));
  }

  /**
   * Every symbol in the active project, in insertion order.
   *
   * The "browse everything" surfaces — the graph explorer and both halves of the
   * knowledge-graph tree — used to call `search('')` for this. An empty query
   * matches no term, so BM25 returns nothing and all three views were
   * permanently empty. Listing the graph is what they actually want, and it also
   * yields the qualified name those views need to follow edges.
   *
   * `limit` is explicit because the store defaults to 20 nodes per query.
   */
  async listProjectSymbols(limit = 200): Promise<SymbolRefItem[]> {
    if (!this.projectId) return [];
    const page = this.store.queryNodes({ projectId: this.projectId, limit });
    return page.items.map((n) => ({
      name: n.name,
      qualifiedName: n.qualifiedName,
      filePath: n.filePath ?? '',
      label: n.label,
    }));
  }

  // -------------------------------------------------------------------------
  // Review
  // -------------------------------------------------------------------------

  async reviewWorkspace(): Promise<ReviewCommentItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return [];
    const git = createGitOperations(workspaceRoot);
    const diffs = await git.getWorkspaceDiff();
    if (diffs.length === 0) return [];

    const comments: ReviewCommentItem[] = [];
    for (const diff of diffs) {
      const fileContent = this.readWorkingTreeFile(diff);
      const fileComments = await this.reviewEngine.reviewFile(
        this.projectId ?? 'workspace',
        diff.filePath,
        fileContent,
      );
      comments.push(
        ...fileComments.map((c) => ({
          severity: c.severity,
          title: c.content.substring(0, 80),
          path: c.path,
          startLine: c.startLine,
          endLine: c.endLine,
          message: c.content,
        })),
      );
    }
    return comments;
  }

  // -------------------------------------------------------------------------
  // Change Detection
  // -------------------------------------------------------------------------

  async detectChanges(): Promise<ChangedSymbolItem[]> {
    if (!this.projectId) return [];
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return [];
    const git = createGitOperations(workspaceRoot);
    const diffs = await git.getWorkspaceDiff();
    const changes = await this.changeDetector.detectChanges(this.projectId, diffs);
    return changes.changedSymbols.map((s) => ({
      name: s.name,
      qualifiedName: s.qualifiedName,
      riskLevel: s.riskLevel,
    }));
  }

  // -------------------------------------------------------------------------
  // Impact Analysis
  // -------------------------------------------------------------------------

  async analyzeImpact(_symbol: string): Promise<ImpactResultItem> {
    if (!this.projectId) return { riskLevel: 'low', affectedSymbols: 0 };
    const changes = await this.detectChanges();
    if (!changes.length) return { riskLevel: 'low', affectedSymbols: 0 };

    // The analyzer resolves each changed symbol through its qualified name. This
    // used to be filled with the bare identifier, so resolution always failed and
    // /impact reported "low risk, 0 affected symbols" no matter what changed.
    const changedSymbols = changes.map((c) => ({
      name: c.name,
      qualifiedName: c.qualifiedName,
      filePath: '',
      changeType: 'modified' as const,
      lineRange: [1, 1] as [number, number],
      riskLevel: c.riskLevel as 'low' | 'medium' | 'high' | 'critical',
      reason: '',
    }));
    const impact = await this.impactAnalyzer.analyze(this.projectId, changedSymbols);
    return {
      riskLevel: impact.riskLevel,
      affectedSymbols: impact.impactTree.length,
    };
  }

  // -------------------------------------------------------------------------
  // Trace Call Path
  // -------------------------------------------------------------------------

  async traceCallPath(symbol: string): Promise<TraceResultItem[]> {
    if (!this.projectId) return [];
    const node = this.store.getNodeByQualifiedName(symbol);
    if (!node) return [];
    const result = this.store.bfs(node.id, 3);
    return result.nodes.map((n) => ({
      name: n.name,
      qualifiedName: n.qualifiedName,
      filePath: n.filePath ?? '',
    }));
  }

  // -------------------------------------------------------------------------
  // Find Related Symbols
  // -------------------------------------------------------------------------

  async findRelatedSymbols(entity: string): Promise<TraceResultItem[]> {
    if (!this.projectId) return [];
    const results = await this.searchEngine.search({
      query: entity,
      projectId: this.projectId,
      limit: 10,
    });
    return results.map((r) => ({
      name: r.node.name,
      qualifiedName: r.node.qualifiedName,
      filePath: r.node.filePath ?? '',
    }));
  }

  async findImplementations(entity: string): Promise<TraceResultItem[]> {
    return this.findRelatedSymbols(entity);
  }

  async findCallers(entity: string): Promise<TraceResultItem[]> {
    return this.traceCallPath(entity);
  }

  // -------------------------------------------------------------------------
  // Changed Files
  // -------------------------------------------------------------------------

  async getChangedFiles(): Promise<ChangedFileItem[]> {
    const root = this.getWorkspaceRoot();
    if (!root) return [];
    const git = createGitOperations(root);
    const diffs = await git.getWorkspaceDiff();
    return diffs.map((d) => ({
      path: d.filePath,
      status:
        d.changeType === 'added' ? 'added' : d.changeType === 'deleted' ? 'deleted' : 'modified',
    }));
  }

  // -------------------------------------------------------------------------
  // Standards
  // -------------------------------------------------------------------------

  async checkStandards(filePath: string): Promise<StandardsResultItem[]> {
    // Invariant: StandardsEngine.loadStandard() returns a ProjectStandard or
    // throws — it is typed non-nullable — so there is no missing standard to
    // guard against here.
    const std = this.standards.loadStandard('typescript-coding');
    const results = this.standards.checkSource('', filePath, std);
    return results.map((r) => ({
      passed: r.passed,
      message: r.ruleDescription,
    }));
  }

  // -------------------------------------------------------------------------
  // Symbol Details — full symbol info with signature and docstring
  // -------------------------------------------------------------------------

  async getSymbolDetail(entity: string): Promise<SymbolDetailItem | undefined> {
    if (!this.projectId) return undefined;
    const node = this.store.getNodeByQualifiedName(entity);
    if (!node) return undefined;

    return {
      name: node.name,
      qualifiedName: node.qualifiedName,
      filePath: node.filePath ?? '',
      signature: node.signature ?? undefined,
      docstring: node.docstring ?? undefined,
      label: node.label,
      isExported: node.isExported,
    };
  }

  // -------------------------------------------------------------------------
  // Callees — find symbols called by the given symbol (outgoing edges)
  // -------------------------------------------------------------------------

  async findCallees(entity: string): Promise<TraceResultItem[]> {
    if (!this.projectId) return [];
    const node = this.store.getNodeByQualifiedName(entity);
    if (!node) return [];

    const outgoingEdges = this.store.queryEdges({
      projectId: this.projectId,
      sourceId: node.id,
      type: EDGE_CALLS,
      limit: 100,
    });

    return outgoingEdges.items.map((e) => {
      // Invariant: insertEdge() rejects an edge whose endpoints are missing and
      // deleteNode() cascades to every connected edge, so an edge yielded by
      // queryEdges() always resolves to a live node.
      const targetNode = this.store.getNode(e.targetId)!;
      return {
        name: targetNode.name,
        qualifiedName: targetNode.qualifiedName,
        filePath: targetNode.filePath ?? '',
      };
    });
  }

  // -------------------------------------------------------------------------
  // Related Tests — find tests that test a given symbol
  // -------------------------------------------------------------------------

  async findRelatedTests(entity: string): Promise<TraceResultItem[]> {
    if (!this.projectId) return [];
    const node = this.store.getNodeByQualifiedName(entity);
    if (!node) return [];

    const testEdges = this.store.queryEdges({
      projectId: this.projectId,
      targetId: node.id,
      type: EDGE_TESTS,
      limit: 100,
    });

    return testEdges.items.map((e) => {
      // Invariant: insertEdge() rejects an edge whose endpoints are missing and
      // deleteNode() cascades to every connected edge, so an edge yielded by
      // queryEdges() always resolves to a live node.
      const testNode = this.store.getNode(e.sourceId)!;
      return {
        name: testNode.name,
        qualifiedName: testNode.qualifiedName,
        filePath: testNode.filePath ?? '',
      };
    });
  }

  // -------------------------------------------------------------------------
  // Complexity Metrics
  // -------------------------------------------------------------------------

  async getComplexityMetrics(entity: string): Promise<ComplexityMetricsItem> {
    if (!this.projectId) {
      return { cyclomaticComplexity: 0, linesOfCode: 0, parameterCount: 0, nestingDepth: 0 };
    }
    const node = this.store.getNodeByQualifiedName(entity);
    if (!node) {
      return { cyclomaticComplexity: 0, linesOfCode: 0, parameterCount: 0, nestingDepth: 0 };
    }

    const lineCount =
      node.endLine !== null && node.startLine !== null ? node.endLine - node.startLine + 1 : 0;

    return {
      cyclomaticComplexity: node.complexity ?? 0,
      linesOfCode: lineCount,
      parameterCount: 0, // Would require AST parsing
      nestingDepth: 0, // Would require AST parsing
    };
  }

  // -------------------------------------------------------------------------
  // Search with Scores — search returning relevance scores
  // -------------------------------------------------------------------------

  async searchWithScores(query: string): Promise<SearchResultWithScore[]> {
    if (!this.projectId) return [];
    const results = await this.searchEngine.search({
      query,
      projectId: this.projectId,
      limit: 20,
    });
    return results.map((r) => ({
      name: r.node.name,
      qualifiedName: r.node.qualifiedName,
      filePath: r.node.filePath ?? '',
      label: r.node.label,
      relevanceScore: r.combinedScore,
    }));
  }

  // -------------------------------------------------------------------------
  // Incremental re-index for file watcher
  // -------------------------------------------------------------------------

  /**
   * Trigger a re-index for changed files. Called by the file watcher
   * after files have been modified on disk.
   */
  async incrementalReindex(_changedFiles: string[]): Promise<void> {
    if (!this.initialized) return;

    // Rebuild the search index to reflect any changes
    this.searchEngine.rebuildIndex();

    // Notify listeners that indexing state has changed
    this.notifyIndexingComplete();
  }

  // -------------------------------------------------------------------------
  // Project Management
  // -------------------------------------------------------------------------

  setProjectId(id: string): void {
    this.projectId = id;
  }

  getProjectId(): string | null {
    return this.projectId;
  }

  /**
   * Index workspace by discovering files and running the pipeline.
   * After completion, notifies listeners.
   */
  async indexWorkspace(rootPath: string): Promise<void> {
    // Initialize if not already done
    if (!this.initialized) {
      await this.initialize();
    }
    this.setProjectId(rootPath);

    // Build inverted index by loading all store nodes into the search engine
    this.searchEngine.rebuildIndex();

    this.notifyIndexingComplete();
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * The root that git and the filesystem are read from.
   *
   * Always a string: `process.cwd()` stands in for an unset root. Callers still
   * treat an empty root as "no workspace", because `workspaceRoot` is a public
   * option and `''` is not nullish, so `??` passes it through.
   */
  private getWorkspaceRoot(): string {
    return this.workspaceRoot ?? process.cwd();
  }

  /**
   * Read the file a workspace diff refers to, so the review runs against the
   * real source rather than against a description of the change.
   *
   * This used to branch on `diff.newHash` and fetch the blob from git. Nothing
   * ever populates that field: `parseDiffOutput` — the only producer of a
   * `GitDiff` that reaches this facade — hard-codes `newHash: ''`, so the branch
   * was unreachable and every review analysed the two-line metadata stub below
   * instead of the file. No heuristic can fire on a stub, which is why /review
   * reported nothing for every workspace change. Reading the working tree is
   * also the correct source for an *uncommitted* diff, which is the only kind
   * `getWorkspaceDiff()` returns.
   */
  private readWorkingTreeFile(diff: GitDiff): string {
    // A deleted file has no content left to review. The discriminant is
    // `'deleted'` — the same literal `getChangedFiles()` maps to `DiffInfo.status`
    // and the one `parseDiffOutput()` assigns for a `deleted file mode` header.
    if (diff.changeType === 'deleted') return '';

    try {
      return readFileSync(resolve(this.getWorkspaceRoot(), diff.filePath), 'utf8');
    } catch {
      // Unreadable: a broken symlink, a permission error, or a file that
      // disappeared between the diff and now. Reporting the change is better
      // than aborting the whole run.
      return `// File: ${diff.filePath}\n// Change: ${diff.changeType}\n`;
    }
  }
}
