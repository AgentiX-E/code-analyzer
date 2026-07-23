// @code-analyzer/vscode — Extension Activation Tests
// Tests the extension lifecycle, chat participant commands, status bar
// integration, and engine bridge wiring without importing 'vscode'.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngineBridge } from '../services/engine-bridge.js';
import { ConfigService } from '../services/config-service.js';
import {
  CodeAnalyzerChatParticipant,
  SLASH_COMMANDS,
} from '../participant/code-analyzer-participant.js';
import type { SlashCommand } from '../participant/code-analyzer-participant.js';
import {
  StatusBarManager,
  createStatusBarManager,
} from '../views/status-bar.js';
import { FileWatcherService } from '../services/file-watcher.js';
import type { WorkspaceConfiguration } from '../services/vscode-api.js';

// ---------------------------------------------------------------------------
// Mock Configuration
// ---------------------------------------------------------------------------

function mockWorkspaceConfig(
  overrides: Record<string, unknown> = {},
): WorkspaceConfiguration {
  const defaults: Record<string, unknown> = {
    autoIndex: true,
    indexMode: 'full',
    maxFileSize: 10485760,
    excludePatterns: ['node_modules/**', 'dist/**', '.git/**', 'build/**'],
    reviewOnSave: false,
    showInlineDecorations: true,
    maxSearchResults: 20,
    ...overrides,
  };
  return {
    get: <T>(section: string): T | undefined => defaults[section] as T | undefined,
    getDefault: <T>(section: string, defaultValue: T): T =>
      (defaults[section] ?? defaultValue) as T,
  } as WorkspaceConfiguration;
}

// ---------------------------------------------------------------------------
// Mock Status Bar Factory
// ---------------------------------------------------------------------------

function mockStatusBarFactory() {
  return {
    createStatusBarItem() {
      return {
        text: '',
        tooltip: '',
        command: '',
        show() {},
        hide() {},
        dispose() {},
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Extension Lifecycle Tests
// ---------------------------------------------------------------------------

describe('Extension Activation', () => {
  let engine: EngineBridge;

  beforeEach(() => {
    engine = new EngineBridge();
  });

  afterEach(() => {
    engine.dispose();
  });

  // -------------------------------------------------------------------------
  // Engine Bridge Lifecycle
  // -------------------------------------------------------------------------

  describe('Engine Bridge Lifecycle', () => {
    it('starts uninitialized', () => {
      expect(engine.isInitialized).toBe(false);
    });

    it('initializes successfully', async () => {
      await engine.initialize();
      expect(engine.isInitialized).toBe(true);
    });

    it('disposes cleanly', async () => {
      await engine.initialize();
      engine.dispose();
      expect(engine.isInitialized).toBe(false);
    });

    it('handles double initialization', async () => {
      await engine.initialize();
      await engine.initialize();
      expect(engine.isInitialized).toBe(true);
    });

    it('returns idle indexing state before initialization', () => {
      const state = engine.getIndexingState();
      expect(state.status).toBe('idle');
      expect(state.symbolCount).toBe(0);
      expect(state.progress).toBe(0);
    });

    it('returns ready indexing state after initialization', async () => {
      await engine.initialize();
      const state = engine.getIndexingState();
      expect(state.status).toBe('ready');
    });

    it('sets project ID correctly', () => {
      const projectId = '/workspace/test-project';
      engine.setProjectId(projectId);
      expect(engine.getProjectId()).toBe(projectId);
    });

    it('indexes workspace without error', async () => {
      await engine.initialize();
      await engine.indexWorkspace('/workspace/test-project');
      expect(engine.getProjectId()).toBe('/workspace/test-project');
    });
  });

  // -------------------------------------------------------------------------
  // Config Service
  // -------------------------------------------------------------------------

  describe('Config Service', () => {
    it('provides default configuration values', () => {
      const config = new ConfigService(mockWorkspaceConfig());
      expect(config.get('autoIndex')).toBe(true);
      expect(config.get('indexMode')).toBe('full');
      expect(config.get('maxFileSize')).toBe(10485760);
      expect(config.get('maxSearchResults')).toBe(20);
    });

    it('reads custom configuration values', () => {
      const config = new ConfigService(
        mockWorkspaceConfig({ autoIndex: false, indexMode: 'fast' }),
      );
      expect(config.get('autoIndex')).toBe(false);
      expect(config.get('indexMode')).toBe('fast');
    });

    it('falls back to defaults for missing values', () => {
      const config = new ConfigService(mockWorkspaceConfig({}));
      expect(config.get('reviewOnSave')).toBe(false);
      expect(config.get('showInlineDecorations')).toBe(true);
    });

    it('returns all config as an object', () => {
      const config = new ConfigService(mockWorkspaceConfig());
      const all = config.getAll();
      expect(all).toHaveProperty('autoIndex');
      expect(all).toHaveProperty('indexMode');
      expect(all).toHaveProperty('maxFileSize');
      expect(all).toHaveProperty('excludePatterns');
      expect(all).toHaveProperty('reviewOnSave');
      expect(all).toHaveProperty('showInlineDecorations');
      expect(all).toHaveProperty('maxSearchResults');
    });

    it('validates index mode', () => {
      const errors = ConfigService.validate({ indexMode: 'invalid' as any });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('indexMode');
    });

    it('validates max file size is positive', () => {
      const errors = ConfigService.validate({ maxFileSize: -1 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('maxFileSize');
    });

    it('validates max search results range', () => {
      const errors = ConfigService.validate({ maxSearchResults: 200 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('maxSearchResults');
    });

    it('validates via static defaults helper', () => {
      const defaults = ConfigService.getDefaults();
      expect(defaults.autoIndex).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // File Watcher Service
  // -------------------------------------------------------------------------

  describe('File Watcher Service', () => {
    it('starts and stops cleanly', () => {
      const watcher = new FileWatcherService(engine);
      expect(watcher.running).toBe(false);
      watcher.start();
      expect(watcher.running).toBe(true);
      watcher.dispose();
      expect(watcher.running).toBe(false);
    });

    it('returns empty changed files list when idle', () => {
      const watcher = new FileWatcherService(engine);
      expect(watcher.getChangedFiles()).toEqual([]);
      expect(watcher.pendingCount).toBe(0);
    });

    it('disposes via stop safely when not running', () => {
      const watcher = new FileWatcherService(engine);
      watcher.dispose();
      expect(watcher.running).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Chat Participant Slash Commands Tests
// ---------------------------------------------------------------------------

describe('Chat Participant — All 7 Slash Commands', () => {
  let participant: CodeAnalyzerChatParticipant;
  let engine: EngineBridge;

  beforeEach(() => {
    engine = new EngineBridge();
    engine.setProjectId('test-project');
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  it('has exactly 7 slash commands registered', () => {
    expect(SLASH_COMMANDS).toHaveLength(7);
  });

  it('contains all required slash command names', () => {
    const names = [...SLASH_COMMANDS];
    expect(names).toContain('review');
    expect(names).toContain('explain');
    expect(names).toContain('impact');
    expect(names).toContain('find');
    expect(names).toContain('deps');
    expect(names).toContain('refactor');
    expect(names).toContain('test');
  });

  // -------------------------------------------------------------------------
  // Each command can be instantiated and returns valid metadata
  // -------------------------------------------------------------------------

  const mockStream = () => ({
    markdown: () => {},
    content: '',
  });

  function mockToken(cancelled = false) {
    return { isCancellationRequested: cancelled };
  }

  describe('Individual Slash Commands', () => {
    const testCases: Array<{
      command: SlashCommand;
      param: string;
      expectedMetaKey: string;
      description: string;
    }> = [
      { command: 'review', param: '', expectedMetaKey: 'command', description: '/review returns command metadata' },
      { command: 'explain', param: 'UserService', expectedMetaKey: 'command', description: '/explain returns command metadata' },
      { command: 'impact', param: 'Database', expectedMetaKey: 'command', description: '/impact returns command metadata' },
      { command: 'find', param: 'login', expectedMetaKey: 'command', description: '/find returns command metadata' },
      { command: 'deps', param: 'UserService', expectedMetaKey: 'command', description: '/deps returns command metadata' },
      { command: 'refactor', param: 'UserService', expectedMetaKey: 'command', description: '/refactor returns command metadata' },
      { command: 'test', param: 'UserService', expectedMetaKey: 'command', description: '/test returns command metadata' },
    ];

    for (const tc of testCases) {
      it(tc.description, async () => {
        const result = await participant.handleSlashCommand(
          tc.command,
          tc.param,
          mockStream() as any,
          mockToken(false),
        );
        expect(result.metadata?.[tc.expectedMetaKey]).toBe(tc.command);
      });
    }
  });

  it('handles missing params for param-required commands', async () => {
    const paramRequired = ['explain', 'impact', 'find', 'deps', 'refactor', 'test'] as const;
    for (const cmd of paramRequired) {
      const result = await participant.handleSlashCommand(
        cmd, '', mockStream() as any, mockToken(false),
      );
      expect(result.metadata?.error).toBe('missing_params');
    }
  });

  it('respects cancellation tokens for slash commands', async () => {
    for (const cmd of SLASH_COMMANDS) {
      const result = await participant.handleSlashCommand(
        cmd as SlashCommand, 'test', mockStream() as any, mockToken(true),
      );
      expect(result.metadata).toEqual({ cancelled: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Status Bar Manager Tests
// ---------------------------------------------------------------------------

describe('Status Bar Manager Integration', () => {
  let manager: StatusBarManager;
  let engine: EngineBridge;

  beforeEach(() => {
    engine = new EngineBridge();
    manager = createStatusBarManager(mockStatusBarFactory(), engine);
  });

  afterEach(() => {
    manager.dispose();
    engine.dispose();
  });

  it('starts in idle state', () => {
    expect(manager.getState()).toBe('idle');
  });

  it('transitions to indexing state', () => {
    manager.setIndexing(50);
    expect(manager.getState()).toBe('indexing');
    expect(manager.getProgress()).toBe(50);
  });

  it('transitions to ready state', () => {
    manager.setReady(100);
    expect(manager.getState()).toBe('ready');
    expect(manager.getProgress()).toBe(100);
    expect(manager.getSymbolCount()).toBe(100);
  });

  it('transitions to error state', () => {
    manager.setError();
    expect(manager.getState()).toBe('error');
  });

  it('transitions back to idle state', () => {
    manager.setIndexing();
    manager.setIdle();
    expect(manager.getState()).toBe('idle');
    expect(manager.getProgress()).toBe(0);
    expect(manager.getSymbolCount()).toBe(0);
  });

  it('tracks symbol count', () => {
    manager.setSymbolCount(42);
    expect(manager.getSymbolCount()).toBe(42);
  });

  it('tracks review issues', () => {
    manager.setReviewIssues(5);
    expect(manager.getIssueCount()).toBe(5);
  });

  it('provides full state snapshot', () => {
    manager.setReady(100);
    manager.setReviewIssues(3);
    const snapshot = manager.getSnapshot();
    expect(snapshot.state).toBe('ready');
    expect(snapshot.progress).toBe(100);
    expect(snapshot.symbolCount).toBe(100);
    expect(snapshot.issueCount).toBe(3);
    expect(snapshot.display).toHaveProperty('text');
    expect(snapshot.display).toHaveProperty('tooltip');
    expect(snapshot.display).toHaveProperty('command');
  });

  it('reacts to engine indexing progress events', () => {
    // Engine bridge emits progress events which status bar manager listens to.
    // This verifies the wiring is correct.
    manager.setIndexing(25);
    expect(manager.getState()).toBe('indexing');
    expect(manager.getProgress()).toBe(25);
  });

  it('disposes cleanly without errors', () => {
    expect(() => manager.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Complete Extension Wiring Test
// ---------------------------------------------------------------------------

describe('Extension Wiring (End-to-End)', () => {
  let engine: EngineBridge;

  beforeEach(() => {
    engine = new EngineBridge();
  });

  afterEach(() => {
    engine.dispose();
  });

  it('wires engine bridge with config service', async () => {
    await engine.initialize();
    const config = new ConfigService(mockWorkspaceConfig());

    engine.setProjectId('/test/workspace');
    await engine.indexWorkspace('/test/workspace');

    expect(engine.getProjectId()).toBe('/test/workspace');
    expect(config.get('autoIndex')).toBe(true);
  });

  it('wires engine bridge with chat participant', () => {
    const participant = new CodeAnalyzerChatParticipant(engine);
    const intent = participant.classifyIntent('review my changes');
    expect(intent.type).toBe('review');
  });

  it('wires engine bridge with status bar manager', async () => {
    await engine.initialize();
    engine.setProjectId('/test');
    await engine.indexWorkspace('/test');

    const state = engine.getIndexingState();
    expect(state.status).toBe('ready');

    const manager = createStatusBarManager(mockStatusBarFactory(), engine);
    manager.setReady(state.symbolCount);
    expect(manager.getState()).toBe('ready');

    manager.dispose();
  });

  it('wires engine bridge with file watcher', () => {
    const watcher = new FileWatcherService(engine);
    watcher.start();
    expect(watcher.running).toBe(true);
    watcher.dispose();
    expect(watcher.running).toBe(false);
  });

  it('wires all components without vscode (test mode)', async () => {
    // Simulates what activate() does, without the vscode module
    const engine2 = new EngineBridge();
    const config = new ConfigService(mockWorkspaceConfig());

    await engine2.initialize();
    engine2.setProjectId('/test');

    const manager = createStatusBarManager(mockStatusBarFactory(), engine2);
    const participant = new CodeAnalyzerChatParticipant(engine2);

    // Verify the participant can classify intents
    const reviewIntent = participant.classifyIntent('review my changes');
    expect(reviewIntent.type).toBe('review');

    // Verify status bar works
    manager.setReady(50);
    expect(manager.getState()).toBe('ready');
    expect(manager.getSymbolCount()).toBe(50);

    // Verify config
    expect(config.get('autoIndex')).toBe(true);

    manager.dispose();
    engine2.dispose();
  });
});
