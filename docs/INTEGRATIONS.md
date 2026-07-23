# Code Analyzer — AI Agent Integrations

Code Analyzer provides **one-click MCP server configuration** for 11+ AI coding agents.
Once configured, your agent gains access to code analysis, PR review, impact analysis,
cross-repo intelligence, and more — directly through chat.

## Quick Start

```bash
# Detect installed agents
code-analyzer agent detect

# Configure all detected agents
code-analyzer agent configure

# Check status
code-analyzer agent status

# List all supported agents
code-analyzer agent list
```

## Supported Agents

| Agent | Config File | Format | Detection |
|-------|------------|--------|-----------|
| Claude Code | `~/.claude/mcp.json` | JSON | `~/.claude/` exists |
| Cursor | `~/.cursor/mcp.json` | JSON | `~/.cursor/` exists |
| Windsurf | `~/.windsurf/mcp.json` | JSON | `~/.windsurf/` exists |
| Continue.dev | `~/.continue/config.json` | JSON | `~/.continue/` exists |
| Aider | `~/.aider.conf.yml` | YAML | `~/.aider.conf.yml` or `~/.aider/` exists |
| Cline | `~/.cline/mcp_settings.json` | JSON | `~/.cline/` exists |
| Codex (OpenAI) | `~/.codex/config.yml` | YAML | `~/.codex/` exists |
| Gemini CLI | `~/.gemini/mcp.json` | JSON | `~/.gemini/` exists |
| Cody (Sourcegraph) | `~/.cody/mcp.json` | JSON | `~/.cody/` exists |
| Amazon Q Developer | `~/.aws/amazonq/mcp.json` | JSON | `~/.aws/` exists |
| GitHub Copilot Chat | `~/.vscode/settings.json` | JSON | `~/.vscode/` exists |

## MCP Server Configuration Format

All agents use a shared MCP server entry that connects to Code Analyzer:

```json
{
  "command": "npx",
  "args": ["@agentix-e/code-analyzer", "mcp"],
  "env": {
    "CODE_ANALYZER_ROOT": "${workspaceFolder}"
  }
}
```

The exact serialization format varies by agent:

### JSON Agents (Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Cody, Amazon Q)

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@agentix-e/code-analyzer", "mcp"],
      "env": {
        "CODE_ANALYZER_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### Continue.dev

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@agentix-e/code-analyzer", "mcp"],
      "env": {
        "CODE_ANALYZER_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### GitHub Copilot Chat (VS Code)

```json
{
  "github.copilot.chat.mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@agentix-e/code-analyzer", "mcp"],
      "env": {
        "CODE_ANALYZER_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### YAML Agents (Aider, Codex)

```yaml
mcp_servers:
  - name: code-analyzer
    command: npx
    args:
      - "@agentix-e/code-analyzer"
      - mcp
    env:
      CODE_ANALYZER_ROOT: "${workspaceFolder}"
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CODE_ANALYZER_ROOT` | Root directory to analyze | `${workspaceFolder}` |
| `NODE_ENV` | Environment mode | `production` |

## Per-Agent Setup Instructions

### Claude Code

1. The auto-configuration creates `~/.claude/mcp.json`
2. Restart Claude Code after configuration
3. Verify: ask "What MCP servers are available?"

### Cursor

1. Configuration writes to `~/.cursor/mcp.json`
2. Restart Cursor or reload the window (Cmd/Ctrl+Shift+P → "Reload Window")
3. Verify: the MCP tools appear in the chat panel

### Windsurf

1. Configuration writes to `~/.windsurf/mcp.json`
2. Restart Windsurf
3. Verify: check the MCP server list in settings

### Continue.dev

1. Configuration merges into `~/.continue/config.json`
2. Restart VS Code with Continue extension
3. Verify: `@code-analyzer` slash commands appear in chat

### Aider

1. Auto-configuration appends MCP settings to `~/.aider.conf.yml`
2. Existing config is preserved and merged
3. Verify: run aider with `--mcp` flag

### Cline

1. Configuration writes to `~/.cline/mcp_settings.json`
2. Restart VS Code
3. Verify: the code-analyzer server appears in the MCP panel

### Codex (OpenAI)

1. Configuration adds MCP section to `~/.codex/config.yml`
2. Restart Codex session
3. Verify: list available MCP tools in the Codex terminal

### Gemini CLI

1. Configuration writes to `~/.gemini/mcp.json`
2. Restart Gemini CLI
3. Verify: run `gemini mcp list`

### Cody (Sourcegraph)

1. Configuration writes to `~/.cody/mcp.json`
2. Restart VS Code
3. Verify: ask "What tools do you have?"

### Amazon Q Developer

1. Configuration writes to `~/.aws/amazonq/mcp.json`
2. Restart IDE
3. Verify: check MCP tools in the Amazon Q panel

### GitHub Copilot Chat (VS Code)

1. Configuration merges into `~/.vscode/settings.json`
2. Reload the VS Code window
3. Verify: open Copilot Chat and ask "List available MCP tools"

## Manual Configuration

If you prefer to configure manually, copy the appropriate config block from above
into each agent's config file. The MCP server entry is the same for all agents.

### Example: Manual Cursor Setup

Create or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "code-analyzer": {
      "command": "npx",
      "args": ["@agentix-e/code-analyzer", "mcp"],
      "env": {
        "CODE_ANALYZER_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

## Troubleshooting

### Agent not detected

The detection is filesystem-based. Ensure the agent has been run at least once
(which creates its config directory). If an agent is installed but uses a custom
config location, use `code-analyzer agent configure --target <agent-id>` to force
configuration.

### MCP tools not showing up

1. **Restart the agent** — most agents require a restart to pick up MCP config
2. **Check the config file** — verify the file was created with `code-analyzer agent status`
3. **Check `npx` availability** — ensure Node.js and npx are in your PATH
4. **Check package access** — the package `@agentix-e/code-analyzer` must be
   published or linked locally

### Configuration conflicts

When Code Analyzer configures an agent, it backs up any existing config file
with a `.code-analyzer-backup` suffix. To restore:

```bash
# Restore a specific agent's backup
code-analyzer agent restore <agent-id>
```

Or manually:

```bash
mv ~/.cursor/mcp.json.code-analyzer-backup ~/.cursor/mcp.json
```

### Permission errors

If you see permission errors when writing config files:
- The config files are written to your home directory (`~`)
- Ensure your user has write permissions to these directories
- VS Code settings.json may be read-only if synced — disable settings sync
  temporarily

### Multiple agents sharing the same MCP server

It is safe to configure multiple agents to use code-analyzer simultaneously.
Each agent connects independently to its own MCP server instance.

## Verification Steps

After configuration, verify your setup:

### 1. Check file creation

```bash
ls -la ~/.cursor/mcp.json
ls -la ~/.claude/mcp.json
# ... etc.
```

### 2. Check status

```bash
code-analyzer agent status
```

### 3. Test in agent chat

In any configured agent, ask:

```
What code analysis tools are available?
```

You should see tools for code review, impact analysis, dependency graphs,
and more.

### 4. Run a real analysis

```
Analyze this repository and show me the dependency graph
```

The agent should use the MCP tools to perform the analysis.

## CLI Reference

```bash
# Detect installed agents
code-analyzer agent detect

# Configure all detected agents
code-analyzer agent configure

# Configure all supported agents (even those not detected)
code-analyzer agent configure --all

# Configure specific agents
code-analyzer agent configure --target "cursor,windsurf,claude-code"

# Dry run (preview without making changes)
code-analyzer agent configure --dry-run

# List all supported agents with status
code-analyzer agent list

# Show configuration status
code-analyzer agent status
```

## Uninstalling

To remove Code Analyzer from all configured agents:

```bash
# Remove MCP server entries from config files manually, or
# restore from backups created during configuration:

for f in ~/.cursor/mcp.json.code-analyzer-backup \
         ~/.claude/mcp.json.code-analyzer-backup \
         ~/.windsurf/mcp.json.code-analyzer-backup \
         ~/.continue/config.json.code-analyzer-backup \
         ~/.cline/mcp_settings.json.code-analyzer-backup \
         ~/.gemini/mcp.json.code-analyzer-backup \
         ~/.cody/mcp.json.code-analyzer-backup \
         ~/.aws/amazonq/mcp.json.code-analyzer-backup \
         ~/.vscode/settings.json.code-analyzer-backup; do
  orig="${f%.code-analyzer-backup}"
  if [ -f "$f" ]; then mv "$f" "$orig"; fi
done
```

For Aider and Codex, check `~/.aider.conf.yml` and `~/.codex/config.yml` for
the `mcp_servers:` section and remove it.

---

**Need help?** Open an issue at [github.com/AgentiX-E/code-analyzer/issues](https://github.com/AgentiX-E/code-analyzer/issues)
