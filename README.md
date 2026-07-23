# Code Analyzer

> **Experimental code intelligence platform (Alpha).** Understand, search, and review code at depth — powered by an MCP server for AI agents, a VS Code extension with Copilot Chat integration, and a standalone CLI.

[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)](https://github.com/AgentiX-E/code-analyzer)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://github.com/AgentiX-E/code-analyzer/actions)
[![Docs](https://img.shields.io/badge/docs-getting--started-blue)](docs/getting-started.md)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Current Status

> **Alpha — Active Development** · Core architecture is established. Most analysis and intelligence features are in development.

Code Analyzer is in an early alpha stage. The architecture, shared type system, package structure, and MCP server framework are in place and well-tested. However, the analysis pipeline phases, intelligence layer features, and many MCP tool implementations are currently returning placeholder data. The project is approximately 30-40% complete; the sections below describe the target architecture and planned capabilities.

### Feature Implementation Status

| Feature Area | Status | Notes |
|---|---|---|
| Foundation layer (core types, config, logging, errors, i18n) | ✅ Implemented | Solid, well-tested foundation |
| Infrastructure layer (file discovery, git ops, worker pool) | ✅ Implemented | In-memory store; SQLite persistence is planned |
| Analysis pipeline framework (18-phase DAG orchestrator) | ✅ Implemented | Orchestrator and DAG logic complete; all phases return placeholder data |
| Language providers (TS, JS, Python, Go, Java, Kotlin, C#, Rust) | ⚠️ Partial | Scaffolding in place; regex-based parsing stubs only |
| Scope resolution & graph building | ⚠️ Partial | Types and interfaces defined; implementations returning zero results |
| Hybrid search (BM25 + vector) | ⚠️ Partial | BM25 component functional on in-memory store; vector search is a stub |
| Code review engine | ⚠️ Partial | Heuristic rules implemented; LLM integration is planned |
| MCP server (38 tools, 15 resources, 5 prompts) | ⚠️ Partial | Framework complete; most tools return placeholder/empty data |
| Cypher query engine | ✅ Implemented | Lexer, parser, planner, executor all functional |
| Impact analysis & blast radius | ⬜ Planned | Types and interfaces defined |
| Standards engine (10 templates) | ⬜ Planned | Architecture designed; rule execution is a stub |
| Embeddings & semantic analysis | ⬜ Planned | Mock embedding provider only |
| Cross-repo federation | ⬜ Planned | Tool definitions exist; no execution logic |
| PDG & taint analysis | ⬜ Planned | Stub implementations only |
| VS Code extension (sidebar, Copilot Chat, annotations) | ⬜ Planned | Package structure exists; UI not implemented |
| Web UI | ⬜ Planned | Package scaffold only |
| CLI commands | ⬜ Planned | Entry point exists; commands not implemented |
| Incremental indexing & caching | ⬜ Planned | Cache infrastructure ready; not wired in |
| CI/CD integrations | ⬜ Planned | Workflow files created; not tested end-to-end |

### What Works Today

- **Package architecture**: 10-package pnpm monorepo with Turborepo, strict layering, shared type system
- **Foundation layer**: Config loading/validation, structured logging, error taxonomy, i18n, lifecycle management, metrics collection
- **Infrastructure layer**: File discovery, file watcher, git operations (diff, history), worker pool with circuit breaker, parse cache, in-memory graph store with FTS, BFS, transactions, and integrity validation
- **MCP server framework**: Tool registry, middleware (auth, rate limiting, request logging), transport layer (stdio + HTTP), Cypher query engine, skill installer, resources, prompts
- **Pipeline orchestrator**: Kahn's algorithm-based DAG execution, dependency-aware phase skipping, context threading
- **Test suite**: Comprehensive unit tests for core, infra, analyzer, and MCP packages

### What is Under Development

The next phase of development focuses on implementing the actual analysis logic in the pipeline phases, building out the intelligence layer (search, review, impact), connecting real parsing to the language providers, and adding SQLite persistence.

---

## Overview

**Code Analyzer** aims to transform raw source code into a structured knowledge graph with 33 entity types and 39 relationship types, enabling deep semantic queries, call-graph tracing, architecture analysis, and AI-assisted code review. It runs entirely locally — your code never leaves your machine.

**Who is this for?**
- **AI agents and coding assistants** that need deep code intelligence via MCP
- **Developers** who want to understand large, unfamiliar codebases quickly
- **Platform teams** that need automated PR review and standards enforcement in CI/CD
- **Architects** analyzing dependency graphs, hotspot detection, and codebase health

---

## Architecture

Code Analyzer follows a strict **seven-layer architecture**. Each layer depends only on the layers below it, ensuring clean separation of concerns and independent testability.

```
Layer 7: Presentation    ← VS Code Extension, Web UI, CLI
Layer 6: Integration     ← GitHub Actions, Custom Adapters
Layer 5: Service         ← MCP Server (stdio/HTTP), REST API, WebSocket
Layer 4: Intelligence    ← Search, Embeddings, Code Review, Impact Analysis
Layer 3: Analysis Engine ← Pipeline, Parsing, Resolution, Graph Building
Layer 2: Infrastructure  ← Storage, Git, File System, Worker Pool
Layer 1: Foundation      ← Core Types, Config, Logging, Errors, I18n
```

**What flows through each layer:**

| Layer | Input | Processing | Output |
|-------|-------|------------|--------|
| **1. Foundation** | Raw config files, env vars | Configuration loading, error taxonomy, structured logging, i18n strings | Typed configs, localized messages, metrics collectors |
| **2. Infrastructure** | File paths, git refs | File discovery, git diff extraction, storage, worker thread orchestration | File lists, diffs, stored graph data, computed results |
| **3. Analysis Engine** | Source files (8 languages) | Language-specific parsing, unified capture extraction, scope resolution, graph edge building | Unified knowledge graph (33 entity types × 39 relationship types) |
| **4. Intelligence** | Knowledge graph, user queries | BM25 + vector hybrid search, PR diff review pipeline, impact analysis via graph traversal, LSH deduplication | Search results, review comments, impact reports, recommendations |
| **5. Service** | MCP tool calls, HTTP requests | MCP protocol (tools/resources/prompts/skills), Cypher query execution, REST endpoints, WebSocket events | Structured tool results, HTTP JSON responses, real-time updates |
| **6. Integration** | GitHub webhooks, CI pipelines | PR review automation, standards checks, report generation in CI workflows | PR comments, CI annotations, status checks |
| **7. Presentation** | User interactions | VS Code sidebar views, Copilot Chat participant, in-editor annotations, CLI commands, web dashboard | UI updates, chat responses, formatted output, visual graphs |

---

## Features

### Deep Code Understanding
- **Multi-language graph**: Aims to index 8 languages (TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust) into a unified knowledge graph with 33 entity types (functions, classes, interfaces, routes, decorators, etc.) and 39 relationship types (calls, inherits, implements, imports, decorates, etc.)
- **Call graph tracing**: Aims to follow function calls across files, packages, and services — trace a request from a REST endpoint down to the database query
- **Scope-aware resolution**: Language-agnostic symbol resolution engine with type inference across lexical scopes
- **Architecture analysis**: Planned community detection (Louvain algorithm), hotspot identification via graph centrality, and dependency mapping across module boundaries
- **Unified parser**: Single `UnifiedCapture` format normalizes all 8 languages into a common representation for graph building and cross-language queries

### AI-Ready Intelligence
- **MCP Server**: Framework complete with 38 tool definitions for AI coding agents (Claude, Cursor, Codex, etc.) with stdio and HTTP transports, plus resources, prompts, and installable skills. Many tool implementations currently return placeholder data; see [docs/MCP-SERVER.md](docs/MCP-SERVER.md) for per-tool status.
- **Copilot Chat Participant**: Planned VS Code integration using `@code-analyzer` — ask questions about your codebase in natural language
- **Code Review Engine**: Heuristic-based review pipeline (Plan → Analyze → Filter → Relocate) with extensible review rules. LLM integration is planned for deeper semantic analysis. See [docs/CODE-REVIEW.md](docs/CODE-REVIEW.md).
- **Semantic Search**: Planned hybrid BM25 + vector search powered by code-aware embeddings — find semantically similar code even when naming conventions differ
- **Impact Analysis**: Planned graph-based change detection — see what files, functions, and services are affected before you make a change
- **Standards Engine**: Architecture designed with 10 built-in templates planned for TypeScript, Python, and general best practices, plus custom standards via YAML config
- **Cypher Query**: Functional graph query language support for power users — `MATCH (f:Function)-[:CALLS]->(t:Function) RETURN f, t`

### Planned Performance

Code Analyzer is designed with performance in mind at every layer. The architecture targets the following benchmarks — these are design targets from the automated test suite and are not yet verified on real-world repositories:

| Operation | Data Size | Target (P99) | Category | Notes |
|-----------|-----------|------------|----------|-------|
| Node insert | 10,000 nodes | < 200 ms | Write | Batch insert with indexing |
| Edge insert | 20,000 edges | < 300 ms | Write | Bulk edge creation |
| Filtered query | 10K pool, 100 results | < 100 ms | Read | Label-filtered with pagination |
| Edge traversal | 1K nodes, dense graph | < 5 ms | Read | Adjacency-list index lookup |
| BFS depth 3 | 1,000 nodes, 3 edges/node | < 10 ms | Traversal | Path-finding use case |
| FTS search | 10,000 nodes | < 250 ms | Read | BM25 ranking |
| Cascading delete | 1K nodes, dense graph | < 5 ms | Write | Node + cascading edge deletion |
| Transaction rollback | 1,000 inserts | < 50 ms | Write | Atomicity with state restore |
| Integrity check | 10K nodes + 20K edges | < 100 ms | Read | Full graph validation |

> **Note**: These benchmarks reflect operations on the in-memory store with synthetic data from unit tests. Real-world performance with actual repository parsing, persistent SQLite storage, and the full analysis pipeline has not yet been measured.

#### Performance Architecture
- **Zero data egress**: All processing happens locally — your code never leaves your machine
- **Worker thread pool**: Planned parallel parsing across all CPU cores with automatic load balancing
- **WAL mode**: Planned concurrent reads during writes (when SQLite persistence is implemented)
- **FTS5 indexing**: Planned tokenized full-text search with BM25 ranking
- **Adjacency-list storage**: Edge lookups target O(1) index seeks
- **Circuit breaker**: Worker pool resilience with automatic retry and graceful degradation

### Flexible Deployment
- **MCP Server**: stdio or HTTP transport for any MCP-compatible agent (Claude Desktop, Cursor, Continue, etc.)
- **VS Code Extension**: Planned full sidebar, inline annotations, status bar indicators, and Copilot Chat integration
- **CLI**: Planned command-line interface for scripting and CI/CD pipelines
- **CI/CD**: Planned GitHub Actions integration for automated PR review and standards enforcement
- **REST API**: Planned HTTP server for custom integrations and dashboards

---

## Quick Start

### Option 1 — CLI Installation (recommended)

```bash
# Install globally
npm install -g @code-analyzer/cli

# Index a repository
code-analyzer analyze ./my-project

# Search the knowledge graph
code-analyzer search "authentication flow" --repo ./my-project
```

### Option 2 — npx (no install)

```bash
# One-shot analysis without global install
npx @code-analyzer/cli analyze --repo ./my-project
```

### Option 3 — MCP Server Setup

Add to your AI agent's MCP configuration (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

The MCP server exposes 38 tool definitions — currently, the Cypher query engine and search tools are functional on in-memory data, while review, impact, reporting, and cross-repo tools return placeholder data. See [docs/MCP-SERVER.md](docs/MCP-SERVER.md) for detailed per-tool status.

### Option 4 — Build from Source

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer

# Install dependencies (requires pnpm >= 9)
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

---

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@code-analyzer/cli` | [![npm](https://img.shields.io/npm/v/@code-analyzer/cli)](https://npmjs.com/@code-analyzer/cli) | CLI entry point |
| `@code-analyzer/mcp` | [![npm](https://img.shields.io/npm/v/@code-analyzer/mcp)](https://npmjs.com/@code-analyzer/mcp) | MCP server |
| `@code-analyzer/server` | [![npm](https://img.shields.io/npm/v/@code-analyzer/server)](https://npmjs.com/@code-analyzer/server) | HTTP REST API |
| `@code-analyzer/analyzer` | [![npm](https://img.shields.io/npm/v/@code-analyzer/analyzer)](https://npmjs.com/@code-analyzer/analyzer) | Analysis engine |
| `@code-analyzer/intelligence` | [![npm](https://img.shields.io/npm/v/@code-analyzer/intelligence)](https://npmjs.com/@code-analyzer/intelligence) | Search and review |
| `@code-analyzer/infra` | [![npm](https://img.shields.io/npm/v/@code-analyzer/infra)](https://npmjs.com/@code-analyzer/infra) | Infrastructure |
| `@code-analyzer/core` | [![npm](https://img.shields.io/npm/v/@code-analyzer/core)](https://npmjs.com/@code-analyzer/core) | Foundation library |
| `@code-analyzer/shared` | [![npm](https://img.shields.io/npm/v/@code-analyzer/shared)](https://npmjs.com/@code-analyzer/shared) | Shared types |
| `@code-analyzer/vscode` | [![npm](https://img.shields.io/npm/v/@code-analyzer/vscode)](https://npmjs.com/@code-analyzer/vscode) | VS Code extension |
| `@code-analyzer/web` | [![npm](https://img.shields.io/npm/v/@code-analyzer/web)](https://npmjs.com/@code-analyzer/web) | Web UI |

---

## API / Usage Examples

### Programmatic Usage

```typescript
import { createAnalyzer, AnalyzerConfig } from '@code-analyzer/analyzer';

// Index a repository programmatically
const analyzer = createAnalyzer({
  projectDir: './my-project',
  languages: ['typescript', 'python', 'go'],
  incremental: true,
});

await analyzer.index();

// Search the knowledge graph
const results = await analyzer.search({
  query: 'authentication middleware',
  semantic: true,
  limit: 20,
  filters: { language: 'typescript', entityType: 'Function' },
});

// Trace a call path
const callPath = await analyzer.traceCallPath({
  source: 'authenticateUser',
  target: 'database.query',
  maxDepth: 10,
});

// Analyze impact of a change
const impact = await analyzer.analyzeImpact({
  file: 'src/auth/login.ts',
  symbol: 'authenticateUser',
});

// Run a Cypher query on the knowledge graph
const graphResults = await analyzer.queryGraph(`
  MATCH (f:Function)-[:CALLS]->(callee:Function)
  WHERE callee.name = 'query'
  RETURN f.name, f.file
  LIMIT 50
`);

// Generate a codebase health report
const report = await analyzer.generateReport({
  type: 'health',
  format: 'markdown',
  outputPath: './codebase-health.md',
});
```

> **Note**: The programmatic API is defined but most methods return placeholder data in the current alpha. The API surface is stable and ready for implementation.

---

## Configuration Reference

Code Analyzer can be configured via a `.code-analyzer.yml` file, environment variables, or CLI flags (in order of precedence).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectDir` | `string` | `.` | Root directory of the project to analyze |
| `languages` | `string[]` | All detected | Languages to index (e.g., `[typescript, python]`) |
| `incremental` | `boolean` | `true` | Enable incremental indexing (re-index only changed files) |
| `maxWorkers` | `number` | CPU count | Number of worker threads for parallel parsing |
| `parseCache` | `boolean` | `true` | Cache parsed AST results to disk for faster re-indexing |
| `cacheDir` | `string` | `.code-analyzer/cache` | Directory for parse cache and database |
| `ignorePatterns` | `string[]` | `[node_modules, .git, dist]` | Glob patterns for files and directories to ignore |
| `searchRanking` | `string` | `hybrid` | Search ranking strategy: `bm25`, `vector`, or `hybrid` |
| `reviewSeverity` | `string` | `warning` | Minimum severity for review findings: `info`, `warning`, `error` |
| `reviewMaxFindings` | `number` | `50` | Maximum number of findings per PR review |
| `standardsFile` | `string` | — | Path to custom standards YAML file |
| `mcpTransport` | `string` | `stdio` | MCP server transport: `stdio` or `http` |
| `mcpPort` | `number` | `3100` | Port for HTTP MCP transport |
| `logLevel` | `string` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `reportFormat` | `string` | `markdown` | Default report format: `markdown`, `html`, or `json` |

Example `.code-analyzer.yml`:

```yaml
projectDir: .
languages:
  - typescript
  - python
incremental: true
maxWorkers: 4
ignorePatterns:
  - node_modules
  - .git
  - dist
  - "*.test.ts"
reviewSeverity: warning
reviewMaxFindings: 30
```

---

## Language Support

| Language | Definitions | Imports | Type Resolution | Call Graph | Routes |
|----------|:----------:|:-------:|:---------------:|:----------:|:------:|
| TypeScript | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| JavaScript | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Python | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Go | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Java | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Kotlin | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| C# | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Rust | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

> **Legend**: ✅ Implemented · ⚠️ Provider scaffold with stub parsing · ⬜ Not started
>
> Language provider scaffolding exists for all 8 languages. Actual parsing implementations are in development. See [docs/language-support.md](docs/language-support.md) for details.

---

## Project Structure

```
code-analyzer/
├── packages/
│   ├── shared/                     # Shared types, constants, validation
│   │   └── src/
│   │       ├── types/              # UnifiedCapture, Graph types
│   │       ├── constants/          # Entity & relationship type enums
│   │       └── validation/         # Schema validation utilities
│   ├── core/                       # Foundation layer (Layer 1) — ✅ Implemented
│   │   └── src/
│   │       ├── config/             # Config loading, defaults, validation
│   │       ├── logging/            # Structured logger with formatters
│   │       ├── errors/             # Error taxonomy and hierarchy
│   │       ├── i18n/               # Internationalization engine
│   │       ��── metrics/            # Metrics collection
│   │       └── lifecycle/          # Lifecycle management hooks
│   ├── infra/                      # Infrastructure layer (Layer 2) — ✅ Implemented
│   │   └── src/
│   │       ��── storage/            # In-memory store with typed queries (SQLite planned)
│   │       ├── cache/              # Parse result caching
│   │       ├── filesystem/         # File discovery and watching
│   │       ├── git/                # Git diff and history operations
│   │       └── workers/            # Worker pool, supervisor, circuit breaker
│   ├── analyzer/                   # Analysis Engine layer (Layer 3) — ⚠️ Partial
│   │   └── src/
│   │       ├── languages/          # 8 language provider scaffolds
│   │       ├── parser/             # Unified parser (stub)
│   │       ├── pipeline/           # Orchestrator (✅) + phases (⚠️ stubs)
│   │       ├── graph/              # Knowledge graph builder (stub)
│   │       └── resolution/         # Scope-aware symbol resolution (stub)
│   ├── intelligence/               # Intelligence layer (Layer 4) — ⚠️ Partial
│   │   └── src/
│   │       ├── search/             # Hybrid BM25 + vector search (BM25 functional)
│   │       ├── embeddings/         # Code-aware embedding generation (stub)
│   │       ├── review/             # Code review engine (heuristic-based)
│   │       ├── standards/          # Standards engine (stub)
│   │       ├── impact/             # Impact analysis (planned)
│   │       ├── report/             # Report generation (planned)
│   │       ├── compression/        # Memory compression (planned)
│   │       └── similarity/         # MinHash and LSH (planned)
│   ├── mcp/                        # MCP Server (Layer 5) — ✅ Framework / ⚠️ Tools
│   │   └── src/
│   │       ├���─ server/             # MCP protocol implementation (stdio + HTTP)
│   │       ├── tools/              # 38 tool definitions (many placeholder)
│   │       ├── cypher/             # Cypher query lexer, parser, planner, executor ✅
│   │       ├── resources/          # MCP resource handlers
│   │       ├── prompts/            # MCP prompt templates
│   │       ├── skills/             # MCP skill installer ✅
│   │       └── middleware/         # Auth ✅, rate limiting ✅, logging ✅
│   ├── server/                     # HTTP REST API (Layer 5) — ⬜ Planned
│   ├── cli/                        # CLI entry point (Layer 7) — ⬜ Planned
│   ├── vscode/                     # VS Code Extension (Layer 7) — ⬜ Planned
│   │   └── src/
│   │       ├── extension/          # Extension activation and commands
│   │       ├── participant/        # Copilot Chat participant
│   │       ├── providers/          # Sidebar, comments, config providers
│   │       ├── services/           # Engine bridge, git, config, VS Code API
│   │       └── views/              # Status bar and UI views
│   └── web/                        # Web UI (Layer 7) — ⬜ Planned
├── docs/
│   ├── getting-started.md          # 5-minute quickstart guide
│   └── language-support.md         # Full language feature matrix
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Main CI: build, test, lint, typecheck
│       ├── codeql.yml              # CodeQL security analysis
│       └── pr-review.yml           # Automated PR review pipeline
├── tests/                          # Integration and E2E test suites
├── grammars/                       # Tree-sitter grammars (gitignored, built on demand)
├── vitest.config.ts                # Unit test configuration
├── vitest.integration.config.ts    # Integration test configuration
├── turbo.json                      # Turborepo pipeline configuration
└── pnpm-workspace.yaml             # pnpm workspace definition
```

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **OS** | Linux / macOS / Windows | Linux (production) |
| **Node.js** | >= 20.x | >= 22.x |
| **Package Manager** | pnpm >= 9 | pnpm >= 9 |
| **RAM** | 2 GB | 8 GB+ (for > 500K LOC repos) |
| **Disk** | 50 MB | 500 MB+ (parse cache for large repos) |
| **GPU** (optional) | N/A | Not required — embedding inference runs on CPU |

> **No additional system packages required.** All processing is local — no external API calls.

---

## CLI Quick Reference

| Command | Description | Status |
|---------|-------------|--------|
| `analyze` | Index a repository into the knowledge graph | ⬜ Planned |
| `search` | Full-text or semantic search of the graph | ⬜ Planned |
| `trace` | Trace call paths between two symbols | ⬜ Planned |
| `review` | Review staged changes or a PR | ⬜ Planned |
| `standards check` | Check code against coding standards | ⬜ Planned |
| `report generate` | Generate codebase health report | ⬜ Planned |
| `graph export` | Export the knowledge graph | ⬜ Planned |
| `graph query` | Run a Cypher query | ⬜ Planned |
| `config show` | Show current configuration | ⚠️ Partial |
| `config init` | Create a `.code-analyzer.yml` template | ⚠️ Partial |

---

## Documentation & Reports

| Resource | Description | URL |
|----------|-------------|-----|
| Getting Started | 5-minute quickstart guide | [docs/getting-started.md](docs/getting-started.md) |
| Language Support | Full feature matrix, cross-language analysis | [docs/language-support.md](docs/language-support.md) |
| Architecture | System architecture and design | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| MCP Server | MCP setup and tool reference | [docs/MCP-SERVER.md](docs/MCP-SERVER.md) |
| Code Review | Review engine and standards guide | [docs/CODE-REVIEW.md](docs/CODE-REVIEW.md) |
| Configuration | Full configuration reference | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| Contributing | Development setup, coding standards, PR guidelines | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Changelog | Version history and release notes | [CHANGELOG.md](CHANGELOG.md) |
| Security Policy | Vulnerability reporting and security practices | [SECURITY.md](SECURITY.md) |
| License | MIT license terms | [LICENSE](LICENSE) |

---

## Known Limitations

- **Alpha status**: Core architecture is solid but most analysis features are stubbed or return placeholder data. See [Current Status](#current-status) section above.
- **In-memory storage**: The graph store uses an in-memory `Map` rather than SQLite. Data does not persist across restarts. SQLite persistence is planned.
- **Regex-based parsing**: Language providers use regex-based parsing rather than full compiler frontends. Accuracy targets 95-99%+ for supported languages but may miss some edge cases.
- **Language coverage**: Currently 8 languages with provider scaffolds. Full implementations are in development. See [docs/language-support.md](docs/language-support.md) for the full feature matrix.
- **Dynamic language limitations**: For JavaScript and Python, dynamic `eval()` calls, computed property access, and runtime monkey-patching are not statically analyzable.
- **Cross-language calls**: Planned cross-language dependencies will be captured as `CROSS_REPO_*` edges in the graph but will not include type-level resolution across language boundaries.
- **No fine-tuning**: The embedding model is planned to be frozen — no on-device fine-tuning for domain-specific codebases.
- **Memory for large repos**: Repositories with > 5M LOC may require 16 GB+ RAM for the full knowledge graph in memory. Use `--max-workers` to limit parallelism.
- **MCP server auth**: The MCP HTTP transport does not yet include built-in authentication. Use a reverse proxy (nginx, Caddy) for access control in production deployments.

---

## Development

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Git

### Setup

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test              # All tests across all packages
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests only

# Lint and format
pnpm lint              # ESLint across all packages
pnpm format:check      # Check formatting
pnpm format            # Auto-fix formatting

# Type checking
pnpm typecheck         # TypeScript type checking across all packages

# Clean build artifacts
pnpm clean
```

### Monorepo Tooling

This project uses:
- **pnpm workspaces** for package management
- **Turborepo** for build orchestration and caching
- **Changesets** for versioning and changelog generation
- **Vitest** for testing
- **ESLint + Prettier** for code quality

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

Please read our [Security Policy](SECURITY.md) before reporting vulnerabilities.

---

## License

MIT © [Lambertyan](https://github.com/AgentiX-E)

---

<p align="center">
  <b>Code Analyzer</b> — Building the standard for code intelligence.
</p>
