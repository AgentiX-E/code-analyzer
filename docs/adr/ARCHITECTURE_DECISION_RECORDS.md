# Code Analyzer — Architecture Decision Records

**Author**: Lambertyan  
**Date**: 2026-08-05  
**Status**: Active

---

## ADR-001: Monorepo Structure with pnpm Workspaces

**Status**: Accepted  
**Date**: 2026-07-01

### Context

The project spans 10 packages (shared, core, infra, analyzer, intelligence, mcp, cli, server, vscode, web) with complex interdependencies.

### Decision

Use pnpm workspaces with Turborepo orchestration. Each package has independent `tsconfig.json`, `package.json`, and `vitest` config.

### Consequences

- ✅ Zero-hoist works avoid phantom dependencies
- ✅ Turborepo enables parallel builds with dependency ordering
- ❌ Cross-package type resolution requires workspace:* references in package.json

---

## ADR-002: Tree-sitter for Multi-Language Parsing

**Status**: Accepted  
**Date**: 2026-07-03

### Context

Need to parse 32+ programming languages for AST-based analysis.

### Decision

Use tree-sitter for AST parsing. Each language has an independent provider implementing a common `LanguageProvider` interface.

### Consequences

- ✅ Incremental parsing, error recovery, 32 languages supported
- ✅ Pure JavaScript bindings for most languages
- ❌ Some grammars require native C compilation (regex fallback for Rust, C++, Kotlin)

---

## ADR-003: SQLite for Persistent Graph Storage

**Status**: Accepted  
**Date**: 2026-07-05

### Context

Need persistent storage for knowledge graphs (nodes, edges, metadata) with efficient query support.

### Decision

Use SQLite via `better-sqlite3` with FTS5 for full-text search and WAL mode for concurrent reads.

### Consequences

- ✅ Embedded, zero-config, ACID transactions
- ✅ FTS5 enables fast BM25 text search with CJK support
- ❌ Not distributed (single-node); cross-project analysis uses per-project databases

---

## ADR-004: MCP-First Transport Architecture

**Status**: Accepted  
**Date**: 2026-07-07

### Context

Need to serve code intelligence to AI coding agents via the Model Context Protocol.

### Decision

The MCP server is the primary integration surface. LLM access happens at the MCP client side, not within Code Analyzer.

### Consequences

- ✅ Standard protocol adopted by major AI coding tools
- ✅ Clean separation: Code Analyzer provides tools, client provides LLM
- ✅ Three transport modes: stdio (local), HTTP+SSE (remote), WebSocket (streaming)
- ❌ No built-in LLM integration per project requirement #2

---

## ADR-005: Embedding Backend Selection

**Status**: Accepted  
**Date**: 2026-07-09

### Context

Need vector embeddings for semantic code search.

### Decision

Primary: `@agentix-e/embed-code-node` (nomic-embed-code ONNX model, 768-dim, int8 quantized). Fallback: n-gram tokenization with MurmurHash3 for deterministic content-aware vectors.

### Consequences

- ✅ Zero API cost — runs entirely locally
- ✅ No data exfiltration — code never leaves the machine
- ✅ Graceful degradation when ONNX runtime unavailable
- ❌ ONNX model download required (~137MB)

---

## ADR-006: 18-Phase DAG Pipeline for Code Analysis

**Status**: Accepted  
**Date**: 2026-07-11

### Context

Need to orchestrate complex multi-pass code analysis including parsing, scope resolution, graph building, community detection, embedding generation.

### Decision

Use a directed acyclic graph (DAG) of 18 phases with Kahn's algorithm for topological ordering and parallel execution of independent phases.

### Consequences

- ✅ Deterministic execution order
- ✅ Parallel execution where phase dependencies permit
- ✅ Each phase independently testable
- ❌ Phase count grows with new features; need discipline to keep phases focused

---

## ADR-007: Code Review Architecture

**Status**: Accepted  
**Date**: 2026-07-13

### Context

Need to provide PR/code review with actionable findings.

### Decision

Hybrid approach: deterministic heuristic engine for structural/security checks + optional LLM review lane for nuanced analysis. Heuristic engine runs locally with zero token cost.

### Consequences

- ✅ Deterministic results for structural issues (no LLM hallucination)
- ✅ Zero token cost for heuristic checks
- ✅ Configurable rules engine with 46+ built-in rules
- ❌ Heuristic-only review misses context-dependent issues requiring semantic understanding

---

## ADR-008: Cross-Repository Federation

**Status**: Accepted  
**Date**: 2026-07-15

### Context

Need to analyze relationships across multiple GitHub repositories (microservices, shared libraries).

### Decision

Implement federated search and cross-repo PR review. Each repo maintains its own index; the federation layer queries across indices and correlates findings.

### Consequences

- ✅ Each repo independently indexable
- ✅ Cross-repo PR review with contract validation
- ✅ Repo groups with version matrix tracking
- ❌ Federation adds latency proportional to repo count

---

## ADR-009: Program Dependence Graph Strategy

**Status**: Accepted  
**Date**: 2026-08-04

### Context

Need statement-level control and data dependence for security analysis.

### Decision

Implement three-layer PDG: (1) Post-dominator tree via Cooper-Harvey-Kennedy algorithm, (2) Control dependence via Cytron-Ferrante-Rosen-Wegman-Zadeck dominance frontier, (3) Reaching definitions via dual dense/SSA-sparse solver.

### Consequences

- ✅ Statement-level precision for data flow analysis
- ✅ Auto-selection between dense (small functions) and sparse (large/looping functions)
- ❌ Requires CFG construction per function (parsing cost)

---

## ADR-010: Taint Analysis Model

**Status**: Accepted  
**Date**: 2026-08-04

### Context

Need source→sink security vulnerability detection across function boundaries.

### Decision

Two-rule model: (a) worklist propagation over def→use facts with monotone exclusion sets, (b) statement-local source→sink detection. Inter-procedural: Sharir-Pnueli fixpoint over FunctionSummary objects composed across the CALLS graph.

### Consequences

- ✅ Kind-set exclusion model for precise sanitizer tracking
- ✅ Generative return propagation for transitive taint
- ❌ Context-insensitive (callee name join, not call-site specific)

---

## ADR-011: Type Inference via Hybrid LSP

**Status**: Accepted  
**Date**: 2026-08-04

### Context

Need cross-file type resolution for accurate call graph and refactoring support.

### Decision

Implement Hybrid LSP architecture: (1) TypeRep tagged union with 20 type kinds, (2) FNV-1a hashed TypeRegistry with Tier-2 overlay pattern, (3) Import-map resolution for cross-file lookups. Initial support for TypeScript and Python.

### Consequences

- ✅ O(1) type lookup via FNV-1a hash
- ✅ Tier-2 overlay enables parallel per-file processing
- ✅ Extensible to 12 languages over time
- ❌ Requires pre-built stdlib type stubs per language

---

## ADR-012: Cross-Service Linking

**Status**: Accepted  
**Date**: 2026-08-04

### Context

Need to detect service-to-service dependencies (HTTP, gRPC, GraphQL, tRPC, channels).

### Decision

Pattern-based detection: library identification in resolved qualified names → edge type classification → route node synthesis. 200+ HTTP library patterns, 80+ channel detection rules across 8 languages.

### Consequences

- ✅ Detects Express, Fastify, Flask, Django, Gin, Spring, ASP.NET, and more
- ✅ Channel detection for Socket.IO, EventEmitter, Kafka, RabbitMQ, Redis
- ❌ Pattern-based (no runtime tracing); may miss dynamic/dependency-injected routes

---

## ADR-013: Enterprise Security Model

**Status**: Accepted  
**Date**: 2026-08-05

### Context

Need role-based access control, tamper-evident audit logging, secret scanning, and rate limiting for enterprise deployments.

### Decision

- RBAC: 5 roles (viewer, auditor, developer, maintainer, admin) with 26 granular permissions
- Audit: SHA-256 hash chained log entries with SIEM-compatible export (JSON Lines/CSV)
- Secrets: 16 regex pattern categories + Shannon entropy detection with context-aware exclusion
- Rate limiting: Token bucket algorithm with per-key configurable limits

### Consequences

- ✅ Granular permission model for multi-tenant deployments
- ✅ Immutable audit trail with cryptographic integrity verification
- ✅ Pre-commit and CI secret scanning
- ✅ Fair resource allocation under load

---

## ADR-014: LRU Cache Strategy

**Status**: Accepted  
**Date**: 2026-08-05

### Context

Need caching at multiple hot-path layers (parse results, graph queries, embeddings, LSP resolution).

### Decision

Implement a generic O(1) LRU cache with: double-linked list + hash map, configurable maxSize/maxBytes, per-entry TTL with lazy+sweep expiration, eviction callbacks, and atomic getOrSet() pattern.

### Consequences

- ✅ Shared cache implementation across all packages
- ✅ Memory budget mode prevents unbounded growth
- ✅ Eviction callbacks enable resource cleanup (e.g., ONNX session handles)
- ❌ In-memory only (no persistence); cold start on restart

---

## ADR-015: Scientific Benchmark Methodology

**Status**: Accepted  
**Date**: 2026-08-04

### Context

Need credible, reproducible benchmarks to validate code review quality.

### Decision

Implement statistical rigor: bootstrap confidence intervals (B=10,000, percentile method), McNemar's test for paired comparison, IoU-based line matching with configurable threshold, per-category/per-severity/per-language breakdowns.

### Consequences

- ✅ Statistically valid confidence intervals
- ✅ Proper hypothesis testing for system comparison
- ✅ Fine-grained metrics by category/severity/language
- ❌ Requires 200+ PR, 1,500+ ground-truth corpus (in progress)

---

**Status Summary**: 15 ADRs recorded — 15 Accepted, 0 Proposed, 0 Deprecated
