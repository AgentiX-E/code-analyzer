# Code Analyzer

> **World-class layered code intelligence platform.** Understand, search, and review code at unprecedented depth — available as an MCP server for AI agents, a VS Code extension with Copilot Chat integration, and a standalone CLI.

[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://github.com/AgentiX-E/code-analyzer/actions)
[![Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen)](https://github.com/AgentiX-E/code-analyzer)
[![Docs](https://img.shields.io/badge/docs-getting--started-blue)](docs/getting-started.md)
[![npm](https://img.shields.io/npm/v/@code-analyzer/cli?color=blue)](https://www.npmjs.com/package/@code-analyzer/cli)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

**Code Analyzer** transforms raw source code into a structured knowledge graph with 33 entity types and 39 relationship types, enabling deep semantic queries, call-graph tracing, architecture analysis, and AI-assisted code review. It runs entirely locally — your code never leaves your machine.

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
Layer 2: Infrastructure  ← SQLite Store, Git, File System, Worker Pool
Layer 1: Foundation      ← Core Types, Config, Logging, Errors, I18n
```

**What flows through each layer:**

| Layer | Input | Processing | Output |
|-------|-------|------------|--------|
| **1. Foundation** | Raw config files, env vars | Configuration loading, error taxonomy, structured logging, i18n strings | Typed configs, localized messages, metrics collectors |
| **2. Infrastructure** | File paths, git refs | File discovery, git diff extraction, SQLite persistence, worker thread orchestration | File lists, diffs, stored graph data, computed results from worker pool |
| **3. Analysis Engine** | Source files (8 languages) | Language-specific parsing, unified capture extraction, scope resolution, graph edge building | Unified knowledge graph (33 entity types × 39 relationship types) |
| **4. Intelligence** | Knowledge graph, user queries | BM25 + vector hybrid search, PR diff review pipeline, impact analysis via graph traversal, LSH deduplication | Search results, review comments, impact reports, recommendations |
| **5. Service** | MCP tool calls, HTTP requests | MCP protocol (tools/resources/prompts/skills), Cypher query execution, REST endpoints, WebSocket events | Structured tool results, HTTP JSON responses, real-time updates |
| **6. Integration** | GitHub webhooks, CI pipelines | PR review automation, standards checks, report generation in CI workflows | PR comments, CI annotations, status checks |
| **7. Presentation** | User interactions | VS Code sidebar views, Copilot Chat participant, in-editor annotations, CLI commands, web dashboard | UI updates, chat responses, formatted output, visual graphs |

---

## Features

### Deep Code Understanding
- **Multi-language graph**: Index 8 languages (TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust) into a unified knowledge graph with 33 entity types (functions, classes, interfaces, routes, decorators, etc.) and 39 relationship types (calls, inherits, implements, imports, decorates, etc.)
- **Call graph tracing**: Follow function calls across files, packages, and services — trace a request from a REST endpoint down to the database query
- **Scope-aware resolution**: Language-agnostic symbol resolution engine with type inference across lexical scopes
- **Architecture analysis**: Automatic community detection (Louvain algorithm), hotspot identification via graph centrality, and dependency mapping across module boundaries
- **Unified parser**: Single `UnifiedCapture` format normalizes all 8 languages into a common representation for graph building and cross-language queries

### AI-Ready Intelligence
- **MCP Server**: Expose code intelligence as 38 MCP tools for AI coding agents (Claude, Cursor, Codex, etc.) with stdio and HTTP transports, plus resources, prompts, and installable skills
- **Copilot Chat Participant**: Native VS Code integration using `@code-analyzer` — ask questions about your codebase in natural language
- **Code Review Engine**: Plan → Analyze → Filter → Relocate pipeline with extensible review rules and memory compression for large PRs (IoU overlap detection, LSH-based deduplication)
- **Semantic Search**: Hybrid BM25 + vector search powered by code-aware embeddings — find semantically similar code even when naming conventions differ
- **Impact Analysis**: Graph-based change detection — see what files, functions, and services are affected before you make a change
- **Standards Engine**: Built-in templates for TypeScript, Python, and general best practices, plus custom standards via YAML config
- **Cypher Query**: Graph query language support for power users — `MATCH (f:Function)-[:CALLS]->(t:Function) RETURN f, t`

### Production-Grade Performance
- **Fast indexing**: 1M LOC indexed in under 60 seconds using worker thread pools and incremental parse caching
- **Incremental updates**: Re-index only changed files via file watcher integration (Under 500ms for single-file changes)
- **Sub-10ms queries**: BFS graph traversals at interactive speeds thanks to adjacency-list storage in SQLite
- **Zero data egress**: All processing happens locally — your code never leaves your machine
- **Circuit breaker**: Worker pool resilience with automatic retry and degradation on persistent failures

### Flexible Deployment
- **MCP Server**: stdio or HTTP transport for any MCP-compatible agent (Claude Desktop, Cursor, Continue, etc.)
- **VS Code Extension**: Full sidebar, inline annotations, status bar indicators, and Copilot Chat integration
- **CLI**: Command-line interface for scripting and CI/CD pipelines
- **CI/CD**: GitHub Actions integration for automated PR review and standards enforcement
- **REST API**: HTTP server for custom integrations and dashboards

---

## Quick Start

### Option 1 — CLI Installation (recommended)

```bash
# Install globally
npm install -g @code-analyzer/cli

# Index a repository (first run may take 30-60s for large repos)
code-analyzer analyze ./my-project

# Search the knowledge graph
code-analyzer search "authentication flow" --repo ./my-project

# Trace a call path from endpoint to database
code-analyzer trace "POST /api/login" "database.query" --repo ./my-project

# Review staged or committed changes
code-analyzer review --diff --repo ./my-project

# Check coding standards
code-analyzer standards check --repo . --standard typescript-best-practices

# Generate a codebase health report
code-analyzer report generate --repo . --format html --output report.html
```

### Option 2 — npx (no install)

```bash
# One-shot analysis without global install
npx @code-analyzer/cli analyze --repo ./my-project

# Review a PR in CI
npx @code-analyzer/cli review pr --repo . --pr 42 --token $GITHUB_TOKEN
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

**What your AI agent gets:** 38 tools across 7 categories — indexing lifecycle management, querying and exploration (search, call graph tracing, architecture overview, Cypher queries), code review (PR review, standards check), change impact analysis (function-level blast radius, PDG analysis), reporting (health, trends, recommendations), cross-repository operations, and standards/ADR agent tools. Plus MCP resources for graph snapshots and installable skills for domain-specific workflows.

Once connected, your agent can answer questions like:
- "Find all functions that call `authenticateUser` and trace their callers"
- "What's the architecture of this project? Show me the dependency graph"
- "Review PR #42 against our TypeScript best practices"
- "If I rename `getUserById`, what else needs to change?"
- "Show me the code quality trends over the last 30 days"

### Option 4 — VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AgentiX-E.code-analyzer) or search for "Code Analyzer" in the Extensions view (Ctrl+Shift+X / Cmd+Shift+X).

**Copilot Chat integration:**
1. Install the extension and GitHub Copilot Chat
2. Open Copilot Chat (Ctrl+Shift+I / Cmd+Shift+I)
3. Type `@code-analyzer` followed by your question

```
@code-analyzer explore the authentication module
@code-analyzer search for all REST API handlers
@code-analyzer review this file against project standards
@code-analyzer impact what if I rename getUser to fetchUser?
@code-analyzer debug why is the login flow failing?
@code-analyzer refactor suggest improvements for this class
```

**Other VS Code features:**
- **Graph Sidebar**: Interactive visualization of your code's dependency graph with expand/collapse and filtering
- **Inline Reviews**: AI-powered code review comments directly in your editor via the Problems panel and gutter annotations
- **Impact Analysis**: See the blast radius of any change before you make it, shown as a notification

### Option 5 — Build from Source

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer

# Install dependencies (requires pnpm >= 9)
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Link CLI for local use
cd packages/cli && npm link
code-analyzer analyze ./my-project
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
console.log(`Affected files: ${impact.affectedFiles.length}`);
console.log(`Affected functions: ${impact.affectedSymbols.length}`);

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

### MCP Tool Usage via AI Agent

When the MCP server is connected, your AI agent automatically has access to these tools. Example interactions:

```
User: "Find all places where we call the deprecated `oldAuth` function"
Agent: [calls search_graph tool] → Returns 12 call sites across 8 files
Agent: [calls analyze_impact tool on each call site] → Shows blast radius for each

User: "Review PR #42 against our standards"
Agent: [calls review_pr tool] → Returns structured review with 5 findings
Agent: [calls check_standards tool] → Confirms 3 issues violate TypeScript best practices
```

### CI/CD Pipeline (GitHub Actions)

```yaml
name: Code Analysis
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run Code Analyzer
        run: |
          npx @code-analyzer/cli review pr \
            --repo . \
            --pr ${{ github.event.pull_request.number }} \
            --token ${{ secrets.GITHUB_TOKEN }} \
            --format markdown \
            --output review-report.md

      - name: Post Review Report
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('review-report.md', 'utf8');
            github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: report,
            });
```

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
| `cacheDir` | `string` | `.code-analyzer/cache` | Directory for parse cache and SQLite database |
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
|----------|------------|---------|-----------------|------------|--------|
| TypeScript | ✅ | ✅ | ✅ | ✅ | ✅ |
| JavaScript | ✅ | ✅ | ✅ | ✅ | ✅ |
| Python | ✅ | ✅ | ✅ | ✅ | ✅ |
| Go | ✅ | ✅ | ✅ | ✅ | ✅ |
| Java | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kotlin | ✅ | ✅ | ✅ | ✅ | ✅ |
| C# | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rust | ✅ | ✅ | ✅ | ✅ | ✅ |

> 8 languages with comprehensive analysis depth. Additional languages added on a rolling basis.
>
> For the full feature matrix, cross-language analysis details, performance characteristics, and guides for adding new languages, see [docs/language-support.md](docs/language-support.md).

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
│   ├── core/                       # Foundation layer (Layer 1)
│   │   └── src/
│   │       ├── config/             # Config loading, defaults, validation
│   │       ├── logging/            # Structured logger with formatters
│   │       ├── errors/             # Error taxonomy and hierarchy
│   │       ├── i18n/               # Internationalization engine
│   │       ├── metrics/            # Metrics collection
│   │       └── lifecycle/          # Lifecycle management hooks
│   ├── infra/                      # Infrastructure layer (Layer 2)
│   │   └── src/
│   │       ├── storage/            # SQLite store with typed queries
│   │       ├── cache/              # Parse result caching
│   │       ├── filesystem/         # File discovery and watching
│   │       ├── git/                # Git diff and history operations
│   │       └── workers/            # Worker pool, supervisor, circuit breaker
│   ├── analyzer/                   # Analysis Engine layer (Layer 3)
│   │   └── src/
│   │       ├── languages/          # 8 language providers (TS, JS, Python, Go, Java, Kotlin, C#, Rust)
│   │       ├── parser/             # Unified parser converting ASTs to UnifiedCapture
│   │       ├── pipeline/           # Orchestrator and analysis phases
│   │       ├── graph/              # Knowledge graph builder
│   │       └── resolution/         # Scope-aware symbol resolution
│   ├── intelligence/               # Intelligence layer (Layer 4)
│   │   └── src/
│   │       ├── search/             # Hybrid BM25 + vector search
│   │       ├── embeddings/         # Code-aware embedding generation
│   │       ├── review/             # Code review engine, PR review, session store
│   │       ├── standards/          # Standards engine and templates
│   │       ├── impact/             # Impact analysis and change detection
│   │       ├── report/             # Report generation, formatting, trends
│   │       ├── compression/        # Memory compression for large contexts
│   │       └── similarity/         # MinHash and LSH for deduplication
│   ├── mcp/                        # MCP Server (Layer 5)
│   │   └── src/
│   │       ├── server/             # MCP protocol implementation (stdio + HTTP)
│   │       ├── tools/              # 38 tool definitions across 7 categories
│   │       ├── cypher/             # Cypher query lexer, parser, planner, executor
│   │       ├── resources/          # MCP resource handlers
│   │       ├── prompts/            # MCP prompt templates
│   │       ├── skills/             # MCP skill installer
│   │       └── middleware/         # Authentication and rate limiting
│   ├── server/                     # HTTP REST API (Layer 5)
│   ├── cli/                        # CLI entry point (Layer 7)
│   ├── vscode/                     # VS Code Extension (Layer 7)
│   │   └── src/
│   │       ├── extension/          # Extension activation and commands
│   │       ├── participant/        # Copilot Chat participant
│   │       ├── providers/          # Sidebar, comments, config providers
│   │       ├── services/           # Engine bridge, git, config, VS Code API
│   │       └── views/              # Status bar and UI views
│   └── web/                        # Web UI (Layer 7)
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

> **No additional system packages required.** Tree-sitter grammars are pre-built and bundled. SQLite is bundled via better-sqlite3. All processing is local — no external API calls.

---

## CLI Quick Reference

| Command | Description | Example |
|---------|-------------|---------|
| `analyze` | Index a repository into the knowledge graph | `code-analyzer analyze ./my-project --languages ts,python` |
| `search` | Full-text or semantic search of the graph | `code-analyzer search "auth" --semantic --language ts` |
| `trace` | Trace call paths between two symbols | `code-analyzer trace "login" "db.query" --max-depth 10` |
| `review` | Review staged changes or a PR | `code-analyzer review --diff` |
| `review pr` | Review a specific GitHub PR | `code-analyzer review pr --repo . --pr 42 --token $TOKEN` |
| `standards check` | Check code against coding standards | `code-analyzer standards check --standard ts-best-practices` |
| `report generate` | Generate codebase health report | `code-analyzer report generate --format html --output report.html` |
| `report recommend` | Get actionable recommendations | `code-analyzer report recommend --format md --output recs.md` |
| `report trends` | Trend analysis over time | `code-analyzer report trends --repo . --days 30` |
| `graph export` | Export the knowledge graph | `code-analyzer graph export --format json --output graph.json` |
| `graph query` | Run a Cypher query | `code-analyzer graph query "MATCH (f:Function) RETURN f.name"` |
| `config show` | Show current configuration | `code-analyzer config show` |
| `config init` | Create a `.code-analyzer.yml` template | `code-analyzer config init` |

---

## Documentation & Reports

| Resource | Description | URL |
|----------|-------------|-----|
| Getting Started | 5-minute quickstart guide | [docs/getting-started.md](docs/getting-started.md) |
| Language Support | Full feature matrix, cross-language analysis, performance | [docs/language-support.md](docs/language-support.md) |
| Contributing | Development setup, coding standards, PR guidelines | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Changelog | Version history and release notes | [CHANGELOG.md](CHANGELOG.md) |
| Security Policy | Vulnerability reporting and security practices | [SECURITY.md](SECURITY.md) |
| License | MIT license terms | [LICENSE](LICENSE) |
| npm (CLI) | `@code-analyzer/cli` | [npmjs.com/package/@code-analyzer/cli](https://www.npmjs.com/package/@code-analyzer/cli) |
| npm (MCP) | `@code-analyzer/mcp` | [npmjs.com/package/@code-analyzer/mcp](https://www.npmjs.com/package/@code-analyzer/mcp) |
| npm (Core) | `@code-analyzer/core` | [npmjs.com/package/@code-analyzer/core](https://www.npmjs.com/package/@code-analyzer/core) |
| npm (Analyzer) | `@code-analyzer/analyzer` | [npmjs.com/package/@code-analyzer/analyzer](https://www.npmjs.com/package/@code-analyzer/analyzer) |

---

## Known Limitations

- **Regex-based parsing**: Language providers use regex and AST-based parsing rather than full compiler frontends. Accuracy is 95-99%+ for supported languages but may miss some edge cases (e.g., complex macro expansions, deeply nested template metaprogramming).
- **Language coverage**: Currently 8 languages. C/C++, Ruby, Swift, PHP, and other languages are planned but not yet supported. See [docs/language-support.md](docs/language-support.md) for the full feature matrix.
- **Dynamic language limitations**: For JavaScript and Python, dynamic `eval()` calls, computed property access, and runtime monkey-patching are not statically analyzable.
- **Cross-language calls**: Cross-language dependencies (e.g., TypeScript frontend calling Python API) are captured as `CROSS_REPO_*` edges in the graph but do not include type-level resolution across language boundaries.
- **No fine-tuning**: The embedding model is frozen — no on-device fine-tuning for domain-specific codebases.
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

# Run tests (unit, integration, property-based, E2E)
pnpm test              # All tests across all packages
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests only
pnpm test:property     # Property-based tests (fast-check)
pnpm test:e2e          # End-to-end tests

# Lint and format
pnpm lint              # ESLint across all packages
pnpm format:check      # Check formatting
pnpm format            # Auto-fix formatting

# Type checking
pnpm typecheck         # TypeScript type checking across all packages

# Run benchmarks
pnpm bench             # Performance benchmarks

# Clean build artifacts
pnpm clean
```

### Monorepo Tooling

This project uses:
- **pnpm workspaces** for package management
- **Turborepo** for build orchestration and caching
- **Changesets** for versioning and changelog generation
- **Vitest** for testing (unit, integration, property-based, E2E)
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
  <b>Code Analyzer</b> — Setting the standard for code intelligence.
</p>
