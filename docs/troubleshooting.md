# Code Analyzer — Troubleshooting Guide

Common issues and their solutions when using Code Analyzer.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Build Errors](#build-errors)
- [Runtime Issues](#runtime-issues)
- [Performance Tuning](#performance-tuning)
- [GitHub Integration](#github-integration)
- [MCP Server Issues](#mcp-server-issues)
- [VS Code Extension Issues](#vs-code-extension-issues)
- [Database & Storage Issues](#database--storage-issues)

---

## Installation Issues

### `tree-sitter` native module fails to build

**Symptom**: `npm install` or `pnpm install` fails with `node-gyp` errors related to `tree-sitter`.

**Solution**:
1. Ensure build essentials are installed:
   ```bash
   # Ubuntu/Debian
   sudo apt-get install build-essential python3
   # macOS
   xcode-select --install
   ```
2. Ensure Node.js >= 20.0.0:
   ```bash
   node --version
   ```
3. Clear the pnpm store and reinstall:
   ```bash
   pnpm store prune
   rm -rf node_modules
   pnpm install
   ```

### `better-sqlite3` fails to compile

**Symptom**: Native SQLite bindings compilation error.

**Solution**:
```bash
# Install system-level SQLite development headers
sudo apt-get install libsqlite3-dev  # Ubuntu/Debian
brew install sqlite                   # macOS
```

### `pnpm: command not found`

**Symptom**: `pnpm` is not recognized after installation.

**Solution**:
```bash
npm install -g pnpm@9
# or via corepack
corepack enable
corepack prepare pnpm@9 --activate
```

---

## Build Errors

### `TypeScript strict mode errors`

**Symptom**: Build fails with `ts(18048)`, `ts(4111)`, etc.

**Solution**:
1. The project uses TypeScript strict mode with `NodeNext` module resolution.
2. Ensure you run the build from the project root:
   ```bash
   pnpm build
   ```
3. If building a single package, ensure its dependencies are already built:
   ```bash
   pnpm --filter @code-analyzer/shared build
   pnpm --filter @code-analyzer/intelligence build
   ```

### `Cannot find module '@code-analyzer/...'`

**Symptom**: Import errors when building downstream packages.

**Solution**: Build all packages in correct dependency order:
```bash
pnpm build  # turbo handles topological ordering
```

---

## Runtime Issues

### Out of Memory (OOM)

**Symptom**: Process crashes with `JavaScript heap out of memory` when analyzing large repositories.

**Solution**:
1. Increase Node.js heap limit:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" code-analyzer analyze ./large-repo
   ```
2. Configure file size limits in `.code-analyzer.json`:
   ```json
   {
     "analyzer": {
       "maxFileSize": 5242880,
       "maxFiles": 25000
     }
   }
   ```
3. Use the `--exclude` flag to skip large generated directories:
   ```bash
   code-analyzer analyze ./repo --exclude '**/generated/**'
   ```

### Slow Analysis on Large Repositories

**Symptom**: Repository analysis takes too long.

**Solution**:
1. Reduce the scope with include/exclude patterns
2. Limit languages:
   ```bash
   code-analyzer analyze ./repo --languages typescript,javascript
   ```
3. Increase worker count (auto-detected by default):
   ```json
   {
     "analyzer": {
       "parseWorkers": 8
     }
   }
   ```
4. Enable parse caching for re-analysis speedups

### High Memory Usage

**Symptom**: Steady memory growth during analysis.

**Solution**:
1. Set `pruner.enabled: true` in config to prune unreferenced symbols
2. Reduce `maxFileSize` to skip very large files
3. Use SQLite graph store for large graphs instead of in-memory:
   ```json
   {
     "storage": {
       "type": "sqlite",
       "dbPath": "./code-analyzer.db"
     }
   }
   ```

---

## Performance Tuning

### Worker Configuration

| Scenario | Recommended `parseWorkers` |
|----------|---------------------------|
| Small repo (< 1000 files) | 2–4 |
| Medium repo (1000–10000 files) | `os.cpus().length - 1` (default) |
| Large repo (> 10000 files) | `os.cpus().length` |
| CI/CD pipeline | `os.cpus().length` |

### Cache Configuration

Enable parse caching for faster re-analysis:
```json
{
  "cache": {
    "enabled": true,
    "maxSize": 1000,
    "ttl": 3600
  }
}
```

### Graph Store Selection

| Store | Best For | Limitations |
|-------|----------|-------------|
| In-Memory | Fast queries, small/medium repos | Memory-bound, ephemeral |
| SQLite | Large repos, persistence | Slightly slower reads |

---

## GitHub Integration

### Rate Limit Errors (403 / 429)

**Symptom**: `GitHubRateLimitError` or 403/429 responses from GitHub API.

**Solution**:
1. Check your current rate limit:
   ```bash
   curl -H "Authorization: token YOUR_TOKEN" \
     https://api.github.com/rate_limit
   ```
2. Use a GitHub App installation token (higher limits than PAT):
   - Personal Access Token: 5000 req/hour
   - GitHub App: 5000–15000 req/hour depending on plan
3. Enable retry logic with exponential backoff (built into the client)

### Webhook Signature Verification Fails

**Symptom**: `INVALID_SIGNATURE` errors when receiving GitHub webhooks.

**Solution**:
1. Verify the webhook secret matches between GitHub and your server config
2. Ensure the payload is raw (not parsed) when computing the signature
3. Check that `X-Hub-Signature-256` uses the `sha256=` prefix

### Cross-Repo Analysis Not Finding Dependencies

**Symptom**: Cross-repo analysis returns empty or partial results.

**Solution**:
1. Ensure all repos in the group are indexed:
   ```bash
   code-analyzer cross-repo index --group my-group
   ```
2. Verify GitHub tokens have read access to all repos
3. Check that dependencies are declared in `package.json`, `requirements.txt`, or `go.mod`

---

## MCP Server Issues

### Client Cannot Connect

**Symptom**: MCP client reports connection failure.

**Solution**:
1. Verify the server is running:
   ```bash
   curl http://localhost:3000/health
   ```
2. Check for port conflicts:
   ```bash
   lsof -i :3000
   ```
3. Review server logs for startup errors

### Tool Returns Unexpected Errors

**Symptom**: Tool calls return error responses.

**Solution**:
1. Check tool arguments match the expected schema:
   ```bash
   curl http://localhost:3000/api/v1/tools/list | jq '.tools[] | {name, description}'
   ```
2. Verify the graph store has been populated (run `analyze_repository` first)
3. Check that the tool supports the requested operation

### mTLS Handshake Fails

**Symptom**: TLS connection rejected during mTLS authentication.

**Solution**:
1. Verify the client certificate is signed by the configured CA
2. Check certificate expiration dates
3. If behind a reverse proxy, configure `clientCertHeader`:
   ```json
   {
     "mtls": {
       "clientCertHeader": "x-forwarded-client-cert"
     }
   }
   ```

---

## VS Code Extension Issues

### Copilot Chat Participant Not Responding

**Symptom**: The `@code-analyzer` participant shows no response in Copilot Chat.

**Solution**:
1. Ensure the extension is activated (check Output panel → Code Analyzer)
2. Verify an MCP server is running or configured
3. Check that the VS Code workspace contains analyzable code

### Analysis Results Don't Update

**Symptom**: VS Code shows stale analysis results.

**Solution**:
1. Run the "Code Analyzer: Refresh Analysis" command
2. Check the file watcher is enabled (`watcher.enabled: true`)
3. Manually trigger re-analysis if the watcher missed changes

---

## Database & Storage Issues

### SQLite Database Locked

**Symptom**: `SQLITE_BUSY` errors during concurrent operations.

**Solution**:
1. The project uses WAL mode by default — check that it's enabled
2. Avoid multiple processes accessing the same database file
3. If using in-memory SQLite (`:memory:`), switch to file-based for concurrent access

### Graph Store Corruption

**Symptom**: Unexpected query results or missing data.

**Solution**:
1. Run validation:
   ```bash
   code-analyzer status --validate
   ```
2. Rebuild the graph from source:
   ```bash
   code-analyzer analyze ./repo --force
   ```
3. Delete and recreate the database:
   ```bash
   rm -f ./code-analyzer.db
   code-analyzer analyze ./repo
   ```

---

## Getting Help

If the above solutions don't resolve your issue:

1. Run `code-analyzer status` for a diagnostic overview
2. Check logs at the configured log directory
3. Enable debug logging: `CODE_ANALYZER_LOG_LEVEL=debug`
4. File an issue with the diagnostic output at [GitHub Issues](https://github.com/AgentiX-E/code-analyzer/issues)
