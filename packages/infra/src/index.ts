// @code-analyzer/infra — Infrastructure Layer (Layer 2)
// Storage, Git, Filesystem, Workers, Cache, and Supervisor

// Storage
export { InMemoryGraphStore } from './storage/in-memory-graph-store.js';
export { SqliteGraphStore, deleteDatabase } from './storage/sqlite-graph-store.js';
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
