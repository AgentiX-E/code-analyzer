// @code-analyzer/vscode — Engine Bridge
// Facade that bridges the VS Code extension to the bundled analyzer engine.
// Abstracts all intelligence-layer operations behind simplified methods.

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

// ---------------------------------------------------------------------------
// Public return types (simplified for vscode consumers)
// ---------------------------------------------------------------------------

export interface SearchResultItem {
  name: string;
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

export interface ChangedFileItem {
  path: string;
  status: string;
}

export interface ChangedSymbolItem {
  name: string;
  riskLevel: string;
}

export interface ImpactResultItem {
  riskLevel: string;
  affectedSymbols: number;
}

export interface TraceResultItem {
  name: string;
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

  constructor(context?: { globalStorageUri?: { fsPath: string }; workspaceRoot?: string }) {
    this.workspaceRoot = context?.workspaceRoot ?? null;
    const dbPath =
      context?.globalStorageUri?.fsPath
        ? `${context.globalStorageUri.fsPath}/graph.db`
        : ':memory:';
    this.store = new InMemoryGraphStore(dbPath);
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

    // If store was closed (after dispose), recreate it
    try {
      await this.embedder.initialize();
      this.searchEngine.initialize();
    } catch {
      // Store was closed, recreate all components
      this.store = new InMemoryGraphStore(':memory:');
      this.searchEngine = new HybridSearchEngine(this.store);
      this.reviewEngine = new CodeReviewEngine(this.store);
      this.changeDetector = new ChangeDetector(this.store);
      this.impactAnalyzer = new ImpactAnalyzer(this.store);
      this.embedder = new EmbeddingEngine();
      await this.embedder.initialize();
      this.searchEngine.initialize();
    }
    this.initialized = true;
  }

  dispose(): void {
    this.store.close();
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
    this.notifyProgress({ status: 'ready', symbolCount: this.store.getAllNodes().length, progress: 100 });
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
      filePath: r.node.filePath ?? '',
      label: r.node.label,
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
      const fileContent = await this.getDiffContentSafe(git, diff);
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
    const changes = await this.changeDetector.detectChanges(
      this.projectId,
      diffs,
    );
    return changes.changedSymbols.map((s) => ({
      name: s.name,
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

    const changedSymbols = changes.map((c) => ({
      name: c.name,
      qualifiedName: c.name,
      filePath: '',
      changeType: 'modified' as const,
      lineRange: [1, 1] as [number, number],
      riskLevel: c.riskLevel as 'low' | 'medium' | 'high' | 'critical',
      reason: '',
    }));
    const impact = await this.impactAnalyzer.analyze(
      this.projectId,
      changedSymbols,
    );
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
      status: d.changeType === 'added'
        ? 'added'
        : d.changeType === 'deleted'
          ? 'deleted'
          : 'modified',
    }));
  }

  // -------------------------------------------------------------------------
  // Standards
  // -------------------------------------------------------------------------

  async checkStandards(
    filePath: string,
  ): Promise<StandardsResultItem[]> {
    const std = this.standards.loadStandard('typescript-coding');
    if (!std) return [];
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
      type: 'CALLS',
      limit: 100,
    });

    return outgoingEdges.items.map((e) => {
      const targetNode = this.store.getNode(e.targetId);
      return {
        name: targetNode?.name ?? `node-${e.targetId}`,
        filePath: targetNode?.filePath ?? '',
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
      type: 'TESTS',
      limit: 100,
    });

    return testEdges.items.map((e) => {
      const testNode = this.store.getNode(e.sourceId);
      return {
        name: testNode?.name ?? `test-${e.sourceId}`,
        filePath: testNode?.filePath ?? '',
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

    const lineCount = node.endLine !== null && node.startLine !== null
      ? node.endLine - node.startLine + 1
      : 0;

    return {
      cyclomaticComplexity: node.complexity ?? 0,
      linesOfCode: lineCount,
      parameterCount: 0, // Would require AST parsing
      nestingDepth: 0,   // Would require AST parsing
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

  private getWorkspaceRoot(): string | null {
    return this.workspaceRoot ?? process.cwd();
  }

  private async getDiffContentSafe(
    git: ReturnType<typeof createGitOperations>,
    diff: GitDiff,
  ): Promise<string> {
    try {
      if (diff.changeType === 'deleted') {
        return '';
      }
      if (diff.newHash) {
        return await git.getFileContent('HEAD', diff.filePath);
      }
      // Fallback: build from metadata
      return `// File: ${diff.filePath}\n// Change: ${diff.changeType}\n`;
    } catch {
      return `// File: ${diff.filePath}\n// Change: ${diff.changeType}\n`;
    }
  }
}
