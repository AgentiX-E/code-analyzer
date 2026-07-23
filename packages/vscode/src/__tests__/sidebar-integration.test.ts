// @code-analyzer/vscode — Sidebar Integration Tests
// Tests the integration between sidebar, engine, graph explorer,
// review decorations, and tree view providers.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngineBridge } from '../services/engine-bridge.js';
import { SidebarLogic } from '../providers/sidebar-provider.js';
import { GraphExplorerLogic } from '../providers/graph-explorer.js';
import { ReviewDecorationLogic } from '../providers/review-decoration-provider.js';
import { GraphTreeDataProviderLogic } from '../providers/tree-view-provider.js';
import { ConfigService } from '../services/config-service.js';
import { ConfigLogic } from '../providers/config-provider.js';
import { StatusBarManager, createStatusBarManager } from '../views/status-bar.js';
import type { WorkspaceConfiguration } from '../services/vscode-api.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockWorkspaceConfig(overrides: Record<string, unknown> = {}): WorkspaceConfiguration {
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
  } as WorkspaceConfiguration;
}

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
// Sidebar + Engine Integration
// ---------------------------------------------------------------------------

describe('Sidebar + Engine Integration', () => {
  let engine: EngineBridge;
  let sidebarLogic: SidebarLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    engine.setProjectId('test-project');
    sidebarLogic = new SidebarLogic(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  it('handles search through sidebar', async () => {
    const response = await sidebarLogic.handleMessage({
      command: 'search',
      query: 'test',
    });
    expect(response.command).toBe('searchResults');
    expect(Array.isArray(response.results)).toBe(true);
  });

  it('handles review through sidebar', async () => {
    const response = await sidebarLogic.handleMessage({
      command: 'review',
    });
    expect(response.command).toBe('reviewResults');
    expect(Array.isArray(response.comments)).toBe(true);
  });

  it('handles getChangedFiles through sidebar', async () => {
    const response = await sidebarLogic.handleMessage({
      command: 'getChangedFiles',
    });
    expect(response.command).toBe('changedFilesResults');
    expect(Array.isArray(response.files)).toBe(true);
  });

  it('handles getProjectInfo with full state', async () => {
    const response = await sidebarLogic.handleMessage({
      command: 'getProjectInfo',
    });
    expect(response.command).toBe('projectInfo');
    expect(response.projectId).toBe('test-project');
    expect(response).toHaveProperty('symbolCount');
    expect(response).toHaveProperty('status');
    expect(response).toHaveProperty('progress');
  });

  it('handles navigate command', async () => {
    const response = await sidebarLogic.handleMessage({
      command: 'navigate',
      filePath: '/test/file.ts',
    });
    expect(response.command).toBe('navigate');
    expect(response.filePath).toBe('/test/file.ts');
  });

  it('handles getGraphData through sidebar', async () => {
    const response = await sidebarLogic.handleMessage({
      command: 'getGraphData',
    });
    expect(response.command).toBe('graphData');
    expect(Array.isArray(response.nodes)).toBe(true);
    expect(Array.isArray(response.edges)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Graph Explorer + Engine Integration
// ---------------------------------------------------------------------------

describe('Graph Explorer + Engine Integration', () => {
  let engine: EngineBridge;
  let graphLogic: GraphExplorerLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    graphLogic = new GraphExplorerLogic(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  it('returns empty graph when no project', async () => {
    const data = await graphLogic.getGraphData();
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it('returns empty graph for initialized project with no symbols', async () => {
    engine.setProjectId('test-project');
    const data = await graphLogic.getGraphData();
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it('node detail returns undefined for non-existent node', async () => {
    engine.setProjectId('test');
    const detail = await graphLogic.getNodeDetail(999);
    expect(detail).toBeUndefined();
  });

  it('node colors are consistent with sidebar provider', () => {
    expect(graphLogic.getNodeColor('Function')).toBe('#569cd6');
    expect(graphLogic.getNodeColor('Class')).toBe('#4ec9b0');
  });
});

// ---------------------------------------------------------------------------
// Review Decorations + Comment Logic Integration
// ---------------------------------------------------------------------------

describe('Review Decorations Integration', () => {
  const reviewLogic = new ReviewDecorationLogic();

  it('decoration configs map correctly to severity', () => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
    for (const sev of severities) {
      const config = reviewLogic.getDecorationConfig(sev);
      expect(config.severity).toBe(sev);
      expect(config.overviewRulerColor).toBeTruthy();
      expect(config.borderColor).toBeTruthy();
    }
  });

  it('hover content has required fields', () => {
    const comment = {
      severity: 'high',
      title: 'Test',
      path: 'file.ts',
      startLine: 1,
      endLine: 2,
      message: 'test message',
    };
    const content = reviewLogic.buildHoverContent(comment);
    expect(content.title).toBeTruthy();
    expect(content.message).toBeTruthy();
    expect(content.severity).toBeTruthy();
    expect(content.category).toBeTruthy();
  });

  it('codelens actions always include Explain', () => {
    const comment = {
      severity: 'critical',
      title: 'Test',
      path: 'file.ts',
      startLine: 1,
      endLine: 2,
      message: 'test',
    };
    const actions = reviewLogic.getCodeLensActions(comment);
    expect(actions.some((a) => a.title.includes('Explain'))).toBe(true);
  });

  it('badge SVGs are valid XML-like strings', () => {
    for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as const) {
      const svg = reviewLogic.getSeverityBadgeSvg(sev);
      expect(svg).toContain('xmlns');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    }
  });
});

// ---------------------------------------------------------------------------
// Tree View + Engine Integration
// ---------------------------------------------------------------------------

describe('Tree View + Engine Integration', () => {
  let engine: EngineBridge;
  let treeLogic: GraphTreeDataProviderLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    treeLogic = new GraphTreeDataProviderLogic(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  it('returns empty roots when no project', async () => {
    const roots = await treeLogic.getRootItems();
    expect(roots).toEqual([]);
  });

  it('returns project root when project set', async () => {
    engine.setProjectId('/test/proj');
    const roots = await treeLogic.getRootItems();
    expect(roots.length).toBe(1);
    expect(roots[0].label).toBe('proj');
  });

  it('parent chain: symbol → module → project', () => {
    engine.setProjectId('/test');
    const moduleParent = treeLogic.getParent('symbol:test:src:myFunc');
    expect(moduleParent?.contextValue).toBe('module');

    const projectParent = treeLogic.getParent('module:test:src');
    expect(projectParent?.contextValue).toBe('project');
  });

  it('icon mapping covers all standard labels', () => {
    const labels = ['Function', 'Class', 'Interface', 'Method', 'Module',
      'Variable', 'Enum', 'Property', 'Route', 'Test', 'Config'];
    for (const label of labels) {
      const icon = treeLogic.getIconForLabel(label);
      expect(icon.length).toBeGreaterThan(0);
      expect(icon).not.toBe('symbol-misc');
    }
  });
});

// ---------------------------------------------------------------------------
// Config + Service Integration
// ---------------------------------------------------------------------------

describe('Config + Service Integration', () => {
  it('ConfigLogic wraps ConfigService correctly', () => {
    const config = new ConfigService(mockWorkspaceConfig({
      autoIndex: false,
      indexMode: 'fast',
    }));
    const logic = new ConfigLogic(config);

    const all = logic.getConfig();
    expect(all.autoIndex).toBe(false);
    expect(all.indexMode).toBe('fast');
  });

  it('ConfigLogic returns defaults', () => {
    const config = new ConfigService(mockWorkspaceConfig());
    const logic = new ConfigLogic(config);
    const defaults = logic.getDefaults();
    expect(defaults.autoIndex).toBe(true);
    expect(defaults.indexMode).toBe('full');
  });

  it('ConfigLogic validates invalid config', () => {
    const config = new ConfigService(mockWorkspaceConfig());
    const logic = new ConfigLogic(config);
    const errors = logic.validate({ maxFileSize: -5 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('ConfigLogic validates valid config', () => {
    const config = new ConfigService(mockWorkspaceConfig());
    const logic = new ConfigLogic(config);
    const errors = logic.validate({ maxFileSize: 1000 });
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Status Bar + Engine Integration
// ---------------------------------------------------------------------------

describe('Status Bar + Engine Integration', () => {
  let engine: EngineBridge;
  let manager: StatusBarManager;

  beforeEach(() => {
    engine = new EngineBridge();
    manager = createStatusBarManager(mockStatusBarFactory(), engine);
  });

  afterEach(() => {
    manager.dispose();
    engine.dispose();
  });

  it('starts idle', () => {
    expect(manager.getState()).toBe('idle');
  });

  it('transitions through all states', () => {
    manager.setIndexing(50);
    expect(manager.getState()).toBe('indexing');
    expect(manager.getProgress()).toBe(50);

    manager.setReady(100);
    expect(manager.getState()).toBe('ready');
    expect(manager.getProgress()).toBe(100);

    manager.setError();
    expect(manager.getState()).toBe('error');

    manager.setIdle();
    expect(manager.getState()).toBe('idle');
  });

  it('snapshot contains all state fields', () => {
    manager.setReady(42);
    manager.setReviewIssues(3);
    const snap = manager.getSnapshot();
    expect(snap.state).toBe('ready');
    expect(snap.symbolCount).toBe(42);
    expect(snap.issueCount).toBe(3);
    expect(snap.progress).toBe(100);
    expect(snap.display).toHaveProperty('text');
  });

  it('disposes without error', () => {
    expect(() => manager.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Full Component Wiring Test
// ---------------------------------------------------------------------------

describe('Full Component Wiring', () => {
  it('all providers can be instantiated with the same engine', () => {
    const engine = new EngineBridge();
    engine.setProjectId('test');

    const sidebar = new SidebarLogic(engine);
    const graph = new GraphExplorerLogic(engine);
    const tree = new GraphTreeDataProviderLogic(engine);
    const review = new ReviewDecorationLogic();
    const config = new ConfigService(mockWorkspaceConfig());
    const configLogic = new ConfigLogic(config);

    expect(sidebar).toBeDefined();
    expect(graph).toBeDefined();
    expect(tree).toBeDefined();
    expect(review).toBeDefined();
    expect(configLogic).toBeDefined();

    engine.dispose();
  });

  it('sidebar handles all message types without crashing', async () => {
    const engine = new EngineBridge();
    engine.setProjectId('test');
    const sidebar = new SidebarLogic(engine);

    const commands = ['search', 'review', 'checkStandards', 'getChangedFiles',
      'getProjectInfo', 'getGraphData', 'navigate', 'unknown'];

    for (const cmd of commands) {
      const response = await sidebar.handleMessage({ command: cmd, query: 'test' });
      expect(response).toHaveProperty('command');
    }

    engine.dispose();
  });
});
