# Code Analyzer — Deployment Guide

Production deployment guide for the Code Analyzer platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Docker Deployment](#docker-deployment)
3. [Docker Compose](#docker-compose)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Environment Variables](#environment-variables)
6. [Health Checks](#health-checks)
7. [Resource Requirements](#resource-requirements)
8. [Backup & Recovery](#backup--recovery)
9. [Monitoring](#monitoring)

---

## Prerequisites

| Requirement             | Minimum | Recommended |
| ----------------------- | ------- | ----------- |
| Docker                  | 24.0+   | 26.0+       |
| Kubernetes              | 1.27+   | 1.30+       |
| Node.js (manual deploy) | 20.0.0  | 22.x LTS    |
| pnpm (manual deploy)    | 8.0.0   | 9.x         |
| Memory                  | 2 GB    | 4-8 GB      |
| Storage (SSD)           | 10 GB   | 50+ GB      |
| Git                     | 2.40+   | 2.45+       |

---

## Docker Deployment

### Single Container

```bash
# Build the image (targets the 'runner' stage by default)
docker build -t code-analyzer:latest .

# Run the MCP server
docker run -d \
  --name code-analyzer \
  -p 3000:3000 \
  -v $(pwd):/workspace:ro \
  -v code-analyzer-graph:/app/data/graph \
  -e MCP_API_KEY=your-secret-key \
  -e LOG_LEVEL=info \
  code-analyzer:latest
```

The default entrypoint starts the MCP server on port 3000 with SSE transport.

### Multi-Architecture Build

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t code-analyzer:latest .
```

Or use Docker Bake for parallel builds:

```bash
docker buildx bake -f docker/docker-bake.hcl
```

---

## Docker Compose

The canonical compose file is at the repository root: [`docker-compose.yml`](../docker-compose.yml).

It defines two services:

| Service                | Port | Description                |
| ---------------------- | ---- | -------------------------- |
| `code-analyzer-mcp`    | 3000 | MCP server (SSE transport) |
| `code-analyzer-server` | 3001 | HTTP REST API server       |

### Quick Start

```bash
# Start both services
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Features

- **Non-root execution** — containers run with limited UID 1001
- **Read-only root filesystem** — `read_only: true` with tmpfs for `/tmp`
- **Resource limits** — 2 CPU, 2 GB memory per service
- **Health checks** — automatic restart on failure (30s interval, 3 retries)
- **Persistent storage** — named volume `graph-data` for graph state
- **Network isolation** — dedicated `analyzer-net` bridge network
- **Security hardening** — `no-new-privileges:true` on all services

---

## Kubernetes Deployment

Production manifests are in the [`k8s/`](../k8s/) directory:

| File              | Resource                       |
| ----------------- | ------------------------------ |
| `namespace.yaml`  | Namespace `code-analyzer`      |
| `configmap.yaml`  | ConfigMap with server settings |
| `deployment.yaml` | Deployment (1 replica) + PVC   |
| `service.yaml`    | ClusterIP service              |

### Deployment

```bash
# Apply all manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

### Secrets

Create the secrets object before applying the deployment:

```bash
kubectl -n code-analyzer create secret generic code-analyzer-secrets \
  --from-literal=deepseek-api-key=<your-key> \
  --from-literal=mcp-api-key=<your-mcp-key>
```

### Resource Allocation (from deployment.yaml)

| Resource      | Request | Limit           |
| ------------- | ------- | --------------- |
| CPU           | 500m    | 2000m (2 cores) |
| Memory        | 512 Mi  | 2 Gi            |
| Storage (PVC) | 50 Gi   | —               |

### Probes

| Probe     | Path           | Initial Delay | Period |
| --------- | -------------- | :-----------: | :----: |
| Liveness  | `/health:3000` |      15s      |  30s   |
| Readiness | `/health:3000` |      5s       |  10s   |

---

## Environment Variables

### Core Settings

| Variable    | Default      | Description                      |
| ----------- | ------------ | -------------------------------- |
| `NODE_ENV`  | `production` | Environment mode                 |
| `LOG_LEVEL` | `info`       | `debug`, `info`, `warn`, `error` |

### MCP Server

| Variable           | Default | Description                          |
| ------------------ | ------- | ------------------------------------ |
| `MCP_TRANSPORT`    | `sse`   | Transport mode: `sse` or `stdio`     |
| `MCP_API_KEY`      | —       | API key for client authentication    |
| `TOOL_PROFILE`     | `all`   | Tool set: `all`, `analysis`, `scout` |
| `ENABLE_RESOURCES` | `true`  | Expose MCP resources                 |
| `ENABLE_PROMPTS`   | `true`  | Expose MCP prompts                   |
| `ENABLE_STREAMING` | `false` | Enable SSE streaming                 |

### REST API Server

| Variable         | Default | Description                     |
| ---------------- | ------- | ------------------------------- |
| `PORT`           | `3001`  | Server port                     |
| `SERVER_API_KEY` | —       | API key for REST authentication |

### Rate Limiting

| Variable                  | Default | Description                 |
| ------------------------- | ------- | --------------------------- |
| `RATE_LIMIT_WINDOW_MS`    | `60000` | Window size in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `100`   | Max requests per window     |

### Analysis Engine

| Variable                      | Default     | Description                      |
| ----------------------------- | ----------- | -------------------------------- |
| `CODE_ANALYZER_MAX_FILE_SIZE` | `10485760`  | Max file size in bytes (10 MB)   |
| `CODE_ANALYZER_CONCURRENCY`   | `4`         | Parallel parse workers           |
| `CODE_ANALYZER_DATA_DIR`      | `/app/data` | Data directory for graph storage |

### Optional: External Services

| Variable                | Default | Description                                       |
| ----------------------- | ------- | ------------------------------------------------- |
| `DEEPSEEK_API_KEY`      | —       | DeepSeek API key for optional LLM review features |
| `GITHUB_WEBHOOK_SECRET` | —       | HMAC secret for GitHub webhook verification       |

---

## Health Checks

### Endpoint

```
GET /health
```

### Response (200 OK)

```json
{
  "status": "ok",
  "timestamp": "2026-08-07T12:00:00.000Z",
  "uptime": 3600000,
  "version": "0.1.0",
  "name": "code-analyzer"
}
```

### Status Values

| Status      | Meaning                                |
| ----------- | -------------------------------------- |
| `ok`        | All systems healthy                    |
| `degraded`  | Non-critical issue (e.g., high memory) |
| `unhealthy` | Critical failure                       |

### Docker Health Check

The Dockerfile includes a built-in health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/health || exit 1
```

---

## Resource Requirements

### Memory

| Codebase Size      | Recommended Memory | Notes                                         |
| :----------------- | -----------------: | --------------------------------------------- |
| < 100 files        |             512 MB | Suitable for small projects and microservices |
| 100-1,000 files    |             1-2 GB | Default container allocation                  |
| 1,000-10,000 files |             4-8 GB | Large monorepos, index in batches             |
| > 10,000 files     |            8-16 GB | Consider sharding across multiple instances   |

### Storage

| Component               | Size Guidance                 |
| ----------------------- | ----------------------------- |
| Graph database (SQLite) | ~1-5 MB per 1,000 files       |
| Cache directory         | 10-100 MB (content-addressed) |
| Workspace mounts        | Dependent on repository size  |

### CPU

- Analysis is CPU-bound during initial indexing; 2-4 cores recommended
- After indexing, the server is primarily I/O-bound on graph queries
- Horizontal scaling not supported (graph store is local); use vertical scaling

---

## Backup & Recovery

### What to Back Up

The data directory (`/app/data` or `$CODE_ANALYZER_DATA_DIR`) contains:

- `graph/` — SQLite graph database
- `cache/` — Content-addressed file cache
- `embeddings/` — Cached embedding vectors
- `index/` — Full-text search index

### Backup Procedure

```bash
# Stop the service
docker stop code-analyzer

# Create a backup
tar -czf code-analyzer-backup-$(date +%Y%m%d-%H%M%S).tar.gz /path/to/data

# Restart
docker start code-analyzer
```

### Recovery

```bash
docker stop code-analyzer
tar -xzf code-analyzer-backup-YYYYMMDD-HHMMSS.tar.gz -C /
docker start code-analyzer
```

---

## Monitoring

### Logs

Structured JSON logs are written to stdout:

```json
{
  "level": "info",
  "timestamp": "2026-08-07T12:00:00.000Z",
  "message": "Server started",
  "port": 3000,
  "transport": "sse"
}
```

### Key Metrics

| Metric            | Description             | Alert Threshold          |
| ----------------- | ----------------------- | ------------------------ |
| Memory RSS        | Resident set size       | > 80% of container limit |
| Heap used         | V8 heap utilization     | > 90%                    |
| Response time P95 | 95th percentile latency | > 1000ms                 |
| Error rate        | 5xx errors / minute     | > 5%                     |
| Index queue depth | Pending indexing jobs   | > 100                    |

### Prometheus

A `/metrics` endpoint provides Prometheus-compatible metrics (when enabled in configuration).

---

## Troubleshooting

### Server Won't Start

1. Check port: `lsof -i :3000`
2. Verify Node.js: `docker exec code-analyzer node --version` (must be >= 20)
3. Check logs: `docker logs code-analyzer`
4. Verify volume permissions (UID 1001 must own `/app/data`)

### Slow Initial Indexing

1. Increase CPU limit in docker-compose or k8s deployment
2. Verify storage is SSD, not HDD
3. Increase `CODE_ANALYZER_CONCURRENCY` for more parallel workers
4. Exclude large generated directories via `.code-analyzer-ignore`

### High Memory Usage

1. Reduce `CODE_ANALYZER_MAX_FILE_SIZE` to skip very large files
2. Restart service periodically (memory fragmentation in long-running V8)
3. Reduce concurrency to lower peak memory

### Webhook Verification Failures

1. Verify `GITHUB_WEBHOOK_SECRET` matches GitHub App/Webhook configuration
2. Check system clock (NTP sync required for HMAC)
3. Inspect payload for proxy header modifications
