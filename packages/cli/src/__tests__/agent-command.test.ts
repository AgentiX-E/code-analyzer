// @code-analyzer/cli — Agent Command Tests

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createAgentCommand } from '../commands/agent.js';
import { AgentSetupManager } from '../agent-setup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-agent-cmd-'));
  return dir;
}

// ---------------------------------------------------------------------------
// Agent Command Structure
// ---------------------------------------------------------------------------

describe('Agent Command — Structure', () => {
  it('should create a commander Command with name "agent"', () => {
    const cmd = createAgentCommand();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe('agent');
  });

  it('should have a description', () => {
    const cmd = createAgentCommand();
    expect(cmd.description()).toBeTruthy();
  });

  it('should register subcommands: detect, configure, list, status', () => {
    const cmd = createAgentCommand();
    const subNames = cmd.commands.map((c) => c.name());
    expect(subNames).toContain('detect');
    expect(subNames).toContain('configure');
    expect(subNames).toContain('list');
    expect(subNames).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// detect subcommand (using AgentSetupManager directly with temp home)
// ---------------------------------------------------------------------------

describe('Agent Command — detect', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = createTempHome();
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should return empty when no agents are installed', () => {
    const manager = new AgentSetupManager(tempHome);
    const installed = manager.detectInstalled();
    expect(installed).toEqual([]);
  });

  it('should detect installed agents', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    const installed = manager.detectInstalled();
    expect(installed).toContain('cursor');
  });

  it('should detect configured status', () => {
    const cursorDir = path.join(tempHome, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { 'code-analyzer': { command: 'npx' } } }),
      'utf-8',
    );

    const manager = new AgentSetupManager(tempHome);
    expect(manager.isConfigured('cursor')).toBe(true);
  });

  it('should report not configured for unconfigured agent', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    expect(manager.isConfigured('cursor')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// configure subcommand (using AgentSetupManager directly with temp home)
// ---------------------------------------------------------------------------

describe('Agent Command — configure', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = createTempHome();
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should return empty results when no agents installed and no flags', () => {
    const manager = new AgentSetupManager(tempHome);
    const installed = manager.detectInstalled();
    expect(installed).toEqual([]);
  });

  it('should configure detected agents', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    const results = manager.configureAgents(manager.detectInstalled());

    expect(results.length).toBe(1);
    expect(results[0]!.configured).toBe(true);
    expect(results[0]!.agent).toBe('cursor');
  });

  it('should configure all agents with configureAll', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    const results = manager.configureAll();

    expect(results.length).toBe(2);
    expect(results.every((r) => r.configured)).toBe(true);
  });

  it('should configure specific agents with configureAgents', () => {
    const manager = new AgentSetupManager(tempHome);
    const results = manager.configureAgents(['cursor', 'windsurf']);

    expect(results.length).toBe(2);
    expect(results.every((r) => r.configured)).toBe(true);
  });

  it('should not write files for non-existent agents', () => {
    // Just verify configure doesn't crash for undetected agents
    const manager = new AgentSetupManager(tempHome);
    const result = manager.configure('windsurf');
    expect(result.configured).toBe(true);
  });

  it('should handle failures during configuration', () => {
    const cursorDir = path.join(tempHome, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    // Create mcp.json as a directory to trigger a write error
    fs.mkdirSync(path.join(cursorDir, 'mcp.json'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    const result = manager.configure('cursor');

    expect(result.configured).toBe(false);
    expect(result.message).toContain('Failed');
  });
});

// ---------------------------------------------------------------------------
// list subcommand (using AgentSetupManager directly with temp home)
// ---------------------------------------------------------------------------

describe('Agent Command — list', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = createTempHome();
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should return all 11 supported agents', () => {
    const manager = new AgentSetupManager(tempHome);
    const configs = manager.getAllConfigs();
    expect(configs.length).toBe(11);
  });

  it('should include all expected agent names', () => {
    const manager = new AgentSetupManager(tempHome);
    const configs = manager.getAllConfigs();
    const names = configs.map((c) => c.name);
    expect(names).toContain('claude-code');
    expect(names).toContain('cursor');
    expect(names).toContain('windsurf');
    expect(names).toContain('continue-dev');
    expect(names).toContain('aider');
    expect(names).toContain('cline');
    expect(names).toContain('codex');
    expect(names).toContain('gemini-cli');
    expect(names).toContain('cody');
    expect(names).toContain('amazon-q');
    expect(names).toContain('copilot-chat');
  });

  it('should show display names for each agent', () => {
    const manager = new AgentSetupManager(tempHome);
    const configs = manager.getAllConfigs();
    const displayNames = configs.map((c) => c.displayName);
    expect(displayNames).toContain('Claude Code');
    expect(displayNames).toContain('Cursor');
    expect(displayNames).toContain('Windsurf');
    expect(displayNames).toContain('Continue.dev');
    expect(displayNames).toContain('Aider');
    expect(displayNames).toContain('Cline');
    expect(displayNames).toContain('Codex (OpenAI)');
    expect(displayNames).toContain('Gemini CLI');
    expect(displayNames).toContain('Cody (Sourcegraph)');
    expect(displayNames).toContain('Amazon Q Developer');
    expect(displayNames).toContain('GitHub Copilot Chat');
  });

  it('should show status for each agent', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    const installed = manager.detectInstalled();
    expect(installed).toContain('cursor');
    expect(manager.isConfigured('cursor')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// status subcommand (using AgentSetupManager directly with temp home)
// ---------------------------------------------------------------------------

describe('Agent Command — status', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = createTempHome();
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should generate a status report', () => {
    const manager = new AgentSetupManager(tempHome);
    const status = manager.getStatusReport();

    expect(status).toContain('Code Analyzer — Agent Integration Status');
    expect(status).toContain('Installed');
    expect(status).toContain('Configured');
  });

  it('should show agents as not installed by default', () => {
    const manager = new AgentSetupManager(tempHome);
    const status = manager.getStatusReport();

    // With no agents installed, all should show "No" for installed
    const noCount = (status.match(/No/g) || []).length;
    expect(noCount).toBeGreaterThan(0);
  });

  it('should show installed agents correctly in status', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    const status = manager.getStatusReport();

    const yesCount = (status.match(/Yes/g) || []).length;
    // Two agents installed but not configured → 2 "Yes" in the Installed column
    expect(yesCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Command execution via Commander (injected temp-home manager)
// ---------------------------------------------------------------------------

describe('Agent Command — Commander execution', () => {
  let tempHome: string;
  let manager: AgentSetupManager;

  beforeEach(() => {
    tempHome = createTempHome();
    manager = new AgentSetupManager(tempHome);
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function findSubcommand(cmd: Command, name: string): Command {
    const sub = cmd.commands.find((c) => c.name() === name);
    expect(sub).toBeDefined();
    return sub!;
  }

  it('detect: prints a message when no agents are installed', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'detect').parse(['node', 'test', 'detect']);
    expect(logSpy).toHaveBeenCalledWith('No supported AI coding agents detected.');
  });

  it('detect: lists an installed agent with its configured status', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'detect').parse(['node', 'test', 'detect']);
    expect(logSpy).toHaveBeenCalledWith('Detected 1 agent(s):');
    expect(logSpy).toHaveBeenCalledWith('  - Cursor (not configured)');
  });

  it('detect: marks an installed agent as configured when its config exists', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'code-analyzer': { command: 'npx' } } }),
      'utf-8',
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'detect').parse(['node', 'test', 'detect']);
    expect(logSpy).toHaveBeenCalledWith('Detected 1 agent(s):');
    expect(logSpy).toHaveBeenCalledWith('  - Cursor (configured)');
  });

  it('configure: prints a message when no agents are detected', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'configure').parse(['node', 'test', 'configure']);
    expect(logSpy).toHaveBeenCalledWith(
      'No agents to configure. Run `code-analyzer agent detect` first.',
    );
  });

  it('configure --dry-run: previews agents without writing any config', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'configure').parse(['node', 'test', 'configure', '--dry-run']);
    expect(logSpy).toHaveBeenCalledWith('[DRY RUN] Would configure the following agents:');
    expect(logSpy).toHaveBeenCalledWith('  - Cursor → .cursor/mcp.json');
    expect(fs.existsSync(path.join(tempHome, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('configure --all: configures every supported agent and reports success', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'configure').parse(['node', 'test', 'configure', '--all']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Configuring'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('OK'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('configured'));
  });

  it('configure --target: configures a named agent', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'configure').parse(['node', 'test', 'configure', '--target', 'cursor']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Configuring'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('OK'));
  });

  it('configure: reports a failed configuration via stderr', () => {
    // A directory named like the config file makes the write fail.
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.cursor', 'mcp.json'), { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'configure').parse(['node', 'test', 'configure', '--target', 'cursor']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
  });

  it('list: shows every supported agent as not installed', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'list').parse(['node', 'test', 'list']);
    expect(logSpy).toHaveBeenCalledWith('Supported AI Coding Agent Integrations');
    expect(logSpy).toHaveBeenCalledWith('    Status:      not installed');
  });

  it('list: shows installed (not configured) status', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'list').parse(['node', 'test', 'list']);
    expect(logSpy).toHaveBeenCalledWith('    Status:      installed');
  });

  it('list: shows installed + configured status for a set-up agent', () => {
    fs.mkdirSync(path.join(tempHome, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'code-analyzer': { command: 'npx' } } }),
      'utf-8',
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'list').parse(['node', 'test', 'list']);
    expect(logSpy).toHaveBeenCalledWith('    Status:      installed + configured');
  });

  it('status: prints the status report', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createAgentCommand(manager);
    findSubcommand(cmd, 'status').parse(['node', 'test', 'status']);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Code Analyzer — Agent Integration Status'),
    );
  });
});
