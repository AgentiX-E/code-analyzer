# Code Analyzer — User Guide

> **Version**: 0.1.0 | **Author**: Lambertyan  
> **License**: MIT | **Repository**: https://github.com/AgentiX-E/code-analyzer

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Installation](#2-installation)
3. [Quick Start](#3-quick-start)
4. [CLI Usage](#4-cli-usage)
5. [VS Code Extension](#5-vs-code-extension)
6. [MCP Server for AI Agents](#6-mcp-server-for-ai-agents)
7. [Web Dashboard](#7-web-dashboard)
8. [Code Review & PR Review](#8-code-review--pr-review)
9. [Cross-Repository Analysis](#9-cross-repository-analysis)
10. [Configuration Reference](#10-configuration-reference)
11. [Language Support](#11-language-support)
12. [GitHub Integration](#12-github-integration)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Introduction

Code Analyzer transforms source code into a structured **knowledge graph** — capturing every function, class, import, call chain, and architectural pattern — and exposes this intelligence through multiple interfaces:

- **CLI**: Command-line interface for analysis, search, and review
- **MCP Server**: 40+ tools for AI agents (Claude, Cursor, Codex, etc.)
- **VS Code Extension**: Copilot Chat participant with 7 slash commands
- **Web Dashboard**: Interactive graph explorer, search, and PR review views

### Core Capabilities

| Capability | Description |
|---|---|
| **Knowledge Graph** | 33 node types, 39 relationship types — a rich property graph of your code |
| **18-Phase Analysis Pipeline** | DAG-based pipeline from file scanning to vector embeddings |
| **Hybrid Search Engine** | BM25 keyword + vector semantic + graph traversal + regex pattern |
| **PR Review Swarm** | 8-lane parallel review covering security, performance, testing, architecture, and more |
| **Cross-Repository Analysis** | Federated knowledge graphs across multiple repositories |
| **Real-Time Code Intelligence** | File watching, incremental indexing, auto-updating knowledge graph |

### Architecture Overview

Code Analyzer follows a strict **seven-layer architecture**:

```
Layer 7: Presentation   — CLI, VS Code Extension, Web Dashboard
Layer 6: Integration    — GitHub Actions, CI/CD Pipelines
Layer 5: Service        — MCP Server, REST API, WebSocket
Layer 4: Intelligence   — Search, Review, Embeddings, Standards
Layer 3: Analysis Engine — 18-Phase Pipeline, 20 Language Providers
Layer 2: Infrastructure  — Graph Stores, File Discovery, Git Ops
Layer 1: Foundation     — Config, Logging, Errors, Security
```

---

## 2. Installation

### Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.15.0 (for development builds)
- **Git** >= 2.41 (for Git integration features)

### One-Line Setup

```bash
curl -fsSL https://raw.githubusercontent.com/AgentiX-E/code-analyzer/main/scripts/setup.sh | bash
```

### npm Global Install

```bash
npm install -g @code-analyzer/cli
```

### Homebrew (macOS)

```bash
brew install code-analyzer
```

### Docker

```bash
docker pull ghcr.io/agentix-e/code-analyzer:latest
docker compose up -d
```

### Build from Source

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer
pnpm install
pnpm build
```

---

## 3. Quick Start

```bash
# Initialize a project
cd my-project
code-analyzer init

# Index the codebase
code-analyzer analyze .

# Search for symbols
code-analyzer search "authentication" --type function

# Review code changes
code-analyzer review --diff HEAD~1

# Check indexing status
code-analyzer status
```

### Configure Your AI Agent

Code Analyzer auto-detects installed AI coding agents and configures them in one command:

```bash
# See what agents are detected
code-analyzer agent detect

# Configure all detected agents
code-analyzer agent configure --all

# Configure a specific agent
code-analyzer agent configure --agent claude-code
```

**Supported AI Agents**: Claude Code, Cursor, Windsurf, Continue.dev, Aider, Cline, GitHub Copilot Chat, OpenAI Codex CLI, Google Gemini CLI, Cody, Amazon Q Developer

---

## 4. CLI Usage

### 4.1 `analyze` — Index a Codebase

```bash
# Basic analysis
code-analyzer analyze .

# Analysis with specific languages only
code-analyzer analyze . --languages typescript,python

# Force full re-index (ignore cache)
code-analyzer analyze . --force

# Set concurrency (number of parallel workers)
code-analyzer analyze . --concurrency 8

# Skip embedding generation (faster, but no semantic search)
code-analyzer analyze . --skip-embeddings
```

### 4.2 `search` — Search the Knowledge Graph

```bash
# Keyword search
code-analyzer search "fetchUser"

# Search by type
code-analyzer search "fetch" --type function

# Search by file pattern
code-analyzer search "auth" --file "src/auth/**"

# Semantic (natural language) search
code-analyzer search "how is user authentication handled" --semantic

# Graph query (Cypher)
code-analyzer search --cypher "MATCH (f:Function)-[:CALLS]->(t:Function) WHERE t.name = 'validateToken' RETURN f.name"
```

### 4.3 `review` — Review Code Changes

```bash
# Review staged changes
code-analyzer review

# Review a specific commit
code-analyzer review --commit HEAD~3

# Review a PR locally
code-analyzer review --branch feature/new-auth --base main

# Review with specific severity threshold
code-analyzer review --severity medium

# Review specific files
code-analyzer review src/auth/ src/models/

# Generate a review report
code-analyzer review --format json --output review-report.json
```

### 4.4 `status` — View Index Status

```bash
# Basic status
code-analyzer status

# Detailed status with file counts
code-analyzer status --verbose

# Check staleness (files changed since last index)
code-analyzer status --check-staleness
```

### 4.5 `agent` — Manage AI Agent Integrations

```bash
# List configured agents
code-analyzer agent list

# Show agent connection status
code-analyzer agent status

# Restore agent configuration
code-analyzer agent restore
```

---

## 5. VS Code Extension

### 5.1 Installation

Install the extension from the VS Code Marketplace:
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Code Analyzer"
4. Click Install

### 5.2 Copilot Chat Integration

Code Analyzer uniquely integrates with GitHub Copilot Chat through 7 slash commands:

| Command | Description | Example |
|---------|-------------|---------|
| `/review` | Review current file or selection | `/review this function for security issues` |
| `/explain` | Explain selected code | `/explain how this middleware works` |
| `/impact` | Analyze change impact | `/impact if I rename this method` |
| `/find` | Find symbols in codebase | `/find all implementations of AuthProvider` |
| `/deps` | Show dependencies | `/deps of this module` |
| `/refactor` | Suggest refactoring | `/refactor to use async/await` |
| `/test` | Suggest test cases | `/test for edge cases` |

### 5.3 Sidebar Views

- **Code Intelligence**: Tree view of symbols, functions, classes in the current file
- **Graph Explorer**: Interactive force-directed graph visualization of the knowledge graph
- **Configuration**: Visual editor for `.code-analyzer/config.json`

### 5.4 Keybindings

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Analyze current file |
| `Ctrl+Shift+R` | Review changes |
| `Ctrl+Shift+F` | Find symbol |
| `Ctrl+Shift+G` | Show dependency graph |

---

## 6. MCP Server for AI Agents

### 6.1 Starting the MCP Server

```bash
# Start in stdio mode (default for MCP clients)
code-analyzer mcp

# Start as HTTP server
code-analyzer mcp --transport http --port 3000
```

### 6.2 Configuring MCP Clients

#### Claude Code

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@code-analyzer/cli", "mcp"]
    }
  }
}
```

#### Cursor

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@code-analyzer/cli", "mcp"]
    }
  }
}
```

Use `code-analyzer agent configure` for automatic setup.

### 6.3 Available MCP Tools

| Category | Tools | Description |
|----------|-------|-------------|
| **Indexing** | `index_repository`, `index_status`, `delete_index`, `update_index` | Manage codebase indexing |
| **Query** | `search_graph`, `query_graph`, `get_node_context`, `trace_path`, `get_callers`, `get_callees`, `get_architecture`, `get_route_map`, `get_tool_map`, `get_graph_schema`, `get_code_snippet`, `list_repositories`, `list_languages`, `search_by_natural_language` | Explore the knowledge graph |
| **Impact** | `detect_changes`, `impact_analysis`, `check_index_coverage`, `api_impact` | Analyze change impact |
| **Review** | `review_pr`, `review_diff`, `pr_review`, `pr_summary`, `pr_check` | Review code changes |
| **Cross-Repo** | `cross_repo_search`, `cross_repo_trace`, `cross_repo_impact`, `manage_repo_group`, `sync_contracts`, `discover_related_repos` | Multi-repository analysis |
| **Reports** | `generate_report`, `generate_architecture_doc`, `generate_quality_report` | Generate documentation |
| **Security** | `explain_taint`, `pdg_query`, `security_scan` | Security analysis |
| **Standards** | `check_standards`, `manage_adr`, `install_skills` | Standards & ADR management |

### 6.4 MCP Resources

- `analyzer://repos` — List indexed repositories
- `analyzer://repo/{name}/schema` — Graph schema
- `analyzer://repo/{name}/architecture` — Architecture overview
- `analyzer://repo/{name}/clusters` — Code communities
- `analyzer://repo/{name}/processes` — Business processes
- `analyzer://group/{name}/contracts` — Cross-repo contracts

---

## 7. Web Dashboard

### 7.1 Starting the Dashboard

```bash
# Start both server and dashboard
code-analyzer serve --ui

# Or with Docker
docker compose up -d
```

Access at `http://localhost:3000`

### 7.2 Dashboard Views

| View | Description |
|------|-------------|
| **Dashboard** | Health monitoring, indexing status, repository stats |
| **Graph Explorer** | Interactive SVG force-directed graph with zoom, pan, search |
| **Search** | Full-text and semantic search with result filtering |
| **Cross-Repo** | Multi-repository dashboard with federated views |
| **PR Review** | In-browser PR review with inline comments |
| **Repo Groups** | Manage repository groups and contracts |

---

## 8. Code Review & PR Review

### 8.1 Review Pipeline

Code Analyzer implements a four-phase review pipeline:

1. **Plan** — Analyze diff strategy, identify focus areas, estimate complexity
2. **Analyze** — Run heuristic rules, build graph analysis data, detect circular dependencies
3. **Filter** — Remove noise (empty context, invalid ranges, style-on-comments)
4. **Relocate** — Adjust line numbers to post-change positions

### 8.2 Review Rules

50+ rules across 6 categories:

| Category | Rules | Examples |
|----------|-------|---------|
| **Security** | 12 | SQL injection, XSS, hardcoded secrets, path traversal, unsafe eval |
| **Correctness** | 10 | Null reference, type mismatch, unhandled promise, unreachable code |
| **Performance** | 8 | N+1 queries, excessive allocations, blocking I/O, missing caching |
| **Maintainability** | 10 | God function (>50 lines), deep nesting (>4), duplicate code |
| **Style** | 6 | Naming conventions, formatting, import order |
| **Architecture** | 6 | Circular dependencies, layer violations, missing error boundaries |

### 8.3 Review Swarm Architecture

For comprehensive reviews, Code Analyzer uses an 8-lane parallel swarm:

| Lane | Focus | Checks |
|------|-------|--------|
| Security | OWASP Top 10, taint analysis | Injection, broken auth, sensitive data exposure |
| Performance | Complexity, resource usage | N+1 queries, memory leaks, blocking operations |
| Testing | Coverage, test quality | Missing tests, assertion gaps, flaky patterns |
| Maintainability | SOLID, code smells | God objects, feature envy, shotgun surgery |
| Architecture | Layer discipline, dependency | Circular deps, layer violations, tight coupling |
| Documentation | API docs, inline comments | Missing JSDoc, stale comments, ambiguous naming |
| Accessibility | A11y best practices | Missing ARIA labels, color contrast, keyboard nav |
| Dependencies | Supply chain, licenses | Deprecated packages, license conflicts, version drift |

### 8.4 GitHub PR Review Integration

```yaml
# .github/workflows/code-analyzer.yml
name: Code Analyzer PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: AgentiX-E/code-analyzer-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          review-lanes: security,performance,testing,dependency
          severity-threshold: medium
          max-comments: 50
```

### 8.5 Customizable Project Standards

Define project-specific standards in `.code-analyzer/standards.json`:

```json
{
  "name": "my-project-standards",
  "extends": ["default", "api-service"],
  "rules": [
    {
      "id": "no-console-in-api",
      "description": "API routes must not use console.log",
      "check": {
        "type": "regex",
        "pattern": "console\\\\.log\\\\(",
        "filePattern": "src/api/**"
      },
      "severity": "high",
      "category": "maintainability"
    },
    {
      "id": "max-function-lines",
      "description": "Functions should not exceed 30 lines",
      "check": {
        "type": "metric",
        "metric": "function_lines",
        "threshold": 30
      },
      "severity": "medium",
      "category": "maintainability"
    }
  ]
}
```

---

## 9. Cross-Repository Analysis

### 9.1 Repository Groups

Group related repositories for cross-repository analysis:

```json
// .code-analyzer/repo-group.json
{
  "name": "my-microservices",
  "repositories": [
    { "path": "../auth-service", "role": "primary" },
    { "path": "../api-gateway", "role": "dependency" },
    { "path": "../user-service", "role": "dependency" },
    { "path": "../notification-service", "role": "consumer" }
  ]
}
```

### 9.2 Cross-Repo Operations

```bash
# Index all repositories in a group
code-analyzer analyze --group my-microservices

# Search across repositories
code-analyzer search "getUser" --cross-repo

# Trace call paths across repositories
code-analyzer search --cypher "
  MATCH (f:CrossRepoFunction)-[:CROSS_REPO_CALLS]->(t:CrossRepoFunction)
  RETURN f.repo, f.name, t.repo, t.name
"

# Analyze cross-repo impact of changes
code-analyzer review --cross-repo-impact
```

### 9.3 API Contract Detection

Code Analyzer automatically detects and monitors API contracts across repositories:

- **OpenAPI/Swagger** specifications
- **GraphQL** schemas
- **gRPC** proto definitions
- **tRPC** router definitions

Contract violations (e.g., breaking API changes) are detected and reported automatically.

---

## 10. Configuration Reference

### 10.1 Configuration File (`.code-analyzer/config.json`)

```jsonc
{
  "analysis": {
    "maxFileSize": 10485760,       // Max file size in bytes (10MB)
    "languages": ["auto"],         // Languages to index (auto-detect)
    "concurrency": 4,              // Parallel workers
    "incremental": true,           // Enable incremental indexing
    "parseTimeout": 30000,         // Parse timeout per file (ms)
    "skipPatterns": [              // Skip patterns (gitignore syntax)
      "node_modules/**",
      "dist/**",
      ".git/**"
    ],
    "cacheDir": "~/.cache/code-analyzer"  // Cache directory
  },
  "review": {
    "enabled": true,
    "severityThreshold": "low",    // Minimum severity: low|medium|high|critical
    "maxComments": 50,             // Max comments per review
    "lanes": [                     // Review lanes to run
      "security", "performance", "testing",
      "maintainability", "architecture", "dependency"
    ]
  },
  "search": {
    "bm25": { "k1": 1.2, "b": 0.75 },
    "rrf": { "k": 60 },
    "weights": {
      "bm25": 0.30,
      "vector": 0.35,
      "graph": 0.25,
      "regex": 0.10
    }
  },
  "mcp": {
    "transport": "stdio",           // stdio|http
    "port": 3000,                   // HTTP port
    "auth": {
      "enabled": false,
      "apiKey": null                // API key for authentication
    },
    "rateLimit": {
      "capacity": 100,              // Token bucket capacity
      "refillRate": 0.5             // Tokens per millisecond
    },
    "toolProfile": "all"            // all|analysis|scout
  },
  "security": {
    "rbac": {
      "enabled": true,
      "roles": ["admin", "developer", "viewer"]
    },
    "secretScanner": {
      "enabled": true,
      "patterns": ["aws", "github", "jwt", "private-key"]
    }
  }
}
```

### 10.2 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CODE_ANALYZER_CONFIG` | Path to config file | `.code-analyzer/config.json` |
| `CODE_ANALYZER_LOG_LEVEL` | Log level: debug, info, warn, error | `info` |
| `CODE_ANALYZER_CACHE_DIR` | Cache directory | `~/.cache/code-analyzer` |
| `CODE_ANALYZER_CONCURRENCY` | Worker concurrency | `4` |
| `CODE_ANALYZER_MCP_AUTH_KEY` | MCP API key | — |
| `CODE_ANALYZER_NO_COLOR` | Disable colored output | `false` |

---

## 11. Language Support

| Language | Extensions | Tree-sitter Grammar | Support Level |
|----------|-----------|-------------------|---------------|
| TypeScript | `.ts`, `.tsx` | tree-sitter-typescript | **Full** (scope resolution + types + routes) |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | tree-sitter-javascript | **Full** |
| Python | `.py`, `.pyi` | tree-sitter-python | **Full** (scope resolution + types + MRO) |
| Go | `.go` | tree-sitter-go | **Full** |
| Java | `.java` | tree-sitter-java | **Full** |
| Kotlin | `.kt`, `.kts` | tree-sitter-kotlin | **Full** |
| C# | `.cs` | tree-sitter-c-sharp | **Full** |
| Rust | `.rs` | tree-sitter-rust | **Full** |
| Ruby | `.rb` | tree-sitter-ruby | **Standard** |
| PHP | `.php` | tree-sitter-php | **Standard** |
| Swift | `.swift` | tree-sitter-swift | **Standard** |
| C | `.c`, `.h` | tree-sitter-c | **Standard** |
| C++ | `.cpp`, `.cc`, `.hpp` | tree-sitter-cpp | **Standard** |
| Dart | `.dart` | tree-sitter-dart | **Standard** |
| Dockerfile | `Dockerfile`, `*.dockerfile` | tree-sitter-dockerfile | **Infra** |
| HCL/Terraform | `.tf`, `.hcl` | tree-sitter-hcl | **Infra** |
| YAML | `.yaml`, `.yml` | Custom | **Config** |
| JSON | `.json` | Custom | **Config** |
| Markdown | `.md`, `.mdx` | Custom | **Documentation** |
| Shell | `.sh`, `.bash`, `.zsh` | tree-sitter-bash | **Script** |

**Support Levels**:
- **Full**: Parse + scope resolution + type inference + route detection + DI detection
- **Standard**: Parse + scope resolution
- **Infra**: Parse + infrastructure resource detection
- **Config**: Parse + configuration extraction
- **Documentation**: Parse + section extraction
- **Script**: Parse only

---

## 12. GitHub Integration

### 12.1 GitHub App Setup

1. Install the Code Analyzer GitHub App from the GitHub Marketplace
2. Grant repository access
3. Configure `.code-analyzer/config.json` with your standards
4. Create `.github/workflows/code-analyzer.yml`

### 12.2 Webhook Events

| Event | Action |
|-------|--------|
| `pull_request.opened` | Full PR review with swarm lanes |
| `pull_request.synchronize` | Incremental review (new commits) |
| `push` | Trigger re-indexing |
| `check_run.rerequested` | Re-run review on demand |

### 12.3 Check Runs

Review results are posted as GitHub Check Runs with line-level annotations:

- **Failure** (critical): Security vulnerabilities, breaking changes
- **Warning** (high): Performance issues, architectural violations
- **Notice** (medium): Maintainability suggestions
- **Neutral** (low): Style recommendations

---

## 13. Troubleshooting

### Common Issues

#### "Index is stale"

**Problem**: `code-analyzer status` shows index is stale.

**Solution**: Run `code-analyzer analyze .` to re-index. Enable file watching with `code-analyzer analyze . --watch` for automatic updates.

#### "Parse timeout"

**Problem**: Analysis fails with parse timeout for large files.

**Solution**: Increase `parseTimeout` in config or exclude large generated files:
```json
{
  "analysis": {
    "parseTimeout": 60000,
    "skipPatterns": ["generated/**", "*.generated.*"]
  }
}
```

#### "MCP connection refused"

**Problem**: AI agent cannot connect to MCP server.

**Solution**: 
1. Verify the MCP server is running: `code-analyzer mcp --transport http`
2. Check agent configuration: `code-analyzer agent status`
3. Reconfigure: `code-analyzer agent configure --agent <name>`

#### "Out of memory during indexing"

**Problem**: Large codebases cause OOM errors.

**Solution**:
1. Reduce concurrency: `code-analyzer analyze . --concurrency 2`
2. Skip embeddings: `code-analyzer analyze . --skip-embeddings`
3. Increase Node.js memory: `NODE_OPTIONS="--max-old-space-size=8192" code-analyzer analyze .`

#### "No results from semantic search"

**Problem**: Semantic search returns no results.

**Solution**: Ensure embeddings were generated during indexing (not skipped with `--skip-embeddings`). The `@agentix-e/embed-code-ts` package must be installed.

### Getting Help

- **GitHub Issues**: https://github.com/AgentiX-E/code-analyzer/issues
- **Documentation**: https://github.com/AgentiX-E/code-analyzer/tree/main/docs

---

© 2026 Lambertyan. MIT License.
