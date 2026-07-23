# Cursor Integration

## Overview

Cursor is the AI-first code editor. Code Analyzer integrates via MCP stdio transport.

## Quick Setup

```bash
npm install -g @code-analyzer/cli
code-analyzer setup --agent cursor
```

## Manual Configuration

Create or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@code-analyzer/mcp"]
    }
  }
}
```

Restart Cursor after adding the configuration.

## What You Get

| Feature | How to Use |
|---|---|
| **Code Review** | `@code-analyzer /review` or ask Cursor to review a file |
| **Code Search** | `@code-analyzer /find <symbol>` |
| **Architecture View** | `@code-analyzer /explain architecture` |
| **Impact Analysis** | `@code-analyzer /impact <file>` |
| **Dependency Graph** | `@code-analyzer /deps <file>` |

## Cursor-Specific Features

Code Analyzer detects Cursor-specific config files:
- `.cursorrules` — project rules that influence analysis
- `.cursor/rules/` — directory of rule files

### Project Standards

Create `.code-analyzer/standards.json` to define custom review rules:

```json
{
  "name": "My Project Standards",
  "rules": [
    {
      "id": "no-console-log",
      "category": "quality",
      "severity": "warning",
      "pattern": "console\\.log\\(",
      "message": "Avoid console.log in production code"
    }
  ]
}
```

## Configuration

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": [
        "@code-analyzer/mcp",
        "--standards", ".code-analyzer/standards.json"
      ]
    }
  }
}
```

## Verification

In Cursor's AI chat, type:

> `@code-analyzer /explain the project structure`

The Code Analyzer participant should appear and provide a structured response.

## Troubleshooting

- **Chat participant not appearing**: Restart Cursor after adding the MCP config
- **Slow indexing**: Use `--mode moderate` for large projects
- **Permission errors**: Ensure the MCP config file has correct JSON syntax
