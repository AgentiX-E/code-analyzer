# MCP Server Guide

> Setup and usage guide for the Code Analyzer MCP server — expose 38 tools, 15 resources, and 5 prompts to AI coding agents.

---

## What is MCP?

The **Model Context Protocol (MCP)** is an open protocol that standardizes how AI agents connect to external tools and data sources. Code Analyzer implements an MCP server that exposes deep code intelligence capabilities — knowledge graph queries, code review, impact analysis, and more — as callable tools for AI agents.

---

## Quick Setup

### Claude Desktop

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

### Cursor

Add to Cursor's MCP configuration (Settings → MCP → Add Server):

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/path/to/your/project",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
      }
    }
  }
}
```

### Continue (VS Code / JetBrains)

Add to `~/.continue/config.json`:

```json
{
  "experimental": {
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
}
```

### Codex / Windsurf / Other MCP Clients

Any MCP-compatible client can connect. Use the stdio transport:

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

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `analyze_repository` | Analyze and index a code repository | `path` (required), `language`, `incremental` |
| `list_projects` | List all indexed projects | None |
| `delete_project` | Delete an indexed project and its data | `projectId` (required) |
| `index_status` | Get indexing status for a project | `projectId` (required) |

### Querying & Exploration (10 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `search_graph` | Search the knowledge graph by keyword | `query` (required), `labels`, `limit` |
| `search_code` | Search source code using full-text search | `query` (required), `filePath`, `limit` |
| `semantic_search` | Semantic search using embeddings | `query` (required), `limit` |
| `trace_call_path` | Trace call paths between symbols | `source` (required), `target`, `maxDepth` |
| `query_graph` | Execute a Cypher query against the graph | `query` (required), `limit` |
| `get_code_snippet` | Retrieve a code snippet by file and line range | `filePath` (required), `startLine`, `endLine` |
| `get_architecture` | Get architectural overview of a project | `projectId` (required) |
| `get_graph_schema` | Get graph schema information | None |
| `explore_symbol` | Explore a symbol and its relationships | `symbol` (required), `projectId` |
| `find_implementations` | Find implementations of an interface | `interfaceName` (required), `projectId` |

### Change & Impact (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `detect_changes` | Detect code changes between references | `projectId` (required), `fromRef`, `toRef` |
| `impact_analysis` | Analyze impact of code changes | `projectId` (required), `symbol` (required) |
| `route_map` | Get route map for a project | `projectId` (required) |
| `check_cycles` | Check for circular dependencies | `projectId` (required) |

### Code Review (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `review_diff` | Review a git diff for issues | `projectId` (required), `fromRef`, `toRef` |
| `review_file` | Review a single file for issues | `filePath` (required), `content` (required) |

### PR Review (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `review_pr` | Review a pull request | `projectId` (required), `prNumber` (required) |
| `check_standards` | Check code against project standards | `projectId` (required), `standardId` (required) |

### Reports (3 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `generate_report` | Generate an analysis report | `projectId` (required), `type`, `format` |
| `export_report` | Export a report in specified format | `reportId` (required), `format` |
| `get_recommendations` | Get code improvement recommendations | `projectId` (required), `category` |

### Cross-Repo (6 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `cross_repo_search` | Search across multiple repositories | `query` (required), `groupIds` |
| `cross_repo_trace` | Trace call paths across repositories | `source` (required), `target` |
| `cross_repo_impact` | Analyze cross-repo impact of changes | `symbol` (required), `groupIds` |
| `manage_repo_group` | Manage repository groups | `action` (required), `groupId` |
| `sync_contracts` | Synchronize contracts across repos | `groupId` (required) |
| `discover_related_repos` | Discover related repositories | `owner` (required), `topics` |

### PDG (3 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `pdg_query` | Query the program dependence graph | `projectId` (required), `function` (required) |
| `taint_analysis` | Perform taint analysis for security | `projectId` (required), `source` (required) |
| `explain_taint` | Explain a taint analysis path | `pathId` (required) |

### Standards, ADR, Agent (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `list_standards` | List project standards | `projectId`, `category` |
| `create_standard` | Create a new project standard | `standard` (required) |
| `manage_adr` | Manage Architecture Decision Records | `action` (required), `projectId` |
| `install_skills` | Install agent skills for the project | `agentType` (required), `projectId` |

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
