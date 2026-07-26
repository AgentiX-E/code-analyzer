# GitHub Integration

> Automated cross-repository PR review with GitHub webhooks, check runs, and real-time annotations.

## Overview

Code Analyzer integrates deeply with GitHub to provide automated cross-repository code review. When a pull request is opened or updated, the system:

1. Receives the webhook event from GitHub
2. Identifies the repository group the PR belongs to
3. Syncs all related repositories to the local cache
4. Indexes the codebase into the knowledge graph
5. Runs cross-repo impact analysis
6. Detects API breaking changes across repositories
7. Creates a GitHub Check Run with detailed annotations
8. Posts findings back to the PR

## Architecture

```
GitHub PR Event
      │
      ▼
┌─────────────────┐
│  Webhook Route   │  POST /api/v1/webhook/github
│  (HMAC verify)   │
└────────┬────────┘
         │ async
         ▼
┌─────────────────┐
│ CrossRepoWebhook │  Finds repo group, syncs repos,
│     Bridge       │  indexes, runs cross-repo review
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ GitHubCheckRun   │  Creates/updates check run with
│    Manager       │  annotations and summary
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  GitHub PR       │  Check run appears on PR with
│  (Annotations)   │  failure/warning/notice markers
└─────────────────┘
```

## Setup

### 1. Configure a Repository Group

```bash
# Via the Web Dashboard (Repo Groups tab)
# Or via MCP tool:
code-analyzer mcp call manage_repo_group '{
  "action": "create",
  "id": "my-services",
  "name": "My Microservices",
  "description": "Core platform services"
}'

# Add repos to the group
code-analyzer mcp call manage_repo_group '{
  "action": "add_repo",
  "groupId": "my-services",
  "owner": "my-org",
  "name": "api-gateway",
  "role": "primary"
}'
```

### 2. Start the Server with Webhook Support

```typescript
import { createServer } from '@code-analyzer/server';
import { CrossRepoWebhookBridge } from '@code-analyzer/intelligence';
import { createToolRegistry } from '@code-analyzer/mcp';

const registry = createToolRegistry();
const bridge = new CrossRepoWebhookBridge(/* ... */);

const server = await createServer({
  registry,
  webhook: {
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    handler: {
      async process(payload) {
        await bridge.process(payload);
      },
    },
  },
});

await server.start();
```

### 3. Register the Webhook on GitHub

```bash
# Via GitHub API
curl -X POST https://api.github.com/repos/ORG/REPO/hooks \
  -H "Authorization: Bearer GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web",
    "active": true,
    "events": ["pull_request"],
    "config": {
      "url": "https://your-server.com/api/v1/webhook/github",
      "content_type": "json",
      "secret": "your-webhook-secret"
    }
  }'
```

Or use the `GitHubApiClient` programmatically:

```typescript
import { GitHubApiClient } from '@code-analyzer/intelligence';

const client = new GitHubApiClient({ token: 'ghp_xxx' });
await client.createWebhook('org', 'repo', {
  url: 'https://your-server.com/api/v1/webhook/github',
  secret: 'your-webhook-secret',
  events: ['pull_request'],
});
```

## Webhook Endpoint

The server exposes:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/webhook/github` | POST | Receive GitHub webhook events |
| `/api/v1/webhook/github/status` | GET | Check webhook configuration status |

### Signature Verification

Webhook payloads are verified using HMAC-SHA256 via the `X-Hub-Signature-256` header. If a secret is configured, unverified payloads are rejected with 401.

### Event Handling

Supported events: `pull_request` with actions `opened`, `synchronize`, `reopened`.

The server responds with 200 immediately (GitHub requires response within 10 seconds) and processes the review asynchronously.

## Check Runs

The cross-repo review creates a GitHub Check Run named **"code-analyzer / Cross-Repo Review"** on each PR.

### Annotation Levels

| Level | Trigger |
|-------|---------|
| `failure` | API breaking changes, critical/high severity issues |
| `warning` | Cross-repo impact, version conflicts, medium severity issues |
| `notice` | Test impact predictions, low severity issues |

### Check Run Conclusion

| Merge Recommendation | Check Conclusion |
|---------------------|-----------------|
| `approve` | `success` |
| `approve-with-caution` | `neutral` |
| `request-changes` | `failure` |
| `block` | `action_required` |

## GitHub API Client

The `GitHubApiClient` provides typed access to the GitHub REST API:

```typescript
import { GitHubApiClient } from '@code-analyzer/intelligence';

const client = new GitHubApiClient({ token: 'ghp_xxx' });

// Repositories
const repo = await client.getRepo('org', 'repo');
const repos = await client.listRepos('org');

// Pull Requests
const pr = await client.getPR('org', 'repo', 42);
const prs = await client.listPRs('org', 'repo', { state: 'open' });
const diff = await client.getPRDiff('org', 'repo', 42);
const files = await client.getPRFiles('org', 'repo', 42);

// Check Runs
const check = await client.createCheckRun('org', 'repo', {
  name: 'code-analyzer',
  head_sha: 'abc123',
  status: 'in_progress',
});
await client.updateCheckRun('org', 'repo', check.id, {
  status: 'completed',
  conclusion: 'success',
});

// Webhooks
const hooks = await client.listWebhooks('org', 'repo');
await client.createWebhook('org', 'repo', { url: 'https://...' });
await client.deleteWebhook('org', 'repo', hookId);

// GraphQL
const { data } = await client.graphql<{ repository: { name: string } }>(`
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) { name }
  }
`, { owner: 'org', repo: 'repo' });
```

### Authentication

Two modes are supported:

1. **Personal Access Token (PAT)**: Pass `token` to the constructor
2. **GitHub App**: Provide `appId`, `installationId`, and `appPrivateKey` for JWT-based installation token exchange

### Rate Limiting

The client tracks `X-RateLimit-*` headers and provides:
- `getRateLimit()` for current quota status
- Exponential backoff retry on 429 responses (up to 3 attempts)
- Automatic retry on 5xx server errors

## Repository Sync

The `GitHubRepoSync` manages local clones for cross-repo analysis:

```typescript
import { GitHubRepoSync } from '@code-analyzer/intelligence';

const sync = new GitHubRepoSync({ client, cacheDir: '/tmp/repos' });

// Clone a single repo
const result = await sync.clone('org', 'repo');
console.log(result.localPath); // /tmp/repos/org/repo

// Sync all repos in a group
const { results, errors } = await sync.ensureSynced([
  { owner: 'org', repo: 'service-a' },
  { owner: 'org', repo: 'service-b' },
  { owner: 'org', repo: 'shared-lib' },
]);

// Cache management
sync.getCacheSize();   // bytes
sync.clearCache();     // remove all
sync.remove('org', 'repo'); // remove one
```

Features:
- **Shallow clones**: `--depth 1` for faster cloning
- **Branch tracking**: Defaults to the repo's default branch
- **Auto-fetch**: Pulls latest changes before indexing
- **LRU eviction**: Automatically cleans old repos when cache exceeds limit (default: 5GB)
- **Concurrent sync**: Batches of 4 repos per sync cycle
- **Path safety**: Sanitizes repo names to prevent path traversal

## MCP Tools

Seven cross-repo tools are available via the MCP server:

| Tool | Description |
|------|-------------|
| `cross_repo_search` | Full-text search across all indexed repositories |
| `cross_repo_trace` | BFS call path tracing across repo boundaries |
| `cross_repo_impact` | Analyze cross-repo impact of symbol changes |
| `manage_repo_group` | CRUD: create, list, get, update, delete, add_repo, remove_repo |
| `sync_contracts` | Discover and sync API contracts across repos |
| `discover_related_repos` | Find repos related by symbol overlap |
| `cross_repo_review_pr` | Full cross-repo PR review with diff analysis |
