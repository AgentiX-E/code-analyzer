# Changelog

All notable changes to Code Analyzer are documented in this file.

---

## [0.1.0] — 2026-08-07

### Iteration 8: Core Capability Gaps (I8)

- **Data Flow Analysis:** Program Dependence Graph (PDG) builder with BasicBlock extraction, CFG edges, reaching definitions, and taint path reconstruction
- **Secret Scanner:** 16-pattern detector covering API keys, tokens, private keys, JWT, Slack webhooks, database URLs, cloud credentials, OAuth secrets
- **Incremental Re-indexing:** Git-diff-based stale node detection with granular re-indexing of changed files only
- **Code Standards & Compliance:** Standard template library with 4 check types (ast-pattern, regex, graph-query, metric), auto-fix suggestions, and RBAC integration
- **Advanced Reporting:** Report builder with scope, summaries, findings, recommendations, and action items; PR review auto-summary with merge recommendations
- **Code Evolution Trends:** Multi-metric trend detection with direction-aware reporting and velocity tracking
- **Parallel Indexing:** Multi-project concurrent indexing with supervisor crash recovery
- **Graph Optimization:** Queryable edge storage (bidirectional lookups), graph compression (BFS-based community detection)
- **Semantic Code Search:** BM25 + vector hybrid search with Reciprocal Rank Fusion (k=60)

### Iteration 7: Coverage & Configuration (I7)

- **Vitest Coverage Configuration:** Unified vitest.config.coverage.ts with jest-sonar-reporter
- **Coverage Metrics:** Lines: 55%, Branches: 50%, Functions: 58%, Statements: 54% (post-refactor baseline)
- **SonarQube Properties:** Standard sonar-project.properties for CI integration

### Iteration 6: Language Parsers (I6)

- **10 Tree-sitter Parsers:** Java, Kotlin, C#, Rust, C, C++, PHP, Ruby, Swift, Dart with AST walkers
- **Regex-based Fallback Parsers:** Lua, Scala, Zig, Elixir (12 regex parsers total)
- **Infrastructure-as-Code Parsers:** HCL (Terraform), Dockerfile with IaC graph node types (DockerImage, K8sResource, TerraformResource) and edges (BUILDS_FROM, DEPLOYS_TO, PROVISIONS)
- **Universal Parser Registry:** 20-language parser registry with fallback chain and LanguageQualityMatrix

### Iteration 5: Review Lenses (I5)

- **4 Review Lenses:** Security (CWE-mapped), Performance (complexity/heap/IO), Structure (architectural patterns, SOLID), Test (coverage + quality)
- **Review Swarm:** Multi-agent-style concurrent review orchestration with quarantined file isolation, crash recovery, and supervisor pattern
- **SCIP Export:** Standard Code Intelligence Protocol exporter for interoperability with Sourcegraph and other SCIP-compatible tools

### Iteration 4: Pipeline Modularization (I4)

- **18-Phase Pipeline Refactoring:** Each phase extracted to its own module in `packages/analyzer/src/pipeline/phases/`
- **Parallel Phase Execution:** DAG-based dependency resolution with parallel execution of independent phases
- **Clean Architecture:** TypeRegistry, SemanticModel, and PipelineContext threading through all phases
- **Graph Builder Refinement:** Added graph serialization, reconstruction from SQLite, and batch operations

### Iteration 3: Error Handling (I3)

- **Typed Error System:** `CodeAnalyzerError` base class with ErrorCategory discriminated by code
- **10 Error Categories:** CONFIG, IO, PARSE, RESOLVE, GRAPH, EMBED, LLM, MCP, RATE_LIMIT, INTERNAL
- **Supervisor Pattern:** File quarantine on parse failure, per-phase crash recovery, and peak memory tracking
- **Dead Letter Queue:** Failed operations persisted for retry with exponential backoff in the server package
- **Sliding-Window Rate Limiter:** Configurable window size and per-window request caps

### Iteration 2: Type Safety (I2)

- **Package-Level Vitest Configs:** Individual `vitest.config.ts` per package with path aliases
- **Shared Type Consolidation:** All core types centralized in `@code-analyzer/shared` with discriminated interfaces
- **Type-Only Imports:** Audit and enforcement across the monorepo to reduce build-time coupling
- **Code Quality Automation:** ESLint flat config, Prettier, and pre-commit hooks consolidated

### Iteration 1: Foundation Hygiene (I1)

- **Monorepo Structure:** 10-package pnpm workspace with Turborepo pipeline orchestration
- **Package Configuration:** Individual `package.json`, `tsconfig.json`, build scripts per package
- **CI/CD Pipeline:** GitHub Actions with per-package build/test/lint, CodeQL, and Docker build
- **Docker Multi-Stage Build:** 5-stage optimized Dockerfile (base → builder → runner → cli → vscode-builder)
- **Multi-Arch Support:** `docker buildx` with `linux/amd64` and `linux/arm64` targets
- **Docker Compose:** MCP server + REST API server with security hardening, health checks, and resource limits

---

## Core Architecture (v0.1.0 base)

### Knowledge Graph

- 33 node types, 43 relationship types with in-memory and SQLite (FTS5) storage
- 43 centralized edge type constants in `@code-analyzer/shared/constants/edge-types`
- Graph compression (BFS community detection), batch operations, integrity validation

### Analysis Engine

- 20-language parsing: 10 tree-sitter providers + 12 regex fallback parsers + HCL/Dockerfile
- 19-phase DAG pipeline with parallel execution
- Scope resolution: same-file, cross-file named/default/namespace imports with 3-tier resolution
- Incremental re-indexing with git change detection and stale node isolation

### Intelligence Layer

- 50+ heuristic review rules across 6 categories (security w/ CWE, correctness, performance, maintainability, style, architecture)
- Hybrid search: BM25 + vector semantic search with Reciprocal Rank Fusion
- Impact analysis: BFS-based change propagation with IoU overlap detection
- Taint analysis: source → sink path tracking with sanitizer recognition
- Cross-repo analysis: federated search, contract detection, version matrix, cross-repo PR review
- MinHash + LSH: 128-hash fingerprints for near-clone detection
- 4 review lenses: Security, Performance, Structure, Test

### MCP Server

- 39 tools, 15 resources, 5 prompts with auth middleware and sliding-window rate limiting
- Cypher query engine: lexer → parser → planner → executor with full openCypher read subset

### Developer Experience

- VS Code extension: Copilot Chat participant with 15 slash commands
- Web Dashboard: 6 interactive views (Graph Explorer, Search, Dashboard, Cross-Repo, PR Review, Repo Group Manager)
- CLI: init, analyze, search, review, status, agent commands
- AI agent auto-detection: 12 agents with per-agent MCP configuration templates
- GitHub integration: webhook receiver, check runs, repo sync, REST + GraphQL API client

### Operational Excellence

- Health checks, graceful shutdown, structured JSON logging
- RBAC: 5 roles with 25 granular permissions and audit logging
- Multi-arch Docker images, Docker Compose, Kubernetes manifests, Homebrew formula
- GitHub Action for CI integration with PR comment support

### Benchmarks

- Internal test suite: 20 fixtures, 37 ground-truth issues across 5 languages
- Competitive precision (79.4%), recall (73.0%), F1 (0.761) with zero LLM token cost
- See [BENCHMARK_REPORT.md](docs/BENCHMARK_REPORT.md) for methodology and caveats
