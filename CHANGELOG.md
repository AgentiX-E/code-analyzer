# Changelog

All notable changes to Code Analyzer will be documented in this file.

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
| 0.1.0 | 2026-07-22 | Alpha release — core architecture established |
