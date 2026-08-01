// @code-analyzer/vscode — Provider Integration Tests
// Tests CodeLens, Hover, and reviewOnSave provider logic + wiring.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { HoverContent, DecorationConfig } from '../providers/review-decoration-provider.js';
import { ReviewDecorationLogic } from '../providers/review-decoration-provider.js';
import { CommentLogic } from '../providers/comment-provider.js';
import { GraphTreeDataProviderLogic } from '../providers/tree-view-provider.js';
import { GraphExplorerLogic } from '../providers/graph-explorer.js';
import type { EngineBridge, ReviewCommentItem } from '../services/engine-bridge.js';
import type { TreeItemData } from '../providers/tree-view-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEngine(overrides?: Partial<EngineBridge>): EngineBridge {
  return {
    search: vi.fn().mockResolvedValue([]),
    reviewWorkspace: vi.fn().mockResolvedValue([]),
    analyzeImpact: vi.fn().mockResolvedValue({ riskLevel: 'low', affectedSymbols: 0 }),
    findCallers: vi.fn().mockResolvedValue([]),
    findCallees: vi.fn().mockResolvedValue([]),
    findRelatedSymbols: vi.fn().mockResolvedValue([]),
    findImplementations: vi.fn().mockResolvedValue([]),
    getSymbolDetail: vi.fn().mockResolvedValue(undefined),
    traceCallPath: vi.fn().mockResolvedValue([]),
    detectChanges: vi.fn().mockResolvedValue([]),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    checkStandards: vi.fn().mockResolvedValue({ passed: true, message: '' }),
    findRelatedTests: vi.fn().mockResolvedValue([]),
    getComplexityMetrics: vi.fn().mockResolvedValue({ cyclomaticComplexity: 1, linesOfCode: 10, parameterCount: 0, nestingDepth: 1 }),
    searchWithScores: vi.fn().mockResolvedValue([]),
    setProjectId: vi.fn(),
    getProjectId: vi.fn().mockReturnValue('test-proj'),
    initialize: vi.fn().mockResolvedValue(undefined),
    indexWorkspace: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    onIndexingComplete: vi.fn(),
    onIndexingProgress: vi.fn(),
    incrementalReindex: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EngineBridge;
}

// ---------------------------------------------------------------------------
// ReviewDecorationLogic
// ---------------------------------------------------------------------------

describe('ReviewDecorationLogic', () => {
  let logic: ReviewDecorationLogic;

  beforeEach(() => {
    logic = new ReviewDecorationLogic();
  });

  describe('getDecorationConfig', () => {
    it('returns config for critical severity', () => {
      const config = logic.getDecorationConfig('critical');
      expect(config.severity).toBe('critical');
      expect(config.borderColor).toBeDefined();
      expect(config.backgroundColor).toBeDefined();
    });

    it('returns config for high severity', () => {
      const config = logic.getDecorationConfig('high');
      expect(config.severity).toBe('high');
    });

    it('returns config for medium severity', () => {
      const config = logic.getDecorationConfig('medium');
      expect(config.severity).toBe('medium');
    });

    it('returns config for low severity', () => {
      const config = logic.getDecorationConfig('low');
      expect(config.severity).toBe('low');
    });

    it('returns config for info severity', () => {
      const config = logic.getDecorationConfig('info');
      expect(config.severity).toBe('info');
    });

    it('defaults to info for unknown severity', () => {
      const config = logic.getDecorationConfig('unknown' as any);
      expect(config.severity).toBe('info');
    });
  });

  describe('buildHoverContent', () => {
    it('builds hover content from comment', () => {
      const comment = {
        severity: 'warning',
        title: 'Test Issue',
        message: 'A test issue description',
      } as ReviewCommentItem;

      const content = logic.buildHoverContent(comment);
      expect(content.title).toContain('Test Issue');
      expect(content.message).toBe('A test issue description');
      expect(content.severity).toBe('warning');
    });
  });

  describe('buildHoverMarkdown', () => {
    it('produces markdown with severity badge', () => {
      const content: HoverContent = {
        title: 'Test',
        message: 'Description',
        severity: 'warning',
      };
      const markdown = logic.buildHoverMarkdown(content);
      expect(markdown).toContain('Test');
      expect(markdown).toContain('Description');
      expect(markdown).toContain('svg');
    });

    it('includes category when present', () => {
      const content: HoverContent = {
        title: 'Test',
        message: 'Description',
        severity: 'info',
        category: 'maintainability',
      };
      const markdown = logic.buildHoverMarkdown(content);
      expect(markdown).toContain('maintainability');
    });

    it('includes suggestion when present', () => {
      const content: HoverContent = {
        title: 'Test',
        message: 'Description',
        severity: 'low',
        suggestion: 'Try this fix',
      };
      const markdown = logic.buildHoverMarkdown(content);
      expect(markdown).toContain('Try this fix');
    });
  });

  describe('getCodeLensActions', () => {
    it('returns actions for an issue', () => {
      const comment = {
        severity: 'high',
        message: 'Test issue',
        filePath: '/test/file.ts',
        startLine: 10,
        endLine: 15,
      } as ReviewCommentItem;

      const actions = logic.getCodeLensActions(comment);
      expect(actions.length).toBeGreaterThan(0);
    });

    it('returns fix action for critical severity', () => {
      const comment = {
        severity: 'critical',
        message: 'Critical issue',
        filePath: '/test/file.ts',
        startLine: 1,
        endLine: 5,
      } as ReviewCommentItem;
      const actions = logic.getCodeLensActions(comment);
      const titles = actions.map((a) => a.title);
      expect(titles.some((t) => t.includes('Fix'))).toBe(true);
    });
  });

  describe('filterByMinSeverity', () => {
    it('filters comments by minimum severity', () => {
      const comments = [
        { severity: 'info' } as ReviewCommentItem,
        { severity: 'medium' } as ReviewCommentItem,
        { severity: 'high' } as ReviewCommentItem,
        { severity: 'critical' } as ReviewCommentItem,
      ];

      const filtered = logic.filterByMinSeverity(comments, 'medium');
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe('groupDecorationsByFile', () => {
    it('groups decorations by file path', () => {
      const comments: ReviewCommentItem[] = [
        { severity: 'info', title: 'A', message: 'A', path: '/a.ts', startLine: 1, endLine: 5 },
        { severity: 'medium', title: 'B', message: 'B', path: '/a.ts', startLine: 10, endLine: 15 },
        { severity: 'high', title: 'C', message: 'C', path: '/b.ts', startLine: 1, endLine: 3 },
      ];

      const grouped = logic.groupDecorationsByFile(comments);
      expect(grouped.size).toBe(2);
    });
  });

  describe('getSeverityBadgeSvg', () => {
    it('returns SVG for each severity', () => {
      const severities = ['critical', 'high', 'medium', 'low', 'info'];
      for (const sev of severities) {
        const svg = logic.getSeverityBadgeSvg(sev as any);
        expect(svg).toContain('<svg');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// CommentLogic
// ---------------------------------------------------------------------------

describe('CommentLogic', () => {
  let engine: EngineBridge;
  let logic: CommentLogic;

  beforeEach(() => {
    engine = createMockEngine();
    logic = new CommentLogic(engine);
  });

  it('maps comments to diagnostics', () => {
    const comments: ReviewCommentItem[] = [
      { severity: 'critical', title: 'E', message: 'Error', path: '/f.ts', startLine: 0, endLine: 5 },
      { severity: 'high', title: 'W', message: 'Warning', path: '/f.ts', startLine: 10, endLine: 15 },
    ];

    const diagnostics = logic.mapCommentsToDiagnostics(comments);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]!.severity).toBe('error');
    expect(diagnostics[1]!.severity).toBe('warning');
  });

  it('maps severity correctly', () => {
    expect(logic.mapSeverity('critical')).toBe('error');
    expect(logic.mapSeverity('high')).toBe('warning');
    expect(logic.mapSeverity('medium')).toBe('information');
    expect(logic.mapSeverity('low')).toBe('hint');
    expect(logic.mapSeverity('info')).toBe('hint');
    expect(logic.mapSeverity('unknown')).toBe('information');
  });

  it('groups diagnostics by file', () => {
    const decs = [
      { range: { startLine: 0, startCharacter: 0, endLine: 5, endCharacter: 0 }, message: 'A', severity: 'info', source: 'test', filePath: '/a.ts' },
      { range: { startLine: 10, startCharacter: 0, endLine: 15, endCharacter: 0 }, message: 'B', severity: 'warning', source: 'test', filePath: '/b.ts' },
    ];

    const grouped = logic.groupByFile(decs as any);
    expect(grouped.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GraphTreeDataProviderLogic
// ---------------------------------------------------------------------------

describe('GraphTreeDataProviderLogic', () => {
  let engine: EngineBridge;
  let logic: GraphTreeDataProviderLogic;

  beforeEach(() => {
    engine = createMockEngine({
      getProjectId: vi.fn().mockReturnValue('project:test'),
      search: vi.fn().mockResolvedValue([
        { name: 'MyClass', filePath: 'src/MyClass.ts', label: 'class' },
      ]),
    });
    logic = new GraphTreeDataProviderLogic(engine);
  });

  it('returns root items', async () => {
    const roots = await logic.getRootItems();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots[0]!.contextValue).toBe('project');
  });

  it('returns children for root', async () => {
    const children = await logic.getChildren('project:test');
    expect(Array.isArray(children)).toBe(true);
  });

  it('returns parent for item', () => {
    const parent = logic.getParent('project:test');
    expect(parent).toBeUndefined(); // Root has no parent
  });

  it('gets icon for known label', () => {
    const icon = logic.getIconForLabel('class');
    expect(icon).toBeTruthy();
  });

  it('gets icon for unknown label', () => {
    const icon = logic.getIconForLabel('xyzzy123');
    expect(icon).toBe('symbol-misc');
  });

  it('searchItems returns empty for empty query', async () => {
    const results = await logic.searchItems('');
    expect(results).toEqual([]);
  });

  it('searchItems returns results for valid query', async () => {
    const results = await logic.searchItems('MyClass');
    expect(Array.isArray(results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GraphExplorerLogic
// ---------------------------------------------------------------------------

describe('GraphExplorerLogic', () => {
  let engine: EngineBridge;
  let logic: GraphExplorerLogic;

  beforeEach(() => {
    engine = createMockEngine({
      getProjectId: vi.fn().mockReturnValue('proj-1'),
      search: vi.fn().mockResolvedValue([
        { name: 'funcA', filePath: 'a.ts', label: 'function' },
        { name: 'funcB', filePath: 'b.ts', label: 'function' },
      ]),
      findCallees: vi.fn().mockResolvedValue([{ name: 'funcB', filePath: 'b.ts' }]),
    });
    logic = new GraphExplorerLogic(engine);
  });

  it('returns graph data with nodes', async () => {
    const data = await logic.getGraphData();
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(data.edges)).toBe(true);
  });

  it('returns empty graph without project', async () => {
    engine.getProjectId = vi.fn().mockReturnValue(null);
    const data = await logic.getGraphData();
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it('gets node detail', async () => {
    engine.getSymbolDetail = vi.fn().mockResolvedValue({
      name: 'funcA',
      qualifiedName: 'funcA',
      filePath: 'a.ts',
      label: 'function',
      isExported: false,
      signature: 'funcA()',
    });
    const detail = await logic.getNodeDetail(0);
    expect(detail).toBeDefined();
    expect(detail!.name).toBe('funcA');
  });

  it('gets node color for known label', () => {
    const color = logic.getNodeColor('class');
    expect(color).toBeTruthy();
    expect(color).toContain('#');
  });

  it('gets default node color for unknown', () => {
    const color = logic.getNodeColor('unknown_type');
    expect(color).toBeTruthy();
  });
});
