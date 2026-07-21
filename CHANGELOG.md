# Changelog

All notable changes to Code Analyzer will be documented in this file.

## [1.0.0] — Unreleased

### 🚀 Initial Release

**Code Analyzer v1.0.0** — A world-class code intelligence platform with layered architecture, MCP service, and VS Code extension.

### Core Features

- **7-Layer Architecture**: Foundation → Infrastructure → Analysis Engine → Intelligence → Service → Integration → Presentation
- **10-package pnpm monorepo** with Turborepo
- **Knowledge Graph**: 33 node types, 39 relationship types, SQLite with FTS5
- **18-phase DAG pipeline**: scan → structure → parse → markdown → config → crossFile → scopeResolution → routes → tools → di → pruneLocalSymbols → communities → processes → tests → dump → similarity → semantic → embed

### Analysis Engine

- **8 Language Providers**: TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust
- **Scope Resolution**: Same-file, cross-file named/default/namespace imports, 3-tier resolution
- **Unified Parser**: Regex-based parsing with worker pool parallelization
- **Knowledge Graph Builder**: Full graph construction with integrity validation

### Intelligence Layer

- **Hybrid Search**: BM25 + vector semantic search with Reciprocal Rank Fusion (k=60)
- **4-Phase Code Review**: Plan → Analyze → Filter → Relocate with three-zone memory compression
- **Project Standards Engine**: 10 built-in templates, 4 check types (ast-pattern, regex, graph-query, metric)
- **Impact Analysis**: Change impact prediction with IoU overlap detection
- **Trend Analysis**: Multi-metric trend detection with direction-aware reporting
- **MinHash + LSH**: 128-hash fingerprints for near-clone detection
- **Embeddings**: SHA-256 → deterministic vectors (mock) + @agentix-e/embed-code-ts (real)

### MCP Server

- **38 Tools**: Search, Review, Standards, Reports, PDG, Cross-Repo, Indexing, Querying
- **15 Resources**: Architecture, graph, standards, reports, sessions, skills
- **5 Prompts**: Explore, review, impact, refactor, debug
- **Middleware**: Auth (API key), rate limiting, tool policies, request logging
- **Cypher Query Engine**: Full openCypher read subset (lexer → parser → planner → executor)

### VS Code Extension

- **Copilot Chat Participant**: `@code-analyzer` with 6 intent classifiers (explore, search, review, impact, debug, refactor)
- **Sidebar Provider**: Search, review, architecture view
- **Status Bar Integration**: Index status, session state
- **Engine Bridge**: Facade bridging all 5 core packages

### Performance

- 10,000 nodes insert in < 200ms
- 50,000 nodes insert in < 1 second
- Edge traversal in < 5ms on dense graphs
- BFS depth 3 on 1000 nodes in < 10ms
- Full-text search on 10K nodes in < 250ms

### Testing

- **2,440 tests** across 57 test files
- **Coverage**: 98.88% statements, 95.13% branches, 99.81% functions
- **24 real integration tests** (no mocks)
- **performance benchmarks**
- **extended language tests** across 4 new languages

### CI/CD

- GitHub Actions: Build, lint, test, typecheck, CodeQL, PR review, security audit

### Security

- Security policy with vulnerability disclosure timeline
- CodeQL static analysis on every push
- SBOM generation planned for upcoming releases
- API key authentication and rate limiting
- Worker process isolation
- No arbitrary code execution

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | TBD | Initial release |
