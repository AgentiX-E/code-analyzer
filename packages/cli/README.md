# @code-analyzer/cli

> Command-line interface for the Code Analyzer platform — index repositories, search the knowledge graph, and run analysis from your terminal.

[![npm](https://img.shields.io/npm/v/@code-analyzer/cli?color=blue)](https://www.npmjs.com/package/@code-analyzer/cli)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

## Overview

`@code-analyzer/cli` provides the `code-analyzer` command-line tool for code intelligence operations. Built on Commander.js, it enables scripting and CI/CD integration for repository indexing and knowledge graph search. The CLI wraps the `@code-analyzer/core`, `@code-analyzer/analyzer`, and `@code-analyzer/intelligence` packages behind a clean subcommand interface.

```
┌──────────────────────────────────────────────────────────┐
│                      Terminal / CI/CD                     │
│  $ code-analyzer analyze ./src                            │
│  $ code-analyzer search "authentication"                  │
└──────────────────────┬───────────────────────────────────┘
                       │  Commander.js CLI
┌──────────────────────▼───────────────────────────────────┐
│                    @code-analyzer/cli                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Subcommands                                         │ │
│  │  analyze · search · (more coming)                    │ │
│  └──────────────────────┬──────────────────────────────┘ │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │              Core Engine                             │ │
│  │  @code-analyzer/core                                │ │
│  └──────────────────────┬──────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│  @code-analyzer/analyzer  │  @code-analyzer/intelligence  │
│  @code-analyzer/shared    │  @code-analyzer/infra         │
└──────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Global installation
npm install -g @code-analyzer/cli

# Or run via npx (no installation required)
npx @code-analyzer/cli analyze ./my-project

# Install within the monorepo
pnpm install --filter @code-analyzer/cli
```

After global installation, the `code-analyzer` command is available in your terminal:

```bash
code-analyzer --version
# 0.1.0

code-analyzer --help
# Usage: code-analyzer [options] [command]
#
# World-class code intelligence platform
#
# Options:
#   -V, --version  output the version number
#   -h, --help     display help for command
#
# Commands:
#   analyze <path>  Index a repository into the knowledge graph
#   search <query>  Search the knowledge graph
#   help [command]  display help for command
```

## Quick Start

### Index a Repository

```bash
# Basic repository analysis
code-analyzer analyze ./my-project

# Output:
# Analyzing ./my-project...
```

The `analyze` command processes the source code at the given path, building a knowledge graph of symbols, relationships, and dependencies. The indexed data is stored in the SQLite knowledge graph for subsequent querying.

### Search the Knowledge Graph

```bash
# Full-text search across indexed code
code-analyzer search "authentication"

# Output:
# Searching for "authentication"...
```

The `search` command performs FTS5 full-text search across all indexed projects, returning matching symbols, files, and code snippets.

### Pipeline Integration

```bash
# In a shell script
#!/bin/bash
set -e

# Analyze the repository
code-analyzer analyze .

# Search for deprecated patterns
code-analyzer search "TODO" > todos.txt

# Check for security-sensitive patterns
code-analyzer search "password" > sensitive.txt

echo "Analysis complete"
```

## API Reference

### Subcommands

#### `analyze`

Index a repository into the knowledge graph.

```
code-analyzer analyze [options] <path>
```

| Argument | Type | Description |
|----------|------|-------------|
| `<path>` | `string` | Path to the repository to analyze (required) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--language <lang>` | `string` | auto | Programming language (auto-detected if omitted) |
| `--project-id <id>` | `string` | auto | Project identifier (auto-generated if omitted) |
| `--force` | `boolean` | `false` | Force re-index even if already indexed |

**Examples:**

```bash
# Analyze a TypeScript project
code-analyzer analyze --language typescript ./src

# Analyze with a custom project ID
code-analyzer analyze --project-id my-backend-service ./server

# Force re-index an already-analyzed project
code-analyzer analyze --force --project-id my-app .

# Analyze a monorepo package
code-analyzer analyze ./packages/shared
```

**What happens during analysis:**

1. **File discovery** — Scans the directory for source files matching the language
2. **AST parsing** — Parses each file using tree-sitter to extract symbols
3. **Symbol extraction** — Identifies functions, classes, interfaces, modules, etc.
4. **Relationship detection** — Maps imports, calls, inheritance, implementations
5. **Graph construction** — Builds the knowledge graph in SQLite with FTS5 indexing
6. **Status reporting** — Outputs node/edge counts and indexing status

#### `search`

Search the knowledge graph using full-text search.

```
code-analyzer search [options] <query>
```

| Argument | Type | Description |
|----------|------|-------------|
| `<query>` | `string` | Search query string (required) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--project <id>` | `string` | all | Project ID to search within |
| `--limit <n>` | `number` | `20` | Maximum results to return |
| `--offset <n>` | `number` | `0` | Pagination offset |
| `--label <label>` | `string` | all | Filter by node label (Function, Class, Module, etc.) |
| `--format <fmt>` | `string` | `text` | Output format (text, json, csv) |

**Examples:**

```bash
# Basic search
code-analyzer search "handleError"

# Search within a specific project
code-analyzer search --project my-app "UserService"

# Search with label filter
code-analyzer search --label Function "createUser"

# Search with pagination
code-analyzer search --limit 50 --offset 100 "middleware"

# JSON output for scripting
code-analyzer search --format json "auth" | jq '.items[].name'

# CSV output for spreadsheets
code-analyzer search --format csv --label Class "Controller" > controllers.csv
```

**Output formats:**

`text` (default):
```
Search results for "authentication":
  1. auth.authenticate (Function) — src/auth/index.ts:42
  2. AuthController.validateToken (Method) — src/controllers/auth.ts:15
  3. authMiddleware (Function) — src/middleware/auth.ts:8
  Found 3 results
```

`json`:
```json
{
  "items": [
    {
      "nodeId": 42,
      "name": "authenticate",
      "qualifiedName": "auth.authenticate",
      "label": "Function",
      "filePath": "src/auth/index.ts",
      "startLine": 42,
      "endLine": 67,
      "rank": 0.95,
      "snippet": "export async function authenticate(token: string)"
    }
  ],
  "total": 3,
  "returned": 3,
  "hasMore": false
}
```

`csv`:
```csv
nodeId,name,qualifiedName,label,filePath,startLine,rank
42,authenticate,auth.authenticate,Function,src/auth/index.ts,42,0.95
15,validateToken,AuthController.validateToken,Method,src/controllers/auth.ts,15,0.87
8,authMiddleware,authMiddleware,Function,src/middleware/auth.ts,8,0.72
```

## Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CODE_ANALYZER_DATA_DIR` | `string` | `~/.code-analyzer/data` | Data directory for SQLite databases |
| `CODE_ANALYZER_LOG_LEVEL` | `string` | `info` | Log level (debug, info, warn, error, silent) |
| `CODE_ANALYZER_DEFAULT_LANGUAGE` | `string` | auto | Default programming language for analysis |
| `CODE_ANALYZER_MAX_FILE_SIZE` | `string` | `1mb` | Maximum file size to analyze |
| `CODE_ANALYZER_IGNORE_PATTERNS` | `string` | — | Comma-separated glob patterns to ignore |

### Configuration File

Place a `.code-analyzerrc.json` in your project root for persistent configuration:

```json
{
  "language": "typescript",
  "ignore": ["node_modules", "dist", ".git", "coverage"],
  "maxFileSize": "2mb",
  "analysis": {
    "includeTests": false,
    "includeDocs": false,
    "extractComments": true
  },
  "search": {
    "defaultLimit": 30,
    "fuzzyMatch": true
  }
}
```

Configuration is resolved in this order (last wins):

1. Default values
2. `.code-analyzerrc.json` in project root
3. `.code-analyzerrc.json` in home directory
4. Environment variables (`CODE_ANALYZER_*`)
5. CLI flags

## Advanced Usage

### CI/CD Integration

#### GitHub Actions

```yaml
name: Code Analysis
on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install Code Analyzer
        run: npm install -g @code-analyzer/cli
      - name: Index Repository
        run: code-analyzer analyze --project-id ${{ github.event.repository.name }} .
      - name: Search for Anti-patterns
        run: |
          code-analyzer search --format json "TODO" > todos.json
          code-analyzer search --format json "FIXME" > fixmes.json
      - name: Upload Results
        uses: actions/upload-artifact@v4
        with:
          name: analysis-results
          path: |
            todos.json
            fixmes.json
```

#### GitLab CI

```yaml
analyze:
  image: node:20
  script:
    - npm install -g @code-analyzer/cli
    - code-analyzer analyze --project-id $CI_PROJECT_NAME .
    - code-analyzer search --format json "deprecated" > deprecated.json
  artifacts:
    paths:
      - deprecated.json
```

#### Jenkins Pipeline

```groovy
pipeline {
    agent any
    tools { nodejs 'NodeJS-20' }
    stages {
        stage('Code Analysis') {
            steps {
                sh 'npm install -g @code-analyzer/cli'
                sh 'code-analyzer analyze --project-id ${JOB_NAME} .'
                sh 'code-analyzer search --format json "security" > security.json'
            }
        }
        stage('Archive Results') {
            steps {
                archiveArtifacts artifacts: 'security.json'
            }
        }
    }
}
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running code analysis..."

# Check for TODO markers in staged files
code-analyzer search "TODO" | grep -q "results" && {
  echo "WARNING: TODO markers found in code"
}

# Check for console.log statements
code-analyzer search "console.log" | grep -q "results" && {
  echo "ERROR: console.log statements found. Use proper logging instead."
  exit 1
}
```

### Shell Script Automation

```bash
#!/bin/bash
# scripts/analyze-all.sh — Analyze all packages in a monorepo

PACKAGES_DIR="./packages"
RESULTS_DIR="./analysis-results"
mkdir -p "$RESULTS_DIR"

for package in "$PACKAGES_DIR"/*/; do
  name=$(basename "$package")
  echo "Analyzing $name..."

  code-analyzer analyze \
    --project-id "$name" \
    "$package"

  code-analyzer search \
    --project "$name" \
    --format json \
    --limit 100 \
    "export" > "$RESULTS_DIR/${name}_exports.json"

  echo "  Done: $RESULTS_DIR/${name}_exports.json"
done

echo "All packages analyzed."
```

### Combining with jq for Data Processing

```bash
# Find the most complex functions
code-analyzer search --format json --label Function "." | \
  jq '[.items[] | {name: .qualifiedName, file: .filePath}] | .[:10]'

# List all exported symbols
code-analyzer search --format json "export" | \
  jq '.items[] | "\(.name) — \(.filePath):\(.startLine)"'

# Count symbols by label
code-analyzer search --format json "." | \
  jq 'group_by(.label) | map({label: .[0].label, count: length}) | sort_by(-.count)'

# Find files with most symbols
code-analyzer search --format json "." | \
  jq 'group_by(.filePath) | map({file: .[0].filePath, count: length}) | sort_by(-.count) | .[:10]'
```

## Node Labels Reference

The knowledge graph supports the following node labels (38 total). Use the `--label` flag to filter searches:

| Category | Labels |
|----------|--------|
| **Structure** | `Project`, `Package`, `Folder`, `File`, `Module` |
| **OOP** | `Class`, `Interface`, `Enum`, `TypeAlias`, `Struct`, `Trait` |
| **Functions** | `Function`, `Method`, `Constructor`, `Property` |
| **Variables** | `Variable` |
| **Web** | `Route`, `Component` |
| **Tooling** | `Tool`, `Test`, `Config` |
| **Process** | `Process`, `Community`, `Event` |
| **Security** | `BasicBlock`, `DataSource`, `Sink` |
| **Cross-Repo** | `CrossRepoFunction`, `CrossRepoInterface`, `CrossRepoModule`, `Contract` |
| **Documentation** | `ADR` |
| **Infrastructure** | `InfraResource` |

## Supported Languages

The analyzer supports auto-detection for the following languages:

| Language | Flag |
|----------|------|
| TypeScript | `--language typescript` |
| JavaScript | `--language javascript` |
| Python | `--language python` |
| Go | `--language go` |
| Rust | `--language rust` |
| Java | `--language java` |
| C# | `--language csharp` |
| C++ | `--language cpp` |

## Package Dependencies

| Dependency | Description |
|------------|-------------|
| `@code-analyzer/shared` | Shared types and schemas |
| `@code-analyzer/core` | Core analysis engine interfaces |
| `@code-analyzer/infra` | Infrastructure layer (SQLite, logging) |
| `@code-analyzer/analyzer` | Static code analysis (tree-sitter parsing) |
| `@code-analyzer/intelligence` | AI-powered code intelligence |
| `@code-analyzer/mcp` | MCP server (for agent integration) |
| `commander` | CLI framework for argument parsing (^12.0.0) |

### Dev Dependencies

| Dependency | Description |
|------------|-------------|
| `typescript` | TypeScript compiler (^5.6.0) |
| `vitest` | Unit test runner (^2.1.0) |

## Architecture

### Source Layout

```
src/
└── index.ts                    # CLI entry point (Commander.js program)
```

The CLI is a thin wrapper around the core packages. The `index.ts` entry point:

1. Creates a `Commander` program named `code-analyzer`
2. Registers `analyze` and `search` subcommands
3. Delegates execution to `@code-analyzer/core` and `@code-analyzer/analyzer`
4. Outputs results to stdout with configurable formatting

### Execution Flow

```
$ code-analyzer analyze ./src
  │
  ▼
Commander.js parses arguments
  │
  ▼
@code-analyzer/core orchestrates analysis
  │
  ├── File discovery (glob patterns, .gitignore)
  ├── @code-analyzer/analyzer — Tree-sitter AST parsing
  │   ├── Symbol extraction (functions, classes, etc.)
  │   ├── Relationship detection (calls, imports, etc.)
  │   └── Metric calculation (complexity, lines, etc.)
  ├── @code-analyzer/infra — SqliteStore persistence
  │   ├── Node storage with FTS5 indexing
  │   ├── Edge storage for relationships
  │   └── Graph traversal (BFS/DFS)
  └── @code-analyzer/intelligence — AI analysis
      ├── Pattern detection
      ├── Anti-pattern identification
      └── Recommendation generation
  │
  ▼
Formatted output to stdout
```

## Comparison with @code-analyzer/mcp and @code-analyzer/server

| Feature | `@code-analyzer/cli` | `@code-analyzer/mcp` | `@code-analyzer/server` |
|---------|---------------------|---------------------|------------------------|
| **Interface** | Terminal commands | MCP protocol | HTTP REST API |
| **Target User** | Developers, CI/CD | AI coding agents | Web apps, SDKs |
| **Transport** | stdin/stdout | stdio / HTTP+SSE | HTTP |
| **Use Case** | Scripting, automation | Agent-assisted coding | Programmatic integration |
| **State** | Stateless commands | Stateful server | Stateful server |
| **Concurrency** | Single invocation | Multi-agent | Multi-client |

## License

MIT

## Links

- [Code Analyzer Documentation](./docs/)
- [Contributing Guide](./CONTRIBUTING.md)
- [Commander.js Documentation](https://github.com/tj/commander.js)
