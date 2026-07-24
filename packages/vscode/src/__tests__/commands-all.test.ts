// @code-analyzer/vscode — All Commands Tests
// Tests registration and execution of all 14 VS Code commands.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IVSCodeAPI, DiagnosticCollection } from '../services/vscode-api.js';
import type { EngineBridge, SearchResultItem, ReviewCommentItem, ImpactResultItem, TraceResultItem, SymbolDetailItem } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

function createMockAPI(): IVSCodeAPI & { registrations: Map<string, (...args: unknown[]) => unknown> } {
  const registrations = new Map<string, (...args: unknown[]) => unknown>();

  return {
    registrations,
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn().mockResolvedValue(undefined),
    showQuickPick: vi.fn().mockResolvedValue(undefined),
    createOutputChannel: vi.fn(),
    withProgress: vi.fn().mockImplementation(async (_opts, task) => {
      await task({ report: vi.fn() });
    }),
    getWorkspaceFolders: vi.fn().mockReturnValue([{ uri: { fsPath: '/test/workspace' }, name: 'test', index: 0 }]),
    getConfiguration: vi.fn(),
    registerCommand: vi.fn((cmd: string, handler: (...args: unknown[]) => unknown) => {
      registrations.set(cmd, handler);
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn(),
    createDiagnosticCollection: vi.fn(),
    createStatusBarItem: vi.fn(),
    Uri: { file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })), parse: vi.fn() },
    ViewColumn: { One: 1 },
  } as any;
}

function createMockEngine(): EngineBridge {
  return {
    search: vi.fn().mockResolvedValue([]),
    reviewWorkspace: vi.fn().mockResolvedValue([]),
    detectChanges: vi.fn().mockResolvedValue([]),
    analyzeImpact: vi.fn().mockResolvedValue({ riskLevel: 'low', affectedSymbols: 0 } satisfies ImpactResultItem),
    traceCallPath: vi.fn().mockResolvedValue([]),
    findCallers: vi.fn().mockResolvedValue([]),
    findCallees: vi.fn().mockResolvedValue([]),
    findRelatedSymbols: vi.fn().mockResolvedValue([]),
    findImplementations: vi.fn().mockResolvedValue([]),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    checkStandards: vi.fn().mockResolvedValue({ passed: true, message: '' }),
    getSymbolDetail: vi.fn(),
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
  } as unknown as EngineBridge;
}

function createMockDiagnosticCollection(): DiagnosticCollection {
  return {
    clear: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    forEach: vi.fn(),
    dispose: vi.fn(),
  } as unknown as DiagnosticCollection;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Command Registration', () => {
  let api: ReturnType<typeof createMockAPI>;
  let engine: EngineBridge;
  let diag: DiagnosticCollection;

  beforeEach(async () => {
    api = createMockAPI();
    engine = createMockEngine();
    diag = createMockDiagnosticCollection();

    const { registerCommands } = await import('../extension/commands.js');
    registerCommands(api as IVSCodeAPI, engine, {}, diag);
  });

  it('registers all 14 commands', () => {
    expect(api.registrations.size).toBe(14);
  });

  const expectedCommands = [
    'code-analyzer.showSidebar',
    'code-analyzer.analyze',
    'code-analyzer.review',
    'code-analyzer.search',
    'code-analyzer.showConfig',
    'code-analyzer.config.focus',
    'code-analyzer.graphExplorer.focus',
    'code-analyzer.findCallers',
    'code-analyzer.findCallees',
    'code-analyzer.traceImpact',
    'code-analyzer.showSymbolDetail',
    'code-analyzer.fixIssue',
    'code-analyzer.ignoreIssue',
    'code-analyzer.explainIssue',
  ] as const;

  expectedCommands.forEach((cmd) => {
    it(`registers command: ${cmd}`, () => {
      expect(api.registrations.has(cmd)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Core commands behaviour
// ---------------------------------------------------------------------------

describe('Core Commands', () => {
  let api: ReturnType<typeof createMockAPI>;
  let engine: EngineBridge;
  let diag: DiagnosticCollection;

  beforeEach(async () => {
    api = createMockAPI();
    engine = createMockEngine();
    diag = createMockDiagnosticCollection();

    const { registerCommands } = await import('../extension/commands.js');
    registerCommands(api as IVSCodeAPI, engine, {}, diag);
  });

  describe('showSidebar', () => {
    it('executes workbench view command', () => {
      const handler = api.registrations.get('code-analyzer.showSidebar')!;
      handler();
      expect(api.executeCommand).toHaveBeenCalledWith('workbench.view.extension.code-analyzer-sidebar');
    });
  });

  describe('analyze', () => {
    it('shows warning when no workspace folder', async () => {
      api.getWorkspaceFolders = vi.fn().mockReturnValue(undefined);
      const handler = api.registrations.get('code-analyzer.analyze')!;
      await handler();
      expect(api.showWarningMessage).toHaveBeenCalledWith('No workspace folder found.');
    });

    it('runs analysis with progress', async () => {
      const handler = api.registrations.get('code-analyzer.analyze')!;
      await handler();
      expect(engine.setProjectId).toHaveBeenCalledWith('/test/workspace');
      expect(engine.initialize).toHaveBeenCalled();
      expect(engine.indexWorkspace).toHaveBeenCalledWith('/test/workspace');
    });
  });

  describe('review', () => {
    it('shows no issues message when empty', async () => {
      const handler = api.registrations.get('code-analyzer.review')!;
      await handler();
      expect(api.showInformationMessage).toHaveBeenCalledWith('No issues found');
    });

    it('populates diagnostics when issues found', async () => {
      const mockComment: ReviewCommentItem = {
        severity: 'warning',
        title: 'Test issue',
        path: '/test/file.ts',
        startLine: 0,
        endLine: 5,
        message: 'Test issue description',
      };
      engine.reviewWorkspace = vi.fn().mockResolvedValue([mockComment]);

      // Re-register with new mock
      api.registrations.clear();
      const { registerCommands } = await import('../extension/commands.js');
      registerCommands(api as IVSCodeAPI, engine, {}, diag);

      const handler = api.registrations.get('code-analyzer.review')!;
      await handler();
      expect(diag.clear).toHaveBeenCalled();
      expect(api.showInformationMessage).toHaveBeenCalledWith('Found 1 issue(s)');
    });
  });

  describe('search', () => {
    it('returns early when no query entered', async () => {
      const handler = api.registrations.get('code-analyzer.search')!;
      await handler();
      expect(engine.search).not.toHaveBeenCalled();
    });

    it('shows results in quick pick', async () => {
      api.showInputBox = vi.fn().mockResolvedValue('test query');
      const results: SearchResultItem[] = [
        { name: 'testFunc', filePath: 'src/test.ts', label: 'function' },
      ];
      engine.search = vi.fn().mockResolvedValue(results);

      const handler = api.registrations.get('code-analyzer.search')!;
      await handler();
      expect(api.showQuickPick).toHaveBeenCalled();
    });

    it('shows no results message', async () => {
      api.showInputBox = vi.fn().mockResolvedValue('nothing');
      const handler = api.registrations.get('code-analyzer.search')!;
      await handler();
      expect(api.showInformationMessage).toHaveBeenCalledWith('No results found for "nothing"');
    });
  });
});

// ---------------------------------------------------------------------------
// Symbol context commands
// ---------------------------------------------------------------------------

describe('Symbol Context Commands', () => {
  let api: ReturnType<typeof createMockAPI>;
  let engine: EngineBridge;
  let diag: DiagnosticCollection;

  beforeEach(async () => {
    api = createMockAPI();
    engine = createMockEngine();
    diag = createMockDiagnosticCollection();

    const { registerCommands } = await import('../extension/commands.js');
    registerCommands(api as IVSCodeAPI, engine, {}, diag);
  });

  describe('findCallers', () => {
    it('shows caller results', async () => {
      const callers: TraceResultItem[] = [
        { name: 'callerFunc', filePath: 'src/caller.ts' },
      ];
      engine.findCallers = vi.fn().mockResolvedValue(callers);

      const handler = api.registrations.get('code-analyzer.findCallers')!;
      await handler('testSymbol');
      expect(engine.findCallers).toHaveBeenCalledWith('testSymbol');
      expect(api.showQuickPick).toHaveBeenCalled();
    });

    it('extracts symbol from object argument', async () => {
      const handler = api.registrations.get('code-analyzer.findCallers')!;
      await handler({ name: 'objSymbol', label: 'ObjLabel' });
      expect(engine.findCallers).toHaveBeenCalledWith('objSymbol');
    });

    it('shows no callers message', async () => {
      const handler = api.registrations.get('code-analyzer.findCallers')!;
      await handler('nonexistent');
      expect(api.showInformationMessage).toHaveBeenCalledWith('No callers found for "nonexistent"');
    });
  });

  describe('findCallees', () => {
    it('finds callees for a symbol', async () => {
      const callees: TraceResultItem[] = [
        { name: 'helper', filePath: 'src/helper.ts' },
      ];
      engine.findCallees = vi.fn().mockResolvedValue(callees);

      const handler = api.registrations.get('code-analyzer.findCallees')!;
      await handler('main');
      expect(engine.findCallees).toHaveBeenCalledWith('main');
    });
  });

  describe('traceImpact', () => {
    it('shows impact analysis', async () => {
      engine.analyzeImpact = vi.fn().mockResolvedValue({
        riskLevel: 'high',
        affectedSymbols: 5,
      } satisfies ImpactResultItem);

      const handler = api.registrations.get('code-analyzer.traceImpact')!;
      await handler('criticalFunc');
      expect(engine.analyzeImpact).toHaveBeenCalledWith('criticalFunc');
      expect(api.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('high'),
      );
    });
  });

  describe('showSymbolDetail', () => {
    it('displays symbol detail', async () => {
      const detail: SymbolDetailItem = {
        name: 'MyClass',
        qualifiedName: 'com.example.MyClass',
        filePath: 'src/MyClass.ts',
        signature: 'class MyClass',
        docstring: 'A test class',
        label: 'class',
        isExported: true,
      };
      engine.getSymbolDetail = vi.fn().mockResolvedValue(detail);

      const handler = api.registrations.get('code-analyzer.showSymbolDetail')!;
      await handler('MyClass');
      expect(engine.getSymbolDetail).toHaveBeenCalledWith('MyClass');
      expect(api.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('MyClass'),
      );
    });

    it('warns when symbol not found', async () => {
      engine.getSymbolDetail = vi.fn().mockResolvedValue(undefined);

      const handler = api.registrations.get('code-analyzer.showSymbolDetail')!;
      await handler('unknown');
      expect(api.showWarningMessage).toHaveBeenCalledWith('Symbol "unknown" not found');
    });
  });
});

// ---------------------------------------------------------------------------
// CodeLens action commands
// ---------------------------------------------------------------------------

describe('CodeLens Action Commands', () => {
  let api: ReturnType<typeof createMockAPI>;
  let engine: EngineBridge;
  let diag: DiagnosticCollection;

  beforeEach(async () => {
    api = createMockAPI();
    engine = createMockEngine();
    diag = createMockDiagnosticCollection();

    const { registerCommands } = await import('../extension/commands.js');
    registerCommands(api as IVSCodeAPI, engine, {}, diag);
  });

  describe('fixIssue', () => {
    it('navigates to file with issue', async () => {
      const handler = api.registrations.get('code-analyzer.fixIssue')!;
      await handler({
        filePath: '/test/file.ts',
        startLine: 10,
        message: 'Complexity issue',
      });
      expect(api.Uri.file).toHaveBeenCalledWith('/test/file.ts');
    });

    it('does nothing without filePath', async () => {
      const handler = api.registrations.get('code-analyzer.fixIssue')!;
      await handler({ message: 'no file' });
      expect(api.Uri.file).not.toHaveBeenCalled();
    });
  });

  describe('ignoreIssue', () => {
    it('removes diagnostic for the file', async () => {
      const handler = api.registrations.get('code-analyzer.ignoreIssue')!;
      await handler({
        filePath: '/test/file.ts',
        message: 'Style issue',
      });
      expect(diag.delete).toHaveBeenCalled();
      expect(api.showInformationMessage).toHaveBeenCalledWith(
        'Issue ignored: Style issue',
      );
    });
  });

  describe('explainIssue', () => {
    it('shows explain guidance', async () => {
      const handler = api.registrations.get('code-analyzer.explainIssue')!;
      await handler({
        filePath: '/test/file.ts',
        startLine: 5,
        message: 'Security concern',
      });
      expect(api.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('/explain'),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Focus commands
// ---------------------------------------------------------------------------

describe('Focus Commands', () => {
  let api: ReturnType<typeof createMockAPI>;
  let engine: EngineBridge;
  let diag: DiagnosticCollection;

  beforeEach(async () => {
    api = createMockAPI();
    engine = createMockEngine();
    diag = createMockDiagnosticCollection();

    const { registerCommands } = await import('../extension/commands.js');
    registerCommands(api as IVSCodeAPI, engine, {}, diag);
  });

  it('config.focus executes config focus command', () => {
    const handler = api.registrations.get('code-analyzer.config.focus')!;
    handler();
    expect(api.executeCommand).toHaveBeenCalledWith('code-analyzer.config.focus');
  });

  it('graphExplorer.focus executes graph explorer focus command', () => {
    const handler = api.registrations.get('code-analyzer.graphExplorer.focus')!;
    handler();
    expect(api.executeCommand).toHaveBeenCalledWith('code-analyzer.graphExplorer.focus');
  });

  it('showConfig executes config focus', () => {
    const handler = api.registrations.get('code-analyzer.showConfig')!;
    handler();
    expect(api.executeCommand).toHaveBeenCalledWith('code-analyzer.config.focus');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge Cases', () => {
  let api: ReturnType<typeof createMockAPI>;
  let engine: EngineBridge;
  let diag: DiagnosticCollection;

  beforeEach(async () => {
    api = createMockAPI();
    engine = createMockEngine();
    diag = createMockDiagnosticCollection();

    const { registerCommands } = await import('../extension/commands.js');
    registerCommands(api as IVSCodeAPI, engine, {}, diag);
  });

  it('findCallers returns early when no symbol name extracted', async () => {
    const handler = api.registrations.get('code-analyzer.findCallers')!;
    await handler();
    expect(engine.findCallers).not.toHaveBeenCalled();
  });

  it('traceImpact returns early when no symbol name', async () => {
    const handler = api.registrations.get('code-analyzer.traceImpact')!;
    await handler();
    expect(engine.analyzeImpact).not.toHaveBeenCalled();
  });

  it('showSymbolDetail returns early when no symbol name', async () => {
    const handler = api.registrations.get('code-analyzer.showSymbolDetail')!;
    await handler();
    expect(engine.getSymbolDetail).not.toHaveBeenCalled();
  });
});
