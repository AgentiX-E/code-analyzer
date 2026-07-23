/**
 * Tests for MCP Configuration Templates.
 */

import { describe, it, expect } from 'vitest';
import { getMcpTemplate, getAgentSetupGuide, getQuickSetup } from '../../agents/templates.js';
import { getSupportedAgents } from '../../agents/detector.js';
import type { AgentId } from '../../agents/types.js';

describe('MCP Config Templates', () => {
  it('should return template for all 12 agents', () => {
    for (const id of getSupportedAgents()) {
      const template = getMcpTemplate(id);
      expect(template).toBeDefined();
      expect(template!.agentId).toBe(id);
      expect(template!.transport).toBe('stdio');
      expect(template!.config).toBeTruthy();
      expect(template!.configPath).toBeTruthy();
      expect(template!.instructions).toBeTruthy();
    }
  });

  it('should return null for unknown agent', () => {
    expect(getMcpTemplate('nonexistent' as AgentId)).toBeNull();
  });

  it('should produce valid JSON configs', () => {
    for (const id of getSupportedAgents()) {
      const template = getMcpTemplate(id)!;
      if (template.config.startsWith('{') || template.config.startsWith('[')) {
        expect(() => JSON.parse(template.config)).not.toThrow();
      }
    }
  });

  it('should include command in config', () => {
    const template = getMcpTemplate('claude-code')!;
    expect(template.config).toContain('@code-analyzer/mcp');
  });

  it('should accept custom command', () => {
    const template = getMcpTemplate('cursor', {
      command: 'node /path/to/mcp/index.js',
    });
    expect(template).toBeDefined();
  });

  it('should accept custom args', () => {
    const template = getMcpTemplate('claude-code', {
      args: ['--port', '3000'],
    });
    expect(template!.config).toContain('--port');
    expect(template!.config).toContain('3000');
  });

  it('should accept custom env vars', () => {
    const template = getMcpTemplate('claude-code', {
      env: { LOG_LEVEL: 'debug' },
    });
    expect(template!.config).toContain('LOG_LEVEL');
  });

  // Agent-specific templates
  it('claude-code config should reference claude_desktop_config.json', () => {
    const t = getMcpTemplate('claude-code')!;
    expect(t.configPath).toBe('~/.claude/claude_desktop_config.json');
  });

  it('cursor config should reference cursor/mcp.json', () => {
    const t = getMcpTemplate('cursor')!;
    expect(t.configPath).toBe('~/.cursor/mcp.json');
  });

  it('windsurf config should reference windsurf mcp_config', () => {
    const t = getMcpTemplate('windsurf')!;
    expect(t.configPath).toBe('~/.codeium/windsurf/mcp_config.json');
  });

  it('continue-dev config should use array format for mcpServers', () => {
    const t = getMcpTemplate('continue-dev')!;
    expect(t.config).toContain('"mcpServers"');
    expect(t.config).toContain('"name"');
  });

  it('aider config should be YAML format', () => {
    const t = getMcpTemplate('aider')!;
    expect(t.config).toContain('mcp_servers:');
    expect(t.config).toContain('.aider.conf.yml');
  });

  it('cline config should include autoApprove', () => {
    const t = getMcpTemplate('cline')!;
    expect(t.config).toContain('autoApprove');
  });

  it('github-copilot config should use servers key', () => {
    const t = getMcpTemplate('github-copilot')!;
    expect(t.config).toContain('"servers"');
  });

  it('codeium config path should be correct', () => {
    const t = getMcpTemplate('codeium')!;
    expect(t.configPath).toBe('~/.codeium/mcp.json');
  });

  it('tabnine config path should be correct', () => {
    const t = getMcpTemplate('tabnine')!;
    expect(t.configPath).toBe('~/.tabnine/mcp.json');
  });

  it('amazon-q config path should be correct', () => {
    const t = getMcpTemplate('amazon-q')!;
    expect(t.configPath).toBe('~/.aws/amazonq/mcp.json');
  });

  it('roo-code config should include autoApprove', () => {
    const t = getMcpTemplate('roo-code')!;
    expect(t.config).toContain('autoApprove');
    expect(t.configPath).toBe('~/.roo/mcp_settings.json');
  });

  it('augment-code config path should be correct', () => {
    const t = getMcpTemplate('augment-code')!;
    expect(t.configPath).toBe('~/.augment/mcp.json');
  });
});

describe('getAgentSetupGuide', () => {
  it('should return guide for all agents', () => {
    for (const id of getSupportedAgents()) {
      const guide = getAgentSetupGuide(id);
      expect(guide).toBeTruthy();
      expect(guide.length).toBeGreaterThan(50);
    }
  });

  it('should return error message for unknown agent', () => {
    const guide = getAgentSetupGuide('unknown' as AgentId);
    expect(guide).toContain('No setup guide available');
  });

  it('should include config in guide', () => {
    const guide = getAgentSetupGuide('claude-code');
    expect(guide).toContain('@code-analyzer/mcp');
    expect(guide).toContain('```json');
  });

  it('should include prerequisites and verification steps', () => {
    const guide = getAgentSetupGuide('cursor');
    expect(guide).toContain('Prerequisites');
    expect(guide).toContain('Node.js >= 20');
    expect(guide).toContain('Verification');
  });
});

describe('getQuickSetup', () => {
  it('should return a non-empty string for all agents', () => {
    for (const id of getSupportedAgents()) {
      expect(getQuickSetup(id).length).toBeGreaterThan(0);
    }
  });

  it('should return empty string for unknown agent', () => {
    expect(getQuickSetup('unknown' as AgentId)).toBe('');
  });

  it('should mention the config path', () => {
    const setup = getQuickSetup('claude-code');
    expect(setup).toContain('claude-code');
    expect(setup).toContain('claude_desktop_config.json');
  });
});
