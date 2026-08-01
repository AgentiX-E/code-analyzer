// @code-analyzer/vscode — Sidebar Provider Tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SidebarLogic,
  generateSidebarHtml,
} from '../providers/sidebar-provider.js';
import { EngineBridge } from '../services/engine-bridge.js';

describe('SidebarLogic', () => {
  let engine: EngineBridge;
  let logic: SidebarLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    engine.setProjectId('test-project');
    logic = new SidebarLogic(engine);
  });

  // -------------------------------------------------------------------------
  // Search messages
  // -------------------------------------------------------------------------

  describe('search', () => {
    it('returns searchResults for valid search command', async () => {
      const response = await logic.handleMessage({
        command: 'search',
        query: 'login',
      });
      expect(response.command).toBe('searchResults');
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });

    it('handles empty query', async () => {
      const response = await logic.handleMessage({
        command: 'search',
        query: '',
      });
      expect(response.command).toBe('searchResults');
    });

    it('handles missing query field', async () => {
      const response = await logic.handleMessage({
        command: 'search',
      });
      expect(response.command).toBe('searchResults');
    });
  });

  // -------------------------------------------------------------------------
  // Review messages
  // -------------------------------------------------------------------------

  describe('review', () => {
    it('returns reviewResults for review command', async () => {
      const response = await logic.handleMessage({
        command: 'review',
      });
      expect(response.command).toBe('reviewResults');
      expect(response.comments).toBeDefined();
      expect(Array.isArray(response.comments)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Standards messages
  // -------------------------------------------------------------------------

  describe('checkStandards', () => {
    it('returns standardsResults with valid filePath', async () => {
      const response = await logic.handleMessage({
        command: 'checkStandards',
        filePath: 'src/test.ts',
      });
      expect(response.command).toBe('standardsResults');
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });

    it('handles empty filePath', async () => {
      const response = await logic.handleMessage({
        command: 'checkStandards',
        filePath: '',
      });
      expect(response.command).toBe('standardsResults');
    });

    it('handles missing filePath', async () => {
      const response = await logic.handleMessage({
        command: 'checkStandards',
      });
      expect(response.command).toBe('standardsResults');
    });
  });

  // -------------------------------------------------------------------------
  // Get changed files
  // -------------------------------------------------------------------------

  describe('getChangedFiles', () => {
    it('returns changedFilesResults', async () => {
      const response = await logic.handleMessage({
        command: 'getChangedFiles',
      });
      expect(response.command).toBe('changedFilesResults');
      expect(response.files).toBeDefined();
      expect(Array.isArray(response.files)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Project info
  // -------------------------------------------------------------------------

  describe('getProjectInfo', () => {
    it('returns project info', async () => {
      const response = await logic.handleMessage({
        command: 'getProjectInfo',
      });
      expect(response.command).toBe('projectInfo');
      expect(response.projectId).toBe('test-project');
    });

    it('returns null project when not set', async () => {
      const emptyEngine = new EngineBridge();
      const emptyLogic = new SidebarLogic(emptyEngine);
      const response = await emptyLogic.handleMessage({
        command: 'getProjectInfo',
      });
      expect(response.command).toBe('projectInfo');
      expect(response.projectId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Unknown commands
  // -------------------------------------------------------------------------

  describe('unknown commands', () => {
    it('returns error for unknown command', async () => {
      const response = await logic.handleMessage({
        command: 'nonexistent',
      });
      expect(response.command).toBe('error');
      expect(response.message).toContain('Unknown command');
    });

    it('returns error for empty command', async () => {
      const response = await logic.handleMessage({
        command: '',
      });
      expect(response.command).toBe('error');
    });
  });
});

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

describe('generateSidebarHtml', () => {
  it('returns a string', () => {
    const html = generateSidebarHtml();
    expect(typeof html).toBe('string');
  });

  it('contains DOCTYPE declaration', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('contains the search input', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="q"');
    expect(html).toContain('Search symbols');
  });

  it('contains review button', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('runReview');
  });

  it('contains results container', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="search-results"');
  });

  it('contains acquireVsCodeApi call', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('acquireVsCodeApi');
  });

  it('contains message handler for searchResults', () => {
    const html = generateSidebarHtml();
    expect(html).toContain("'searchResults'");
    expect(html).toContain("'reviewResults'");
  });

  it('contains escapeHtml helper', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('function escapeHtml');
  });

  it('has valid HTML structure with closing tags', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('</html>');
    expect(html).toContain('</body>');
    expect(html).toContain('</head>');
  });

  it('is consistent across multiple calls', () => {
    const html1 = generateSidebarHtml();
    const html2 = generateSidebarHtml();
    expect(html1).toBe(html2);
    expect(html1.length).toBe(html2.length);
  });

  // ---- New tabbed UI tests ----

  it('contains all 4 tab buttons', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('switchTab(\'search\')');
    expect(html).toContain('switchTab(\'review\')');
    expect(html).toContain('switchTab(\'graph\')');
    expect(html).toContain('switchTab(\'info\')');
  });

  it('contains all 4 tab content sections', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="tab-search"');
    expect(html).toContain('id="tab-review"');
    expect(html).toContain('id="tab-graph"');
    expect(html).toContain('id="tab-info"');
  });

  it('contains graph canvas element', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="graph-canvas"');
    expect(html).toContain('canvas');
  });

  it('contains graph controls (zoom, reset)', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('graphZoomIn');
    expect(html).toContain('graphZoomOut');
    expect(html).toContain('graphReset');
  });

  it('contains loading states for each tab', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="search-loading"');
    expect(html).toContain('id="review-loading"');
    expect(html).toContain('id="graph-loading"');
    expect(html).toContain('id="info-loading"');
  });

  it('contains empty states for search, review, and graph tabs', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="search-empty"');
    expect(html).toContain('id="review-empty"');
    expect(html).toContain('id="graph-empty"');
  });

  it('contains error state elements', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="search-error"');
    expect(html).toContain('id="review-error"');
  });

  it('contains graph detail panel', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="graph-detail"');
    expect(html).toContain('closeDetail');
  });

  it('contains keyboard shortcut for Ctrl+F', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('Ctrl+F');
  });

  it('contains navigateTo function', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('navigateTo');
  });

  it('contains typeIcon helper', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('typeIcon');
  });

  it('contains force-directed layout code', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('forceStep');
    expect(html).toContain('initLayout');
  });

  it('contains project info grid', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="info-project-id"');
    expect(html).toContain('id="info-status"');
    expect(html).toContain('id="info-symbols"');
    expect(html).toContain('id="info-progress"');
  });

  it('contains CSS variables for VS Code theming', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('var(--vscode-');
  });

  it('uses severity CSS classes', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('severity-critical');
    expect(html).toContain('severity-high');
    expect(html).toContain('severity-medium');
  });
});

// ---------------------------------------------------------------------------
// SidebarLogic — new commands
// ---------------------------------------------------------------------------

describe('SidebarLogic — navigate and graph commands', () => {
  let engine: EngineBridge;
  let logic: SidebarLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    engine.setProjectId('test-project');
    logic = new SidebarLogic(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('navigate', () => {
    it('returns navigate response with filePath', async () => {
      const response = await logic.handleMessage({
        command: 'navigate',
        filePath: '/test/path.ts',
      });
      expect(response.command).toBe('navigate');
      expect(response.filePath).toBe('/test/path.ts');
    });

    it('handles empty filePath', async () => {
      const response = await logic.handleMessage({
        command: 'navigate',
        filePath: '',
      });
      expect(response.command).toBe('navigate');
      expect(response.filePath).toBe('');
    });

    it('handles missing filePath', async () => {
      const response = await logic.handleMessage({
        command: 'navigate',
      });
      expect(response.command).toBe('navigate');
      expect(response.filePath).toBe('');
    });
  });

  describe('getGraphData', () => {
    it('returns graphData with nodes and edges', async () => {
      const response = await logic.handleMessage({
        command: 'getGraphData',
      });
      expect(response.command).toBe('graphData');
      expect(Array.isArray(response.nodes)).toBe(true);
      expect(Array.isArray(response.edges)).toBe(true);
    });

    it('returns empty arrays when no project set', async () => {
      const emptyEngine = new EngineBridge();
      const emptyLogic = new SidebarLogic(emptyEngine);
      const response = await emptyLogic.handleMessage({
        command: 'getGraphData',
      });
      expect(response.nodes).toEqual([]);
      expect(response.edges).toEqual([]);
      emptyEngine.dispose();
    });

    it('returns nodes and edges when rootSymbol is provided and traceCallPath succeeds', async () => {
      vi.spyOn(engine, 'traceCallPath').mockResolvedValue([
        { name: 'funcA', filePath: '/a.ts' },
        { name: 'funcB', filePath: '/b.ts' },
      ]);
      const response = await logic.handleMessage({
        command: 'getGraphData',
        rootSymbol: 'myFunc',
      });
      expect(response.command).toBe('graphData');
      expect(response.nodes).toEqual([
        { id: 1, name: 'funcA', label: 'Function', filePath: '/a.ts' },
        { id: 2, name: 'funcB', label: 'Function', filePath: '/b.ts' },
      ]);
      expect(response.edges).toEqual([
        { sourceId: 1, targetId: 2, type: 'CALLS' },
      ]);
    });

    it('returns empty arrays when traceCallPath throws', async () => {
      vi.spyOn(engine, 'traceCallPath').mockRejectedValue(new Error('store closed'));
      const response = await logic.handleMessage({
        command: 'getGraphData',
        rootSymbol: 'badSymbol',
      });
      expect(response.command).toBe('graphData');
      expect(response.nodes).toEqual([]);
      expect(response.edges).toEqual([]);
    });
  });

  describe('getProjectInfo — extended fields', () => {
    it('returns symbolCount in project info', async () => {
      const response = await logic.handleMessage({
        command: 'getProjectInfo',
      });
      expect(response).toHaveProperty('symbolCount');
      expect(typeof response.symbolCount).toBe('number');
    });

    it('returns status in project info', async () => {
      const response = await logic.handleMessage({
        command: 'getProjectInfo',
      });
      expect(response).toHaveProperty('status');
      expect(['idle', 'ready', 'indexing', 'error']).toContain(response.status);
    });

    it('returns progress in project info', async () => {
      const response = await logic.handleMessage({
        command: 'getProjectInfo',
      });
      expect(response).toHaveProperty('progress');
      expect(typeof response.progress).toBe('number');
    });
  });
});
