# Configuration Reference

> Complete configuration reference for Code Analyzer — all options, environment variables, file formats, and CI/CD examples.

---

## Configuration Sources

Code Analyzer merges configuration from four sources in order of increasing precedence:

1. **Defaults** — Built-in defaults from `@code-analyzer/core`
2. **Global config** — `~/.code-analyzer/config.json` (user-level)
3. **Project config** — `.code-analyzer.json` in the project root
4. **Environment variables** — `CODE_ANALYZER_*` prefixed variables

Configuration is deep-merged: objects are recursively combined, arrays are replaced (not concatenated).

---

## Configuration Schema

### File Format

Code Analyzer supports JSON configuration files:

- **Global**: `~/.code-analyzer/config.json`
- **Project**: `.code-analyzer.json` (in project root)

```json
{
  "projectId": "my-project",
  "rootPath": ".",
  "language": "typescript",
  "excludePatterns": ["node_modules/**", ".git/**", "dist/**"],
  "includePatterns": [],
  "maxFileSize": 10485760,
  "maxFiles": 50000,
  "parseWorkers": 4,
  "cacheDir": ".code-analyzer",
  "ignorePaths": ["node_modules", ".git", "dist", "build"],
  "mcp": {
    "name": "code-analyzer",
    "version": "0.1.0",
    "toolProfile": "all",
    "maxResults": 100,
    "enableStreaming": false,
    "enableResources": true,
    "enablePrompts": true
  },
  "review": {
    "enabled": true,
    "maxComments": 50,
    "severityFilter": ["low", "medium", "high", "critical"],
    "categoryFilter": []
  },
  "embed": {
    "enabled": true,
    "model": "default",
    "batchSize": 32,
    "dimensions": 768
  },
  "pruner": {
    "enabled": true,
    "keepTests": true,
    "keepInternal": false
  }
}
```

---

## Full Configuration Options

### Top-Level Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectId` | `string` | `""` | Unique identifier for the project |
| `rootPath` | `string` | `process.cwd()` | Root directory of the project to analyze |
| `language` | `SupportedLanguage` | `null` | Primary language (auto-detect if not set) |
| `excludePatterns` | `string[]` | See below | Glob patterns for files to exclude from analysis |
| `includePatterns` | `string[]` | `[]` | Glob patterns to restrict which files are analyzed |
| `maxFileSize` | `number` | `10485760` (10 MB) | Maximum file size in bytes |
| `maxFiles` | `number` | `50000` | Maximum number of files to process |
| `parseWorkers` | `number` | `CPU cores / 2` | Number of worker threads for parallel parsing |
| `cacheDir` | `string` | `.code-analyzer` | Directory for parse cache and database files |
| `ignorePaths` | `string[]` | See below | Directory names to skip during file discovery |

#### Default `excludePatterns`

```json
[
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  ".next/**",
  ".nuxt/**",
  "__pycache__/**",
  "*.pyc",
  "target/**",
  ".gradle/**"
]
```

#### Default `ignorePaths`

```json
[
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  "target",
  ".gradle"
]
```

### MCP Server Options (`mcp`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mcp.name` | `string` | `"code-analyzer"` | Server name reported to MCP clients |
| `mcp.version` | `string` | `"0.1.0"` | Server version reported to MCP clients |
| `mcp.toolProfile` | `"all" \| "analysis" \| "scout"` | `"all"` | Which tools to expose |
| `mcp.maxResults` | `number` | `100` | Maximum results per tool call |
| `mcp.enableStreaming` | `boolean` | `false` | Enable SSE streaming responses |
| `mcp.enableResources` | `boolean` | `true` | Enable MCP resource endpoints |
| `mcp.enablePrompts` | `boolean` | `true` | Enable MCP prompt templates |

### Code Review Options (`review`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `review.enabled` | `boolean` | `true` | Enable code review features |
| `review.maxComments` | `number` | `50` | Maximum comments per review session |
| `review.severityFilter` | `Severity[]` | All levels | Only show comments at or above these severities |
| `review.categoryFilter` | `ReviewCategory[]` | All categories | Only show comments in these categories |

### Embedding Options (`embed`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embed.enabled` | `boolean` | `true` | Enable vector embedding generation |
| `embed.model` | `string` | `"default"` | Embedding model identifier |
| `embed.batchSize` | `number` | `32` | Batch size for embedding computation |
| `embed.dimensions` | `number` | `768` | Embedding vector dimensions |

### Pruner Options (`pruner`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pruner.enabled` | `boolean` | `true` | Enable local symbol pruning |
| `pruner.keepTests` | `boolean` | `true` | Keep test-related symbols during pruning |
| `pruner.keepInternal` | `boolean` | `false` | Keep internal (non-exported) symbols |

---

## Environment Variables

All environment variables use the `CODE_ANALYZER_` prefix:

| Variable | Type | Config Path | Description |
|----------|------|-------------|-------------|
| `CODE_ANALYZER_PROJECT_ID` | `string` | `projectId` | Project identifier |
| `CODE_ANALYZER_ROOT_PATH` | `string` | `rootPath` | Project root directory |
| `CODE_ANALYZER_LANGUAGE` | `string` | `language` | Primary programming language |
| `CODE_ANALYZER_MAX_FILE_SIZE` | `number` | `maxFileSize` | Max file size in bytes |
| `CODE_ANALYZER_MAX_FILES` | `number` | `maxFiles` | Max files to process |
| `CODE_ANALYZER_PARSE_WORKERS` | `number` | `parseWorkers` | Worker thread count |
| `CODE_ANALYZER_CACHE_DIR` | `string` | `cacheDir` | Cache directory path |
| `CODE_ANALYZER_MCP_NAME` | `string` | `mcp.name` | MCP server name |
| `CODE_ANALYZER_MCP_VERSION` | `string` | `mcp.version` | MCP server version |
| `CODE_ANALYZER_MCP_TOOL_PROFILE` | `string` | `mcp.toolProfile` | Tool profile (`all`, `analysis`, `scout`) |
| `CODE_ANALYZER_MCP_MAX_RESULTS` | `number` | `mcp.maxResults` | Max results per tool call |
| `CODE_ANALYZER_MCP_ENABLE_STREAMING` | `boolean` | `mcp.enableStreaming` | Enable SSE streaming |
| `CODE_ANALYZER_MCP_ENABLE_RESOURCES` | `boolean` | `mcp.enableResources` | Enable resources |
| `CODE_ANALYZER_MCP_ENABLE_PROMPTS` | `boolean` | `mcp.enablePrompts` | Enable prompts |
| `CODE_ANALYZER_REVIEW_ENABLED` | `boolean` | `review.enabled` | Enable review |
| `CODE_ANALYZER_REVIEW_MAX_COMMENTS` | `number` | `review.maxComments` | Max review comments |
| `CODE_ANALYZER_EMBED_ENABLED` | `boolean` | `embed.enabled` | Enable embeddings |
| `CODE_ANALYZER_EMBED_MODEL` | `string` | `embed.model` | Embedding model |
| `CODE_ANALYZER_EMBED_BATCH_SIZE` | `number` | `embed.batchSize` | Embedding batch size |
| `CODE_ANALYZER_EMBED_DIMENSIONS` | `number` | `embed.dimensions` | Embedding dimensions |
| `CODE_ANALYZER_PRUNER_ENABLED` | `boolean` | `pruner.enabled` | Enable pruner |
| `CODE_ANALYZER_PRUNER_KEEP_TESTS` | `boolean` | `pruner.keepTests` | Keep test symbols |
| `CODE_ANALYZER_PRUNER_KEEP_INTERNAL` | `boolean` | `pruner.keepInternal` | Keep internal symbols |

### Comma-Separated List Variables

| Variable | Description |
|----------|-------------|
| `CODE_ANALYZER_EXCLUDE_PATTERNS` | Comma-separated glob exclude patterns |
| `CODE_ANALYZER_INCLUDE_PATTERNS` | Comma-separated glob include patterns |
| `CODE_ANALYZER_IGNORE_PATHS` | Comma-separated directory names to ignore |

Boolean values accept `"true"` or `"false"` (case-sensitive). Numeric values are coerced from strings automatically.

---

## Per-Language Configuration

Language providers are auto-detected from file extensions. The supported languages and their extensions are:

| Language | Extensions |
|----------|-----------|
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `.py`, `.pyw`, `.pyi` |
| Go | `.go` |
| Java | `.java` |
| Kotlin | `.kt`, `.kts` |
| C# | `.cs` |
| Rust | `.rs` |
| C | `.c`, `.h` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` |
| PHP | `.php`, `.phtml` |
| Ruby | `.rb` |
| Swift | `.swift` |
| Dart | `.dart` |
| Lua | `.lua` |
| Scala | `.scala` |
| Zig | `.zig` |
| Elixir | `.ex`, `.exs` |

> Note: Full analysis depth (parsing, resolution, graph building) is available for the first 8 languages (TypeScript through Rust). Remaining languages have basic file detection support.

---

## Ignore/Exclude Patterns

Patterns support glob syntax:

```json
{
  "excludePatterns": [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "**/*.test.ts",
    "**/__tests__/**",
    "**/*.generated.*"
  ],
  "includePatterns": [
    "src/**",
    "lib/**"
  ]
}
```

- `**` matches any number of directories
- `*` matches any characters except `/`
- Patterns are matched against relative file paths

---

## CI/CD Configuration Examples

### GitHub Actions — PR Review

```yaml
name: Code Analyzer PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Code Analyzer
        run: npm install -g @code-analyzer/cli

      - name: Index repository
        run: code-analyzer analyze . --languages typescript

      - name: Review PR
        env:
          CODE_ANALYZER_PROJECT_ID: ${{ github.event.repository.name }}
          CODE_ANALYZER_REVIEW_MAX_COMMENTS: 50
        run: |
          code-analyzer review pr \
            --repo . \
            --pr ${{ github.event.pull_request.number }} \
            --token ${{ secrets.GITHUB_TOKEN }} \
            --format markdown \
            --output review-report.md

      - name: Post review
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('review-report.md', 'utf8');
            github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: report,
            });
```

### GitHub Actions — Standards Check

```yaml
name: Code Standards Check
on:
  push:
    branches: [main]
  pull_request:

jobs:
  standards:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Check standards
        run: |
          npx @code-analyzer/cli standards check \
            --repo . \
            --standard typescript-coding \
            --standard security-baseline \
            --format json \
            --output standards-report.json

      - name: Fail on critical issues
        run: |
          CRITICAL=$(jq '[.[] | select(.summary.critical > 0)] | length' standards-report.json)
          if [ "$CRITICAL" -gt 0 ]; then
            echo "::error::Found $CRITICAL standards with critical violations"
            exit 1
          fi
```

### GitLab CI

```yaml
code-analyzer-review:
  image: node:20
  script:
    - npm install -g @code-analyzer/cli
    - code-analyzer analyze .
    - code-analyzer review diff --from-ref $CI_MERGE_REQUEST_DIFF_BASE_SHA
  only:
    - merge_requests
  artifacts:
    reports:
      codequality: review-report.json
```

---

## Programmatic Configuration

When using Code Analyzer programmatically, configuration is passed directly:

```typescript
import { loadConfig } from '@code-analyzer/core';
import type { CodeAnalyzerConfig } from '@code-analyzer/shared';

// Load merged configuration
const config = await loadConfig('./my-project');

// Or build manually
const manualConfig: Partial<CodeAnalyzerConfig> = {
  projectId: 'my-app',
  rootPath: './my-app',
  language: 'typescript',
  parseWorkers: 4,
  mcp: {
    toolProfile: 'analysis',
    maxResults: 50,
  },
  review: {
    maxComments: 30,
  },
};
```

### Configuration Loading Order

```typescript
// packages/core/src/config/loader.ts
export async function loadConfig(rootPath: string): Promise<CodeAnalyzerConfig> {
  // Layer 1: defaults
  const config = getDefaultConfig();

  // Layer 2: global config (~/.code-analyzer/config.json)
  const globalConfig = await loadJsonFile(getGlobalConfigPath());
  if (globalConfig) deepMerge(config, globalConfig);

  // Layer 3: project config (.code-analyzer.json)
  const projectConfig = await loadJsonFile(getProjectConfigPath(rootPath));
  if (projectConfig) deepMerge(config, projectConfig);

  // Layer 4: environment variables (CODE_ANALYZER_*)
  applyEnvOverrides(config);

  return config;
}
```

---

## See Also

- [ARCHITECTURE.md](ARCHITECTURE.md) — System architecture and data flow
- [MCP-SERVER.md](MCP-SERVER.md) — MCP server setup and tool reference
- [CODE-REVIEW.md](CODE-REVIEW.md) — Code review guide and workflow
- [language-support.md](language-support.md) — Full language feature matrix
