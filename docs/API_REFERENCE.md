# Code Analyzer — API Reference

Comprehensive API reference for Code Analyzer's GraphQL, REST, MCP, and CLI interfaces.

---

## Table of Contents

1. [GraphQL API](#graphql-api)
2. [REST API](#rest-api)
3. [MCP Tools Reference](#mcp-tools-reference)
4. [MCP Resources Reference](#mcp-resources-reference)
5. [MCP Prompts Reference](#mcp-prompts-reference)
6. [Authentication](#authentication)
7. [Error Handling](#error-handling)

---

## GraphQL API

Endpoint: `POST /api/v1/graphql`

### Queries

#### `project(id: ID!): Project`
Retrieve a single project by its ID.

```graphql
query {
  project(id: "proj_abc123") {
    id
    name
    path
    nodeCount
    edgeCount
    lastIndexed
  }
}
```

#### `projects(limit: Int, offset: Int): [Project!]!`
List all indexed projects with optional pagination.

```graphql
query {
  projects(limit: 10, offset: 0) {
    id
    name
    nodeCount
  }
}
```

#### `graph(projectId: ID!, nodeTypes: [String!], limit: Int): KnowledgeGraph`
Query the knowledge graph for a project.

```graphql
query {
  graph(projectId: "proj_abc123", nodeTypes: ["FunctionDef", "ClassDef"]) {
    nodes {
      id
      type
      name
      properties
    }
    edges {
      sourceId
      targetId
      type
    }
  }
}
```

#### `searchGraph(projectId: ID!, query: String!, searchType: SearchType, limit: Int): SearchResults`
Search the knowledge graph by keyword.

Valid `searchType` values: `hybrid`, `bm25`, `vector`, `graph`, `regex`.

#### `reviewDiff(projectId: ID!, diff: String!): ReviewResult`
Review a git diff for issues, security concerns, and best practice violations.

#### `reviewPR(projectId: ID!, prNumber: Int!, repository: String): PRReview`
Review a pull request with full analysis including cross-repo impact.

#### `crossRepoSearch(query: String!, groupIds: [ID!]): FederatedSearchResults`
Search across multiple repositories simultaneously.

#### `benchmark(projectId: ID!, suite: BenchmarkSuite): BenchmarkResult`
Run a benchmark suite. Valid suite values: `parse`, `search`, `review`, `embedding`, `cross_repo`, `throughput`, `all`.

#### `stats(projectId: ID!): ProjectStats`
Get statistics for a project (node counts, edge counts, file stats).

#### `health: HealthStatus`
Get server health status including uptime, memory usage, and dependencies.

### Mutations

#### `indexProject(path: String!, name: String, language: String): IndexResult`
Index a new project from a local path or git repository URL.

#### `deleteProject(id: ID!): Boolean`
Delete an indexed project and all its data.

#### `runBenchmark(projectId: ID!, suite: BenchmarkSuite!): BenchmarkResult`
Run a benchmark and return detailed results.

#### `manageRepoGroup(action: RepoGroupAction!, groupId: ID, name: String): RepoGroupResult`
Manage repository groups for cross-repo analysis. Actions: `create`, `add`, `remove`, `delete`.

### Subscriptions

#### `projectIndexed: Project`
Subscribe to project indexing completion events.

#### `reviewCompleted(projectId: ID!): ReviewResult`
Subscribe to review completion events for a specific project.

#### `healthChanged: HealthStatus`
Subscribe to health status changes.

### Types

| Type | Fields |
|------|--------|
| `Project` | `id`, `name`, `path`, `nodeCount`, `edgeCount`, `lastIndexed`, `status` |
| `GraphNode` | `id`, `type`, `name`, `file`, `startLine`, `endLine`, `properties` |
| `GraphEdge` | `sourceId`, `targetId`, `type`, `properties` |
| `ReviewIssue` | `id`, `severity`, `title`, `message`, `path`, `startLine`, `suggestion` |
| `PRReview` | `prNumber`, `title`, `issues`, `crossRepoImpacts`, `recommendations`, `riskLevel`, `mergeRecommendation` |
| `SearchResult` | `name`, `type`, `file`, `line`, `score`, `snippet` |

---

## REST API

Base URL: `http://localhost:3000/api/v1`

### Health & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check with uptime, memory, status |
| `GET` | `/health/legacy` | Legacy health endpoint |
| `GET` | `/config` | Server configuration |

### Graph Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/graph/:projectId` | Get graph summary |
| `GET` | `/graph/:projectId/nodes` | Query nodes with filters |
| `GET` | `/graph/:projectId/edges` | Query edges with filters |
| `POST` | `/graph/:projectId/search` | Search graph |

### Tools (via SSE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sse` | SSE endpoint for streaming responses |
| `POST` | `/tools/:toolName` | Execute a specific tool |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhook/github` | GitHub webhook receiver |

---

## MCP Tools Reference

Code Analyzer exposes 40 tools via the MCP (Model Context Protocol) interface.

### Indexing & Lifecycle (4 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `analyze_repository` | Analyze and index a code repository | `all` |
| `list_projects` | List all indexed projects | `all` |
| `delete_project` | Delete an indexed project and its data | `all` |
| `index_status` | Get indexing status for a project | `all` |

### Querying & Exploration (10 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `search_graph` | Search the knowledge graph by keyword | `analysis` |
| `search_code` | Full-text source code search | `analysis` |
| `semantic_search` | Semantic search using embeddings | `analysis` |
| `trace_call_path` | Trace call paths between symbols | `analysis` |
| `query_graph` | Execute a Cypher query against the graph | `analysis` |
| `get_code_snippet` | Retrieve code snippet by file and line | `analysis` |
| `get_architecture` | Get architectural overview | `analysis` |
| `get_graph_schema` | Get graph schema information | `analysis` |
| `explore_symbol` | Explore a symbol and its relationships | `analysis` |
| `find_implementations` | Find interface implementations | `analysis` |

### Change & Impact (4 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `detect_changes` | Detect code changes between references | `analysis` |
| `impact_analysis` | Analyze impact of code changes | `analysis` |
| `route_map` | Get route map for a project | `analysis` |
| `check_cycles` | Check for circular dependencies | `analysis` |

### Code Review (2 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `review_diff` | Review a git diff for issues | `analysis` |
| `review_file` | Review a single file for issues | `analysis` |

### PR Review (2 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `review_pr` | Review a pull request | `analysis` |
| `check_standards` | Check code against project standards | `analysis` |

### Reports (3 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `generate_report` | Generate an analysis report | `analysis` |
| `export_report` | Export a report in specified format | `analysis` |
| `get_recommendations` | Get code improvement recommendations | `analysis` |

### Cross-Repo (7 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `cross_repo_search` | Search across multiple repositories | `analysis` |
| `cross_repo_trace` | Trace call paths across repositories | `analysis` |
| `cross_repo_impact` | Analyze cross-repo change impact | `analysis` |
| `manage_repo_group` | Manage repository groups | `all` |
| `sync_contracts` | Synchronize contracts across repos | `analysis` |
| `discover_related_repos` | Discover related repositories | `scout` |
| `cross_repo_review_pr` | Review PR with cross-repo context | `analysis` |

### PDG (3 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `pdg_query` | Query program dependence graph | `analysis` |
| `taint_analysis` | Taint analysis for security | `analysis` |
| `explain_taint` | Explain a taint analysis path | `analysis` |

### Standards & ADR (3 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `list_standards` | List project standards | `all` |
| `create_standard` | Create a project standard | `all` |
| `manage_adr` | Manage Architecture Decision Records | `all` |

### Agent & Benchmark (2 tools)

| Tool | Description | Profile |
|------|-------------|---------|
| `install_skills` | Install agent skills | `all` |
| `run_benchmark` | Run the review quality benchmark suite | `analysis` |

---

## MCP Resources Reference

15 resources provide read-only access to graph data:

| URI | Name | Description |
|-----|------|-------------|
| `code-analyzer://resources/projects` | Projects | List of all indexed projects |
| `code-analyzer://resources/project-schema` | Project Schema | Schema definition for project data |
| `code-analyzer://resources/clusters` | Clusters | Community clusters in the codebase |
| `code-analyzer://resources/processes` | Processes | Business processes modeled |
| `code-analyzer://resources/routes` | Routes | HTTP routes and API endpoints |
| `code-analyzer://resources/entrypoints` | Entry Points | Application entry points |
| `code-analyzer://resources/hotspots` | Hotspots | High-complexity or high-churn areas |
| `code-analyzer://resources/adrs` | ADRs | Architecture Decision Records |
| `code-analyzer://resources/stats` | Stats | Project statistics and metrics |
| `code-analyzer://resources/graph` | Graph | Complete knowledge graph |
| `code-analyzer://resources/groups` | Groups | Repository groups |
| `code-analyzer://resources/contracts` | Contracts | Cross-repo contracts |
| `code-analyzer://resources/config` | Config | Server configuration |
| `code-analyzer://resources/health` | Health | Server health and status |
| `code-analyzer://resources/reports` | Reports | Generated analysis reports |

---

## MCP Prompts Reference

5 reusable prompts for guided analysis workflows:

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `explore-codebase` | `projectId` (required), `focus`, `depth` | Explore an unknown codebase |
| `review-changes` | `projectId` (required), `fromRef` (required), `toRef`, `focus` | Review code changes |
| `debug-issue` | `projectId` (required), `entryPoint` (required), `symptom` (required) | Debug by tracing execution paths |
| `refactor-plan` | `projectId` (required), `target` (required), `goal` (required) | Plan a refactoring |
| `architecture-review` | `projectId` (required), `aspect`, `generateADR` | Review project architecture |

---

## Authentication

### REST API
API keys are passed via the `Authorization` header:
```
Authorization: Bearer <api-key>
```

### MCP
MCP authentication depends on the transport:
- **stdio**: No authentication required (local process)
- **SSE/HTTP**: API key via `Authorization` header

### GitHub Webhook
Webhook payloads are verified using HMAC-SHA256 signatures. Configure the webhook secret via `GITHUB_WEBHOOK_SECRET` environment variable.

---

## Error Handling

All APIs return structured error responses:

```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "Project 'proj_xyz' not found",
    "details": {
      "projectId": "proj_xyz"
    }
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `PROJECT_NOT_FOUND` | 404 | Project does not exist |
| `INDEXING_IN_PROGRESS` | 409 | Project is currently being indexed |
| `INVALID_QUERY` | 400 | Invalid search query or Cypher syntax |
| `RATE_LIMITED` | 429 | Too many requests |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
