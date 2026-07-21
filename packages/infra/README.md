# @code-analyzer/infra

> Infrastructure layer — persistent storage, Git integration, filesystem discovery, worker pool, and parse caching for the Code Analyzer platform.

[![npm](https://img.shields.io/npm/v/@code-analyzer/infra?color=blue)](https://www.npmjs.com/package/@code-analyzer/infra)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green)](https://nodejs.org/)

## Overview

`@code-analyzer/infra` provides the persistence, I/O, and concurrency primitives that power the Code Analyzer pipeline. It includes an in-memory graph store with adjacency indices and transaction support, a Git operations wrapper for diffs and staleness checks, a filesystem discovery engine with gitignore-aware scanning, a debounced file watcher, a concurrent worker pool with retry logic, a circuit breaker for resilient external calls, an index supervisor with crash recovery, and an LRU parse cache with SHA-256 content hashing. This is Layer 2 of the architecture, depending only on `@code-analyzer/shared`.

### Architecture

```
@code-analyzer/infra (Layer 2 - Infrastructure)
│
├── storage/
│   ├── sqlite-store.ts    — SqliteStore (in-memory graph CRUD, FTS, BFS, transactions)
│   └── types.ts           — Query, FTS, BFS, integrity, and file event types
│
├── git/
│   └── git-operations.ts  — createGitOperations (diff, clone, push, branches, staleness)
│
├── filesystem/
│   ├── discoverer.ts      — createFileDiscoverer (recursive scan with language detection)
│   └── watcher.ts         — createFileWatcher (debounced fs.watch with events)
│
├── workers/
│   ├── pool.ts            — createWorkerPool (concurrent task executor with retries)
│   ├── circuit-breaker.ts — CircuitBreaker (closed → open → half-open state machine)
│   └── supervisor.ts      — IndexSupervisor (timeout, crash recovery, quarantine)
│
└── cache/
    └── parse-cache.ts     — createParseCache (LRU cache with SHA-256 hashing)
```

## Installation

```bash
npm install @code-analyzer/infra
```

Requires Node.js >= 22.

## Key Exports

| Category | Exports | Description |
|----------|---------|-------------|
| **Storage** | `SqliteStore`, `NodeQuery`, `EdgeQuery`, `FtsSearchResult`, `BfsResult`, `IntegrityReport` | In-memory graph store with full CRUD, FTS, BFS, and integrity checks |
| **Git** | `createGitOperations`, `GitOperations` | Git diff, changed files, merge-base, staleness, branch listing |
| **Filesystem** | `createFileDiscoverer`, `FileDiscoverer`, `createFileWatcher`, `FileWatcher` | File discovery with glob matching and debounced watching |
| **Workers** | `createWorkerPool`, `WorkerPool`, `CircuitBreaker`, `IndexSupervisor` | Concurrent execution, circuit breaking, index supervision |
| **Cache** | `createParseCache`, `ParseCache`, `computeContentHash` | LRU cache keyed by SHA-256 content hash |

## Usage

### Graph Store

```typescript
import { SqliteStore } from '@code-analyzer/infra';

const store = new SqliteStore();

// Insert nodes
const nodeId = store.insertNode({
  id: 0, // auto-assigned
  projectId: 'proj-1',
  label: 'Class',
  name: 'UserService',
  qualifiedName: 'src/services/UserService.ts#UserService',
  filePath: 'src/services/UserService.ts',
  startLine: 10,
  endLine: 45,
  language: 'typescript',
  properties: { isExported: true },
  signature: null,
  docstring: 'Handles user-related operations.',
  complexity: 5,
  isExported: true,
  fingerprint: 'sha256:abc123',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// Batch insert
const ids = store.insertNodes([
  { /* node 1 */ } as any,
  { /* node 2 */ } as any,
]);

// Query with filters
const results = store.queryNodes({
  projectId: 'proj-1',
  label: 'Function',
  namePattern: 'get*',
  sortBy: 'complexity',
  sortDirection: 'desc',
  limit: 10,
});
// PaginatedResult<GraphNode> with items, total, offset, limit, hasMore

// Insert edges
const edgeId = store.insertEdge({
  id: 0, projectId: 'proj-1', sourceId: 1, targetId: 2,
  type: 'CALLS', properties: { lineNumber: 42 },
  weight: 1, createdAt: new Date().toISOString(),
});

// Get edges for a node
const outgoingEdges = store.getEdgesForNode(1, undefined, 'out');
const incomingEdges = store.getEdgesForNode(1, 'CALLS', 'in');

// Full-text search
const ftsResults = store.searchFts('user auth', {
  labels: ['Class', 'Function'],
  limit: 5,
});
// FtsSearchResult[] with node, rank, matchedColumn, snippet

// BFS traversal
const bfsResults = store.bfs(1 /* source node ID */, 3 /* max depth */, ['CALLS', 'IMPLEMENTS']);
// BfsResult with nodes, edges, pathLengths, visitedCount, maxDepthReached

// Transactions (all-or-nothing)
try {
  store.transaction(() => {
    store.insertNode({ /* ... */ } as any);
    store.insertNode({ /* ... */ } as any);
    store.insertEdge({ /* ... */ } as any);
    // If any throws, all are rolled back
  });
} catch (err) {
  // All changes reverted
}

// Integrity check
const report = store.validateIntegrity('proj-1');
console.log(report.orphanEdges, report.duplicateQnames, report.issues);

store.close(); // Clean up
```

### Git Operations

```typescript
import { createGitOperations } from '@code-analyzer/infra';

const git = createGitOperations('/path/to/repo');

// Diff between branches
const diffs = await git.getDiff('main', 'feature/branch');
// GitDiff[] with filePath, ranges, changeType

// Workspace diff
const workspaceDiff = await git.getWorkspaceDiff();

// Changed files
const files = await git.getChangedFiles('main', 'HEAD');

// Merge base
const base = await git.getMergeBase('main', 'feature/branch');

// Staleness check
const stale = await git.getStaleness('abc123def');
// { nodeId, nodeQname, isStale, reason? }

// File content at ref
const content = await git.getFileContent('HEAD', 'src/app.ts');

// Branch management
const branches = await git.listBranches();
const current = await git.getCurrentBranch();
```

### File Discovery

```typescript
import { createFileDiscoverer } from '@code-analyzer/infra';

const discoverer = createFileDiscoverer();

const files = await discoverer.discover('/path/to/project', {
  excludePatterns: ['node_modules/**', 'dist/**', '*.test.ts'],
  includePatterns: ['src/**'],
  maxFileSize: 5 * 1024 * 1024, // 5MB
  respectGitignore: true,
});
// DiscoveredFile[] with filePath, language, content, hash, size

// Detect language
const lang = discoverer.detectLanguage('src/utils.ts');
// 'typescript'

// Check gitignore match
const ignored = discoverer.matchGitignore('/project', 'node_modules/pkg/index.js');
// true
```

### File Watcher

```typescript
import { createFileWatcher } from '@code-analyzer/infra';

const watcher = createFileWatcher();

watcher.watch('/path/to/project', (events) => {
  for (const event of events) {
    console.log(`${event.type}: ${event.filePath}`);
    // 'modify: src/app.ts', 'add: src/new.ts', 'delete: src/old.ts'
  }
});
// Events are debounced (100ms) and deduplicated by file path

watcher.unwatch(); // Stop watching
```

### Worker Pool

```typescript
import { createWorkerPool } from '@code-analyzer/infra';

import type { WorkerTask } from '@code-analyzer/infra';

const pool = createWorkerPool(4 /* concurrency */);

// Single task
const result = await pool.execute({
  id: 'parse-file-1',
  execute: async () => parseFile('src/app.ts'),
  timeout: 30000,  // 30s timeout
  retries: 2,      // Retry up to 2 times
});

// Batch execution (respects concurrency limit)
const tasks: WorkerTask<string>[] = [
  { id: 'task-1', execute: async () => 'result-1' },
  { id: 'task-2', execute: async () => 'result-2' },
  { id: 'task-3', execute: async () => 'result-3' },
];
const results = await pool.executeAll(tasks);
// ['result-1', 'result-2', 'result-3']

console.log(pool.activeCount, pool.queuedCount);

pool.shutdown();
```

### Circuit Breaker

```typescript
import { CircuitBreaker } from '@code-analyzer/infra';

const breaker = new CircuitBreaker({
  failureThreshold: 5,    // Open after 5 failures
  successThreshold: 3,    // Close after 3 consecutive successes
  resetTimeout: 30000,    // Wait 30s before trying half-open
});

// Stable operation — circuit stays closed
const data = await breaker.execute(async () => {
  const response = await fetch('https://api.example.com/data');
  if (!response.ok) throw new Error('API failed');
  return response.json();
});

console.log(breaker.state); // 'closed', 'open', or 'half-open'
breaker.reset(); // Force back to closed
```

### Index Supervisor

```typescript
import { IndexSupervisor } from '@code-analyzer/infra';

const supervisor = new IndexSupervisor({
  timeout: 60000,       // 60s max per task
  maxRetries: 3,        // Retry up to 3 times
  memoryLimit: 512 * 1024 * 1024, // 512MB
});

const result = await supervisor.supervise(
  async () => {
    // Indexing work
  },
  {
    progressCallback: (file) => console.log(`Processing: ${file}`),
  },
);
// SupervisorResult:
// { status, filesProcessed, filesFailed, quarantinedFiles, crashReports, duration, peakMemory }

// Access quarantined files
const quarantined = supervisor.getQuarantinedFiles();
supervisor.clearQuarantine('src/problematic.ts');
```

### Parse Cache

```typescript
import { createParseCache, computeContentHash } from '@code-analyzer/infra';

const cache = createParseCache(1000 /* max entries */);

// Compute a SHA-256 hash of file content
const hash = computeContentHash('function hello() { return "world"; }');
// 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

// Cached lookup
const cached = cache.get(hash); // ParsedFile | null

// Store result
cache.set(hash, parsedFile);

// Check existence
if (cache.has(hash)) {
  // Cache hit — skip re-parsing
}

// Invalidate by file path
cache.invalidate('src/app.ts');

console.log(cache.size); // Current entry count
cache.clear(); // Empty the cache
```

## Configuration Reference

### CircuitBreakerOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `failureThreshold` | `number` | `5` | Consecutive failures before opening |
| `successThreshold` | `number` | `3` | Consecutive successes to re-close |
| `resetTimeout` | `number` | `30000` | ms before transitioning to half-open |

### SupervisorConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | `number` | (required) | Max ms per indexing task |
| `maxRetries` | `number` | (required) | Max crash retry attempts |
| `memoryLimit` | `number` | `536870912` | Memory limit in bytes (512MB) |

### DiscoverOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `excludePatterns` | `string[]` | `DEFAULT_EXCLUDE_PATTERNS` | Glob patterns to exclude |
| `includePatterns` | `string[]` | `[]` | Glob patterns to include (empty = all) |
| `maxFileSize` | `number` | `10485760` | Max file size in bytes (10MB) |
| `respectGitignore` | `boolean` | `true` | Whether to apply `.gitignore` rules |

### WorkerTask

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `string` | (required) | Unique task identifier |
| `execute` | `() => Promise<T>` | (required) | Async task function |
| `timeout` | `number` | `30000` | Max execution time in ms |
| `retries` | `number` | `0` | Number of retries on failure |

## Package Dependencies

```
@code-analyzer/shared (Layer 0)
  │
  └── @code-analyzer/infra (Layer 2)
        │
        ├── @code-analyzer/analyzer (Layer 3)
        ├── @code-analyzer/cli      (Layer 4)
        └── @code-analyzer/server   (Layer 4)
```

**Depends on:** `@code-analyzer/shared` (zero other external dependencies).

## License

MIT

## Contributing

See the [CONTRIBUTING.md](../../CONTRIBUTING.md) in the repository root for guidelines on contributing to this monorepo.
