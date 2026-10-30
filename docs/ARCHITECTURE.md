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

| stage                                                                      | TPR    | FPR    | score  |
| -------------------------------------------------------------------------- | ------ | ------ | ------ |
| shared vocabulary only                                                     | 0.1420 | 0.0838 | 0.0583 |
| + servlet vocabulary                                                       | 0.2912 | 0.2264 | 0.0648 |
| + four capture defects, released                                           | 0.2671 | 0.1955 | 0.0717 |
| + statements anchored to a line                                            | 0.4530 | 0.3389 | 0.1141 |
| + definitions accumulate                                                   | 0.6382 | 0.4687 | 0.1695 |
| + rule families for the four non-flow axes                                 | 0.8177 | 0.3698 | 0.4479 |
| + a sink's destination decides its kind                                    | 0.8170 | 0.3042 | 0.5128 |
| + constant conditions and dead arms                                        | 0.8170 | 0.1306 | 0.6864 |
| + a callee's returns decide what a call hands back                         | 0.8170 | 0.1155 | 0.7015 |
| + Spring's HTML escaper, and a suffix test that read `htmlUnescape` as one | 0.8170 | 0.1072 | 0.7098 |
| + what a container holds, at the point a statement reads it                | 0.8530 | 0.0302 | 0.8228 |
| + whether a statement keeps the value it computes                          | 0.8530 | 0.0015 | 0.8515 |
| + a declaration is a variable, and a name is not                           | 0.8530 | 0.0000 | 0.8530 |
| + a sink's name is part of the vocabulary                                  | 0.9258 | 0.0000 | 0.9258 |

The first three rows were measured on the 1.2beta checkout while the vocabulary and the captures were being fixed;
every row from `+ statements anchored to a line` onward is the v1.2 corpus the published figures come from, so the step
from row three onward is the comparable one. **TPR 0.2671 → 0.6382 and the score 0.0717 → 0.1695 came from two modelling decisions, not from
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

Then the vocabulary itself was wrong in two directions at once, and one commit answered both. `HtmlUtils.htmlEscape` —
Spring's escaper, and the one a Spring application reaches for — was absent, so eleven safe `xss` cases were charged for
escaping their own output. And the matcher tested `text.endsWith(name)` for every entry, which for a one-word entry is a
suffix test: the list holds `escape`, so **`htmlUnescape`, `unescape` and `jsonUnescape` all matched it** and a call that
puts the danger _back_ was read as removing it. Measured: `score 0.7015 → 0.7098`, FPR 0.1155 → 0.1072, `xss` alone
0.1148 → 0.0622 (24 → 13 false positives), 1 156 true positives before and after. The suffix rule's own delta on this
corpus is zero — no case here reaches a sink through an `unescape` — so it is fixed for the reason it is wrong rather
than for the figure it moves, and held by a test that asserts the list does not contain `htmlUnescape`.

### What a container holds

**The 141 false positives that were left were one shape, and no summary can answer it.** `map.put("keyB", param)`
followed by `bar = map.get("keyB")` is two statements that read `map` and write `bar`, and the value travels on
something that is not a def→use edge: a slot inside an object. 79 of the 141 went through `map.put`/`get` and 62
through `list.add`/`get`. The list half is harder, because the corpus shuffles the value before reading it —
`add("safe")`, `add(param)`, `add("moresafe")`, `remove(0)`, `get(1)` — so the question is not what the collection
holds but what the position holds.

**A container read is turned back into a def→use edge, which is why nothing downstream had to change.**
`packages/intelligence/src/cfg/container-flow.ts` walks one function's statements in order and keeps, per receiver, a
map from literal key to the set of bindings written under it. When a statement reads a key, that slot's writers are
added to the statement's **uses**, so `bar = map.get("keyB")` becomes an edge from `param` to `bar`; reaching
definitions, the propagator and the return summary then see an ordinary flow and need to know nothing about
containers. What the model contributes is not a second propagator but the edge the capture layer could not draw — the
one fact it lacked was which literal key a `get` asked for, which no `METHOD_CALL` capture carries.

**The guarantee is stated, and it is what makes the answer usable rather than merely sound:**

> A container whose every access in this function is a call on a binding, with literal keys throughout, holds exactly
> the values written under those keys.

"Read `keyA` and you cannot receive what was written under `keyB`" follows from it, which is why a resolved read can
give a **negative** answer at all. `ReturnSummary.lost` — added one iteration earlier so that a value vanishing into
`map.put` could refuse to answer — now has a positive answer to give instead: `containerFollowed` names the writes the
model followed, and a lost argument whose value is in that set stops being treated as vanished.

**Everything outside the guarantee degrades, and each degradation has a direction of its own:**

| shape                                                                     | answer                                              | why                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `map.put(key, param)` with a runtime key                                  | `unknown`: every read of that container receives it | the key has no slot this model can name, and the value is in there |
| a position op and a read in different branches                            | reads fall back to the whole container              | the op may not have run, so an index means nothing                 |
| a removal under a runtime key, or outside the range it counted            | positions become unreliable                         | the shift is real and this model cannot compute it                 |
| a method the table gives no meaning to                                    | its arguments are absorbed into `unknown`           | it may have mutated the container; "escaped" is a different claim  |
| the container is returned, or passed to a call that is not one of its own | nothing is followed                                 | everything past that point is code this model does not see         |

**Three things had to be right before a single case moved, and each was wrong first:**

1. **`CONTAINER_OPERATIONS` cannot be an object literal.** `toString` is a method a builder has and also a property of
   `Object.prototype`, so a `Record<string, ContainerOperation>` literal that lists it _overrides_
   `Object.prototype.toString`, its `role` widens to `string` and the literal stops compiling — and
   `'toString' in table` answers `true` for four names no container has. A `Map` has neither problem.
2. **The key's shape decides a container's kind, not the method name.** `get` is `Map.get` and `List.get`; `set` is
   `Map.set` and `List.set`. `get(0)` is a position and `get("keyA")` is a key, and `add`/`append` are the only calls
   that settle it alone, because they name no key at all.
3. **A method the table does not know is a mutation, not an escape.** `b.replace(lo, hi, "Chars")` is in no table and
   is still a call on the builder; reading it as the builder leaving the function made every `StringBuilder` chain in
   the corpus unfollowable and left 16 false positives exactly where they were. Absorbing its arguments into `unknown`
   is the claim the evidence supports.

**And one state was added and then deleted, because it described nothing.** The first version carried `exact`/`partial`
per container — whether every read had been answered by a slot — and gated `followed` on it. Measured against the
corpus, "followed needs every read exact" and "followed needs only that the container never escaped" produce
**identical figures, case for case** (1 207 true and 40 false positives both ways): a read answered with the whole
container hands the statement every name in it, so the value's exits are def→use edges either way. The stricter state
was removed rather than kept for its look, because a condition no case can distinguish is a condition nobody can test.

Measured: `score 0.7098 → 0.8228`, FPR `0.1072 → 0.0302`, and **true positives rose too** — 1 156 → 1 207, which
nothing since the rule families had managed: the four changes before this one moved noise and left the 1 156 where they
were. Set difference over the 2 740 cases: **102 left the false-positive set, 0 entered it, no true positive was lost
and 51 were gained.** Every category's FPR fell except `xpathi`, which did not move at all — `trustbound` 0.2326 →
0.0000, `ldapi` 0.2812 → 0.0312, `pathtraver` 0.3185 → 0.1037, `sqli` 0.2026 → 0.0517, `cmdi` 0.1360 → 0.0480, `xss`
0.0622 → 0.0191. The seven-category subset moved 0.5345 → 0.7192 and the flow engine alone 0.3480 → 0.4603.

**What is left is 40 false positives, and 38 of them are one shape that is not about containers.** The helper ends

```java
String g14546 = "barbarians_at_the_gate";              // deliberately static: the whole flow is "safe"
String bar = thing.doSomething(g14546);                // an interface call on a factory-made object
return bar;
```

so the value that reaches the sink is a **constant**, and the engine reports the flow anyway. The mechanism was located
by three variants of one case rather than by reading the code: replacing the argument with the same literal keeps the
finding, replacing the call with `String bar = g14546;` removes it, and replacing the return with the constant removes
it too. **So the verdict that carries the value is the summary's `carry`, given because the return reads a name whose
definition is a call this repository cannot resolve** — and `carry` is the answer the summary must give when it cannot
see. 17 of the 38 put that helper inside an embedded `class Test` and 21 in a static method; the remaining 2 cases are
`BenchmarkTest01479` and `BenchmarkTest02370`, which are not this shape.

That is the next question, and it is a question about what an **unresolved call's result** may be assumed to contain: a
callee cannot reach the caller's locals except through its arguments, so the honest answer for `thing.doSomething(x)`
with no body to read is "whatever `x` and `thing` carry" rather than "unknown, therefore carry". Nothing about it is a
container.

### Whether a statement keeps the value it computes

**The 38 turned out not to need a new model of calls. They needed one bit about statements, and the previous iteration's
own comment had already named the symptom without following it: the value was "carried" because the return read a name
whose definition could not be resolved — but the taint never reached that return, and the summary had said so.** What it
also said was `lost`, and `lost` blocked the negative answer.

`ReturnSummary.lost` exists for one reason: a value that vanishes into a call which writes no name may come back through
a side effect that no def→use edge records, so a callee must refuse to say "no". It was recorded wherever a walk reached
a line that has no definition — and **that is not the same thing**. In

```java
String e = new String(Base64.decodeBase64(Base64.encodeBase64(d.getBytes())));
```

`d` is read on a line of its own, three times, and none of those lines writes a name. The value is not lost: the
statement it belongs to keeps the result in `e`, and the walk reaches `e` from the same definition. Recording those
lines as losses made every nested call in the corpus's copy-wrap-cut chains a "cannot say", and a "cannot say" is exactly
what a false positive is made of.

**The bit that separates the two is whether the statement keeps what it computes**, and it is read from the tree the way
the branch ranges are: a statement node whose first child is an assignment writes that child's value somewhere, and one
whose first child is anything else evaluates it and drops it. `map.put("k", param);` keeps nothing; `bar = ...` keeps
`bar`. `analyzer/src/languages/regions.ts` produces the ranges, `FunctionCfg.discardedValueRegions` carries them, and
`summarizeReturns` records a loss only inside them.

| the file says                                                | a value that reaches a line with no definition of its own is              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| the line is inside a discarded statement                     | lost — a side effect may hand it back, so no callee may be answered for   |
| the line is inside a statement that keeps its value          | not lost — the value travelled, and the name it landed in carries it      |
| nothing (`undefined`: the grammar could not read the shapes) | lost — the conservative answer, and the one given before the fact existed |

**The `undefined` row is the one that keeps this honest.** Every language this project reads but Java, JavaScript,
TypeScript and Python has no `ConstantDialect` at all, so it answers `null` and keeps the conservative behaviour it had:
a fact that is absent must not read as "nothing is ever lost". Inside the four that do declare it, `[]` is a real answer
— a file where no statement throws a value away — and `undefined` is a gap.

Measured: `score 0.8228 → 0.8515`, FPR `0.0302 → 0.0015`, **true positives unchanged at 1 207**. Set difference over the
2 740 cases: **38 left the false-positive set, none entered it, none were lost.** Ten of the eleven categories are now
at FPR 0.0000 — `cmdi`, `ldapi`, `pathtraver`, `sqli`, `trustbound` and `xss` all went to zero, `crypto`, `hash`,
`securecookie` and `weakrand` were already there, and `xpathi` is the only one that still reports.

**Deleting `lost` entirely measures the same figures**, which is stated because it is the obvious objection: FPR 0.0015
and TPR 0.8530 either way, so nothing in this corpus depends on the guard. It is kept because the guard is right and the
corpus does not contain the shape that needs it — a value handed to a call that keeps nothing, followed by a return the
file cannot decide. `discarded-value-end-to-end.test.ts` holds both halves: that shape reports (the guard is doing its
job), and the same shape with a return the file _does_ decide does not (the constant-return rule answering first).

**The remaining 2 are not this shape and not a container either, and the guess made here was wrong.** They were
described as a block problem — a name written inside a loop does not kill an earlier write of the same name, and a
single-block CFG makes every write in a loop a `may`-definition. The first half is true and it is not the defect:
`String value = values[i]` in one loop and `Element value = nodeList.item(i)` in the next are not two definitions of one
binding, they are two binding*s*. See [A name is not a variable](#a-name-is-not-a-variable).

### A name is not a variable

**The corpus's last two false positives were not about blocks, and the block theory was testable in a minute.** Building
one CFG for `BenchmarkTest01479` and printing the `value` bindings showed a single binding declared on line 51 and a
second definition on line 85 reaching a use on line 86 — and `String value = values[i]` and `Element value =
nodeList.item(i)` are not the same variable, whatever a def→use graph keyed by spelling says. The two loops are siblings,
neither scope contains the other, and a name is not a variable.

The model is one table entry and one rule:

| question                          | answer                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| which regions are a name scope?   | `ConstantDialect.scopeTypes` — Java's block, both loop forms, `catch`, resource declarations, `switch` body  |
| which variable does a write mean? | the innermost existing binding of that name whose scope contains the write, if any; otherwise a new variable |
| which variable does a read mean?  | the innermost binding of that name whose scope contains the read, else the outermost                         |

**The "if any" is where the difficulty is, and the first attempt at it was measured and thrown away.** The capture
vocabulary spells a declaration and an assignment the same way — `String param = "x";` and `param = decode(...)` are both
`variable.def`, because the analysis needs both as definitions — so keying a binding by `(name, scope)` turned every
assignment into a declaration: 15 bindings became 20 in one file, each variable was split into one binding per block it
was written in, and the corpus lost **503 of its 1 207 true positives** while driving FPR to zero. A precision change
that buys its figure with recall is the one trade this project refuses, and the run said so in one sentence: `TP 706`.

What replaced it is containment rather than identity. A write inside the scope of an existing variable of the same name
is not a new variable — a language that allows it does not have block scope — so the write joins it; only a write in a
scope the existing one does not contain begins a new variable. That single asymmetry separates the corpus's two loops
(disjoint, so two variables) and keeps every assignment inside a `try` attached to the name the `try` is inside (nested,
so one).

| grammar                                        | scopes it declares              | why                                                                                                          |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Java, and the C family's block-scoped grammars | block, loops, `catch`, `switch` | every declaration in them is block-scoped, so a nested one is impossible and a sibling one is a new variable |
| Python                                         | none                            | an assignment inside an `if` writes the function's variable; block scopes would cut flows                    |
| JavaScript, TypeScript                         | none                            | `var` is function-scoped and `let` is not, and the grammar answers one vocabulary for both                   |
| JSON, YAML, and every grammar with no dialect  | `null`                          | there are no names to scope                                                                                  |

Measured: `score 0.8515 → 0.8530`, FPR `0.0015 → 0.0000`, **true positives unchanged at 1 207**. Set difference over the
2 740 cases: **2 left the false-positive set, none entered it, none were lost.** Every one of the eleven categories is
now at FPR 0.0000 — the first time this engine reports no safe case in the corpus — and the gate's ceilings moved from
"one safe case of slack" to "one safe case of slack from zero" for all of them: `overall.fpr ≤ 0.0008`, `xpathi.fpr ≤
0.05`, and not one of them zero, because a ceiling of zero fails the build the first time the engine answers a case the
corpus labels safe.

`shadowed-name-end-to-end.test.ts` holds the pair that matters: the two-loop file with the sink reading its own loop's
declaration reports nothing, the same file with the sink moved into the loop that read the request reports — one line
moved, opposite answers — and a single declaration read in two sibling loops still reports, which is the shape every
real vulnerability of this kind is written in.

### A sink's name is part of the vocabulary

**A flow that reaches no name the engine calls a sink is a vulnerability the engine cannot report, however correct its
model is.** The corpus's next 105 silent cases split across seven categories, and the two largest groups were not
modelling failures at all: the source was extracted, the helper was followed, the value was carried through a container
and the path was built — and then the last call in the chain was a method name that `JAVA_SINKS` did not list.

| missing name(s)                                                                                  | whose call it is                                            | cases recovered |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------- |
| `printf`                                                                                         | `PrintWriter`, which is what `response.getWriter()` returns | 51 (`xss`)      |
| `queryForRowSet`, `queryForList`, `queryForMap`, `queryForObject`, `queryForLong`, `batchUpdate` | Spring's `JdbcTemplate`                                     | 52 (`sqli`)     |

**The first one is a hole with no defence, because `printf` is the same call as `print`.** `print`, `println` and
`write` were all in the table: a servlet writing into the response body is cross-site scripting whatever the spelling.
`printf(format, args)` writes the same body through a different method name, the destination filter that separates a
`FileWriter` from a `PrintWriter` had already answered for the receiver, and the format string is not a neutraliser —
so the only thing that stood between the engine and 51 real findings was a missing row. A vocabulary that models the
destination and then omits a name is measuring its own list, not the code.

**The second one is a fork that lost an entry.** `query` was in the shared C-family list from the beginning, and the
Java table is _appended_ to it — but the corpus's SQL cases do not call `query`: they call the `JdbcTemplate` family,
which is the Spring API for the same act and which no shared list could know about. Six entries were added and `query`
was deliberately not repeated, because an entry listed twice is two spellings of one answer and the second one can
never be the one that fires.

| figure           | before | after  | true positives | false positives |
| ---------------- | ------ | ------ | -------------- | --------------- |
| `overall`        | 0.8530 | 0.9258 | 1 207 → 1 310  | 0 → 0           |
| `taintSubset`    | 0.7694 | 0.8836 | 694 → 797      | 0 → 0           |
| `xss`            | 0.6869 | 0.8943 | 169 → 220      | 0 → 0           |
| `sqli`           | 0.7463 | 0.9375 | 203 → 255      | 0 → 0           |
| `flows` (engine) | 0.4905 | 0.5633 | 694 → 797      | 0 → 0           |
| `rules` (engine) | 0.3625 | 0.3625 | 513 → 513      | 0 → 0           |

**No figure in the two directions moved the wrong way, and that is the whole claim.** Adding names to a sink list is the
cheapest way to buy recall and the fastest way to lose precision — every new name is a new place a value can be
reported — so the pair (TPR up, FPR flat at zero) is what makes this a vocabulary fix rather than a detector that
started guessing. It is also why the two families are held by separate category floors: `xss.tpr ≥ 0.8942` and
`sqli.tpr ≥ 0.9374` mean one of them cannot be undone while the other's figure hides it.

`sink-vocabulary-end-to-end.test.ts` holds both directions through the provider rather than the list: a value that
reaches `response.getWriter().printf(param)` is reported as `html`, the same call with a constant format string
argument reports nothing, `JDBCtemplate.queryForRowSet(sql)` is reported as `sql_exec`, three more `JdbcTemplate`
spellings are reported through their own files, and a constant SQL string reports nothing. **The test was verified by
deleting the entry it depends on**: with `printf` removed, exactly the first case fails and the other four pass, which
is the difference between a suite that asserts a list and one that asserts a behaviour.

**What remains is 105 cases and no shared cause**: `cmdi` 32, `xss` 26, `sqli` 17, `pathtraver` 15, `trustbound` 11,
`ldapi` 3, `xpathi` 1. The largest group is not another missing word — it is `new ProcessBuilder().command(argList)`
followed by `.start()`, where the command is handed over as a **list** and the current model follows a value into a
container but not into an argument the container is built from. That is a modelling question of the kind the last four
sections were about, and it is the next one to answer.

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
