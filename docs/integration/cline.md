# Cline Integration

## Overview

Cline is the autonomous coding agent for VS Code. Code Analyzer provides deep code intelligence capabilities via MCP.

## Quick Setup

```bash
npm install -g @code-analyzer/cli
code-analyzer setup --agent cline
```

## Manual Configuration

Open Cline → MCP Servers → Configure, then add:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@code-analyzer/mcp"],
      "disabled": false,
      "autoApprove": [
        "search_codebase",
        "find_symbol",
        "get_dependencies"
      ]
    }
  }
}
```

Save to `~/.cline/mcp_settings.json`.

## Auto-Approve Configuration

Cline requires explicit approval for each tool. Configure `autoApprove` to streamline workflows:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@code-analyzer/mcp"],
      "disabled": false,
      "autoApprove": [
        "search_codebase",
        "fulltext_search",
        "find_symbol",
        "get_dependencies",
        "get_architecture",
        "list_files",
        "get_file_info"
      ]
    }
  }
}
```

**Safety note**: Review tools (`review_changes`, `analyze_impact`) are intentionally excluded from auto-approve since they can generate large outputs.

## Features

| Feature | How Cline Uses It |
|---|---|
| **Autonomous Review** | Cline can review its own code changes before committing |
| **Architecture Analysis** | Understand project structure before making changes |
| **Symbol Search** | Find relevant code across the entire codebase |
| **Dependency Tracking** | Understand the impact of refactoring decisions |
| **Cross-Repo Awareness** | Navigate monorepos and multi-repo projects |

## Cline-Specific Configuration

### .clinerules Integration

Create `.clinerules` in your project root:

```
# Code Analyzer Rules
- Always review changes with code-analyzer before creating files
- Use search_codebase before modifying existing code
- Check dependencies before refactoring shared modules
```

### Task-Based Workflows

```
/cline
> Task: Review the entire codebase and identify security vulnerabilities
> Task: Find all places where we use hardcoded credentials 
> Task: Analyze the impact of removing the legacy API module
```

## Verification

In Cline's chat:

> "Use the code-analyzer tools to search for SQL injection vulnerabilities"

Cline should use the relevant MCP tools to perform the search and report findings.

## Troubleshooting

- **Tools not appearing**: Check `~/.cline/mcp_settings.json` syntax and restart VS Code
- **Permission prompts**: Add commonly used tools to `autoApprove` list
- **Connection errors**: Verify `npx @code-analyzer/mcp` works from terminal first
- **Indexing timeout**: Build the index first with `code-analyzer index` before using Cline
