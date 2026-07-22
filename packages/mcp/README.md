# @code-analyzer/mcp

> MCP (Model Context Protocol) Server exposing code intelligence as 38 tools, 15 resources, and 5 prompts for AI coding agents.

[![npm](https://img.shields.io/npm/v/@code-analyzer/mcp?color=blue)](https://www.npmjs.com/package/@code-analyzer/mcp)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

## Overview

`@code-analyzer/mcp` is the Model Context Protocol server for the Code Analyzer platform. It exposes a comprehensive suite of 38 tools that AI coding agents (Claude Code, Cursor, Codex, Windsurf, CodeBuddy, Aider, Continue) can invoke to query, explore, review, and understand codebases. Built on the official `@modelcontextprotocol/sdk`, it supports both stdio (local) and HTTP/SSE (remote) transports with built-in middleware for authentication, rate limiting, tool policy enforcement, and request logging.

The server wraps a full openCypher read-subset query engine (lexer, recursive-descent parser, planner, and SQL-backed executor) that translates graph queries into efficient searches against an in-memory knowledge graph. An integrated skill installer auto-generates agent-specific skill files for 10 different AI coding assistants.

```
┌──────────────────────────────────────────────────────────┐
│                      AI Coding Agent                      │
│  (Claude Code / Cursor / CodeBuddy / Codex / Windsurf…)  │
└─────────────┬───────────────────────────────┬────────────┘
              │    MCP Protocol                │
              │    (stdio or HTTP/SSE)         │
┌─────────────▼───────────────────────────────▼────────────┐
│                 @code-analyzer/mcp                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                   Middleware                         │ │
│  │  AuthMiddleware │ RateLimiter │ ToolPolicy │ Logger  │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌──────────┬───────────┬────────────┬─────────────────┐ │
│  │ 38 Tools │15 Resources│ 5 Prompts  │ Skill Installer │ │
│  └──────────┴───────────┴────────────┴─────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Cypher Query Engine                     │ │
│  │  Lexer ──▶ Parser ──▶ Planner ──▶ Executor          │ │
│  └──────────────────────┬──────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│              InMemoryGraphStore (Knowledge Graph)                │
│  38 node labels · 38 relationship types · FTS5 index     │
└──────────────────────────────────────────────────────────┘
```

## Installation

```bash
npm install @code-analyzer/mcp
```

The package depends on the MCP SDK and the internal Code Analyzer workspace packages. It should be used within the monorepo or as a dependency of `@code-analyzer/cli`.

```bash
# Install within the monorepo
pnpm install --filter @code-analyzer/mcp

# Build TypeScript
pnpm --filter @code-analyzer/mcp build

# Run tests
pnpm --filter @code-analyzer/mcp test
```

## Quick Start

### Programmatic Usage (stdio transport)

```typescript
import { CodeAnalyzerMCPServer } from '@code-analyzer/mcp';

// Create server with default configuration (all tools, stdio)
const server = new CodeAnalyzerMCPServer({
  name: 'code-analyzer',
  version: '0.1.0',
  toolProfile: 'all',
});

// Start on stdio (for local agent integration)
await server.startStdio();

// Graceful shutdown
process.on('SIGINT', async () => {
  await server.shutdown();
  process.exit(0);
});
```

### HTTP/SSE Transport (remote agents)

```typescript
import { CodeAnalyzerMCPServer } from '@code-analyzer/mcp';

const server = new CodeAnalyzerMCPServer({
  toolProfile: 'analysis',
  enableResources: true,
  enablePrompts: true,
  maxResults: 100,
});

// Start on HTTP port 3000 with SSE streaming
await server.startHTTP(3000);
```

### Configuring Authentication

```typescript
import { AuthMiddleware } from '@code-analyzer/mcp';

const auth = new AuthMiddleware(['my-secret-api-key-1', 'my-secret-api-key-2']);

// Access the underlying server instance
const mcpServer = new CodeAnalyzerMCPServer();
mcpServer.getServer(); // MCP SDK Server instance
```

### Running Cypher Queries Directly

```typescript
import { tokenize, parse, plan, execute } from '@code-analyzer/mcp';
import { InMemoryGraphStore } from '@code-analyzer/infra';

const store = new InMemoryGraphStore();
const cypher = 'MATCH (f:Function)-[:CALLS]->(c:Function) RETURN f.name, c.name LIMIT 10';

const tokens = tokenize(cypher);
const ast = parse(tokens);
const queryPlan = plan(ast);
const result = execute(queryPlan, store);

console.log(result.columns); // ['f.name', 'c.name']
console.log(result.rows);    // [{ 'f.name': 'main', 'c.name': 'parseArgs' }, ...]
console.log(result.executionTimeMs); // 4
```

### Installing Agent Skills

```typescript
import { SkillInstaller } from '@code-analyzer/mcp';

const installer = new SkillInstaller();

// Detect available agents
const agents = installer.detectAgents();
console.log(agents.map(a => a.name)); // ['claude-code', 'cursor', 'codex', ...]

// Generate repository-specific skills
const skills = installer.generateRepoSKills('my-project-id');
console.log(skills.map(s => s.name));
// ['code-analyzer-exploration', 'code-analyzer-debugging', ...]

// Get skill content
const content = installer.getSkillContent('exploration', 'my-project-id');
```

## API Reference

### Tool Categories (38 Tools)

#### Indexing & Lifecycle (4 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `analyze_repository` | Analyze and index a code repository | `path` |
| `list_projects` | List all indexed projects | (none) |
| `delete_project` | Delete an indexed project and its data | `projectId` |
| `index_status` | Get indexing status for a project | `projectId` |

#### Querying & Exploration (10 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `search_graph` | Search the knowledge graph by keyword (FTS5) | `query` |
| `search_code` | Search source code using full-text search | `query` |
| `semantic_search` | Semantic search using embeddings | `query` |
| `trace_call_path` | Trace call paths between symbols (BFS) | `sourceSymbol`, `projectId` |
| `query_graph` | Execute a Cypher query against the graph | `cypher` |
| `get_code_snippet` | Retrieve a code snippet by file and line range | `filePath`, `projectId` |
| `get_architecture` | Get architectural overview of a project | `projectId` |
| `get_graph_schema` | Get graph schema information (labels, edges) | `projectId` |
| `explore_symbol` | Explore a symbol and its relationships | `symbolName`, `projectId` |
| `find_implementations` | Find implementations of an interface | `interfaceName`, `projectId` |

#### Change & Impact (4 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `detect_changes` | Detect code changes between references | `projectId` |
| `impact_analysis` | Analyze impact of code changes (BFS traversal) | `projectId`, `fromRef`, `toRef` |
| `route_map` | Get route map for a project | `projectId` |
| `check_cycles` | Check for circular dependencies (DFS) | `projectId` |

#### Code Review (2 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `review_diff` | Review a git diff for issues | `projectId` |
| `review_file` | Review a single file for issues | `projectId`, `filePath` |

#### PR Review (2 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `review_pr` | Review a pull request with risk scoring | `projectId` |
| `check_standards` | Check code against project standards | `projectId` |

#### Reports (3 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `generate_report` | Generate an analysis report (pr-review, codebase-audit, impact-analysis, architecture-review, standards-compliance) | `projectId`, `type` |
| `export_report` | Export a report in markdown, json, html, or pdf | `reportId`, `format` |
| `get_recommendations` | Get code improvement recommendations | `projectId` |

#### Cross-Repo (6 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `cross_repo_search` | Search across multiple repositories | `query` |
| `cross_repo_trace` | Trace call paths across repositories | `sourceSymbol`, `groupId` |
| `cross_repo_impact` | Analyze cross-repo impact of changes | `symbol`, `groupId` |
| `manage_repo_group` | Manage repository groups (create, update, delete, list) | `action` |
| `sync_contracts` | Synchronize contracts across repos | `groupId` |
| `discover_related_repos` | Discover related repositories | `projectId` |

#### PDG - Program Dependence Graph (3 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `pdg_query` | Query the program dependence graph (CFG, DATA_FLOWS, REACHING_DEF, TAINTED, SANITIZES) | `functionId`, `projectId` |
| `taint_analysis` | Perform taint analysis for security vulnerabilities | `projectId` |
| `explain_taint` | Explain a taint analysis path | `taintPathId`, `projectId` |

#### Standards (2 tools)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `list_standards` | List project standards (10 categories) | `projectId` |
| `create_standard` | Create a new project standard with rules | `projectId`, `name`, `category` |

#### ADR (1 tool)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `manage_adr` | Manage Architecture Decision Records (create, list, get, update, search) | `projectId`, `action` |

#### Agent (1 tool)

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `install_skills` | Install agent skills for the project (8 agent targets) | `agents` |

### Resources (15)

Resources provide structured data access for AI agents:

| URI | Description |
|-----|-------------|
| `code-analyzer://resources/projects` | List of all indexed projects |
| `code-analyzer://resources/project-schema` | Schema definition for project data |
| `code-analyzer://resources/clusters` | Community clusters detected in the codebase |
| `code-analyzer://resources/processes` | Business processes modeled in the codebase |
| `code-analyzer://resources/routes` | HTTP routes and API endpoints |
| `code-analyzer://resources/entrypoints` | Application entry points |
| `code-analyzer://resources/hotspots` | Code hotspots with high complexity or churn |
| `code-analyzer://resources/adrs` | Architecture Decision Records |
| `code-analyzer://resources/stats` | Project statistics and metrics |
| `code-analyzer://resources/graph` | Complete knowledge graph for a project |
| `code-analyzer://resources/groups` | Repository groups |
| `code-analyzer://resources/contracts` | Cross-repo contracts |
| `code-analyzer://resources/config` | Server configuration |
| `code-analyzer://resources/health` | Server health and status |
| `code-analyzer://resources/reports` | Generated analysis reports |

### Prompts (5)

Reusable prompt templates with argument schemas:

| Prompt | Description | Arguments |
|--------|-------------|-----------|
| `explore-codebase` | Explore and understand an unknown codebase | `projectId` (required), `focus`, `depth` |
| `review-changes` | Review code changes for quality, security, and best practices | `projectId` (required), `fromRef` (required), `toRef`, `focus` |
| `debug-issue` | Debug a code issue by tracing execution paths | `projectId` (required), `entryPoint` (required), `symptom` (required) |
| `refactor-plan` | Plan a code refactoring with impact analysis | `projectId` (required), `target` (required), `goal` (required) |
| `architecture-review` | Review project architecture for patterns and improvements | `projectId` (required), `aspect`, `generateADR` |

### Cypher Query Engine

The embedded query engine supports a full openCypher read-subset with a 4-phase pipeline:

```
Query String → Lexer → Tokens → Parser → AST → Planner → Query Plan → Executor → Results
```

**Supported Cypher syntax:**

```cypher
-- Node patterns with labels, properties, and variable binding
MATCH (f:Function { name: 'parseArgs' })-[:CALLS]->(c:Function)
MATCH (m:Module)-[:IMPORTS]->(dep:Module)
MATCH (i:Interface)-[:IMPLEMENTS]-(c:Class)

-- Relationship direction
MATCH (f:Function)<-[:CALLS]-(caller:Function)
MATCH (a)-[r:CALLS*1..5]->(b)

-- WHERE clauses with rich operators
WHERE f.complexity > 10 AND f.isExported = true
WHERE f.name CONTAINS 'parse'
WHERE f.filePath STARTS WITH 'src/'
WHERE f.name REGEX '^get[A-Z]'
WHERE f.language IN ['typescript', 'javascript']
WHERE f IS NOT NULL

-- RETURN with aliases and aggregations
RETURN f.name, f.complexity AS complexity
RETURN COUNT(f) AS totalFunctions
RETURN SUM(f.complexity) AS totalComplexity

-- ORDER BY, SKIP, LIMIT
ORDER BY f.complexity DESC
SKIP 10 LIMIT 20

-- Multiple MATCH patterns
MATCH (m:Module), (f:Function)
WHERE f MEMBER_OF m

-- UNION
MATCH (f:Function) RETURN f.name
UNION ALL
MATCH (c:Class) RETURN c.name
```

**Node Labels (38):** `Project`, `Package`, `Folder`, `File`, `Module`, `Class`, `Interface`, `Function`, `Method`, `Constructor`, `Property`, `Enum`, `TypeAlias`, `Struct`, `Trait`, `Variable`, `Route`, `Tool`, `Component`, `Test`, `Community`, `Process`, `Config`, `ADR`, `BasicBlock`, `InfraResource`, `CrossRepoFunction`, `CrossRepoInterface`, `CrossRepoModule`, `Contract`, `Event`, `DataSource`, `Sink`

**Relationship Types (38):** `CONTAINS`, `DEFINES`, `HAS_METHOD`, `HAS_PROPERTY`, `MEMBER_OF`, `BELONGS_TO`, `EXTENDS`, `IMPLEMENTS`, `METHOD_OVERRIDES`, `METHOD_IMPLEMENTS`, `CALLS`, `IMPORTS`, `ACCESSES`, `INSTANTIATES`, `USES_TYPE`, `HANDLES_ROUTE`, `HANDLES_TOOL`, `EXPOSES`, `INJECTS`, `SIMILAR_TO`, `SEMANTICALLY_RELATED`, `TESTS`, `CHANGES_WITH`, `DATA_FLOWS`, `STEP_IN_PROCESS`, `CFG`, `REACHING_DEF`, `TAINTED`, `SANITIZES`, `TAINT_PATH`, `EMITS`, `LISTENS_ON`, `CONFIGURES`, `CROSS_REPO_DEPENDS`, `CROSS_REPO_CALLS`, `CROSS_REPO_IMPLEMENTS`, `CROSS_REPO_IMPORTS`, `CROSS_REPO_EXPOSES`, `CROSS_REPO_CONTRACT`

### Transport Configuration

The server supports two transport modes:

**stdio** (default, for local agent integration):

```typescript
const server = new CodeAnalyzerMCPServer();
await server.startStdio();
// Process communicates via stdin/stdout JSON-RPC
```

**HTTP with SSE** (for remote/web-based agents):

```typescript
const server = new CodeAnalyzerMCPServer();
await server.startHTTP(3000);
// Listens on port 3000, falls back to stdio if HTTP fails
```

### Middleware Pipeline

Every tool invocation passes through the middleware chain in order:

```
Request → AuthMiddleware → RateLimiter → ToolPolicy → Tool Execution → RequestLogger → Response
```

| Middleware | Class | Description |
|------------|-------|-------------|
| **Auth** | `AuthMiddleware` | Validates `x-api-key` or `Authorization: Bearer` headers. Allows all requests when no keys are configured. |
| **Rate Limiting** | `RateLimiter` | Token bucket algorithm. Default: 100 tokens capacity, 0.5 tokens/ms refill (~30 tokens/min). Per-tool buckets. |
| **Tool Policy** | `ToolPolicy` | Filters tools by profile (`all`, `analysis`, `scout`). Restricts which tools are visible to agents. |
| **Request Logging** | `RequestLogger` | Records tool name, arguments, duration, errors, and timestamps. Keeps last 1000 entries by default. |

### Tool Profiles

Tools are assigned to profiles for granular access control:

- **`all`** — All 38 tools (default)
- **`analysis`** — Querying, exploration, review, impact, PDG, cross-repo tools (30 tools)
- **`scout`** — Discovery-only tools (limited subset)

```typescript
const server = new CodeAnalyzerMCPServer({ toolProfile: 'analysis' });
```

### Skill Installer

The `SkillInstaller` generates agent-specific skill files with workflow guidance and tool references. Supported agent targets:

| Agent | Format | Install Path |
|-------|--------|-------------|
| `claude-code` | Markdown | `.claude/skills/` |
| `cursor` | Markdown | `.cursor/skills/` |
| `codex` | Markdown | `.openai/skills/` |
| `windsurf` | Markdown | `.windsurf/skills/` |
| `codebuddy` | Markdown | `.codebuddy/skills/` |
| `aider` | Markdown | `.aider/skills/` |
| `continue` | YAML | `.continue/rules/` |
| `custom` | Markdown | `.ai/skills/` |

Available skill templates (10):

| Skill | Category | Key Tools |
|-------|----------|-----------|
| `exploration` | exploration | `get_architecture`, `explore_symbol`, `search_graph`, `trace_call_path` |
| `debugging` | debugging | `trace_call_path`, `explore_symbol`, `query_graph`, `search_code` |
| `impact` | impact | `impact_analysis`, `detect_changes`, `check_cycles` |
| `refactoring` | refactoring | `impact_analysis`, `find_implementations`, `check_cycles`, `review_file` |
| `review` | review | `review_diff`, `review_file`, `check_standards` |
| `pr-review` | review | `review_pr`, `review_diff`, `check_standards`, `generate_report` |
| `architecture` | architecture | `get_architecture`, `route_map`, `check_cycles`, `manage_adr` |
| `cross-repo` | architecture | `cross_repo_search`, `cross_repo_trace`, `cross_repo_impact` |
| `security` | security | `taint_analysis`, `pdg_query`, `review_file`, `check_standards` |
| `tool-reference` | reference | Full catalog of all 38 tools |

## Configuration

### `MCPServerConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `'code-analyzer'` | Server name reported to MCP clients |
| `version` | `string` | `'0.1.0'` | Server version |
| `toolProfile` | `ToolProfile` | `'all'` | Tool profile filter (`all`, `analysis`, `scout`) |
| `maxResults` | `number` | `100` | Maximum results per tool invocation |
| `enableStreaming` | `boolean` | `false` | Enable streaming responses |
| `enableResources` | `boolean` | `true` | Enable resource listing and reading |
| `enablePrompts` | `boolean` | `true` | Enable prompt listing and retrieval |

### `RateLimiter` Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `capacity` | `number` | `100` | Maximum tokens in bucket |
| `refillRate` | `number` | `0.5` | Tokens per millisecond (~30/min) |

### `RequestLogger` Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxLogs` | `number` | `1000` | Maximum log entries to retain |

### `GraphSchema` (Cypher Engine)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `nodeLabels` | `string[]` | 38 labels | Valid node labels |
| `relationshipTypes` | `string[]` | 38 types | Valid relationship types |
| `nodeProperties` | `string[]` | 12 props | Queryable node properties |
| `edgeProperties` | `string[]` | 2 props | Queryable edge properties |

## Package Dependencies

| Dependency | Description |
|------------|-------------|
| `@code-analyzer/shared` | Shared types (`ToolDefinition`, `MCPServerConfig`, graph types) |
| `@code-analyzer/core` | Core analysis engine interfaces |
| `@code-analyzer/infra` | `InMemoryGraphStore` — in-memory graph storage with FTS5 |
| `@code-analyzer/analyzer` | Static analysis and AST parsing |
| `@code-analyzer/intelligence` | AI/LLM-powered code intelligence |
| `@modelcontextprotocol/sdk` | Official MCP TypeScript SDK (^1.0.0) |

### Dev Dependencies

| Dependency | Description |
|------------|-------------|
| `typescript` | TypeScript compiler (^5.6.0) |
| `vitest` | Unit test runner (^2.1.0) |

## Architecture

### Source Layout

```
src/
├── index.ts                    # Public API exports
├── server/
│   └── mcp-server.ts           # MCPServer class (start, stop, handlers)
├── tools/
│   ├── index.ts                # createToolRegistry() — registers all 38 tools
│   ├── registry.ts             # ToolRegistry class, makeSchema helper
│   ├── indexing-lifecycle.ts   # analyze_repository, list_projects, delete_project, index_status
│   ├── querying-exploration.ts # search_graph, search_code, semantic_search, trace_call_path,
│   │                            # query_graph, get_code_snippet, get_architecture,
│   │                            # get_graph_schema, explore_symbol, find_implementations
│   ├── change-impact.ts        # detect_changes, impact_analysis, route_map, check_cycles
│   ├── code-review.ts          # review_diff, review_file
│   ├── pr-review.ts            # review_pr, check_standards
│   ├── reports.ts              # generate_report, export_report, get_recommendations
│   ├── cross-repo.ts           # cross_repo_search, cross_repo_trace, cross_repo_impact,
│   │                            # manage_repo_group, sync_contracts, discover_related_repos
│   ├── pdg.ts                  # pdg_query, taint_analysis, explain_taint
│   └── standards-adr-agent.ts  # list_standards, create_standard, manage_adr, install_skills
├── cypher/
│   ├── index.ts                # Cypher engine public API
│   ├── lexer.ts                # Tokenizer (keywords, identifiers, operators, literals)
│   ├── parser.ts               # Recursive-descent parser (MATCH, WHERE, RETURN, ORDER BY, expressions)
│   ├── planner.ts              # AST → QueryPlan translator, buildFilterPredicate
│   └── executor.ts             # QueryPlan → InMemoryGraphStore executor, result building
├── resources/
│   └── index.ts                # 15 resource definitions
├── prompts/
│   └── index.ts                # 5 prompt definitions
├── middleware/
│   └── index.ts                # AuthMiddleware, RateLimiter, ToolPolicy, RequestLogger
├── skills/
│   └── installer.ts            # SkillInstaller (agent detection, skill generation, templates)
└── __tests__/
    ├── cypher-lexer.test.ts
    ├── cypher-parser.test.ts
    ├── cypher-planner.test.ts
    ├── mcp-server.test.ts
    ├── skill-installer.test.ts
    └── tool-registry.test.ts
```

## License

MIT

## Links

- [Code Analyzer Documentation](./docs/)
- [Contributing Guide](./CONTRIBUTING.md)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [openCypher Reference](https://opencypher.org/)
