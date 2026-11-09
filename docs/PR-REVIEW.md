# Code Review & PR Review

> Automated code review with 70+ deterministic rules, 8-lens multi-agent swarm, cross-repo impact analysis, and customizable project standards.

## Overview

Code Analyzer provides a comprehensive code review system spanning three scopes:

| Scope          | Engine                    | Description                                                                        |
| -------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| **File-level** | `CodeReviewEngine`        | Review individual files for quality, security, and maintainability                 |
| **PR-level**   | `PRReviewEngine`          | Review pull requests with diff analysis, standards checking, and impact assessment |
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
- Runs 70+ deterministic rules across 6 categories

### Phase 3: Filter

Removes noise from review results:

- Empty code context comments
- Invalid line range comments
- Style comments on comment-only lines

### Phase 4: Relocate

Adjusts comment line numbers to map from diff ranges to post-change file positions.

### Phase 5: Order (LLM lane findings)

**A review is read from the top and abandoned part-way through, so the order is part of the product.** The LLM review
engine scores each finding on six terms computed from the patch and the finding alone — whether the range covers an
added line, whether the suggestion names an action, whether the finding quotes added code, whether it names an
identifier the diff touches, how many lanes independently reported it, and its severity and lane prior — and returns
the comments in that order.

```ts
const engine = new LLMReviewEngine(provider);
const comments = await engine.reviewDiffRanked(diff, patch); // ordered
const unordered = await engine.reviewDiffAsComments(diff); // the previous behaviour
```

**Nothing is dropped by the ordering.** A finding the ranking places last is still in the array, because a filter that
silently removes comments is a different feature with a different failure mode; the reader can stop reading at any
point. The score, the six terms and the reasons behind a low one are exported from
`@code-analyzer/intelligence` as `weighFinding` / `rankFindings`, and `docs/EVAL-CONTRACT.md` §6 records the emission
rule the benchmark scores.

**What the ordering is measured on**: `benchmarks/aacr-bench.json` scores it against a direct competitor on the
competitor's own public corpus, with the top-k curve published beside the operating point.

### Phase 6: Scope (one review per pull request)

**A review is a comment on a pull request, not a comment on a file, and the difference is not bookkeeping.** A field
renamed in one file and still read in another is invisible to a review that reads one file at a time; so is a contract
broken at a call site, and so is a migration whose reader was not updated. **Those are the defects a pull request has
that a file does not.**

```ts
const engine = new LLMReviewEngine(provider);
const sections = splitByFile(patch); // [{ path, diffText }, …], one per `diff --git` section
const results = await engine.reviewPullRequest(sections, { maxFindingsPerPullRequest: 16 });
// every finding carries `path` — the file it is about, validated against the files the call showed
```

**Four things this scope enforces that the file scope cannot:**

| rule                                | what it prevents                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| a path on every finding             | a finding filed against a file the model never chose; counted as `missingPath` instead of defaulted        |
| the path must be one that was shown | a finding about a file outside the pull request; counted as `unknownPath` and dropped rather than re-filed |
| ranges judged against its own file  | two files both have a line 10, so one flat set of hunk ranges answers a question nobody asked              |
| dedup keyed on the finding's path   | two files each with an unfixed null check becoming one comment on whichever file was read first            |

**And a budget instead of a per-file cap.** Three findings per file per lane over 199 files is 995 answers; three
findings per pull request per lane over five pull requests is 25. **The first emits 183 findings and the second 15**, and
the second's precision is **twice** the first's at the same emission — which is why the scope is a product decision and
not only an architecture one. The full arithmetic, the registered prediction and the curve are in
`docs/EVAL-CONTRACT.md` §7.

**The file scope is not deprecated.** `reviewDiff` is what an editor integration or a pre-commit hook needs, and a
pull request that touches two hundred files is exactly where a per-file review is the cheaper unit. **The engine offers
both and the caller picks**, which is why the benchmark job runs both arms on the same corpus against the same goldens.

## Rule Categories

| Category            | Count | Examples                                                                                                                                                    |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Security**        | 10    | SQL injection, XSS, hardcoded secrets, command injection, path traversal, unsafe deserialization, weak crypto, insecure random, HTTP URLs, debug statements |
| **Correctness**     | 6     | Undefined variables, duplicate imports, unreachable code, constant conditions, empty catch blocks, unsafe optional chaining                                 |
| **Performance**     | 6     | Large array copies, inefficient regex, loop await, redundant computation, blocking operations, N+1 queries                                                  |
| **Maintainability** | 8     | Max function lines (50), max parameters (5), max nesting (4), cyclomatic complexity (10), magic numbers, TODOs, dead code, god classes                      |
| **Style**           | 8     | Consistent naming, early returns, trailing whitespace, console.log, consistent quotes, line length, spacing, enum naming                                    |
| **Architecture**    | 5     | Circular dependencies, layer violations, barrel exports, module size, cross-boundary access                                                                 |

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
  pr, // Pull request object
  'my-group', // Repo group ID
  'org/repo-a', // Source repository
  diffs, // Parsed git diffs
);
```

**Additional analysis:**

1. **Cross-Repo Impact**: BFS traversal (depth 3) along `CROSS_REPO_*` edges
2. **API Breaking Changes**: 8 types detected (removed, renamed, signature_changed, type_changed, visibility_changed, return_type_changed, parameter_added_required, parameter_removed)
3. **Test Impact**: Identifies test files in other repos affected by PR changes
4. **Version Compatibility**: Reads `package.json`/`go.mod` across repos to detect version conflicts

**Output categories:**

| Field                     | Description                                        |
| ------------------------- | -------------------------------------------------- |
| `apiBreakingChanges`      | API changes that break downstream consumers        |
| `crossRepoImpact`         | Dependencies affected across repository boundaries |
| `dependencyCompatibility` | Version mismatches across repositories             |
| `reviewIssues`            | Standard code review findings                      |
| `testImpact`              | Test files in other repos that need updating       |
| `summary`                 | Risk level, merge recommendation, actionable items |

## Review Swarm (8-Lens Multi-Agent)

The `ReviewSwarm` runs 8 specialized review lenses concurrently:

| Lens                | Focus                               | Pattern Examples                                                      |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| **Security**        | CWE-aligned vulnerability detection | SQL injection, XSS, auth bypass, data exposure                        |
| **Performance**     | Runtime efficiency                  | N+1 queries, memory leaks, blocking I/O, missing caching              |
| **Testing**         | Test coverage and quality           | Missing assertions, flaky patterns, test isolation, mocking quality   |
| **Maintainability** | Long-term code health               | God classes, long methods, deep nesting, high coupling                |
| **Architecture**    | Structural integrity                | Layer violations, circular deps, missing abstractions, SRP violations |
| **Documentation**   | Code clarity                        | Missing JSDoc, unclear names, stale comments, TODO tracking           |
| **Accessibility**   | WCAG-aligned a11y checks            | Missing ARIA labels, color contrast, keyboard navigation              |
| **Dependency**      | Supply chain & package health       | Outdated deps, known vulnerabilities, license issues                  |

```typescript
import { ReviewSwarm } from '@code-analyzer/intelligence';

const swarm = new ReviewSwarm({ maxConcurrency: 8 });
const result = await swarm.review({ diffs, graphData });
// result.summary.decision: 'approve' | 'request_changes' | 'comment'
// result.actionItems: prioritized fix list
```

## Standards Engine

Enforce project-specific standards with 10 built-in templates:

| Template               | Checks                                            |
| ---------------------- | ------------------------------------------------- |
| `typescript-strict`    | no-any, strict null checks, explicit return types |
| `react-best-practices` | Hook rules, key props, effect cleanup             |
| `api-design`           | RESTful conventions, error handling, versioning   |
| `security-baseline`    | Auth patterns, input validation, encryption       |
| `testing-standards`    | Coverage thresholds, naming conventions           |
| `monorepo-hygiene`     | Package boundaries, shared deps, circular deps    |
| `database-practices`   | Migration patterns, query optimization            |
| `error-handling`       | Try/catch coverage, error propagation             |
| `logging-standards`    | Structured logging, log levels, PII redaction     |
| `microservices`        | Service boundaries, API contracts, retry patterns |

```typescript
import { StandardsEngine } from '@code-analyzer/intelligence';

const engine = new StandardsEngine();
const report = await engine.computeDetailedComplianceReport('src/user-service.ts', fileContent, {
  templates: ['typescript-strict', 'security-baseline'],
});
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

| Command              | Description                                   |
| -------------------- | --------------------------------------------- |
| `/review`            | Review current file or workspace changes      |
| `/explain <symbol>`  | Explain a symbol with knowledge graph context |
| `/impact <symbol>`   | Show impact of changing a symbol              |
| `/find <query>`      | Semantic search across the codebase           |
| `/deps <symbol>`     | Show dependency graph for a symbol            |
| `/refactor <symbol>` | Find refactoring opportunities                |
| `/test <symbol>`     | Find related tests and coverage gaps          |

### Review on Save

The VS Code extension automatically reviews supported files on save (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) and displays findings as inline diagnostics and CodeLens actions.

## MCP Tools

| Tool                   | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `review_diff`          | Review a git diff with full pipeline analysis    |
| `review_file`          | Review a single file with standards checking     |
| `review_pr`            | Full PR review with optional cross-repo analysis |
| `check_standards`      | Check file against project standards             |
| `cross_repo_review_pr` | Cross-repo PR review with impact analysis        |
| `generate_report`      | Generate review report in multiple formats       |
| `list_review_sessions` | List past review sessions                        |
| `get_review_session`   | Get a specific review session detail             |
