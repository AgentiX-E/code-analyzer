# Code Analyzer — Deployment Guide

Production deployment guide for the Code Analyzer platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Docker Deployment](#docker-deployment)
3. [Kubernetes Deployment](#kubernetes-deployment)
4. [Manual Deployment](#manual-deployment)
5. [Environment Variables](#environment-variables)
6. [Health Checks](#health-checks)
7. [Monitoring](#monitoring)
8. [Backup & Recovery](#backup--recovery)
9. [Scaling](#scaling)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **Git** >= 2.40
- **Docker** >= 24.0 (for container deployments)
- **Kubernetes** >= 1.27 (for K8s deployments)
- **Storage**: SSD with at least 20GB free space (for indexed graph data)
- **Memory**: Minimum 4GB RAM (8GB recommended for large codebases)

---

## Docker Deployment

### Build the Image

```bash
docker build -t code-analyzer:latest .
```

### Run with Default Configuration

```bash
docker run -d \
  --name code-analyzer \
  -p 3000:3000 \
  -v /path/to/repos:/repos \
  -v code-analyzer-data:/data \
  code-analyzer:latest
```

### Run with Custom Configuration

```bash
docker run -d \
  --name code-analyzer \
  -p 3000:3000 \
  -v /path/to/repos:/repos \
  -v code-analyzer-data:/data \
  -e MCP_PORT=3000 \
  -e MCP_TRANSPORT=sse \
  -e MAX_CACHE_SIZE_MB=2048 \
  -e LOG_LEVEL=info \
  code-analyzer:latest
```

### Docker Compose

```yaml
version: '3.8'
services:
  code-analyzer:
    image: code-analyzer:latest
    container_name: code-analyzer
    ports:
      - "3000:3000"
    volumes:
      - /path/to/repos:/repos:ro
      - code-analyzer-data:/data
    environment:
      - MCP_PORT=3000
      - MCP_TRANSPORT=sse
      - MAX_CACHE_SIZE_MB=2048
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    restart: unless-stopped

volumes:
  code-analyzer-data:
```

---

## Kubernetes Deployment

### Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: code-analyzer
```

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: code-analyzer-config
  namespace: code-analyzer
data:
  MCP_PORT: "3000"
  MCP_TRANSPORT: "sse"
  LOG_LEVEL: "info"
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: code-analyzer-secrets
  namespace: code-analyzer
type: Opaque
stringData:
  GITHUB_WEBHOOK_SECRET: "your-webhook-secret"
  API_KEY: "your-api-key"
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: code-analyzer
  namespace: code-analyzer
spec:
  replicas: 1
  selector:
    matchLabels:
      app: code-analyzer
  template:
    metadata:
      labels:
        app: code-analyzer
    spec:
      containers:
        - name: code-analyzer
          image: code-analyzer:latest
          ports:
            - containerPort: 3000
              name: http
          envFrom:
            - configMapRef:
                name: code-analyzer-config
            - secretRef:
                name: code-analyzer-secrets
          volumeMounts:
            - name: data
              mountPath: /data
          resources:
            requests:
              memory: "2Gi"
              cpu: "1"
            limits:
              memory: "8Gi"
              cpu: "4"
          livenessProbe:
            httpGet:
              path: /api/v1/health
              port: 3000
            initialDelaySeconds: 60
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/v1/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: code-analyzer-data
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: code-analyzer
  namespace: code-analyzer
spec:
  selector:
    app: code-analyzer
  ports:
    - port: 3000
      targetPort: 3000
      name: http
  type: ClusterIP
```

### PersistentVolumeClaim

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: code-analyzer-data
  namespace: code-analyzer
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
```

---

## Manual Deployment

### 1. Install Dependencies

```bash
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer
pnpm install
pnpm build
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start the Server

```bash
# MCP stdio mode (for Claude Desktop, etc.)
pnpm start

# HTTP/SSE mode (for network access)
MCP_TRANSPORT=sse pnpm start

# Daemon mode (background process)
pnpm start:daemon
```

### 4. Verify

```bash
curl http://localhost:3000/api/v1/health
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `3000` | HTTP/SSE server port |
| `MCP_HOST` | `0.0.0.0` | HTTP/SSE server bind address |
| `MCP_TRANSPORT` | `sse` | Transport mode: `stdio` or `sse` |
| `LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `MAX_CACHE_SIZE_MB` | `1024` | Maximum cache size in megabytes |
| `TOOL_PROFILE` | `all` | Tool profile: `all`, `analysis`, `scout` |
| `ENABLE_RESOURCES` | `true` | Enable MCP resources |
| `ENABLE_PROMPTS` | `true` | Enable MCP prompts |
| `ENABLE_STREAMING` | `false` | Enable SSE streaming |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for GitHub webhooks |
| `API_KEY` | — | API key for authentication |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Maximum requests per window |
| `DEEPSEEK_API_KEY` | — | DeepSeek API key for LLM review (optional) |
| `NODE_ENV` | `production` | Environment: `development`, `production` |

---

## Health Checks

### HTTP Health Endpoint

```
GET /api/v1/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-07-30T12:00:00Z",
  "uptime": 3600000,
  "version": "0.1.0",
  "name": "code-analyzer",
  "environment": "production",
  "checks": {
    "server": { "status": "ok", "uptime": 3600000 },
    "memory": {
      "status": "ok",
      "heapUsedMB": 256,
      "heapTotalMB": 512,
      "rssMB": 1024
    }
  }
}
```

Status values:
- `ok` — All systems healthy
- `degraded` — Non-critical issues (e.g., high memory usage)
- `unhealthy` — Critical failure

### GraphQL Health Query

```graphql
query {
  health {
    status
    uptime
    version
    checks {
      server
      memory
      store
      llm
    }
  }
}
```

---

## Monitoring

### Logging

Logs are output to stdout with structured JSON format:

```json
{
  "level": "info",
  "timestamp": "2026-07-30T12:00:00.000Z",
  "method": "GET",
  "url": "/api/v1/health",
  "statusCode": 200,
  "responseTimeMs": 2
}
```

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `response_time_p95` | P95 response time | > 1000ms |
| `memory_rss_mb` | Resident memory | > 80% of limit |
| `heap_used_percent` | Heap utilization | > 90% |
| `error_rate` | Error rate per minute | > 5% |
| `cache_hit_rate` | LRU cache hit rate | < 80% |
| `indexing_queue_depth` | Pending indexing tasks | > 100 |

### Prometheus Metrics

The server exposes Prometheus-compatible metrics at `/metrics`:

```
# HELP code_analyzer_requests_total Total HTTP requests
# TYPE code_analyzer_requests_total counter
code_analyzer_requests_total{method="GET",status="200"} 1234

# HELP code_analyzer_response_time_ms Response time in milliseconds
# TYPE code_analyzer_response_time_ms histogram
code_analyzer_response_time_ms_bucket{le="10"} 500
code_analyzer_response_time_ms_bucket{le="100"} 1100
code_analyzer_response_time_ms_bucket{le="1000"} 1230
```

---

## Backup & Recovery

### Data Directory

The data directory contains:
- `store.db` — Graph store (SQLite)
- `cache/` — Content-addressed file cache
- `embeddings/` — Cached embeddings
- `index/` — Search index files

### Backup

```bash
# Stop the server first
docker stop code-analyzer

# Backup the data directory
tar -czf code-analyzer-backup-$(date +%Y%m%d).tar.gz /data

# Restart
docker start code-analyzer
```

### Recovery

```bash
# Stop the server
docker stop code-analyzer

# Restore from backup
tar -xzf code-analyzer-backup-20260730.tar.gz -C /data

# Restart
docker start code-analyzer
```

---

## Scaling

### Vertical Scaling

Increase container resources:
```yaml
resources:
  requests:
    memory: "4Gi"
    cpu: "2"
  limits:
    memory: "16Gi"
    cpu: "8"
```

### Horizontal Scaling

Code Analyzer is designed for single-instance operation (graph store is local). For multi-instance setups:

1. **Read replicas**: Deploy read-only instances behind a load balancer
2. **Shared storage**: Use a shared volume (NFS, EFS) for the data directory
3. **Distributed indexing**: Partition large codebases across multiple workers

### Performance Tuning

| Setting | Small (<10K files) | Medium (<100K files) | Large (>100K files) |
|---------|-------------------|---------------------|---------------------|
| `MAX_CACHE_SIZE_MB` | 512 | 2048 | 8192 |
| Memory Limit | 2GB | 8GB | 32GB |
| CPU Limit | 2 cores | 4 cores | 8 cores |
| Storage | 10GB SSD | 50GB SSD | 200GB SSD |

---

## Troubleshooting

### Server Won't Start

1. Check port availability: `lsof -i :3000`
2. Verify Node.js version: `node --version` (must be >= 20)
3. Check logs: `docker logs code-analyzer`
4. Verify data directory permissions

### Slow Indexing

1. Check available memory (indexing is memory-intensive)
2. Increase `MAX_CACHE_SIZE_MB`
3. Verify storage is SSD, not HDD
4. Index during off-peak hours

### High Memory Usage

1. Reduce `MAX_CACHE_SIZE_MB`
2. Limit concurrent indexing operations
3. Restart server periodically (memory fragmentation)
4. Check for memory leaks in custom plugins

### GraphQL Performance

1. Add field-level `@skip` / `@include` directives
2. Use pagination (`limit` + `offset`) for large result sets
3. Avoid nested queries deeper than 3 levels
4. Consider using REST endpoints for bulk operations

### Webhook Verification Failures

1. Verify `GITHUB_WEBHOOK_SECRET` matches GitHub configuration
2. Check clock synchronization (HMAC validation is time-sensitive)
3. Verify the webhook payload is not truncated
4. Check for proxy/load balancer header modifications
