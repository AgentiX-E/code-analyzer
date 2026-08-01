# Integration Guides

Code Analyzer integrates with every major AI coding agent via the MCP (Model Context Protocol). Choose your agent below for detailed setup instructions.

## Supported Agents

| Agent | Auto-Detect | Transport | Config File |
|---|---|---|---|
| [Claude Code](./claude-code.md) | ✅ `ANTHROPIC_API_KEY` | stdio | `~/.claude/claude_desktop_config.json` |
| [Cursor](./cursor.md) | ✅ `.cursorrules` | stdio | `~/.cursor/mcp.json` |
| [Windsurf](./windsurf.md) | ✅ `.windsurfrules` | stdio | `~/.codeium/windsurf/mcp_config.json` |
| [Continue.dev](./continue-dev.md) | ✅ `.continue` | stdio | `~/.continue/config.json` |
| [Aider](./aider.md) | ✅ `AIDER_MODEL` | stdio | `.aider.conf.yml` |
| [Cline](./cline.md) | ✅ `.clinerules` | stdio | `~/.cline/mcp_settings.json` |
| [GitHub Copilot](./github-copilot.md) | ✅ Extension | stdio | `.github/copilot/mcp.json` |

## Quick Start (Auto-Detect)

```bash
# Install Code Analyzer
npm install -g @code-analyzer/cli

# Auto-detect your agent and generate config
code-analyzer setup --auto

# Or manually specify your agent
code-analyzer setup --agent claude-code
```

## Prerequisites

- **Node.js** >= 20.0.0
- **Code Analyzer CLI**: `npm install -g @code-analyzer/cli`

## How MCP Integration Works

1. Code Analyzer runs as an MCP server (stdio transport)
2. Your AI agent connects to it via the MCP protocol
3. The agent gains access to 38 code intelligence tools:
   - 🔍 **Search**: Full-text, semantic, and graph-based code search
   - 📋 **Review**: Automated PR review with 50+ deterministic rules
   - 📊 **Impact**: Change impact analysis and dependency graphs
   - 🏗️ **Architecture**: Codebase structure visualization
   - 🔗 **Cross-Repo**: Multi-repository analysis

## Verification

After setup, ask your agent:

> "Show me the architecture of this project"

If configured correctly, the agent will use Code Analyzer's tools to provide a structured response about your codebase.

## Troubleshooting

### Agent doesn't detect Code Analyzer

1. Ensure Node.js >= 20 is installed: `node --version`
2. Verify CLI installation: `npx @code-analyzer/cli --version`
3. Check the MCP config file path for your agent
4. Restart your agent after adding the configuration

### Tools return errors

1. Index your project first: `code-analyzer index`
2. Check the index status: `code-analyzer status`
3. View logs: `code-analyzer logs`

### Performance issues

For large codebases (>100K files), configure:
```json
{
  "codeAnalyzer.indexMode": "moderate",
  "codeAnalyzer.maxFileSize": 5242880
}
```
