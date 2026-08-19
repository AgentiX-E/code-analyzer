import { describe, it, expect } from 'vitest';
import { DependencyInjectionPhase } from '../pipeline/phases/dependency-injection.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  DiscoveredFile,
  ParsedFile,
  SymbolDefinition,
  NodeLabel,
} from '@code-analyzer/shared';

const PROJ = 'test-proj';
const ROOT = '/proj';

function makeConfig(): CodeAnalyzerConfig {
  return {
    projectId: PROJ,
    rootPath: ROOT,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 0,
    maxFiles: 0,
    parseWorkers: 1,
    ignorePaths: [],
  };
}

function makeFile(filePath: string, content: string): DiscoveredFile {
  return { filePath, language: 'csharp', content, hash: 'abc', size: content.length };
}

function makeSymbol(qualifiedName: string, startLine: number, endLine: number): SymbolDefinition {
  return {
    name: 'Config',
    kind: 'Class' as NodeLabel,
    qualifiedName,
    startLine,
    endLine,
    isExported: true,
    properties: {},
  };
}

function makeParsedFile(filePath: string, symbols: SymbolDefinition[]): ParsedFile {
  return {
    filePath,
    language: 'csharp',
    symbols,
    references: [],
    scopeTree: { name: 'file', kind: 'File', startLine: 1, endLine: 10, children: [], symbols: [] },
    ast: [],
  };
}

function makeCtx(
  files: DiscoveredFile[],
  graph: InMemoryGraphStore,
  parseData?: { parsedFiles: ParsedFile[] },
): PipelineContext {
  const phaseData = new Map<string, unknown>([['scan', { discoveredFiles: files }]]);
  if (parseData) phaseData.set('parse', parseData);
  return {
    projectId: PROJ,
    rootPath: ROOT,
    phaseData,
    config: makeConfig(),
    graph: graph as unknown as PipelineContext['graph'],
  };
}

const DOTNET = 'services.AddScoped<IFooService>();\n';

describe('DependencyInjectionPhase — defensive branches', () => {
  it('returns zero when scan data is missing', async () => {
    const ctx: PipelineContext = {
      projectId: PROJ,
      rootPath: ROOT,
      phaseData: new Map(),
      config: makeConfig(),
      graph: new InMemoryGraphStore() as unknown as PipelineContext['graph'],
    };
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(0);
  });

  it('returns zero when no graph is present', async () => {
    const ctx: PipelineContext = {
      projectId: PROJ,
      rootPath: ROOT,
      phaseData: new Map([['scan', { discoveredFiles: [makeFile('/proj/api.cs', DOTNET)] }]]),
      config: makeConfig(),
    };
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(0);
  });

  it('detects a DI pattern without parse data', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([makeFile('/proj/api.cs', DOTNET)], store);
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(0);
  });

  it('skips symbol resolution when the parsed file is not found', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([makeFile('/proj/api.cs', DOTNET)], store, {
      parsedFiles: [
        makeParsedFile('/proj/other.cs', [makeSymbol('file:/proj/other.cs:Config', 1, 5)]),
      ],
    });
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(0);
  });

  it('creates an INJECTS edge to the injected class', async () => {
    const store = new InMemoryGraphStore();
    const symbol = makeSymbol('file:/proj/api.cs:Config', 1, 5);
    store.qnameIndex.set(`project:${PROJ}:${symbol.qualifiedName}`, 100);
    store.nodes.set(200, {
      id: 200,
      projectId: PROJ,
      label: 'Class',
      name: 'IFooService',
      qualifiedName: 'IFooService',
      filePath: '/proj/ifoo.ts',
      startLine: 1,
      endLine: 1,
      language: 'csharp',
      properties: { name: 'IFooService' },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: '',
      updatedAt: '',
    });

    const ctx = makeCtx([makeFile('/proj/api.cs', DOTNET)], store, {
      parsedFiles: [makeParsedFile('/proj/api.cs', [symbol])],
    });
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { injectionsFound: number }).injectionsFound).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('reports a non-Error exception during execution', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([], store);
    ctx.phaseData.set('scan', {
      get discoveredFiles(): DiscoveredFile[] {
        throw 'boom';
      },
    });
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
