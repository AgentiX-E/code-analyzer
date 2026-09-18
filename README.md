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
- **MCP Server**: Exposes 48 tools to AI coding agents via the Model Context Protocol
- **VS Code Extension**: Integrates with Copilot Chat for real-time code intelligence
- **Web Dashboard**: Provides 6 interactive views for exploring your codebase
- **CLI**: Standalone command-line interface for analysis, search, and review

---

## Install

**Not published to npm yet** — `npm install -g @code-analyzer/cli` returns 404, so this section describes the
only path that works today: build from source.

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer
pnpm install
pnpm build

# then, from your project
node ../code-analyzer/packages/cli/dist/index.js init
```

The exact entry point for your build is in [the CLI package](packages/cli/README.md). Publishing to npm is tracked
as its own task; until it happens, the command above is the one that runs.

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

Status words are defined in [`benchmarks/status-register.json`](benchmarks/status-register.json) and enforced by
`scripts/readme-status-gate.js`: **`Tested`** means a test exercises the feature and does not claim it is correct;
**`Partial`** means the register records a qualification, and the register states it in full.

Checkmarks indicate features verified through automated tests.

| Capability                                                  | Status                 |
| ----------------------------------------------------------- | ---------------------- |
| Knowledge Graph (36 node types, 43 relationship types)      | Tested — unit          |
| 19-Phase Analysis Pipeline                                  | Partial — see register |
| 31-Language Parsing (tree-sitter + regex fallback)          | Partial — see register |
| Scope Resolution (3-tier: same-file, cross-file, namespace) | Tested — unit          |
| PR Review (50+ heuristic rules, 6 categories)               | Tested — integration   |
| Cypher Query Engine (lexer → parser → planner → executor)   | Tested — unit          |
| MCP Server (48 tools, 15 resources, 5 prompts)              | Partial — see register |
| VS Code Extension (15 Copilot Chat slash commands)          | Tested — unit          |
| Web Dashboard (6 interactive views)                         | Partial — see register |
| GitHub Integration (webhooks, check runs, cross-repo PR)    | Tested — integration   |
| AI Agent Auto-Detection (12 agents)                         | Tested — unit          |
| RBAC (5 roles, 25 permissions)                              | Tested — unit          |
| Secret Scanner (16 patterns)                                | Tested — unit          |
| Impact Analysis (BFS-based change propagation)              | Tested — integration   |
| Cross-Repo Analysis (federated search, contract detection)  | Tested — integration   |
| Taint Analysis (source → sink path tracking)                | Partial — see register |
| Graph Store (in-memory + SQLite with FTS5)                  | Tested — unit          |
| Rate Limiting (sliding window)                              | Tested — unit          |
| Health Checks + Graceful Shutdown                           | Tested — integration   |
| Benchmark Framework (ca-bench, real-world PR suite)         | Partial — see register |

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
|    MCP Server (48 tools)  |  HTTP REST API  |  Webhooks      |
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

| Package                       | Description                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `@code-analyzer/shared`       | Types (36 node labels, 43 edges, 43 consts), constants, validation, utilities                 |
| `@code-analyzer/core`         | Foundation: config, logging, errors, i18n, metrics, agent detection, security, RBAC, audit    |
| `@code-analyzer/infra`        | Infrastructure: graph stores (in-memory, SQLite), file discovery, git operations, concurrency |
| `@code-analyzer/analyzer`     | Analysis: 31-language parsers, 19-phase DAG pipeline, scope resolution, auto-index/watch      |
| `@code-analyzer/intelligence` | Intelligence: 50+ review rules, cross-repo, impact analysis, embeddings, taint analysis       |
| `@code-analyzer/mcp`          | MCP server: 48 tools, 15 resources, 5 prompts, Cypher engine, middleware                      |
| `@code-analyzer/server`       | HTTP REST API server with webhook support, rate limiting, graceful shutdown                   |
| `@code-analyzer/cli`          | CLI: init, analyze, search, review, status, agent commands                                    |
| `@code-analyzer/vscode`       | VS Code extension with Copilot Chat participant (15 slash commands)                           |
| `@code-analyzer/web`          | Web Dashboard with 6 interactive views                                                        |

---

## Benchmarks

**No benchmark figures are published yet, and that is deliberate.**

Earlier revisions of this section carried a table of precision, recall and F1 beside SonarQube and CodeRabbit
columns. Two things were wrong with it. The internal suite behind our own figures holds **49** ground-truth issues
— below the **100** this project now requires before any figure may be published — and the competitor columns
carried numbers taken from those vendors' documentation rather than measured here. **A number this project did not
measure is not a comparison**, whatever the footnote says.

The measurements that exist are recorded in [`benchmarks/citations.json`](benchmarks/citations.json), with the
dataset size, the date, and an explicit `independentValidation: false` where it applies.
`scripts/readme-numbers-gate.js` runs in CI and fails the build when a figure in this section has no citation,
when its artifact is missing, when its dataset is below the declared minimum, or when it is marked as not
independently validated.

Raising `minimumGroundTruth` is the work, not lowering it: the plan is a dataset of at least 100 ground-truth
issues with the protocol recorded — source, date, and arm — so that a published number can be checked rather than
believed.

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
