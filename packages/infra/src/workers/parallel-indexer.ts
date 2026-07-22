// @code-analyzer/infra — Parallel Indexer
// High-performance parallel indexer using worker pool for concurrent file
// parsing, streaming graph construction, and batched store writes.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, join } from 'node:path';

import { getLanguageFromFilename } from '@code-analyzer/shared';
import type {
  DiscoveredFile,
  GraphEdge,
  GraphNode,
  NodeLabel,
  NodeProperties,
  ReferenceSite,
  SymbolDefinition,
  SupportedLanguage,
  RelationshipType,
} from '@code-analyzer/shared';

import { createFileDiscoverer } from '../filesystem/discoverer.js';
import type { FileDiscoverer } from '../filesystem/discoverer.js';
import type { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';
import type { SqliteGraphStore } from '../storage/sqlite-graph-store.js';
import { createWorkerPool } from './pool.js';
import type { WorkerPool, WorkerTask } from './pool.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParallelIndexerConfig {
  concurrency: number;
  batchSize: number;
  enableStreaming: boolean;
  enableIncremental: boolean;
}

export interface IndexProgress {
  phase: 'discovering' | 'parsing' | 'building' | 'dumping' | 'complete';
  filesDiscovered: number;
  filesParsed: number;
  nodesCreated: number;
  edgesCreated: number;
  progress: number; // 0-100
  elapsedMs: number;
  estimatedRemainingMs: number;
}

export interface IndexerOptions {
  languages?: string[];
  filePatterns?: string[];
  excludePatterns?: string[];
  force?: boolean;
}

export interface IndexerResult {
  rootPath: string;
  filesDiscovered: number;
  filesParsed: number;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
  errors: IndexerError[];
  incremental: boolean;
}

export interface IndexerError {
  filePath: string;
  message: string;
  recoverable: boolean;
}

/**
 * Callback invoked for each batch of parsed files.
 * The indexer creates graph nodes and edges from the parsed data
 * and writes them to the store.
 */
export interface BatchParseResult {
  filePath: string;
  language: string;
  symbols: SymbolDefinition[];
  references: ReferenceSite[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ParallelIndexerConfig = {
  concurrency: Math.max(1, cpus().length),
  batchSize: 50,
  enableStreaming: true,
  enableIncremental: true,
};

const SQLITE_FLUSH_BATCH = 500;
const PROGRESS_THROTTLE_MS = 100; // max 10 events/second
const HASHES_DIR = '.code-analyzer';
const HASHES_FILE = 'file-hashes.json';

// ---------------------------------------------------------------------------
// ParallelIndexer
// ---------------------------------------------------------------------------

export class ParallelIndexer {
  private readonly store: InMemoryGraphStore | SqliteGraphStore;
  private readonly config: ParallelIndexerConfig;
  private readonly pool: WorkerPool;
  private readonly discoverer: FileDiscoverer;

  private canceled = false;
  private startTime = 0;
  private lastProgressEmit = 0;

  private progressCallbacks: Array<(progress: IndexProgress) => void> = [];
  private completeCallbacks: Array<(result: IndexerResult) => void> = [];

  private currentProgress: IndexProgress;
  private totalFiles = 0;
  private processedFileCount = 0;
  private nodeCount = 0;
  private edgeCount = 0;
  private errors: IndexerError[] = [];

  // Node/edge accumulation buffers for batch SQLite writes
  private nodeBuffer: GraphNode[] = [];
  private edgeBuffer: GraphEdge[] = [];

  constructor(
    store: InMemoryGraphStore | SqliteGraphStore,
    config?: Partial<ParallelIndexerConfig>,
  ) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pool = createWorkerPool(this.config.concurrency);
    this.discoverer = createFileDiscoverer();
    this.currentProgress = {
      phase: 'discovering',
      filesDiscovered: 0,
      filesParsed: 0,
      nodesCreated: 0,
      edgesCreated: 0,
      progress: 0,
      elapsedMs: 0,
      estimatedRemainingMs: 0,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Index a directory with parallel file parsing. */
  async indexDirectory(
    rootPath: string,
    options?: IndexerOptions,
  ): Promise<IndexerResult> {
    this.reset();
    this.startTime = Date.now();

    try {
      // Phase 1: Discover files
      this.updateProgress('discovering', 0, 0);

      let files = await this.discoverFiles(rootPath, options);

      // Phase 2: Filter by language and patterns
      if (options?.languages && options.languages.length > 0) {
        const langSet = new Set(options.languages);
        files = files.filter((f) => f.language && langSet.has(f.language!));
      }

      if (options?.filePatterns && options.filePatterns.length > 0) {
        files = this.filterByPatterns(files, options.filePatterns);
      }

      // Phase 3: Check incremental (skip unchanged files)
      let incremental = false;
      if (this.config.enableIncremental && !options?.force) {
        const diffResult = await this.computeFileDiff(rootPath, files);
        files = diffResult.changed;
        incremental = diffResult.changed.length < diffResult.total;
      }

      if (files.length === 0) {
        this.finalizeProgress('complete', 100);
        const result = this.buildResult(rootPath, incremental);
        this.emitComplete(result);
        return result;
      }

      this.totalFiles = files.length;
      this.updateProgress('parsing', 0, 0);

      // Phase 4: Parallel batch processing with streaming
      await this.processInParallel(rootPath, files);

      // Phase 5: Flush remaining buffers
      await this.flushBuffers();

      // Phase 6: Save hashes for incremental
      if (this.config.enableIncremental) {
        await this.saveFileHashes(rootPath, files);
      }

      this.finalizeProgress('complete', 100);
      const result = this.buildResult(rootPath, incremental);
      this.emitComplete(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push({
        filePath: rootPath,
        message,
        recoverable: false,
      });
      this.finalizeProgress('complete', 100);
      const result = this.buildResult(rootPath, false);
      this.emitComplete(result);
      return result;
    }
  }

  /** Incremental index — only re-parse changed files. */
  async incrementalIndex(
    rootPath: string,
    changedFiles: string[],
  ): Promise<IndexerResult> {
    this.reset();
    this.startTime = Date.now();

    try {
      this.updateProgress('discovering', changedFiles.length, 0);

      // Read the content of each changed file
      const files: DiscoveredFile[] = [];
      for (const filePath of changedFiles) {
        const fullPath = join(rootPath, filePath);
        try {
          const content = await readFile(fullPath, 'utf-8');
          const hash = computeFileHash(content);
          const language = getLanguageFromFilename(filePath);
          files.push({
            filePath,
            language,
            content,
            hash,
            size: Buffer.byteLength(content),
          });
        } catch {
          this.errors.push({
            filePath,
            message: 'Failed to read file for incremental index',
            recoverable: true,
          });
        }
      }

      if (files.length === 0) {
        this.finalizeProgress('complete', 100);
        const result = this.buildResult(rootPath, true);
        this.emitComplete(result);
        return result;
      }

      this.totalFiles = files.length;
      this.updateProgress('parsing', 0, 0);

      await this.processInParallel(rootPath, files);

      await this.flushBuffers();

      // Update hashes for changed files
      await this.saveFileHashes(rootPath, files);

      this.finalizeProgress('complete', 100);
      const result = this.buildResult(rootPath, true);
      this.emitComplete(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push({
        filePath: rootPath,
        message,
        recoverable: false,
      });
      const result = this.buildResult(rootPath, true);
      this.emitComplete(result);
      return result;
    }
  }

  /** Get current indexing progress. */
  getProgress(): IndexProgress {
    return { ...this.currentProgress };
  }

  /** Cancel ongoing indexing. */
  cancel(): void {
    this.canceled = true;
    this.pool.shutdown();
  }

  /** Register progress callback (throttled to ~10 events/sec). */
  onProgress(callback: (progress: IndexProgress) => void): void {
    this.progressCallbacks.push(callback);
  }

  /** Register completion callback. */
  onComplete(callback: (result: IndexerResult) => void): void {
    this.completeCallbacks.push(callback);
  }

  // -----------------------------------------------------------------------
  // Private: File Discovery
  // -----------------------------------------------------------------------

  private async discoverFiles(
    rootPath: string,
    options?: IndexerOptions,
  ): Promise<DiscoveredFile[]> {
    const excludePatterns = [
      ...(options?.excludePatterns ?? []),
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '.next/**',
      'coverage/**',
      '__pycache__/**',
    ];

    return this.discoverer.discover(rootPath, {
      excludePatterns,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      respectGitignore: true,
    });
  }

  private filterByPatterns(
    files: DiscoveredFile[],
    patterns: string[],
  ): DiscoveredFile[] {
    return files.filter((f) => {
      const relPath = f.filePath;
      for (const pattern of patterns) {
        if (minimatchCheck(relPath, pattern)) return true;
      }
      return false;
    });
  }

  // -----------------------------------------------------------------------
  // Private: Parallel Processing
  // -----------------------------------------------------------------------

  private async processInParallel(
    rootPath: string,
    files: DiscoveredFile[],
  ): Promise<void> {
    const batches: DiscoveredFile[][] = [];
    for (let i = 0; i < files.length; i += this.config.batchSize) {
      batches.push(files.slice(i, i + this.config.batchSize));
    }

    // Process batches in groups of concurrency size for streaming behavior
    let batchIndex = 0;

    while (batchIndex < batches.length && !this.canceled) {
      const groupSize = Math.min(
        this.config.concurrency,
        batches.length - batchIndex,
      );
      const group = batches.slice(batchIndex, batchIndex + groupSize);

      // Submit all batches in the group
      const tasks: WorkerTask<BatchParseResult[]>[] = group.map(
        (batch, groupIdx) => ({
          id: `batch-${batchIndex + groupIdx}`,
          execute: () => this.parseBatch(batch),
          timeout: 60000,
          retries: 1,
        }),
      );

      let results: BatchParseResult[][];
      try {
        results = await this.pool.executeAll(tasks);
      } catch (err) {
        // Pool shutdown — likely due to cancellation
        if (this.canceled) return;
        const message = err instanceof Error ? err.message : String(err);
        this.errors.push({
          filePath: rootPath,
          message: `Batch execution failed: ${message}`,
          recoverable: false,
        });
        return;
      }

      // Process results immediately (streaming)
      this.updateProgress('building', this.processedFileCount, this.nodeCount);
      for (let i = 0; i < results.length; i++) {
        const batchResults = results[i]!;
        const batchFiles = group[i]!;
        await this.processBatchResults(rootPath, batchFiles, batchResults);
      }

      batchIndex += groupSize;
    }
  }

  private async parseBatch(
    files: DiscoveredFile[],
  ): Promise<BatchParseResult[]> {
    const results: BatchParseResult[] = [];

    for (const file of files) {
      if (this.canceled) break;

      try {
        if (!file.language) continue;

        // Simple AST analysis — extract basic symbols and references from
        // file content without depending on language providers (which live
        // in the analyzer package). Full parsing is done by the analyzer's
        // parallel phases which provide a custom parser callback.
        const parsed = this.parseFileContent(file);
        results.push(parsed);
      } catch (err) {
        // File-level errors are recorded but don't crash the batch
        this.errors.push({
          filePath: file.filePath,
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
        });
      }
    }

    return results;
  }

  /**
   * Basic file content parsing — extracts function/class definitions and
   * calls via regex patterns. This provides baseline symbol extraction when
   * no language provider is available. Full parsing is done by analyzer.
   */
  private parseFileContent(file: DiscoveredFile): BatchParseResult {
    const symbols: SymbolDefinition[] = [];
    const references: ReferenceSite[] = [];
    const lines = file.content.split('\n');
    let symbolIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();

      // Function definitions: function name, const name = function, name = function
      const fnMatch =
        line.match(
          /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\w+\s*=>|function)/,
        ) ??
        line.match(
          /(?:def|fn)\s+(\w+)/,
        );

      if (fnMatch) {
        const name = (fnMatch[1] || fnMatch[2] || fnMatch[3])!;
        const kind: NodeLabel = name[0] === name[0]!.toUpperCase() ? 'Class' : 'Function';
        symbols.push({
          name,
          kind,
          qualifiedName: `${file.filePath}:${name}`,
          startLine: i + 1,
          endLine: i + 1,
          isExported: line.startsWith('export'),
          properties: {},
        });
        symbolIdx++;
      }

      // Class definitions
      const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1]!,
          kind: 'Class',
          qualifiedName: `${file.filePath}:${classMatch[1]}`,
          startLine: i + 1,
          endLine: i + 1,
          isExported: line.startsWith('export'),
          properties: {},
        });
        symbolIdx++;
      }

      // Function/method calls
      const callMatch = line.match(/(\w+)\s*\(/g);
      if (callMatch) {
        for (const m of callMatch) {
          const called = m.replace(/[(\s]/g, '');
          if (
            called &&
            called !== 'if' &&
            called !== 'for' &&
            called !== 'while' &&
            called !== 'switch' &&
            !symbols.some((s) => s.name === called)
          ) {
            references.push({
              sourceFile: file.filePath,
              sourceLine: i + 1,
              sourceColumn: 0,
              targetName: called,
              referenceKind: 'call',
            });
          }
        }
      }

      // Imports
      const importMatch = line.match(
        /(?:import|require)\s*.*?['"](\S+?)['"]/,
      );
      if (importMatch) {
        references.push({
          sourceFile: file.filePath,
          sourceLine: i + 1,
          sourceColumn: 0,
          targetName: importMatch[1]!,
          referenceKind: 'import',
        });
      }
    }

    return {
      filePath: file.filePath,
      language: file.language ?? 'unknown',
      symbols,
      references,
    };
  }

  private async processBatchResults(
    rootPath: string,
    batchFiles: DiscoveredFile[],
    batchResults: BatchParseResult[],
  ): Promise<void> {
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i]!;
      const file = batchFiles[i]!;
      const filePath = file.filePath;

      try {
        // Get or create a File node for this source file
        const fileNode = this.createFileNode(rootPath, file);

        // Create symbol nodes and edges
        for (const symbol of result.symbols) {
          const node = this.createSymbolNode(fileNode, symbol, file);
          this.addToBuffer(node);
          this.nodeCount++;

          // Create DEFINES edge from File to symbol
          const edge = this.createEdge(
            fileNode.id,
            node.id,
            'DEFINES',
            `project:${rootPath}`,
          );
          this.addToBuffer(edge);
          this.edgeCount++;
        }

        // Create reference edges (simplified: reference to first matching symbol)
        for (const ref of result.references) {
          const targetNode = this.findNodeByName(ref.targetName);
          if (targetNode && targetNode.id !== fileNode.id) {
            const edge = this.createEdge(
              fileNode.id,
              targetNode.id,
              ref.referenceKind === 'import' ? 'IMPORTS' : 'CALLS',
              `project:${rootPath}`,
            );
            this.addToBuffer(edge);
            this.edgeCount++;
          }
        }

        this.processedFileCount++;
      } catch (err) {
        this.errors.push({
          filePath: filePath,
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
        });
      }
    }

    // Emit progress after batch
    this.updateProgress('building', this.processedFileCount, this.nodeCount);
  }

  // -----------------------------------------------------------------------
  // Private: Graph Construction
  // -----------------------------------------------------------------------

  private fileNodeMap = new Map<string, GraphNode>();
  private symbolNodeMap = new Map<string, GraphNode>();
  private nextNodeId = 1;
  private nextEdgeId = 1;

  private createFileNode(
    _rootPath: string,
    file: DiscoveredFile,
  ): GraphNode {
    const key = `file:${file.filePath}`;

    if (this.fileNodeMap.has(key)) {
      return this.fileNodeMap.get(key)!;
    }

    const node: GraphNode = {
      id: this.nextNodeId++,
      projectId: _rootPath,
      label: 'File',
      name: basename(file.filePath),
      qualifiedName: `file:${file.filePath}`,
      filePath: file.filePath,
      startLine: 1,
      endLine: file.content.split('\n').length,
      language: (file.language as SupportedLanguage) ?? null,
      properties: {
        name: basename(file.filePath),
        filePath: file.filePath,
        language: file.language ?? undefined,
      },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: file.hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.fileNodeMap.set(key, node);
    return node;
  }

  private createSymbolNode(
    fileNode: GraphNode,
    symbol: SymbolDefinition,
    file: DiscoveredFile,
  ): GraphNode {
    const key = `${file.filePath}:${symbol.qualifiedName}`;

    if (this.symbolNodeMap.has(key)) {
      return this.symbolNodeMap.get(key)!;
    }

    const properties: NodeProperties = {
      name: symbol.name,
      filePath: file.filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      language: file.language ?? undefined,
      isExported: symbol.isExported,
      signature: symbol.signature,
      returnType: symbol.returnType,
      docstring: symbol.docstring,
      ...symbol.properties,
    };

    const node: GraphNode = {
      id: this.nextNodeId++,
      projectId: fileNode.projectId,
      label: symbol.kind,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      filePath: file.filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      language: (file.language as SupportedLanguage) ?? null,
      properties,
      signature: symbol.signature ?? null,
      docstring: symbol.docstring ?? null,
      complexity: null,
      isExported: symbol.isExported,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.symbolNodeMap.set(key, node);
    return node;
  }

  private createEdge(
    sourceId: number,
    targetId: number,
    type: RelationshipType,
    projectId: string,
  ): GraphEdge {
    return {
      id: this.nextEdgeId++,
      projectId,
      sourceId,
      targetId,
      type,
      properties: {},
      weight: 1,
      createdAt: new Date().toISOString(),
    };
  }

  private findNodeByName(name: string): GraphNode | null {
    for (const [, node] of this.symbolNodeMap) {
      if (node.name === name) return node;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Private: Batch Store Writes
  // -----------------------------------------------------------------------

  private addToBuffer(item: GraphNode | GraphEdge): void {
    if ('sourceId' in item) {
      this.edgeBuffer.push(item as GraphEdge);
    } else {
      this.nodeBuffer.push(item as GraphNode);
    }

    // Auto-flush when buffers reach batch size
    if (this.nodeBuffer.length >= SQLITE_FLUSH_BATCH) {
      this.flushBuffersSync();
    }
    if (this.edgeBuffer.length >= SQLITE_FLUSH_BATCH) {
      this.flushBuffersSync();
    }
  }

  private flushBuffersSync(): void {
    if (this.nodeBuffer.length > 0) {
      // Use insertNodes for InMemoryGraphStore; SqliteGraphStore also
      // supports this method with transaction wrapping
      if ('insertNodes' in this.store) {
        this.store.insertNodes(this.nodeBuffer.splice(0));
      }
    }
    if (this.edgeBuffer.length > 0) {
      if ('insertEdges' in this.store) {
        this.store.insertEdges(this.edgeBuffer.splice(0));
      }
    }
  }

  private async flushBuffers(): Promise<void> {
    // Flush remaining nodes and edges
    if (this.nodeBuffer.length > 0) {
      if ('insertNodes' in this.store) {
        this.store.insertNodes(this.nodeBuffer.splice(0));
      }
    }
    if (this.edgeBuffer.length > 0) {
      if ('insertEdges' in this.store) {
        this.store.insertEdges(this.edgeBuffer.splice(0));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: Incremental Indexing
  // -----------------------------------------------------------------------

  private async computeFileDiff(
    rootPath: string,
    files: DiscoveredFile[],
  ): Promise<{ changed: DiscoveredFile[]; total: number }> {
    const storedHashes = await this.loadFileHashes(rootPath);
    const changed: DiscoveredFile[] = [];

    for (const file of files) {
      const storedHash = storedHashes.get(file.filePath);
      if (!storedHash || storedHash !== file.hash) {
        changed.push(file);
      }
    }

    return { changed, total: files.length };
  }

  private async loadFileHashes(
    rootPath: string,
  ): Promise<Map<string, string>> {
    const hashesDir = join(rootPath, HASHES_DIR);
    const hashesFile = join(hashesDir, HASHES_FILE);

    try {
      if (existsSync(hashesFile)) {
        const content = readFileSync(hashesFile, 'utf-8');
        const data = JSON.parse(content) as Record<string, string>;
        return new Map(Object.entries(data));
      }
    } catch {
      // File doesn't exist or is corrupt — treat as fresh index
    }

    return new Map();
  }

  private async saveFileHashes(
    rootPath: string,
    files: DiscoveredFile[],
  ): Promise<void> {
    // Load existing hashes and merge with current
    const existing = await this.loadFileHashes(rootPath);
    for (const file of files) {
      existing.set(file.filePath, file.hash);
    }

    const hashesDir = join(rootPath, HASHES_DIR);
    const hashesFile = join(hashesDir, HASHES_FILE);

    try {
      await mkdir(hashesDir, { recursive: true });
      const data: Record<string, string> = {};
      for (const [key, value] of existing) {
        data[key] = value;
      }
      await writeFile(hashesFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Non-fatal: hash persistence failure doesn't break indexing
    }
  }

  // -----------------------------------------------------------------------
  // Private: Progress Reporting
  // -----------------------------------------------------------------------

  private updateProgress(
    phase: IndexProgress['phase'],
    filesParsed: number,
    nodesCreated: number,
  ): void {
    const now = Date.now();
    const elapsedMs = now - this.startTime;

    // Throttle progress events
    if (now - this.lastProgressEmit < PROGRESS_THROTTLE_MS && phase !== 'complete') {
      return;
    }
    this.lastProgressEmit = now;

    const progress =
      this.totalFiles > 0
        ? Math.min(99, Math.round((filesParsed / this.totalFiles) * 100))
        : phase === 'complete'
          ? 100
          : 0;

    const filesRemaining = this.totalFiles - filesParsed;
    const estimatedRemainingMs =
      filesParsed > 0 && this.totalFiles > 0
        ? Math.round((elapsedMs / filesParsed) * filesRemaining)
        : 0;

    this.currentProgress = {
      phase,
      filesDiscovered: this.totalFiles,
      filesParsed,
      nodesCreated,
      edgesCreated: this.edgeCount,
      progress,
      elapsedMs,
      estimatedRemainingMs,
    };

    // Emit to subscribers
    for (const cb of this.progressCallbacks) {
      try {
        cb({ ...this.currentProgress });
      } catch {
        // Ignore callback errors
      }
    }
  }

  private finalizeProgress(
    phase: IndexProgress['phase'],
    progress: number,
  ): void {
    this.currentProgress = {
      phase,
      filesDiscovered: this.totalFiles,
      filesParsed: this.processedFileCount,
      nodesCreated: this.nodeCount,
      edgesCreated: this.edgeCount,
      progress,
      elapsedMs: Date.now() - this.startTime,
      estimatedRemainingMs: 0,
    };

    for (const cb of this.progressCallbacks) {
      try {
        cb({ ...this.currentProgress });
      } catch {
        // Ignore callback errors
      }
    }
  }

  private emitComplete(result: IndexerResult): void {
    for (const cb of this.completeCallbacks) {
      try {
        cb(result);
      } catch {
        // Ignore callback errors
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: Helpers
  // -----------------------------------------------------------------------

  private reset(): void {
    this.canceled = false;
    this.startTime = 0;
    this.lastProgressEmit = 0;
    this.totalFiles = 0;
    this.processedFileCount = 0;
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.errors = [];
    this.nodeBuffer = [];
    this.edgeBuffer = [];
    this.fileNodeMap.clear();
    this.symbolNodeMap.clear();
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
  }

  private buildResult(rootPath: string, incremental: boolean): IndexerResult {
    const errors = [...this.errors]; // Snapshot

    return {
      rootPath,
      filesDiscovered: this.totalFiles,
      filesParsed: this.processedFileCount,
      nodesCreated: this.nodeCount,
      edgesCreated: this.edgeCount,
      durationMs: Date.now() - this.startTime,
      errors,
      incremental,
    };
  }
}

// ---------------------------------------------------------------------------
// Utility: file hash
// ---------------------------------------------------------------------------

function computeFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Utility: simple glob matching
// ---------------------------------------------------------------------------

function minimatchCheck(str: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');

  // If pattern doesn't contain path separators, match basename too
  if (!pattern.includes('/')) {
    return new RegExp(`^${regexStr}$`).test(str) ||
      new RegExp(`^${regexStr}$`).test(basename(str));
  }

  return new RegExp(`^${regexStr}$`).test(str);
}
