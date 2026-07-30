// @code-analyzer/infra — Infrastructure Layer (Layer 2)
// Storage, Git, Filesystem, Workers, Cache, and Supervisor

// Storage
export { InMemoryGraphStore } from './storage/in-memory-graph-store.js';
export { SqliteGraphStore, deleteDatabase } from './storage/sqlite-graph-store.js';
export { NodeIndex } from './storage/graph-index.js';
export type {
  NodeQuery,
  EdgeQuery,
  FtsSearchResult,
  BfsResult,
  IntegrityReport,
  IntegrityIssue,
  FileChangeEvent,
} from './storage/types.js';

// Git Operations
export { createGitOperations } from './git/git-operations.js';
export type { GitOperations } from './git/git-operations.js';

// Filesystem
export { createFileDiscoverer } from './filesystem/discoverer.js';
export type { FileDiscoverer, DiscoverOptions } from './filesystem/discoverer.js';
export { createFileWatcher } from './filesystem/watcher.js';
export type { FileWatcher } from './filesystem/watcher.js';

// Worker Pool & Circuit Breaker
export { createWorkerPool } from './workers/pool.js';
export type { WorkerPool, WorkerTask } from './workers/pool.js';
export { CircuitBreaker } from './workers/circuit-breaker.js';
export type { CircuitState, CircuitBreakerOptions } from './workers/circuit-breaker.js';

// Index Supervisor
export { IndexSupervisor } from './workers/supervisor.js';
export type { SupervisorConfig, SupervisorOptions } from './workers/supervisor.js';

// Parse Cache
export { createParseCache, computeContentHash } from './cache/parse-cache.js';
export type { ParseCache } from './cache/parse-cache.js';

// Content Cache
export { ContentCache, computeSha256 } from './cache/content-cache.js';
export type { ContentCacheEntry, ContentCacheStats } from './cache/content-cache.js';

// Incremental Indexer
export { IncrementalIndexer } from './cache/incremental-indexer.js';
export type {
  ChangeDetectionResult,
  ChangeDetectionStats,
  ChangeDetectionOptions,
} from './cache/incremental-indexer.js';

// Parallel Indexer
export { ParallelIndexer } from './workers/parallel-indexer.js';
export type {
  ParallelIndexerConfig,
  IndexProgress,
  IndexerOptions,
  IndexerResult,
  IndexerError,
  BatchParseResult,
} from './workers/parallel-indexer.js';

// Project Detection & Auto-Indexing
export { detectProject, detectToolVersion } from './project/project-detector.js';
export type { ProjectType, ProjectInfo } from './project/project-detector.js';
export { AutoIndexer } from './project/auto-indexer.js';
export type { AutoIndexerOptions, IndexResult, IndexingStatus } from './project/auto-indexer.js';
export { AutoWatcher } from './project/auto-watcher.js';
export type { AutoWatcherOptions, ReindexEvent } from './project/auto-watcher.js';

// Performance Profiling
export { PerformanceProfiler } from './performance/profiler.js';
export type { BenchmarkConfig, BenchmarkResult, QueryLatencyResult } from './performance/profiler.js';

// Performance Utilities
export { AsyncMemoizer } from './performance/memoizer.js';
export type { MemoizerOptions, MemoizerStats } from './performance/memoizer.js';
export { BatchProcessor } from './performance/batch-processor.js';
export type { BatchProcessorOptions, BatchProgress, BatchResult } from './performance/batch-processor.js';
