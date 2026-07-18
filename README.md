# Code Analyzer

> **World-class layered code intelligence platform.** Understand, search, and review code at unprecedented depth — available as an MCP server for AI agents, a VS Code extension with Copilot Chat integration, and a standalone CLI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)

---

## Features

### 🔍 Deep Code Understanding
- **Multi-language graph**: Index 30+ languages into a unified knowledge graph with 25+ entity types and 25+ relationship types
- **Call graph tracing**: Follow function calls across files, packages, and services
- **Scope-aware resolution**: Language-agnostic symbol resolution engine with type inference
- **Architecture analysis**: Automatic community detection, hotspot identification, and dependency mapping

### 🧠 AI-Ready Intelligence
- **MCP Server**: Expose code intelligence as MCP tools for AI coding agents (Claude, Cursor, Codex, etc.)
- **Copilot Chat Participant**: Native VS Code integration with GitHub Copilot for AI-assisted code exploration
- **Code Review Engine**: Plan → Analyze → Filter → Relocate pipeline with review rules and memory compression
- **Semantic Search**: Hybrid BM25 + vector search powered by code-aware embeddings

### ⚡ Production-Grade Performance
- **Fast indexing**: 1M LOC indexed in under 60 seconds
- **Incremental updates**: Re-index only changed files (<500ms for single-file changes)
- **Sub-10ms queries**: BFS graph traversals at interactive speeds
- **Zero data egress**: All processing happens locally — your code never leaves your machine

### 🔗 Flexible Deployment
- **MCP Server**: stdio or HTTP transport for any MCP-compatible agent
- **VS Code Extension**: Full sidebar, inline annotations, and Copilot Chat integration
- **CLI**: 14 commands for scripting and CI/CD pipelines
- **CI/CD**: GitHub Actions, GitLab CI, and custom integration support

---

## Quick Start

### CLI Installation

```bash
npm install -g @code-analyzer/cli
```

```bash
# Index a repository
code-analyzer analyze ./my-project

# Search the knowledge graph
code-analyzer search "authentication flow"

# Trace a call path
code-analyzer trace "login" "database.query"

# Review changes
code-analyzer review --diff
```

### MCP Server Setup

Add to your AI agent's MCP configuration:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@code-analyzer/cli", "mcp"]
    }
  }
}
```

This gives your AI agent access to 20+ code intelligence tools.

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/) or search for "Code Analyzer" in the Extensions view.

Features:
- **Copilot Chat**: Type `@code-analyzer` in Copilot Chat to explore your codebase with AI assistance
- **Graph Sidebar**: Interactive visualization of your code's dependency graph
- **Inline Reviews**: AI-powered code review comments directly in your editor
- **Impact Analysis**: See the blast radius of any change before you make it

---

## Architecture

Code Analyzer follows a strict **seven-layer architecture**:

```
Layer 7: Presentation    ← VS Code Extension, Web UI, CLI
Layer 6: Integration     ← GitHub Actions, GitLab CI, Custom Adapters
Layer 5: Service         ← MCP Server (stdio/HTTP), REST API, WebSocket
Layer 4: Intelligence    ← Search, Embeddings, Code Review, Impact Analysis
Layer 3: Analysis Engine ← Pipeline, Parsing, Resolution, Graph Building
Layer 2: Infrastructure  ← SQLite Store, Git, File System, Worker Pool
Layer 1: Foundation      ← Core Types, Config, Logging, Errors, I18n
```

Each layer depends only on the layers below it, ensuring clean separation of concerns and testability.

---

## Language Support

| Language | Definitions | Imports | Type Resolution | Call Graph | Routes |
|----------|------------|---------|-----------------|------------|--------|
| TypeScript | ✅ | ✅ | ✅ | ✅ | ✅ |
| JavaScript | ✅ | ✅ | ✅ | ✅ | ✅ |
| Python | ✅ | ✅ | ✅ | ✅ | ✅ |
| Go | ✅ | ✅ | ✅ | ✅ | ✅ |
| Java | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kotlin | ✅ | ✅ | ✅ | ✅ | ✅ |
| C# | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rust | ✅ | ✅ | ✅ | ✅ | ✅ |
| C | ✅ | ✅ | ⬜ | ✅ | — |
| C++ | ✅ | ✅ | ⬜ | ✅ | — |
| PHP | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ruby | ✅ | ✅ | ⬜ | ✅ | ✅ |
| Swift | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dart | ✅ | ✅ | ✅ | ✅ | — |

> 30+ languages with varying analysis depth. Additional languages added on a rolling basis.

---

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@code-analyzer/cli` | [![npm](https://img.shields.io/npm/v/@code-analyzer/cli)](https://npmjs.com/@code-analyzer/cli) | CLI entry point |
| `@code-analyzer/mcp` | [![npm](https://img.shields.io/npm/v/@code-analyzer/mcp)](https://npmjs.com/@code-analyzer/mcp) | MCP server |
| `@code-analyzer/server` | [![npm](https://img.shields.io/npm/v/@code-analyzer/server)](https://npmjs.com/@code-analyzer/server) | HTTP REST API |
| `@code-analyzer/analyzer` | [![npm](https://img.shields.io/npm/v/@code-analyzer/analyzer)](https://npmjs.com/@code-analyzer/analyzer) | Analysis engine |
| `@code-analyzer/intelligence` | [![npm](https://img.shields.io/npm/v/@code-analyzer/intelligence)](https://npmjs.com/@code-analyzer/intelligence) | Search and review |
| `@code-analyzer/infra` | [![npm](https://img.shields.io/npm/v/@code-analyzer/infra)](https://npmjs.com/@code-analyzer/infra) | Infrastructure |
| `@code-analyzer/core` | [![npm](https://img.shields.io/npm/v/@code-analyzer/core)](https://npmjs.com/@code-analyzer/core) | Foundation library |
| `@code-analyzer/shared` | [![npm](https://img.shields.io/npm/v/@code-analyzer/shared)](https://npmjs.com/@code-analyzer/shared) | Shared types |

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

Development requires:
- Node.js ≥20
- pnpm ≥9
- Git

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer
pnpm install
pnpm build
pnpm test
```

---

## License

MIT © [Lambertyan](https://github.com/AgentiX-E)

---

<p align="center">
  <b>Code Analyzer</b> — Setting the standard for code intelligence.
</p>
