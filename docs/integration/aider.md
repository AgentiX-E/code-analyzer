# Aider Integration

## Overview

Aider is the AI pair programming tool that works in your terminal. Code Analyzer integrates via MCP stdio transport in Aider's configuration.

## Quick Setup

```bash
npm install -g @code-analyzer/cli
code-analyzer setup --agent aider
```

## Manual Configuration

Add to `.aider.conf.yml` in your project root:

```yaml
mcp_servers:
  - name: code-analyzer
    command: npx
    args: ["@code-analyzer/mcp"]
```

Or use environment variables:

```bash
export AIDER_MCP_SERVERS='[{"name":"code-analyzer","command":"npx","args":["@code-analyzer/mcp"]}]'
aider
```

## Available Tools

| Tool | Description |
|---|---|
| `search_codebase` | Search across the entire codebase |
| `review_changes` | Review staged/diff changes |
| `get_dependencies` | Get file or module dependencies |
| `find_symbol` | Find symbol definitions and references |
| `analyze_architecture` | Architecture analysis and visualization |

## Aider-Specific Features

### Auto-Review Mode

Add to `.aider.conf.yml`:

```yaml
mcp_servers:
  - name: code-analyzer
    command: npx
    args:
      - "@code-analyzer/mcp"
      - "--auto-review"
      - "--severity"
      - "warning"
```

When enabled, every change Aider makes is automatically reviewed.

### Chat Commands

```
/aider
> /review              # Review all pending changes
> /find UserService    # Find UserService definition
> /impact src/auth.ts  # Analyze impact of changes to auth
> /deps src/main.ts    # Show dependency graph
```

## Example Workflow

```bash
# Start Aider with Code Analyzer
aider --model sonnet --mcp-config .aider.conf.yml

# In Aider chat:
> Review the current changes for security issues
> Show me all functions that depend on the database module
> What's the architecture of this project?
```

## Verification

In an Aider session:

> "Search the codebase for error handling patterns"

Aider should invoke the `fulltext_search` or `search_codebase` MCP tool and return structured results.

## Troubleshooting

- **Aider version**: Requires Aider >= 0.50.0 for MCP support
- **YAML syntax**: Ensure `.aider.conf.yml` uses correct YAML indentation (2 spaces)
- **Path resolution**: Use `npx @code-analyzer/mcp` to ensure the command resolves correctly
- **First-run indexing**: The first query may take longer as the codebase is indexed
