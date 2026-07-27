# Code Analyzer — REST API Specification

> **Base URL**: `http://localhost:3000` (configurable via `port` in server config)
> **API Prefix**: `/api/v1` (configurable via `apiPrefix` in server config)
> **Content-Type**: `application/json` for all request and response bodies

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Endpoints](#endpoints)
  - [Root](#root)
  - [Health & Diagnostics](#health--diagnostics)
  - [Tools](#tools)
  - [SSE (Server-Sent Events)](#sse-server-sent-events)
  - [Webhooks](#webhooks)
- [Error Codes](#error-codes)
- [Examples](#examples)

---

## Authentication

The server supports two authentication mechanisms:

### API Key Authentication

Enable by setting `auth.enabled: true` in the server config. Clients must provide the API key in one of two ways:

**Custom Header** (default: `x-api-key`):

```http
GET /api/v1/tools/list HTTP/1.1
x-api-key: your-api-key-here
```

**Authorization Bearer**:

```http
GET /api/v1/tools/list HTTP/1.1
Authorization: Bearer your-api-key-here
```

Custom headers take precedence over the Authorization header when both are present.

### mTLS (Mutual TLS)

Enable by setting `mtls.enabled: true` in the server config. Requires clients to present a valid client certificate signed by a trusted CA. Supports certificate pinning via SHA-256 fingerprints.

Health endpoints (`/health`, `/api/v1/health`, `/api/v1/health/live`, `/api/v1/health/ready`) bypass authentication by default.

---

## Rate Limiting

Rate limiting is enabled by default with the following configuration:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `windowMs` | `60_000` | Time window in milliseconds |
| `max` | `100` | Maximum requests per window per IP |
| `skipHealthEndpoints` | `true` | Exclude health endpoints from rate limits |
| `keyGenerator` | IP-based | Custom function to derive rate limit key |

When the rate limit is exceeded, the server returns `429 Too Many Requests` with a `Retry-After` header.

Rate limit status headers are included in every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

---

## Endpoints

### Root

#### `GET /`

Returns basic service information.

**Response** `200 OK`:

```json
{
  "service": "code-analyzer",
  "version": "0.1.0",
  "docs": "/api/v1/tools/list",
  "health": "/api/v1/health"
}
```

---

### Health & Diagnostics

#### `GET /health`

Overall health status. Bypasses authentication and rate limiting.

**Response** `200 OK`:

```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "uptime": 123456,
  "version": "0.1.0",
  "name": "code-analyzer",
  "environment": "production",
  "checks": {
    "server": { "status": "ok", "uptime": 123456 },
    "memory": {
      "status": "ok",
      "heapUsedMB": 45,
      "heapTotalMB": 128,
      "rssMB": 96
    }
  }
}
```

Status values: `ok` (healthy), `degraded` (heap usage > 90%).

#### `GET /api/v1/health`

Full health check via the HealthCheckRegistry. Returns all registered check results.

**Response** `200 OK`:

```json
{
  "status": "healthy",
  "checks": [
    { "name": "memory", "status": "pass", "message": "Memory usage: 45MB / 128MB" },
    { "name": "uptime", "status": "pass", "message": "Uptime: 2 minutes" },
    { "name": "graph-store", "status": "pass", "message": "Graph store: 1523 nodes, 4012 edges" },
    { "name": "disk", "status": "pass", "message": "Disk: 85% free" }
  ]
}
```

#### `GET /api/v1/health/live`

Liveness probe. Always returns `200` as long as the process is alive.

**Response** `200 OK`:

```json
{ "status": "alive" }
```

#### `GET /api/v1/health/ready`

Readiness probe. Returns `200` when all critical checks pass, `503` otherwise.

**Response** `200 OK` when ready, **`503 Service Unavailable`** when not ready.

---

### Tools

#### `GET /api/v1/tools/list`

List all registered MCP tools with metadata.

**Response** `200 OK`:

```json
{
  "total": 39,
  "tools": [
    {
      "name": "analyze_repository",
      "description": "Analyze a code repository and build a knowledge graph",
      "category": "analysis"
    },
    {
      "name": "search_code",
      "description": "Search the knowledge graph for code entities",
      "category": "analysis"
    }
  ]
}
```

#### `POST /api/v1/tools/call`

Invoke a specific tool with arguments.

**Request Body**:

```json
{
  "tool": "analyze_repository",
  "args": {
    "path": "/path/to/repo",
    "language": "typescript"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool` | `string` | **Yes** | Name of the tool to invoke |
| `args` | `object` | No | Tool-specific arguments |
| `store` | `any` | No | Optional store context for stateful tools |

**Response** `200 OK` (success):

```json
{
  "tool": "analyze_repository",
  "success": true,
  "isError": false,
  "content": [
    { "type": "text", "text": "Repository analyzed: 1523 nodes, 4012 edges" }
  ]
}
```

**Response** `200 OK` (tool error):

```json
{
  "tool": "analyze_repository",
  "success": false,
  "isError": true,
  "content": [
    { "type": "text", "text": "Error: Path does not exist" }
  ]
}
```

**Error Responses**:

| Status | Error Code | Description |
|--------|------------|-------------|
| `400` | `INVALID_REQUEST` | Missing or invalid `tool` field in request body |
| `404` | `TOOL_NOT_FOUND` | Tool name not found in registry |
| `500` | `TOOL_EXECUTION_FAILED` | Tool execution threw an unhandled exception |

---

### SSE (Server-Sent Events)

#### `GET /api/v1/sse`

Open a Server-Sent Events connection for real-time streaming. The connection stays open and receives heartbeat pings and tool call events.

**Query Parameters**:

None. The connection is managed via the SSE protocol.

**Events**:

| Event | Description |
|-------|-------------|
| `ping` | Heartbeat sent at `sseHeartbeatMs` interval (default: 30s) |
| `tool_call` | Request to execute a tool on the client side |
| `connected` | Sent on initial connection with a `connectionId` |

#### `POST /api/v1/sse/event`

Send an event to all connected SSE clients.

**Request Body**:

```json
{
  "event": "notification",
  "data": { "message": "Analysis complete" }
}
```

---

### Webhooks

The webhook endpoint is configured via the `webhook` option when creating the server.

#### `POST /api/v1/webhook`

Receive webhook events from external services (e.g., GitHub). Supports signature verification via HMAC-SHA256.

**Headers**:

| Header | Required | Description |
|--------|----------|-------------|
| `X-GitHub-Event` | **Yes** | Event type (e.g., `pull_request`, `push`) |
| `X-Hub-Signature-256` | Conditional | HMAC-SHA256 signature when `secret` is configured |
| `X-GitHub-Delivery` | No | Unique delivery ID (defaults to `unknown`) |

**Request Body**: Raw JSON payload from the webhook source.

**Response** `200 OK`:

```json
{
  "status": "accepted",
  "deliveryId": "abc123-def456"
}
```

**Error Responses**:

| Status | Error Code | Description |
|--------|------------|-------------|
| `400` | `MISSING_EVENT_TYPE` | `X-GitHub-Event` header missing |
| `401` | `INVALID_SIGNATURE` | Signature verification failed |

#### `GET /api/v1/webhook/status`

Check webhook configuration status (whether a secret is configured).

**Response** `200 OK`:

```json
{ "configured": true }
```

---

## Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| `400` | `INVALID_REQUEST` | Missing required fields in request body |
| `400` | `MISSING_EVENT_TYPE` | Webhook event type header missing |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `401` | `INVALID_SIGNATURE` | Webhook signature verification failed |
| `403` | `FORBIDDEN` | Valid API key but insufficient permissions |
| `403` | `MTLS_REQUIRED` | mTLS client certificate required |
| `403` | `MTLS_PINNED_CERT_MISMATCH` | Certificate fingerprint not in pinned list |
| `404` | `TOOL_NOT_FOUND` | Requested tool does not exist |
| `429` | `RATE_LIMITED` | Rate limit exceeded |
| `500` | `TOOL_EXECUTION_FAILED` | Unhandled exception during tool execution |

All error responses follow this schema:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error description",
  "statusCode": 400
}
```

---

## Examples

### List Available Tools

```bash
curl http://localhost:3000/api/v1/tools/list
```

### Analyze a Repository

```bash
curl -X POST http://localhost:3000/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "analyze_repository", "args": {"path": "./my-project"}}'
```

### Search the Knowledge Graph

```bash
curl -X POST http://localhost:3000/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "search_code", "args": {"query": "UserService"}}'
```

### Health Check

```bash
curl http://localhost:3000/health
```

### Authenticated Request

```bash
curl http://localhost:3000/api/v1/tools/list \
  -H "x-api-key: your-secret-key"
```

### Webhook with Signature Verification

```bash
curl -X POST http://localhost:3000/api/v1/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-Hub-Signature-256: sha256=..." \
  -H "X-GitHub-Delivery: abc123" \
  -d '{"action": "opened", "pull_request": {...}}'
```
