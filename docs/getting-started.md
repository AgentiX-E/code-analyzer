# Getting Started with Code Analyzer

> **5-minute quickstart to analyze your codebase**

## Installation

```bash
# Install globally
npm install -g @code-analyzer/cli

# Or use via npx
npx @code-analyzer/cli analyze --repo .
```

## Quick Start

### 1. Analyze Your Project

```bash
# Index a repository
code-analyzer analyze --repo /path/to/your/project

# Analyze with specific languages
code-analyzer analyze --repo . --languages typescript,python,java

# Output as JSON
code-analyzer analyze --repo . --format json --output analysis.json
```

### 2. Search Your Codebase

```bash
# Full-text search
code-analyzer search "authentication" --repo .

# Semantic search (requires embeddings)
code-analyzer search "how does login work" --semantic --repo .

# Filter by language and type
code-analyzer search "handler" --language typescript --type Function --repo .
```

### 3. Review a Pull Request

```bash
# Review a PR against project standards
code-analyzer review pr \
  --repo . \
  --pr 42 \
  --token $GITHUB_TOKEN

# Generate a review report
code-analyzer review pr \
  --repo . \
  --pr 42 \
  --format markdown \
  --output review.md
```

### 4. Check Coding Standards

```bash
# Check against default TypeScript standards
code-analyzer standards check --repo . --standard typescript-best-practices

# Use custom standards file
code-analyzer standards check --repo . --standard .code-analyzer-standards.yml
```

### 5. Generate Reports

```bash
# Generate codebase health report
code-analyzer report generate --repo . --format html --output report.html

# Get actionable recommendations
code-analyzer report recommend --repo . --format markdown --output recommendations.md

# Trend analysis over time
code-analyzer report trends --repo . --days 30
```

## VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AgentiX-E.code-analyzer).

### Key Features

- **Sidebar**: Browse code structure, search, and navigate your knowledge graph
- **Copilot Chat**: Use `@code-analyzer` in Copilot Chat for AI-powered code questions
- **PR Review**: Inline annotations and review comments directly in the editor
- **Impact Analysis**: See what will be affected when you change a function

### Chat Commands

```
@code-analyzer explore the authentication module
@code-analyzer search for all REST API handlers
@code-analyzer review this file against project standards
@code-analyzer impact what if I rename getUser to fetchUser?
@code-analyzer debug why is the login flow failing?
@code-analyzer refactor suggest improvements for this class
```

## MCP Server

Use Code Analyzer as an MCP server with Claude, Cursor, or any MCP-compatible client:

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

### Available MCP Tools

- `search_graph` — Full-text search with BM25 + vector hybrid ranking
- `get_architecture` — Get project architecture overview
- `analyze_impact` — Impact analysis for proposed changes
- `review_pr` — Automated PR review
- `check_standards` — Standards compliance check
- `generate_report` — Generate analysis report
- `query_cypher` — Cypher graph query
- `get_trends` — Trend analysis over time
- ... and 30 more tools

## Next Steps

- [Configuration Guide](./configuration.md) — Full configuration reference
- [MCP Server Guide](./mcp-server.md) — MCP setup for Claude, Cursor, etc.
- [VS Code Extension Guide](./vs-code-extension.md) — Extension features and usage
- [Code Review Guide](./code-review.md) — Review workflow best practices
- [Search Guide](./search-guide.md) — Search query syntax and tips
- [API Reference](./api-reference.md) — HTTP API documentation
- [CLI Reference](./cli-reference.md) — Complete CLI command reference
