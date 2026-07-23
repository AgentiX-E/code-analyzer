/**
 * MCP Configuration Templates.
 *
 * Pre-built configuration snippets for each supported AI coding agent.
 * These are auto-generated based on the detected agent and can be
 * written directly into the agent's config file.
 */

import type { AgentId, McpConfigTemplate } from './types.js';

/**
 * Generate an MCP config template for a specific agent.
 */
export function getMcpTemplate(
  agentId: AgentId,
  options: {
    /** MCP server command (default: 'npx @code-analyzer/mcp') */
    command?: string;
    /** Environment variables to pass */
    env?: Record<string, string>;
    /** Custom args for the server */
    args?: string[];
  } = {},
): McpConfigTemplate | null {
  const command = options.command ?? 'npx @code-analyzer/mcp';
  const args = options.args ?? [];

  switch (agentId) {
    case 'claude-code':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
                env: options.env ?? {},
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.claude/claude_desktop_config.json',
        instructions:
          'Add the above to your claude_desktop_config.json, or use `claude mcp add code-analyzer -- npx @code-analyzer/mcp`',
      };

    case 'cursor':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.cursor/mcp.json',
        instructions:
          'Create or edit ~/.cursor/mcp.json with this config, then restart Cursor.',
      };

    case 'windsurf':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.codeium/windsurf/mcp_config.json',
        instructions:
          'Add this config to Windsurf Settings → MCP Servers, or create the file above.',
      };

    case 'continue-dev':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: [
              {
                name: 'code-analyzer',
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            ],
          },
          null,
          2,
        ),
        configPath: '~/.continue/config.json',
        instructions:
          'Merge into your existing config.json under the "mcpServers" key.',
      };

    case 'aider':
      return {
        agentId,
        transport: 'stdio',
        config: `# Add to .aider.conf.yml:
mcp_servers:
  - name: code-analyzer
    command: npx
    args: ["@code-analyzer/mcp"]`,
        configPath: '.aider.conf.yml',
        instructions:
          'Add the snippet above to your .aider.conf.yml in the project root.',
      };

    case 'cline':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
                disabled: false,
                autoApprove: [],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.cline/mcp_settings.json',
        instructions:
          'Open Cline → MCP Servers → Configure, then add this server.',
      };

    case 'github-copilot':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            servers: {
              'code-analyzer': {
                type: 'stdio',
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            },
          },
          null,
          2,
        ),
        configPath: '.github/copilot/mcp.json',
        instructions:
          'Create .github/copilot/mcp.json in your project root with this config.',
      };

    case 'codeium':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.codeium/mcp.json',
        instructions:
          'Create or edit ~/.codeium/mcp.json with this config.',
      };

    case 'tabnine':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.tabnine/mcp.json',
        instructions:
          'Add this config to Tabnine → MCP Servers settings.',
      };

    case 'amazon-q':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.aws/amazonq/mcp.json',
        instructions:
          'Create ~/.aws/amazonq/mcp.json with this config.',
      };

    case 'roo-code':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
                disabled: false,
                autoApprove: [],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.roo/mcp_settings.json',
        instructions:
          'Open Roo Code → MCP Servers → Configure, then add this server.',
      };

    case 'augment-code':
      return {
        agentId,
        transport: 'stdio',
        config: JSON.stringify(
          {
            mcpServers: {
              'code-analyzer': {
                command: 'npx',
                args: ['@code-analyzer/mcp', ...args],
              },
            },
          },
          null,
          2,
        ),
        configPath: '~/.augment/mcp.json',
        instructions:
          'Create ~/.augment/mcp.json with this config.',
      };

    default:
      return null;
  }
}

/**
 * Get a human-readable setup guide for a specific agent.
 */
export function getAgentSetupGuide(agentId: AgentId): string {
  const template = getMcpTemplate(agentId);
  if (!template) return `No setup guide available for agent: ${agentId}`;

  return [
    `# Setting up Code Analyzer with ${agentId}`,
    '',
    '## Prerequisites',
    '- Node.js >= 20',
    '- Code Analyzer installed: `npm install -g @code-analyzer/cli`',
    '',
    '## Configuration',
    `Add the following to \`${template.configPath}\`:\n`,
    '```json',
    template.config,
    '```',
    '',
    template.instructions,
    '',
    '## Verification',
    'After restarting your agent, ask: "Show me the architecture of this project"',
    'The agent should use the code-analyzer MCP tools to answer.',
  ].join('\n');
}

/**
 * Get a condensed one-liner setup instruction for CLI output.
 */
export function getQuickSetup(agentId: AgentId): string {
  const template = getMcpTemplate(agentId);
  if (!template) return '';
  return `Configure ${agentId}: edit ${template.configPath} → ${template.instructions.split('\n')[0]}`;
}
