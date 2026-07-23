# Code Analyzer GitHub Action

AI-powered code review and analysis for pull requests. Automatically reviews your PRs for code quality issues, security vulnerabilities, architectural concerns, and adherence to project standards.

## Features

- **Automated PR Review**: Runs on every PR, posting a detailed review comment
- **Multi-Language Support**: TypeScript, JavaScript, Python, Go, Java, Kotlin, C#, Rust
- **Configurable Standards**: Define project-specific rules via a standards JSON file
- **Severity-Based Filtering**: Control which findings appear and when to fail CI
- **Artifact Export**: Review findings available as downloadable JSON artifacts
- **Knowledge Graph Analysis**: Cross-file impact analysis powered by Code Analyzer's graph engine

## Usage

### Basic

```yaml
name: PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/code-analyzer-action
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### With Custom Standards

```yaml
- uses: ./.github/actions/code-analyzer-action
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    standards: '.github/code-analyzer/standards.json'
    severity: 'warning'
    fail-on: 'critical'
```

### Strict Mode (Fail on Warning)

```yaml
- uses: ./.github/actions/code-analyzer-action
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    severity: 'info'
    fail-on: 'warning'
```

### Language-Specific Analysis

```yaml
- uses: ./.github/actions/code-analyzer-action
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    languages: 'typescript,python'
```

## Inputs

| Name | Description | Required | Default |
|------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | `${{ github.token }}` |
| `standards` | Path to project standards JSON file | No | `.code-analyzer/standards.json` |
| `severity` | Minimum severity level to report | No | `warning` |
| `fail-on` | Severity level that fails the check | No | `error` |
| `max-files` | Maximum files to analyze per PR | No | `100` |
| `exclude-patterns` | Glob patterns to exclude (comma-separated) | No | `**/node_modules/**,**/dist/**,**/*.min.*` |
| `languages` | Languages to analyze (empty = auto-detect) | No | `''` |

### Severity Levels

| Level | Description |
|-------|-------------|
| `info` | Informational notes, suggestions |
| `warning` | Potential issues, best practice violations |
| `error` | Definite problems that should be fixed |
| `critical` | Security vulnerabilities, architectural flaws |

## Outputs

| Name | Description |
|------|-------------|
| `findings` | JSON string of all review findings |
| `summary` | Markdown summary suitable for PR comments |

## Finding Format

Each finding in the JSON output follows this structure:

```json
{
  "file": "src/auth/login.ts",
  "line": 42,
  "severity": "error",
  "category": "security",
  "rule": "no-hardcoded-secrets",
  "message": "Hardcoded API key detected",
  "suggestion": "Use environment variables or a secrets manager",
  "confidence": 0.95
}
```

## Project Standards

Create a `.code-analyzer/standards.json` file in your repository to define custom rules:

```json
{
  "rules": {
    "no-hardcoded-secrets": { "severity": "critical", "enabled": true },
    "max-function-length": { "params": { "max": 50 }, "severity": "warning" },
    "require-null-checks": { "severity": "error", "enabled": true }
  },
  "excluded": ["**/generated/**", "**/vendor/**"],
  "languageDefaults": {
    "typescript": { "strict": true },
    "python": { "maxLineLength": 100 }
  }
}
```

## Permissions

The action requires these permissions in your workflow:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
  checks: write
```

## License

MIT — see the [main repository](https://github.com/Lambertyan/code-analyzer) for details.
