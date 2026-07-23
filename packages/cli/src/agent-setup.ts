// @code-analyzer/cli — Agent Auto-Detection & One-Click Configuration
//
// Detects installed AI coding agents and configures them to use
// code-analyzer as an MCP server. Supports 11 agents across
// JSON, YAML, and VS Code settings formats.
//

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedAgent =
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'continue-dev'
  | 'aider'
  | 'cline'
  | 'codex'
  | 'gemini-cli'
  | 'cody'
  | 'amazon-q'
  | 'copilot-chat';

export interface AgentConfig {
  /** Internal identifier */
  name: SupportedAgent;
  /** Human-readable name */
  displayName: string;
  /** Path relative to the home directory */
  configPath: string;
  /** Configuration file format */
  configFormat: 'json' | 'yaml' | 'toml';
  /** Paths whose existence indicates the agent is installed */
  detectionPaths: string[];
}

export interface SetupResult {
  agent: SupportedAgent;
  detected: boolean;
  configured: boolean;
  configPath: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_SERVER_NAME = 'code-analyzer';
const MCP_SERVER_COMMAND = 'npx';
const MCP_SERVER_ARGS: string[] = ['@agentix-e/code-analyzer', 'mcp'];

/** Base MCP server entry shared by all agents. */
function buildMCPServerEntry(): Record<string, unknown> {
  return {
    command: MCP_SERVER_COMMAND,
    args: MCP_SERVER_ARGS,
    env: {
      CODE_ANALYZER_ROOT: '${workspaceFolder}',
    },
  };
}

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

const AGENT_CONFIGS: AgentConfig[] = [
  {
    name: 'claude-code',
    displayName: 'Claude Code',
    configPath: '.claude/mcp.json',
    configFormat: 'json',
    detectionPaths: ['.claude'],
  },
  {
    name: 'cursor',
    displayName: 'Cursor',
    configPath: '.cursor/mcp.json',
    configFormat: 'json',
    detectionPaths: ['.cursor'],
  },
  {
    name: 'windsurf',
    displayName: 'Windsurf',
    configPath: '.windsurf/mcp.json',
    configFormat: 'json',
    detectionPaths: ['.windsurf'],
  },
  {
    name: 'continue-dev',
    displayName: 'Continue.dev',
    configPath: '.continue/config.json',
    configFormat: 'json',
    detectionPaths: ['.continue'],
  },
  {
    name: 'aider',
    displayName: 'Aider',
    configPath: '.aider.conf.yml',
    configFormat: 'yaml',
    detectionPaths: ['.aider.conf.yml', '.aider'],
  },
  {
    name: 'cline',
    displayName: 'Cline',
    configPath: '.cline/mcp_settings.json',
    configFormat: 'json',
    detectionPaths: ['.cline'],
  },
  {
    name: 'codex',
    displayName: 'Codex (OpenAI)',
    configPath: '.codex/config.yml',
    configFormat: 'yaml',
    detectionPaths: ['.codex'],
  },
  {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    configPath: '.gemini/mcp.json',
    configFormat: 'json',
    detectionPaths: ['.gemini'],
  },
  {
    name: 'cody',
    displayName: 'Cody (Sourcegraph)',
    configPath: '.cody/mcp.json',
    configFormat: 'json',
    detectionPaths: ['.cody'],
  },
  {
    name: 'amazon-q',
    displayName: 'Amazon Q Developer',
    configPath: '.aws/amazonq/mcp.json',
    configFormat: 'json',
    detectionPaths: ['.aws'],
  },
  {
    name: 'copilot-chat',
    displayName: 'GitHub Copilot Chat',
    configPath: '.vscode/settings.json',
    configFormat: 'json',
    detectionPaths: ['.vscode'],
  },
];

/** Lookup map for fast agent config retrieval. */
const AGENT_MAP = new Map<SupportedAgent, AgentConfig>(
  AGENT_CONFIGS.map((c) => [c.name, c]),
);

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize the MCP server entry into a JSON config file string.
 * Handles the standard `{ mcpServers: { ... } }` format for most agents.
 */
function serializeSimpleJson(
  existingContent: string | null,
  serverEntry: Record<string, unknown>,
): string {
  let existing: Record<string, unknown> = { mcpServers: {} };
  if (existingContent) {
    try {
      existing = JSON.parse(existingContent) as Record<string, unknown>;
    } catch {
      // Corrupt config – start fresh
    }
  }

  const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers[MCP_SERVER_NAME] = serverEntry;
  existing.mcpServers = mcpServers;

  return JSON.stringify(existing, null, 2) + '\n';
}

/**
 * Serialize into VS Code settings.json format.
 * GitHub Copilot uses `github.copilot.chat.mcpServers` in the settings.
 */
function serializeVSCodeSettings(
  existingContent: string | null,
  serverEntry: Record<string, unknown>,
): string {
  const settingsKey = 'github.copilot.chat.mcpServers';

  let settings: Record<string, unknown> = {};
  if (existingContent) {
    try {
      settings = JSON.parse(existingContent) as Record<string, unknown>;
    } catch {
      // Corrupt settings – start fresh
    }
  }

  const mcpServers = (settings[settingsKey] ?? {}) as Record<string, unknown>;
  mcpServers[MCP_SERVER_NAME] = serverEntry;
  settings[settingsKey] = mcpServers;

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Serialize the MCP server entry into a YAML config file string.
 * Generates a simple `mcp_servers:` section for Aider / Codex.
 */
function serializeYaml(
  existingContent: string | null,
  serverEntry: Record<string, unknown>,
): string {
  const lines: string[] = [];

  // Preserve existing content that isn't MCP-related
  if (existingContent) {
    const existingLines = existingContent.split('\n');
    const skipKeys = new Set(['mcp_servers', 'mcpServers']);
    let skip = false;

    for (const line of existingLines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        if (!skip) lines.push(line);
        continue;
      }

      const key = trimmed.split(':')[0].trim();
      if (skipKeys.has(key)) {
        skip = true;
        continue;
      }

      if (skip && /^[a-zA-Z_]/.test(line) && !line.startsWith(' ')) {
        skip = false;
        lines.push(line);
      } else if (!skip) {
        lines.push(line);
      }
    }

    // Remove trailing blank lines before appending MCP section
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (lines.length > 0) lines.push('');
  }

  // Build MCP YAML section
  lines.push('mcp_servers:');
  lines.push(`  - name: ${MCP_SERVER_NAME}`);
  lines.push(`    command: ${serverEntry.command}`);
  lines.push('    args:');
  for (const arg of (serverEntry.args as string[])) {
    lines.push(`      - ${arg}`);
  }
  const env = serverEntry.env as Record<string, string> | undefined;
  if (env && Object.keys(env).length > 0) {
    lines.push('    env:');
    for (const [key, value] of Object.entries(env)) {
      lines.push(`      ${key}: "${value}"`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Serialize into Continue.dev config.json format.
 * Continue uses a flat structure with `mcpServers` in the root config.
 */
function serializeContinueConfig(
  existingContent: string | null,
  serverEntry: Record<string, unknown>,
): string {
  let config: Record<string, unknown> = {};
  if (existingContent) {
    try {
      config = JSON.parse(existingContent) as Record<string, unknown>;
    } catch {
      // Corrupt config – start fresh
    }
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers[MCP_SERVER_NAME] = serverEntry;
  config.mcpServers = mcpServers;

  return JSON.stringify(config, null, 2) + '\n';
}

/**
 * Pick the right serializer for the given agent.
 */
function getSerializer(
  agent: SupportedAgent,
): (existing: string | null, entry: Record<string, unknown>) => string {
  switch (agent) {
    case 'copilot-chat':
      return serializeVSCodeSettings;
    case 'aider':
    case 'codex':
      return serializeYaml;
    case 'continue-dev':
      return serializeContinueConfig;
    default:
      return serializeSimpleJson;
  }
}

// ---------------------------------------------------------------------------
// AgentSetupManager
// ---------------------------------------------------------------------------

export class AgentSetupManager {
  private readonly homeDir: string;
  private backupSuffix = '.code-analyzer-backup';

  constructor(homeDir?: string) {
    this.homeDir = homeDir ?? os.homedir();
  }

  // -----------------------------------------------------------------------
  // Detection
  // -----------------------------------------------------------------------

  /**
   * Detect which supported agents are installed on the system.
   * Checks whether any of the agent's detection paths exist.
   */
  detectInstalled(): SupportedAgent[] {
    return AGENT_CONFIGS.filter((config) =>
      config.detectionPaths.some((detectionPath) => {
        const fullPath = path.join(this.homeDir, detectionPath);
        return fs.existsSync(fullPath);
      }),
    ).map((config) => config.name);
  }

  /**
   * Check if a specific agent is already configured to use code-analyzer.
   */
  isConfigured(agent: SupportedAgent): boolean {
    const config = this.getConfig(agent);
    const fullPath = path.join(this.homeDir, config.configPath);

    if (!fs.existsSync(fullPath)) return false;

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');

      if (config.configFormat === 'yaml') {
        return content.includes('code-analyzer');
      }

      const parsed = JSON.parse(content) as Record<string, unknown>;

      if (agent === 'copilot-chat') {
        const mcp = parsed['github.copilot.chat.mcpServers'] as
          | Record<string, unknown>
          | undefined;
        return mcp != null && MCP_SERVER_NAME in mcp;
      }

      const mcpServers = parsed.mcpServers as
        | Record<string, unknown>
        | undefined;
      if (mcpServers == null) return false;

      return MCP_SERVER_NAME in mcpServers;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Get the full AgentConfig for a supported agent.
   */
  getConfig(agent: SupportedAgent): AgentConfig {
    const config = AGENT_MAP.get(agent);
    if (!config) {
      throw new Error(`Unknown agent: ${agent}`);
    }
    return config;
  }

  /**
   * Configure a single agent to use code-analyzer as an MCP server.
   * Backs up any existing config file before writing.
   */
  configure(agent: SupportedAgent): SetupResult {
    const config = this.getConfig(agent);
    const fullPath = path.join(this.homeDir, config.configPath);
    const detected = this.detectInstalled().includes(agent);

    let message: string;
    let configured = false;

    try {
      // Ensure parent directory exists
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Read existing config
      let existingContent: string | null = null;
      if (fs.existsSync(fullPath)) {
        existingContent = fs.readFileSync(fullPath, 'utf-8');

        // Backup existing config
        const backupPath = fullPath + this.backupSuffix;
        fs.writeFileSync(backupPath, existingContent, 'utf-8');
      }

      // Build MCP server entry
      const serverEntry = buildMCPServerEntry();

      // Serialize using the appropriate serializer
      const serialize = getSerializer(agent);
      const newContent = serialize(existingContent, serverEntry);

      fs.writeFileSync(fullPath, newContent, 'utf-8');
      configured = true;
      message = `Configured ${config.displayName} (${fullPath})`;

      if (existingContent) {
        message += ' — existing config backed up';
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      message = `Failed to configure ${config.displayName}: ${errMsg}`;
    }

    return {
      agent,
      detected,
      configured,
      configPath: fullPath,
      message,
    };
  }

  /**
   * Configure all detected agents.
   */
  configureAll(): SetupResult[] {
    const installed = this.detectInstalled();
    return installed.map((agent) => this.configure(agent));
  }

  /**
   * Configure a specific subset of agents.
   */
  configureAgents(agents: SupportedAgent[]): SetupResult[] {
    return agents.map((agent) => this.configure(agent));
  }

  /**
   * Get all supported agent configs.
   */
  getAllConfigs(): AgentConfig[] {
    return [...AGENT_CONFIGS];
  }

  // -----------------------------------------------------------------------
  // Reporting
  // -----------------------------------------------------------------------

  /**
   * Generate a summary report of setup results.
   */
  getReport(results: SetupResult[]): string {
    const lines: string[] = ['Agent Integration Report', '=======================', ''];

    const succeeded = results.filter((r) => r.configured);
    const failed = results.filter((r) => !r.configured);

    lines.push(`Total agents processed: ${results.length}`);
    lines.push(`Configured successfully: ${succeeded.length}`);
    lines.push(`Failed: ${failed.length}`);
    lines.push('');

    if (succeeded.length > 0) {
      lines.push('Configured Agents:');
      for (const r of succeeded) {
        const detectedIcon = r.detected ? '[DETECTED]' : '[MANUAL]';
        lines.push(`  ${detectedIcon} ${r.configPath}`);
      }
      lines.push('');
    }

    if (failed.length > 0) {
      lines.push('Failed Agents:');
      for (const r of failed) {
        lines.push(`  [FAILED] ${r.agent} — ${r.message}`);
      }
      lines.push('');
    }

    lines.push('Details:');
    for (const r of results) {
      const status = r.configured ? 'OK' : 'FAIL';
      lines.push(`  [${status}] ${r.agent}: ${r.message}`);
    }

    return lines.join('\n');
  }

  /**
   * Get the status of all supported agents (detected / configured).
   */
  getStatusReport(): string {
    const lines: string[] = [
      'Code Analyzer — Agent Integration Status',
      '=========================================',
      '',
    ];

    const installed = this.detectInstalled();
    const installedSet = new Set(installed);

    lines.push(
      'Agent                     Installed    Configured',
    );
    lines.push(
      '------------------------- ------------ ------------',
    );

    for (const config of AGENT_CONFIGS) {
      const isInstalled = installedSet.has(config.name);
      const isConfigured = this.isConfigured(config.name);
      const name = config.displayName.padEnd(24);
      const inst = isInstalled ? 'Yes'.padEnd(11) : 'No'.padEnd(11);
      const conf = isConfigured ? 'Yes' : 'No';
      lines.push(`${name} ${inst} ${conf}`);
    }

    lines.push('');
    lines.push('Run `code-analyzer agent configure` to set up detected agents.');
    lines.push(
      'Run `code-analyzer agent configure --all` to configure all supported agents.',
    );

    return lines.join('\n');
  }

  /**
   * Clean up backup files created during configuration.
   */
  cleanupBackups(): number {
    let removed = 0;
    for (const config of AGENT_CONFIGS) {
      const backupPath = path.join(
        this.homeDir,
        config.configPath + this.backupSuffix,
      );
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Restore from backup files if they exist.
   */
  restoreFromBackup(agent: SupportedAgent): string {
    const config = this.getConfig(agent);
    const fullPath = path.join(this.homeDir, config.configPath);
    const backupPath = fullPath + this.backupSuffix;

    if (!fs.existsSync(backupPath)) {
      return `No backup found for ${config.displayName}`;
    }

    const backup = fs.readFileSync(backupPath, 'utf-8');
    fs.writeFileSync(fullPath, backup, 'utf-8');
    fs.unlinkSync(backupPath);
    return `Restored ${config.displayName} config from backup`;
  }
}
