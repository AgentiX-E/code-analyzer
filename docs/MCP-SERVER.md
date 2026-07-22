# MCP Server Guide

> Setup and usage guide for the Code Analyzer MCP server — expose 38 tools, 15 resources, and 5 prompts to AI coding agents.

> **Alpha Status**: The MCP server framework, middleware, transports, and Cypher query engine are fully functional. The 38 tool definitions exist and are callable, but most tool implementations currently return placeholder or empty data. The table below summarizes per-tool status. Use the legends `[Functional]` (tested and working), `[Partial]` (may return real data in some cases), and `[Experimental]` (placeholder data only) to understand what to expect.

### Tool Implementation Status Summary

| Category | Tools | Status |
|----------|-------|--------|
| Indexing & Lifecycle (4 tools) | `analyze_repository`, `list_projects`, `delete_project`, `index_status` | [Experimental] — Placeholder responses |
| Querying & Exploration (10 tools) | `search_graph`, `search_code`, `semantic_search`, `trace_call_path`, `query_graph`, `get_code_snippet`, `get_architecture`, `get_graph_schema`, `explore_symbol`, `find_implementations` | [Partial] — `search_graph` and `query_graph` work on in-memory data; rest return placeholders |
| Change & Impact (4 tools) | `detect_changes`, `impact_analysis`, `route_map`, `check_cycles` | [Experimental] — Placeholder responses |
| Code Review (2 tools) | `review_diff`, `review_file` | [Experimental] — Empty results; requires LLM backend |
| PR Review (2 tools) | `review_pr`, `check_standards` | [Experimental] — Placeholder responses |
| Reports (3 tools) | `generate_report`, `export_report`, `get_recommendations` | [Experimental] — Placeholder responses |
| Cross-Repo (6 tools) | All cross-repo tools | [Experimental] — Placeholder responses |
| PDG (3 tools) | `pdg_query`, `taint_analysis`, `explain_taint` | [Experimental] — Requires PDG construction |
| Standards, ADR, Agent (4 tools) | `list_standards`, `create_standard`, `manage_adr`, `install_skills` | [Partial] — `install_skills` functional; rest are stubs |

---

## What is MCP?

The **Model Context Protocol (MCP)** is an open protocol that standardizes how AI agents connect to external tools and data sources. Code Analyzer implements an MCP server that exposes deep code intelligence capabilities — knowledge graph queries, code review, impact analysis, and more — as callable tools for AI agents.

---

## Multi-Client Setup Guide

Code Analyzer works with every major MCP-compatible AI coding client. Below are tested, ready-to-use configurations for each.

---

### 1. Claude Desktop

**Config file:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/.config/Claude/claude_desktop_config.json` (Linux).

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/absolute/path/to/your/project",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "all"
      }
    }
  }
}
```

**After restarting Claude Desktop**, you'll see a hammer icon in the chat input indicating 38 tools are available.

**Tools available:** All 38 tools across 7 categories — `analyze_repository`, `search_graph`, `search_code`, `semantic_search`, `trace_call_path`, `query_graph`, `get_code_snippet`, `get_architecture`, `explore_symbol`, `find_implementations`, `impact_analysis`, `review_pr`, `review_file`, `review_diff`, `check_standards`, `generate_report`, `pdg_query`, `taint_analysis`, `cross_repo_search`, `cross_repo_trace`, and more.

**Example queries you can ask Claude:**

- "Analyze the repository at /path/to/project and tell me about its architecture"
- "Find all functions that call `authenticateUser` and trace their full call chains"
- "Review PR #42 against our TypeScript best practices"
- "If I rename `getUserById`, what's the full blast radius?"
- "Show me the dependency graph for the auth module"

**Caveats:**
- Claude Desktop restarts the server on every conversation. First query after connecting may have a brief warm-up delay as the project indexes.
- Use `"CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"` to reduce to 28 tools if the full 38-tool listing feels noisy.
- On macOS, the path `~/Library/Application Support/Claude/claude_desktop_config.json` must exist. Create it if it doesn't.
- Claude Desktop requires an absolute path for `CODE_ANALYZER_PROJECT_DIR` — tilde expansion is not supported.

---

### 2. Cursor

**Config file:** `.cursor/mcp.json` in your project root (preferred). Create the file if it doesn't exist.

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "${workspaceFolder}",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
      }
    }
  }
}
```

Alternatively, configure via Cursor Settings → MCP → Add Server:

```json
{
  "command": "npx",
  "args": ["-y", "@code-analyzer/mcp"],
  "env": {
    "CODE_ANALYZER_PROJECT_DIR": "/path/to/your/project",
    "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
  }
}
```

**After restarting Cursor**, open the MCP panel to verify the server is connected (green dot). The tools appear in Cursor's Agent and Composer modes.

**Tools available:** 28 analysis tools (with the `analysis` profile) — querying, review, impact analysis, PR review, reporting, cross-repo operations, and PDG analysis. Switch to `"all"` for the full 38-tool set.

**Example queries you can ask Cursor:**

- "Use the code-analyzer to find all REST API routes in this project"
- "Trace the call path from `POST /api/login` down to the database layer"
- "What are the code hotspots — files with highest complexity and churn?"

**Caveats:**
- Cursor supports `${workspaceFolder}` in `.cursor/mcp.json` — use it instead of hard-coded paths for portability.
- The `.cursor/mcp.json` is project-local and should be committed to version control so the entire team benefits.
- Cursor's MCP panel (View → MCP) shows real-time server logs — use it to debug connection issues.
- If tools don't appear, click "Restart Server" in the MCP panel.

---

### 3. Codex (OpenAI)

Codex is OpenAI's coding agent. MCP support is via the Codex CLI plugin system.

**Config file:** `~/.codex/config.yml` or `~/.codex/mcp.json` (depending on Codex version).

```yaml
# ~/.codex/config.yml
mcp:
  servers:
    code-analyzer:
      command: npx
      args:
        - "-y"
        - "@code-analyzer/mcp"
      env:
        CODE_ANALYZER_PROJECT_DIR: "/absolute/path/to/your/project"
        CODE_ANALYZER_MCP_TOOL_PROFILE: "analysis"
```

If your Codex version uses JSON config, create `~/.codex/mcp.json`:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/absolute/path/to/your/project",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
      }
    }
  }
}
```

**Tools available:** 28 tools with `analysis` profile. Codex automatically discovers tools on startup and lists them in its agent mode.

**Example queries you can ask Codex:**

- "Use code-analyzer to search for all database query functions"
- "Review this file for security issues: src/auth/login.ts"
- "What's the architectural structure of this project?"

**Caveats:**
- Codex MCP support is evolving — check the [Codex docs](https://platform.openai.com/docs/guides/codex) for the latest MCP integration details.
- Codex may require explicit tool invocation syntax like `@tool search_graph query="authentication"`.
- Environment variable expansion in Codex config is limited — use absolute paths.

---

### 4. Gemini CLI

Google's Gemini CLI supports MCP tools via a configuration file.

**Config file:** `~/.gemini/settings.json` or `~/.gemini/config.yaml`.

**JSON format** (`~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/absolute/path/to/your/project",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
      }
    }
  }
}
```

**YAML format** (`~/.gemini/config.yaml`):

```yaml
mcpServers:
  code-analyzer:
    command: npx
    args:
      - "-y"
      - "@code-analyzer/mcp"
    env:
      CODE_ANALYZER_PROJECT_DIR: "/absolute/path/to/your/project"
      CODE_ANALYZER_MCP_TOOL_PROFILE: "analysis"
```

**Tools available:** 28 tools with `analysis` profile. Gemini CLI auto-discovers tools on connection.

**Example queries you can ask Gemini:**

- "Explore the codebase and identify the core modules"
- "What functions are most coupled to the database layer?"
- "Review the changes in this PR for potential issues"

**Caveats:**
- Gemini CLI may use `~/.gemini/settings.json` or `~/.gemini/config.yaml` depending on version. Check `gemini --version` and docs.
- The server process is managed by Gemini CLI — it auto-starts and auto-stops with the session.
- Tool names may be prefixed with the server name in Gemini's interface (e.g., `code-analyzer__search_graph`).

---

### 5. Continue (VS Code / JetBrains)

Continue is an open-source AI code assistant for VS Code and JetBrains IDEs.

**Config file:** `~/.continue/config.json`

```json
{
  "models": [...],
  "experimental": {
    "mcpServers": {
      "code-analyzer": {
        "command": "npx",
        "args": ["-y", "@code-analyzer/mcp"],
        "env": {
          "CODE_ANALYZER_PROJECT_DIR": "/absolute/path/to/your/project",
          "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
        }
      }
    }
  }
}
```

**After reloading Continue** (Cmd/Ctrl+Shift+P → "Continue: Reload"), tools appear in the chat's tool-calling interface.

**Tools available:** 28 tools with `analysis` profile. Continue's slash commands can invoke MCP tools directly — use `/tool search_graph query="authentication"` or let the model auto-select tools based on your query.

**Example queries you can ask Continue:**

- "Search the codebase for authentication-related code"
- "What's the call graph for the login endpoint?"
- "Review this file: src/services/payment.ts"

**Caveats:**
- Continue places MCP config under `experimental` — this key may change in future versions.
- Continue supports both VS Code and JetBrains — the config file is the same.
- In JetBrains, Continue settings are at `~/.continue/config.json` (not inside the IDE settings directory).
- Use `@code-analyzer` as a slash command prefix in Continue for tool-specific workflows.

---

### 6. Windsurf

Windsurf is an AI-powered IDE with native MCP support.

**Config file:** `~/.windsurf/mcp.json` or Windsurf Settings → MCP → Add Server.

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "${workspaceRoot}",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
      }
    }
  }
}
```

**Tools available:** 28 tools with `analysis` profile. Windsurf's Cascade agent automatically discovers and uses tools based on context.

**Example queries you can ask Windsurf:**

- "Find all functions that could be refactored for better performance"
- "Analyze the impact of changing the User model"
- "Trace the authentication flow from entry point to database"

**Caveats:**
- Windsurf supports `${workspaceRoot}` for dynamic project paths — prefer this over hard-coded paths.
- Windsurf's MCP config format follows the standard `mcpServers` structure — no Windsurf-specific extensions needed.
- If the server doesn't connect, check Windsurf's MCP logs (Help → Toggle Developer Tools → Console).

---

### 7. Cline (VS Code Extension)

Cline is a VS Code extension that provides an autonomous coding agent with MCP tool support.

**Config file:** VS Code settings (`settings.json`) or Cline's dedicated MCP settings UI.

**Method 1 — VS Code `settings.json`:**

```json
{
  "cline.mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "${workspaceFolder}",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
      }
    }
  }
}
```

**Method 2 — Cline MCP Settings UI:**

1. Open Cline (Cmd/Ctrl+Shift+P → "Cline: Focus on View")
2. Click the gear icon → MCP Servers
3. Add a new server with:
   - **Name:** `code-analyzer`
   - **Command:** `npx`
   - **Args:** `-y @code-analyzer/mcp`
   - **Env:** `CODE_ANALYZER_PROJECT_DIR=/path/to/your/project`

**Tools available:** 38 tools with `all` profile. Cline presents tools in its autonomous agent mode and lets the model decide which tools to call for each task.

**Example queries you can ask Cline:**

- "Index this project and then find all security-sensitive code patterns"
- "Run an impact analysis before I refactor the auth module"
- "Review all of my staged changes and suggest improvements"

**Caveats:**
- Cline uses `cline.mcpServers` (not `mcpServers`) in VS Code settings — this is Cline-specific.
- Cline's MCP tools are available in both Plan and Act modes.
- The Cline MCP settings UI is the easiest way to configure — it validates the JSON before saving.
- VS Code `${workspaceFolder}` works in Cline's settings — use it for team-portable configs.

---

### Transport Compatibility Matrix

| Client | stdio Support | HTTP+SSE Support | Auto-restart | Notes |
|--------|:------------:|:----------------:|:------------:|-------|
| Claude Desktop | ✅ | ❌ | ✅ | stdio only |
| Cursor | ✅ | ✅ | ✅ | Both transports |
| Codex | ✅ | ✅ | ❌ | Manual restart |
| Gemini CLI | ✅ | ❌ | ✅ | stdio only |
| Continue | ✅ | ✅ | ✅ | Both transports |
| Windsurf | ✅ | ✅ | ✅ | Both transports |
| Cline | ✅ | ✅ | ❌ | Manual restart |

**For HTTP transport**, add `"--transport", "http", "--port", "3100"` to the args array in any config above, and point the client to `http://localhost:3100/sse` or `http://localhost:3100/mcp`.

---

### Quick Verification

After configuring any client, verify your setup by asking:

1. **"List all indexed projects"** — should call `list_projects`
2. **"Analyze the repository"** — should call `analyze_repository`
3. **"Search for authentication code"** — should call `search_graph` or `search_code`
4. **"Review this file for issues"** — should call `review_file`

If any tool returns an error, check the client's MCP logs for details:
- **Claude Desktop:** `~/Library/Logs/Claude/mcp*.log` (macOS)
- **Cursor:** MCP panel → click the server → view logs
- **Continue:** VS Code Output panel → "Continue"
- **Windsurf:** Help → Toggle Developer Tools → Console
- **Cline:** Cline output channel in VS Code

---

## Transport Configuration

Code Analyzer supports two transport modes:

### stdio (Default)

The standard MCP transport — works out of the box with all MCP clients.

```bash
npx @code-analyzer/mcp
# Uses stdin/stdout for JSON-RPC communication
```

### HTTP with SSE

For remote or multi-client deployments:

```bash
npx @code-analyzer/mcp --transport http --port 3100
# Runs an HTTP server on port 3100 with SSE streaming
```

Set via environment:

```bash
export CODE_ANALYZER_MCP_ENABLE_STREAMING=true
npx @code-analyzer/mcp --transport http
```

---

## All 38 Tools

### Indexing & Lifecycle (4 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `analyze_repository` | [Experimental] | Analyze and index a code repository | `path` (required), `language`, `incremental` |
| `list_projects` | [Experimental] | List all indexed projects | None |
| `delete_project` | [Experimental] | Delete an indexed project and its data | `projectId` (required) |
| `index_status` | [Experimental] | Get indexing status for a project | `projectId` (required) |

### Querying & Exploration (10 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `search_graph` | [Partial] | Search the knowledge graph by keyword | `query` (required), `labels`, `limit` |
| `search_code` | [Partial] | Search source code using full-text search | `query` (required), `filePath`, `limit` |
| `semantic_search` | [Experimental] | Semantic search using embeddings | `query` (required), `limit` |
| `trace_call_path` | [Experimental] | Trace call paths between symbols | `source` (required), `target`, `maxDepth` |
| `query_graph` | [Partial] | Execute a Cypher query against the graph | `query` (required), `limit` |
| `get_code_snippet` | [Experimental] | Retrieve a code snippet by file and line range | `filePath` (required), `startLine`, `endLine` |
| `get_architecture` | [Experimental] | Get architectural overview of a project | `projectId` (required) |
| `get_graph_schema` | [Experimental] | Get graph schema information | None |
| `explore_symbol` | [Experimental] | Explore a symbol and its relationships | `symbol` (required), `projectId` |
| `find_implementations` | [Experimental] | Find implementations of an interface | `interfaceName` (required), `projectId` |

### Change & Impact (4 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `detect_changes` | [Experimental] | Detect code changes between references | `projectId` (required), `fromRef`, `toRef` |
| `impact_analysis` | [Experimental] | Analyze impact of code changes | `projectId` (required), `symbol` (required) |
| `route_map` | [Experimental] | Get route map for a project | `projectId` (required) |
| `check_cycles` | [Experimental] | Check for circular dependencies | `projectId` (required) |

### Code Review (2 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `review_diff` | [Experimental] | Review a git diff for issues | `projectId` (required), `fromRef`, `toRef` |
| `review_file` | [Experimental] | Review a single file for issues | `filePath` (required), `content` (required) |

### PR Review (2 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `review_pr` | [Experimental] | Review a pull request | `projectId` (required), `prNumber` (required) |
| `check_standards` | [Experimental] | Check code against project standards | `projectId` (required), `standardId` (required) |

### Reports (3 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `generate_report` | [Experimental] | Generate an analysis report | `projectId` (required), `type`, `format` |
| `export_report` | [Experimental] | Export a report in specified format | `reportId` (required), `format` |
| `get_recommendations` | [Experimental] | Get code improvement recommendations | `projectId` (required), `category` |

### Cross-Repo (6 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `cross_repo_search` | [Experimental] | Search across multiple repositories | `query` (required), `groupIds` |
| `cross_repo_trace` | [Experimental] | Trace call paths across repositories | `source` (required), `target` |
| `cross_repo_impact` | [Experimental] | Analyze cross-repo impact of changes | `symbol` (required), `groupIds` |
| `manage_repo_group` | [Experimental] | Manage repository groups | `action` (required), `groupId` |
| `sync_contracts` | [Experimental] | Synchronize contracts across repos | `groupId` (required) |
| `discover_related_repos` | [Experimental] | Discover related repositories | `owner` (required), `topics` |

### PDG (3 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `pdg_query` | [Experimental] | Query the program dependence graph | `projectId` (required), `function` (required) |
| `taint_analysis` | [Experimental] | Perform taint analysis for security | `projectId` (required), `source` (required) |
| `explain_taint` | [Experimental] | Explain a taint analysis path | `pathId` (required) |

### Standards, ADR, Agent (4 tools)

| Tool | Status | Description | Key Parameters |
|------|--------|-------------|---------------|
| `list_standards` | [Experimental] | List project standards | `projectId`, `category` |
| `create_standard` | [Experimental] | Create a new project standard | `standard` (required) |
| `manage_adr` | [Experimental] | Manage Architecture Decision Records | `action` (required), `projectId` |
| `install_skills` | [Functional] | Install agent skills for the project | `agentType` (required), `projectId` |

### Tool Profiles

| Profile | Tool Count | Categories Included |
|---------|-----------|-------------------|
| `all` | 38 | All tools |
| `analysis` | 28 | Querying, Review, Impact, PR Review, Reports, Cross-Repo, PDG |
| `scout` | 1 | `discover_related_repos` only |

---

## 15 Resources

Resources provide structured data access for AI agents:

| Resource URI | Name | Description |
|-------------|------|-------------|
| `code-analyzer://resources/projects` | Projects | List of all indexed projects |
| `code-analyzer://resources/project-schema` | Project Schema | Schema definition for project data |
| `code-analyzer://resources/clusters` | Clusters | Community clusters detected in the codebase |
| `code-analyzer://resources/processes` | Processes | Business processes modeled in the codebase |
| `code-analyzer://resources/routes` | Routes | HTTP routes and API endpoints |
| `code-analyzer://resources/entrypoints` | Entry Points | Application entry points |
| `code-analyzer://resources/hotspots` | Hotspots | Code hotspots with high complexity or churn |
| `code-analyzer://resources/adrs` | ADRs | Architecture Decision Records |
| `code-analyzer://resources/stats` | Stats | Project statistics and metrics |
| `code-analyzer://resources/graph` | Graph | Complete knowledge graph for a project |
| `code-analyzer://resources/groups` | Groups | Repository groups |
| `code-analyzer://resources/contracts` | Contracts | Cross-repo contracts |
| `code-analyzer://resources/config` | Config | Server configuration |
| `code-analyzer://resources/health` | Health | Server health and status |
| `code-analyzer://resources/reports` | Reports | Generated analysis reports |

---

## 5 Prompts

Reusable prompt templates for common workflows:

| Prompt | Description | Required Arguments |
|--------|-------------|-------------------|
| `explore-codebase` | Explore and understand an unknown codebase | `projectId`, `focus?`, `depth?` |
| `review-changes` | Review code changes for quality, security, and best practices | `projectId`, `fromRef`, `toRef?`, `focus?` |
| `debug-issue` | Debug a code issue by tracing execution paths | `projectId`, `entryPoint`, `symptom` |
| `refactor-plan` | Plan a code refactoring with impact analysis | `projectId`, `target`, `goal` |
| `architecture-review` | Review project architecture for patterns and anti-patterns | `projectId`, `aspect?`, `generateADR?` |

---

## Cypher Query Language Reference

Code Analyzer implements a Cypher-like graph query language for querying the knowledge graph.

### Basic Syntax

```cypher
MATCH (variable:Label)-[:RELATIONSHIP]->(otherVariable:Label)
WHERE condition
RETURN variable.property, otherVariable.property
ORDER BY expression [ASC|DESC]
LIMIT number
```

### Supported Node Labels

All 33 node labels are queryable. Common labels:

| Label | Description |
|-------|-------------|
| `Function` | A standalone function |
| `Method` | A class method |
| `Class` | A class definition |
| `Interface` | An interface definition |
| `Module` | A module/file unit |
| `Route` | An HTTP route handler |
| `Test` | A test definition |

### Supported Relationships

All 39 relationship types. Common types:

| Type | Description |
|------|-------------|
| `CALLS` | Function/method call |
| `IMPLEMENTS` | Class implementing an interface |
| `EXTENDS` | Class inheritance |
| `IMPORTS` | Import statement |
| `HANDLES_ROUTE` | Route handler registration |
| `TESTS` | Test-to-symbol relationship |

### Query Examples

Find all functions that call a specific function:

```cypher
MATCH (caller:Function)-[:CALLS]->(callee:Function)
WHERE callee.name = 'authenticateUser'
RETURN caller.name, caller.filePath
LIMIT 20
```

Find class hierarchy:

```cypher
MATCH (child:Class)-[:EXTENDS]->(parent:Class)
RETURN child.name, parent.name
ORDER BY child.name ASC
```

Find all routes and their handlers:

```cypher
MATCH (handler)-[:HANDLES_ROUTE]->(route:Route)
RETURN route.routePath, route.routeMethod, handler.name
```

Find tests for a specific function:

```cypher
MATCH (test:Test)-[:TESTS]->(func:Function)
WHERE func.name = 'calculateTotal'
RETURN test.name, test.filePath
```

Count symbols by label:

```cypher
MATCH (n)
RETURN n.label AS label, COUNT(n) AS count
ORDER BY count DESC
```

### Aggregation Functions

- `COUNT` — Count matching items
- `SUM` — Sum of numeric values
- `AVG` — Average of numeric values
- `MIN` — Minimum value
- `MAX` — Maximum value

### Cypher Query Pipeline

```
Query String
    │
    ▼
[Lexer] → Token[] (KEYWORD, IDENTIFIER, STRING, NUMBER, OPERATOR, PUNCTUATION)
    │
    ▼
[Parser] → AST (MatchClause, WhereClause, ReturnClause)
    │
    ▼
[Planner] → Execution Plan
    │
    ▼
[Executor] → Results from SqliteStore
```

---

## Authentication Setup

The MCP server supports API key authentication for HTTP transport:

```json
{
  "mcp": {
    "toolProfile": "all",
    "enableResources": true
  }
}
```

Configure API keys in the `AuthMiddleware`:

```typescript
import { AuthMiddleware } from '@code-analyzer/mcp';

const auth = new AuthMiddleware(['your-api-key-here']);
```

Clients pass the key via headers:
- `x-api-key: your-api-key-here`
- `Authorization: Bearer your-api-key-here`

When no API keys are configured, all requests are allowed.

---

## Rate Limiting Configuration

The token bucket rate limiter controls tool invocation frequency:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `capacity` | 100 | Maximum tokens in the bucket |
| `refillRate` | 0.5 tokens/ms | Token refill rate (~30 tokens/minute) |

```typescript
import { RateLimiter } from '@code-analyzer/mcp';

const limiter = new RateLimiter(200, 1.0); // 200 capacity, 60 tokens/min
```

When rate-limited, the response includes a `retryAfterMs` field indicating when to retry.

---

## Tool Policies

Tool policies control which tools are available based on the configured profile:

```typescript
import { ToolPolicy } from '@code-analyzer/mcp';

const policy = new ToolPolicy('analysis');
// Only analysis-profile tools are available

policy.setProfile('all');
// All 38 tools are now available
```

---

## Troubleshooting

### Server won't start

```
Error: Cannot find module '@code-analyzer/mcp'
```

**Solution**: Install the package globally or use `npx -y @code-analyzer/mcp`.

### Tools not appearing in client

**Check**:
1. Verify the MCP server is running (check client logs)
2. Ensure `toolProfile` is set to `"all"` or the expected profile
3. Restart the MCP client after configuration changes

### Slow indexing

**Solutions**:
- Increase `parseWorkers` for more parallelism
- Reduce `maxFiles` or tighten `excludePatterns`
- Enable `incremental` indexing for subsequent runs
- Check `cacheDir` has sufficient disk space

### Rate limiting errors

**Solutions**:
- Increase rate limiter capacity or refill rate
- Reduce concurrent tool invocations
- Check `RequestLogger.getStats()` for usage patterns

### Resource not found errors

```
Resource not found: code-analyzer://resources/...
```

**Check**:
1. Verify `enableResources` is `true`
2. Ensure the project has been indexed (`analyze_repository`)
3. Check resource URI spelling

### Authentication failures

```
Missing API key
Invalid API key
```

**Check**:
1. Include `x-api-key` or `Authorization: Bearer <key>` header
2. Verify the API key matches the server's configured keys
3. If no keys are configured, auth is disabled (all requests allowed)

---

## See Also

- [ARCHITECTURE.md](ARCHITECTURE.md) — System architecture and MCP integration details
- [CONFIGURATION.md](CONFIGURATION.md) — Full configuration reference including MCP options
- [CODE-REVIEW.md](CODE-REVIEW.md) — Code review workflow and best practices
- [language-support.md](language-support.md) — Language feature matrix
