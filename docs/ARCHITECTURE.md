# Architecture

> `code-analyzer` — Architecture documentation for a layered code intelligence platform that aims to transform source code into a structured knowledge graph with 33 entity types and 39 relationship types.

> **Implementation Status**: This document describes the target architecture. The current alpha (v0.1.0) implements Layers 1 (Foundation) and 2 (Infrastructure) with the in-memory store. Layer 3 (Analysis Engine) has a functional pipeline orchestrator but all 18 phases return placeholder data. Layer 4 (Intelligence) has the BM25 search component and heuristic-based review engine functional on in-memory data; vector search, embeddings, impact analysis, and standards engine are scaffolds. Layer 5 (Service) has a complete MCP server framework with 38 tool definitions, working Cypher query engine, and middleware stack, though most tool implementations return placeholder data. Layers 6 (Integration) and 7 (Presentation) are planned but not implemented.

### Layer Implementation Status Summary

| Layer | Package(s) | Status | Notes |
|-------|-----------|--------|-------|
| 1. Foundation | `core`, `shared` | ✅ Implemented | Config, logging, errors, i18n, metrics, lifecycle — complete |
| 2. Infrastructure | `infra` | ✅ Implemented | File ops, git ops, worker pool, in-memory store — SQLite persistence planned |
| 3. Analysis Engine | `analyzer` | ⚠️ Partial | Pipeline orchestrator complete; all 18 phases are stubs |
| 4. Intelligence | `intelligence` | ⚠️ Partial | BM25 search + heuristic review functional; rest is scaffolds |
| 5. Service | `mcp`, `server` | ⚠️ Partial | MCP framework, Cypher engine, middleware complete; tools return placeholders |
| 6. Integration | N/A | ⬜ Planned | CI workflows created; not tested end-to-end |
| 7. Presentation | `cli`, `vscode`, `web` | ⬜ Planned | Package scaffolds only |

---

## High-Level Architecture

Code Analyzer follows a strict **seven-layer architecture**. Each layer depends only on the layers below it, ensuring clean separation of concerns and independent testability.

```
┌─────────────────────────────────────────────────────────────────┐
│                Layer 7: Presentation                             │
│   VS Code Extension, Web UI, CLI (code-analyzer CLI)            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ calls
┌──────────────────────────▼──────────────────────────────────────┐
│                Layer 6: Integration                              │
│   GitHub Actions, Custom Adapters, CI/CD Pipelines              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ calls
┌──────────────────────────▼──────────────────────────────────────┐
│                Layer 5: Service                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐     │
│   │  MCP Server   │  │  REST API    │  │  WebSocket       │     │
│   │ (stdio/HTTP)  │  │  (HTTP)      │  │  (real-time)     │     │
│   └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘     │
│          │                 │                    │               │
│   ┌──────▼─────────────────▼────────────────────▼─────────┐     │
│   │    38 Tools · 15 Resources · 5 Prompts · Skills       │     │
│   └────────────────────────┬──────────────────────────────┘     │
└────────────────────────────┼────────────────────────────────────┘
                             │ uses
┌────────────────────────────▼────────────────────────────────────┐
│                Layer 4: Intelligence                             │
│   ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────┐ │
│   │   Search    │ │   Review   │ │  Impact  │ │  Standards   │ │
│   │ (BM25+Vec) │ │  (Pipeline)│ │ (BFS)    │ │  (10 tmpl)  │ │
│   └─────┬──────┘ └─────┬──────┘ └────┬─────┘ └──────┬───────┘ │
│         │              │             │               │         │
│   ┌─────▼──────────────▼─────────────▼───────────────▼───────┐ │
│   │  Embeddings · Reports · Trends · Compression · LSH       │ │
│   └──────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │ uses
┌────────────────────────────▼────────────────────────────────────┐
│                Layer 3: Analysis Engine                          │
│   ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────┐ │
│   │  Pipeline   │ │  Parser    │ │  Graph   │ │  Resolution  │ │
│   │ (18 phases)│ │ (Unified)  │ │ (Builder)│ │  (Scope)     │ │
│   └─────┬──────┘ └─────┬──────┘ └────┬─────┘ └──────┬───────┘ │
│         │              │             │               │         │
│   ┌─────▼──────────────▼─────────────▼───────────────▼───────┐ │
│   │ 8 Language Providers (TS, JS, Python, Go, Java, Kotlin,  │ │
│   │                    C#, Rust)                              │ │
│   └──────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │ uses
┌────────────────────────────▼────────────────────────────────────┐
│                Layer 2: Infrastructure                           │
│   ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────┐ │
│   │  Storage    │ │  Workers   │ │  Cache   │ │  Git Ops     │ │
│   │ (InMemoryGraphStore)│ │ (Pool)    │ │ (Parse)  │ │ (Diff/Hist) │ │
│   └─────┬──────┘ └─────┬──────┘ └────┬─────┘ └──────┬───────┘ │
│         │              │             │               │         │
│   ┌─────▼──────────────▼─────────────▼───────────────▼───────┐ │
│   │  File Discovery · File Watcher · Supervisor · Circuit    │ │
│   └──────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │ uses
┌────────────────────────────▼────────────────────────────────────┐
│                Layer 1: Foundation                               │
│   Config · Logging · Errors · I18n · Metrics · Lifecycle       │
│   (Shared Types: Graph, Pipeline, Review, Search, MCP)         │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Package | Input | Processing | Output |
|-------|---------|-------|------------|--------|
| **1. Foundation** | `core`, `shared` | Config files, env vars | Config loading/validation, error taxonomy, structured logging, i18n | Typed configs, localized messages, metrics |
| **2. Infrastructure** | `infra` | File paths, git refs | File discovery, git diff extraction, in-memory graph storage, worker pool orchestration | File lists, diffs, stored graph data |
| **3. Analysis Engine** | `analyzer` | Source files (8 languages) | Language-specific parsing, unified capture extraction, scope resolution, graph building | Unified knowledge graph |
| **4. Intelligence** | `intelligence` | Knowledge graph, user queries | BM25+vector hybrid search, code review pipeline, BFS impact analysis, LSH deduplication | Search results, review comments, impact reports |
| **5. Service** | `mcp`, `server` | MCP tool calls, HTTP requests | MCP protocol (tools/resources/prompts/skills), Cypher query execution, REST endpoints | Structured tool results, HTTP JSON responses |
| **6. Integration** | N/A (external) | GitHub webhooks, CI pipelines | PR review automation, standards checks, report generation | PR comments, CI annotations |
| **7. Presentation** | `cli`, `vscode`, `web` | User interactions | VS Code sidebar, Copilot Chat participant, CLI commands, web dashboard | UI updates, chat responses, formatted output |

---

## Package Dependency Graph

```
@code-analyzer/cli ──────────────────────┐
                                         │
@code-analyzer/vscode ───────────────────┤
                                         │
@code-analyzer/web ──────────────────────┤
                                         │
@code-analyzer/mcp ──────────────────────┤
                                         │
@code-analyzer/server ───────────────────┤
                                         │
@code-analyzer/intelligence ─────────────┤
                                         │
@code-analyzer/analyzer ─────────────────┤
                                         │
@code-analyzer/infra ────────────────────┤
                                         ▼
                              ┌──────────────────┐
                              │ @code-analyzer/   │
                              │     shared        │
                              │  (TypeScript      │
                              │   types only)     │
                              └──────────────────┘
                                         ▲
                              ┌──────────────────┐
                              │ @code-analyzer/   │
                              │     core          │
                              │  (Foundation)     │
                              └──────────────────┘
```

All packages depend on `@code-analyzer/shared` for type definitions. `@code-analyzer/core` provides the foundation layer. Higher packages depend on lower packages in the stack.

---

## Knowledge Graph Schema

The knowledge graph is the heart of Code Analyzer. It models code as a typed property graph with 33 node types (entity labels) and 39 relationship types (edge semantics).

### 33 Node Types

| Category | Node Labels | Description |
|----------|-------------|-------------|
| **Structural** | `Project`, `Package`, `Folder`, `File`, `Module` | Codebase organization hierarchy |
| **OOP Entities** | `Class`, `Interface`, `Struct`, `Trait`, `Enum`, `TypeAlias` | Object-oriented type definitions |
| **Functions** | `Function`, `Method`, `Constructor` | Executable code blocks |
| **Members** | `Property`, `Variable` | Data members and variables |
| **Infrastructure** | `Route`, `Component`, `Config`, `InfraResource` | API routes, components, configuration |
| **Process** | `Process`, `Community`, `Tool`, `Test` | Business processes, community clusters, AI tools |
| **Documentation** | `ADR` | Architecture Decision Records |
| **PDG** | `BasicBlock` | Program Dependence Graph basic blocks |
| **Cross-Repo** | `CrossRepoFunction`, `CrossRepoInterface`, `CrossRepoModule` | External repository entities |
| **Data** | `Contract`, `Event`, `DataSource`, `Sink` | Contracts, events, data flow |

### 39 Relationship Types

| Category | Relationship Types | Semantics |
|----------|-------------------|-----------|
| **Structural** | `CONTAINS`, `DEFINES`, `HAS_METHOD`, `HAS_PROPERTY`, `MEMBER_OF`, `BELONGS_TO` | Code organization and hierarchy |
| **Inheritance** | `EXTENDS`, `IMPLEMENTS`, `METHOD_OVERRIDES`, `METHOD_IMPLEMENTS` | Class/interface inheritance chains |
| **Data & Control Flow** | `CALLS`, `IMPORTS`, `ACCESSES`, `INSTANTIATES`, `USES_TYPE` | How code invokes and references other code |
| **Architectural** | `HANDLES_ROUTE`, `HANDLES_TOOL`, `EXPOSES`, `INJECTS` | High-level architectural patterns |
| **Analytical** | `SIMILAR_TO`, `SEMANTICALLY_RELATED`, `TESTS`, `CHANGES_WITH`, `DATA_FLOWS`, `STEP_IN_PROCESS` | Computed relationships from analysis |
| **PDG** | `CFG`, `REACHING_DEF`, `TAINTED`, `SANITIZES`, `TAINT_PATH` | Program dependence and security taint analysis |
| **Event** | `EMITS`, `LISTENS_ON` | Event-driven architecture patterns |
| **Config** | `CONFIGURES` | Configuration relationships |
| **Cross-Repo** | `CROSS_REPO_DEPENDS`, `CROSS_REPO_CALLS`, `CROSS_REPO_IMPLEMENTS`, `CROSS_REPO_IMPORTS`, `CROSS_REPO_EXPOSES`, `CROSS_REPO_CONTRACT` | Multi-repository dependencies |

---

## 18-Phase DAG Pipeline

The analysis pipeline executes as a Directed Acyclic Graph (DAG) using Kahn's algorithm for topological sorting. Phases are executed in dependency order, with parallel phases running concurrently.

```
                    ┌─────────┐
                    │  scan   │ (Phase 1)
                    └────┬────┘
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ structure │  │ markdown │  │  config  │
     │(Phase 2)  │  │(Phase 4) │  │(Phase 5) │
     └─────┬─────┘  └──────────┘  └──────────┘
           │
           ▼
     ┌──────────┐
     │  parse   │ (Phase 3)
     └─────┬────┘
    ┌──────┼───────────────────┐
    │      │        │     │    │
    ▼      ▼        ▼     ▼    ▼
┌───────┐ ┌───────┐ ┌─────┐ ┌────┐ ┌─────┐
│crossF │ │scope  │ │routes│ │tools│ │ di  │
│(Ph 6) │ │Res(7) │ │(Ph 8)│ │(Ph9)│ │(Ph10)│
└───┬───┘ └───┬───┘ └──┬──┘ └──┬─┘ └──┬──┘
    │         │        │       │      │
    ▼         ▼        │       │      │
┌────────┐ ┌────────┐ │       │      │
│communi-│ │ prune  │ │       │      │
│ties(12)│ │Local(11)│ │       │      │
└───┬────┘ └───┬────┘ │       │      │
    │          │      │       │      │
    │     ┌────┴──────┴───────┴──────┤
    │     │         dump (Phase 15)  │
    │     └──┬───────────┬───────────┘
    │        │           │
    ▼        ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐
│similarity│ │semantic│ │ embed  │
│(Ph 16) │ │(Ph 17) │ │(Ph 18) │
└────────┘ └────────┘ └────────┘

Also depends on dump:
  - processes (Phase 13) ← scopeResolution + routes
  - tests (Phase 14) ← scopeResolution
```

### Phase Details

| Phase | ID | Dependencies | Parallel | Description |
|-------|----|-------------|----------|-------------|
| 1 | `scan` | None | No | Discover source files in the project directory |
| 2 | `structure` | `scan` | Yes | Build directory hierarchy and module structure |
| 3 | `parse` | `scan`, `structure` | Yes | Parse source files using language-specific parsers |
| 4 | `markdown` | `scan` | Yes | Process markdown and documentation files |
| 5 | `config` | `scan` | Yes | Process configuration files (JSON, YAML, TOML, ENV) |
| 6 | `crossFile` | `parse` | Yes | Analyze cross-file dependencies and imports |
| 7 | `scopeResolution` | `parse` | Yes | Resolve scope trees and symbol references |
| 8 | `routes` | `parse` | Yes | Detect and catalog API route handlers |
| 9 | `tools` | `parse` | Yes | Detect AI agent tool definitions |
| 10 | `di` | `parse` | Yes | Detect dependency injection patterns |
| 11 | `pruneLocalSymbols` | `scopeResolution` | No | Prune local-only symbols from the knowledge graph |
| 12 | `communities` | `crossFile` | No | Detect code communities and module clusters |
| 13 | `processes` | `scopeResolution`, `routes` | No | Detect and catalog business process steps |
| 14 | `tests` | `scopeResolution` | Yes | Detect test files and their code relationships |
| 15 | `dump` | `scopeResolution`, `routes`, `tools`, `di`, `communities`, `processes`, `tests` | No | Serialize and dump the knowledge graph to storage |
| 16 | `similarity` | `dump` | Yes | Compute code similarity between files and functions |
| 17 | `semantic` | `dump` | No | Perform semantic analysis on the knowledge graph |
| 18 | `embed` | `dump` | Yes | Generate vector embeddings for graph nodes |

### Orchestrator Design

The `PipelineOrchestrator` (`packages/analyzer/src/pipeline/orchestrator.ts`) manages execution:

- **Topological Sort**: Uses Kahn's algorithm to determine phase execution order
- **Validation**: Checks for cycles, missing dependencies, and duplicate IDs before execution
- **Dependency-aware skipping**: If a phase fails, its dependents are automatically skipped
- **Context threading**: A shared `PipelineContext` object passes data between phases
- **Error resilience**: Partial failures are reported; completed phases remain available

---

## Code Review Pipeline

The code review engine (`packages/intelligence/src/review/review-engine.ts`) implements a four-phase pipeline:

```
Git Diff → [Plan] → [Analyze] → [Filter] → [Relocate] → Review Comments
```

### Phase 1: Plan

Analyzes the diff to determine review strategy:

- **File type analysis**: Identifies TypeScript files, test files, API routes, etc.
- **Size-based analysis**: Flags large files (>200 lines by default) as high-complexity risk
- **Change type analysis**: Detects deletions, renames, and their implications
- **Focus areas**: Generates a checklist of things to review based on file characteristics
- **Estimated complexity**: Classifies each file as `low`, `medium`, or `high`

### Phase 2: Analyze

Runs heuristic analysis on the diff content:

- Builds graph analysis data from the knowledge graph (out-degree, in-degree, exported symbols)
- Detects circular dependencies using DFS cycle detection
- Runs heuristic rules: function size, nesting depth, naming conventions, error handling patterns
- Generates review comments with severity, category, and suggestions

### Phase 3: Filter

Applies filter rules to remove noise:

- **Empty code context**: Comments with no existing code
- **Invalid line ranges**: Comments with non-positive line numbers
- **Style comments on comments**: Style issues on lines that are only comments

### Phase 4: Relocate

Adjusts line numbers to map from diff ranges to the new file:

- Computes cumulative offset from all diff ranges
- Clamps line numbers to valid range
- Ensures comments reference the correct post-change line numbers

---

## Hybrid Search Architecture

The `HybridSearchEngine` (`packages/intelligence/src/search/hybrid-search.ts`) combines two search strategies:

```
User Query
    │
    ├──────────────────────┐
    ▼                      ▼
┌─────────┐          ┌──────────────┐
│  BM25   │          │   Vector     │
│ Search  │          │   Search     │
└────┬────┘          └──────┬───────┘
     │                      │
     └──────────┬───────────┘
                ▼
     ┌──────────────────┐
     │ Reciprocal Rank  │
     │    Fusion (k=60) │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │  Combined Results │
     └──────────────────┘
```

### BM25 Component

- **Inverted Index**: Built from node names, qualified names, signatures, and docstrings
- **Tokenization**: Splits camelCase, snake_case, and kebab-case identifiers into searchable tokens
- **Scoring**: Standard BM25 formula with configurable k1 (1.2) and b (0.75) parameters
- **Filters**: Supports filtering by label, file pattern, export status, and complexity range

### Vector Component

- **Embeddings**: Pre-computed code-aware embeddings for each graph node
- **Cosine Similarity**: Measures semantic proximity between query and node embeddings
- **Top-K**: Returns the K most semantically similar results

### Reciprocal Rank Fusion (RRF)

Combines results using the formula: `RRF_score = 1/(k + rank)` where k=60.

This approach:
- Does not require score normalization across different search methods
- Rewards documents that rank highly in both systems
- Naturally handles documents that appear in only one result set

---

## Cross-Repo Federation Design

Code Analyzer supports cross-repository analysis through a federation model:

```
┌──────────────┐     CROSS_REPO_CALLS     ┌──────────────┐
│   Repo A      │ ◄─────────────────────► │   Repo B      │
│ (Frontend)    │                          │ (Backend)     │
└──────────────┘                          └──────────────┘
       │                                          │
       │  CROSS_REPO_CONTRACT                     │
       └──────────────────────────────────────────┘
```

### Key Concepts

- **Repo Groups**: Collections of related repositories with defined roles (`primary`, `dependency`, `consumer`)
- **Contracts**: Formal API contracts between repositories (OpenAPI, GraphQL schemas, etc.)
- **Cross-Repo Edges**: Specialized relationship types prefixed with `CROSS_REPO_` for cross-repository dependencies
- **Contract Synchronization**: Automatic detection of contract violations across repository boundaries

### Cross-Repo Tool Suite

Six dedicated MCP tools support cross-repo operations:
- `cross_repo_search` — Search across multiple repositories
- `cross_repo_trace` — Trace call paths across repositories
- `cross_repo_impact` — Analyze cross-repo impact of changes
- `manage_repo_group` — Manage repository groups
- `sync_contracts` — Synchronize contracts across repos
- `discover_related_repos` — Discover related repositories

---

## MCP Protocol Integration

The MCP server (`packages/mcp/src/server/mcp-server.ts`) implements the Model Context Protocol:

```
AI Agent (Claude, Cursor, Codex, etc.)
    │
    │ MCP Protocol (JSON-RPC over stdio or HTTP/SSE)
    ▼
┌─────────────────────────────────────────┐
│           CodeAnalyzerMCPServer          │
│  ┌───────────────────────────────────┐  │
│  │  Middleware Pipeline              │  │
│  │  Auth → Rate Limit → Execute     │  │
│  └───────────────────────────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐  │
│  │ Tools   │ │Resources │ │ Prompts │  │
│  │ (38)    │ │ (15)     │ │ (5)     │  │
│  └────┬────┘ └────┬─────┘ └────┬────┘  │
│       │           │            │       │
│  ┌────▼───────────▼────────────▼─────┐ │
│  │        InMemoryGraphStore                │ │
│  │  (In-Memory Knowledge Graph)      │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Server Capabilities

- **Tools**: 38 tools with list-changed notifications
- **Resources**: 15 resources with subscribe and list-changed support
- **Prompts**: 5 reusable prompt templates with list-changed notifications
- **Logging**: Structured request logging with duration tracking
- **Transports**: stdio (default) and HTTP with SSE fallback

### Middleware Stack

| Middleware | Description |
|------------|-------------|
| `AuthMiddleware` | API key validation via `x-api-key` or `Authorization: Bearer` headers |
| `RateLimiter` | Token bucket algorithm with configurable capacity (default: 100) and refill rate (0.5 tokens/ms) |
| `RequestLogger` | Structured logging with duration, error tracking, and statistics (last 1000 entries) |

### Tool Profiles

Tools can be filtered by profile to limit exposure:
- **all**: All 38 tools (default)
- **analysis**: 28 query, review, and impact tools
- **scout**: Discovery-focused tools only

### Cypher Query Engine

The `packages/mcp/src/cypher/` directory implements a Cypher-like graph query language:

| Component | Description |
|-----------|-------------|
| `lexer.ts` | Tokenizes Cypher queries into KEYWORD, IDENTIFIER, STRING, NUMBER, OPERATOR, and PUNCTUATION tokens |
| `parser.ts` | Parses token streams into AST nodes (MATCH, WHERE, RETURN clauses) |
| `planner.ts` | Generates execution plans from parsed queries |
| `executor.ts` | Executes plans against the InMemoryGraphStore |

Supported Cypher syntax:
```cypher
MATCH (f:Function)-[:CALLS]->(t:Function)
WHERE f.name CONTAINS 'auth'
RETURN f.name, t.name
ORDER BY f.name ASC
LIMIT 10
```

---

## Performance Characteristics

> **Note**: These are design targets for the in-memory store based on synthetic test data. Real-world performance with the full analysis pipeline has not been measured yet.

| Metric | Target | Description |
|--------|--------|-------------|
| Indexing speed | 1M LOC in <60s | Worker thread pools with incremental parse caching |
| Incremental update | <500ms per file | File watcher integration, re-index only changed files |
| Graph queries | <10ms per BFS | Adjacency-list storage with source/target edge indices |
| Search latency | <50ms BM25 | Inverted index with term frequency pre-computation |
| Vector search | <100ms | Cosine similarity over pre-computed embeddings |
| Memory per 1K LOC | 3-5MB | Language-dependent; TypeScript ~5MB, Python ~3MB |

### Storage Design

> **Current implementation note**: `InMemoryGraphStore` uses in-memory `Map`-based storage. SQLite persistence is planned for a future release. Data does not survive process restarts.

The `InMemoryGraphStore` (`packages/infra/src/storage/in-memory-graph-store.ts`) uses an in-memory Map-based storage with:

- **Adjacency indices**: `sourceEdgeIndex` and `targetEdgeIndex` for O(1) edge lookups
- **Qualified name index**: `qnameIndex` for direct symbol resolution
- **Pattern cache**: Compiled regex cache for glob pattern matching
- **Transaction support**: Snapshot-based transactions with automatic rollback on errors
- **Integrity validation**: Orphan edge detection, duplicate qname checking, missing qname detection

### Worker Pool

The `createWorkerPool` (`packages/infra/src/workers/pool.ts`) provides:

- **Concurrency control**: Configurable slot-based limiting (default: 4)
- **Task timeout**: Per-task timeout with `Promise.race` (default: 30s)
- **Retry support**: Configurable retry count with exponential backoff
- **Graceful shutdown**: Rejects pending tasks on shutdown

---

## Key Design Principles

1. **Strict layer isolation**: Each layer depends only on the layers below it. No upward dependencies.
2. **Shared type system**: `@code-analyzer/shared` defines all types — the single source of truth for the entire platform.
3. **Interface-based abstraction**: `LanguageProvider`, `IInferenceEngine`, and other interfaces decouple implementations from consumers.
4. **DAG-based execution**: The pipeline uses Kahn's algorithm for deterministic, dependency-aware execution order.
5. **Functional core, imperative shell**: Pure functions for computation, classes for stateful coordination.
6. **Zero external API calls**: All processing is local — code never leaves the machine.
7. **Progressive disclosure**: Public APIs export both high-level conveniences and low-level primitives.

---

## Design Decisions and Tradeoffs

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| In-memory graph store (current) | Simpler implementation during alpha | Data lost on restart; SQLite planned for persistence |
| Regex-based parsing | Fast indexing without compiler frontends | 95-99% accuracy vs 100% with full compilers |
| BM25 + vector hybrid search | Best of both worlds: exact keyword + semantic | Requires pre-computed embeddings |
| Kahn's algorithm for DAG | Deterministic execution order | Must maintain explicit dependency declarations |
| Snapshot-based transactions | Simple rollback without write-ahead log | Memory overhead for large graphs |
| Monorepo with Turborepo | Shared types, coordinated releases | More complex build orchestration |
| Stdio MCP transport | Works with all MCP clients out of the box | Limited to single-machine deployments |

---

## Data Flow Through the System

```
Source Files (*.ts, *.py, *.go, ...)
    │
    ▼
[File Discoverer] ──→ DiscoveredFile[] (path, language, content, hash)
    │
    ▼
[Language Provider] ──→ UnifiedCapture[] (normalized across 8 languages)
    │
    ▼
[Scope Resolver] ──→ ResolvedReference[], ResolvedImport[]
    │
    ▼
[Graph Builder] ──→ KnowledgeGraph (33 node types, 39 edge types)
    │
    ├──→ [InMemoryGraphStore] (in-memory, adjacency-indexed)
    │
    ├──→ [Hybrid Search] (BM25 + vector + RRF)
    │
    ├──→ [Impact Analyzer] (BFS traversal over CALLS, IMPLEMENTS, etc.)
    │
    ├──→ [Code Review Engine] (Plan → Analyze → Filter → Relocate)
    │
    ├──→ [Standards Engine] (regex + metric + ast-pattern checks)
    │
    └──→ [MCP Server] (38 tools exposed to AI agents)
```
