# Scenario Guides

> Task-based guides for common Code Analyzer workflows. Each guide shows a complete end-to-end flow.

---

## 1. Reviewing a Pull Request

**Goal:** Automatically review every pull request against project standards and security rules, posting findings as comments.

### Step 1: Configure GitHub Integration

Create a `.github/workflows/code-review.yml` file:

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
          node-version: 20

      - name: Install Code Analyzer
        run: npm install -g @code-analyzer/cli

      - name: Index repository
        run: code-analyzer analyze . --languages typescript

      - name: Review PR
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          code-analyzer review pr \
            --repo . \
            --pr ${{ github.event.pull_request.number }} \
            --token $GITHUB_TOKEN \
            --standard typescript-best-practices \
            --standard security-baseline \
            --format markdown \
            --output review-report.md

      - name: Post review summary
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('review-report.md', 'utf8');
            await github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: report,
            });
```

### Step 2: Set Up Webhook (Optional)

For faster feedback, set up a webhook that triggers analysis on push events. Configure in your repository settings under Webhooks → Add webhook:

- **Payload URL:** `https://your-server.com/api/webhooks/github`
- **Content type:** `application/json`
- **Events:** `Pull requests`

### Step 3: Review Output

When a PR is opened or updated, Code Analyzer:

1. Checks out the PR branch
2. Builds/updates the knowledge graph diffs
3. Runs all configured standards checks
4. Runs security scanners (secrets, taint, SAST)
5. Runs heuristic rules (complexity, naming, error handling)
6. Posts findings as inline comments and a summary

### Expected Output

Each finding includes:

- **Severity:** critical, high, medium, low
- **Category:** security, performance, maintainability, style, architecture
- **Location:** exact file path and line number
- **Description:** what the issue is
- **Suggestion:** how to fix it

See also: [MCP PR Review tools](mcp-tool-reference.md#3-pr-review-4-tools)

---

## 2. Analyzing a Monorepo

**Goal:** Analyze a multi-package monorepo with cross-package dependency visibility.

### Step 1: Configure Multi-Package Setup

Create `.code-analyzerrc.yaml` in the monorepo root:

```yaml
project:
  name: my-monorepo
  languages:
    - typescript

analysis:
  skipDirectories:
    - node_modules
    - dist
    - .turbo
  maxFileSize: 5242880

# Define packages as separate projects for targeted analysis
monorepo:
  packages:
    - name: frontend
      path: packages/frontend
    - name: backend
      path: packages/backend
    - name: shared
      path: packages/shared
  crossPackageAnalysis: true
```

### Step 2: Index Each Package

```bash
# Index all packages
code-analyzer analyze packages/frontend --project-id frontend
code-analyzer analyze packages/backend --project-id backend
code-analyzer analyze packages/shared --project-id shared

# Or index the entire monorepo at once
code-analyzer analyze . --project-id monorepo
```

### Step 3: Map Cross-Package Dependencies

```bash
# See what packages depend on each other
code-analyzer search --cypher "
  MATCH (p1:Package)-[:IMPORTS]->(p2:Package)
  RETURN p1.name AS consumer, p2.name AS dependency
  ORDER BY consumer
"

# Find all usage of shared package
code-analyzer search "shared/utils" --project-id monorepo
```

### Step 4: Cross-Repo Impact Analysis

```bash
# If I change shared package, what breaks?
code-analyzer analyze_cross_repo_impact \
  --symbol "shared/types" \
  --repo-group monorepo
```

**Expected output** shows which packages consume each shared module and the blast radius of proposed changes.

See also: [Cross-Repo MCP tools](mcp-tool-reference.md#13-cross-repo-2-tools)

---

## 3. Security Audit

**Goal:** Run a comprehensive security scan and produce an actionable remediation report.

### Step 1: Configure Security Scanners

```yaml
security:
  scanners:
    - secrets # Hardcoded API keys, tokens, passwords
    - taint # Data flow from user input to dangerous sinks
    - dependencies # Known vulnerabilities in dependencies
  severity: medium # Flag medium and above
```

### Step 2: Run the Audit

```bash
# Full security audit
code-analyzer audit_security . --format json --output security-report.json

# Focus on specific vulnerability classes
code-analyzer audit_security . \
  --cwe-filter CWE-89,CWE-79,CWE-22,CWE-352,CWE-502 \
  --severity high \
  --format markdown \
  --output security-report.md
```

### Step 3: Interpret CWE Findings

| CWE         | Name                     | Common Location         | Remediation                   |
| ----------- | ------------------------ | ----------------------- | ----------------------------- |
| **CWE-89**  | SQL Injection            | Database query builders | Use parameterized queries     |
| **CWE-79**  | Cross-Site Scripting     | HTML rendering          | Apply output encoding         |
| **CWE-22**  | Path Traversal           | File operations         | Validate and sanitize paths   |
| **CWE-352** | CSRF                     | Form handlers           | Add CSRF tokens               |
| **CWE-502** | Insecure Deserialization | Data parsing            | Validate before deserializing |

### Step 4: Taint Analysis

For deeper analysis, trace the flow of user input to dangerous functions:

```bash
# Find taint paths from request handlers to file system operations
code-analyzer search --cypher "
  MATCH path = (src)-[:TAINTED|TAINT_PATH*]->(sink:Sink)
  WHERE src.name CONTAINS 'req'
  RETURN path
  LIMIT 20
"
```

### Step 5: Remediation

Generate a prioritized fix list:

```bash
# Filter by critical only
jq '.findings[] | select(.severity == "critical")' security-report.json

# Generate a remediation plan
jq '{critical: [.summary.critical], high: [.summary.high], remediations: [.remediations[]]}' security-report.json
```

See also: [Security MCP tools](mcp-tool-reference.md#12-security-2-tools)

---

## 4. Architecture Exploration

**Goal:** Use Cypher queries to understand the structure of an unfamiliar codebase.

### Step 1: Get High-Level Overview

```bash
code-analyzer explore_architecture . --level overview
```

This produces a summary of modules, layers, and key entry points.

### Step 2: Map Module Dependencies

```cypher
-- Which modules import from which?
MATCH (m1:Module)-[:IMPORTS]->(m2:Module)
RETURN m1.filePath AS from, m2.filePath AS to
ORDER BY from, to
LIMIT 50
```

### Step 3: Find Circular Dependencies

```cypher
-- Detect import cycles
MATCH cycle = (m1:Module)-[:IMPORTS*2..5]->(m1)
RETURN [n IN nodes(cycle) | n.filePath] AS cycle_path
LIMIT 10
```

### Step 4: Analyze Class Hierarchy

```cypher
-- Map the full inheritance tree
MATCH (child:Class)-[:EXTENDS*]->(parent:Class)
WHERE NOT (parent)-[:EXTENDS]->()
RETURN parent.name AS root, child.name AS derived
ORDER BY root
```

### Step 5: Find Untested Critical Code

```cypher
-- Functions with high complexity and no tests
MATCH (f:Function)
WHERE NOT (t:Test)-[:TESTS]->(f)
  AND f.complexity > 10
RETURN f.name, f.complexity, f.filePath
ORDER BY f.complexity DESC
LIMIT 20
```

### Step 6: Identify API Entry Points

```cypher
-- All HTTP routes and their handlers
MATCH (handler)-[:HANDLES_ROUTE]->(route:Route)
RETURN route.method, route.path, handler.name, handler.filePath
ORDER BY route.path
```

See also: [Querying & Exploration tools](mcp-tool-reference.md#1-querying--exploration-10-tools)

---

## 5. CI/CD Integration

**Goal:** Integrate Code Analyzer into your CI/CD pipeline with quality gates and automated feedback.

### GitHub Actions: Quality Gate

```yaml
name: Code Quality Gate
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install -g @code-analyzer/cli

      - name: Index and analyze
        run: code-analyzer analyze . --format json --output analysis.json

      - name: Security audit
        run: |
          code-analyzer audit_security . \
            --severity high \
            --format json \
            --output security.json

      - name: Quality gate
        run: |
          CRITICAL=$(jq '.findings[] | select(.severity == "critical") | length' security.json)
          HIGH_COMPLEXITY=$(jq '.nodes[] | select(.complexity > 20) | length' analysis.json)

          if [ "$CRITICAL" -gt 0 ]; then
            echo "::error::Found $CRITICAL critical security issues"
            exit 1
          fi

          if [ "$HIGH_COMPLEXITY" -gt 5 ]; then
            echo "::warning::$HIGH_COMPLEXITY files exceed complexity threshold"
          fi

  pr-review:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install -g @code-analyzer/cli

      - name: PR Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          code-analyzer review pr \
            --repo . \
            --pr ${{ github.event.pull_request.number }} \
            --standard typescript-coding \
            --standard security-baseline \
            --format markdown \
            --output review.md

      - name: Post results as PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.readFileSync('review.md', 'utf8');
            await github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body,
            });
```

### GitLab CI

```yaml
code-analysis:
  image: node:20
  script:
    - npm install -g @code-analyzer/cli
    - code-analyzer analyze .
    - code-analyzer audit_security . --severity high --format json --output security.json
    - code-analyzer review diff --from-ref $CI_MERGE_REQUEST_DIFF_BASE_SHA
  artifacts:
    reports:
      codequality: security.json
  only:
    - merge_requests
```

### Quality Gate Thresholds

| Metric                   | Warning | Error | Blocks Merge |
| ------------------------ | ------- | ----- | :----------: |
| Critical security issues | >= 1    | >= 1  |     Yes      |
| High security issues     | >= 3    | >= 5  |     Yes      |
| File complexity > 20     | >= 5    | >= 10 |      No      |
| Test coverage < 40%      | Yes     | —     |      No      |

---

## 6. AI Agent Integration

**Goal:** Set up Code Analyzer as a knowledge base for AI coding agents (Claude Code, Cursor, Windsurf).

### Step 1: Index Your Codebase

The AI agent needs a knowledge graph to query:

```bash
code-analyzer analyze . --project-id my-app
```

### Step 2: Auto-Configure Agent

```bash
code-analyzer agent detect
code-analyzer agent configure
```

This detects Claude Desktop, Cursor, Windsurf, Cline, and Continue, then configures each with the MCP server connection.

### Step 3: Verify Agent Can Use Tools

After restarting your AI agent, verify tool access:

**Claude Code / Claude Desktop:**

```
List the projects indexed by Code Analyzer.
```

Claude should call `list_projects` and return your indexed projects.

**Cursor:**

```
Use code-analyzer to find all authentication-related code in this project.
```

Cursor should call `search_code` or `query_cypher`.

**Windsurf:**

```
Explore the architecture of this project using code-analyzer.
```

Windsurf should call `explore_architecture`.

### Step 4: Common Agent Workflows

| Task            | Agent Command                         | Tools Called                             |
| --------------- | ------------------------------------- | ---------------------------------------- |
| Code search     | "Find where JWT tokens are generated" | `search_code`                            |
| PR review       | "Review PR #42 for security issues"   | `pr_review`                              |
| Impact analysis | "What happens if I rename getUser?"   | `analyze_impact`, `find_references`      |
| Security audit  | "Scan for hardcoded secrets"          | `scan_secrets`, `audit_security`         |
| Architecture    | "Show me the dependency graph"        | `explore_architecture`, `query_cypher`   |
| Refactoring     | "Find code smells in the auth module" | `detect_code_smells`, `suggest_refactor` |

### Step 5: Manual Configuration (if auto-detect fails)

For **Claude Desktop**, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "/absolute/path/to/your/project"
      }
    }
  }
}
```

For **Cursor**, create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["-y", "@code-analyzer/mcp"],
      "env": {
        "CODE_ANALYZER_PROJECT_DIR": "${workspaceFolder}",
        "CODE_ANALYZER_MCP_TOOL_PROFILE": "analysis"
      }
    }
  }
}
```

For detailed per-client setup, see the [Getting Started - MCP Setup](getting-started.md#setting-up-mcp-for-ai-agents).

### Step 6: Optimizing for AI Agents

- **Pre-index project** before connecting the agent to avoid warm-up delays.
- **Use `analysis` tool profile** (28 tools) if the full 45-tool list is noisy.
- **Pin `CODE_ANALYZER_PROJECT_DIR`** to an absolute path for desktop agents.
- **Enable incremental indexing** for ongoing development: `code-analyzer reindex_project my-app`.

---

## See Also

- [Getting Started](getting-started.md) — Installation and first steps
- [MCP Tool Reference](mcp-tool-reference.md) — All 45 MCP tools documented
- [Configuration Reference](configuration-reference.md) — Full options reference
- [Troubleshooting](troubleshooting.md) — Common issues and fixes
