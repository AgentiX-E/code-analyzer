# Contributing to Code Analyzer

Thank you for your interest in contributing to Code Analyzer! This guide will help you get set up and understand our development workflow.

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **Git**

## Getting Started

```bash
# Clone the repository
git clone https://github.com/AgentiX-E/code-analyzer.git
cd code-analyzer

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Project Structure

```
code-analyzer/
├── .github/            # GitHub Actions workflows
├── .vscode/            # VS Code workspace settings
├── docs/               # Documentation
├── packages/           # Monorepo packages
│   ├── cli/            # CLI entry point and commands
│   ├── core/           # Domain models and abstractions
│   ├── shared/         # Shared types and utilities
│   ├── infra/          # Storage, Git, file system adapters
│   ├── analyzer/       # Language analysis engine
│   ├── intelligence/   # Search, embeddings, code review
│   ├── mcp/            # MCP server (Model Context Protocol)
│   ├── server/         # HTTP REST API
│   ├── vscode/         # VS Code extension
│   └── web/            # Web dashboard
├── scripts/            # Build and utility scripts
├── tests/              # Test suites
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   ├── e2e/            # End-to-end tests
│   └── property/       # Property-based tests
├── eslint.config.mjs   # ESLint configuration (flat config)
├── tsconfig.base.json  # Shared TypeScript configuration
├── turbo.json          # Turborepo pipeline
└── vitest.config.ts    # Unit test configuration
```

### Package Architecture

The codebase follows a **seven-layer architecture** where each layer can only depend on layers below it:

1. **Foundation** (`@code-analyzer/core`, `@code-analyzer/shared`) — types, config, logging
2. **Infrastructure** (`@code-analyzer/infra`) — storage, Git, file system
3. **Analysis Engine** (`@code-analyzer/analyzer`) — parsing, resolution, graphs
4. **Intelligence** (`@code-analyzer/intelligence`) — search, embeddings, review
5. **Service** (`@code-analyzer/server`, `@code-analyzer/mcp`) — APIs and MCP
6. **Integration** — CI/CD adapters
7. **Presentation** (`@code-analyzer/cli`, `@code-analyzer/vscode`, `@code-analyzer/web`)

## Development Workflow

### Running Tasks

```bash
# Build all packages
pnpm build

# Build with dependency graph awareness (recommended)
pnpm turbo build

# Run type checking
pnpm typecheck

# Run linting
pnpm lint

# Format code
pnpm format

# Check formatting
pnpm format:check
```

### Testing

```bash
# Run all tests
pnpm test

# Run only unit tests
pnpm test:unit

# Run integration tests
pnpm test:integration

# Run property-based tests
pnpm test:property

# Run end-to-end tests
pnpm test:e2e

# Run tests with coverage
pnpm vitest run --coverage
```

### Test Categories

- **Unit tests** — Reside in `packages/*/src/**/*.test.ts`. Test individual functions/modules in isolation. Fast, no I/O.
- **Integration tests** — Reside in `tests/integration/`. Test interactions between packages. May use SQLite or file system.
- **Property-based tests** — Reside in `tests/property/`. Use `fast-check` to verify invariants with random inputs.
- **E2E tests** — Reside in `tests/e2e/`. Full CLI or server tests exercising the complete pipeline.

### Coverage Thresholds

Unit tests must meet strict coverage thresholds:

| Metric     | Threshold |
|------------|-----------|
| Lines      | 95%       |
| Branches   | 90%       |
| Functions  | 95%       |
| Statements | 95%       |

Barrel files (`src/index.ts`) are excluded from coverage as they are covered by consumer tests.

## Coding Standards

### TypeScript

- All code is written in **TypeScript** with **strict mode** enabled
- No `any` types outside of test files
- Prefer explicit types over inference when it improves readability
- Use `tsx` for files containing JSX/TSX
- Exported APIs must have JSDoc comments

### Naming Conventions

| Convention | Usage |
|------------|-------|
| `PascalCase` | Classes, interfaces, types, enums |
| `camelCase` | Variables, functions, methods, properties |
| `UPPER_SNAKE_CASE` | Constants and enum members |
| `kebab-case` | File names, package names |

### Import Order

Imports are enforced by ESLint in this order with blank lines between groups:

1. Built-in modules (`fs`, `path`)
2. External packages (`vitest`, `fast-check`)
3. Internal workspace packages (`@code-analyzer/core`)
4. Relative imports (`./utils`, `../types`)
5. Type imports

### Linting

We use ESLint 9 with flat config and `@typescript-eslint` strict-type-checked rules.

Key rules:
- **No unused variables** — prefix with `_` to explicitly mark as unused
- **No `console.log`** — use `console.warn` and `console.error` for diagnostics
- **No `any`** — use `unknown` or proper types instead
- **Strict null checks** — enabled at TypeScript level

### Formatting

We use **Prettier** for consistent formatting:

- Semicolons: always
- Quotes: single
- Trailing commas: all
- Print width: 100
- Tab width: 2

```bash
pnpm format        # Auto-format all files
pnpm format:check  # Check formatting in CI
```

## Commit Conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Description                                      |
|------------|--------------------------------------------------|
| `feat`     | A new feature                                    |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation changes                            |
| `style`    | Formatting, missing semicolons, etc.             |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                          |
| `test`     | Adding or updating tests                         |
| `chore`    | Maintenance tasks, dependency updates            |
| `ci`       | CI/CD changes                                    |
| `build`    | Build system or external dependency changes      |

### Scopes

Use the package name as the scope (e.g., `analyzer`, `cli`, `intelligence`, `mcp`).
For cross-cutting changes, use `deps`, `config`, or omit the scope.

### Examples

```
feat(analyzer): add TypeScript decorator support
fix(mcp): handle large response limits correctly
docs: update contributing guidelines
chore(deps): bump typescript to 5.7
test(intelligence): add vector search benchmarks
```

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. **Write code** following our [Coding Standards](#coding-standards)
3. **Add tests** for new functionality. Ensure existing tests pass.
4. **Run the full CI pipeline locally** before pushing:

   ```bash
   pnpm turbo build lint test typecheck
   pnpm format:check
   ```

5. **Write a descriptive PR** following the template:
   - What does this PR do?
   - Which packages are affected?
   - Breaking changes?
   - How to test?

6. **Request review** from a maintainer

7. **Address feedback** and wait for CI to pass

8. **Squash and merge** once approved

### PR Checklist

- [ ] TypeScript compiles without errors
- [ ] ESLint passes with zero warnings
- [ ] All tests pass (unit, integration, property-based)
- [ ] Prettier formatting passes
- [ ] New code has appropriate test coverage
- [ ] Breaking changes are documented in changeset
- [ ] Commit messages follow conventional commits

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

```bash
# Create a changeset for your changes
pnpm changeset
```

Follow the prompts to select affected packages and describe the change.

## Questions?

- Open a [GitHub Discussion](https://github.com/AgentiX-E/code-analyzer/discussions)
- Join our community chat (link coming soon)

---

Thank you for contributing to Code Analyzer!
