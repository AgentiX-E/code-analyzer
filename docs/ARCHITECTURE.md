# Architecture

> `code-analyzer` �? Architecture documentation for a layered code intelligence platform that transforms source code into a structured knowledge graph with 36 entity types and 43 relationship types.

> **Implementation Status**: v0.1.0 �� All seven layers are implemented. 280 test files, 8,000+ tests. Coverage is measured honestly (see README badge); semantic embeddings require the ONNX model (see embed phase). The platform provides MCP service, VS Code extension with Copilot Chat integration, Web Dashboard, and GitHub cross-repo PR review.

### Layer Implementation Status Summary

| Layer              | Package(s)             | Status  | Notes                                                                          |
| ------------------ | ---------------------- | ------- | ------------------------------------------------------------------------------ |
| 1. Foundation      | `core`, `shared`       | �? Done | Config, logging, errors, i18n, metrics, lifecycle, RBAC, secret scanner        |
| 2. Infrastructure  | `infra`                | �? Done | File discovery, git ops, worker pool, graph stores, supervisor                 |
| 3. Analysis Engine | `analyzer`             | �? Done | 19-phase DAG pipeline, 12 language providers, scope resolution                 |
| 4. Intelligence    | `intelligence`         | �? Done | Hybrid search, PR review, embeddings, impact analysis, standards, cross-repo   |
| 5. Service         | `mcp`, `server`        | �? Done | 40 MCP tools, HTTP/SSE server, rate limiting, health checks, graceful shutdown |
| 6. Integration     | `intelligence/github`  | �? Done | GitHub webhooks, cross-repo PR review bridge, check runs, repo sync            |
| 7. Presentation    | `cli`, `vscode`, `web` | �? Done | CLI (6 commands), VS Code Copilot Chat (7 slash), Web Dashboard (6 views)      |

---

## High-Level Architecture

Code Analyzer follows a strict **seven-layer architecture**. Each layer depends only on the layers below it, ensuring clean separation of concerns and independent testability.

```
┌─────────────────────────────────────────────────────────────────�?
�?                Layer 7: Presentation                             �?
�?   VS Code Extension, Web UI, CLI (code-analyzer CLI)            �?
└──────────────────────────┬──────────────────────────────────────�?
                           �? calls
┌──────────────────────────▼──────────────────────────────────────�?
�?                Layer 6: Integration                              �?
�?   GitHub Actions, Custom Adapters, CI/CD Pipelines              �?
└──────────────────────────┬──────────────────────────────────────�?
                           �? calls
┌──────────────────────────▼──────────────────────────────────────�?
�?                Layer 5: Service                                  �?
�?   ┌──────────────�?  ┌──────────────�?  ┌──────────────────�?     �?
�?   �?  MCP Server   �?  �?  REST API    �?  �?  WebSocket       �?     �?
�?   �? (stdio/HTTP)  �?  �?  (HTTP)      �?  �?  (real-time)     �?     �?
�?   └──────┬───────�?  └──────┬───────�?  └────────┬─────────�?     �?
�?          �?                 �?                    �?               �?
�?   ┌──────▼─────────────────▼────────────────────▼─────────�?     �?
�?   �?    38 Tools · 15 Resources · 5 Prompts · Skills       �?     �?
�?   └────────────────────────┬──────────────────────────────�?     �?
└────────────────────────────┼────────────────────────────────────�?
                             �? uses
┌────────────────────────────▼────────────────────────────────────�?
�?                Layer 4: Intelligence                             �?
�?   ┌────────────�? ┌────────────�? ┌──────────�? ┌──────────────�? �?
�?   �?   Search    �? �?   Review   �? �?  Impact  �? �?  Standards   �? �?
�?   �? (BM25+Vec) �? �?  (Pipeline)�? �? (BFS)    �? �?  (10 tmpl)  �? �?
�?   └─────┬──────�? └─────┬──────�? └────┬─────�? └──────┬───────�? �?
�?         �?              �?             �?               �?         �?
�?   ┌─────▼──────────────▼─────────────▼───────────────▼───────�? �?
�?   �?  Embeddings · Reports · Trends · Compression · LSH       �? �?
�?   └──────────────────────────────────────────────────────────�? �?
└────────────────────────────┬────────────────────────────────────�?
                             �? uses
┌────────────────────────────▼────────────────────────────────────�?
�?                Layer 3: Analysis Engine                          �?
�?   ┌────────────�? ┌────────────�? ┌──────────�? ┌──────────────�? �?
�?   �?  Pipeline   �? �?  Parser    �? �?  Graph   �? �?  Resolution  �? �?
�?   �? (19 phases)�? �? (Unified)  �? �? (Builder)�? �?  (Scope)     �? �?
�?   └─────┬──────�? └─────┬──────�? └────┬─────�? └──────┬───────�? �?
�?         �?              �?             �?               �?         �?
�?   ┌─────▼──────────────▼─────────────▼───────────────▼───────�? �?
�?   �? 8 Language Providers (TS, JS, Python, Go, Java, Kotlin,  �? �?
�?   �?                    C#, Rust)                              �? �?
�?   └──────────────────────────────────────────────────────────�? �?
└────────────────────────────┬────────────────────────────────────�?
                             �? uses
┌────────────────────────────▼────────────────────────────────────�?
�?                Layer 2: Infrastructure                           �?
�?   ┌────────────�? ┌────────────�? ┌──────────�? ┌──────────────�? �?
�?   �?  Storage    �? �?  Workers   �? �?  Cache   �? �?  Git Ops     �? �?
�?   �? (InMemoryGraphStore)�? �? (Pool)    �? �? (Parse)  �? �? (Diff/Hist) �? �?
�?   └─────┬──────�? └─────┬──────�? └────┬─────�? └──────┬───────�? �?
�?         �?              �?             �?               �?         �?
�?   ┌─────▼──────────────▼─────────────▼───────────────▼───────�? �?
�?   �?  File Discovery · File Watcher · Supervisor · Circuit    �? �?
�?   └──────────────────────────────────────────────────────────�? �?
└────────────────────────────┬────────────────────────────────────�?
                             �? uses
┌────────────────────────────▼────────────────────────────────────�?
�?                Layer 1: Foundation                               �?
�?   Config · Logging · Errors · I18n · Metrics · Lifecycle       �?
�?   (Shared Types: Graph, Pipeline, Review, Search, MCP)         �?
└─────────────────────────────────────────────────────────────────�?
```

### Layer Responsibilities

| Layer                  | Package                | Input                         | Processing                                                                              | Output                                          |
| ---------------------- | ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **1. Foundation**      | `core`, `shared`       | Config files, env vars        | Config loading/validation, error taxonomy, structured logging, i18n                     | Typed configs, localized messages, metrics      |
| **2. Infrastructure**  | `infra`                | File paths, git refs          | File discovery, git diff extraction, in-memory graph storage, worker pool orchestration | File lists, diffs, stored graph data            |
| **3. Analysis Engine** | `analyzer`             | Source files (8 languages)    | Language-specific parsing, unified capture extraction, scope resolution, graph building | Unified knowledge graph                         |
| **4. Intelligence**    | `intelligence`         | Knowledge graph, user queries | BM25+vector hybrid search, code review pipeline, BFS impact analysis, LSH deduplication | Search results, review comments, impact reports |
| **5. Service**         | `mcp`, `server`        | MCP tool calls, HTTP requests | MCP protocol (tools/resources/prompts/skills), Cypher query execution, REST endpoints   | Structured tool results, HTTP JSON responses    |
| **6. Integration**     | N/A (external)         | GitHub webhooks, CI pipelines | PR review automation, standards checks, report generation                               | PR comments, CI annotations                     |
| **7. Presentation**    | `cli`, `vscode`, `web` | User interactions             | VS Code sidebar, Copilot Chat participant, CLI commands, web dashboard                  | UI updates, chat responses, formatted output    |

---

## Package Dependency Graph

```
@code-analyzer/cli ──────────────────────�?
                                         �?
@code-analyzer/vscode ───────────────────�?
                                         �?
@code-analyzer/web ──────────────────────�?
                                         �?
@code-analyzer/mcp ──────────────────────�?
                                         �?
@code-analyzer/server ───────────────────�?
                                         �?
@code-analyzer/intelligence ─────────────�?
                                         �?
@code-analyzer/analyzer ─────────────────�?
                                         �?
@code-analyzer/infra ────────────────────�?
                                         �?
                              ┌──────────────────�?
                              �? @code-analyzer/   �?
                              �?     shared        �?
                              �?  (TypeScript      �?
                              �?   types only)     �?
                              └──────────────────�?
                                         �?
                              ┌──────────────────�?
                              �? @code-analyzer/   �?
                              �?     core          �?
                              �?  (Foundation)     �?
                              └──────────────────�?
```

All packages depend on `@code-analyzer/shared` for type definitions. `@code-analyzer/core` provides the foundation layer. Higher packages depend on lower packages in the stack.

---

## Knowledge Graph Schema

The knowledge graph is the heart of Code Analyzer. It models code as a typed property graph with 36 node types (entity labels) and 43 relationship types (edge semantics).

### 33 Node Types

| Category           | Node Labels                                                  | Description                                      |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| **Structural**     | `Project`, `Package`, `Folder`, `File`, `Module`             | Codebase organization hierarchy                  |
| **OOP Entities**   | `Class`, `Interface`, `Struct`, `Trait`, `Enum`, `TypeAlias` | Object-oriented type definitions                 |
| **Functions**      | `Function`, `Method`, `Constructor`                          | Executable code blocks                           |
| **Members**        | `Property`, `Variable`                                       | Data members and variables                       |
| **Infrastructure** | `Route`, `Component`, `Config`, `InfraResource`              | API routes, components, configuration            |
| **Process**        | `Process`, `Community`, `Tool`, `Test`                       | Business processes, community clusters, AI tools |
| **Documentation**  | `ADR`                                                        | Architecture Decision Records                    |
| **PDG**            | `BasicBlock`                                                 | Program Dependence Graph basic blocks            |
| **Cross-Repo**     | `CrossRepoFunction`, `CrossRepoInterface`, `CrossRepoModule` | External repository entities                     |
| **Data**           | `Contract`, `Event`, `DataSource`, `Sink`                    | Contracts, events, data flow                     |

### 39 Relationship Types

| Category                | Relationship Types                                                                                                                   | Semantics                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **Structural**          | `CONTAINS`, `DEFINES`, `HAS_METHOD`, `HAS_PROPERTY`, `MEMBER_OF`, `BELONGS_TO`                                                       | Code organization and hierarchy                |
| **Inheritance**         | `EXTENDS`, `IMPLEMENTS`, `METHOD_OVERRIDES`, `METHOD_IMPLEMENTS`                                                                     | Class/interface inheritance chains             |
| **Data & Control Flow** | `CALLS`, `IMPORTS`, `ACCESSES`, `INSTANTIATES`, `USES_TYPE`                                                                          | How code invokes and references other code     |
| **Architectural**       | `HANDLES_ROUTE`, `HANDLES_TOOL`, `EXPOSES`, `INJECTS`                                                                                | High-level architectural patterns              |
| **Analytical**          | `SIMILAR_TO`, `SEMANTICALLY_RELATED`, `TESTS`, `CHANGES_WITH`, `DATA_FLOWS`, `STEP_IN_PROCESS`                                       | Computed relationships from analysis           |
| **PDG**                 | `CFG`, `REACHING_DEF`, `TAINTED`, `SANITIZES`, `TAINT_PATH`                                                                          | Program dependence and security taint analysis |
| **Event**               | `EMITS`, `LISTENS_ON`                                                                                                                | Event-driven architecture patterns             |
| **Config**              | `CONFIGURES`                                                                                                                         | Configuration relationships                    |
| **Cross-Repo**          | `CROSS_REPO_DEPENDS`, `CROSS_REPO_CALLS`, `CROSS_REPO_IMPLEMENTS`, `CROSS_REPO_IMPORTS`, `CROSS_REPO_EXPOSES`, `CROSS_REPO_CONTRACT` | Multi-repository dependencies                  |

---

## 18-Phase DAG Pipeline

The analysis pipeline executes as a Directed Acyclic Graph (DAG) using Kahn's algorithm for topological sorting. Phases are executed in dependency order, with parallel phases running concurrently.

```
                    ┌─────────�?
                    �?  scan   �? (Phase 1)
                    └────┬────�?
           ┌─────────────┼─────────────�?
           �?             �?             �?
     ┌──────────�?  ┌──────────�?  ┌──────────�?
     �? structure �?  �? markdown �?  �?  config  �?
     �?(Phase 2)  �?  �?(Phase 4) �?  �?(Phase 5) �?
     └─────┬─────�?  └──────────�?  └──────────�?
           �?
           �?
     ┌──────────�?
     �?  parse   �? (Phase 3)
     └─────┬────�?
    ┌──────┼───────────────────�?
    �?      �?        �?     �?    �?
    �?      �?        �?     �?    �?
┌───────�? ┌───────�? ┌─────�? ┌────�? ┌─────�?
│crossF �? │scope  �? │routes�? │tools�? �? di  �?
�?(Ph 6) �? │Res(7) �? �?(Ph 8)�? �?(Ph9)�? �?(Ph10)�?
└───┬───�? └───┬───�? └──┬──�? └──┬─�? └──┬──�?
    �?         �?        �?       �?      �?
    �?         �?        �?       �?      �?
┌────────�? ┌────────�? �?       �?      �?
│communi-�? �? prune  �? �?       �?      �?
│ties(12)�? │Local(11)�? �?       �?      �?
└───┬────�? └───┬────�? �?       �?      �?
    �?          �?      �?       �?      �?
    �?     ┌────┴──────┴───────┴──────�?
    �?     �?         dump (Phase 15)  �?
    �?     └──┬───────────┬───────────�?
    �?        �?           �?
    �?        �?           �?
┌────────�? ┌────────�? ┌────────�?
│similarity�? │semantic�? �? embed  �?
�?(Ph 16) �? �?(Ph 17) �? �?(Ph 18) �?
└────────�? └────────�? └────────�?

Also depends on dump:
  - processes (Phase 13) �? scopeResolution + routes
  - tests (Phase 14) �? scopeResolution
```

### Phase Details

| Phase | ID                  | Dependencies                                                                    | Parallel | Description                                         |
| ----- | ------------------- | ------------------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| 1     | `scan`              | None                                                                            | No       | Discover source files in the project directory      |
| 2     | `structure`         | `scan`                                                                          | Yes      | Build directory hierarchy and module structure      |
| 3     | `parse`             | `scan`, `structure`                                                             | Yes      | Parse source files using language-specific parsers  |
| 4     | `markdown`          | `scan`                                                                          | Yes      | Process markdown and documentation files            |
| 5     | `config`            | `scan`                                                                          | Yes      | Process configuration files (JSON, YAML, TOML, ENV) |
| 6     | `crossFile`         | `parse`                                                                         | Yes      | Analyze cross-file dependencies and imports         |
| 7     | `scopeResolution`   | `parse`                                                                         | Yes      | Resolve scope trees and symbol references           |
| 8     | `routes`            | `parse`                                                                         | Yes      | Detect and catalog API route handlers               |
| 9     | `tools`             | `parse`                                                                         | Yes      | Detect AI agent tool definitions                    |
| 10    | `di`                | `parse`                                                                         | Yes      | Detect dependency injection patterns                |
| 11    | `pruneLocalSymbols` | `scopeResolution`                                                               | No       | Prune local-only symbols from the knowledge graph   |
| 12    | `communities`       | `crossFile`                                                                     | No       | Detect code communities and module clusters         |
| 13    | `processes`         | `scopeResolution`, `routes`                                                     | No       | Detect and catalog business process steps           |
| 14    | `tests`             | `scopeResolution`                                                               | Yes      | Detect test files and their code relationships      |
| 15    | `dump`              | `scopeResolution`, `routes`, `tools`, `di`, `communities`, `processes`, `tests` | No       | Serialize and dump the knowledge graph to storage   |
| 16    | `similarity`        | `dump`                                                                          | Yes      | Compute code similarity between files and functions |
| 17    | `semantic`          | `dump`                                                                          | No       | Perform semantic analysis on the knowledge graph    |
| 18    | `embed`             | `dump`                                                                          | Yes      | Generate vector embeddings for graph nodes          |

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
Git Diff �? [Plan] �? [Analyze] �? [Filter] �? [Relocate] �? Review Comments
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
    �?
    ├──────────────────────�?
    �?                      �?
┌─────────�?          ┌──────────────�?
�?  BM25   �?          �?   Vector     �?
�? Search  �?          �?   Search     �?
└────┬────�?          └──────┬───────�?
     �?                      �?
     └──────────┬───────────�?
                �?
     ┌──────────────────�?
     �? Reciprocal Rank  �?
     �?    Fusion (k=60) �?
     └────────┬─────────�?
              �?
     ┌──────────────────�?
     �?  Combined Results �?
     └──────────────────�?
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

### Tie-breaking, and why a ranking needs a total order

`search/ranking.ts` sorts every ranked list by score and then, on an exact tie, by the item's own name —
`qualifiedName`, `filePath`, `startLine`, `name`, and `id` last — compared by UTF-16 code unit rather than by a locale
collation.

**The reason is measurement, not tidiness.** BM25 over identical text is identical arithmetic, and `Array.prototype.sort`
is stable, so a tie used to be resolved by whatever order the directory walk had produced. The published retrieval
figure moved **0.9856 → 0.9815 from one machine to another** for exactly that reason, and the evaluation workflow found
it only because it compares a fresh run against the committed file. A benchmark whose value depends on `readdir` order
is not a benchmark. `id` is deliberately the last key and not the first: ids are assigned in insertion order, so an
id-based order would be the same machine dependence wearing a deterministic one's clothes.

---

## Cross-Repo Federation Design

Code Analyzer supports cross-repository analysis through a federation model:

```
┌──────────────�?     CROSS_REPO_CALLS     ┌──────────────�?
�?   Repo A      �? ◄─────────────────────�? �?   Repo B      �?
�? (Frontend)    �?                          �? (Backend)     �?
└──────────────�?                          └──────────────�?
       �?                                          �?
       �?  CROSS_REPO_CONTRACT                     �?
       └──────────────────────────────────────────�?
```

### Key Concepts

- **Repo Groups**: Collections of related repositories with defined roles (`primary`, `dependency`, `consumer`)
- **Contracts**: Formal API contracts between repositories (OpenAPI, GraphQL schemas, etc.)
- **Cross-Repo Edges**: Specialized relationship types prefixed with `CROSS_REPO_` for cross-repository dependencies
- **Contract Synchronization**: Automatic detection of contract violations across repository boundaries

### How a cross-repository dependency is resolved

Two shapes of import reach another checkout, and they are not the same problem:

| shape                           | example                                | resolved by                                       |
| ------------------------------- | -------------------------------------- | ------------------------------------------------- |
| a path that leaves the checkout | `import { z } from '../../shared/zod'` | the file path, as in a monorepo                   |
| **a package name**              | `from werkzeug.utils import redirect`  | the other checkout's **manifest**, then existence |

For the second shape the indexer reads what each repository publishes — `pyproject.toml` / `setup.py` /
`setup.cfg`, `package.json`, `pom.xml` / `build.gradle`, `go.mod`, `Cargo.toml` — and where its modules live, then
resolves the specifier to a file **only when that file exists**. A Python package is addressed by its **directory**
(`beautifulsoup4` is imported as `bs4`), because that is what the interpreter uses; the manifest decides whether the
repository publishes anything at all.

**A symbol is reachable wherever it is re-exported.** `from werkzeug import Request` is served by
`werkzeug/__init__.py`, not by the file that declares `Request`, so impact and trace follow the re-export chain before
they look for consumers. Edges carry what the statement asked for (`importedSymbols`), including `*` for a namespace
import (`import werkzeug` then `werkzeug.Request`).

Measured on flask 3.0.3 + werkzeug 3.0.3 in one workspace, against an answer key produced by Python's own parser:
**49 of 49 import pairs resolved, precision 1.0, trace 73/73, impact 49/49**
(`benchmarks/cross-repo-matrix.json`, produced by `.github/workflows/cross-repo-real.yml` and gated by
`scripts/cross-repo-gate.js`).

### Cross-Repo Tool Suite

Six dedicated MCP tools support cross-repo operations:

- `cross_repo_search` �? Search across multiple repositories
- `cross_repo_trace` �? Trace call paths across repositories
- `cross_repo_impact` �? Analyze cross-repo impact of changes
- `manage_repo_group` �? Manage repository groups
- `sync_contracts` �? Synchronize contracts across repos
- `discover_related_repos` �? Discover related repositories

**The two answering tools ask the measured engine first.** `cross_repo_trace` and `cross_repo_impact` used to walk
`CALLS` edges, which an import between two separately released packages does not create; on flask 3.0.3 + werkzeug
3.0.3 they returned nothing while `CrossRepoIndexer` returned 73 of 73 traces and 49 of 49 impacted files. Both now
call `traceSymbolDependencies` / `analyzeCrossRepoImpact` and carry `source` (`cross-repo-indexer` or `call-graph`) so
a caller can tell which of the two answered. A group registered through `manage_repo_group` lives in the process-wide
manager; `groupFor` copies it into the `ToolContextImpl` manager the engines were built against, which is the same
copy `cross_repo_review_pr` used to do on its own.

---

## Taint Analysis Across a Servlet

Story 9 asks one question: _what happens to the value an attacker controls after it arrives?_ The answer is a path
from a **source** (a request parameter, a cookie, a header) to a **sink** (a query, a file open, a process start, a
response write), and the engine that finds it is four layers deep:

| layer       | what it contributes                                                         | where                                                    |
| ----------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| capture     | every def and use the flow crosses, from the provider's parse               | `packages/analyzer/src/languages/java.ts`                |
| vocabulary  | what counts as a source, a sink and a sanitizer                             | `packages/analyzer/src/languages/java-taint.ts`          |
| facts       | the join between a statement, its bindings and the extracted source or sink | `packages/intelligence/src/cfg/statement-facts.ts`       |
| propagation | forward reachability over def→use, stopping at sanitizers                   | `packages/intelligence/src/security/taint-propagator.ts` |

**The vocabulary is per language, and that is not a detail.** `print` is a sink in a servlet — a response writer
writing to the page — and an ordinary call in Python and Ruby. The shared C-family list therefore stays what it was,
and `JAVA_TAINT_VOCABULARY` extends it; `TaintVocabulary` is the seam.

**A source is matched on what its list entry names.** `request.getParameter("p")` reaches the walk as
`request.getParameter`, and the receiver's declared type is not knowable from the call — `req`, `theRequest` and a
subclass all read the same thing — so a bare entry such as `getParameter` matches the callee's simple name. A
qualified entry such as `URL.Query` matches the callee's two-segment tail instead. **Matching both on the simple name
made Go's `db.Query(sql)` — a SQL sink — an HTTP source**, because `URL.Query` reduces to `Query` and so does every
other `.Query(...)` in every language; measured on the Go and C# accuracy fixtures, precision 1.00 → 0.67 and
1.00 → 0.75 with recall unchanged.

**Four capture defects made this feature unmeasurable, and each is a shape Java writes constantly:**

1. `fileName = dir + param;` — an `assignment_expression` recorded neither the binding it writes nor the use it
   reads, so taint could only cross a variable declared and passed on one line.
2. `new File(fileName)` — an `object_creation_expression` recorded nothing, and a path sink's argument is exactly
   what a creation expression holds.
3. `for (Cookie c : cookies)` — the loop variable was invisible, which broke the second arrow of every cookie vector.
4. A source on an assignment bound nothing, because the join looked for a _declaration_ on the source's line.

### The measurement

`.github/workflows/owasp-benchmark.yml` downloads **OWASP-Benchmark/BenchmarkJava at a pinned commit** — 2 740 labelled
servlet cases, 1 415 of them real vulnerabilities — runs the engine over every file, and scores the way the benchmark
itself scores: a case is flagged if the engine reports one live (unsanitised) flow in it, and the figure is
`TPR - FPR`. `scripts/owasp-benchmark-gate.js` holds each per-category figure to its floor.

| stage                                              | TPR    | FPR    | score  |
| -------------------------------------------------- | ------ | ------ | ------ |
| shared vocabulary only                             | 0.1420 | 0.0838 | 0.0583 |
| + servlet vocabulary                               | 0.2912 | 0.2264 | 0.0648 |
| + four capture defects, released                   | 0.2671 | 0.1955 | 0.0717 |
| + statements anchored to a line                    | 0.4530 | 0.3389 | 0.1141 |
| + definitions accumulate                           | 0.6382 | 0.4687 | 0.1695 |
| + rule families for the four non-flow axes         | 0.8177 | 0.3698 | 0.4479 |
| + a sink's destination decides its kind            | 0.8170 | 0.3042 | 0.5128 |
| + constant conditions and dead arms                | 0.8170 | 0.1306 | 0.6864 |
| + a callee's returns decide what a call hands back | 0.8170 | 0.1155 | 0.7015 |

The first three rows were measured on the 1.2beta checkout while the vocabulary and the captures were being fixed;
the last two are the v1.2 corpus the published figures come from, so the step from row three onward is the
comparable one. **TPR 0.2671 → 0.6382 and the score 0.0717 → 0.1695 came from two modelling decisions, not from
adding words to a list.**

**A statement is a line.** A call is one statement, but the first version recorded the callee on the line the call
starts and each argument on the line the argument sits on. The corpus is formatted by a tool that wraps long argument
lists, so `connection.prepareStatement(` on one line and `sql,` on the next put the sink and the value it consumes in
different statements, and the flow between them was never seen: 409 of the misses had a source and a sink in the same
function and no flow between them. Anchoring every name a statement reads to the statement's first line — the key the
CFG files facts under — moved TPR 0.2671 → 0.4530, with FPR rising 0.1955 → 0.3389 for the same reason the true
positives rose.

**A block that spans the function cannot claim a killing definition.** With one block and no branch structure, a
second assignment to a name was recorded as a `must`-definition, which kills the first — so
`param = request.getParameter(...)` followed by `if (param == null) param = "";` left nothing tainted, and that is the
corpus's most common three lines. Recording every definition as `may` moved TPR 0.4530 → 0.6382, FPR 0.3389 → 0.4687
and the score 0.1141 → 0.1695; per category, `sqli` 0.607 → 0.860 and `pathtraver` 0.602 → 0.835.

**A change that was measured and reverted, then done properly.** Anchoring sanitizer occurrences the same way moved
FPR 0.3389 → 0.2672 and TPR 0.4530 → 0.3703 — a net loss of 0.011 — because a sanitizer neutralised every sink kind
it met, so `encodeForHTML` vouched for a query it does not make safe. The fix was a schema change rather than an
experiment: a vocabulary entry is now `[name, category, kinds]`, because the category cannot be derived into kinds
(`escaping` covers HTML, SQL and LDAP at once), and the propagator asks three questions the first version could not —
is the sanitizer in the same statement, does it neutralise _this_ sink kind, and does its argument list name _this_
value. `parsedInt(getParameter("p"))` cannot carry a SQL fragment or a path onward, so the ten kinds a number
neutralises are listed separately from the two it cannot (`file_read`, `file_write` — a number is not a path).

**The four categories a flow analysis cannot answer are scored as misses, not excluded**: `crypto` and `hash` ask
which algorithm a constant names, `weakrand` whether the generator is predictable, and the cookie categories whether
a flag was set. Removing them would raise the headline by exactly the categories this engine cannot see.

**They are answered by rules instead, and the rules are the reason the score tripled.** `rule-families.ts` evaluates
four families over the same files: `new Random()` and `Math.random()`, `setSecure(false)` and the cookie
constructor, `MessageDigest.getInstance(...)` against a weak-algorithm set, and `Cipher.getInstance(...)` against weak
names _and_ weak modes — `AES/ECB/PKCS5Padding` names the strongest block cipher in the corpus and is still broken,
because ECB encrypts every block independently. Two of the four cannot be decided from the file at all: the corpus
selects its algorithm in `benchmark.properties` at run time, so `hashAlg1=MD5` is what makes 129 cases vulnerable and
`SHA-256` would make them safe. The rule family reads the configuration files from the index, resolves
`props.getProperty("hashAlg1", "MD5")` through locals and aliases, and reports the key and the value it resolved to.
Measured: **513 of 513 vulnerable cases across the four categories, at zero false positives**, and `score 0.1695 →
0.4479` overall.

**A `write` is not one sink, and the method name does not say which one it is.** `fw.write(x)` writes into a file
whose path was fixed when the writer was constructed; `response.getWriter().write(x)` writes into the page; `sb.append(x)`
writes into memory. All three reduce to the same name, so all three were scored as cross-site scripting — and 85 of the
490 false positives were exactly that, in safe `Crypto` cases that encrypt a request value and append the ciphertext to
a file. The destination is one statement away, in the variable's declared type, so `extractTaintSinks` filters `html`
sinks by it: a receiver constructed as a `FileWriter`, `BufferedWriter`, `StringBuilder` or one of six others is not a
response body. **An unknown receiver keeps its sink** — the filter is narrow on purpose, because a filter that guessed
would be a way to lose findings quietly. Measured: `score 0.4479 → 0.5128`, FPR 0.3698 → 0.3042, with `crypto`,
`hash`, `weakrand` and `securecookie` all at TPR 1.000 and FPR 0.

**What was left was precision in the flow half, and it was a reachability question.** 151 of the 403 remaining false
positives contained the corpus's constant-condition dead branch — `bar = (7 * 18) + num > 200 ? "constant" : param;`
with `num = 106` — which a single-block CFG cannot answer, and the same 151 appeared among the true positives with the
arms swapped. **Both directions have to be answered, which is what makes it a modelling question rather than a filter.**

**A constant folds to a value, and a name that holds one is not a definition.** `constant-expression.ts` evaluates an
expression's own text — arithmetic, comparison, a conditional, and the small set of string methods that are total
functions of their text — and `constant-fold.ts` reads one file's tree for the writes, `if`s, `switch`es and `return`s,
then solves them against each other until the dead lines stop growing. `packages/intelligence` reads the result as two
facts on a statement: a constant definition propagates nothing, and a line control cannot reach seeds nothing and
delivers nothing. It is a **textual** evaluator on purpose: the questions are closed, a visitor over the parse tree
would need a type checker to answer them, and every expression it cannot read returns `undefined` — which means
"assume the value flows", the direction a security tool must err in. Measured: `score 0.5128 → 0.6864`, FPR 0.3042 →
0.1306, **true positives unchanged at 1 156** — 403 false positives down to 173, with every category's TPR exactly where
it was and every category's FPR halved: `cmdi` 0.4480 → 0.1360, `ldapi` 0.5625 → 0.2812, `pathtraver` 0.6815 → 0.3185,
`sqli` 0.5129 → 0.2026, `trustbound` 0.6047 → 0.2326, `xpathi` 0.6500 → 0.1500, `xss` 0.3780 → 0.2105, and the flow
subset 0.5063 → 0.2173. **230 of the 403 false positives were the dead arm, and not one true positive was lost.**

**A `switch` is read the same way and in both grammars.** Java wraps a label in a `switch_label` node; JavaScript and
TypeScript hang it on the case as a field and spell `default` as a group of its own, so the reader takes the label's
_text_ and detects `default` from the group's type. Fall-through is the difficulty and the reason the model has to know
which arm leaves the switch: a `case` with no `break` runs into the next one, so every arm after the selected one stays
reachable until an arm jumps out. **Nothing is closed when the subject or a label cannot be folded** — the arm it names
may be the one that runs, and entering a fall-through chain in the middle makes everything after it reachable.

### What a call hands back

**`bar = helper(param)` was the corpus's largest remaining error, and the reason it was an error is that the question
was being asked in the wrong function.** The propagator reads the statement as "a name was read, a name was written" and
lets `bar` inherit `param` — sound, and useless in any codebase with a getter, a builder or an escaping wrapper between
the input and the sink. Whether the argument survives the call is a fact about the callee's body, and no amount of
caller-side reasoning can produce it.

`return-summary.ts` asks the callee, once, and the answer is per **argument position**: the caller passes argument 1, the
callee's argument 1 is whatever it declared second, and the position is the only handle the two agree on.
`BindingEntry.parameterIndex` exists for that alone — the older rule ("the parameters are on the signature's first
line") failed on every wrapped signature, and `doPost(HttpServletRequest request,\n HttpServletResponse response)`
returned no parameters at all.

Three things had to be true before any of it worked, and each was a defect that produced a plausible number:

1. **The def→use index has to be keyed by binding, not by statement.** Two parameters declared on one line share a
   statement index, so seeding `request` also delivered `param`'s uses and the summary answered for the wrong argument.
2. **The verdict has to be looked up by the binding carrying the value**, not by the binding the statement writes —
   the second is the caller's local, which no callee has a parameter for.
3. **"No" is only available when the value never vanished.** `map.put("k", param)` reads the value and writes nothing,
   and the collection hands it back through a `get` no def→use edge connects. The first version of the summary declared
   such arguments clean, and 104 real vulnerabilities went quiet. `lost` records the positions where a value
   disappeared into a call that writes no name, and a position with a loss cannot be answered negatively.

The same walk answers the other direction, and this one had never been connected at all: **a callee that reads the
input itself is a source for its caller.** `bar = helper(request)` passes a request object, not a tainted name, so
nothing on the caller's side can find the value; the summary names the categories the callee's own returns hand back,
and the pipeline seeds them where the call's result lands, carrying the callee's escapes with them. Measured on the
corpus: **no case in OWASP Benchmark has such a callee** — 809 functions, none of them — so this half is verified by
`callee-source-end-to-end.test.ts` rather than by a figure, and it is stated here as a capability with evidence rather
than as a score.

Measured: `score 0.6864 → 0.7015`, FPR 0.1306 → 0.1155, **true positives unchanged at 1 156**. Only `xss` moved —
0.2105 → 0.1148, 44 false positives down to 24 — because a helper that escapes and returns is the shape the corpus
writes for that category; in the other categories the helper either returns its argument or puts the value into a
collection, and the second is protected by the `lost` rule. The flow subset moved 0.4955 → 0.5206 (FPR 0.2173 →
0.1922) and the flow engine alone 0.3246 → 0.3397.

**What is left is the container.** 150 of the 153 remaining false positives put the value into a map, a `StringBuilder`
or an `Object[]` and take it out again, and no summary can answer that: the edge the value travels on is not a def→use
edge, it is a field of an object this model does not track. A container model is the next question, and it is a bigger
one than this — which is why the rule above exists rather than a guess.

## MCP Protocol Integration

The MCP server (`packages/mcp/src/server/mcp-server.ts`) implements the Model Context Protocol:

```
AI Agent (Claude, Cursor, Codex, etc.)
    �?
    �? MCP Protocol (JSON-RPC over stdio or HTTP/SSE)
    �?
┌─────────────────────────────────────────�?
�?           CodeAnalyzerMCPServer          �?
�?  ┌───────────────────────────────────�?  �?
�?  �?  Middleware Pipeline              �?  �?
�?  �?  Auth �? Rate Limit �? Execute     �?  �?
�?  └───────────────────────────────────�?  �?
�?  ┌─────────�? ┌──────────�? ┌─────────�?  �?
�?  �? Tools   �? │Resources �? �? Prompts �?  �?
�?  �? (38)    �? �? (15)     �? �? (5)     �?  �?
�?  └────┬────�? └────┬─────�? └────┬────�?  �?
�?       �?           �?            �?       �?
�?  ┌────▼───────────▼────────────▼─────�? �?
�?  �?        InMemoryGraphStore                �? �?
�?  �?  (In-Memory Knowledge Graph)      �? �?
�?  └───────────────────────────────────�? �?
└─────────────────────────────────────────�?
```

### Server Capabilities

- **Tools**: 49 tools with list-changed notifications
- **Resources**: 15 resources with subscribe and list-changed support
- **Prompts**: 5 reusable prompt templates with list-changed notifications
- **Logging**: Structured request logging with duration tracking
- **Transports**: stdio (default) and HTTP with SSE fallback

### Middleware Stack

| Middleware       | Description                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `AuthMiddleware` | API key validation via `x-api-key` or `Authorization: Bearer` headers                            |
| `RateLimiter`    | Token bucket algorithm with configurable capacity (default: 100) and refill rate (0.5 tokens/ms) |
| `RequestLogger`  | Structured logging with duration, error tracking, and statistics (last 1000 entries)             |

### Tool Profiles

Tools can be filtered by profile to limit exposure:

- **all**: All 49 tools (default)
- **analysis**: 28 query, review, and impact tools
- **scout**: Discovery-focused tools only

### Cypher Query Engine

The `packages/mcp/src/cypher/` directory implements a Cypher-like graph query language:

| Component     | Description                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `lexer.ts`    | Tokenizes Cypher queries into KEYWORD, IDENTIFIER, STRING, NUMBER, OPERATOR, and PUNCTUATION tokens |
| `parser.ts`   | Parses token streams into AST nodes (MATCH, WHERE, RETURN clauses)                                  |
| `planner.ts`  | Generates execution plans from parsed queries                                                       |
| `executor.ts` | Executes plans against the InMemoryGraphStore                                                       |

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

> **Note**: These are performance benchmarks from test measurements. Real-world performance varies by codebase size and language complexity.

| Metric             | Target          | Description                                            |
| ------------------ | --------------- | ------------------------------------------------------ |
| Indexing speed     | 1M LOC in <60s  | Worker thread pools with incremental parse caching     |
| Incremental update | <500ms per file | File watcher integration, re-index only changed files  |
| Graph queries      | <10ms per BFS   | Adjacency-list storage with source/target edge indices |
| Search latency     | <50ms BM25      | Inverted index with term frequency pre-computation     |
| Vector search      | <100ms          | Cosine similarity over pre-computed embeddings         |
| Memory per 1K LOC  | 3-5MB           | Language-dependent; TypeScript ~5MB, Python ~3MB       |

### Storage Design

The `InMemoryGraphStore` (`packages/infra/src/storage/in-memory-graph-store.ts`) uses in-memory Map-based storage with:

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

### What the index actually costs, phase by phase

The target in the table above is a target. This is the measurement, and it is **438 seconds per million lines** — seven
times the target, and still slower than the competitor figure this project quotes against itself. The number is
published because a target nobody has reached is only useful beside the distance to it.

| Corpus                                   | Lines   | Where         | Before                   | One tree per file       | One pass for taint     | Cursor walks               |
| ---------------------------------------- | ------- | ------------- | ------------------------ | ----------------------- | ---------------------- | -------------------------- |
| `packages/analyzer/src` (profile corpus) | 29 532  | workstation   | 30.4 s, 2.5 GB RSS       | 24.5 s, 1.26 GB RSS     | 19.9 s, 1.26 GB        | **14.3 s**                 |
| This repository's own `packages/`        | 141 387 | workstation   | 1028 s/M lines (144.8 s) | 805 s/M lines (113.6 s) | 596 s/M lines (84.2 s) | **438 s/M lines (62.0 s)** |
| This repository's own `packages/`        | 141 183 | GitHub runner | —                        | 606 s/M lines (85.7 s)  | (next run)             | (next run)                 |

**Every column is one machine's measurement, and the runner column is not comparable to the others** — a runner is not
a workstation, which is why the table keeps them apart rather than lining them up.

Six costs were removed, and each was found by profiling rather than by reading:

1. **A file was parsed five times.** `parse` built a tree to walk for captures; `extractImports` built one for imports;
   and `extractTaintSources`, `extractTaintSinks` and `extractSanitizers` each built their own and threw it away after
   one walk. The cache that was supposed to prevent this (`parsedFor`/`parsedTree`) was keyed on the _caller's_ source
   while `parse` had quietly parsed a **sanitised** copy, so its keys never matched and it saved nothing. Every reader
   now goes through one `cachedTree(source)`.
2. **Finding a symbol's container climbed `node.parent` once per capture.** In `node-tree-sitter` a parent call is a
   native round-trip that re-marshals the node, and forty methods in a class ask about the same class. **Measured at
   23 % of a full index — more than parsing the trees being asked about.** The climb is memoised per node range, and
   because the container of a node is the container of its parent, every intermediate step is remembered too.
3. **Every child of every node was fetched by index.** `childCount` plus `child(i)` crosses into native code once per
   child; the array getter crosses once and unmarshals the list in JS. 20 % of the index was that loop.
4. **The export walk descended the tree twice.** `exportedNames` found export statements with one recursion and then
   re-descended each of them with a second — 15.4 % of the index. It now reads the tree through a **cursor**, which
   reports `nodeType` and `nodeText` as plain values, and materialises nothing.
5. **Taint analysis walked the file three times.** Sources, sinks and neutralisers each had their own traversal, and
   each materialised every node to compare its type — 23 % of the index between them. The three questions name the same
   two node shapes, so there is one pass now (`collectCLikeTaint` → `scanTaint`), and it materialises nothing either.
6. **The capture and import walks materialised every node to compare its type.** A 700-line file holds about 6 000
   nodes and emits about 60 captures, so 99 % of that work was spent deciding not to look — **18 % of the index**
   between the two. Both read the tree through the same cursor now, and stop at a node only when its type is one the
   walk has something to say about: `captureTypes` for the TypeScript walk, a type test for imports.

**Every one of the cursor walks is cheaper because the cursor is the only part of the API that does not build nodes.**
Measured on 553 134 nodes of this repository's own TypeScript: children-array traversal 1004 ms, cursor traversal
reading only `nodeType` 217 ms. **A cursor that yields nodes is not the cheaper instrument** — the same walk written as
`gotoFirstChild` + `currentNode` took 2220 ms, twice the array cost, which is why all four passes above touch a node
only when a rule names its type.

What is left is the traversal itself: **walking the tree at all is now 24 % of the run**, and the parse phase has
stopped being the only large one — type resolution (3.7 s) and cross-file linkage (1.4 s) together are close to it
(6.3 s). The next lever is not in this section.

---

## Key Design Principles

1. **Strict layer isolation**: Each layer depends only on the layers below it. No upward dependencies.
2. **Shared type system**: `@code-analyzer/shared` defines all types �? the single source of truth for the entire platform.
3. **Interface-based abstraction**: `LanguageProvider`, `IInferenceEngine`, and other interfaces decouple implementations from consumers.
4. **DAG-based execution**: The pipeline uses Kahn's algorithm for deterministic, dependency-aware execution order.
5. **Functional core, imperative shell**: Pure functions for computation, classes for stateful coordination.
6. **Zero external API calls**: All processing is local �? code never leaves the machine.
7. **Progressive disclosure**: Public APIs export both high-level conveniences and low-level primitives.

---

## Design Decisions and Tradeoffs

| Decision                        | Rationale                                     | Tradeoff                                             |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| In-memory graph store (current) | Simpler implementation during alpha           | Data lost on restart; SQLite planned for persistence |
| Regex-based parsing             | Fast indexing without compiler frontends      | 95-99% accuracy vs 100% with full compilers          |
| BM25 + vector hybrid search     | Best of both worlds: exact keyword + semantic | Requires pre-computed embeddings                     |
| Kahn's algorithm for DAG        | Deterministic execution order                 | Must maintain explicit dependency declarations       |
| Snapshot-based transactions     | Simple rollback without write-ahead log       | Memory overhead for large graphs                     |
| Monorepo with Turborepo         | Shared types, coordinated releases            | More complex build orchestration                     |
| Stdio MCP transport             | Works with all MCP clients out of the box     | Limited to single-machine deployments                |

---

## Data Flow Through the System

```
Source Files (*.ts, *.py, *.go, ...)
    �?
    �?
[File Discoverer] ──�? DiscoveredFile[] (path, language, content, hash)
    �?
    �?
[Language Provider] ──�? UnifiedCapture[] (normalized across 8 languages)
    �?
    �?
[Scope Resolver] ──�? ResolvedReference[], ResolvedImport[]
    �?
    �?
[Graph Builder] ──�? KnowledgeGraph (36 node types, 43 relationship types)
    �?
    ├──�? [InMemoryGraphStore] (in-memory, adjacency-indexed)
    �?
    ├──�? [Hybrid Search] (BM25 + vector + RRF)
    �?
    ├──�? [Impact Analyzer] (BFS traversal over CALLS, IMPLEMENTS, etc.)
    �?
    ├──�? [Code Review Engine] (Plan �? Analyze �? Filter �? Relocate)
    �?
    ├──�? [Standards Engine] (regex + metric + ast-pattern checks)
    �?
    └──�? [MCP Server] (49 tools exposed to AI agents)
```
