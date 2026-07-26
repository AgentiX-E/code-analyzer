# Code Analyzer

> **World-class code intelligence platform.** Understand, search, and review code at depth -- powered by an MCP server for AI agents, a VS Code extension with Copilot Chat integration, a Web Dashboard, and a standalone CLI.

[![Status: Beta](https://img.shields.io/badge/status-beta-blue)](https://github.com/AgentiX-E/code-analyzer)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://github.com/AgentiX-E/code-analyzer/actions)
[![Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen)](https://github.com/AgentiX-E/code-analyzer)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Quick Start (Zero Config)

```bash
# Install and setup in one command
curl -fsSL https://raw.githubusercontent.com/AgentiX-E/code-analyzer/main/scripts/setup.sh | bash

# Or via npm
npm install -g @code-analyzer/cli

# Initialize a project and index it
cd your-project
code-analyzer init
code-analyzer analyze .

# Search your codebase
code-analyzer search "authentication"

# Review code for issues
code-analyzer review src/

# Auto-detect and configure your AI agent
code-analyzer agent detect
code-analyzer agent configure
```

## What Code Analyzer Does

| Capability | Description |
|---|---|
| **Knowledge Graph** | Builds a rich property graph of your codebase -- 33 node types, 39 relationship types with in-memory and SQLite storage |
| **18-Phase Pipeline** | DAG-based analysis pipeline: scan -> parse -> scope resolution -> communities -> embeddings |
| **PR Review** | 5-stage review pipeline with 50+ rules across 6 categories (security w/ CWE, correctness, performance, maintainability, style, architecture) |
| **Cross-Repo Analysis** | Multi-repo indexing, federated search, API contract detection, version matrix, cross-repo PR review with GitHub check runs |
| **12-Language Tree-sitter** | TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust, Ruby, PHP, Swift, C-like |
| **MCP Server** | 39 tools, 15 resources, 5 prompts for AI agents -- auth, sliding-window rate limiter, Cypher queries |
| **VS Code Extension** | Copilot Chat participant with 7 slash commands: /review, /explain, /impact, /find, /deps, /refactor, /test |
| **Web Dashboard** | 6 interactive views: Graph Explorer, Search, Dashboard, Cross-Repo, PR Review Panel, Repo Group Manager |
| **GitHub Integration** | Webhook receiver, cross-repo PR review bridge, check runs with annotations, repo sync, REST + GraphQL API client |
| **AI Agent Integrations** | Auto-detection and one-click setup for 11 agents: Claude Code, Cursor, Windsurf, Continue.dev, Aider, Cline, GitHub Copilot, Codex, Gemini CLI, Cody, Amazon Q |
| **Enterprise Security** | RBAC (5 roles/25 permissions), audit logging, 16-pattern secret scanner |
| **Operational Excellence** | Health checks, graceful shutdown, retry with exponential backoff, dead letter queue, sliding-window rate limiter |

## Architecture

```
+---------------------------------------------------------------+
|                    Presentation Layer                         |
|     CLI (6 commands)  |  VS Code Extension (Copilot)         |
|     Web Dashboard (6 views)                                   |
+---------------------------------------------------------------+
|                     Integration Layer                         |
|    MCP Server (39 tools)  |  HTTP API  |  Webhook (PR)       |
+---------------------------------------------------------------+
|                     Service Layer                             |
|    Review Pipeline  |  Search Engine  |  Standards            |
+---------------------------------------------------------------+
|                    Intelligence Layer                         |
|  50+ Rules (CWE)  |  Cross-Repo  |  Impact  |  Embeddings    |
+---------------------------------------------------------------+
|                    Analysis Engine                            |
|  12 Tree-sitter  |  18-Phase DAG  |  Graph Builder           |
+---------------------------------------------------------------+
|                   Infrastructure Layer                       |
|  Graph Store  |  Worker Pool  |  Git Ops  |  Parallel        |
+---------------------------------------------------------------+
|                    Foundation Layer                           |
|   Config  |  Logging  |  Errors  |  i18n  |  Metrics         |
+---------------------------------------------------------------+
```

## Package Structure

| Package | Description |
|---|---|
| `@code-analyzer/shared` | Shared types (33 node labels, 39 edges), constants, protocols |
| `@code-analyzer/core` | Foundation: config, logging, errors, i18n, metrics, agent detection, security, RBAC, audit |
| `@code-analyzer/infra` | Infrastructure: graph stores, file discovery, git operations, worker pool |
| `@code-analyzer/analyzer` | Analysis: 12-language tree-sitter, 18-phase pipeline, scope resolution |
| `@code-analyzer/intelligence` | Intelligence: 50+ rules, cross-repo, impact analysis, embeddings, standards, GitHub client |
| `@code-analyzer/mcp` | MCP server: 39 tools, 15 resources, 5 prompts, Cypher engine, middleware |
| `@code-analyzer/server` | HTTP REST API server with webhook support, rate limiting, graceful shutdown |
| `@code-analyzer/cli` | Full CLI: init, analyze, search, review, status, agent |
| `@code-analyzer/vscode` | VS Code extension with Copilot Chat participant (7 slash commands) |
| `@code-analyzer/web` | Web Dashboard with 6 interactive views |

## Documentation

- **[Getting Started](docs/getting-started.md)** -- Installation, quick start, first analysis
- **[Architecture](docs/ARCHITECTURE.md)** -- 7-layer design, data flow, design decisions
- **[MCP Server](docs/MCP-SERVER.md)** -- Tool reference, resources, prompts, configuration
- **[Code Review & PR Review](docs/PR-REVIEW.md)** -- Rules reference, PR review workflow, standards, review swarm
- **[Web Dashboard](docs/WEB-DASHBOARD.md)** -- Interactive UI guide, hooks, API client
- **[GitHub Integration](docs/GITHUB-INTEGRATION.md)** -- Webhooks, cross-repo PR review, check runs, repo sync
- **[Language Support](docs/language-support.md)** -- 12-language tree-sitter coverage
- **[Configuration](docs/CONFIGURATION.md)** -- Options, environment variables, tuning
- **[Integrations](docs/INTEGRATIONS.md)** -- AI agent setup guides

## Development

```bash
# Install dependencies
pnpm install

# Run all tests (5,200+ tests, 95%+ coverage across all dimensions)
pnpm test

# Build all packages
pnpm build

# Run a specific package's tests
pnpm --filter @code-analyzer/cli test

# Lint and typecheck
pnpm lint
pnpm typecheck
```

## Deployment

```bash
# Docker (multi-arch: amd64, arm64)
docker compose up -d

# Homebrew (macOS)
brew install code-analyzer

# Manual build from source
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer
pnpm install && pnpm build
node packages/mcp/dist/index.js
```

## License

MIT (c) Lambertyan
