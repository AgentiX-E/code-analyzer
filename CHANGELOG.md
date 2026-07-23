# Changelog

All notable changes to Code Analyzer will be documented in this file.

## [1.0.0] — Unreleased

### 🚀 Ecosystem & Distribution (Iteration 7)

#### npm Publishing
- **12-package pnpm monorepo** with complete npm metadata for all public packages
- `keywords`, `repository`, `bugs`, `homepage` fields on all packages
- `publishConfig.access: "public"` for `@code-analyzer/*` scope
- `files: ["dist"]` for minimal package size
- `engines.node >= 20.0.0` enforcement

#### VS Code Marketplace
- Full marketplace manifest with icon, gallery banner, Q&A link
- Publisher: `agentix`
- 7 Copilot Chat slash commands: `/review`, `/explain`, `/impact`, `/find`, `/deps`, `/refactor`, `/test`

#### Homebrew & Docker
- **Homebrew formula** (`homebrew/code-analyzer.rb`) for `brew install code-analyzer`
- **Multi-arch Docker image** with `linux/amd64` and `linux/arm64` support
- **Docker Bake** (`docker/docker-bake.hcl`) for parallel multi-platform builds
- 5-stage optimized Dockerfile: base → builder → runner → cli → vscode-builder

#### GitHub Action
- **`code-analyzer-action`** composite action for CI integration
- 7 inputs: `github-token`, `standards`, `severity`, `fail-on`, `max-files`, `exclude-patterns`, `languages`
- PR comment integration with Markdown summary
- Reusable workflow (`.github/workflows/code-analyzer.yml`) with PR/review triggers

#### AI Agent Auto-Detection
- **12 supported agents**: Claude Code, Cursor, Windsurf, Continue.dev, Aider, Cline, GitHub Copilot, Codeium, Tabnine, Amazon Q, Roo Code, Augment Code
- 5 detection methods: environment variables, config files, binaries, processes, VS Code extensions
- Per-agent MCP configuration templates
- `code-analyzer setup --auto` for zero-config onboarding
- `code-analyzer setup --agent <name>` for manual agent selection

#### Integration Guides
- **7 comprehensive integration guides**: Claude Code, Cursor, Windsurf, Continue.dev, Aider, Cline, GitHub Copilot
- Quick-start instructions, manual config, verification steps, troubleshooting for each
- Agent-specific features: slash commands, auto-approve, rules integration
- Team setup guide for GitHub Copilot with shared `.github/copilot/mcp.json`

### 📊 Coverage
- **2,871 tests** across 60 test files
- **Lines: 98.51%** | **Branches: 95.25%** | **Functions: 99.8%** | **Statements: 98.51%**

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
