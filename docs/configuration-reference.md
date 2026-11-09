# Configuration Reference

> Complete reference for `.code-analyzerrc` — file formats, all options with defaults, environment variables, VS Code settings, and configuration profiles.

---

## Configuration File

Code Analyzer reads configuration from a `.code-analyzerrc` file in your project root. Three formats are supported:

| Format   | Filename                                          | Best For                          |
| -------- | ------------------------------------------------- | --------------------------------- |
| **JSON** | `.code-analyzerrc` or `.code-analyzerrc.json`     | Machine-generated config          |
| **YAML** | `.code-analyzerrc.yaml` or `.code-analyzerrc.yml` | Human-edited config (recommended) |
| **TOML** | `.code-analyzerrc.toml`                           | Config with deep nesting          |

Create one with `code-analyzer init`, which walks you through the options interactively.

### Configuration Precedence

Settings are merged from four sources in order of increasing priority:

1. **Built-in defaults** — Sensible defaults from `@code-analyzer/core`
2. **Global config** — `~/.code-analyzer/config.json` (user-level)
3. **Project config** — `.code-analyzerrc` in the project root
4. **Environment variables** — `CODE_ANALYZER_*` prefixed variables

Objects are deep-merged. Arrays are replaced (not concatenated). Environment variables always win.

---

## Basic Example (YAML)

```yaml
# .code-analyzerrc.yaml
project:
  name: my-awesome-project
  languages:
    - typescript
    - python

analysis:
  maxFileSize: 5242880
  maxFiles: 30000
  concurrency: 8
  skipDirectories:
    - node_modules
    - dist
    - .git
    - __pycache__
  skipFilePatterns:
    - '**/*.test.ts'
    - '**/*.spec.ts'
    - '**/generated/**'

review:
  severity: [high, critical]
  categories: [security, performance, architecture]

security:
  scanners: [secrets, taint, dependencies]
  severity: high

mcp:
  transport: http
  port: 3100
  auth:
    enabled: true

server:
  port: 3000
  cors: true
  rateLimit: 100
```

---

## Full Configuration Options

### Top-Level Options

| Option              | Type       | Default     | Description                                                           |
| ------------------- | ---------- | ----------- | --------------------------------------------------------------------- |
| `project.name`      | `string`   | `""`        | Project identifier used in reports                                    |
| `project.languages` | `string[]` | auto-detect | Languages to analyze (see [language-support.md](language-support.md)) |

### Analysis Options

| Option             | Type       | Default                                                                                   | Description                                   |
| ------------------ | ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `maxFileSize`      | `number`   | `10485760` (10 MB)                                                                        | Skip files larger than this (bytes)           |
| `maxFiles`         | `number`   | `50000`                                                                                   | Maximum files to process per run              |
| `concurrency`      | `number`   | `CPU cores / 2`                                                                           | Worker threads for parallel parsing           |
| `skipDirectories`  | `string[]` | `["node_modules",".git","dist","build",".next",".nuxt","__pycache__","target",".gradle"]` | Directory names to skip during file discovery |
| `skipFilePatterns` | `string[]` | `[]`                                                                                      | Glob patterns to exclude from analysis        |
| `languages`        | `string[]` | auto-detect                                                                               | Languages to analyze (filters)                |
| `cacheDir`         | `string`   | `.code-analyzer`                                                                          | Cache and database directory                  |

### Review Options (`review`)

| Option               | Type       | Default                              | Description                                                                                |
| -------------------- | ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `review.severity`    | `string[]` | `["low","medium","high","critical"]` | Minimum severity to report                                                                 |
| `review.categories`  | `string[]` | all                                  | Categories to check: `security`, `performance`, `maintainability`, `style`, `architecture` |
| `review.maxComments` | `number`   | `50`                                 | Maximum comments per review session                                                        |
| `review.autoFix`     | `boolean`  | `false`                              | Automatically apply safe fixes                                                             |

### Security Options (`security`)

| Option              | Type       | Default       | Description                                                   |
| ------------------- | ---------- | ------------- | ------------------------------------------------------------- |
| `security.scanners` | `string[]` | `["secrets"]` | Active scanners: `secrets`, `taint`, `dependencies`, `sast`   |
| `security.severity` | `string`   | `"medium"`    | Minimum severity to flag: `low`, `medium`, `high`, `critical` |

### MCP Options (`mcp`)

| Option             | Type      | Default   | Description                              |
| ------------------ | --------- | --------- | ---------------------------------------- |
| `mcp.transport`    | `string`  | `"stdio"` | Transport protocol: `stdio` or `http`    |
| `mcp.port`         | `number`  | `3100`    | HTTP port when transport is `http`       |
| `mcp.auth.enabled` | `boolean` | `false`   | Enable API key authentication            |
| `mcp.toolProfile`  | `string`  | `"all"`   | Tool profile: `all`, `analysis`, `scout` |
| `mcp.maxResults`   | `number`  | `100`     | Maximum results per tool call            |

### Server Options (`server`)

| Option             | Type      | Default       | Description               |
| ------------------ | --------- | ------------- | ------------------------- |
| `server.port`      | `number`  | `3000`        | HTTP API server port      |
| `server.cors`      | `boolean` | `true`        | Enable CORS headers       |
| `server.rateLimit` | `number`  | `100`         | Requests per minute limit |
| `server.host`      | `string`  | `"localhost"` | Server bind address       |

---

## Environment Variables

All `CODE_ANALYZER_*` variables override config file values:

| Variable                          | Config Path        | Example                   |
| --------------------------------- | ------------------ | ------------------------- |
| `CODE_ANALYZER_MAX_FILE_SIZE`     | `maxFileSize`      | `5242880`                 |
| `CODE_ANALYZER_MAX_FILES`         | `maxFiles`         | `25000`                   |
| `CODE_ANALYZER_CONCURRENCY`       | `concurrency`      | `8`                       |
| `CODE_ANALYZER_PARSE_WORKERS`     | `concurrency`      | `8`                       |
| `CODE_ANALYZER_CACHE_DIR`         | `cacheDir`         | `/tmp/ca-cache`           |
| `CODE_ANALYZER_MCP_TRANSPORT`     | `mcp.transport`    | `http`                    |
| `CODE_ANALYZER_MCP_PORT`          | `mcp.port`         | `3100`                    |
| `CODE_ANALYZER_MCP_AUTH_ENABLED`  | `mcp.auth.enabled` | `true`                    |
| `CODE_ANALYZER_MCP_TOOL_PROFILE`  | `mcp.toolProfile`  | `analysis`                |
| `CODE_ANALYZER_MCP_MAX_RESULTS`   | `mcp.maxResults`   | `50`                      |
| `CODE_ANALYZER_SERVER_PORT`       | `server.port`      | `3000`                    |
| `CODE_ANALYZER_SERVER_CORS`       | `server.cors`      | `false`                   |
| `CODE_ANALYZER_SERVER_RATE_LIMIT` | `server.rateLimit` | `200`                     |
| `CODE_ANALYZER_REVIEW_SEVERITY`   | `review.severity`  | `high,critical`           |
| `CODE_ANALYZER_EXCLUDE_PATTERNS`  | `skipFilePatterns` | `**/test/**,**/mock/**`   |
| `CODE_ANALYZER_IGNORE_PATHS`      | `skipDirectories`  | `vendor,legacy`           |
| `CODE_ANALYZER_LOG_LEVEL`         | —                  | `debug` (troubleshooting) |
| `CODE_ANALYZER_PROJECT_DIR`       | `project.name`     | `/path/to/project`        |

Boolean values accept `"true"` or `"false"`. Comma-separated values are parsed for array options.

---

## VS Code Extension Settings

Configure via `File > Preferences > Settings` and search for "Code Analyzer":

| Setting                       | Type       | Default                       | Description                      |
| ----------------------------- | ---------- | ----------------------------- | -------------------------------- |
| `codeAnalyzer.indexOnOpen`    | `boolean`  | `true`                        | Auto-index workspace when opened |
| `codeAnalyzer.languages`      | `string[]` | `["typescript","javascript"]` | Languages to analyze             |
| `codeAnalyzer.autoReview`     | `boolean`  | `false`                       | Auto-review on file save         |
| `codeAnalyzer.maxTokens`      | `number`   | `8000`                        | Max tokens for review context    |
| `codeAnalyzer.ignorePatterns` | `string[]` | `["node_modules","dist"]`     | File patterns to skip            |
| `codeAnalyzer.standardsPath`  | `string`   | `null`                        | Custom standards file path       |
| `codeAnalyzer.severityLevel`  | `string`   | `"medium"`                    | Minimum review severity shown    |

Settings can also be configured per-workspace in `.vscode/settings.json`:

```json
{
  "codeAnalyzer.languages": ["typescript", "python"],
  "codeAnalyzer.autoReview": true,
  "codeAnalyzer.ignorePatterns": ["node_modules", "dist", "__generated__"]
}
```

---

## Configuration Profiles

**There is no profile flag, and — as things stand — no configuration file is read by any command.** This section used to
show three presets (strict, balanced, relaxed) passed as a `--profile` option to `init`, which has never had one: its only
flags are `--directory` and `--force`.

What is true today:

- **Every option a command acts on arrives as a flag.** `--severity`, `--fail-on`, `--max-files`, `--languages`,
  `--include`, `--exclude` and the rest are the control surface, and `code-analyzer <command> --help` is the complete
  list.
- **`code-analyzer init` writes two files**: `.code-analyzer/standards.json`, which `standards check --standards` and
  `review pr --standards` do read, and `.code-analyzer/config.json`, which **nothing reads yet**. The second is recorded
  intent, not a surface: setting `review.maxFiles` to 1000 in it changes no command's behaviour.
- **`loadConfig` exists and is never called.** `@code-analyzer/core` can merge defaults → `~/.code-analyzer/config.json`
  → `.code-analyzer.json` → `CODE_ANALYZER_*`, and no CLI command invokes it. That is the largest open gap in this
  repository's documentation, it is recorded in `code-analyzer-docs` as the next P1, and until it is closed the schema
  tables in `docs/CONFIGURATION.md` describe what the loader _would_ read rather than a surface a command consults.

The three settings presets are therefore habits rather than flags. Applied as flags, they are:

| Intent                   | Flags                                                |
| ------------------------ | ---------------------------------------------------- |
| Maximum thoroughness     | `--severity info --fail-on warning --max-files 1000` |
| Default                  | `--severity warning --fail-on error --max-files 100` |
| Fast, during development | `--severity error --fail-on critical --max-files 25` |

## See Also

- [Getting Started](getting-started.md) — First-time setup guide
- [MCP Tool Reference](mcp-tool-reference.md) — All 45 MCP tools
- [Scenario Guides](scenario-guides.md) — Task-based workflows
- [Architecture](architecture.md) — System design details
