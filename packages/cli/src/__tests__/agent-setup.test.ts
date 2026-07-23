// @code-analyzer/cli — Agent Setup Tests

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AgentSetupManager } from '../agent-setup.js';

import type { SupportedAgent, AgentConfig, SetupResult } from '../agent-setup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-agent-test-'));
  return dir;
}

function createAgentDir(tempHome: string, agentConfig: AgentConfig): void {
  const dirPath = path.dirname(path.join(tempHome, agentConfig.configPath));
  fs.mkdirSync(dirPath, { recursive: true });
}

function createFakeAgentInstall(agentConfig: AgentConfig, detectionPath: string): void {
  const fullPath = path.join(
    agentConfig.configPath.startsWith('/') ? '' : '',
    detectionPath,
  );
  // We handle this via the manager's homeDir
}

// ---------------------------------------------------------------------------
// Agent Detection
// ---------------------------------------------------------------------------

describe('AgentSetupManager — Detection', () => {
  let tempHome: string;
  let manager: AgentSetupManager;

  beforeEach(() => {
    tempHome = createTempHome();
    manager = new AgentSetupManager(tempHome);
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should return empty array when no agents are installed', () => {
    const installed = manager.detectInstalled();
    expect(installed).toEqual([]);
  });

  it('should detect Claude Code when ~/.claude exists', () => {
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('claude-code');
  });

  it('should detect Cursor when ~/.cursor exists', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('cursor');
  });

  it('should detect Windsurf when ~/.windsurf exists', () => {
    fs.mkdirSync(path.join(tempHome, '.windsurf'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('windsurf');
  });

  it('should detect Continue.dev when ~/.continue exists', () => {
    fs.mkdirSync(path.join(tempHome, '.continue'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('continue-dev');
  });

  it('should detect Aider when ~/.aider.conf.yml exists', () => {
    fs.writeFileSync(
      path.join(tempHome, '.aider.conf.yml'),
      '# aider config',
      'utf-8',
    );
    const installed = manager.detectInstalled();
    expect(installed).toContain('aider');
  });

  it('should detect Aider when ~/.aider directory exists', () => {
    fs.mkdirSync(path.join(tempHome, '.aider'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('aider');
  });

  it('should detect Cline when ~/.cline exists', () => {
    fs.mkdirSync(path.join(tempHome, '.cline'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('cline');
  });

  it('should detect Codex when ~/.codex exists', () => {
    fs.mkdirSync(path.join(tempHome, '.codex'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('codex');
  });

  it('should detect Gemini CLI when ~/.gemini exists', () => {
    fs.mkdirSync(path.join(tempHome, '.gemini'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('gemini-cli');
  });

  it('should detect Cody when ~/.cody exists', () => {
    fs.mkdirSync(path.join(tempHome, '.cody'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('cody');
  });

  it('should detect Amazon Q when ~/.aws exists', () => {
    fs.mkdirSync(path.join(tempHome, '.aws'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('amazon-q');
  });

  it('should detect GitHub Copilot Chat when ~/.vscode exists', () => {
    fs.mkdirSync(path.join(tempHome, '.vscode'), { recursive: true });
    const installed = manager.detectInstalled();
    expect(installed).toContain('copilot-chat');
  });

  it('should detect multiple agents simultaneously', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.windsurf'), { recursive: true });

    const installed = manager.detectInstalled();
    expect(installed).toContain('cursor');
    expect(installed).toContain('claude-code');
    expect(installed).toContain('windsurf');
    expect(installed.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Agent Configuration Generation
// ---------------------------------------------------------------------------

describe('AgentSetupManager — Configuration', () => {
  // prettier-ignore
  const allAgents: SupportedAgent[] = [
    'claude-code', 'cursor', 'windsurf', 'continue-dev',
    'aider', 'cline', 'codex', 'gemini-cli',
    'cody', 'amazon-q', 'copilot-chat',
  ];

  let tempHome: string;
  let manager: AgentSetupManager;

  beforeEach(() => {
    tempHome = createTempHome();
    manager = new AgentSetupManager(tempHome);
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Configuration file generation
  // -----------------------------------------------------------------------

  it.each(allAgents)(
    'should generate a valid configuration file for %s',
    (agent: SupportedAgent) => {
      // Pre-create the detection directory to simulate installation
      const config = manager.getConfig(agent);
      const dir = path.dirname(path.join(tempHome, config.configPath));
      fs.mkdirSync(dir, { recursive: true });

      const result = manager.configure(agent);

      expect(result.configured).toBe(true);
      expect(result.agent).toBe(agent);

      // Verify the file was created
      const configPath = path.join(tempHome, config.configPath);
      expect(fs.existsSync(configPath)).toBe(true);

      // Verify content is non-empty
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);

      // Verify it references code-analyzer
      expect(content).toContain('code-analyzer');

      // Verify it references the MCP command
      if (config.configFormat === 'yaml') {
        expect(content).toContain('npx');
        expect(content).toContain('mcp_servers');
      } else {
        expect(content).toContain('npx');
      }
    },
  );

  it('should include all required MCP server fields in JSON config', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });

    const result = manager.configure('cursor');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(
      path.join(tempHome, '.cursor', 'mcp.json'),
      'utf-8',
    );
    const parsed = JSON.parse(content);

    const mcpServer =
      parsed.mcpServers['code-analyzer'];
    expect(mcpServer).toBeDefined();
    expect(mcpServer.command).toBe('npx');
    expect(mcpServer.args).toEqual([
      '@agentix-e/code-analyzer',
      'mcp',
    ]);
    expect(mcpServer.env).toEqual({
      CODE_ANALYZER_ROOT: '${workspaceFolder}',
    });
  });

  it('should include MCP server in VS Code settings format for Copilot', () => {
    fs.mkdirSync(path.join(tempHome, '.vscode'), { recursive: true });

    const result = manager.configure('copilot-chat');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(
      path.join(tempHome, '.vscode', 'settings.json'),
      'utf-8',
    );
    const parsed = JSON.parse(content);

    const mcpServers =
      parsed['github.copilot.chat.mcpServers'];
    expect(mcpServers).toBeDefined();

    const mcpServer = mcpServers['code-analyzer'];
    expect(mcpServer).toBeDefined();
    expect(mcpServer.command).toBe('npx');
  });

  it('should generate YAML config for Aider', () => {
    fs.writeFileSync(
      path.join(tempHome, '.aider.conf.yml'),
      '',
      'utf-8',
    );

    const result = manager.configure('aider');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(
      path.join(tempHome, '.aider.conf.yml'),
      'utf-8',
    );
    expect(content).toContain('mcp_servers:');
    expect(content).toContain('name: code-analyzer');
    expect(content).toContain('command: npx');
  });

  it('should generate YAML config for Codex', () => {
    fs.mkdirSync(path.join(tempHome, '.codex'), { recursive: true });

    const result = manager.configure('codex');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(
      path.join(tempHome, '.codex', 'config.yml'),
      'utf-8',
    );
    expect(content).toContain('mcp_servers:');
    expect(content).toContain('name: code-analyzer');
  });

  // -----------------------------------------------------------------------
  // Non-destructive (backup)
  // -----------------------------------------------------------------------

  it('should backup existing config before overwriting', () => {
    const configDir = path.join(tempHome, '.cursor');
    const configPath = path.join(configDir, 'mcp.json');
    const backupPath = configPath + '.code-analyzer-backup';

    fs.mkdirSync(configDir, { recursive: true });
    const originalContent = JSON.stringify(
      { existingKey: 'value' },
      null,
      2,
    );
    fs.writeFileSync(configPath, originalContent, 'utf-8');

    const result = manager.configure('cursor');
    expect(result.configured).toBe(true);

    // Backup file should exist
    expect(fs.existsSync(backupPath)).toBe(true);
    const backupContent = fs.readFileSync(backupPath, 'utf-8');
    expect(backupContent).toBe(originalContent);

    // New config should have MCP server
    const newContent = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(newContent);
    expect(parsed.existingKey).toBe('value');
    expect(parsed.mcpServers['code-analyzer']).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Already configured detection
  // -----------------------------------------------------------------------

  it('should detect that an agent is already configured', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });

    // Configure once
    manager.configure('cursor');
    expect(manager.isConfigured('cursor')).toBe(true);
  });

  it('should report not configured for agents without config', () => {
    expect(manager.isConfigured('cursor')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // configureAll
  // -----------------------------------------------------------------------

  it('should configure all detected agents', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });

    const results = manager.configureAll();
    expect(results.length).toBe(2);
    expect(results.every((r) => r.configured)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // configureAgents
  // -----------------------------------------------------------------------

  it('should configure a specific subset of agents', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.windsurf'), { recursive: true });

    const results = manager.configureAgents(['cursor']);
    expect(results.length).toBe(1);
    expect(results[0].agent).toBe('cursor');
    expect(results[0].configured).toBe(true);
  });

  // -----------------------------------------------------------------------
  // getConfig
  // -----------------------------------------------------------------------

  it('should return config for all supported agents', () => {
    // prettier-ignore
    const expected: SupportedAgent[] = [
      'claude-code', 'cursor', 'windsurf', 'continue-dev',
      'aider', 'cline', 'codex', 'gemini-cli',
      'cody', 'amazon-q', 'copilot-chat',
    ];

    for (const agent of expected) {
      const config = manager.getConfig(agent);
      expect(config).toBeDefined();
      expect(config.name).toBe(agent);
      expect(config.displayName).toBeTruthy();
      expect(config.configPath).toBeTruthy();
      expect(['json', 'yaml', 'toml']).toContain(config.configFormat);
      expect(config.detectionPaths.length).toBeGreaterThan(0);
    }
  });

  it('should throw for unknown agent', () => {
    expect(() =>
      manager.getConfig('unknown' as SupportedAgent),
    ).toThrow('Unknown agent');
  });

  // -----------------------------------------------------------------------
  // getAllConfigs
  // -----------------------------------------------------------------------

  it('should return all 11 agent configs', () => {
    const configs = manager.getAllConfigs();
    expect(configs.length).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

describe('AgentSetupManager — Reporting', () => {
  let tempHome: string;
  let manager: AgentSetupManager;

  beforeEach(() => {
    tempHome = createTempHome();
    manager = new AgentSetupManager(tempHome);
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should generate a summary report', () => {
    const results: SetupResult[] = [
      {
        agent: 'cursor',
        detected: true,
        configured: true,
        configPath: '/home/user/.cursor/mcp.json',
        message: 'Configured Cursor',
      },
      {
        agent: 'claude-code',
        detected: true,
        configured: false,
        configPath: '/home/user/.claude/mcp.json',
        message: 'Failed to configure Claude Code: permission denied',
      },
    ];

    const report = manager.getReport(results);
    expect(report).toContain('Agent Integration Report');
    expect(report).toContain('Total agents processed: 2');
    expect(report).toContain('Configured successfully: 1');
    expect(report).toContain('Failed: 1');
    expect(report).toContain('Configured Agents:');
    expect(report).toContain('Failed Agents:');
  });

  it('should generate a status report', () => {
    const status = manager.getStatusReport();
    expect(status).toContain('Code Analyzer — Agent Integration Status');
    expect(status).toContain('Agent');
    expect(status).toContain('Installed');
    expect(status).toContain('Configured');
    expect(status).toContain('Claude Code');
    expect(status).toContain('Cursor');
    expect(status).toContain('Windsurf');
    // All 11 agents should appear by their display names
    const displayNames = [
      'Claude Code',
      'Cursor',
      'Windsurf',
      'Continue.dev',
      'Aider',
      'Cline',
      'Codex (OpenAI)',
      'Gemini CLI',
      'Cody (Sourcegraph)',
      'Amazon Q Developer',
      'GitHub Copilot Chat',
    ];
    for (const name of displayNames) {
      expect(status).toContain(name);
    }
  });

  it('should report empty results gracefully', () => {
    const report = manager.getReport([]);
    expect(report).toContain('Total agents processed: 0');
    expect(report).toContain('Configured successfully: 0');
    expect(report).toContain('Failed: 0');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('AgentSetupManager — Edge Cases', () => {
  let tempHome: string;
  let manager: AgentSetupManager;

  beforeEach(() => {
    tempHome = createTempHome();
    manager = new AgentSetupManager(tempHome);
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should handle corrupt JSON without crashing', () => {
    const configDir = path.join(tempHome, '.cursor');
    const configPath = path.join(configDir, 'mcp.json');

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, 'this is not json!', 'utf-8');

    const result = manager.configure('cursor');
    expect(result.configured).toBe(true);

    // Should still produce valid JSON
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers['code-analyzer']).toBeDefined();
  });

  it('should create parent directories if they do not exist', () => {
    // .gemini directory does not exist, but configure should create it
    const geminiDir = path.join(tempHome, '.gemini');
    expect(fs.existsSync(geminiDir)).toBe(false);

    const result = manager.configure('gemini-cli');
    expect(result.configured).toBe(true);
    expect(fs.existsSync(geminiDir)).toBe(true);
  });

  it('should not fail when configuring an undetected agent', () => {
    const result = manager.configure('windsurf');
    expect(result.configured).toBe(true);
    expect(result.detected).toBe(false);
  });

  it('should preserve non-MCP settings in VS Code settings.json', () => {
    const vscodeDir = path.join(tempHome, '.vscode');
    const settingsPath = path.join(vscodeDir, 'settings.json');

    fs.mkdirSync(vscodeDir, { recursive: true });
    const existing = JSON.stringify(
      {
        'editor.fontSize': 14,
        'editor.tabSize': 2,
      },
      null,
      2,
    );
    fs.writeFileSync(settingsPath, existing, 'utf-8');

    const result = manager.configure('copilot-chat');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed['editor.fontSize']).toBe(14);
    expect(parsed['editor.tabSize']).toBe(2);
    expect(
      parsed['github.copilot.chat.mcpServers']['code-analyzer'],
    ).toBeDefined();
  });

  it('should handle Aider config with existing non-MCP settings', () => {
    const aiderPath = path.join(tempHome, '.aider.conf.yml');
    const existing = [
      'model: gpt-4',
      'edit_format: diff',
      '',
      '# Custom settings',
      'auto_commits: false',
      '',
    ].join('\n');
    fs.writeFileSync(aiderPath, existing, 'utf-8');

    const result = manager.configure('aider');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(aiderPath, 'utf-8');

    // Should preserve existing settings
    expect(content).toContain('model: gpt-4');
    expect(content).toContain('auto_commits: false');

    // Should add MCP section
    expect(content).toContain('mcp_servers:');
    expect(content).toContain('code-analyzer');
  });

  it('should merge into existing Cline config', () => {
    const clineDir = path.join(tempHome, '.cline');
    const settingsPath = path.join(clineDir, 'mcp_settings.json');

    fs.mkdirSync(clineDir, { recursive: true });
    const existing = JSON.stringify(
      {
        mcpServers: {
          'existing-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      },
      null,
      2,
    );
    fs.writeFileSync(settingsPath, existing, 'utf-8');

    const result = manager.configure('cline');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.mcpServers['existing-server']).toBeDefined();
    expect(parsed.mcpServers['code-analyzer']).toBeDefined();
  });

  it('should handle empty existing config files', () => {
    const configDir = path.join(tempHome, '.cursor');
    const configPath = path.join(configDir, 'mcp.json');

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '', 'utf-8');

    const result = manager.configure('cursor');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers['code-analyzer']).toBeDefined();
  });

  it('should handle Continue.dev existing config with other settings', () => {
    const continueDir = path.join(tempHome, '.continue');
    const configPath = path.join(continueDir, 'config.json');

    fs.mkdirSync(continueDir, { recursive: true });
    const existing = JSON.stringify(
      {
        models: [
          { model: 'gpt-4', provider: 'openai' },
        ],
        tabAutocompleteModel: { model: 'starcoder', provider: 'ollama' },
      },
      null,
      2,
    );
    fs.writeFileSync(configPath, existing, 'utf-8');

    const result = manager.configure('continue-dev');
    expect(result.configured).toBe(true);

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.models).toBeDefined();
    expect(parsed.tabAutocompleteModel).toBeDefined();
    expect(parsed.mcpServers['code-analyzer']).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Backup & Restore
  // -----------------------------------------------------------------------

  it('should cleanup backup files', () => {
    // Create existing config files so backups are created
    const cursorDir = path.join(tempHome, '.cursor');
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, 'mcp.json'), JSON.stringify({ old: true }), 'utf-8');
    fs.writeFileSync(path.join(claudeDir, 'mcp.json'), JSON.stringify({ old: true }), 'utf-8');

    manager.configure('cursor');
    manager.configure('claude-code');

    const removed = manager.cleanupBackups();
    expect(removed).toBe(2);
  });

  it('should restore from backup', () => {
    const configDir = path.join(tempHome, '.cursor');
    const configPath = path.join(configDir, 'mcp.json');

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ custom: 'original' }, null, 2),
      'utf-8',
    );

    manager.configure('cursor');

    // Should have created a backup
    const backupPath = configPath + '.code-analyzer-backup';
    expect(fs.existsSync(backupPath)).toBe(true);

    // Restore
    const msg = manager.restoreFromBackup('cursor');
    expect(msg).toContain('Restored');

    // Backup should be gone
    expect(fs.existsSync(backupPath)).toBe(false);

    // Original content should be restored
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.custom).toBe('original');
  });

  it('should report when no backup exists for restore', () => {
    const msg = manager.restoreFromBackup('cursor');
    expect(msg).toContain('No backup found');
  });
});

// ---------------------------------------------------------------------------
// Config Validation (all 11 agents)
// ---------------------------------------------------------------------------

describe('AgentSetupManager — All 11 Agent Configs', () => {
  // prettier-ignore
  const allAgents: SupportedAgent[] = [
    'claude-code', 'cursor', 'windsurf', 'continue-dev',
    'aider', 'cline', 'codex', 'gemini-cli',
    'cody', 'amazon-q', 'copilot-chat',
  ];

  let tempHome: string;
  let manager: AgentSetupManager;

  beforeEach(() => {
    tempHome = createTempHome();
    manager = new AgentSetupManager(tempHome);
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should have valid detection paths for all agents', () => {
    const configs = manager.getAllConfigs();
    expect(configs.length).toBe(11);

    for (const config of configs) {
      expect(config.detectionPaths.length).toBeGreaterThan(0);
      expect(typeof config.configPath).toBe('string');
      expect(config.configPath.length).toBeGreaterThan(0);
      expect(['json', 'yaml', 'toml']).toContain(config.configFormat);
    }
  });

  it.each(allAgents)(
    'should produce non-empty configuration for %s',
    (agent: SupportedAgent) => {
      const config = manager.getConfig(agent);
      const dir = path.dirname(path.join(tempHome, config.configPath));
      fs.mkdirSync(dir, { recursive: true });

      const result = manager.configure(agent);
      expect(result.configured).toBe(true);
      expect(result.message.length).toBeGreaterThan(0);

      const configPath = path.join(tempHome, config.configPath);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content.length).toBeGreaterThan(20);
    },
  );

  it.each(allAgents)(
    'should be detectable after directory creation for %s',
    (agent: SupportedAgent) => {
      const config = manager.getConfig(agent);
      const detectionDir = path.join(
        tempHome,
        config.detectionPaths[0],
      );

      // Create either a directory or file depending on the detection path
      if (config.detectionPaths[0].endsWith('.yml')) {
        const dir = path.dirname(detectionDir);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(detectionDir, '', 'utf-8');
      } else {
        fs.mkdirSync(detectionDir, { recursive: true });
      }

      const installed = manager.detectInstalled();
      expect(installed).toContain(agent);
    },
  );
});
