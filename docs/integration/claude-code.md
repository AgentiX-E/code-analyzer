# Claude Code Integration

## Overview

Claude Code is Anthropic's agentic coding tool. Code Analyzer integrates via MCP stdio transport.

## Quick Setup

```bash
npm install -g @code-analyzer/cli
code-analyzer setup --agent claude-code
```

## Manual Configuration

Add the following to `~/.claude/claude_desktop_config.json`:

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

Or use the Claude Code CLI:

```bash
claude mcp add code-analyzer -- npx @code-analyzer/mcp
```

## Available Slash Commands

Once configured, use these commands in Claude Code:

| Command | Description |
|---|---|
| `/review` | Review current changes or a specific file |
| `/explain` | Explain a function, class, or module |
| `/impact` | Analyze the impact of proposed changes |
| `/find` | Search for symbols, patterns, or references |
| `/deps` | Show dependency graph for a file or module |

## Configuration Options

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": [
        "@code-analyzer/mcp",
        "--standards", ".code-analyzer/standards.json",
        "--max-files", "200"
      ],
      "env": {
        "LOG_LEVEL": "info",
        "INDEX_MODE": "full"
      }
    }
  }
}
```

## Verification

In Claude Code, ask:

> "Search for all exported functions in this project"

If Code Analyzer is configured correctly, Claude will use the `search_symbols` or `fulltext_search` tool.

## Troubleshooting

### "MCP server not found"
- Ensure Node.js >= 20: `node --version`
- Verify npx can find the package: `npx @code-analyzer/mcp --version`
- Check the config file exists: `cat ~/.claude/claude_desktop_config.json`

### Slow first query
The first query triggers codebase indexing. For large projects, pass `--mode fast` for incremental index builds, or `--mode full` for complete indexing.
