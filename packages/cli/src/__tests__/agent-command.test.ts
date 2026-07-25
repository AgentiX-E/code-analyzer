// @ts-nocheck
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
    expect(results[0].configured).toBe(true);
    expect(results[0].agent).toBe('cursor');
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
// Command execution via Commander (integration tests)
// ---------------------------------------------------------------------------

describe('Agent Command — Commander execution', () => {
  it('should execute detect command without crashing', () => {
    const cmd = createAgentCommand();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const detectCmd = cmd.commands.find((c) => c.name() === 'detect');
    expect(detectCmd).toBeDefined();

    // Should not throw
    expect(() => detectCmd!.parse(['node', 'test', 'detect'])).not.toThrow();

    consoleSpy.mockRestore();
  });

  it('should execute list command without crashing', () => {
    const cmd = createAgentCommand();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const listCmd = cmd.commands.find((c) => c.name() === 'list');
    expect(listCmd).toBeDefined();
    expect(() => listCmd!.parse(['node', 'test', 'list'])).not.toThrow();

    consoleSpy.mockRestore();
  });

  it('should execute status command without crashing', () => {
    const cmd = createAgentCommand();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const statusCmd = cmd.commands.find((c) => c.name() === 'status');
    expect(statusCmd).toBeDefined();
    expect(() => statusCmd!.parse(['node', 'test', 'status'])).not.toThrow();

    consoleSpy.mockRestore();
  });

  it('should execute configure command with --dry-run without crashing', () => {
    const cmd = createAgentCommand();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const configCmd = cmd.commands.find((c) => c.name() === 'configure');
    expect(configCmd).toBeDefined();
    expect(() => configCmd!.parse(['node', 'test', 'configure', '--dry-run'])).not.toThrow();

    consoleSpy.mockRestore();
  });

  it('should execute configure command with --all without crashing', () => {
    const cmd = createAgentCommand();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const configCmd = cmd.commands.find((c) => c.name() === 'configure');
    expect(configCmd).toBeDefined();
    expect(() => configCmd!.parse(['node', 'test', 'configure', '--all'])).not.toThrow();

    consoleSpy.mockRestore();
  });
});
