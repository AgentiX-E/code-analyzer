# Architecture

> Technical architecture of Code Analyzer — a layered code intelligence platform that transforms source code into a structured knowledge graph with 33 entity types and 44 relationship types.

---

## Six-Layer Architecture

Code Analyzer follows a **six-layer architecture**. Each layer depends only on the layers below it, ensuring clean separation of concerns and independent testability.

```
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 6: Presentation                          │
│     CLI · VS Code Extension · Web Dashboard                     │
├─────────────────────────────────────────────────────────────────┤
│                         │ calls                                  │
├─────────────────────────────────────────────────────────────────┤
│                  Layer 5: Service                                │
│     MCP Server · HTTP API · WebSocket · Rate Limiting            │
│     (45 Tools · 15 Resources · 5 Prompts)                        │
├─────────────────────────────────────────────────────────────────┤
│                         │ uses                                   │
├─────────────────────────────────────────────────────────────────┤
│                  Layer 4: Intelligence                           │
│     Hybrid Search · Code Review · Impact Analysis · Standards    │
│     Embeddings · Reports · Trends · LSH                          │
├─────────────────────────────────────────────────────────────────┤
│                         │ uses                                   │
├─────────────────────────────────────────────────────────────────┤
│                  Layer 3: Analysis Engine                        │
│     19-Phase DAG Pipeline · 8 Language Providers                 │
│     Unified Parser · Graph Builder · Scope Resolution            │
├─────────────────────────────────────────────────────────────────┤
│                         │ uses                                   │
├─────────────────────────────────────────────────────────────────┤
│                  Layer 2: Infrastructure                         │
│     File Discovery · Graph Stores · Worker Pool · Git Ops        │
│     Supervisor · Circuit Breaker · Plugin Host                   │
├─────────────────────────────────────────────────────────────────┤
│                         │ uses                                   │
├─────────────────────────────────────────────────────────────────┤
│                  Layer 1: Foundation                             │
│     Config · Logging · Errors · I18n · Metrics · Lifecycle       │
│     Shared Types · RBAC · Secret Scanner                         │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Key Components | Description |
|-------|---------------|-------------|
| **1. Foundation** | Config loader, typed errors, structured logging, i18n, RBAC | Cross-cutting concerns used by all other layers |
| **2. Infrastructure** | File discovery, git operations, worker pool, graph stores, plugin host | System-level services and abstractions |
| **3. Analysis Engine** | 19-phase DAG pipeline, 8 language providers, scope resolver | Transforms source files into a unified knowledge graph |
| **4. Intelligence** | Hybrid search, code review engine, impact analyzer, standards engine | Derives insights from the knowledge graph |
| **5. Service** | MCP server, HTTP API, WebSocket, rate limiter, authenticator | Exposes capabilities to external consumers |
| **6. Presentation** | CLI, VS Code extension, web dashboard | User-facing interfaces |

---

## Knowledge Graph Model

The knowledge graph is the central data structure. It models code as a typed property graph.

### 33 Node Types

| Category | Node Labels | Description |
|----------|-------------|-------------|
| **Structural** | `Project`, `Package`, `Folder`, `File`, `Module` | Codebase organization hierarchy |
| **OOP Entities** | `Class`, `Interface`, `Struct`, `Trait`, `Enum`, `TypeAlias` | Type definitions |
| **Functions** | `Function`, `Method`, `Constructor` | Executable code blocks |
| **Members** | `Property`, `Variable`, `Parameter` | Data members and variables |
| **Infrastructure** | `Route`, `Component`, `Config`, `InfraResource` | API routes, components, configuration |
| **Process** | `Process`, `Step`, `Community`, `Tool`, `Test` | Business processes, community clusters, AI tools |
| **Documentation** | `ADR` | Architecture Decision Records |
| **PDG** | `BasicBlock` | Program dependence graph basic blocks |
| **Data Flow** | `Contract`, `Event`, `DataSource`, `Sink` | Contracts, events, data flow endpoints |

### 44 Relationship Types

| Category | Relationship Types | Semantics |
|----------|-------------------|-----------|
| **Structural** | `CONTAINS`, `DEFINES`, `HAS_METHOD`, `HAS_PROPERTY`, `MEMBER_OF`, `BELONGS_TO` | Code organization |
| **Inheritance** | `EXTENDS`, `IMPLEMENTS`, `METHOD_OVERRIDES`, `METHOD_IMPLEMENTS` | Class/interface hierarchy |
| **Data & Control** | `CALLS`, `IMPORTS`, `ACCESSES`, `INSTANTIATES`, `USES_TYPE`, `RETURNS`, `PARAM_OF` | Code invocation and reference |
| **Architectural** | `HANDLES_ROUTE`, `HANDLES_TOOL`, `EXPOSES`, `INJECTS`, `CONFIGURES` | High-level patterns |
| **Analytical** | `SIMILAR_TO`, `SEMANTICALLY_RELATED`, `TESTS`, `CHANGES_WITH`, `DATA_FLOWS`, `STEP_IN_PROCESS`, `DEPENDS_ON` | Computed relationships |
| **PDG & Security** | `CFG`, `REACHING_DEF`, `TAINTED`, `SANITIZES`, `TAINT_PATH`, `DOMINATES`, `POST_DOMINATES` | Program dependence and taint analysis |
| **Event** | `EMITS`, `LISTENS_ON`, `SUBSCRIBES_TO` | Event-driven patterns |
| **Cross-Repo** | `CROSS_REPO_DEPENDS`, `CROSS_REPO_CALLS`, `CROSS_REPO_IMPLEMENTS`, `CROSS_REPO_IMPORTS`, `CROSS_REPO_EXPOSES`, `CROSS_REPO_CONTRACT` | Multi-repository dependencies |

---

## 19-Phase DAG Pipeline

The analysis pipeline executes as a Directed Acyclic Graph using Kahn's algorithm for topological sorting. Phases execute in dependency order, with independent phases running in parallel.

### Phase Execution Order

```
    ┌──────────┐
    │  1.scan   │
    └─────┬─────┘
   ┌──────┼──────┐
   ▼      ▼      ▼
┌────┐ ┌────┐ ┌────┐
│ 2. │ │ 4. │ │ 5. │
│str │ │md  │ │cfg │
└──┬─┘ └────┘ └────┘
   ▼
┌────┐
│ 3. │
│prs │
└──┬─┘
   └──────┬──────┬──────┬──────┐
          ▼      ▼      ▼      ▼
       ┌────┐ ┌────┐ ┌────┐ ┌────┐
       │ 6. │ │ 7. │ │ 8. │ │ 9. │
       │crF │ │scp │ │rts │ │tls │
       └──┬─┘ └──┬─┘ └──┬─┘ └──┬─┘
          │      │      │      │
          ▼      ▼      ▼      ▼
       ┌────┐ ┌────┐
       │10. │ │11. │
       │di  │ │prn │
       └──┬─┘ └──┬─┘
          │      │
          ├──────┤
          ▼      ▼
       ┌────┐ ┌────┐
       │12. │ │13. │
       │com │ │pro │
       └──┬─┘ └──┬─┘
          │      │
          ▼      ▼
       ┌─────────┐      ┌────┐
       │ 14.dump  │◄─────│15. │
       └────┬─────┘      │tst │
            │            └────┘
       ┌────┼────┐
       ▼    ▼    ▼
    ┌────┐ ┌────┐ ┌────┐
    │16. │ │17. │ │18. │
    │sim │ │sem │ │emb │
    └────┘ └────┘ └────┘
```

### Phase Details

| # | ID | Dependencies | Parallel | Description |
|:--|----|-------------|:--------:|-------------|
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
| 11 | `pruneLocal` | `scopeResolution` | No | Prune local-only symbols from the graph |
| 12 | `communities` | `crossFile` | No | Detect code communities and module clusters |
| 13 | `processes` | `scopeResolution`, `routes` | No | Detect business process steps |
| 14 | `tests` | `scopeResolution` | Yes | Detect tests and code relationships |
| 15 | `dump` | Phase completion check | No | Serialize knowledge graph to storage |
| 16 | `similarity` | `dump` | Yes | Compute code similarity (LSH) |
| 17 | `semantic` | `dump` | No | Semantic analysis on the graph |
| 18 | `embed` | `dump` | Yes | Generate vector embeddings |
| 19 | `validate` | `dump` | No | Validate graph integrity and consistency |

### Orchestrator Design

The `PipelineOrchestrator` manages execution through:

- **Kahn's algorithm** for deterministic topological sort
- **Shared context threading** via a `PipelineContext` object passed between phases
- **Dependency-aware skipping**: if a phase fails, its dependents are automatically skipped
- **Error resilience**: partial failures are reported; completed phases remain available

---

## Storage Backends

Code Analyzer supports two graph storage backends, selectable via configuration.

### InMemoryGraphStore

The default storage engine for fast queries and small-to-medium codebases.

| Feature | Detail |
|---------|--------|
| **Storage** | JavaScript `Map`-based adjacency lists |
| **Lookups** | O(1) edge lookups via `sourceEdgeIndex` and `targetEdgeIndex` |
| **Symbol resolution** | O(1) via `qnameIndex` (qualified name index) |
| **Transactions** | Snapshot-based with automatic rollback |
| **Integrity** | Orphan edge detection, duplicate qname checking |
| **Best for** | Fast queries, repos < 50K files, ephemeral sessions |
| **Limitation** | Data is lost on process restart |

```typescript
// Configuration
const store = new InMemoryGraphStore();

// With transaction support
store.beginTransaction();
store.addNode(node);
store.addEdge(edge);
store.commit(); // or store.rollback()
```

### SQLiteGraphStore

Disk-backed storage for large codebases and persistent deployments.

| Feature | Detail |
|---------|--------|
| **Storage** | SQLite database with WAL mode |
| **Schema** | Nodes table, edges table, full-text search index |
| **Concurrency** | WAL mode allows concurrent reads with a single writer |
| **Durability** | Data persists across process restarts |
| **FTS** | Built-in full-text search via SQLite FTS5 |
| **Best for** | Large repos (> 50K files), CI/CD persistence, server deployments |

```yaml
# .code-analyzerrc.yaml
storage:
  type: sqlite
  dbPath: .code-analyzer/graph.db
```

### Comparison

| Aspect | InMemoryGraphStore | SQLiteGraphStore |
|--------|:-----------------:|:----------------:|
| Query speed | ~1ms | ~5ms |
| Memory usage | Maps loaded in heap | Working set only |
| Persistence | No | Yes |
| Max graph size | RAM-limited | Disk-limited |
| FTS support | In-memory BM25 | SQLite FTS5 |

---

## MCP Server Architecture

The MCP server exposes 45 tools, 15 resources, and 5 prompts to AI coding agents via the Model Context Protocol.

### Server Components

```
AI Agent (Claude, Cursor, Codex, Windsurf, Cline, Continue)
    │
    │  JSON-RPC over stdio or HTTP/SSE
    ▼
┌─────────────────────────────────────────────┐
│         CodeAnalyzerMCPServer               │
│                                             │
│  Middleware Pipeline                         │
│  Auth → Rate Limit → Request Logging         │
│                                             │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐  │
│  │  Tools  │  │ Resources │  │ Prompts  │  │
│  │  (45)   │  │   (15)    │  │   (5)    │  │
│  └────┬────┘  └─────┬─────┘  └────┬─────┘  │
│       └──────────────┼─────────────┘        │
│                      ▼                      │
│            ┌─────────────────┐              │
│            │   Graph Store   │              │
│            │ InMemory/SQLite │              │
│            └─────────────────┘              │
└─────────────────────────────────────────────┘
```

### Transport Modes

| Transport | Protocol | Use Case |
|-----------|----------|----------|
| **stdio** | JSON-RPC over stdin/stdout | Desktop agents (default) |
| **HTTP/SSE** | JSON-RPC over HTTP with Server-Sent Events | Remote servers, multi-client |

### Middleware Stack

| Middleware | Description |
|------------|-------------|
| `AuthMiddleware` | API key validation via `x-api-key` or `Authorization: Bearer` headers |
| `RateLimiter` | Token bucket algorithm (default: 100 capacity, 0.5 tokens/ms refill) |
| `RequestLogger` | Structured logging with duration tracking, last 1000 entries |

### Tool Profiles

| Profile | Tool Count | Includes |
|---------|:---------:|----------|
| `all` | 45 | Every tool |
| `analysis` | 28 | Querying, review, impact, PR review, reports, cross-repo, PDG |
| `scout` | 1 | Discovery-focused only |

### Cypher Query Engine

The embedded Cypher engine supports graph-pattern queries:

```
Query String
    │
    ▼
[Lexer] → Token[] (KEYWORD, IDENTIFIER, STRING, NUMBER, OPERATOR, PUNCTUATION)
    │
    ▼
[Parser] → AST (MatchClause, WhereClause, ReturnClause)
    │
    ▼
[Planner] → Execution Plan
    │
    ▼
[Executor] → Results from Graph Store
```

Supported syntax: `MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `LIMIT`, aggregation functions (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`).

---

## Plugin System

Code Analyzer supports a plugin architecture for extending language support, analysis rules, and output formats.

### Plugin Types

| Plugin Type | Interface | Purpose |
|-------------|-----------|---------|
| **Language Provider** | `LanguageProvider` | Add support for new programming languages |
| **Review Rule** | `ReviewRule` | Add custom code review rules |
| **Standard** | `Standard` | Define project-specific standards |
| **Report Formatter** | `ReportFormatter` | Customize report output formats |
| **Graph Enhancer** | `GraphEnhancer` | Add custom analysis phases to the pipeline |

### Plugin Installation

Plugins are npm packages following the `code-analyzer-plugin-*` naming convention:

```bash
# Install a community language plugin
pnpm add -D code-analyzer-plugin-elixir

# Install a custom review rules plugin
pnpm add -D code-analyzer-plugin-custom-rules
```

### Plugin Configuration

Register plugins in `.code-analyzerrc.yaml`:

```yaml
plugins:
  - name: elixir
    package: code-analyzer-plugin-elixir
  - name: custom-rules
    package: code-analyzer-plugin-custom-rules
    config:
      rules:
        - no-console-log
        - enforce-naming-convention
```

### Creating a Plugin

A plugin is an npm package that exports a factory function:

```typescript
// code-analyzer-plugin-example/src/index.ts
import type { CodeAnalyzerPlugin } from '@code-analyzer/shared';

export function createPlugin(config: PluginConfig): CodeAnalyzerPlugin {
  return {
    name: 'example-plugin',
    version: '1.0.0',

    // Register a custom review rule
    reviewRules: [
      {
        id: 'no-todo-without-ticket',
        category: 'maintainability',
        severity: 'medium',
        check(node, context) {
          // Rule logic here
        },
      },
    ],

    // Add a pipeline phase
    phases: [
      {
        id: 'custom-analysis',
        dependencies: ['parse'],
        async execute(context: PipelineContext) {
          // Custom analysis logic
        },
      },
    ],
  };
}
```

### Plugin Loading

Plugins are loaded during the `init` phase by the `PluginHost` in the infrastructure layer. The host:

1. Resolves each plugin package from `node_modules`
2. Validates the plugin against the `CodeAnalyzerPlugin` interface
3. Calls the factory function with the plugin's config
4. Registers rules, phases, and providers into the system
5. Reports loading status and any errors

---

## Key Design Principles

1. **Strict layer isolation** — Each layer depends only on layers below it
2. **Shared type system** — All types defined in `@code-analyzer/shared`, the single source of truth
3. **Interface-based abstraction** — `LanguageProvider`, `IInferenceEngine`, and similar interfaces decouple implementations
4. **DAG-based execution** — Deterministic, dependency-aware phase ordering via Kahn's algorithm
5. **Functional core, imperative shell** — Pure functions for computation, classes for stateful coordination
6. **Zero external API calls** — All processing is local; code never leaves the machine
7. **Plugin extensibility** — Language support, rules, and formats are extended through plugins

## Key Tradeoffs

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| In-memory graph store (default) | Fastest queries during alpha | Data lost on restart; SQLite available for persistence |
| Regex-based parsing | Fast indexing without compiler frontends | 95-99% accuracy vs 100% with full compilers |
| BM25 + vector hybrid search | Best of keyword + semantic search | Requires pre-computed embeddings |
| Snapshot-based transactions | Simple rollback without write-ahead log | Memory overhead for large graphs |
| Stdio MCP transport | Works with all MCP clients | Limited to single-machine deployments |
| Monorepo with Turborepo | Shared types, coordinated releases | More complex build orchestration |

---

## See Also

- [MCP Tool Reference](mcp-tool-reference.md) — All 45 tools documented
- [Configuration Reference](configuration-reference.md) — Storage and MCP configuration
- [Scenario Guides](scenario-guides.md) — Task-based workflows
- [Getting Started](getting-started.md) — Up-and-running guide
