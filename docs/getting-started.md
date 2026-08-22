# Getting Started with Code Analyzer

> A step-by-step guide to indexing, searching, and reviewing your codebase. From zero to code intelligence in under 10 minutes.

## Prerequisites

| Requirement    | Minimum                     | How to Check            |
| -------------- | --------------------------- | ----------------------- |
| **Node.js**    | >= 20.0.0                   | `node --version`        |
| **pnpm**       | >= 9.0.0                    | `pnpm --version`        |
| **Git**        | Any recent version          | `git --version`         |
| **Disk Space** | ~50 MB core + graph storage | Varies by codebase size |

If you don't have pnpm installed:

```bash
npm install -g pnpm@latest
# Or via corepack (Node.js >= 16.13):
corepack enable && corepack prepare pnpm@latest --activate
```

---

## Installation

### Option 1 — Global Install (Recommended)

```bash
pnpm add -g @code-analyzer/cli

# Verify installation
code-analyzer --version
```

**Expected output:**

```
Code Analyzer v1.0.0
Node: v20.11.0 | Platform: linux x64
```

### Option 2 — npx (No Install)

```bash
npx @code-analyzer/cli analyze --repo .
```

The first run downloads the package automatically. Subsequent runs are faster due to npx cache.

### Option 3 — Docker

```bash
docker pull ghcr.io/agentix-e/code-analyzer:latest

# Run analysis on your project
docker run --rm -v $(pwd):/workspace ghcr.io/agentix-e/code-analyzer:latest \
  code-analyzer analyze --repo /workspace

# Start MCP server via Docker
docker run --rm -v $(pwd):/workspace -p 3100:3100 \
  ghcr.io/agentix-e/code-analyzer:latest \
  code-analyzer mcp --transport http --port 3100
```

Use Docker when you want a fully isolated environment or need to run Code Analyzer in CI/CD pipelines without installing Node.js.

---

## First Steps

### 1. Initialize Your Project

Before your first analysis, initialize a configuration:

```bash
code-analyzer init
```

This creates a `.code-analyzerrc` file in your project root with sensible defaults. You'll be prompted to select:

- Which languages to analyze (TypeScript, Python, Go, Java, Kotlin, C#, Rust)
- Directories to exclude
- Review severity preferences

**Expected output:**

```
✓ Created .code-analyzerrc
✓ Detected 3 languages: typescript, python, go
✓ Configuration saved with 8 options
```

### 2. Analyze Your Codebase

Run your first full analysis to build the knowledge graph:

```bash
code-analyzer analyze .
```

**What happens during analysis:**

1. **File Discovery** — Scans your project, respecting `.gitignore` and `.code-analyzerignore`
2. **Parsing** — Each source file is parsed by the appropriate language provider
3. **Graph Building** — A 19-phase DAG pipeline constructs a knowledge graph with 33 entity types and 44 relationship types
4. **Indexing** — Full-text and vector embeddings are generated for hybrid search

**Expected output:**

```
╔══════════════════════════════════════╗
║   Code Analyzer - Analysis Results   ║
╠══════════════════════════════════════╣
║ Files analyzed:        1,247         ║
║ Lines of code:         87,342        ║
║ Nodes created:         4,521         ║
║ Relationships created:  18,330        ║
║ Graph size:            12.4 MB       ║
║ Analysis time:         8.3s          ║
╚══════════════════════════════════════╝

Languages detected: typescript (847 files), python (312 files), go (88 files)
```

### 3. Search Your Code

Now that your codebase is indexed, search it:

```bash
# Keyword search
code-analyzer search "authentication"

# Semantic search (what does this code do?)
code-analyzer search "how does the login flow work" --semantic

# Search with filters
code-analyzer search "handler" --language typescript --type Function

# Cypher graph query
code-analyzer search --cypher "MATCH (f:Function) WHERE f.name CONTAINS 'auth' RETURN f.name, f.file"
```

**Expected output (keyword search):**

```
Search: "authentication" (BM25, top 20 results)

1. auth/login.ts:42  —  authenticateUser()      [score: 0.892]
2. auth/middleware.ts:18  —  authMiddleware()    [score: 0.845]
3. services/token.ts:67  —  refreshAuthToken()    [score: 0.801]
4. types/auth.ts:5  —  AuthConfig interface       [score: 0.763]
...

Found 47 results in 0.12s
```

### 4. Review Your Code

Get automated review feedback on your code:

```bash
# Review a single file
code-analyzer review src/auth/login.ts

# Review staged changes (before committing)
code-analyzer review src/ --diff

# Review entire directory against standards
code-analyzer review src/ --standard typescript-best-practices
```

**Expected output:**

```
Review: src/auth/login.ts
═══════════════════════════════
[CRITICAL] Line 42: Hardcoded secret - API key appears to be embedded in source
  → Move to environment variable or secrets manager

[HIGH] Line 67: Missing error handling - async function lacks try/catch
  → Wrap database call in try/catch with appropriate error response

[MEDIUM] Line 89: Function length exceeds threshold (52 lines)
  → Consider refactoring into smaller functions

[LOW] Line 12: Unused import 'crypto' detected
  → Remove unused import

Summary: 1 critical, 1 high, 1 medium, 1 low — 4 issues total
```

---

## Setting Up MCP for AI Agents

Code Analyzer exposes 45 tools via the Model Context Protocol (MCP), turning your AI coding agent into a code intelligence powerhouse.

### Auto-Detect and Configure

The easiest way to set up MCP is with the agent detection command:

```bash
code-analyzer agent detect
```

This scans your environment for supported AI agents and shows what's available:

```
Agent Detection Results
═════════════════════════
✓ Claude Desktop detected — ~/Library/Application Support/Claude/claude_desktop_config.json
✓ Cursor detected — .cursor/mcp.json
✓ VS Code detected — Code Analyzer extension installed
✓ Windsurf detected — ~/.windsurf/mcp.json

Run 'code-analyzer agent configure' to set up all detected agents.
```

Then configure all detected agents at once:

```bash
code-analyzer agent configure
```

**Expected output:**

```
✓ Configured Claude Desktop (38 tools)
✓ Configured Cursor (28 tools, analysis profile)
✓ Configured Windsurf (28 tools, analysis profile)

Restart your AI agents to begin using Code Analyzer tools.
```

### Manual Configuration

If auto-detection doesn't work, configure manually. For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/absolute/path/to/your/project"
      }
    }
  }
}
```

For Cursor, create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

After restarting your AI agent, you'll see a hammer icon in the chat interface, confirming the 45 MCP tools are available. See the [MCP Tool Reference](mcp-tool-reference.md) for the complete listing.

---

## VS Code Extension Setup

### Installation

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS)
3. Search for "Code Analyzer"
4. Click **Install**

Alternatively, install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AgentiX-E.code-analyzer).

### Verify Installation

After installation, you should see:

- **Activity Bar Icon** — The Code Analyzer icon (magnifying glass over brackets) appears in the activity bar
- **Status Bar Indicator** — Shows "CA: Indexed" when a project is analyzed
- **Output Panel** — View → Output → "Code Analyzer" shows extension logs

### Key Features

| Feature                      | How to Access                                                   |
| ---------------------------- | --------------------------------------------------------------- |
| **Knowledge Graph Sidebar**  | Click the Code Analyzer icon in the activity bar                |
| **Copilot Chat Integration** | Type `@code-analyzer` in Copilot Chat (requires GitHub Copilot) |
| **Inline Review Comments**   | Hover over code to see AI review suggestions                    |
| **Impact Analysis**          | Right-click a function → "Code Analyzer: Analyze Impact"        |
| **Command Palette**          | `Ctrl+Shift+P` → search "Code Analyzer"                         |

### Copilot Chat Commands

```
@code-analyzer /review    — Review the current file
@code-analyzer /explain   — Explain selected code
@code-analyzer /impact    — Analyze impact of current function
@code-analyzer /find      — Search for symbols
@code-analyzer /deps      — Show dependencies
@code-analyzer /refactor  — Suggest refactoring
@code-analyzer /test      — Generate tests for current file
@code-analyzer /coverage  — Show test coverage gaps
@code-analyzer /standards — Check against standards
```

### Extension Settings

Configure via `Ctrl+,` → search "Code Analyzer":

| Setting                       | Default                       | Description                       |
| ----------------------------- | ----------------------------- | --------------------------------- |
| `codeAnalyzer.indexOnOpen`    | `true`                        | Auto-index workspace when opened  |
| `codeAnalyzer.languages`      | `["typescript","javascript"]` | Languages to analyze              |
| `codeAnalyzer.autoReview`     | `false`                       | Automatically review on file save |
| `codeAnalyzer.ignorePatterns` | `["node_modules","dist"]`     | Patterns to skip                  |

---

## Troubleshooting Common First-Time Issues

### "command not found: code-analyzer"

The global install path isn't in your `$PATH`. Run:

```bash
pnpm setup
source ~/.bashrc  # or ~/.zshrc
```

Or use npx directly: `npx @code-analyzer/cli analyze .`

### "No files found to analyze"

Check that:

1. You're in a directory with supported source files (`.ts`, `.py`, `.go`, `.java`, etc.)
2. Your files aren't excluded by `.gitignore` patterns
3. You've specified the right language: `code-analyzer analyze . --languages typescript`

### "Analysis is slow" on Large Projects

- Limit languages: `code-analyzer analyze . --languages typescript`
- Exclude generated files in `.code-analyzerrc`:
  ```json
  { "excludePatterns": ["**/generated/**", "**/*.generated.*"] }
  ```
- Set `CODE_ANALYZER_PARSE_WORKERS=8` for more parallel workers

### "MCP server won't start"

- Check for port conflicts: `lsof -i :3100`
- Verify Node.js version: `node --version` (must be >= 20)
- Run directly to see errors: `npx @code-analyzer/mcp --transport http --port 3100`

### "VS Code extension shows nothing"

- Check the extension is activated: View → Output → select "Code Analyzer"
- Reload VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"
- Verify Node.js >= 20 is installed and on `$PATH`

---

## Next Steps

| Resource                                              | Description                                       |
| ----------------------------------------------------- | ------------------------------------------------- |
| [Configuration Reference](configuration-reference.md) | All config options and environment variables      |
| [MCP Tool Reference](mcp-tool-reference.md)           | Complete 45-tool reference for AI agents          |
| [Scenario Guides](scenario-guides.md)                 | Task-based workflows (PR review, CI/CD, monorepo) |
| [Troubleshooting](troubleshooting.md)                 | Detailed solutions for common issues              |
| [Architecture](architecture.md)                       | Deep dive into the system design                  |
| [Language Support](language-support.md)               | Supported languages and feature matrix            |
