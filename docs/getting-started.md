# Getting Started with Code Analyzer

> A 5-minute guide to indexing, searching, and reviewing your codebase with code intelligence.

## Prerequisites

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| **Node.js** | ≥ 20.0.0 | Check with `node --version` |
| **pnpm** (build from source) | ≥ 9.0.0 | Only needed for local development |
| **Git** | Any recent version | For repository analysis and PR review |
| **Disk** | ~50 MB (core) + graph storage | Knowledge graph stored locally |

## Installation

### Option 1 — Global Install (Recommended)

```bash
npm install -g @code-analyzer/cli

# Verify installation
code-analyzer --version
```

### Option 2 — npx (No Install)

```bash
npx @code-analyzer/cli analyze --repo .
```

### Option 3 — Build from Source

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer
pnpm install && pnpm build

# Use locally
node packages/cli/dist/index.js analyze --repo .
```

---

## First Analysis

### Step 1: Index Your Repository

```bash
# Index a repository (creates knowledge graph)
code-analyzer analyze --repo /path/to/your/project

# Specify which languages to analyze
code-analyzer analyze --repo . --languages typescript,python,java

# Output results as JSON for programmatic use
code-analyzer analyze --repo . --format json --output analysis.json
```

**What happens under the hood:**
1. File discovery scans your project respecting `.gitignore`
2. Each file is parsed by the appropriate language provider
3. An 18-phase DAG pipeline builds a knowledge graph
4. The graph is stored in a local SQLite database
5. You get a summary of nodes, edges, and analysis time

### Step 2: Search Your Knowledge Graph

```bash
# Full-text search (BM25 ranking)
code-analyzer search "authentication" --repo .

# Semantic search (requires embeddings)
code-analyzer search "how does login work" --semantic --repo .

# Filter by language and entity type
code-analyzer search "handler" --language typescript --type Function --repo .

# Search with Cypher queries
code-analyzer search --cypher "MATCH (f:Function) WHERE f.name CONTAINS 'auth' RETURN f" --repo .
```

### Step 3: Explore Architecture

```bash
# Get a bird's-eye view of your project
code-analyzer report generate --repo . --format html --output report.html

# Identify hotspots and complex modules
code-analyzer report generate --repo . --format json | jq '.hotspots'

# Trace call paths between functions
code-analyzer trace "login" "database.query" --repo .
```

---

## Code Review

### PR Review

```bash
# Review a pull request with automated analysis
code-analyzer review pr \
  --repo . \
  --pr 42 \
  --token $GITHUB_TOKEN

# Generate a detailed review report
code-analyzer review pr \
  --repo . \
  --pr 42 \
  --format markdown \
  --output review.md

# Review with custom project standards
code-analyzer review pr \
  --repo . \
  --pr 42 \
  --standard .code-analyzer-standards.yml
```

### Standards Checking

```bash
# Check against built-in TypeScript standards
code-analyzer standards check --repo . --standard typescript-best-practices

# List available built-in standards
code-analyzer standards list

# Use a custom standards file
code-analyzer standards check --repo . --standard .code-analyzer-standards.yml

# Check against multiple standards
code-analyzer standards check --repo . --standard typescript-best-practices,security-basics
```

### Impact Analysis

```bash
# See what will be affected when changing a function
code-analyzer impact analyze --repo . --function getUser

# Analyze uncommitted changes before committing
code-analyzer impact diff --repo .

# Generate impact report
code-analyzer impact analyze --repo . --function authenticate --format markdown --output impact.md
```

---

## VS Code Extension

### Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AgentiX-E.code-analyzer) or search for "Code Analyzer" in the Extensions view (`Ctrl+Shift+X`).

### Key Features

| Feature | How to Use |
|---------|------------|
| **Knowledge Graph Sidebar** | Click the Code Analyzer icon in the activity bar |
| **Copilot Chat** | Type `@code-analyzer` in Copilot Chat |
| **Inline Review Comments** | Hover over code to see AI review suggestions |
| **Impact Analysis** | Right-click a function → "Analyze Impact" |
| **Status Bar** | Shows index status and pending reviews |

### Copilot Chat Commands

```
@code-analyzer explore the authentication module
@code-analyzer search for all REST API handlers
@code-analyzer review this file against project standards
@code-analyzer impact what if I rename getUser to fetchUser?
@code-analyzer debug why is the login flow failing?
@code-analyzer refactor suggest improvements for this class
```

The Copilot Chat participant uses 6 intent classifiers to route your queries to the right analysis pipeline.

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codeAnalyzer.indexOnOpen` | `true` | Auto-index workspace on open |
| `codeAnalyzer.languages` | `["typescript","javascript"]` | Languages to analyze |
| `codeAnalyzer.autoReview` | `false` | Auto-review on save |
| `codeAnalyzer.maxTokens` | `8000` | Max tokens for review context |
| `codeAnalyzer.ignorePatterns` | `["node_modules","dist"]` | Patterns to ignore |
| `codeAnalyzer.standardsPath` | `null` | Custom standards file path |

---

## MCP Server

Use Code Analyzer as an MCP server — your AI coding agent gains 38 code intelligence tools.

### Setup with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

### Setup with Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"]
    }
  }
}
```

### What Your AI Agent Gains

Once connected, your AI agent can:

- **Search** code with BM25+vector hybrid ranking
- **Query** the knowledge graph with Cypher
- **Review** PRs with project standards
- **Analyze** change impact before committing
- **Check** compliance against 10 built-in standards
- **Generate** architecture reports and trend analyses
- **Trace** call paths between any two functions

See the [MCP Server Guide](MCP-SERVER.md) for the complete tool reference (38 tools, 15 resources, 5 prompts).

### Available Tools (Sample)

| Category | Tools | Description |
|----------|-------|-------------|
| Search | `search_graph`, `search_code`, `semantic_query` | Full-text, structural, and semantic search |
| Review | `review_pr`, `review_diff`, `review_file` | Automated code review with standards |
| Standards | `check_standards`, `list_standards`, `add_standard` | Project standards management |
| Reports | `generate_report`, `get_trends`, `recommend` | Analysis reports and recommendations |
| Query | `query_cypher`, `get_architecture`, `trace_path` | Graph queries and architecture |
| Impact | `analyze_impact`, `detect_changes` | Change impact analysis |

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Code Analysis
on: [pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx @code-analyzer/cli analyze --repo .
      - run: npx @code-analyzer/cli review pr --repo . --pr ${{ github.event.pull_request.number }}
```

### GitLab CI

```yaml
code-analysis:
  image: node:20
  script:
    - npx @code-analyzer/cli analyze --repo .
    - npx @code-analyzer/cli standards check --repo . --standard typescript-best-practices
  artifacts:
    reports:
      codequality: analysis.json
```

---

## Configuration

Code Analyzer can be configured via a `.code-analyzer.yml` file in your project root:

```yaml
# .code-analyzer.yml
project:
  name: my-project
  languages:
    - typescript
    - python

analysis:
  exclude:
    - "**/node_modules/**"
    - "**/dist/**"
    - "**/*.test.ts"
  maxFileSize: 1048576  # 1MB

review:
  standards:
    - typescript-best-practices
    - security-basics
  autoFix: false

search:
  semantic: true
  embeddingModel: nomic-embed-code
```

See the [Configuration Guide](CONFIGURATION.md) for the complete reference.

---

## Troubleshooting

### "Git command failed" errors
Ensure you are running `code-analyzer` from within a Git repository, or specify the repo path explicitly with `--repo /path/to/project`.

### Slow indexing on large projects
- Exclude unnecessary directories in `.code-analyzer.yml`
- Limit languages: `--languages typescript,javascript`
- Increase worker pool: set `CODE_ANALYZER_WORKERS=8` environment variable

### MCP tools not appearing
- Verify the MCP server starts: run `npx @code-analyzer/mcp` directly and check for errors
- Check that `CODE_ANALYZER_PROJECT_DIR` is set correctly
- Restart your MCP client after configuration changes

### VS Code extension not loading
- Ensure Node.js ≥ 20 is installed
- Check the extension output: View → Output → "Code Analyzer"
- Reload VS Code window: `Ctrl+Shift+P` → "Developer: Reload Window"

---

## Next Steps

| Resource | Description |
|----------|-------------|
| 📘 [Architecture Guide](ARCHITECTURE.md) | Deep dive into the 7-layer architecture |
| 🔧 [Configuration Reference](CONFIGURATION.md) | All config options and environment variables |
| 🔌 [MCP Server Guide](MCP-SERVER.md) | Complete MCP tool and prompt reference |
| 🔍 [Code Review Guide](CODE-REVIEW.md) | PR review workflow and custom standards |
| 🌐 [Language Support](language-support.md) | 8-language feature matrix and cross-language analysis |
| 📦 [Package READMEs](../packages/) | Per-package API documentation |
| 🤝 [Contributing Guide](../CONTRIBUTING.md) | Development setup and coding standards |
| 📋 [Changelog](../CHANGELOG.md) | Version history and release notes |
| 🔒 [Security Policy](../SECURITY.md) | Vulnerability reporting and security measures |
