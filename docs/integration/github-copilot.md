# GitHub Copilot Integration

## Overview

GitHub Copilot is the most widely used AI coding assistant. Code Analyzer enhances Copilot with deep code intelligence through MCP integration.

## Quick Setup

```bash
npm install -g @code-analyzer/cli
code-analyzer setup --agent github-copilot
```

## Manual Configuration

Create `.github/copilot/mcp.json` in your project root:

```json
{
  "servers": {
    "code-analyzer": {
      "type": "stdio",
      "command": "npx",
      "args": ["@code-analyzer/mcp"]
    }
  }
}
```

Commit this file to your repository so all contributors get the integration automatically.

## VS Code Chat Participant

The `@code-analyzer` VS Code extension adds Copilot Chat integration with these slash commands:

| Command | Description |
|---|---|
| `@code-analyzer /review` | Review the current file or changes |
| `@code-analyzer /explain` | Explain code structure or behavior |
| `@code-analyzer /impact` | Analyze change impact |
| `@code-analyzer /find <query>` | Search for symbols or patterns |
| `@code-analyzer /deps` | Show dependency relationships |
| `@code-analyzer /refactor <target>` | Suggest refactoring opportunities |
| `@code-analyzer /test` | Generate test suggestions |

## Copilot Workspace Integration

For GitHub Copilot Workspace (browser-based), add to your repository's `.github/copilot/mcp.json`:

```json
{
  "servers": {
    "code-analyzer": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@code-analyzer/mcp",
        "--format", "markdown",
        "--severity", "warning"
      ]
    }
  }
}
```

## Configuration Options

### `.github/copilot-instructions.md`

Copilot reads this file for project-specific instructions. Add:

```markdown
## Code Analyzer

When reviewing code, use the code-analyzer MCP tools to:
1. Check for security vulnerabilities (CWE coverage)
2. Verify code follows project standards
3. Analyze the impact of changes on dependent modules
4. Search for existing patterns and conventions before suggesting new code

Always use `search_codebase` before creating new utility functions — 
they might already exist in the codebase.
```

## GitHub Action Integration

Add Code Analyzer to your CI pipeline:

```yaml
- uses: Lambertyan/code-analyzer-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    severity: warning
    fail-on: error
```

## Verification

In VS Code Copilot Chat:

> `@code-analyzer /explain the architecture of this project`

Or in any file:

> `@code-analyzer /review`

## Team Setup

For teams, commit `.github/copilot/mcp.json` to your repository:

```bash
git add .github/copilot/mcp.json
git commit -m "Add Code Analyzer MCP config for Copilot"
git push
```

All team members with Copilot will automatically get Code Analyzer integration.

## Troubleshooting

- **Chat participant not showing**: Install the VS Code extension: `@code-analyzer/vscode`
- **MCP tools not available**: Check `.github/copilot/mcp.json` exists and has valid JSON
- **Performance**: For large monorepos, add `--mode moderate` to the args
- **GitHub Enterprise**: Works with GitHub Enterprise Server when using compatible Copilot version
