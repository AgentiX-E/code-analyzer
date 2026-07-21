# @code-analyzer/cli

> Command-line interface for the Code Analyzer platform — index repositories, search the knowledge graph, and run analysis from your terminal.

[![npm](https://img.shields.io/npm/v/@code-analyzer/cli?color=blue)](https://www.npmjs.com/package/@code-analyzer/cli)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

## Overview

`@code-analyzer/cli` provides the `code-analyzer` command-line tool for code intelligence operations. Built on Commander.js, it enables scripting and CI/CD integration for repository indexing and knowledge graph search. The CLI wraps the `@code-analyzer/core`, `@code-analyzer/analyzer`, and `@code-analyzer/intelligence` packages behind a clean subcommand interface.

```
┌──────────────────────────────────────────────────────────┐
│                      Terminal / CI/CD                     │
│  $ code-analyzer analyze ./src                            │
│  $ code-analyzer search "authentication"                  │
└──────────────────────┬───────────────────────────────────┘
                       │  Commander.js CLI
┌──────────────────────▼───────────────────────────────────┐
│                    @code-analyzer/cli                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Subcommands                                         │ │
│  │  analyze · search · (more coming)                    │ │
│  └──────────────────────┬──────────────────────────────┘ │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │              Core Engine                             │ │
│  │  @code-analyzer/core                                │ │
│  └──────────────────────┬──────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│  @code-analyzer/analyzer  │  @code-analyzer/intelligence  │
│  @code-analyzer/shared    │  @code-analyzer/infra         │
└──────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Global installation
npm install -g @code-analyzer/cli

# Or run via npx (no installation required)
npx @code-analyzer/cli analyze ./my-project

# Install within the monorepo
pnpm install --filter @code-analyzer/cli
```

After global installation, the `code-analyzer` command is available in your terminal:

```bash
code-analyzer --version
# 0.1.0

code-analyzer --help
# Usage: code-analyzer [options] [command]
#
# World-class code intelligence platform
#
# Options:
#   -V, --version  output the version number
#   -h, --help     display help for command
#
# Commands:
#   analyze <path>  Index a repository into the knowledge graph
#   search <query>  Search the knowledge graph
#   help [command]  display help for command
```

## Quick Start

### Index a Repository

```bash
# Basic repository analysis
code-analyzer analyze ./my-project

# Output:
# Analyzing ./my-project...
```

The `analyze` command processes the source code at the given path, building a knowledge graph of symbols, relationships, and dependencies. The indexed data is stored in the SQLite knowledge graph for subsequent querying.

### Search the Knowledge Graph

```bash
# Full-text search across indexed code
code-analyzer search "authentication"

# Output:
# Searching for "authentication"...
```

The `search` command performs FTS5 full-text search across all indexed projects, returning matching symbols, files, and code snippets.

### Pipeline Integration

```bash
# In a shell script
#!/bin/bash
set -e

# Analyze the repository
code-analyzer analyze .

# Search for deprecated patterns
code-analyzer search "TODO" > todos.txt

# Check for security-sensitive patterns
code-analyzer search "password" > sensitive.txt

echo "Analysis complete"
```

## API Reference

### Subcommands

#### `analyze`

Index a repository into the knowledge graph.

```
code-analyzer analyze [options] <path>
```

| Argument | Type | Description |
|----------|------|-------------|
| `<path>` | `string` | Path to the repository to analyze (required) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--language <lang>` | `string` | auto | Programming language (auto-detected if omitted) |
| `--project-id <id>` | `string` | auto | Project identifier (auto-generated if omitted) |
| `--force` | `boolean` | `false` | Force re-index even if already indexed |

**Examples:**

```bash
# Analyze a TypeScript project
code-analyzer analyze --language typescript ./src

# Analyze with a custom project ID
code-analyzer analyze --project-id my-backend-service ./server

# Force re-index an already-analyzed project
code-analyzer analyze --force --project-id my-app .

# Analyze a monorepo package
code-analyzer analyze ./packages/shared
```

**What happens during analysis:**

1. **File discovery** — Scans the directory for source files matching the language
2. **AST parsing** — Parses each file using tree-sitter to extract symbols
3. **Symbol extraction** — Identifies functions, classes, interfaces, modules, etc.
4. **Relationship detection** — Maps imports, calls, inheritance, implementations
5. **Graph construction** — Builds the knowledge graph in SQLite with FTS5 indexing
6. **Status reporting** — Outputs node/edge counts and indexing status

#### `search`

Search the knowledge graph using full-text search.

```
code-analyzer search [options] <query>
```

| Argument | Type | Description |
|----------|------|-------------|
| `<query>` | `string` | Search query string (required) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--project <id>` | `string` | all | Project ID to search within |
| `--limit <n>` | `number` | `20` | Maximum results to return |
| `--offset <n>` | `number` | `0` | Pagination offset |
| `--label <label>` | `string` | all | Filter by node label (Function, Class, Module, etc.) |
| `--format <fmt>` | `string` | `text` | Output format (text, json, csv) |

**Examples:**

```bash
# Basic search
code-analyzer search "handleError"

# Search within a specific project
code-analyzer search --project my-app "UserService"

# Search with label filter
code-analyzer search --label Function "createUser"

# Search with pagination
code-analyzer search --limit 50 --offset 100 "middleware"

# JSON output for scripting
code-analyzer search --format json "auth" | jq '.items[].name'

# CSV output for spreadsheets
code-analyzer search --format csv --label Class "Controller" > controllers.csv
```

**Output formats:**

`text` (default):
```
Search results for "authentication":
  1. auth.authenticate (Function) — src/auth/index.ts:42
  2. AuthController.validateToken (Method) — src/controllers/auth.ts:15
  3. authMiddleware (Function) — src/middleware/auth.ts:8
  Found 3 results
```

`json`:
```json
{
  "items": [
    {
      "nodeId": 42,
      "name": "authenticate",
      "qualifiedName": "auth.authenticate",
      "label": "Function",
      "filePath": "src/auth/index.ts",
      "startLine": 42,
      "endLine": 67,
      "rank": 0.95,
      "snippet": "export async function authenticate(token: string)"
    }
  ],
  "total": 3,
  "returned": 3,
  "hasMore": false
}
```

`csv`:
```csv
nodeId,name,qualifiedName,label,filePath,startLine,rank
42,authenticate,auth.authenticate,Function,src/auth/index.ts,42,0.95
15,validateToken,AuthController.validateToken,Method,src/controllers/auth.ts,15,0.87
8,authMiddleware,authMiddleware,Function,src/middleware/auth.ts,8,0.72
```

## Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CODE_ANALYZER_DATA_DIR` | `string` | `~/.code-analyzer/data` | Data directory for SQLite databases |
| `CODE_ANALYZER_LOG_LEVEL` | `string` | `info` | Log level (debug, info, warn, error, silent) |
| `CODE_ANALYZER_DEFAULT_LANGUAGE` | `string` | auto | Default programming language for analysis |
| `CODE_ANALYZER_MAX_FILE_SIZE` | `string` | `1mb` | Maximum file size to analyze |
| `CODE_ANALYZER_IGNORE_PATTERNS` | `string` | — | Comma-separated glob patterns to ignore |

### Configuration File

Place a `.code-analyzerrc.json` in your project root for persistent configuration:

```json
{
  "language": "typescript",
  "ignore": ["node_modules", "dist", ".git", "coverage"],
  "maxFileSize": "2mb",
  "analysis": {
    "includeTests": false,
    "includeDocs": false,
    "extractComments": true
  },
  "search": {
    "defaultLimit": 30,
    "fuzzyMatch": true
  }
}
```

Configuration is resolved in this order (last wins):

1. Default values
2. `.code-analyzerrc.json` in project root
3. `.code-analyzerrc.json` in home directory
4. Environment variables (`CODE_ANALYZER_*`)
5. CLI flags

## Advanced Usage

### Pre-Commit Hooks

#### Option 1 — Husky + lint-staged (Recommended for JavaScript/TypeScript projects)

Install husky and lint-staged:

```bash
npm install --save-dev husky lint-staged
npx husky init
```

Add to `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": [
      "code-analyzer search --format json --label Function '.' | jq -e '.items | length > 0' && echo 'Code analysis: OK'"
    ],
    "*.{py}": [
      "code-analyzer analyze --language python --force .",
      "code-analyzer search --format json 'TODO|FIXME|HACK' | jq -e '.items | length == 0' || echo 'WARNING: TODO markers found'"
    ],
    "*.{go}": [
      "code-analyzer analyze --language go --force .",
      "code-analyzer search --format json --label Function 'deprecated' | jq -e '.items | length == 0' && echo 'No deprecated usage found'"
    ]
  }
}
```

Edit `.husky/pre-commit`:

```bash
#!/bin/sh
# Husky pre-commit hook for Code Analyzer

echo "=== Code Analyzer Pre-commit Check ==="

# Quick analysis of staged files
code-analyzer analyze --force . 2>&1 | grep -E "(nodes|edges|completed)"

# Check for debug statements
DEBUG_COUNT=$(code-analyzer search --format json "console\.(log|debug|warn)" 2>/dev/null | jq '.total // 0')
if [ "$DEBUG_COUNT" -gt 0 ]; then
  echo "⚠️  Found $DEBUG_COUNT console.* statements in staged files"
  echo "   Consider removing before committing"
fi

# Check for leftover conflict markers
CONFLICT_COUNT=$(code-analyzer search --format json "<<<<<<<|>>>>>>>|=======" 2>/dev/null | jq '.total // 0')
if [ "$DEBUG_COUNT" -gt 0 ]; then
  echo "❌ Found $CONFLICT_COUNT git conflict markers. Resolve conflicts first."
  exit 1
fi

echo "=== Pre-commit check passed ==="
npx lint-staged
```

#### Option 2 — Raw Git Hooks

```bash
#!/bin/bash
# .git/hooks/pre-commit — Code Analyzer pre-commit hook

set -e

echo "Running Code Analyzer pre-commit checks..."

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

# Only run if source files are staged
if echo "$STAGED_FILES" | grep -qE '\.(ts|tsx|js|jsx|py|go|java|kt|cs|rs)$'; then
  echo "  ${#STAGED_FILES[@]} source files staged — running analysis..."

  # Incremental analysis (fast path — only changed files)
  code-analyzer analyze --force . > /dev/null 2>&1

  # Security: Check for hardcoded secrets
  if code-analyzer search --format json "password|secret|api_key|token" 2>/dev/null | \
     jq -e '.items | length > 0' > /dev/null 2>&1; then
    echo "❌ SECURITY: Potential hardcoded credentials detected"
    echo "   Run: code-analyzer search 'password|secret|api_key|token' --format text"
    exit 1
  fi

  # Code smell: Check for TODO markers (soft warning)
  TODO_COUNT=$(code-analyzer search --format json "TODO" 2>/dev/null | jq '.total // 0')
  if [ "$TODO_COUNT" -gt 5 ]; then
    echo "⚠️  WARNING: $TODO_COUNT TODO markers found (threshold: 5)"
  fi

  # Complexity: Check for functions over 50 lines (approximate)
  echo "  ✓ Pre-commit analysis complete"
else
  echo "  No source files staged — skipping analysis"
fi

echo "✓ Code Analyzer pre-commit checks passed"
```

#### Option 3 — Husky commit-msg Hook (Enforce Conventional Commits)

Edit `.husky/commit-msg`:

```bash
#!/bin/sh
# Validate commit message against conventional commit format

COMMIT_MSG=$(cat "$1")
PATTERN='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .{1,72}'

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
  echo "❌ Invalid commit message format"
  echo "   Expected: type(scope): description"
  echo "   Example:  feat(auth): add JWT token validation"
  echo "   Run code-analyzer to review your changes first."
  exit 1
fi
```

---

### CI/CD Integration

#### GitHub Actions — PR Review One-Liner

```yaml
name: Code Analyzer PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - name: Run Code Analyzer Review
        run: npx @code-analyzer/cli review pr --repo . --pr ${{ github.event.pull_request.number }} --token ${{ secrets.GITHUB_TOKEN }} --format markdown > review.md
      - name: Post Review as Comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('review.md', 'utf8');
            await github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: report,
            });
```

#### GitHub Actions — Standards Check One-Liner

```yaml
name: Standards Check
on: [push]

jobs:
  standards:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx @code-analyzer/cli analyze --project-id ${GITHUB_REPOSITORY##*/} . 2>&1
      - run: npx @code-analyzer/cli standards check --standard typescript-best-practices 2>&1 | tee standards-report.txt
      - name: Annotate findings
        if: failure()
        run: |
          while IFS= read -r line; do
            FILE=$(echo "$line" | cut -d: -f1)
            LINE=$(echo "$line" | cut -d: -f2)
            MSG=$(echo "$line" | cut -d: -f3-)
            echo "::warning file=$FILE,line=$LINE::$MSG"
          done < <(grep '^src/' standards-report.txt)
```

#### GitHub Actions — Scheduled Health Report

```yaml
name: Weekly Code Health Report
on:
  schedule:
    - cron: '0 8 * * 1'  # Every Monday at 8 AM
  workflow_dispatch:      # Manual trigger

jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx @code-analyzer/cli report generate --repo . --format html --output code-health.html
      - run: npx @code-analyzer/cli report recommend --format md --output recommendations.md
      - run: npx @code-analyzer/cli report trends --repo . --days 7 --format json > trends.json
      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: code-health-report
          path: |
            code-health.html
            recommendations.md
            trends.json
```

#### GitLab CI — One-Liner

```yaml
stages:
  - analyze

analyze:
  stage: analyze
  image: node:22
  before_script:
    - npm install -g @code-analyzer/cli
  script:
    # One-line analysis + search
    - code-analyzer analyze --project-id $CI_PROJECT_NAME . && code-analyzer search --format json "deprecated|unsafe|TODO" > findings.json
  artifacts:
    paths:
      - findings.json
    expire_in: 7 days

review:
  stage: analyze
  image: node:22
  only:
    - merge_requests
  before_script:
    - npm install -g @code-analyzer/cli
  script:
    - code-analyzer review --diff 2>&1 | tee review-report.txt
  artifacts:
    reports:
      codequality: review-report.txt
```

#### GitLab CI — Merge Request Decoration

```yaml
mr-review:
  stage: analyze
  image: node:22
  only:
    - merge_requests
  before_script:
    - npm install -g @code-analyzer/cli
    - code-analyzer analyze --project-id $CI_PROJECT_NAME .
  script:
    # Post review findings as MR notes
    - |
      code-analyzer search --format json "TODO|FIXME" 2>/dev/null | \
      jq -r '.items[] | "::warning file=\(.filePath),line=\(.startLine)::[\(.label)] \(.name)"'
```

#### Bitbucket Pipelines

```yaml
# bitbucket-pipelines.yml
pipelines:
  pull-requests:
    '**':
      - step:
          name: Code Analyzer Review
          image: node:22
          script:
            - npm install -g @code-analyzer/cli
            - code-analyzer analyze --project-id $BITBUCKET_REPO_SLUG .
            # One-liner: search for code smells and fail on critical issues
            - code-analyzer search --format json "password|secret|private_key" 2>/dev/null | jq -e '.items | length == 0' || (echo "❌ Hardcoded secrets found" && exit 1)
            - code-analyzer review --diff 2>&1 | tee review.txt
          artifacts:
            - review.txt

  branches:
    main:
      - step:
          name: Weekly Health Report
          image: node:22
          script:
            - npm install -g @code-analyzer/cli
            - code-analyzer report generate --repo . --format html --output health-report.html
            - code-analyzer report recommend --format md --output recs.md
          artifacts:
            - health-report.html
            - recs.md
```

#### Jenkins Pipeline (Declarative)

```groovy
pipeline {
    agent { docker { image 'node:22' } }
    environment {
        CODE_ANALYZER_DATA_DIR = '/tmp/code-analyzer'
    }
    stages {
        stage('Install') {
            steps {
                sh 'npm install -g @code-analyzer/cli'
            }
        }
        stage('Index') {
            steps {
                sh 'code-analyzer analyze --project-id ${JOB_NAME} --force .'
            }
        }
        stage('Search Anti-Patterns') {
            steps {
                sh '''
                    code-analyzer search --format json "console.log" > console-statements.json
                    code-analyzer search --format json "any" > anys.json
                    code-analyzer search --format json "TODO" > todos.json
                '''
            }
        }
        stage('Report') {
            steps {
                sh 'code-analyzer report generate --repo . --format html --output report.html'
            }
        }
        stage('Quality Gate') {
            steps {
                script {
                    def todoCount = sh(
                        script: "cat todos.json | jq '.total'",
                        returnStdout: true
                    ).trim().toInteger()
                    if (todoCount > 10) {
                        error("TODO count ($todoCount) exceeds threshold (10)")
                    }
                }
            }
        }
        stage('Archive') {
            steps {
                archiveArtifacts artifacts: '*.json, report.html'
            }
        }
    }
}
```

---

### Shell Scripting Patterns

#### Watch Mode — Re-analyze on File Changes

Requires `fswatch` (macOS) or `inotifywait` (Linux):

```bash
#!/bin/bash
# watch-analyze.sh — re-analyze on every file save

echo "Watching for changes... (Ctrl+C to stop)"

if command -v fswatch &> /dev/null; then
  # macOS
  fswatch -o src/ | while read -r; do
    clear
    echo "=== $(date '+%H:%M:%S') ==="
    code-analyzer analyze --force . 2>&1 | tail -3
  done
elif command -v inotifywait &> /dev/null; then
  # Linux
  inotifywait -m -r -e modify src/ | while read -r; do
    clear
    echo "=== $(date '+%H:%M:%S') ==="
    code-analyzer analyze --force . 2>&1 | tail -3
  done
else
  echo "Install fswatch (macOS) or inotify-tools (Linux) for watch mode"
  exit 1
fi
```

#### Batch Processing — Analyze All Repos in a Directory

```bash
#!/bin/bash
# batch-analyze.sh — analyze every repo in a directory

REPOS_DIR="${1:-./repos}"
REPORT_DIR="./batch-reports"

mkdir -p "$REPORT_DIR"

echo "Scanning $REPOS_DIR..."
find "$REPOS_DIR" -maxdepth 2 -name '.git' | while read -r gitdir; do
  repo=$(dirname "$gitdir")
  name=$(basename "$repo")
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Analyzing: $name"
  echo "═══════════════════════════════════════════"

  # Index the repo
  code-analyzer analyze --project-id "$name" "$repo" 2>&1 | tail -1

  # Run a standard suite of searches
  code-analyzer search --project "$name" --format json "export" > "$REPORT_DIR/${name}_exports.json"
  code-analyzer search --project "$name" --format json "deprecated" > "$REPORT_DIR/${name}_deprecated.json"
  code-analyzer search --project "$name" --format json "TODO\|FIXME\|HACK" > "$REPORT_DIR/${name}_todos.json"

  # Quick stats
  EXPORTS=$(jq '.total' "$REPORT_DIR/${name}_exports.json")
  TODOS=$(jq '.total' "$REPORT_DIR/${name}_todos.json")
  echo "  Exports: $EXPORTS | TODOs: $TODOS"
done

echo ""
echo "═══ Batch Analysis Complete ═══"
echo "Reports: $REPORT_DIR"
echo ""
echo "Summary:"
for f in "$REPORT_DIR"/*_todos.json; do
  name=$(basename "$f" _todos.json)
  printf "  %-30s TODOs: %s\n" "$name" "$(jq '.total' "$f")"
done
```

#### jq Processing — Advanced Data Analysis

```bash
# Find the top 10 most connected files (by symbol count)
code-analyzer search --format json --limit 1000 "." | \
  jq '
    [.items | group_by(.filePath) | .[] | {
      file: .[0].filePath,
      symbols: length,
      classes: [.[] | select(.label == "Class")] | length,
      functions: [.[] | select(.label == "Function")] | length,
      methods: [.[] | select(.label == "Method")] | length
    }]
    | sort_by(-.symbols)
    | .[:10]
  '

# Find duplicate function names across files
code-analyzer search --format json --label Function "." | \
  jq '
    [.items
      | group_by(.name)
      | .[]
      | select(length > 1)
      | {
          name: .[0].name,
          occurrences: length,
          files: [.[] | .filePath]
        }
    ]
    | sort_by(-.occurrences)
  '

# Generate a dependency matrix as CSV
code-analyzer search --format json --label Class "." | \
  jq -r '
    ["source_file", "class_name", "line"],
    (.items[] | [.filePath, .name, .startLine]) | @csv
  ' > class-index.csv

# Find classes with no tests (assuming test files follow *.test.ts pattern)
code-analyzer search --format json --label Class "." | \
  jq '[.items[] | select(.filePath | test("\\.test\\.") | not)] | .[:20]'

# Calculate average complexity by directory
code-analyzer search --format json "." | \
  jq '
    [.items
      | group_by(.filePath | split("/") | first)
      | .[]
      | {
          dir: .[0].filePath | split("/") | first,
          count: length,
          avgComplexity: ([.[].complexity // 0] | add) / length
        }
    ]
    | sort_by(-.avgComplexity)
  '
```

#### CI-Friendly Exit Codes — Fail on Findings

```bash
#!/bin/bash
# quality-gate.sh — fail if any critical issues found

set -eo pipefail

CRITICAL_PATTERNS=(
  "password\s*="
  "secret_key\s*="
  "private_key\s*="
  "console\.log"
  "debugger"
)

HAS_CRITICAL=0

for pattern in "${CRITICAL_PATTERNS[@]}"; do
  COUNT=$(code-analyzer search --format json "$pattern" 2>/dev/null | jq '.total // 0')
  if [ "$COUNT" -gt 0 ]; then
    echo "❌ CRITICAL: Found $COUNT matches for pattern: $pattern"
    HAS_CRITICAL=1
  fi
done

if [ "$HAS_CRITICAL" -eq 1 ]; then
  echo ""
  echo "Quality gate FAILED. Fix the above issues before merging."
  exit 1
fi

echo "✓ Quality gate passed — no critical issues found"
```

#### Monorepo-Aware Analysis Script

```bash
#!/bin/bash
# monorepo-analyze.sh — analyze packages independently

MONOREPO_ROOT="${1:-.}"
PACKAGES_DIR="$MONOREPO_ROOT/packages"

echo "=== Monorepo Code Analysis ==="
echo "Root: $MONOREPO_ROOT"
echo ""

for pkg in "$PACKAGES_DIR"/*/; do
  pkg_name=$(basename "$pkg")
  echo "── Analyzing package: $pkg_name ──"

  code-analyzer analyze \
    --project-id "$pkg_name" \
    --force \
    "$pkg" 2>&1 | \
    grep -E "(nodes|edges|completed|error)" || true

  # Find cross-package imports
  code-analyzer search \
    --project "$pkg_name" \
    --format json \
    "from '@$MONOREPO_ROOT" 2>/dev/null | \
    jq -r '.items[] | "  ↳ Imports from: \(.name)"' || true

  echo ""
done

echo "=== Monorepo Analysis Complete ==="
```

---

### Real Output Examples

#### `code-analyzer analyze` — Successful Index

```
$ code-analyzer analyze --project-id my-app ./src

Analyzing ./src...
  Language detected: TypeScript (v5.6)
  Files discovered:     247 (.ts, .tsx)
  Files parsed:          247 (100%)
  Parse time:            3.2s
  Symbols extracted:     4,821
    Functions:           1,203
    Methods:             892
    Classes:             156
    Interfaces:          89
    Modules:             247
    Routes:              42
    Components:          318
  Relationships mapped:  12,347
    CALLS:               6,201
    IMPORTS:             4,112
    EXTENDS:             234
    IMPLEMENTS:          412
  Graph nodes:           4,821
  Graph edges:           12,347
  FTS index built:       OK (247 documents)
  Total time:            5.8s

Project 'my-app' indexed successfully.
Data stored at: ~/.code-analyzer/data/my-app.db
```

#### `code-analyzer search` — Text Output

```
$ code-analyzer search --project my-app "authenticate"

Search results for "authenticate" in my-app:
  1. authenticate (Function)              src/auth/index.ts:42
     export async function authenticate(token: string): Promise<User>
  2. AuthController.validateToken (Method) src/controllers/auth.ts:15
     private validateToken(token: string): boolean
  3. authMiddleware (Function)             src/middleware/auth.ts:8
     export function authMiddleware(req: Request, res: Response, next: NextFunction)
  4. AuthService.verifyCredentials (Method) src/services/auth.ts:67
     async verifyCredentials(email: string, password: string): Promise<User | null>
  5. requireAuth (Function)               src/utils/guards.ts:23
     export function requireAuth(ctx: Context): asserts ctx is AuthenticatedContext

  Found 5 results (searched 4,821 nodes)
```

#### `code-analyzer search` — JSON Output (Piped)

```
$ code-analyzer search --project my-app --format json --limit 3 "auth" | jq

{
  "items": [
    {
      "nodeId": 142,
      "name": "authenticate",
      "qualifiedName": "auth.authenticate",
      "label": "Function",
      "filePath": "src/auth/index.ts",
      "startLine": 42,
      "endLine": 67,
      "rank": 0.98,
      "snippet": "export async function authenticate(token: string): Promise<User>"
    },
    {
      "nodeId": 215,
      "name": "validateToken",
      "qualifiedName": "AuthController.validateToken",
      "label": "Method",
      "filePath": "src/controllers/auth.ts",
      "startLine": 15,
      "endLine": 28,
      "rank": 0.87,
      "snippet": "private validateToken(token: string): boolean"
    },
    {
      "nodeId": 308,
      "name": "authMiddleware",
      "qualifiedName": "authMiddleware",
      "label": "Function",
      "filePath": "src/middleware/auth.ts",
      "startLine": 8,
      "endLine": 22,
      "rank": 0.72,
      "snippet": "export function authMiddleware(req: Request, res: Response, next: NextFunction)"
    }
  ],
  "total": 15,
  "returned": 3,
  "hasMore": true
}
```

#### `code-analyzer review` — Diff Review

```
$ code-analyzer review --diff

Code Analyzer — Diff Review Report
═══════════════════════════════════

  Files changed:    3
  Lines added:     +47
  Lines removed:   -12

  Findings:
  ─────────

  [WARNING] src/auth/login.ts:42
    New function `loginWithOAuth` has no input validation.
    Consider adding parameter validation or using a validation library.

  [WARNING] src/auth/login.ts:58
    Hardcoded string "https://auth.example.com" — use environment variable.

  [INFO] src/utils/helpers.ts:15
    New utility function `formatDate` — consider adding unit tests.

  [ERROR] src/services/api.ts:103
    `eval()` usage detected. This is a security risk. Use JSON.parse() or a proper parser instead.

  ═══════════════════════════════════
  Summary: 4 findings (1 error, 2 warnings, 1 info)
  Quality gate: FAILED (1 error)
```

#### `code-analyzer standards check` — Standards Report

```
$ code-analyzer standards check --standard typescript-best-practices

Code Analyzer — Standards Check
════════════════════════════════

  Standard:   typescript-best-practices
  Files checked: 247
  Rules:      23

  Compliance:
  ───────────

  ✅ prefer-const           247/247 pass
  ✅ no-any                 241/247 pass
  ⚠️  no-explicit-any        6 violations   (src/legacy/*)
  ✅ prefer-optional-chain  243/247 pass
  ✅ no-unused-vars         247/247 pass
  ✅ naming-convention      240/247 pass
  ⚠️  naming-convention      7 violations   (src/types/external.ts, src/utils/*)

  ═════════════════════════════════
  Result: 21/23 rules passing (91.3%)
  Threshold: 90% — PASSED
```

#### `code-analyzer report generate` — Health Summary

```
$ code-analyzer report generate --repo . --format html --output report.html

Code Analyzer — Codebase Health Report
══════════════════════════════════════

  Repository:    my-app
  Language:      TypeScript
  Analyzed at:   2025-07-21 14:32:00 UTC

  Metrics:
  ────────
  Total files:            247
  Total LOC:              42,318
  Total symbols:          4,821
  Avg complexity/file:    8.4
  Max complexity/file:    34  (src/auth/login.ts)
  Test coverage:          87%
  Deprecated APIs:        3
  Hotspots detected:      5

  Top 5 Hotspots:
  1. src/auth/login.ts            (complexity: 34, churn: 12/month)
  2. src/services/payment.ts      (complexity: 28, churn: 8/month)
  3. src/controllers/order.ts     (complexity: 26, churn: 15/month)
  4. src/utils/transformers.ts    (complexity: 24, churn: 3/month)
  5. src/api/middleware.ts         (complexity: 22, churn: 10/month)

  Recommendations:
  1. Break down src/auth/login.ts (34 complexity) into smaller functions
  2. Add unit tests for src/services/payment.ts (currently 45% coverage)
  3. Replace 3 deprecated API usages in src/legacy/

  Report written to: report.html
```

## Node Labels Reference

The knowledge graph supports the following node labels (38 total). Use the `--label` flag to filter searches:

| Category | Labels |
|----------|--------|
| **Structure** | `Project`, `Package`, `Folder`, `File`, `Module` |
| **OOP** | `Class`, `Interface`, `Enum`, `TypeAlias`, `Struct`, `Trait` |
| **Functions** | `Function`, `Method`, `Constructor`, `Property` |
| **Variables** | `Variable` |
| **Web** | `Route`, `Component` |
| **Tooling** | `Tool`, `Test`, `Config` |
| **Process** | `Process`, `Community`, `Event` |
| **Security** | `BasicBlock`, `DataSource`, `Sink` |
| **Cross-Repo** | `CrossRepoFunction`, `CrossRepoInterface`, `CrossRepoModule`, `Contract` |
| **Documentation** | `ADR` |
| **Infrastructure** | `InfraResource` |

## Supported Languages

The analyzer supports auto-detection for the following languages:

| Language | Flag |
|----------|------|
| TypeScript | `--language typescript` |
| JavaScript | `--language javascript` |
| Python | `--language python` |
| Go | `--language go` |
| Rust | `--language rust` |
| Java | `--language java` |
| C# | `--language csharp` |
| C++ | `--language cpp` |

## Package Dependencies

| Dependency | Description |
|------------|-------------|
| `@code-analyzer/shared` | Shared types and schemas |
| `@code-analyzer/core` | Core analysis engine interfaces |
| `@code-analyzer/infra` | Infrastructure layer (SQLite, logging) |
| `@code-analyzer/analyzer` | Static code analysis (tree-sitter parsing) |
| `@code-analyzer/intelligence` | AI-powered code intelligence |
| `@code-analyzer/mcp` | MCP server (for agent integration) |
| `commander` | CLI framework for argument parsing (^12.0.0) |

### Dev Dependencies

| Dependency | Description |
|------------|-------------|
| `typescript` | TypeScript compiler (^5.6.0) |
| `vitest` | Unit test runner (^2.1.0) |

## Architecture

### Source Layout

```
src/
└── index.ts                    # CLI entry point (Commander.js program)
```

The CLI is a thin wrapper around the core packages. The `index.ts` entry point:

1. Creates a `Commander` program named `code-analyzer`
2. Registers `analyze` and `search` subcommands
3. Delegates execution to `@code-analyzer/core` and `@code-analyzer/analyzer`
4. Outputs results to stdout with configurable formatting

### Execution Flow

```
$ code-analyzer analyze ./src
  │
  ▼
Commander.js parses arguments
  │
  ▼
@code-analyzer/core orchestrates analysis
  │
  ├── File discovery (glob patterns, .gitignore)
  ├── @code-analyzer/analyzer — Tree-sitter AST parsing
  │   ├── Symbol extraction (functions, classes, etc.)
  │   ├── Relationship detection (calls, imports, etc.)
  │   └── Metric calculation (complexity, lines, etc.)
  ├── @code-analyzer/infra — SqliteStore persistence
  │   ├── Node storage with FTS5 indexing
  │   ├── Edge storage for relationships
  │   └── Graph traversal (BFS/DFS)
  └── @code-analyzer/intelligence — AI analysis
      ├── Pattern detection
      ├── Anti-pattern identification
      └── Recommendation generation
  │
  ▼
Formatted output to stdout
```

## Comparison with @code-analyzer/mcp and @code-analyzer/server

| Feature | `@code-analyzer/cli` | `@code-analyzer/mcp` | `@code-analyzer/server` |
|---------|---------------------|---------------------|------------------------|
| **Interface** | Terminal commands | MCP protocol | HTTP REST API |
| **Target User** | Developers, CI/CD | AI coding agents | Web apps, SDKs |
| **Transport** | stdin/stdout | stdio / HTTP+SSE | HTTP |
| **Use Case** | Scripting, automation | Agent-assisted coding | Programmatic integration |
| **State** | Stateless commands | Stateful server | Stateful server |
| **Concurrency** | Single invocation | Multi-agent | Multi-client |

## License

MIT

## Links

- [Code Analyzer Documentation](./docs/)
- [Contributing Guide](./CONTRIBUTING.md)
- [Commander.js Documentation](https://github.com/tj/commander.js)
