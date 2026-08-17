# Code Analyzer

> **Code intelligence platform.** Understand, search, and review code at depth — powered by an MCP server for AI agents, a VS Code extension with Copilot Chat integration, a Web Dashboard, and a standalone CLI.

[![Status: v0.1.0](https://img.shields.io/badge/status-v0.1.0-blue)](https://github.com/AgentiX-E/code-analyzer)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://github.com/AgentiX-E/code-analyzer/actions)
[![Coverage](https://img.shields.io/badge/coverage-55%25-yellow)](https://github.com/AgentiX-E/code-analyzer)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/AgentiX-E/code-analyzer/badge)](https://securityscorecards.dev/viewer/?uri=github.com/AgentiX-E/code-analyzer)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0+-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Note on coverage:** The 55% badge reflects the codebase after iterative refactoring (I1-I8). Test organization is in progress; target is >=80% with organized integration tests.

---

## Overview

Code Analyzer is a code intelligence platform that helps developers understand, search, and review code at depth. It includes:

- **Knowledge Graph**: Models source code as a typed property graph with 36 node types and 43 relationship types
- **MCP Server**: Exposes 45 tools to AI coding agents via the Model Context Protocol
- **VS Code Extension**: Integrates with Copilot Chat for real-time code intelligence
- **Web Dashboard**: Provides 6 interactive views for exploring your codebase
- **CLI**: Standalone command-line interface for analysis, search, and review

---

## Install

```bash
# Install via npm
npm install -g @code-analyzer/cli

# Initialize a project
cd your-project
code-analyzer init
```

---

## Usage

```bash
# Index your codebase
code-analyzer analyze .

# Search your codebase
code-analyzer search "authentication"

# Review code for issues
code-analyzer review src/

# Auto-detect and configure your AI agent
code-analyzer agent detect
code-analyzer agent configure
```

---

## Features

Checkmarks indicate features verified through automated tests.

| Capability | Status |
|---|---|
| Knowledge Graph (36 node types, 43 relationship types) | Verified — unit tested |
| 19-Phase Analysis Pipeline | Verified — integration tested |
| 31-Language Parsing (tree-sitter + regex fallback) | Verified — unit tested |
| Scope Resolution (3-tier: same-file, cross-file, namespace) | Verified — unit tested |
| PR Review (50+ heuristic rules, 6 categories) | Verified — integration tested |
| Cypher Query Engine (lexer → parser → planner → executor) | Verified — unit tested |
| MCP Server (45 tools, 15 resources, 5 prompts) | Verified — integration tested |
| VS Code Extension (15 Copilot Chat slash commands) | Verified — unit tested |
| Web Dashboard (6 interactive views) | Verified — integration tested |
| GitHub Integration (webhooks, check runs, cross-repo PR) | Verified — integration tested |
| AI Agent Auto-Detection (12 agents) | Verified — unit tested |
| RBAC (5 roles, 25 permissions) | Verified — unit tested |
| Secret Scanner (16 patterns) | Verified — unit tested |
| Impact Analysis (BFS-based change propagation) | Verified — integration tested |
| Cross-Repo Analysis (federated search, contract detection) | Verified — integration tested |
| Taint Analysis (source → sink path tracking) | Verified — unit tested |
| Graph Store (in-memory + SQLite with FTS5) | Verified — unit tested |
| Rate Limiting (sliding window) | Verified — unit tested |
| Health Checks + Graceful Shutdown | Verified — integration tested |
| Benchmark Framework (ca-bench, real-world PR suite) | Verified — benchmark tested |

---

## Architecture

The platform is structured as a 10-package pnpm monorepo with clear separation of concerns:

```
+---------------------------------------------------------------+
|                    Presentation Layer                         |
|     CLI        |  VS Code Extension (15 slash commands)      |
|     Web Dashboard (6 views)                                   |
+---------------------------------------------------------------+
|                     Integration Layer                         |
|    MCP Server (45 tools)  |  HTTP REST API  |  Webhooks      |
+---------------------------------------------------------------+
|                     Service Layer                             |
|    Review Engine  |  Search (BM25 + vector)  |  Standards    |
+---------------------------------------------------------------+
|                    Intelligence Layer                         |
|  50+ Rules (CWE)  |  Cross-Repo  |  Impact  |  Embeddings    |
+---------------------------------------------------------------+
|                    Analysis Engine                            |
|  31 Parsers  |  19-Phase DAG  |  Scope Resolution  |  Graph  |
+---------------------------------------------------------------+
|                   Infrastructure Layer                       |
|  Graph Store (SQLite)  |  Git Ops  |  Worker Pool            |
+---------------------------------------------------------------+
|                    Foundation Layer                           |
|   Config  |  Logging  |  Errors  |  RBAC  |  Metrics         |
+---------------------------------------------------------------+
```

### Package Structure

| Package | Description |
|---|---|
| `@code-analyzer/shared` | Types (36 node labels, 43 edges, 43 consts), constants, validation, utilities |
| `@code-analyzer/core` | Foundation: config, logging, errors, i18n, metrics, agent detection, security, RBAC, audit |
| `@code-analyzer/infra` | Infrastructure: graph stores (in-memory, SQLite), file discovery, git operations, concurrency |
| `@code-analyzer/analyzer` | Analysis: 31-language parsers, 19-phase DAG pipeline, scope resolution, auto-index/watch |
| `@code-analyzer/intelligence` | Intelligence: 50+ review rules, cross-repo, impact analysis, embeddings, taint analysis |
| `@code-analyzer/mcp` | MCP server: 45 tools, 15 resources, 5 prompts, Cypher engine, middleware |
| `@code-analyzer/server` | HTTP REST API server with webhook support, rate limiting, graceful shutdown |
| `@code-analyzer/cli` | CLI: init, analyze, search, review, status, agent commands |
| `@code-analyzer/vscode` | VS Code extension with Copilot Chat participant (15 slash commands) |
| `@code-analyzer/web` | Web Dashboard with 6 interactive views |

---

## Benchmarks

Code Analyzer achieves competitive results with zero LLM token cost on internal test suites:

| Metric | Code Analyzer | SonarQube | CodeRabbit |
|--------|:---:|:---:|:---:|
| **Precision** | 79.4% | 72% | 58% |
| **Recall** | 73.0% | 48% | 52% |
| **F1 Score** | 0.761 | 0.576 | 0.549 |
| **Noise Rate** | 0.3x | 0.8x | 2.1x |
| **Cost** | $0 | API cost | API cost |

> **Important caveat:** Benchmarks are based on internal test suites (37 ground-truth issues). Independent validation with a larger dataset (200+ PRs, 1500+ issues) is planned for v0.2.0. Competitor numbers are from published documentation and may differ in direct comparison.

[Full benchmark report →](docs/BENCHMARK_REPORT.md)

---

## Documentation

- **[Getting Started](docs/getting-started.md)** — Installation, quick start, first analysis
- **[Architecture](docs/ARCHITECTURE.md)** — 7-layer design, data flow, design decisions
- **[Benchmark Report](docs/BENCHMARK_REPORT.md)** — Methodology, results, caveats, v0.2.0 roadmap
- **[Deployment Guide](docs/DEPLOYMENT.md)** — Docker, Docker Compose, Kubernetes, env vars
- **[MCP Server](docs/MCP-SERVER.md)** — Tool reference, resources, prompts, configuration
- **[Code Review & PR Review](docs/PR-REVIEW.md)** — Rules reference, PR review workflow
- **[Web Dashboard](docs/WEB-DASHBOARD.md)** — Interactive UI guide, hooks, API client
- **[GitHub Integration](docs/GITHUB-INTEGRATION.md)** — Webhooks, cross-repo PR, check runs
- **[Language Support](docs/language-support.md)** — 31-language coverage and quality matrix
- **[Configuration](docs/CONFIGURATION.md)** — Options, environment variables, tuning
- **[Integrations](docs/INTEGRATIONS.md)** — AI agent setup guides (12 agents)
- **[Troubleshooting](docs/troubleshooting.md)** — Common issues, performance tuning, debugging

---

## Development

```bash
# Install dependencies
pnpm install

# Run unit tests
pnpm test

# Run integration tests
pnpm test:integration

# Run benchmarks
pnpm test:bench

# Build all packages
pnpm build

# Lint and typecheck
pnpm lint && pnpm typecheck
```

---

## Deployment

```bash
# Docker Compose (recommended)
docker compose up -d

# Docker (single container)
docker build -t code-analyzer:latest .
docker run -d -p 3000:3000 code-analyzer:latest

# Kubernetes
kubectl apply -f k8s/

# Homebrew (macOS)
brew install code-analyzer
```

See **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** for full deployment documentation including resource requirements, health checks, environment variables, and Kubernetes manifests.

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute, set up your development environment, and submit pull requests.

---

## License

MIT (c) Lambertyan
