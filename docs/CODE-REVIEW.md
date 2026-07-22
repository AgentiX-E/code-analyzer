# Code Review Guide

> Comprehensive guide to automated code review with Code Analyzer — PR review workflow, standards engine, impact analysis, session management, and CI/CD integration.

> **Alpha Status**: The code review engine currently uses a heuristic-based approach with rule-driven analysis (function size, nesting depth, naming conventions, etc.). The four-phase pipeline (Plan → Analyze → Filter → Relocate) is implemented, but the analysis phase relies on local heuristic rules rather than an LLM backend. LLM integration for deeper semantic analysis is planned for a future release. The MCP tools `review_pr`, `review_diff`, and `review_file` currently return placeholder data — the heuristic engine works directly via the programmatic API. See [MCP-SERVER.md](MCP-SERVER.md) for tool implementation status.

---

## PR Review Workflow

Code Analyzer implements a four-phase code review pipeline:

```
Git Diff → [Plan] → [Analyze] → [Filter] → [Relocate] → Review Comments
```

### Phase 1: Plan

Analyzes the diff to determine review strategy:

- **File type identification**: Detects TypeScript, test files, API routes, etc.
- **Size analysis**: Flags large files (>200 lines) as high-complexity risk
- **Change type detection**: Identifies deletions, renames, and their implications
- **Focus area generation**: Creates a checklist of review priorities
- **Complexity estimation**: Classifies each file as `low`, `medium`, or `high`

### Phase 2: Analyze

Runs heuristic analysis on the diff content (LLM integration is planned for deeper semantic review):

- Builds graph analysis data (out-degree, in-degree, exported symbols)
- Detects circular dependencies via DFS cycle detection
- Applies heuristic rules: function size, nesting depth, naming conventions
- Generates review comments with severity, category, and suggestions

### Phase 3: Filter

Removes noise from review comments:

| Filter Rule | Rationale |
|-------------|-----------|
| Empty code context | Comments on empty code are meaningless |
| Invalid line ranges | Comments with non-positive line numbers are invalid |
| Style comments on comment lines | Style issues on lines that are only comments |

### Phase 4: Relocate

Maps diff line numbers to post-change file line numbers:

- Computes cumulative offset from all diff ranges
- Clamps line numbers to valid range
- Ensures comments reference correct locations in the new file

---

## Review Comment Structure

Each review comment includes:

```typescript
interface ReviewComment {
  id: string;              // Unique comment identifier
  path: string;            // File path
  content: string;         // Review feedback text
  suggestionCode?: string; // Suggested fix code
  existingCode: string;    // Current code being reviewed
  startLine: number;       // Starting line number
  endLine: number;         // Ending line number
  thinking?: string;       // Reviewer reasoning
  category: ReviewCategory; // Issue category
  severity: Severity;      // Issue severity
  filtered: boolean;       // Whether filtered out
  createdAt: string;       // Timestamp
}
```

### Review Categories

| Category | Description |
|----------|-------------|
| `bug` | Potential bugs or logic errors |
| `security` | Security vulnerabilities |
| `performance` | Performance issues |
| `maintainability` | Code maintainability concerns |
| `test` | Test coverage or quality issues |
| `style` | Code style violations |
| `documentation` | Missing or inadequate documentation |
| `architecture` | Architectural concerns |
| `other` | Other issues |

### Severity Levels

| Severity | Description | Example |
|----------|-------------|---------|
| `critical` | Must be fixed before merge | Security vulnerability, data loss risk |
| `high` | Should be fixed before merge | Broken error handling, logic error |
| `medium` | Should be addressed soon | Function too long, deep nesting |
| `low` | Nice to have | Style improvement, minor cleanup |
| `info` | Informational only | Suggested optimization, alternative approach |

---

## Standards Engine

> **Alpha Status**: The standards engine architecture is designed but not yet functional. The 10 built-in templates are defined but rule execution returns empty results. The MCP tool `check_standards` returns placeholder data. This section documents the planned design.

Code Analyzer includes a standards engine with 10 built-in templates planned for implementation and support for custom project standards.

### 10 Built-in Templates

| Standard ID | Name | Category | Language |
|-------------|------|----------|----------|
| `typescript-coding` | TypeScript Coding Standards | `code-style` | TypeScript |
| `python-pep8` | Python PEP8 Standards | `code-style` | Python |
| `go-idiomatic` | Go Idiomatic Standards | `code-style` | Go |
| `security-baseline` | Security Baseline | `security` | Any |
| `api-design` | API Design Standards | `api-design` | Any |
| `testing-standards` | Testing Standards | `testing` | Any |
| `error-handling` | Error Handling Standards | `error-handling` | Any |
| `documentation` | Documentation Standards | `documentation` | Any |
| `architecture-layered` | Architecture Layered Standards | `architecture` | Any |
| `dependency-management` | Dependency Management Standards | `dependency` | Any |

### Rule Check Types

| Check Type | Description | Example |
|------------|-------------|---------|
| `regex` | Regular expression pattern matching | Detect `console.log`, hardcoded secrets |
| `metric` | Numeric threshold checks | Function line count, nesting depth |
| `ast-pattern` | AST-based structural checks | Missing docstrings, unused imports |
| `graph-query` | Knowledge graph queries | Circular dependencies, upward imports |
| `llm-check` | LLM-based semantic checks | Complex logic review, intent analysis |

### Standards Check Result

```typescript
interface StandardsCheckResult {
  standardId: string;         // Which standard was checked
  ruleResults: RuleCheckResult[]; // Per-rule results
  complianceScore: number;    // 0-100 overall score
  filesChecked: number;       // Number of files checked
  summary: {
    critical: number;         // Critical violations count
    high: number;             // High violations count
    medium: number;           // Medium violations count
    low: number;              // Low violations count
    info: number;             // Info-level findings count
    passed: number;           // Rules that passed
  };
  duration: number;           // Check duration in ms
}
```

### Custom Project Standards

Define custom standards in your project:

```typescript
import { StandardsEngine } from '@code-analyzer/intelligence';

const engine = new StandardsEngine();

engine.registerStandard({
  id: 'my-team-standards',
  name: 'My Team Standards',
  version: '1.0.0',
  category: 'custom',
  description: 'Team-specific coding conventions',
  rules: [
    {
      id: 'no-todo-without-ticket',
      description: 'TODOs must reference a ticket number',
      checkType: 'regex',
      checkConfig: {
        pattern: '// TODO(?!\\s*\\()',  // No ticket reference
        flags: 'g',
      },
      severity: 'medium',
      autoFixable: false,
      fixSuggestion: 'Add ticket reference: // TODO(TICKET-123): description',
    },
  ],
  examples: [
    {
      description: 'TODO with ticket reference',
      compliant: true,
      code: '// TODO(TICKET-123): Fix edge case for empty input',
    },
    {
      description: 'TODO without ticket',
      compliant: false,
      code: '// TODO: Fix this later',
      explanation: 'Missing ticket reference.',
    },
  ],
});

// Check files against the custom standard
const result = engine.checkFiles(files, 'my-team-standards');
console.log(`Compliance score: ${result.complianceScore}%`);
```

---

## Impact Analysis & Blast Radius

> **Alpha Status**: Impact analysis is designed but not yet implemented. The MCP tools `impact_analysis` and `detect_changes` return placeholder data. This section documents the planned design.

The `ImpactAnalyzer` (`packages/intelligence/src/impact/impact-analyzer.ts`) is designed to determine the blast radius of code changes.

### How It Works

1. **Resolve changed symbols** to graph node IDs
2. **BFS traversal** over CALLS, IMPLEMENTS, EXTENDS, MEMBER_OF edges (configurable depth, default: 3)
3. **Find affected tests** via TESTS edges
4. **Find affected routes** via Route nodes and HANDLES_ROUTE edges
5. **Find affected processes** via Process nodes and STEP_IN_PROCESS edges
6. **Compute risk score** from weighted factors

### Risk Score Weights

| Factor | Weight | Description |
|--------|--------|-------------|
| Changed symbols | 30% | Number and severity of changes |
| Impact breadth | 25% | Number of impacted nodes |
| Process impact | 20% | Affected business processes |
| File count | 15% | Number of changed files |
| Change magnitude | 10% | Total symbols changed |

### Risk Levels

| Level | Criteria |
|-------|----------|
| `critical` | Blocked processes OR 20+ impacted nodes |
| `high` | 10-19 impacted nodes OR critical symbol risk |
| `medium` | 5-9 impacted nodes OR high symbol risk |
| `low` | <5 impacted nodes |

### Estimated Effort

| Level | Criteria |
|-------|----------|
| `high` | Risk score >= 70 OR 20+ impacted nodes OR 10+ affected tests |
| `medium` | Risk score >= 40 OR 10+ impacted nodes |
| `low` | All other cases |

---

## Session Management

Code Analyzer tracks review sessions for resumability and caching.

### Session Lifecycle

```
[startSession] → [recordItemDone] × N → [completed]
     │                                        │
     └──── [buildResumeState] ←───────────────┘
```

### Session Store Features

- **Fingerprinting**: Files are fingerprinted to detect changes between sessions
- **Resume support**: Skip already-reviewed files on subsequent runs
- **Comment reuse**: Previously generated comments are preserved for unchanged files
- **Mode support**: `diff` mode (PR reviews) and `scan` mode (full codebase scans)

### Session Configuration

```typescript
const reviewEngine = new CodeReviewEngine(store, {
  maxTokens: 8000,         // Max tokens per review item
  maxToolCalls: 10,        // Max tool calls per review
  planLineThreshold: 200,  // Threshold for "large file" classification
  timeout: 30000,          // Per-item timeout (ms)
  concurrency: 4,          // Concurrent review items
});
```

---

## CI/CD Integration

> **Alpha Status**: CI workflow files are created but not yet tested end-to-end. The examples below illustrate the planned usage.

### GitHub Actions — PR Review

```yaml
name: Code Review
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

      - name: Install and Index
        run: |
          npm install -g @code-analyzer/cli
          code-analyzer analyze . --languages typescript,python

      - name: Review PR
        run: |
          code-analyzer review pr \
            --repo . \
            --pr ${{ github.event.pull_request.number }} \
            --token ${{ secrets.GITHUB_TOKEN }} \
            --format markdown \
            --output review-report.md

      - name: Check Standards
        run: |
          code-analyzer standards check \
            --repo . \
            --standard typescript-coding \
            --standard security-baseline \
            --format json \
            --output standards-report.json

      - name: Post Results
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('review-report.md', 'utf8');
            const standards = JSON.parse(fs.readFileSync('standards-report.json', 'utf8'));

            let body = report + '\n\n## Standards Compliance\n\n';
            for (const s of standards) {
              body += `- **${s.standardId}**: ${s.complianceScore}% compliance\n`;
            }

            github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body,
            });
```

---

## Best Practices

### 1. Review in CI, not just locally

Run code review on every PR to catch issues before they reach review. Use severity thresholds to control when to block merges.

### 2. Layer standards by severity

Start with `critical` and `high` severity standards that block merges. Gradually add `medium` and `low` standards as the team adapts.

### 3. Use session resumption for large PRs

Enable session store persistence to skip already-reviewed files on re-runs. This is critical for PRs with many iterations.

### 4. Configure per-language standards

Different languages need different standards. Use `typescript-coding` for TypeScript files, `python-pep8` for Python, and `security-baseline` for all languages.

### 5. Review impact before merging

Always run impact analysis before merging changes to shared modules or core libraries. The blast radius may surprise you.

### 6. Monitor review metrics

Track review comments over time:
- **Comment volume**: Are we generating too many comments? Tighten filters.
- **Resolution rate**: Are comments being addressed? Adjust severity levels.
- **False positive rate**: Are comments accurate? Refine heuristic rules.

### 7. Combine with human review

Automated review is a complement, not a replacement. Use it to catch mechanical issues (style, security patterns) so humans can focus on design and intent.

---

## See Also

- [ARCHITECTURE.md](ARCHITECTURE.md) — Review engine architecture and pipeline details
- [MCP-SERVER.md](MCP-SERVER.md) — MCP tools for code review (`review_pr`, `review_diff`, `check_standards`)
- [CONFIGURATION.md](CONFIGURATION.md) — Review configuration options
- [language-support.md](language-support.md) — Per-language analysis capabilities
