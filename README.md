# Code Analyzer

> **World-class code intelligence platform.** Understand, search, and review code at depth — powered by an MCP server for AI agents, a VS Code extension with Copilot Chat integration, and a standalone CLI.

[![Status: Beta](https://img.shields.io/badge/status-beta-blue)](https://github.com/AgentiX-E/code-analyzer)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://github.com/AgentiX-E/code-analyzer/actions)
[![Coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)](https://github.com/AgentiX-E/code-analyzer)
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
| **Knowledge Graph** | Builds a rich property graph of your codebase — 33 node types, 39 relationship types with SQLite+FTS5 persistence |
| **18-Phase Pipeline** | DAG-based analysis pipeline: scan → parse → scope resolution → communities → embeddings |
| **PR Review** | 5-stage review pipeline with 50 deterministic rules across 6 categories (security w/ CWE, correctness, performance, maintainability, style, architecture) |
| **Cross-Repo Analysis** | Multi-repo indexing, federated search, API contract detection, version matrix, cross-repo PR review |
| **12-Language Tree-sitter** | TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust, Ruby, PHP, Swift, C-like |
| **MCP Server** | 38 tools, 15 resources, 5 prompts for AI agents — auth, rate limiting, Cypher queries |
| **VS Code Extension** | Copilot Chat participant with 7 slash commands: /review, /explain, /impact, /find, /deps, /refactor, /test |
| **AI Agent Integrations** | Auto-detection and one-click setup for 12 agents: Claude Code, Cursor, Windsurf, Continue.dev, Aider, Cline, GitHub Copilot, Codeium, Tabnine, Amazon Q, Roo Code, Augment Code |
| **Enterprise Security** | RBAC (5 roles/25 permissions), audit logging, 16-pattern secret scanner, OAuth2/JWT |
| **Operational Excellence** | Health checks, Prometheus metrics, graceful shutdown, retry with exponential backoff, dead letter queue |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Presentation Layer                     │
│     CLI (full commands)  │  VS Code Extension (Copilot)  │
├──────────────────────────────────────────────────────────┤
│                     Integration Layer                     │
│    MCP Server (38 tools)  │  HTTP API  │  Webhook (PR)   │
├──────────────────────────────────────────────────────────┤
│                     Service Layer                         │
│    Review Pipeline  │  Search Engine  │  Standards        │
├──────────────────────────────────────────────────────────┤
│                    Intelligence Layer                     │
│  50 Rules (CWE)  │  Cross-Repo  │  Impact  │  Embeddings │
├──────────────────────────────────────────────────────────┤
│                    Analysis Engine                        │
│  12 Tree-sitter  │  18-Phase DAG  │  Graph Builder       │
├──────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                    │
│  SQLite+FTS5  │  Worker Pool  │  Git Ops  │  Parallel     │
├──────────────────────────────────────────────────────────┤
│                    Foundation Layer                       │
│   Config  │  Logging  │  Errors  │  i18n  │  Metrics      │
└──────────────────────────────────────────────────────────┘
```

## Package Structure

| Package | Description |
|---|---|
| `@code-analyzer/shared` | Shared types (33 node labels, 39 edges), constants, protocols |
| `@code-analyzer/core` | Foundation: config, logging, errors, i18n, metrics, agent detection, security |
| `@code-analyzer/infra` | Infrastructure: SQLite+FTS5 store, file discovery, git operations, worker pool |
| `@code-analyzer/analyzer` | Analysis: 12-language tree-sitter, 18-phase pipeline, scope resolution |
| `@code-analyzer/intelligence` | Intelligence: 50 rules, cross-repo, impact analysis, embeddings, standards |
| `@code-analyzer/mcp` | MCP server: 38 tools, 15 resources, 5 prompts, Cypher engine, middleware |
| `@code-analyzer/server` | HTTP REST API server |
| `@code-analyzer/cli` | Full CLI: init, analyze, search, review, status, agent |
| `@code-analyzer/vscode` | VS Code extension with Copilot Chat participant |
| `@code-analyzer/web` | Web UI (under development) |

## Documentation

- **[Getting Started](docs/getting-started.md)** — Installation, quick start, first analysis
- **[Architecture](docs/ARCHITECTURE.md)** — 7-layer design, data flow, design decisions
- **[MCP Server](docs/MCP-SERVER.md)** — Tool reference, resources, prompts, configuration
- **[Code Review](docs/CODE-REVIEW.md)** — Rules reference, PR review workflow, standards
- **[Language Support](docs/language-support.md)** — 12-language tree-sitter coverage
- **[Configuration](docs/CONFIGURATION.md)** — Options, environment variables, tuning
- **[Integrations](docs/INTEGRATIONS.md)** — 12 AI agent setup guides
- **[Integration Guides](docs/integration/)** — Per-agent detailed instructions

## Development

```bash
# Install dependencies
pnpm install

# Run all tests (3,690+ tests, 99%+ coverage)
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

MIT © Lambertyan
