# Changelog

All notable changes to Code Analyzer will be documented in this file.

## [0.2.0] — Unreleased

### Distribution Pipeline — npm, Docker Multi-arch, VS Code Marketplace

This release establishes the complete distribution pipeline for Code Analyzer, enabling publishing to npm, multi-architecture Docker images, and the VS Code Marketplace.

### Iteration 1: Monorepo Architecture & Foundation

- 10-package pnpm monorepo with Turborepo build orchestration
- 7-layer architecture: Foundation → Infrastructure → Analysis Engine → Intelligence �� Service → Integration → Presentation
- Shared type system: 33 node types, 39 relationship types
- Foundation package (`@code-analyzer/core`): config, logging, error taxonomy, i18n, lifecycle hooks, metrics
- Strict TypeScript with ESLint 9 flat config and Prettier formatting

### Iteration 2: Infrastructure & Data Layer

- Infrastructure package (`@code-analyzer/infra`): file discovery, file watcher, git operations (diff/history)
- Worker pool with circuit breaker pattern
- Parse cache with LRU eviction
- In-memory graph store with full-text search, BFS traversal, transactions, and integrity validation
- Test infrastructure: unit, integration, property-based, and e2e test configurations

### Iteration 3: Analysis Engine

- Analysis engine (`@code-analyzer/analyzer`): 18-phase DAG pipeline with Kahn's algorithm topological sort
- Cypher query engine: lexer, parser, planner, and executor for openCypher read operations
- 8 language provider interfaces: TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust
- Code review engine: heuristic-based Plan → Analyze → Filter → Relocate pipeline
- Benchmarking suite with vitest bench

### Iteration 4: Intelligence Layer

- Intelligence package (`@code-analyzer/intelligence`): search, embeddings, code review, impact analysis
- Cross-repo intelligence for AI agents
- Standards check system for project conventions
- PR review automation with GitHub Actions integration
- Deduplication of review comments and markup-based tracking

### Iteration 5: MCP Server & REST API

- MCP server (`@code-analyzer/mcp`): 38 tool definitions, 15 resources, 5 prompts
- Middleware: authentication, rate limiting, structured logging
- Dual transport: stdio and HTTP/SSE
- Server package (`@code-analyzer/server`): HTTP REST API
- Docker Compose with MCP + server services, health checks, and resource limits

### Iteration 6: CLI & VS Code Extension

- CLI package (`@code-analyzer/cli`): command-line interface with Commander.js
- VS Code extension (`@code-analyzer/vscode`): sidebar, chat participant, commands
- Configuration: auto-index, index modes, max file size
- Web dashboard scaffold (`@code-analyzer/web`)
- Automated PR Review workflow with inline comments, summary, standards check, and security audit

### Iteration 7: Distribution Pipeline

- **npm publishing**: package.json configured with keywords, repository, files array, and publish script
- **Docker multi-arch**: multi-stage Dockerfile with `node:20-alpine`, `linux/amd64` + `linux/arm64` support, non-root user, health check
- **Docker Bake**: `docker-bake.hcl` for multi-arch builds with version tags
- **GitHub Actions**: `publish-npm.yml`, `publish-docker.yml`, `publish-vscode.yml` triggered on release publish
- **VS Code Marketplace**: automated publishing to VS Code Marketplace and Open VSX Registry
- **One-click install**: `scripts/setup.sh` with OS detection, dependency installation, MCP editor configuration
- **CI enhancements**: coverage threshold checks, benchmark regression detection (>20% threshold), consolidated lint+format

### What's Next (v0.3.0)

- Implement actual parsing in language providers
- SQLite persistence for the graph store
- Complete MCP tool implementations with real data
- Build VS Code extension UI panels
- Add web dashboard with React
- Production performance optimization

---

## [0.1.0] — 2026-07-22 (Alpha Release)

### Alpha Release — Core Architecture Established

**Code Analyzer v0.1.0** is an alpha release establishing the foundational architecture for a code intelligence platform with layered design, MCP service, and VS Code extension.

This release delivers a solid architectural foundation with working infrastructure, MCP server framework, and Cypher query engine. Most analysis pipeline phases and intelligence features are scaffolded but return placeholder data. The project is approximately 30-40% complete.

### What's Implemented

- **7-Layer Architecture**: Foundation → Infrastructure → Analysis Engine → Intelligence → Service → Integration → Presentation (layers defined, dependencies enforced)
- **10-package pnpm monorepo** with Turborepo
- **Shared type system**: 33 node types, 39 relationship types fully defined
- **Foundation layer** (`@code-analyzer/core`): Config loading/validation, structured logging, error taxonomy, i18n, lifecycle hooks, metrics collection
- **Infrastructure layer** (`@code-analyzer/infra`): File discovery, file watcher, git operations (diff/history), worker pool with circuit breaker, parse cache, in-memory graph store with FTS, BFS, transactions, and integrity validation
- **Pipeline orchestrator**: 18-phase DAG pipeline with Kahn's algorithm topological sort, dependency resolution, context threading, and error resilience
- **MCP server framework** (`@code-analyzer/mcp`): 38 tool definitions, 15 resources, 5 prompts, middleware (auth, rate limiting, logging), stdio and HTTP transports
- **Cypher query engine**: Lexer, parser, planner, and executor for subset of openCypher read operations
- **Language provider scaffolds**: 8 language provider interfaces (TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust)
- **Code review engine**: Heuristic-based review pipeline (Plan → Analyze → Filter → Relocate)

### What's Scaffolded (Placeholder/Stub)

- All 18 pipeline phases return success with zero counts
- Graph store is in-memory `Map` (no SQLite persistence)
- Most MCP tool implementations return placeholder/empty data
- Language providers have scaffolding but no real parsing
- Intelligence layer (search, review, impact, standards, embeddings) is skeletal
- VS Code extension, web UI, and CLI have package structure only
- No CI/CD integration testing completed

### Testing

- Comprehensive unit tests for core, infra, analyzer, and MCP packages
- Tests validate the architecture, type system, and package interfaces
- Test coverage reflects the implemented code (foundation + infrastructure layers)

### Next Steps

- Implement actual parsing in language providers
- Implement pipeline phases with real analysis logic
- Add SQLite persistence layer
- Build out intelligence layer features (search, impact, embeddings)
- Complete MCP tool implementations
- Build VS Code extension UI

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.2.0 | Unreleased | Distribution pipeline — npm, Docker multi-arch, VS Code Marketplace |
| 0.1.0 | 2026-07-22 | Alpha release — core architecture established |
