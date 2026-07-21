# @code-analyzer/intelligence

> The Intelligence Layer — semantic search, code review, standards checking, impact analysis, similarity detection, and multi-format reporting on top of the knowledge graph.

[![npm](https://img.shields.io/npm/v/@code-analyzer/intelligence?color=blue)](https://www.npmjs.com/package/@code-analyzer/intelligence)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

## Overview

`@code-analyzer/intelligence` is Layer 4 of the code-analyzer stack. It consumes the knowledge graph produced by `@code-analyzer/analyzer` and provides seven intelligence capabilities:

1. **Hybrid Search** — BM25 (inverted index) + vector similarity with Reciprocal Rank Fusion (k=60).
2. **Code Review** — 4-phase pipeline (Plan -> Analyze -> Filter -> Relocate) with heuristic rules.
3. **PR Review** — Enriched context, standards checking, and impact analysis for pull requests.
4. **Standards Engine** — 10 built-in templates with 5 check types across multiple languages.
5. **Impact Analysis** — BFS traversal from changed symbols to tests, routes, and processes.
6. **Similarity Detection** — MinHash (128 hashes) + LSH banded indexing for near-clone detection.
7. **Reporting** — Multi-format reports with trend analysis and a recommendation engine.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    KnowledgeGraph                        │
│            (from @code-analyzer/analyzer)                │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌───────────────┐ ┌────────────┐ ┌───────────────────┐
│ HybridSearch   │ │ Embedding   │ │ MinHash + LSH     │
│ BM25 + Vector  │ │ Engine      │ │ Similarity        │
│ RRF (k=60)     │ │ Mock / Real │ │ 128-hash bands    │
└───────┬───────┘ └─────┬──────┘ └─────────┬─────────┘
        │               │                  │
        └───────┬───────┘                  │
                ▼                          ▼
┌───────────────────────────────┐ ┌───────────────────┐
│ Code Review Pipeline           │ │ Similarity Edges  │
│ Plan → Analyze → Filter        │ │ (SIMILAR_TO)      │
│ → Relocate                     │ └───────────────────┘
└───────────────┬───────────────┘
                │
┌───────────────┼───────────────┐
│               ▼               │
│ ┌──────────────────────────┐ │
│ │ PR Review Engine          │ │ ┌───────────────────┐
│ │ + StandardsEngine         │ │ │ ImpactAnalyzer    │
│ │ + ChangeDetector          │─┼─│ IoUOverlapDetector│
│ │ + IoUOverlapDetector      │ │ │ ChangeDetector    │
│ └────────────┬─────────────┘ │ └───────────────────┘
│              │               │
│              ▼               │
│ ┌──────────────────────────┐ │
│ │ MemoryCompressor          │ │
│ │ 3-zone (frozen/cmpr/actv)│ │
│ └──────────────────────────┘ │
│              │               │
│              ▼               │
│ ┌──────────────────────────┐ │
│ │ ReportGenerator           │ │
│ │ RecommendationEngine      │ │
│ │ TrendAnalyzer             │ │
│ │ {Markdown,Json,Html}Fmt   │ │
│ └──────────────────────────┘ │
└───────────────────────────────┘
```

## Installation

```bash
npm install @code-analyzer/intelligence
```

Requires Node.js >= 18 and `@code-analyzer/analyzer` installed.

## Quick Start

```typescript
import { HybridSearchEngine, EmbeddingEngine } from '@code-analyzer/intelligence';
import { SqliteStore } from '@code-analyzer/infra';

// Initialize storage and embeddings
const store = new SqliteStore(':memory:');
const embedder = new EmbeddingEngine({ dimensions: 768, normalize: true });

// Set up hybrid search
const search = new HybridSearchEngine(store);
search.registerEmbeddings(
  (nodeId) => embedder.getEmbedding(nodeId),
  async (content) => embedder.embedCode(content),
);

// Run a hybrid search
const results = await search.search({
  query: 'authentication service',
  limit: 10,
  labels: ['Function', 'Class'],
});

for (const r of results) {
  console.log(`${r.node.name}: BM25=${r.bm25Score}, Vector=${r.vectorScore}`);
}
```

```typescript
import { CodeReviewEngine, PRReviewEngine, MemoryCompressor } from '@code-analyzer/intelligence';

// Review a pull request
const reviewEngine = new CodeReviewEngine(store);
const prEngine = new PRReviewEngine(reviewEngine, store);

const result = await prEngine.reviewPR(
  'my-project',
  pullRequest,
  gitDiffs,
);

console.log(`Risk: ${result.summary.riskLevel}`);
console.log(`Merge: ${result.summary.mergeRecommendation}`);
console.log(`Comments: ${result.summary.totalComments}`);

// Use memory compression for long review chains
const compressor = new MemoryCompressor({ maxTokens: 128000 });
const { needed, urgent } = compressor.needsCompression(
  compressor.countMessageTokens(messages),
  128000,
);
if (needed) {
  const compressed = compressor.compress(messages, tokenCount);
}
```

## API Documentation

### HybridSearchEngine

Combines BM25 text retrieval with vector semantic search using Reciprocal Rank Fusion.

```typescript
import { HybridSearchEngine, tokenize, cosineSimilarity } from '@code-analyzer/intelligence';

const engine = new HybridSearchEngine(store);

// Build the inverted index
engine.initialize();

// Register embedding lookup functions for vector search
engine.registerEmbeddings(
  (nodeId) => getStoredEmbedding(nodeId),
  async (text) => computeEmbedding(text),
);

// Hybrid search (BM25 + vector)
const results = await engine.search({ query: 'user auth', limit: 20 });

// Results include per-source scores
for (const r of results) {
  console.log(r.node.qualifiedName, r.bm25Score, r.vectorScore, r.combinedScore);
}

// BM25-only text search
const bm25Only = engine.bm25Search('auth middleware');

// Vector-only semantic search
const vectorOnly = await engine.vectorSearch('auth middleware', 10);

// Index maintenance
engine.refreshNode(updatedNode);
engine.removeNode(deletedNodeId);
engine.rebuildIndex();
```

**Reciprocal Rank Fusion:** `RRF_score = 1/(k + rank + 1)` with default k=60.

### EmbeddingEngine

Generates vector embeddings with mock (SHA-256 deterministic) or real (`@agentix-e/embed-code-ts`) backends.

```typescript
import { EmbeddingEngine } from '@code-analyzer/intelligence';

// Default: 768-dim mock backend with normalized vectors
const engine = new EmbeddingEngine({ dimensions: 768, normalize: true });

// Force initialization (auto-detects real backend if available)
await engine.initialize();

// Embed a code snippet
const vec = await engine.embedCode('function hello() { return "world"; }');

// Batch embedding
const vecs = await engine.embedBatch([
  'function a() {}',
  'class Foo {}',
]);

// Store/retrieve per-node embeddings
engine.storeEmbedding(nodeId, vec);
const stored = engine.getEmbedding(nodeId);

// Incremental update — only embed new nodes
await engine.incrementalUpdate(nodeIds, (id) => getNodeContent(id));

// Cosine similarity
const sim = engine.cosineSimilarity(vec, otherVec);

// Dimensions and readiness
console.log(engine.dimensions); // 768
console.log(engine.isReady);    // true

engine.dispose();
```

### CodeReviewEngine

4-phase heuristic review pipeline: Plan -> Analyze -> Filter -> Relocate.

```typescript
import { CodeReviewEngine } from '@code-analyzer/intelligence';

const engine = new CodeReviewEngine(store, {
  maxTokens: 8000,
  maxToolCalls: 10,
  planLineThreshold: 200,
  timeout: 30000,
  concurrency: 4,
});

// Review a set of git diffs with full session tracking
const session = await engine.reviewDiff('my-project', gitDiffs);

// Review a single file directly
const comments = await engine.reviewFile('project-id', '/src/app.ts', sourceCode);

// Resume an interrupted session
const resumed = await engine.resumeSession(sessionId);
```

**Pipeline phases:**

| Phase | Description |
|-------|-------------|
| **Plan** | File type analysis, size assessment, risk identification, checklist generation |
| **Analyze** | Heuristic rules: long functions, deep nesting, missing error handling, circular deps |
| **Filter** | Remove empty context, invalid line ranges, style-on-comment noise |
| **Relocate** | Adjust line numbers for diff offsets (handles added/removed lines) |

### PRReviewEngine

Full PR review combining diff analysis, standards checking, and impact assessment.

```typescript
import { PRReviewEngine } from '@code-analyzer/intelligence';

const prEngine = new PRReviewEngine(reviewEngine, store);

const result = await prEngine.reviewPR(projectId, pullRequest, gitDiffs);

// Result structure
console.log(result.summary.totalComments);       // number
console.log(result.summary.byCategory);           // Record<ReviewCategory, number>
console.log(result.summary.bySeverity);           // Record<Severity, number>
console.log(result.summary.riskLevel);            // 'critical' | 'high' | 'medium' | 'low'
console.log(result.summary.mergeRecommendation);  // 'approve' | 'approve-with-comments' | 'request-changes' | 'block'
console.log(result.comments.length);
console.log(result.standardsResults.length);
```

### StandardsEngine

10 built-in standards templates with 5 check types across 8 languages.

```typescript
import { StandardsEngine, getTemplate, listTemplates } from '@code-analyzer/intelligence';

const engine = new StandardsEngine();

// List all available standards
const templates = listTemplates();
// [{ id: 'typescript-coding', name: 'TypeScript Coding Standards', ... }, ...]

// Get a specific standard
const standard = getTemplate('security-baseline');
// Or: engine.loadStandard('security-baseline');

// Check a source file against a standard
const results = engine.checkSource(source, '/src/app.ts', standard);

// Check multiple files
const checkResult = engine.checkFiles(files, 'typescript-coding');

// Get auto-fix suggestions
const autoFixes = engine.getAutoFixes(violations);

// Register a custom standard
const customStandard = { id: 'my-rules', name: '...', ... };
engine.registerStandard(customStandard);
```

**10 Built-in Templates:**

| ID | Name | Category |
|----|------|----------|
| `typescript-coding` | TypeScript Coding Standards | `code-style` |
| `python-pep8` | Python PEP8 Standards | `code-style` |
| `go-idiomatic` | Go Idiomatic Standards | `code-style` |
| `security-baseline` | Security Baseline | `security` |
| `api-design` | API Design Standards | `api-design` |
| `testing-standards` | Testing Standards | `testing` |
| `error-handling` | Error Handling Standards | `error-handling` |
| `documentation` | Documentation Standards | `documentation` |
| `architecture-layered` | Architecture Layered Standards | `architecture` |
| `dependency-management` | Dependency Management Standards | `dependency` |

**5 Check Types:**

| Type | Description |
|------|-------------|
| `regex` | Pattern matching with `forbidden`/required mode |
| `metric` | Threshold checks: `function-lines`, `nesting-depth` |
| `ast-pattern` | Simplified AST pattern matching (deferred) |
| `graph-query` | Knowledge graph structure queries (deferred) |
| `llm-check` | LLM-powered semantic checks (deferred) |

### MemoryCompressor

Three-zone message compression for context window management.

```typescript
import { MemoryCompressor, countTokens } from '@code-analyzer/intelligence';

const compressor = new MemoryCompressor({
  softThreshold: 0.60,    // Begin compression at 60% usage
  hardThreshold: 0.80,    // Urgent at 80%
  frozenZoneSize: 2,      // First 2 messages always preserved
  activeTurns: 4,         // Last 4 turns kept verbatim
  maxTokens: 128000,
});

// Check if compression is needed
const { needed, urgent } = compressor.needsCompression(currentTokens, maxTokens);

// Compress message array into three zones:
// [frozen] [summary] [activeTurns]
if (needed) {
  const compressed = compressor.compress(messages, currentTokens);
}

// Count tokens across messages
const totalTokens = compressor.countMessageTokens(messages);
const singleTokens = countTokens('some text'); // ~4 chars/token
```

### ImpactAnalyzer

BFS-based impact analysis from changed symbols through the dependency graph.

```typescript
import { ImpactAnalyzer, IoUOverlapDetector, ChangeDetector } from '@code-analyzer/intelligence';

// Detect changes from git diffs
const detector = new ChangeDetector(store);
const changes = await detector.detectChanges(projectId, gitDiffs);

// Analyze full impact
const analyzer = new ImpactAnalyzer(store);
const impact = await analyzer.analyze(projectId, changes.changedSymbols, {
  maxDepth: 3,
  includeTests: true,
  includeRoutes: true,
  includeProcesses: true,
});

console.log(impact.impactTree.length);     // Number of affected nodes
console.log(impact.riskLevel);             // Overall risk level
console.log(impact.estimatedEffort);       // 'low' | 'medium' | 'high'

// Compute risk score (0-100)
const score = analyzer.computeRiskScore(impact);

// IoU deduplication for PR comments
const iou = new IoUOverlapDetector();
const overlap = iou.detectOverlap(newComment, existingComments, 0.5);
const filtered = iou.filterOverlapping(newComments, existingComments);
```

### MinHash + LSH Similarity

128-hash MinHash fingerprints with banded LSH for near-clone detection.

```typescript
import { MinHashSimilarity, LSHSearcher } from '@code-analyzer/intelligence';

// MinHash fingerprinting
const minhash = new MinHashSimilarity(128);
const fp = minhash.computeFingerprint(['token1', 'token2']);

// Estimate Jaccard similarity
const sim = minhash.estimateSimilarity(fp1, fp2);
if (minhash.isSimilar(fp1, fp2, 0.8)) {
  // ≥80% similar
}

// LSH indexing for fast candidate retrieval
const lsh = new LSHSearcher(16); // 16 bands
lsh.insert(nodeId, fingerprint);
const candidates = lsh.query(queryFingerprint);

// Build all similarity edges across nodes
const edges = lsh.buildSimilarityEdges(
  store, nodeIds, getFingerprint, 0.8,
);
for (const edge of edges) {
  console.log(`Node ${edge.sourceId} similar to ${edge.targetId}: ${edge.similarity}`);
}
```

### Reporting

Multi-format report generation with recommendations and trend analysis.

```typescript
import {
  ReportGenerator,
  RecommendationEngine,
  TrendAnalyzer,
  MarkdownFormatter,
  JsonFormatter,
  HtmlFormatter,
} from '@code-analyzer/intelligence';

const generator = new ReportGenerator();

// PR review report
const prReport = generator.generatePRReport({
  projectId: 'my-project',
  prNumber: 42,
  baseRef: 'main',
  headRef: 'feature/auth',
  reviewComments: comments,
  standardsResults: standardsCheckResults,
  metrics: { linesChanged: 150, filesChanged: 8 },
  repository: 'my-org/my-repo',
  branch: 'main',
  commitSha: 'abc123',
  author: 'dev',
});

// Codebase audit report
const auditReport = generator.generateAuditReport({
  projectId: 'my-project',
  findings,
  metrics: {},
  repository: 'my-org/my-repo',
});

// Standards compliance report
const standardsReport = generator.generateStandardsReport({
  projectId: 'my-project',
  standardsResults,
  repository: 'my-org/my-repo',
});

// Format reports
const md = new MarkdownFormatter().format(prReport);
const json = new JsonFormatter().format(prReport);
const html = new HtmlFormatter().format(prReport);

// Recommendations
const recEngine = new RecommendationEngine();
const recommendations = recEngine.generateRecommendations(findings, {
  maxRecommendations: 20,
});

// Trend analysis across reports
const trends = new TrendAnalyzer();
const scoreTrend = trends.trackMetric(history, 'summary.overallScore');
// { direction: 'improving', changeRate: 12.5, values: [...], timestamps: [...] }

const comparison = trends.compareReports(reportA, reportB);
// { addedFindings, removedFindings, metricDeltas, overallChange }
```

**Formatters:**

| Formatter | MIME Type | Extension | Output |
|-----------|-----------|-----------|--------|
| `MarkdownFormatter` | `text/markdown` | `.md` | Rich markdown with tables, code blocks, severity icons |
| `JsonFormatter` | `application/json` | `.json` | Full structured JSON dump |
| `HtmlFormatter` | `text/html` | `.html` | Styled HTML page with CSS |

### SessionStore

JSONL-based review session persistence with SHA-256 content fingerprinting.

```typescript
import { SessionStore, generateSessionId, computeFileFingerprint } from '@code-analyzer/intelligence';

const store = new SessionStore('/path/to/sessions');

// Start a review session
const session = store.startSession('my-project', {
  repository: 'my-org/my-repo',
  branch: 'main',
  mode: 'diff',
});

// Record completed file reviews
store.recordItemDone(session.id, {
  filePath: '/src/app.ts',
  fingerprint: computeFileFingerprint('diff', '/src/app.ts', content),
  comments: reviewComments,
  duration: 1200,
});

// List all sessions for a project
const sessions = store.listSessions('my-project');

// Resume a session
const resumeState = store.buildResumeState(session.id);
// { completedFiles: Set<string>, reusedComments: ReviewComment[] }

// Cleanup
store.deleteSession(session.id);
store.completeSession(session.id);
```

## Configuration Reference

### CodeReviewEngine

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxTokens` | `number` | `8000` | Maximum token budget per review |
| `maxToolCalls` | `number` | `10` | Max external tool invocations |
| `planLineThreshold` | `number` | `200` | Lines above which a file is "large" |
| `timeout` | `number` | `30000` | Per-phase timeout in ms |
| `concurrency` | `number` | `4` | Concurrent file reviews |

### MemoryCompressor

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `softThreshold` | `number` | `0.60` | Ratio to begin compression |
| `hardThreshold` | `number` | `0.80` | Ratio for urgent compression |
| `frozenZoneSize` | `number` | `2` | Messages always preserved at start |
| `activeTurns` | `number` | `4` | Complete turns kept verbatim |
| `maxTokens` | `number` | `128000` | Model context window size |

### EmbeddingEngine

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dimensions` | `number` | `768` | Vector dimensions |
| `normalize` | `boolean` | `true` | Unit-normalize output vectors |

### ImpactAnalyzer

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDepth` | `number` | `3` | BFS traversal depth |
| `includeTests` | `boolean` | `true` | Find affected tests |
| `includeRoutes` | `boolean` | `true` | Find affected API routes |
| `includeProcesses` | `boolean` | `true` | Find affected processes |

### IoUOverlapDetector

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | `number` | `0.5` | IoU threshold for overlap |

## Package Dependency Tree

```
@code-analyzer/intelligence
├── @code-analyzer/shared (workspace:*)
│   └── Shared types: SearchOptions, GraphNode, ReviewComment,
│       GitDiff, PullRequest, ProjectStandard, etc.
├── @code-analyzer/core (workspace:*)
│   └── Core configuration and project model
├── @code-analyzer/infra (workspace:*)
│   └── SqliteStore, infrastructure utilities
└── @code-analyzer/analyzer (workspace:*)
    └── Pipeline orchestrator, language providers, graph builder
```

## License

MIT — see the [root LICENSE](../../LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

## Related Documentation

- [Project README](../../README.md) — High-level architecture and monorepo structure
- [docs/](../../docs/) — Design documents, API reference, and guides
- `@code-analyzer/analyzer` — Analysis engine (language parsing, pipeline, graph)
- `@code-analyzer/shared` — Shared types and constants
- `@code-analyzer/infra` — Infrastructure (SQLite store, worker pool)
