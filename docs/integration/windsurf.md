# Windsurf Integration

## Overview

Windsurf is Codeium's AI-powered IDE. Code Analyzer integrates via MCP stdio transport.

## Quick Setup

```bash
npm install -g @code-analyzer/cli
code-analyzer setup --agent windsurf
```

## Manual Configuration

Create or edit `~/.codeium/windsurf/mcp_config.json`:

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

Alternatively, open Windsurf Settings → MCP Servers → Add Server.

## Features

| Feature | Description |
|---|---|
| **Smart Code Review** | Review PRs and staged changes with 50+ lint rules |
| **Semantic Search** | Find code by meaning, not just text |
| **Impact Analysis** | Predict which files will be affected by a change |
| **Knowledge Graph** | Query the codebase as a graph for architectural insights |
| **Cross-Repo Analysis** | Analyze relationships across multiple repositories |

## Windsurf-Specific Configuration

Windsurf respects `.windsurfrules` files. Code Analyzer reads these to tailor its analysis:

```bash
# .windsurfrules
- Use functional components in React
- Prefer async/await over promises
- Use TypeScript strict mode
```

## Environment Variables

```bash
# Optional: customize behavior
export CODE_ANALYZER_LOG_LEVEL=debug
export CODE_ANALYZER_INDEX_MODE=full
```

## Verification

In Windsurf's Cascade chat, ask:

> "Analyze the dependencies of src/main.ts"

## Troubleshooting

- **Windsurf doesn't recognize the MCP server**: Verify the config path: `~/.codeium/windsurf/mcp_config.json`
- **High memory usage on large projects**: Set `INDEX_MODE=moderate` in server environment
- **Connection refused**: Check that Node.js >= 20 is installed
