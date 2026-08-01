# Code Analyzer — User Guide

> Comprehensive guide for every feature and use case. Learn to install, configure, and use Code Analyzer effectively across all scenarios.

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Analyzing Your Codebase](#analyzing-your-codebase)
4. [Searching Code](#searching-code)
5. [PR Code Review](#pr-code-review)
6. [Cross-Repository Analysis](#cross-repository-analysis)
7. [VS Code Extension](#vs-code-extension)
8. [MCP Server for AI Agents](#mcp-server-for-ai-agents)
9. [Web Dashboard](#web-dashboard)
10. [GitHub Integration](#github-integration)
11. [Configuration Reference](#configuration-reference)
12. [Performance Tuning](#performance-tuning)
13. [Troubleshooting](#troubleshooting)

---

## Installation

### Via npm (Recommended)

```bash
npm install -g @code-analyzer/cli
```

### Via curl (Zero-Config)

```bash
curl -fsSL https://raw.githubusercontent.com/AgentiX-E/code-analyzer/main/scripts/setup.sh | bash
```

### Via Homebrew (macOS)

```bash
brew install code-analyzer
```

### Via Docker

```bash
docker compose -f https://raw.githubusercontent.com/AgentiX-E/code-analyzer/main/docker-compose.yml up -d
```

### Verify Installation

```bash
code-analyzer --version
# Code Analyzer v0.2.0
```

---

## Quick Start

```bash
# 1. Navigate to your project
cd your-project

# 2. Initialize Code Analyzer
code-analyzer init

# 3. Index your codebase
code-analyzer analyze .

# 4. Search for anything
code-analyzer search "authentication"

# 5. Review code changes
code-analyzer review src/

# 6. Check indexing status
code-analyzer status
```

---

## Analyzing Your Codebase

### Full Index

```bash
# Index the entire project
code-analyzer analyze .

# Index a specific directory
code-analyzer analyze src/

# Index with verbose output
code-analyzer analyze . --verbose
```

### Incremental Indexing

Code Analyzer automatically detects changed files and only re-indexes what is needed. After the initial index:

```bash
# Re-index only changed files (fast)
code-analyzer analyze .

# Force full re-index
code-analyzer analyze . --force
```

### Supported Languages

Code Analyzer supports 30 programming and configuration languages out of the box:

| Category | Languages |
|----------|-----------|
| **Web** | TypeScript, JavaScript, HTML, CSS, SCSS, Vue, Svelte |
| **Backend** | Python, Go, Java, Kotlin, C#, Rust, PHP, Ruby |
| **Mobile** | Swift, Dart |
| **Systems** | C, C++, Zig |
| **Data** | R, Scala, Groovy, Elixir, Lua |
| **IaC** | Dockerfile, HCL (Terraform), YAML, JSON, TOML |
| **Docs** | Markdown, SQL, Bash |

---

## Searching Code

### Basic Search

```bash
code-analyzer search "UserService"
code-analyzer search "authenticate" --type function --language typescript
code-analyzer search "middleware" --path "src/api/**"
```

### Cypher Queries (Advanced)

```bash
code-analyzer cypher "MATCH (f:Function)-[:CALLS]->(t:Function) WHERE t.name CONTAINS 'auth' RETURN f.name, t.name"
code-analyzer cypher "MATCH (r:Route) RETURN r.method, r.path ORDER BY r.path ASC"
```

---

## PR Code Review

```bash
code-analyzer review                           # staged changes
code-analyzer review --from main --to feature  # branch range
code-analyzer review --commit abc123           # single commit
code-analyzer review --standards security-focused
```

### Customizing Review Rules

Create a `.code-analyzer.yml` in your project root:

```yaml
review:
  rules:
    security: [no-sql-injection, no-xss, no-hardcoded-secrets]
    correctness: [no-null-pointer, no-unchecked-async, no-missing-error-handling]
    performance: [no-n-plus-one, no-memory-leaks]
    style: [no-console-log]
  ignore: ["**/*.test.ts", "**/*.spec.ts", "**/generated/**"]
```

---

## Cross-Repository Analysis

```bash
code-analyzer repo-group create my-services --repo frontend ./frontend --repo backend ./backend
code-analyzer cross-repo search "payment" --group my-services
code-analyzer cross-repo impact --interface UserDTO --group my-services
```

---

## VS Code Extension

### Copilot Chat Slash Commands

| Command | What it does |
|---------|-------------|
| `/review` | Review current file or selection |
| `/explain` | Explain code structure |
| `/impact` | Analyze change impact |
| `/find` | Find symbols and references |
| `/deps` | Show dependencies |
| `/refactor` | Get refactoring suggestions |
| `/test` | Get test suggestions |

---

## MCP Server for AI Agents

```bash
code-analyzer agent configure --agent claude-code
code-analyzer mcp serve
code-analyzer mcp serve --transport sse --port 3000
```

Supports 11 AI agents: Claude Code, Cursor, Windsurf, Continue.dev, Aider, Cline, GitHub Copilot, Codex, Gemini CLI, Cody, Amazon Q.

---

## Configuration Reference

### `.code-analyzer.yml`

```yaml
project:
  name: my-project
  languages: [typescript, python]

analysis:
  maxFileSize: 10485760
  excludePatterns: ["node_modules/**", "dist/**", "**/*.generated.*"]
  parallelWorkers: 4
  incrementalIndexing: true

search:
  defaultLimit: 20
  enableFuzzySearch: true
  enableVectorSearch: true

review:
  autoReviewOnPR: true
  commentOnPR: true
  bundleRelatedFiles: true

mcp:
  transport: stdio
  port: 3000
  rateLimit: { enabled: true, maxRequestsPerMinute: 60 }

embedding:
  provider: nomic-embed-code
  cacheSize: 10000

lsp:
  enabled: true
  maxServers: 3
```

---

## Performance Tuning

### Small Projects (< 10K LOC)
```yaml
analysis: { parallelWorkers: 2 }
search: { enableVectorSearch: false }
```

### Medium Projects (10K-100K LOC)
```yaml
analysis: { parallelWorkers: 4 }
embedding: { cacheSize: 5000 }
```

### Large Projects (> 100K LOC)
```yaml
analysis: { parallelWorkers: 8 }
embedding: { cacheSize: 20000, batchSize: 64 }
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Index takes too long | Exclude `node_modules`/`dist`, increase `parallelWorkers` |
| Search returns no results | Run `code-analyzer analyze .` first, check `code-analyzer status` |
| MCP server won't start | Check Node >= 20, try `mcp serve --transport stdio --verbose` |
| VS Code extension not connecting | Verify CLI is in PATH, restart VS Code after install |

**Help:** `code-analyzer --help` | **Status:** `code-analyzer status` | **Issues:** [GitHub](https://github.com/AgentiX-E/code-analyzer/issues)
