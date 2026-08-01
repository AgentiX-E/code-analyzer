# Code Review & PR Review

> Automated code review with 50+ deterministic rules, 8-lens multi-agent swarm, cross-repo impact analysis, and customizable project standards.

## Overview

Code Analyzer provides a comprehensive code review system spanning three scopes:

| Scope | Engine | Description |
|-------|--------|-------------|
| **File-level** | `CodeReviewEngine` | Review individual files for quality, security, and maintainability |
| **PR-level** | `PRReviewEngine` | Review pull requests with diff analysis, standards checking, and impact assessment |
| **Cross-repo** | `CrossRepoPRReviewEngine` | Review PRs with cross-repository impact analysis and API breaking change detection |

## Review Pipeline

The `CodeReviewEngine` implements a four-phase pipeline:

```
Git Diff → [Plan] → [Analyze] → [Filter] → [Relocate] → Review Comments
```

### Phase 1: Plan
Analyzes the diff to determine review strategy:
- File type analysis (language detection, test file identification)
- Size-based risk assessment (>200 lines flagged as high-complexity)
- Change type analysis (additions, deletions, renames)
- Focus area generation (checklist of things to review)

### Phase 2: Analyze
Runs heuristic analysis on the diff content:
- Builds graph analysis data from the knowledge graph
- Detects circular dependencies via DFS cycle detection
- Runs 50+ deterministic rules across 6 categories

### Phase 3: Filter
Removes noise from review results:
- Empty code context comments
- Invalid line range comments
- Style comments on comment-only lines

### Phase 4: Relocate
Adjusts comment line numbers to map from diff ranges to post-change file positions.

## Rule Categories

| Category | Count | Examples |
|----------|-------|----------|
| **Security** | 10 | SQL injection, XSS, hardcoded secrets, command injection, path traversal, unsafe deserialization, weak crypto, insecure random, HTTP URLs, debug statements |
| **Correctness** | 6 | Undefined variables, duplicate imports, unreachable code, constant conditions, empty catch blocks, unsafe optional chaining |
| **Performance** | 6 | Large array copies, inefficient regex, loop await, redundant computation, blocking operations, N+1 queries |
| **Maintainability** | 8 | Max function lines (50), max parameters (5), max nesting (4), cyclomatic complexity (10), magic numbers, TODOs, dead code, god classes |
| **Style** | 8 | Consistent naming, early returns, trailing whitespace, console.log, consistent quotes, line length, spacing, enum naming |
| **Architecture** | 5 | Circular dependencies, layer violations, barrel exports, module size, cross-boundary access |

## PR Review

The `PRReviewEngine` extends code review with PR-specific analysis:

```typescript
import { PRReviewEngine } from '@code-analyzer/intelligence';

const engine = new PRReviewEngine(store);
const result = await engine.reviewPR(
  'org/repo',
  { number: 42, title: 'Add login', ... },
  diffs,
);
```

**Output includes:**
- Per-file review comments with severity and suggestions
- Overall review summary with risk assessment
- Merge recommendation based on aggregate findings
- Actionable recommendations prioritized by impact

## Cross-Repo PR Review

The `CrossRepoPRReviewEngine` adds cross-repository awareness:

```typescript
import { CrossRepoPRReviewEngine } from '@code-analyzer/intelligence';

const engine = new CrossRepoPRReviewEngine(indexer, groupManager, reviewEngine);
const result = await engine.reviewPRWithCrossRepoContext(
  pr,           // Pull request object
  'my-group',   // Repo group ID
  'org/repo-a', // Source repository
  diffs,        // Parsed git diffs
);
```

**Additional analysis:**
1. **Cross-Repo Impact**: BFS traversal (depth 3) along `CROSS_REPO_*` edges
2. **API Breaking Changes**: 8 types detected (removed, renamed, signature_changed, type_changed, visibility_changed, return_type_changed, parameter_added_required, parameter_removed)
3. **Test Impact**: Identifies test files in other repos affected by PR changes
4. **Version Compatibility**: Reads `package.json`/`go.mod` across repos to detect version conflicts

**Output categories:**
| Field | Description |
|-------|-------------|
| `apiBreakingChanges` | API changes that break downstream consumers |
| `crossRepoImpact` | Dependencies affected across repository boundaries |
| `dependencyCompatibility` | Version mismatches across repositories |
| `reviewIssues` | Standard code review findings |
| `testImpact` | Test files in other repos that need updating |
| `summary` | Risk level, merge recommendation, actionable items |

## Review Swarm (8-Lens Multi-Agent)

The `ReviewSwarm` runs 8 specialized review lenses concurrently:

| Lens | Focus | Pattern Examples |
|------|-------|-----------------|
| **Security** | CWE-aligned vulnerability detection | SQL injection, XSS, auth bypass, data exposure |
| **Performance** | Runtime efficiency | N+1 queries, memory leaks, blocking I/O, missing caching |
| **Testing** | Test coverage and quality | Missing assertions, flaky patterns, test isolation, mocking quality |
| **Maintainability** | Long-term code health | God classes, long methods, deep nesting, high coupling |
| **Architecture** | Structural integrity | Layer violations, circular deps, missing abstractions, SRP violations |
| **Documentation** | Code clarity | Missing JSDoc, unclear names, stale comments, TODO tracking |
| **Accessibility** | WCAG-aligned a11y checks | Missing ARIA labels, color contrast, keyboard navigation |
| **Dependency** | Supply chain & package health | Outdated deps, known vulnerabilities, license issues |

```typescript
import { ReviewSwarm } from '@code-analyzer/intelligence';

const swarm = new ReviewSwarm({ maxConcurrency: 8 });
const result = await swarm.review({ diffs, graphData });
// result.summary.decision: 'approve' | 'request_changes' | 'comment'
// result.actionItems: prioritized fix list
```

## Standards Engine

Enforce project-specific standards with 10 built-in templates:

| Template | Checks |
|----------|--------|
| `typescript-strict` | no-any, strict null checks, explicit return types |
| `react-best-practices` | Hook rules, key props, effect cleanup |
| `api-design` | RESTful conventions, error handling, versioning |
| `security-baseline` | Auth patterns, input validation, encryption |
| `testing-standards` | Coverage thresholds, naming conventions |
| `monorepo-hygiene` | Package boundaries, shared deps, circular deps |
| `database-practices` | Migration patterns, query optimization |
| `error-handling` | Try/catch coverage, error propagation |
| `logging-standards` | Structured logging, log levels, PII redaction |
| `microservices` | Service boundaries, API contracts, retry patterns |

```typescript
import { StandardsEngine } from '@code-analyzer/intelligence';

const engine = new StandardsEngine();
const report = await engine.computeDetailedComplianceReport(
  'src/user-service.ts',
  fileContent,
  { templates: ['typescript-strict', 'security-baseline'] },
);
```

## CLI Usage

```bash
# Review a file
code-analyzer review src/auth.ts

# Review with severity filter
code-analyzer review src/ --severity error

# Review in markdown format
code-analyzer review src/ --format markdown

# Review with max issues limit
code-analyzer review . --max-issues 100

# Review git diff (uncommitted changes)
code-analyzer review --mode diff

# Review specific severity levels only
code-analyzer review src/ --severity critical

# JSON output for CI integration
code-analyzer review src/ --format json
```

## VS Code Usage

### Copilot Chat Slash Commands

| Command | Description |
|---------|-------------|
| `/review` | Review current file or workspace changes |
| `/explain <symbol>` | Explain a symbol with knowledge graph context |
| `/impact <symbol>` | Show impact of changing a symbol |
| `/find <query>` | Semantic search across the codebase |
| `/deps <symbol>` | Show dependency graph for a symbol |
| `/refactor <symbol>` | Find refactoring opportunities |
| `/test <symbol>` | Find related tests and coverage gaps |

### Review on Save

The VS Code extension automatically reviews supported files on save (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) and displays findings as inline diagnostics and CodeLens actions.

## MCP Tools

| Tool | Description |
|------|-------------|
| `review_diff` | Review a git diff with full pipeline analysis |
| `review_file` | Review a single file with standards checking |
| `review_pr` | Full PR review with optional cross-repo analysis |
| `check_standards` | Check file against project standards |
| `cross_repo_review_pr` | Cross-repo PR review with impact analysis |
| `generate_report` | Generate review report in multiple formats |
| `list_review_sessions` | List past review sessions |
| `get_review_session` | Get a specific review session detail |
