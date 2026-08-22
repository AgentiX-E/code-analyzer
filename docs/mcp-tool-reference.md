# MCP Tool Reference

> Complete reference for all 45 MCP tools exposed by Code Analyzer. Tools are organized by category, with descriptions, parameters, examples, and output formats.

---

## Category Overview

| Category                                                    | Tools | Description                                      |
| ----------------------------------------------------------- | :---: | ------------------------------------------------ |
| [Querying & Exploration](#1-querying--exploration-10-tools) |  10   | Search, explore, and query the knowledge graph   |
| [Code Review](#2-code-review-5-tools)                       |   5   | Automated code review with standards enforcement |
| [PR Review](#3-pr-review-4-tools)                           |   4   | Pull request review and CI check management      |
| [Change Impact](#4-change-impact-3-tools)                   |   3   | Analyze the impact of proposed changes           |
| [Refactoring](#5-refactoring-3-tools)                       |   3   | Detect code smells and suggest refactorings      |
| [Test Generation](#6-test-generation-2-tools)               |   2   | Generate tests and analyze coverage              |
| [Code Suggestion](#7-code-suggestion-2-tools)               |   2   | Suggest fixes and improvements                   |
| [Documentation](#8-documentation-2-tools)                   |   2   | Generate docs and check coverage                 |
| [Reports](#9-reports-3-tools)                               |   3   | Generate analysis and trend reports              |
| [Standards & ADR](#10-standards--adr-4-tools)               |   4   | Manage standards and architecture decisions      |
| [Indexing & Lifecycle](#11-indexing--lifecycle-3-tools)     |   3   | Index projects and manage lifecycle              |
| [Security](#12-security-2-tools)                            |   2   | Security audit and secret scanning               |
| [Cross-Repo](#13-cross-repo-2-tools)                        |   2   | Cross-repository analysis                        |

---

## 1. Querying & Exploration (10 tools)

### `query_cypher`

Execute a Cypher query against the knowledge graph.

| Parameter   | Type     | Required | Description                         |
| ----------- | -------- | :------: | ----------------------------------- |
| `query`     | `string` |   Yes    | Cypher query string                 |
| `limit`     | `number` |    No    | Maximum results (default: 100)      |
| `projectId` | `string` |    No    | Project to query (default: current) |

**Example:**

```json
{
  "query": "MATCH (f:Function)-[:CALLS]->(t:Function) WHERE f.name CONTAINS 'auth' RETURN f.name, t.name LIMIT 20"
}
```

**Output:** Array of matching nodes and relationships with properties.

---

### `get_graph_statistics`

Get statistics about the current knowledge graph.

| Parameter   | Type     | Required | Description      |
| ----------- | -------- | :------: | ---------------- |
| `projectId` | `string` |    No    | Project to query |

**Example:**

```json
{ "projectId": "my-project" }
```

**Output:**

```json
{
  "nodeCount": 4521,
  "edgeCount": 18330,
  "nodeTypes": { "Function": 1247, "Class": 312, "Module": 88 },
  "edgeTypes": { "CALLS": 7123, "IMPORTS": 2845, "EXTENDS": 156 },
  "sizeBytes": 13010304
}
```

---

### `get_node_info`

Get detailed information about a specific graph node.

| Parameter   | Type     | Required | Description     |
| ----------- | -------- | :------: | --------------- |
| `nodeId`    | `string` |   Yes    | Node identifier |
| `projectId` | `string` |    No    | Project scope   |

**Example:**

```json
{ "nodeId": "file://src/auth/login.ts" }
```

**Output:** Node properties, labels, and immediate neighbors.

---

### `search_code`

Full-text search across source code using BM25 ranking.

| Parameter   | Type     | Required | Description                             |
| ----------- | -------- | :------: | --------------------------------------- |
| `query`     | `string` |   Yes    | Search query                            |
| `language`  | `string` |    No    | Filter by language (e.g., `typescript`) |
| `type`      | `string` |    No    | Filter by node type (e.g., `Function`)  |
| `filePath`  | `string` |    No    | Restrict to specific file pattern       |
| `limit`     | `number` |    No    | Maximum results (default: 20)           |
| `projectId` | `string` |    No    | Project scope                           |

**Example:**

```json
{ "query": "authentication middleware", "language": "typescript", "limit": 10 }
```

**Output:** Array of search results with file path, line number, snippet, and BM25 score.

---

### `trace_path`

Trace call paths between two symbols.

| Parameter   | Type     | Required | Description                      |
| ----------- | -------- | :------: | -------------------------------- |
| `source`    | `string` |   Yes    | Starting symbol name             |
| `target`    | `string` |   Yes    | Target symbol name               |
| `maxDepth`  | `number` |    No    | Maximum path depth (default: 10) |
| `projectId` | `string` |    No    | Project scope                    |

**Example:**

```json
{ "source": "loginHandler", "target": "Database.query", "maxDepth": 5 }
```

**Output:** Array of paths, each containing an ordered list of function calls from source to target.

---

### `find_dependencies`

Find all dependencies of a symbol (what it uses).

| Parameter   | Type     | Required | Description                        |
| ----------- | -------- | :------: | ---------------------------------- |
| `symbol`    | `string` |   Yes    | Symbol to find dependencies for    |
| `direction` | `string` |    No    | `outgoing` (default) or `incoming` |
| `maxDepth`  | `number` |    No    | Traversal depth (default: 3)       |
| `projectId` | `string` |    No    | Project scope                      |

**Example:**

```json
{ "symbol": "UserService", "direction": "outgoing", "maxDepth": 2 }
```

**Output:** Tree of dependencies organized by relationship type.

---

### `list_symbols`

List symbols filtered by type, language, or pattern.

| Parameter      | Type      | Required | Description                                                      |
| -------------- | --------- | :------: | ---------------------------------------------------------------- |
| `type`         | `string`  |    No    | Symbol type: `Function`, `Class`, `Interface`, `Module`, `Route` |
| `language`     | `string`  |    No    | Programming language filter                                      |
| `pattern`      | `string`  |    No    | Name pattern (glob)                                              |
| `exportedOnly` | `boolean` |    No    | Only exported symbols (default: false)                           |
| `limit`        | `number`  |    No    | Maximum results                                                  |
| `projectId`    | `string`  |    No    | Project scope                                                    |

**Example:**

```json
{ "type": "Function", "language": "typescript", "exportedOnly": true, "limit": 50 }
```

**Output:** Array of symbol objects with name, file path, line, and type.

---

### `get_file_info`

Get structural information about a file, including its symbols and imports.

| Parameter   | Type     | Required | Description         |
| ----------- | -------- | :------: | ------------------- |
| `filePath`  | `string` |   Yes    | Path to source file |
| `projectId` | `string` |    No    | Project scope       |

**Example:**

```json
{ "filePath": "src/auth/login.ts" }
```

**Output:** File metadata, list of defined symbols, import list, and export list.

---

### `find_references`

Find all references to a symbol across the codebase.

| Parameter   | Type     | Required | Description                   |
| ----------- | -------- | :------: | ----------------------------- |
| `symbol`    | `string` |   Yes    | Symbol to find references for |
| `projectId` | `string` |    No    | Project scope                 |

**Example:**

```json
{ "symbol": "authenticateUser" }
```

**Output:** Array of reference locations with file path, line, and context snippet.

---

### `explore_architecture`

Get a high-level architectural overview of the project.

| Parameter   | Type     | Required | Description                                                         |
| ----------- | -------- | :------: | ------------------------------------------------------------------- |
| `projectId` | `string` |    No    | Project scope                                                       |
| `level`     | `string` |    No    | Detail level: `overview`, `modules`, `layers` (default: `overview`) |

**Example:**

```json
{ "level": "modules" }
```

**Output:** Architecture description with module clusters, layer structure, and key entry points.

---

## 2. Code Review (5 tools)

### `review_file`

Review a single file for issues including security, performance, and maintainability.

| Parameter    | Type       | Required | Description                                                                                |
| ------------ | ---------- | :------: | ------------------------------------------------------------------------------------------ |
| `filePath`   | `string`   |   Yes    | Path to file to review                                                                     |
| `severity`   | `string`   |    No    | Minimum severity: `low`, `medium`, `high`, `critical`                                      |
| `categories` | `string[]` |    No    | Categories to check: `security`, `performance`, `maintainability`, `style`, `architecture` |
| `projectId`  | `string`   |    No    | Project scope                                                                              |

**Example:**

```json
{ "filePath": "src/auth/login.ts", "severity": "medium", "categories": ["security", "performance"] }
```

**Output:** Array of review comments with severity, category, line number, message, and suggestion.

---

### `review_diff`

Review uncommitted changes (git diff) for issues.

| Parameter    | Type       | Required | Description                        |
| ------------ | ---------- | :------: | ---------------------------------- |
| `fromRef`    | `string`   |    No    | Base ref (default: `HEAD`)         |
| `toRef`      | `string`   |    No    | Target ref (default: working tree) |
| `severity`   | `string`   |    No    | Minimum severity                   |
| `categories` | `string[]` |    No    | Categories to check                |
| `projectId`  | `string`   |    No    | Project scope                      |

**Example:**

```json
{ "fromRef": "main", "toRef": "feature/new-auth", "severity": "high" }
```

**Output:** Array of review comments scoped to changed lines only.

---

### `review_pr`

Review a pull request with automated analysis. _(Alias of [`pr_review`](#pr_review))_

| Parameter    | Type       | Required | Description         |
| ------------ | ---------- | :------: | ------------------- |
| `prNumber`   | `number`   |   Yes    | Pull request number |
| `severity`   | `string`   |    No    | Minimum severity    |
| `categories` | `string[]` |    No    | Categories to check |
| `projectId`  | `string`   |    No    | Project scope       |

---

### `batch_review` (Basic)

Review multiple files in a single call. Currently a wrapper that calls `review_file` for each file sequentially.

| Parameter    | Type       | Required | Description                   |
| ------------ | ---------- | :------: | ----------------------------- |
| `filePaths`  | `string[]` |   Yes    | Array of file paths to review |
| `severity`   | `string`   |    No    | Minimum severity              |
| `categories` | `string[]` |    No    | Categories to check           |
| `projectId`  | `string`   |    No    | Project scope                 |

**Example:**

```json
{ "filePaths": ["src/auth/login.ts", "src/auth/middleware.ts", "src/auth/utils.ts"] }
```

**Output:** Combined array of review comments from all files, grouped by file.

---

### `get_review_summary`

Get a summary of recent review activity for a project.

| Parameter   | Type     | Required | Description                                          |
| ----------- | -------- | :------: | ---------------------------------------------------- |
| `projectId` | `string` |    No    | Project scope                                        |
| `since`     | `string` |    No    | Time range: `day`, `week`, `month` (default: `week`) |

**Example:**

```json
{ "since": "week" }
```

**Output:**

```json
{
  "filesReviewed": 47,
  "totalIssues": 128,
  "bySeverity": { "critical": 3, "high": 12, "medium": 45, "low": 68 },
  "byCategory": { "security": 8, "performance": 15, "maintainability": 62, "style": 43 },
  "trend": "improving"
}
```

---

## 3. PR Review (4 tools)

### `pr_review`

Review a pull request with automated analysis and post comments.

| Parameter   | Type       | Required | Description                                                  |
| ----------- | ---------- | :------: | ------------------------------------------------------------ |
| `prNumber`  | `number`   |   Yes    | Pull request number                                          |
| `platform`  | `string`   |    No    | Platform: `github`, `gitlab`, `gitea` (default: auto-detect) |
| `token`     | `string`   |    No    | API token for posting comments                               |
| `standards` | `string[]` |    No    | Standards to check against                                   |
| `severity`  | `string`   |    No    | Minimum severity                                             |
| `projectId` | `string`   |    No    | Project scope                                                |

**Example:**

```json
{ "prNumber": 42, "standards": ["typescript-best-practices", "security-baseline"] }
```

**Output:** Review summary with comment count and link to PR.

---

### `pr_review_with_cross_repo`

Review a PR with awareness of cross-repository dependencies.

| Parameter   | Type     | Required | Description           |
| ----------- | -------- | :------: | --------------------- |
| `prNumber`  | `number` |   Yes    | Pull request number   |
| `repoGroup` | `string` |   Yes    | Repository group name |
| `platform`  | `string` |    No    | Platform              |
| `severity`  | `string` |    No    | Minimum severity      |
| `projectId` | `string` |    No    | Project scope         |

**Example:**

```json
{ "prNumber": 42, "repoGroup": "my-services" }
```

**Output:** Review summary with cross-repo impact warnings and contract compatibility checks.

---

### `get_pr_status`

Get the current status of a PR analysis.

| Parameter  | Type     | Required | Description         |
| ---------- | -------- | :------: | ------------------- |
| `prNumber` | `number` |   Yes    | Pull request number |
| `platform` | `string` |    No    | Platform            |

**Example:**

```json
{ "prNumber": 42 }
```

**Output:** Status object with check run state, conclusion, and completed analysis phases.

---

### `update_pr_check`

Update a PR check run with analysis results.

| Parameter     | Type       | Required | Description                                       |
| ------------- | ---------- | :------: | ------------------------------------------------- |
| `prNumber`    | `number`   |   Yes    | Pull request number                               |
| `conclusion`  | `string`   |   Yes    | Check conclusion: `success`, `failure`, `neutral` |
| `summary`     | `string`   |   Yes    | Markdown summary text                             |
| `annotations` | `object[]` |    No    | Array of file-level annotations                   |

**Example:**

```json
{
  "prNumber": 42,
  "conclusion": "failure",
  "summary": "Found 3 critical security issues that must be resolved.",
  "annotations": [
    {
      "path": "src/auth/login.ts",
      "line": 42,
      "level": "failure",
      "message": "Hardcoded secret detected"
    }
  ]
}
```

**Output:** Updated check run details.

---

## 4. Change Impact (3 tools)

### `analyze_impact`

Analyze the impact of modifying a specific symbol.

| Parameter   | Type     | Required | Description                  |
| ----------- | -------- | :------: | ---------------------------- |
| `symbol`    | `string` |   Yes    | Symbol to analyze impact for |
| `maxDepth`  | `number` |    No    | Traversal depth (default: 5) |
| `projectId` | `string` |    No    | Project scope                |

**Example:**

```json
{ "symbol": "UserService.getUser", "maxDepth": 3 }
```

**Output:**

```json
{
  "symbol": "UserService.getUser",
  "directCallers": 12,
  "indirectCallers": 47,
  "affectedFiles": 18,
  "testsAffected": 8,
  "breakingChangeRisk": "medium"
}
```

---

### `detect_breaking_changes`

Detect breaking changes by comparing two versions of the codebase.

| Parameter   | Type     | Required | Description                      |
| ----------- | -------- | :------: | -------------------------------- |
| `fromRef`   | `string` |   Yes    | Base git ref                     |
| `toRef`     | `string` |    No    | Target git ref (default: `HEAD`) |
| `projectId` | `string` |    No    | Project scope                    |

**Example:**

```json
{ "fromRef": "v1.0.0", "toRef": "HEAD" }
```

**Output:** Array of breaking change entries with type, symbol, description, and severity.

---

### `check_contract`

Check API contract compatibility between two versions or across repos.

| Parameter      | Type     | Required | Description                                     |
| -------------- | -------- | :------: | ----------------------------------------------- |
| `contractPath` | `string` |   Yes    | Path to contract file (OpenAPI, GraphQL, proto) |
| `fromRef`      | `string` |    No    | Base ref for comparison                         |
| `toRef`        | `string` |    No    | Target ref for comparison                       |
| `projectId`    | `string` |    No    | Project scope                                   |

**Example:**

```json
{ "contractPath": "api/openapi.yaml", "fromRef": "main", "toRef": "HEAD" }
```

**Output:** List of added, removed, and modified endpoints with compatibility assessment.

---

## 5. Refactoring (3 tools)

### `suggest_refactor`

Suggest refactoring opportunities for a symbol or file.

| Parameter   | Type     | Required | Description              |
| ----------- | -------- | :------: | ------------------------ |
| `target`    | `string` |   Yes    | Symbol name or file path |
| `projectId` | `string` |    No    | Project scope            |

**Example:**

```json
{ "target": "src/services/order-processor.ts" }
```

**Output:** Array of refactoring suggestions with rationale, difficulty, and estimated impact.

---

### `detect_code_smells`

Detect common code smells in the codebase.

| Parameter   | Type       | Required | Description                                                                               |
| ----------- | ---------- | :------: | ----------------------------------------------------------------------------------------- |
| `filePath`  | `string`   |    No    | Focus on specific file                                                                    |
| `types`     | `string[]` |    No    | Smell types: `long_function`, `god_class`, `feature_envy`, `duplicated_code`, `dead_code` |
| `projectId` | `string`   |    No    | Project scope                                                                             |

**Example:**

```json
{ "types": ["long_function", "god_class", "dead_code"] }
```

**Output:** Array of code smell detections with type, location, severity, and suggested fix.

---

### `suggest_optimization`

Suggest performance optimizations for a symbol or file.

| Parameter   | Type     | Required | Description              |
| ----------- | -------- | :------: | ------------------------ |
| `target`    | `string` |   Yes    | Symbol name or file path |
| `projectId` | `string` |    No    | Project scope            |

**Example:**

```json
{ "target": "Database.query" }
```

**Output:** Array of optimization suggestions with expected improvement and complexity.

---

## 6. Test Generation (2 tools)

### `generate_tests`

Generate unit tests for a given symbol or file.

| Parameter   | Type     | Required | Description                                                                      |
| ----------- | -------- | :------: | -------------------------------------------------------------------------------- |
| `target`    | `string` |   Yes    | Symbol name or file path                                                         |
| `framework` | `string` |    No    | Test framework: `jest`, `vitest`, `pytest`, `go test` (auto-detected if not set) |
| `style`     | `string` |    No    | Test style: `unit`, `integration`, `edge-cases` (default: `unit`)                |
| `projectId` | `string` |    No    | Project scope                                                                    |

**Example:**

```json
{ "target": "src/utils/validation.ts", "framework": "vitest", "style": "edge-cases" }
```

**Output:** Generated test code as a string with suggested file path.

---

### `analyze_test_coverage`

Analyze test coverage and identify untested code paths.

| Parameter   | Type     | Required | Description            |
| ----------- | -------- | :------: | ---------------------- |
| `filePath`  | `string` |    No    | Focus on specific file |
| `projectId` | `string` |    No    | Project scope          |

**Example:**

```json
{ "filePath": "src/auth/login.ts" }
```

**Output:**

```json
{
  "overallCoverage": "72%",
  "fileCoverage": "58%",
  "uncoveredFunctions": [
    { "name": "refreshToken", "line": 89, "complexity": "medium", "testPriority": "high" }
  ],
  "uncoveredBranches": [{ "function": "authenticate", "line": 45, "condition": "user == null" }]
}
```

---

## 7. Code Suggestion (2 tools)

### `suggest_fix`

Suggest a fix for a specific issue or error.

| Parameter     | Type     | Required | Description                |
| ------------- | -------- | :------: | -------------------------- |
| `filePath`    | `string` |   Yes    | File containing the issue  |
| `line`        | `number` |   Yes    | Line number of the issue   |
| `description` | `string` |   Yes    | Description of the problem |
| `projectId`   | `string` |    No    | Project scope              |

**Example:**

```json
{ "filePath": "src/auth/login.ts", "line": 42, "description": "Hardcoded API key on this line" }
```

**Output:** Suggested code fix with before/after diff.

---

### `suggest_improvement`

Suggest general code improvements for a symbol or file.

| Parameter   | Type     | Required | Description                                                        |
| ----------- | -------- | :------: | ------------------------------------------------------------------ |
| `target`    | `string` |   Yes    | Symbol name or file path                                           |
| `aspect`    | `string` |    No    | `readability`, `performance`, `safety`, `idiomatic` (default: all) |
| `projectId` | `string` |    No    | Project scope                                                      |

**Example:**

```json
{ "target": "src/services/report-generator.ts", "aspect": "performance" }
```

**Output:** Array of improvement suggestions with context-aware code snippets.

---

## 8. Documentation (2 tools)

### `generate_docs`

Generate documentation for a symbol, file, or module.

| Parameter   | Type     | Required | Description                                                         |
| ----------- | -------- | :------: | ------------------------------------------------------------------- |
| `target`    | `string` |   Yes    | Symbol name or file path                                            |
| `format`    | `string` |    No    | Output format: `markdown`, `jsdoc`, `openapi` (default: `markdown`) |
| `projectId` | `string` |    No    | Project scope                                                       |

**Example:**

```json
{ "target": "src/auth/login.ts", "format": "jsdoc" }
```

**Output:** Generated documentation text.

---

### `check_doc_coverage` (Basic)

Check which symbols have documentation and identify undocumented APIs.

| Parameter      | Type      | Required | Description                                 |
| -------------- | --------- | :------: | ------------------------------------------- |
| `filePath`     | `string`  |    No    | Focus on specific file                      |
| `exportedOnly` | `boolean` |    No    | Only check exported symbols (default: true) |
| `projectId`    | `string`  |    No    | Project scope                               |

**Example:**

```json
{ "exportedOnly": true }
```

**Output:**

```json
{
  "coverage": "63%",
  "documented": 312,
  "undocumented": 184,
  "undocumentedExports": [
    { "name": "parseConfig", "file": "src/config/parser.ts", "line": 24, "priority": "high" }
  ]
}
```

---

## 9. Reports (3 tools)

### `generate_report`

Generate a comprehensive analysis report.

| Parameter   | Type     | Required | Description                                                             |
| ----------- | -------- | :------: | ----------------------------------------------------------------------- |
| `type`      | `string` |    No    | Report type: `full`, `summary`, `security`, `quality` (default: `full`) |
| `format`    | `string` |    No    | Output format: `json`, `markdown`, `html` (default: `json`)             |
| `projectId` | `string` |    No    | Project scope                                                           |

**Example:**

```json
{ "type": "quality", "format": "markdown" }
```

**Output:** Generated report content in the requested format.

---

### `generate_trend_report`

Generate a trend report showing how metrics have changed over time.

| Parameter   | Type       | Required | Description                                                         |
| ----------- | ---------- | :------: | ------------------------------------------------------------------- |
| `period`    | `string`   |    No    | Time period: `week`, `month`, `quarter`, `year` (default: `month`)  |
| `metrics`   | `string[]` |    No    | Metrics: `complexity`, `coverage`, `issues`, `churn` (default: all) |
| `format`    | `string`   |    No    | Output format (default: `json`)                                     |
| `projectId` | `string`   |    No    | Project scope                                                       |

**Example:**

```json
{ "period": "month", "metrics": ["complexity", "issues"] }
```

**Output:** Trend data with time series and summaries for each metric.

---

### `generate_hotspot_report`

Identify code hotspots — files with high complexity combined with high change frequency.

| Parameter   | Type     | Required | Description                                |
| ----------- | -------- | :------: | ------------------------------------------ |
| `topN`      | `number` |    No    | Number of hotspots to return (default: 10) |
| `format`    | `string` |    No    | Output format (default: `json`)            |
| `projectId` | `string` |    No    | Project scope                              |

**Example:**

```json
{ "topN": 15, "format": "markdown" }
```

**Output:** Ranked list of hotspots with complexity score, churn rate, and affected files.

---

## 10. Standards & ADR (4 tools)

### `check_standards`

Check code against specified project standards.

| Parameter   | Type       | Required | Description                     |
| ----------- | ---------- | :------: | ------------------------------- |
| `standards` | `string[]` |   Yes    | Standard names to check against |
| `filePath`  | `string`   |    No    | Focus on specific file          |
| `projectId` | `string`   |    No    | Project scope                   |

**Example:**

```json
{ "standards": ["typescript-best-practices", "security-baseline"] }
```

**Output:** Array of compliance results per standard with pass/fail status and violation details.

---

### `list_standards`

List available standards (built-in and custom).

| Parameter   | Type     | Required | Description                                                         |
| ----------- | -------- | :------: | ------------------------------------------------------------------- |
| `category`  | `string` |    No    | Filter by category: `security`, `style`, `architecture`, `language` |
| `projectId` | `string` |    No    | Project scope                                                       |

**Example:**

```json
{ "category": "security" }
```

**Output:** Array of standard definitions with name, description, category, and rule count.

---

### `create_adr`

Create an Architecture Decision Record.

| Parameter      | Type     | Required | Description                                                |
| -------------- | -------- | :------: | ---------------------------------------------------------- |
| `title`        | `string` |   Yes    | ADR title                                                  |
| `status`       | `string` |   Yes    | Status: `proposed`, `accepted`, `deprecated`, `superseded` |
| `context`      | `string` |   Yes    | Decision context and problem statement                     |
| `decision`     | `string` |   Yes    | The decision made                                          |
| `consequences` | `string` |   Yes    | Positive and negative consequences                         |
| `projectId`    | `string` |    No    | Project scope                                              |

**Example:**

```json
{
  "title": "Use PostgreSQL for primary data store",
  "status": "accepted",
  "context": "We need a relational database with strong consistency guarantees...",
  "decision": "Use PostgreSQL 16 as the primary data store",
  "consequences": "Positive: ACID compliance, mature ecosystem. Negative: Vertical scaling limits."
}
```

**Output:** Created ADR object with ID and file path.

---

### `search_adrs`

Search existing Architecture Decision Records.

| Parameter   | Type     | Required | Description      |
| ----------- | -------- | :------: | ---------------- |
| `query`     | `string` |   Yes    | Search query     |
| `status`    | `string` |    No    | Filter by status |
| `projectId` | `string` |    No    | Project scope    |

**Example:**

```json
{ "query": "database", "status": "accepted" }
```

**Output:** Array of matching ADRs with title, status, and summary.

---

## 11. Indexing & Lifecycle (3 tools)

### `index_project`

Index a code repository to build the knowledge graph.

| Parameter     | Type       | Required | Description                                     |
| ------------- | ---------- | :------: | ----------------------------------------------- |
| `path`        | `string`   |   Yes    | Path to project directory                       |
| `languages`   | `string[]` |    No    | Languages to analyze (auto-detected if not set) |
| `incremental` | `boolean`  |    No    | Incremental indexing (default: false)           |
| `projectId`   | `string`   |    No    | Project identifier                              |

**Example:**

```json
{ "path": "/home/user/projects/my-app", "languages": ["typescript", "python"], "incremental": true }
```

**Output:**

```json
{
  "projectId": "my-app",
  "filesIndexed": 1247,
  "nodesCreated": 4521,
  "edgesCreated": 18330,
  "durationMs": 8320,
  "status": "completed"
}
```

---

### `reindex_project`

Re-index an already-indexed project, rebuilding the knowledge graph from scratch.

| Parameter   | Type       | Required | Description             |
| ----------- | ---------- | :------: | ----------------------- |
| `projectId` | `string`   |   Yes    | Project to re-index     |
| `languages` | `string[]` |    No    | Languages to re-analyze |

**Example:**

```json
{ "projectId": "my-app", "languages": ["typescript"] }
```

**Output:** Same as `index_project` but with additional field showing diff from previous index.

---

### `get_index_status`

Get the current indexing status for a project.

| Parameter   | Type     | Required | Description        |
| ----------- | -------- | :------: | ------------------ |
| `projectId` | `string` |   Yes    | Project identifier |

**Example:**

```json
{ "projectId": "my-app" }
```

**Output:**

```json
{
  "status": "indexed",
  "lastIndexed": "2026-08-07T10:30:00Z",
  "fileCount": 1247,
  "nodeCount": 4521,
  "pendingChanges": 3,
  "health": "healthy"
}
```

---

## 12. Security (2 tools)

### `audit_security`

Run a comprehensive security audit on the codebase.

| Parameter   | Type       | Required | Description                          |
| ----------- | ---------- | :------: | ------------------------------------ |
| `filePath`  | `string`   |    No    | Focus on specific file or directory  |
| `severity`  | `string`   |    No    | Minimum severity (default: `medium`) |
| `cweFilter` | `string[]` |    No    | Filter by CWE IDs                    |
| `projectId` | `string`   |    No    | Project scope                        |

**Example:**

```json
{ "severity": "high", "cweFilter": ["CWE-89", "CWE-79", "CWE-22"] }
```

**Output:**

```json
{
  "findings": [
    {
      "cwe": "CWE-89",
      "severity": "critical",
      "location": "src/db/query-builder.ts:45",
      "description": "Potential SQL injection via string concatenation"
    },
    {
      "cwe": "CWE-79",
      "severity": "high",
      "location": "src/api/render.ts:89",
      "description": "Unescaped user input in HTML output"
    }
  ],
  "summary": { "critical": 1, "high": 1, "medium": 3, "low": 7 },
  "remediations": [
    "Use parameterized queries for all database access",
    "Apply output encoding for all user-supplied content"
  ]
}
```

---

### `scan_secrets` (Basic)

Scan the codebase for hardcoded secrets, API keys, and credentials.

| Parameter   | Type     | Required | Description                         |
| ----------- | -------- | :------: | ----------------------------------- |
| `filePath`  | `string` |    No    | Focus on specific file or directory |
| `projectId` | `string` |    No    | Project scope                       |

**Example:**

```json
{ "filePath": "src/config" }
```

**Output:** Array of detected secrets with type, file path, line number, and entropy score.

---

## 13. Cross-Repo (2 tools)

### `search_cross_repo`

Search across multiple repositories in a repo group.

| Parameter   | Type     | Required | Description                            |
| ----------- | -------- | :------: | -------------------------------------- |
| `query`     | `string` |   Yes    | Search query                           |
| `repoGroup` | `string` |   Yes    | Repository group name                  |
| `limit`     | `number` |    No    | Maximum results per repo (default: 20) |

**Example:**

```json
{ "query": "authentication", "repoGroup": "my-services" }
```

**Output:** Array of search results grouped by repository.

---

### `analyze_cross_repo_impact`

Analyze the cross-repository impact of modifying a symbol.

| Parameter   | Type     | Required | Description           |
| ----------- | -------- | :------: | --------------------- |
| `symbol`    | `string` |   Yes    | Symbol to analyze     |
| `repoGroup` | `string` |   Yes    | Repository group name |

**Example:**

```json
{ "symbol": "UserService.getUser", "repoGroup": "my-services" }
```

**Output:**

```json
{
  "symbol": "UserService.getUser",
  "impactedRepos": [
    { "repo": "frontend", "affectedFiles": 8, "breakingChangeRisk": "low" },
    { "repo": "mobile-app", "affectedFiles": 3, "breakingChangeRisk": "medium" }
  ],
  "contractsAffected": ["user-api-v2"],
  "totalAffectedFiles": 11
}
```

---

## Usage Notes

### Tool Profiles

By default, all 45 tools are available. Set `mcp.toolProfile` to limit exposure:

| Profile    | Tools | Best For                       |
| ---------- | :---: | ------------------------------ |
| `all`      |  45   | Maximum capability             |
| `analysis` |  28   | Standard development workflows |
| `scout`    |   1   | Minimal surface area           |

### Common Patterns

Most tools accept an optional `projectId` parameter. When omitted, the tool targets the current project specified by `CODE_ANALYZER_PROJECT_DIR`. Tools marked **(Basic)** return simplified output or delegate to a more fully-featured sibling tool.

### Error Handling

All tools return errors in a consistent format:

```json
{
  "error": true,
  "code": "PROJECT_NOT_INDEXED",
  "message": "Project 'my-app' has not been indexed. Run index_project first.",
  "suggestion": "Call index_project with path: /path/to/my-app"
}
```

---

## See Also

- [Getting Started](getting-started.md) — First-time setup guide
- [Configuration Reference](configuration-reference.md) — MCP configuration options
- [Scenario Guides](scenario-guides.md) — Task-based workflows using these tools
- [Architecture](architecture.md) — MCP server architecture details
