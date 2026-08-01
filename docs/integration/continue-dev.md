# Continue.dev Integration

## Overview

Continue.dev is the open-source AI code assistant. Code Analyzer integrates via MCP stdio transport.

## Quick Setup

```bash
npm install -g @code-analyzer/cli
code-analyzer setup --agent continue-dev
```

## Manual Configuration

Edit `~/.continue/config.json` and add under `mcpServers`:

```json
{
  "mcpServers": [
    {
      "name": "code-analyzer",
      "command": "npx",
      "args": ["@code-analyzer/mcp"]
    }
  ]
}
```

Note: Continue.dev uses an **array** format for MCP servers, different from other agents.

## Features

| Tool | Use Case |
|---|---|
| `search_codebase` | Full-text and semantic search |
| `review_changes` | Review current workspace changes |
| `analyze_impact` | Predict change impact |
| `get_architecture` | View project structure |
| `find_references` | Find all references to a symbol |

## Continue.dev-Specific Features

### Custom Slash Commands

Add to `~/.continue/config.json`:

```json
{
  "slashCommands": [
    {
      "name": "review",
      "description": "Review current changes",
      "prompt": "Use code-analyzer MCP tools to review all changed files"
    },
    {
      "name": "explain-arch",
      "description": "Explain project architecture",
      "prompt": "Use code-analyzer MCP tools to explain the project architecture"
    }
  ]
}
```

### Rules Integration

Continue.dev supports `.continuerc.json` for project-level rules:

```json
{
  "rules": {
    "code-analyzer": {
      "autoReview": true,
      "severity": "warning",
      "ignorePatterns": ["**/test/**", "**/vendor/**"]
    }
  }
}
```

## Verification

In Continue.dev chat:

> "Review this file for potential issues"

The response should include structured findings from Code Analyzer.

## Troubleshooting

- **MCP server array format**: Continue uses `"mcpServers": [...]` (array), not `{...}` (object)
- **Server not starting**: Check `~/.continue/logs/` for error messages
- **Tools not available**: Restart Continue after modifying config.json
