# Code Analyzer

> **Code intelligence platform.** Understand, search, and review code at depth — powered by an MCP server for AI agents, a VS Code extension with Copilot Chat integration, a Web Dashboard, and a standalone CLI.

[![Status: v0.1.0](https://img.shields.io/badge/status-v0.1.0-blue)](https://github.com/AgentiX-E/code-analyzer)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://github.com/AgentiX-E/code-analyzer/actions)
[![Coverage](https://img.shields.io/badge/coverage-gated%20at%2095%25-brightgreen)](https://github.com/AgentiX-E/code-analyzer/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/AgentiX-E/code-analyzer/badge)](https://securityscorecards.dev/viewer/?uri=github.com/AgentiX-E/code-analyzer)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0+-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Note on coverage:** the badge states the gate, not a measurement — CI enforces **95 % on lines, branches, functions
> and statements**, per file, with an exclusion register and a freshness check on the report itself. The measured number
> lives in the `Coverage` job of each run. It used to say 55 %, hand-written, and it understated the gate by forty points
> for as long as the gate had existed: **a figure no gate reads is a figure nobody is checking**, which is the same
> defect as a figure with no citation, pointing the other way.

---

## Overview

Code Analyzer is a code intelligence platform that helps developers understand, search, and review code at depth. It includes:

- **Knowledge Graph**: Models source code as a typed property graph with 36 node types and 43 relationship types
- **MCP Server**: Exposes 51 tools to AI coding agents via the Model Context Protocol
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

# Rank the files an issue is about, with no index at all - works on a checkout too large to analyse.
# It reads each file's path, its imports and its body, and fuses the three; --no-body skips the last.
code-analyzer locate "the retry policy drops the timeout" -d .

# ...and fuse that reading with a ranking you already have (a search result, an editor's symbol list)
code-analyzer locate "the retry policy drops the timeout" -d . -D candidates.txt

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

| Capability                                                       | Status                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Knowledge Graph (36 node types, 43 relationship types)           | Tested — unit                                                       |
| 19-Phase Analysis Pipeline                                       | Partial — see register                                              |
| 31-Language Parsing (tree-sitter + regex fallback)               | Partial — see register                                              |
| Scope Resolution (3-tier: same-file, cross-file, namespace)      | Tested — unit                                                       |
| PR Review (50+ heuristic rules, 6 categories)                    | Tested — integration                                                |
| Cypher Query Engine (lexer → parser → planner → executor)        | Tested — unit                                                       |
| MCP Server (51 tools, 15 resources, 5 prompts)                   | Partial — see register                                              |
| Agent Tool Selection (100 tasks over the 51-tool catalog)        | Verified — 0.8250 decoyed vs 0.3500 for BM25                        |
| Agent Capability Boundary (profile × effect, read-only role)     | Verified — 0 of 200 read, 96 of 100 when the user asked             |
| VS Code Extension (15 Copilot Chat slash commands)               | Tested — unit                                                       |
| Web Dashboard (6 interactive views)                              | Partial — see register                                              |
| GitHub Integration (webhooks, check runs, cross-repo PR)         | Tested — integration                                                |
| AI Agent Auto-Detection (12 agents)                              | Tested — unit                                                       |
| RBAC (5 roles, 25 permissions)                                   | Tested — unit                                                       |
| Secret Scanner (16 patterns)                                     | Tested — unit                                                       |
| Impact Analysis (BFS-based change propagation)                   | Tested — integration                                                |
| Cross-Repo Analysis (federated search, contract detection)       | Verified — 49/49 imports, 73/73 traces on two real checkouts        |
| Security Rule Families (weak cipher/hash/random, cookie flags)   | Verified — 513/513 vulnerable, 0 false positives on OWASP Benchmark |
| Taint Analysis (source → sink path tracking)                     | Verified — OWASP Benchmark score 1.000 (TPR 1.000 / FPR 0.000)      |
| Graph Store (in-memory + SQLite with FTS5)                       | Tested — unit                                                       |
| Rate Limiting (sliding window)                                   | Tested — unit                                                       |
| Health Checks + Graceful Shutdown                                | Tested — integration                                                |
| Benchmark Framework (ca-bench, real-world PR suite)              | Partial — see register                                              |
| Cost Accounting (per-call ledger, tag totals, spend ceiling)     | Tested — unit and end-to-end                                        |
| Prefix Reuse (instructions lead the prompt, file closes it)      | Tested — 98.05 % reuse against 10.46 %, 30 real requests            |
| Competitor Replay (a corpus result is paid for once)             | Tested — record/replay round trip, identical F1, zero paid calls    |
| Missed-Golden Attribution (every miss has a named cause)         | Tested — 5 disjoint buckets, partition asserted, 10 unit cases      |
| Rejection Shape (a miss says whether the lane looked elsewhere)  | Tested — same-line / within-10 / beyond / no-line, sum asserted     |
| Corpus-Scaled Spend Ceiling (a ceiling that moves with the work) | Tested — 0.15 USD per pull request, floored at the registered run   |
| Measured-Error Interval (an unanswered pair is not a miss)       | Tested — bound published beside F1, retry schedule unit-tested      |

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
|    MCP Server (51 tools)  |  HTTP REST API  |  Webhooks      |
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
| `@code-analyzer/mcp`          | MCP server: 51 tools, 15 resources, 5 prompts, Cypher engine, middleware                      |
| `@code-analyzer/server`       | HTTP REST API server with webhook support, rate limiting, graceful shutdown                   |
| `@code-analyzer/cli`          | CLI: init, analyze, search, review, status, agent commands                                    |
| `@code-analyzer/vscode`       | VS Code extension with Copilot Chat participant (15 slash commands)                           |
| `@code-analyzer/web`          | Web Dashboard with 6 interactive views                                                        |

---

## Benchmarks

<!-- figures: citations:internal-suite-2026-08,real-bug-fix-commits-2026-10,agentic-tools -->

**One figure may be published, and it is not a good one: F1 0.217 on a hundred real bug-fix commits.**

Earlier revisions of this section carried a table of precision, recall and F1 beside SonarQube and CodeRabbit
columns. Two things were wrong with it. The internal suite behind our own figures holds **64** ground-truth issues
across 34 samples — below the **100** this project requires before a figure may be published — and the competitor
columns carried numbers taken from those vendors' documentation rather than measured here. **A number this project
did not measure is not a comparison**, whatever the footnote says.

**That withdrawal was written in one file and left standing in three others**, which is the part worth reporting.
`docs/BENCHMARK_REPORT.md` went on publishing `79.4 % / 73.0 % / F1 0.761` beside two vendors (both now withheld), `CHANGELOG.md`
repeated them in the v0.1.0 entry, and the gate that existed to prevent it read only this file, found no table here
because the section had become prose, printed `nothing to publish, nothing to verify` and exited 0. It had been green
and empty since the table was removed. The figures now live in `docs/archive/withdrawn-2026-08-07/`, the changelog
entry is marked, and the replacement gate reads every Markdown file in the repository.

The measurements that exist are recorded in [`benchmarks/citations.json`](benchmarks/citations.json), with the
dataset size, the date, and an explicit `independentValidation: false` where it applies. The rule is the dataset
floor, not that flag: `scripts/numbers-gate.js` fails the build when any document restates a value from a citation
below the floor, when a document that publishes figures names no source, or when it scans so few figures that it
would have passed by finding nothing.

**Raising the floor is the work, not lowering it.** Two datasets clear it: 1 415 labelled servlets in OWASP
Benchmark, 500 CoSQA questions, 196 human review findings in Alibaba's `aacr-bench`, and 100 real bug-fix commits
whose ground truth is each commit's own patch hunk. The last one is the honest headline: **precision 0.148, recall
0.406, F1 0.217** — the engine reports style where the benchmark asked for bugs. It is published because the
artifact is public and checkable, and it is the number the next iteration is measured against.

## Documentation

- **[Getting Started](docs/getting-started.md)** — Installation, quick start, first analysis
- **[Architecture](docs/ARCHITECTURE.md)** — 7-layer design, data flow, design decisions
- **[Evaluation Contract](docs/EVAL-CONTRACT.md)** — what a figure must satisfy before it may be written down
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
