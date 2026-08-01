# @code-analyzer/server

> HTTP REST API server wrapping the Code Analyzer intelligence engine. Provides RESTful endpoints for code analysis, search, review, and reporting.

[![npm](https://img.shields.io/npm/v/@code-analyzer/server?color=blue)](https://www.npmjs.com/package/@code-analyzer/server)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

## Overview

`@code-analyzer/server` is the HTTP REST API layer for the Code Analyzer platform. It wraps the core intelligence engine behind standard REST endpoints, enabling integration with web applications, CI/CD pipelines, and third-party tools that cannot use the MCP protocol directly. The server provides structured JSON responses for repository analysis, knowledge graph queries, code review, and reporting workflows.

The server is designed as a composable HTTP service that exposes the full capabilities of the `@code-analyzer/intelligence`, `@code-analyzer/analyzer`, and `@code-analyzer/infra` packages through a clean REST API.

```
┌────────────────────────────────────────────────────────────┐
│                       HTTP Clients                         │
│  (Web UI · CI/CD · CLI · curl · Postman · SDK consumers)  │
└──────────────────────┬─────────────────────────────────────┘
                       │  HTTP REST (JSON)
┌──────────────────────▼─────────────────────────────────────┐
│                  @code-analyzer/server                      │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                  REST API Layer                        │ │
│  │  /api/analyze  /api/search  /api/review  /api/report  │ │
│  └──────────────────────┬────────────────────────────────┘ │
│  ┌──────────────────────▼────────────────────────────────┐ │
│  │              Intelligence Engine                       │ │
│  │  @code-analyzer/intelligence                          │ │
│  └──────────────────────┬────────────────────────────────┘ │
│  ┌──────────────────────▼────────────────────────────────┐ │
│  │              Static Analyzer                           │ │
│  │  @code-analyzer/analyzer                              │ │
│  └──────────────────────┬────────────────────────────────┘ │
└─────────────────────────┼──────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────┐
│              InMemoryGraphStore (Knowledge Graph)                  │
│  @code-analyzer/infra · FTS5 · Graph Storage               │
└────────────────────────────────────────────────────────────┘
```

## Installation

```bash
npm install @code-analyzer/server
```

This package is designed for use within the Code Analyzer monorepo. It depends on several internal workspace packages.

```bash
# Install within the monorepo
pnpm install --filter @code-analyzer/server

# Build TypeScript
pnpm --filter @code-analyzer/server build

# Run tests
pnpm --filter @code-analyzer/server test
```

## Quick Start

### Starting the Server

```typescript
import { createServer } from '@code-analyzer/server';

async function main() {
  const server = await createServer();

  // Start the HTTP server on port 8080
  await server.start(8080);
  console.log('Code Analyzer REST API running on http://localhost:8080');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await server.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
```

### Embedding in an Express/Fastify App

```typescript
import express from 'express';
import { createServer } from '@code-analyzer/server';

const app = express();

// Mount the code-analyzer server as a sub-app or proxy
const analyzerServer = await createServer();
await analyzerServer.start(3000);

// Proxy requests from main app
app.use('/analyzer', (req, res) => {
  // Forward to analyzer server
  // In production, use http-proxy-middleware or similar
});

app.listen(8080, () => {
  console.log('Main app on :8080, analyzer on :3000');
});
```

### Using with Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY packages/server/dist ./dist
COPY node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

```bash
docker build -t code-analyzer-server .
docker run -p 8080:8080 code-analyzer-server
```

## API Reference

The server exposes the following REST endpoint categories:

### Repository Analysis

```
POST /api/analyze
```

Index a repository into the knowledge graph.

**Request:**
```json
{
  "path": "/path/to/repository",
  "projectId": "my-project",
  "language": "typescript",
  "force": false
}
```

**Response:**
```json
{
  "projectId": "my-project",
  "status": "indexing",
  "nodeCount": 0,
  "edgeCount": 0,
  "startedAt": "2025-01-01T00:00:00Z"
}
```

### Knowledge Graph Search

```
GET /api/search?query=auth&projectId=my-project&limit=20
POST /api/search
```

Full-text search across the indexed knowledge graph using FTS5.

**Request:**
```json
{
  "query": "authentication",
  "projectId": "my-project",
  "labels": ["Function", "Class"],
  "limit": 20,
  "offset": 0
}
```

**Response:**
```json
{
  "items": [
    {
      "nodeId": 42,
      "name": "authenticate",
      "qualifiedName": "auth.authenticate",
      "label": "Function",
      "filePath": "src/auth/index.ts",
      "rank": 0.95,
      "snippet": "export async function authenticate(token: string)..."
    }
  ],
  "total": 15,
  "returned": 15,
  "hasMore": false
}
```

### Code Review

```
POST /api/review/diff
POST /api/review/file
POST /api/review/pr
```

Run code review analysis on diffs, files, or pull requests.

**Request (diff review):**
```json
{
  "projectId": "my-project",
  "diff": "...",
  "fromRef": "main",
  "toRef": "feature/auth",
  "severity": "medium",
  "categories": ["security", "performance", "maintainability"]
}
```

**Response:**
```json
{
  "projectId": "my-project",
  "range": { "from": "main", "to": "feature/auth" },
  "comments": [],
  "summary": {
    "total": 5,
    "critical": 0,
    "high": 1,
    "medium": 3,
    "low": 1,
    "info": 0
  },
  "severity": "medium"
}
```

### Impact Analysis

```
POST /api/impact
```

Analyze the impact of code changes using graph traversal.

**Request:**
```json
{
  "projectId": "my-project",
  "targetSymbol": "UserService.createUser",
  "fromRef": "v1.0.0",
  "toRef": "v1.1.0",
  "depth": 3
}
```

**Response:**
```json
{
  "range": { "from": "v1.0.0", "to": "v1.1.0" },
  "changedFiles": ["src/services/user.ts", "src/controllers/user.ts"],
  "changedSymbols": [],
  "impactTree": [
    {
      "symbolQname": "UserController.createUser",
      "label": "Function",
      "filePath": "src/controllers/user.ts",
      "impactType": "direct",
      "depth": 1
    }
  ],
  "riskLevel": "low",
  "processesAffected": [],
  "estimatedEffort": "low"
}
```

### Route Mapping

```
POST /api/routes
```

Get API route mappings for a project.

**Request:**
```json
{
  "projectId": "my-project",
  "includeHandlers": true
}
```

**Response:**
```json
{
  "projectId": "my-project",
  "routeCount": 12,
  "routes": [
    { "method": "GET", "path": "/api/users", "handler": "getUsers", "filePath": "src/controllers/user.ts" },
    { "method": "POST", "path": "/api/users", "handler": "createUser", "filePath": "src/controllers/user.ts" }
  ]
}
```

### Cycle Detection

```
POST /api/cycles
```

Detect circular dependencies in the project graph.

**Request:**
```json
{
  "projectId": "my-project",
  "module": "src/core",
  "maxDepth": 10
}
```

**Response:**
```json
{
  "cyclesFound": 1,
  "cycles": [
    {
      "nodes": ["src/core/index", "src/utils/helper", "src/core/config"],
      "types": ["Module", "Module", "Module"]
    }
  ],
  "warnings": ["Circular dependency detected: core -> utils -> core"]
}
```

### Reports

```
POST /api/reports/generate
POST /api/reports/export
GET  /api/reports/:reportId
```

Generate and export analysis reports.

**Request (generate):**
```json
{
  "projectId": "my-project",
  "type": "codebase-audit",
  "format": "markdown",
  "scope": "main"
}
```

**Response:**
```json
{
  "id": "report_1710000000000",
  "type": "codebase-audit",
  "title": "codebase-audit Report for my-project",
  "summary": {
    "overallScore": 95,
    "riskLevel": "low",
    "totalFindings": 0
  },
  "metrics": {
    "linesChanged": 0,
    "filesChanged": 0,
    "symbolsAffected": 0,
    "complianceScore": 100
  }
}
```

### Project Management

```
GET    /api/projects
GET    /api/projects/:projectId/status
DELETE /api/projects/:projectId
```

Manage indexed projects.

### Standards & ADR

```
GET    /api/standards/:projectId
POST   /api/standards
POST   /api/adr
GET    /api/adr/:projectId
```

Manage coding standards and Architecture Decision Records.

### Cross-Repository

```
POST /api/cross-repo/search
POST /api/cross-repo/trace
POST /api/cross-repo/impact
POST /api/repo-groups
GET  /api/repo-groups
```

Search and trace across multiple repositories.

### PDG & Security

```
POST /api/pdg/query
POST /api/pdg/taint
POST /api/pdg/taint/explain
```

Program Dependence Graph queries and taint analysis for security auditing.

## Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CODE_ANALYZER_PORT` | `number` | `8080` | HTTP server port |
| `CODE_ANALYZER_HOST` | `string` | `0.0.0.0` | HTTP server bind address |
| `CODE_ANALYZER_DATA_DIR` | `string` | `~/.code-analyzer/data` | Data directory for in-memory graph stores |
| `CODE_ANALYZER_LOG_LEVEL` | `string` | `info` | Log level (debug, info, warn, error) |
| `CODE_ANALYZER_MAX_BODY_SIZE` | `string` | `10mb` | Maximum request body size |
| `CODE_ANALYZER_TIMEOUT` | `number` | `30000` | Request timeout in milliseconds |
| `CODE_ANALYZER_CORS_ORIGIN` | `string` | `*` | CORS allowed origins |

### Server Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `port` | `number` | `8080` | HTTP listen port |
| `host` | `string` | `'0.0.0.0'` | HTTP bind host |
| `maxResults` | `number` | `100` | Maximum results per query |
| `enableStreaming` | `boolean` | `false` | Enable SSE streaming |
| `cors` | `boolean \| object` | `true` | CORS configuration |

## Package Dependencies

| Dependency | Description |
|------------|-------------|
| `@code-analyzer/shared` | Shared type definitions and schemas |
| `@code-analyzer/core` | Core engine interfaces and abstractions |
| `@code-analyzer/infra` | Infrastructure layer (`InMemoryGraphStore`, logging, configuration) |
| `@code-analyzer/analyzer` | Static code analysis and AST parsing |
| `@code-analyzer/intelligence` | AI-powered code intelligence engine |

### Dev Dependencies

| Dependency | Description |
|------------|-------------|
| `typescript` | TypeScript compiler (^5.6.0) |
| `vitest` | Unit test runner (^2.1.0) |

## Integration Examples

### CI/CD Pipeline (GitHub Actions)

```yaml
name: Code Analysis
on: [pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Start Analyzer Server
        run: |
          npx @code-analyzer/server &
          sleep 5
      - name: Run Impact Analysis
        run: |
          curl -X POST http://localhost:8080/api/impact \
            -H "Content-Type: application/json" \
            -d '{"projectId":"my-app","fromRef":"${{ github.base_ref }}","toRef":"HEAD"}'
      - name: Generate Report
        run: |
          curl -X POST http://localhost:8080/api/reports/generate \
            -H "Content-Type: application/json" \
            -d '{"projectId":"my-app","type":"pr-review","format":"markdown"}'
```

### Python SDK Client

```python
import requests

class CodeAnalyzerClient:
    def __init__(self, base_url="http://localhost:8080"):
        self.base_url = base_url

    def analyze_repo(self, path, project_id=None):
        resp = requests.post(f"{self.base_url}/api/analyze", json={
            "path": path,
            "projectId": project_id or path.split("/")[-1]
        })
        return resp.json()

    def search(self, query, project_id, limit=20):
        resp = requests.post(f"{self.base_url}/api/search", json={
            "query": query,
            "projectId": project_id,
            "limit": limit
        })
        return resp.json()

    def review_diff(self, project_id, diff_content):
        resp = requests.post(f"{self.base_url}/api/review/diff", json={
            "projectId": project_id,
            "diff": diff_content
        })
        return resp.json()

# Usage
client = CodeAnalyzerClient()
client.analyze_repo("/path/to/repo", "my-project")
results = client.search("authentication", "my-project")
print(f"Found {results['total']} results")
```

### Web UI Integration (React)

```typescript
// hooks/useCodeAnalyzer.ts
import { useState, useCallback } from 'react';

interface SearchResult {
  nodeId: number;
  name: string;
  qualifiedName: string;
  label: string;
  filePath: string;
}

export function useCodeAnalyzer(baseUrl = 'http://localhost:8080') {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string, projectId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, projectId, limit: 50 }),
      });
      const data = await res.json();
      setResults(data.items);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  return { results, loading, search };
}
```

## Architecture

### Source Layout

```
src/
└── index.ts                    # createServer() factory — HTTP server with start/shutdown
```

The server package provides a `createServer()` factory function that returns a server instance with `start(port)` and `shutdown()` methods. The HTTP layer is designed to be embedded into larger applications or run standalone. It wraps the intelligence engine from `@code-analyzer/intelligence`, which coordinates analysis through `@code-analyzer/analyzer` and stores results in the `InMemoryGraphStore` from `@code-analyzer/infra`.

### Request Flow

```
HTTP Request
  │
  ▼
Routing (REST endpoints)
  │
  ▼
Request Validation (JSON schema)
  │
  ▼
Intelligence Engine (@code-analyzer/intelligence)
  │
  ├── Static Analysis (@code-analyzer/analyzer)
  │   ├── Tree-sitter AST parsing
  │   ├── Symbol extraction
  │   └── Relationship detection
  │
  ├── Graph Storage (@code-analyzer/infra)
  │   ├── In-memory graph store + FTS
  │   ├── Graph traversal (BFS/DFS)
  │   └── Cypher query execution
  │
  └── AI Analysis (@code-analyzer/intelligence)
      ├── Code review
      ├── Impact analysis
      └── Report generation
  │
  ▼
JSON Response
```

## Comparison with @code-analyzer/mcp

| Feature | `@code-analyzer/server` | `@code-analyzer/mcp` |
|---------|------------------------|---------------------|
| **Protocol** | HTTP REST (JSON) | MCP (stdio / HTTP+SSE) |
| **Target** | Web apps, CI/CD, SDKs | AI coding agents |
| **Tool Count** | Same engine, REST endpoints | 38 MCP tools |
| **Transport** | HTTP only | stdio + HTTP |
| **Auth** | Standard HTTP auth | API key middleware |
| **Streaming** | SSE support planned | SSE support planned |
| **Use Case** | Programmatic integration | Agent-assisted development |

## License

MIT

## Links

- [Code Analyzer Documentation](./docs/)
- [Contributing Guide](./CONTRIBUTING.md)
- [API Specification](./docs/api-spec.md)
