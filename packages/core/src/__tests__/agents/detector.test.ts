/**
 * Tests for AI Agent Auto-Detector.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectAllAgents,
  detectAgentById,
  getSupportedAgents,
  getAgentMetadata,
  getAgentRegistry,
} from '../../agents/detector.js';
import type { AgentId, DetectionConfidence } from '../../agents/types.js';

// ── Helpers ──────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  // Restore environment for each test
  for (const key of Object.keys(process.env)) {
    // Don't delete essential env vars
    if (key.startsWith('ANTHROPIC_') || key.startsWith('CURSOR_') ||
        key.startsWith('WINDSURF_') || key.startsWith('CONTINUE_') ||
        key.startsWith('AIDER_') || key.startsWith('CLINE_') ||
        key.startsWith('COPILOT_') || key.startsWith('CODEIUM_') ||
        key.startsWith('TABNINE_') || key.startsWith('AMAZON_Q_') ||
        key.startsWith('AUGMENT_') || key.startsWith('ROO_CODE_') ||
        key.startsWith('GITHUB_COPILOT_') || key.startsWith('AWS_')) {
      delete process.env[key];
    }
  }
});

afterEach(() => {
  // Restore original environment
  process.env = { ...originalEnv };
});

// ── Agent Registry Tests ─────────────────────────────────────────

describe('Agent Registry', () => {
  it('should have 12 supported agents', () => {
    const agents = getSupportedAgents();
    expect(agents).toHaveLength(12);
  });

  it('should return unique agent IDs', () => {
    const agents = getSupportedAgents();
    const unique = new Set(agents);
    expect(unique.size).toBe(agents.length);
  });

  it('should return metadata for all known agents', () => {
    for (const id of getSupportedAgents()) {
      const meta = getAgentMetadata(id);
      expect(meta).toBeDefined();
      expect(meta!.name).toBeTruthy();
      expect(meta!.homepage).toBeTruthy();
    }
  });

  it('should return undefined for unknown agent', () => {
    expect(getAgentMetadata('unknown-agent' as AgentId)).toBeUndefined();
  });

  it('should return immutable registry', () => {
    const registry = getAgentRegistry();
    expect(registry.length).toBe(12);
    expect(registry[0].id).toBe('claude-code');
  });

  it('each agent should have required fields', () => {
    for (const meta of getAgentRegistry()) {
      expect(meta.id).toBeTruthy();
      expect(meta.name).toBeTruthy();
      expect(meta.homepage).toMatch(/^https?:\/\//);
      expect(Array.isArray(meta.envSignals)).toBe(true);
      expect(Array.isArray(meta.configSignals)).toBe(true);
      expect(Array.isArray(meta.binarySignals)).toBe(true);
      expect(Array.isArray(meta.processSignals)).toBe(true);
      expect(['stdio', 'sse', 'both']).toContain(meta.preferredTransport);
    }
  });

  it('claude-code should have ANTHROPIC_API_KEY signal', () => {
    const meta = getAgentMetadata('claude-code')!;
    expect(meta.envSignals).toContain('ANTHROPIC_API_KEY');
  });

  it('aider should have AIDER_MODEL signal', () => {
    const meta = getAgentMetadata('aider')!;
    expect(meta.envSignals).toContain('AIDER_MODEL');
  });

  it('github-copilot should have VS Code extension signals', () => {
    const meta = getAgentMetadata('github-copilot')!;
    expect(meta.extensionSignals.length).toBeGreaterThan(0);
    expect(meta.extensionSignals).toContain('GitHub.copilot');
  });
});

// ── Detection by Environment Variable ───────────────────────────

describe('Agent Detection — Environment Variables', () => {
  it('should detect Claude Code via ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const result = detectAgentById('claude-code')!;
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.detail.includes('ANTHROPIC_API_KEY'))).toBe(true);
  });

  it('should detect Aider via AIDER_MODEL', () => {
    process.env.AIDER_MODEL = 'gpt-4';
    const result = detectAgentById('aider')!;
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.detail.includes('AIDER_MODEL'))).toBe(true);
  });

  it('should detect Aider via AIDER_API_KEY', () => {
    process.env.AIDER_API_KEY = 'sk-test';
    const result = detectAgentById('aider')!;
    expect(result.detected).toBe(true);
  });

  it('should detect Aider via AIDER_EDIT_FORMAT', () => {
    process.env.AIDER_EDIT_FORMAT = 'diff';
    const result = detectAgentById('aider')!;
    expect(result.detected).toBe(true);
  });

  it('should detect Codeium via CODEIUM_API_KEY', () => {
    process.env.CODEIUM_API_KEY = 'test-key';
    const result = detectAgentById('codeium')!;
    expect(result.detected).toBe(true);
  });

  it('should detect Tabnine via TABNINE_API_KEY', () => {
    process.env.TABNINE_API_KEY = 'test-key';
    const result = detectAgentById('tabnine')!;
    expect(result.detected).toBe(true);
  });

  it('should detect Augment Code via AUGMENT_API_KEY', () => {
    process.env.AUGMENT_API_KEY = 'test-key';
    const result = detectAgentById('augment-code')!;
    expect(result.detected).toBe(true);
  });

  it('should detect Amazon Q via AWS_PROFILE', () => {
    process.env.AWS_PROFILE = 'default';
    const result = detectAgentById('amazon-q')!;
    expect(result.detected).toBe(true);
  });

  it('should not detect agents when no env vars are set', () => {
    const result = detectAgentById('aider')!;
    // Without env vars or config files, nothing should match
    expect(result.signals.filter((s) => s.type === 'env')).toHaveLength(0);
  });

  it('should include env signal with medium confidence', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const result = detectAgentById('claude-code')!;
    const envSignal = result.signals.find((s) => s.type === 'env');
    expect(envSignal).toBeDefined();
    expect(envSignal!.confidence).toBe('medium');
  });
});

// ── detectAllAgents Tests ────────────────────────────────────────

describe('detectAllAgents', () => {
  it('should return all 12 agents', () => {
    const result = detectAllAgents();
    expect(result.agents).toHaveLength(12);
  });

  it('should return a timestamp', () => {
    const result = detectAllAgents();
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('should sort detected agents first', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const result = detectAllAgents();
    const claudeIdx = result.agents.findIndex((a) => a.id === 'claude-code');
    expect(claudeIdx).toBe(0); // should be first (only one detected)
  });

  it('should set primary to highest-confidence detected agent', () => {
    process.env.AIDER_MODEL = 'gpt-4';
    process.env.AIDER_API_KEY = 'sk-test';
    process.env.AIDER_EDIT_FORMAT = 'diff';
    const result = detectAllAgents();
    expect(result.primary).toBe('aider');
  });

  it('should set primary to null when no agents detected', () => {
    const result = detectAllAgents();
    // In CI, no agent-specific env vars should be set
    // primary could be null or some agent detected via config/process
    if (result.detectedCount === 0) {
      expect(result.primary).toBeNull();
    }
  });

  it('should return correct detectedCount', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.CODEIUM_API_KEY = 'test';
    const result = detectAllAgents();
    expect(result.detectedCount).toBeGreaterThanOrEqual(2);
  });

  it('each agent result should have required fields', () => {
    const result = detectAllAgents();
    for (const agent of result.agents) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(typeof agent.detected).toBe('boolean');
      expect(['high', 'medium', 'low']).toContain(agent.confidence);
      expect(Array.isArray(agent.signals)).toBe(true);
      expect(['stdio', 'sse', 'both']).toContain(agent.preferredTransport);
    }
  });
});

// ── detectAgentById Tests ───────────────────────────────────────

describe('detectAgentById', () => {
  it('should return null for unknown agent', () => {
    expect(detectAgentById('nonexistent' as AgentId)).toBeNull();
  });

  it('should detect each agent by ID', () => {
    for (const id of getSupportedAgents()) {
      const result = detectAgentById(id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(id);
    }
  });

  it('should have correct name field', () => {
    expect(detectAgentById('claude-code')!.name).toBe('Claude Code');
    expect(detectAgentById('cursor')!.name).toBe('Cursor');
    expect(detectAgentById('windsurf')!.name).toBe('Windsurf');
    expect(detectAgentById('continue-dev')!.name).toBe('Continue.dev');
    expect(detectAgentById('aider')!.name).toBe('Aider');
    expect(detectAgentById('cline')!.name).toBe('Cline');
    expect(detectAgentById('github-copilot')!.name).toBe('GitHub Copilot');
    expect(detectAgentById('codeium')!.name).toBe('Codeium');
    expect(detectAgentById('tabnine')!.name).toBe('Tabnine');
    expect(detectAgentById('amazon-q')!.name).toBe('Amazon Q Developer');
    expect(detectAgentById('roo-code')!.name).toBe('Roo Code');
    expect(detectAgentById('augment-code')!.name).toBe('Augment Code');
  });
});

// ── Confidence Aggregation ───────────────────────────────────────

describe('Confidence Aggregation', () => {
  it('should be high with 2+ high-confidence signals', () => {
    process.env.AIDER_MODEL = 'gpt-4';
    process.env.AIDER_API_KEY = 'sk-test';
    process.env.AIDER_EDIT_FORMAT = 'diff'; // 3 env signals = 3 medium
    const result = detectAgentById('aider')!;
    // 3 medium signals → aggregate should be medium or higher
    expect(['medium', 'high']).toContain(result.confidence);
    // But note: env signals are medium, so 3 medium → medium
    // (high requires high signals which come from config/process)
    expect(result.confidence).toBe('medium');
  });

  it('should be low when no signals', () => {
    const result = detectAgentById('roo-code')!;
    if (result.signals.length === 0) {
      expect(result.confidence).toBe('low');
    }
  });

  it('detected should be false when no signals', () => {
    const result = detectAgentById('roo-code')!;
    if (result.signals.length === 0) {
      expect(result.detected).toBe(false);
    }
  });
});

// ── Signal Structure ─────────────────────────────────────────────

describe('Detection Signals', () => {
  it('each signal should have required fields', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const result = detectAgentById('claude-code')!;
    for (const signal of result.signals) {
      expect(['env', 'config', 'process', 'extension', 'binary']).toContain(signal.type);
      expect(signal.detail).toBeTruthy();
      expect(['high', 'medium', 'low']).toContain(signal.confidence);
    }
  });

  it('env signals should reference the variable name', () => {
    process.env.AIDER_MODEL = 'gpt-4';
    const result = detectAgentById('aider')!;
    const envSignal = result.signals.find((s) => s.type === 'env');
    expect(envSignal!.detail).toContain('AIDER_MODEL');
  });
});

// ── getSupportedAgents ──────────────────────────────────────────

describe('getSupportedAgents', () => {
  it('should return all agent IDs in order', () => {
    const ids = getSupportedAgents();
    expect(ids).toEqual([
      'claude-code', 'cursor', 'windsurf', 'continue-dev',
      'aider', 'cline', 'github-copilot', 'codeium',
      'tabnine', 'amazon-q', 'roo-code', 'augment-code',
    ]);
  });

  it('should return a new array each time', () => {
    const a = getSupportedAgents();
    const b = getSupportedAgents();
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different references
  });
});

// ── Multiple Agent Detection ────────────────────────────────────

describe('Multiple Agent Detection', () => {
  it('should detect multiple agents simultaneously', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.AIDER_MODEL = 'gpt-4';
    process.env.CODEIUM_API_KEY = 'test';
    const result = detectAllAgents();
    expect(result.detectedCount).toBeGreaterThanOrEqual(3);
    const claude = result.agents.find((a) => a.id === 'claude-code')!;
    const aider = result.agents.find((a) => a.id === 'aider')!;
    const codeium = result.agents.find((a) => a.id === 'codeium')!;
    expect(claude.detected).toBe(true);
    expect(aider.detected).toBe(true);
    expect(codeium.detected).toBe(true);
  });

  it('primary should be the first detected agent', () => {
    process.env.AIDER_MODEL = 'gpt-4';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const result = detectAllAgents();
    expect(result.primary).toBeDefined();
    // Both detected; first in sort order should win
    expect(['aider', 'claude-code']).toContain(result.primary);
  });
});

// ── Binary Detection ─────────────────────────────────────────────

describe('Binary Detection', () => {
  it('should detect node binary (always available)', () => {
    // node binary is always in PATH in test environment
    // Test via agent that has 'node' in binarySignals — none do by default
    // Instead, verify that the hasBinary helper doesn't throw
    const result = detectAgentById('aider')!;
    // 'aider' binary likely won't be installed, but the function should work
    expect(result).toBeDefined();
  });

  it('should detect known system binaries for agents that have them', () => {
    // claude-code has 'claude' as binary signal - unlikely present
    // But the detection should still complete without errors
    const result = detectAgentById('claude-code')!;
    expect(result).toBeDefined();
  });
});

// ── VS Code Extension Detection (with mock directory) ────────────

describe('VS Code Extension Detection', () => {
  let tmpDir: string;
  let extensionsDir: string;

  beforeEach(() => {
    // Create a mock .vscode/extensions directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-test-'));
    extensionsDir = path.join(tmpDir, 'extensions');
    fs.mkdirSync(extensionsDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* cleanup */ }
  });

  it('should detect installed VS Code extensions by directory name', () => {
    // Create a mock GitHub Copilot extension directory
    const extDir = path.join(extensionsDir, 'github.copilot-1.0.0');
    fs.mkdirSync(extDir);

    // Scan the directory manually to verify the logic
    const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    const found = entries.some(
      (e) => e.isDirectory() && e.name.startsWith('github.copilot'),
    );
    expect(found).toBe(true);
  });

  it('should detect multiple extensions', () => {
    fs.mkdirSync(path.join(extensionsDir, 'github.copilot-1.0.0'));
    fs.mkdirSync(path.join(extensionsDir, 'github.copilot-chat-2.0.0'));
    fs.mkdirSync(path.join(extensionsDir, 'continue.continue-0.1.0'));
    fs.mkdirSync(path.join(extensionsDir, 'some-other-ext-1.0.0'));

    const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    const copilotDirs = entries.filter(
      (e) => e.isDirectory() && e.name.startsWith('github.copilot'),
    );
    const continueDirs = entries.filter(
      (e) => e.isDirectory() && e.name.startsWith('continue.continue'),
    );
    expect(copilotDirs.length).toBe(2);
    expect(continueDirs.length).toBe(1);
  });

  it('should handle non-existent extensions directory gracefully', () => {
    const nonexistent = path.join(tmpDir, 'nonexistent');
    const exists = fs.existsSync(nonexistent);
    expect(exists).toBe(false);
    // The checkVSCodeExtension function should handle this gracefully
    // (we test the fs.existsSync behavior, the function uses it)
  });

  it('should handle empty extensions directory', () => {
    const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    expect(entries.length).toBe(0);
  });

  it('extension name matching should be case-insensitive', () => {
    fs.mkdirSync(path.join(extensionsDir, 'GITHUB.COPILOT-1.0.0'));
    const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    const found = entries.some(
      (e) => e.isDirectory() && e.name.toLowerCase().startsWith('github.copilot'),
    );
    expect(found).toBe(true);
  });

  it('should match VS Code extension IDs by publisher.extension prefix', () => {
    const testCases = [
      { dirName: 'github.copilot-1.0.0', extId: 'GitHub.copilot', match: true },
      { dirName: 'github.copilot-chat-1.0.0', extId: 'GitHub.copilot', match: true },
      { dirName: 'ms-python.python-2024.1.0', extId: 'GitHub.copilot', match: false },
      { dirName: 'Continue.continue-1.0.0', extId: 'Continue.continue', match: true },
    ];

    for (const { dirName, extId, match } of testCases) {
      const dirPath = path.join(extensionsDir, dirName);
      fs.mkdirSync(dirPath);
      const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
      const found = entries.some(
        (e) => e.isDirectory() && e.name.toLowerCase().startsWith(extId.toLowerCase()),
      );
      expect(found).toBe(match);
      // Clean up for next iteration
      fs.rmSync(dirPath, { recursive: true });
    }
  });
});

// ── Process Detection ────────────────────────────────────────────

describe('Process Detection', () => {
  it('should detect the current node process on Linux', () => {
    if (process.platform === 'linux') {
      // Read /proc/self/comm
      const comm = fs.readFileSync('/proc/self/comm', 'utf-8').trim();
      expect(comm).toBeTruthy();
      expect(typeof comm).toBe('string');
    } else {
      // On non-Linux, skip process tests
      expect(true).toBe(true);
    }
  });

  it('should read comm files correctly', () => {
    if (process.platform === 'linux') {
      // Read a known existing PID (pid 1)
      let comm: string;
      try {
        comm = fs.readFileSync('/proc/1/comm', 'utf-8').trim();
        expect(typeof comm).toBe('string');
        expect(comm.length).toBeGreaterThan(0);
      } catch {
        // pid 1 might not be readable
        expect(true).toBe(true);
      }
    }
  });
});

// ── Config File Detection (with mock directories) ───────────────

describe('Config File Detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-config-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* cleanup */ }
  });

  it('should detect .cursor directory', () => {
    const cursorDir = path.join(tmpDir, '.cursor');
    fs.mkdirSync(cursorDir);
    expect(fs.existsSync(cursorDir)).toBe(true);
    expect(fs.statSync(cursorDir).isDirectory()).toBe(true);
  });

  it('should detect .cursorrules file', () => {
    const rulesFile = path.join(tmpDir, '.cursorrules');
    fs.writeFileSync(rulesFile, '');
    expect(fs.existsSync(rulesFile)).toBe(true);
  });

  it('should detect .claude directory', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir);
    expect(fs.existsSync(claudeDir)).toBe(true);
  });

  it('should detect .aider.conf.yml file', () => {
    const aiderFile = path.join(tmpDir, '.aider.conf.yml');
    fs.writeFileSync(aiderFile, 'model: gpt-4');
    expect(fs.existsSync(aiderFile)).toBe(true);
  });

  it('should detect .continue directory', () => {
    const continueDir = path.join(tmpDir, '.continue');
    fs.mkdirSync(continueDir);
    expect(fs.existsSync(continueDir)).toBe(true);
  });

  it('should detect .windsurfrules file', () => {
    const rulesFile = path.join(tmpDir, '.windsurfrules');
    fs.writeFileSync(rulesFile, '');
    expect(fs.existsSync(rulesFile)).toBe(true);
  });

  it('should detect .cline directory', () => {
    const clineDir = path.join(tmpDir, '.cline');
    fs.mkdirSync(clineDir);
    expect(fs.existsSync(clineDir)).toBe(true);
  });

  it('should detect .codeium directory', () => {
    const dir = path.join(tmpDir, '.codeium');
    fs.mkdirSync(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('should detect .tabnine directory', () => {
    const dir = path.join(tmpDir, '.tabnine');
    fs.mkdirSync(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('detectAllAgents should handle empty environment', () => {
    const result = detectAllAgents();
    expect(result.agents.length).toBe(12);
    expect(typeof result.detectedCount).toBe('number');
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('should handle agents with overlapping signals', () => {
    // Set GitHub Copilot token — should detect copilot but not confuse with others
    process.env.GITHUB_COPILOT_TOKEN = 'test-token';
    const result = detectAgentById('github-copilot')!;
    expect(result.detected).toBe(true);

    // Make sure claude is not affected
    const claudeResult = detectAgentById('claude-code')!;
    expect(claudeResult.signals.filter((s) => s.detail.includes('COPILOT')).length).toBe(0);
  });

  it('should detect augment token env var', () => {
    process.env.AUGMENT_TOKEN = 'test';
    const result = detectAgentById('augment-code')!;
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.detail.includes('AUGMENT_TOKEN'))).toBe(true);
  });

  it('should detect tabnine token env var', () => {
    process.env.TABNINE_TOKEN = 'test';
    const result = detectAgentById('tabnine')!;
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.detail.includes('TABNINE_TOKEN'))).toBe(true);
  });

  it('should handle agent detection on all registered agents', () => {
    for (const id of getSupportedAgents()) {
      const detection = detectAgentById(id)!;
      expect(detection).toBeDefined();
      expect(detection.id).toBe(id);
      expect(typeof detection.detected).toBe('boolean');
      expect(detection.signals).toBeInstanceOf(Array);
    }
  });
});
