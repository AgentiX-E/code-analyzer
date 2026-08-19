import { describe, it, expect } from 'vitest';
import { RoutesPhase } from '../pipeline/phases/routes.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  DiscoveredFile,
  ParsedFile,
  SupportedLanguage,
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
  return { filePath, language: 'typescript', content, hash: 'abc', size: content.length };
}

function makeParsedFile(filePath: string, symbols: SymbolDefinition[] = []): ParsedFile {
  return {
    filePath,
    language: 'typescript' as SupportedLanguage,
    symbols,
    references: [],
    scopeTree: {
      name: 'file',
      kind: 'File',
      startLine: 1,
      endLine: 10,
      children: [],
      symbols: [],
    },
    ast: [],
  };
}

function makeSymbol(
  name: string,
  qualifiedName: string,
  startLine: number,
  endLine: number,
): SymbolDefinition {
  return {
    name,
    kind: 'Function' as NodeLabel,
    qualifiedName,
    startLine,
    endLine,
    isExported: true,
    properties: {},
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

const EXPRESS = "app.get('/api/users', (req, res) => res.json({}));\n";

describe('RoutesPhase — defensive branches', () => {
  it('derives a Next.js app-router path without an /app/ segment', async () => {
    const store = new InMemoryGraphStore();
    store.fileIndex.set('/proj/route.ts', 1);
    const ctx = makeCtx([makeFile('/proj/route.ts', 'export const x = 1;\n')], store);
    const result = await new RoutesPhase().execute(ctx);
    expect(result.status).toBe('success');
    // A route.ts outside /app/ falls back to the whole dir path.
    expect((result.output as { routesFound: number }).routesFound).toBeGreaterThanOrEqual(1);
  });

  it('matches a Next.js API handler with no capture groups', async () => {
    const store = new InMemoryGraphStore();
    store.fileIndex.set('/proj/api.ts', 1);
    const ctx = makeCtx(
      [makeFile('/proj/api.ts', 'export default function handler(req, res) {}\n')],
      store,
    );
    const result = await new RoutesPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { routesFound: number }).routesFound).toBeGreaterThanOrEqual(1);
  });

  it('skips a route file absent from the graph file index', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([makeFile('/proj/api.ts', EXPRESS)], store);
    const result = await new RoutesPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { routesFound: number }).routesFound).toBe(0);
  });

  it('creates route nodes without parse data', async () => {
    const store = new InMemoryGraphStore();
    store.fileIndex.set('/proj/api.ts', 1);
    const ctx = makeCtx([makeFile('/proj/api.ts', EXPRESS)], store);
    const result = await new RoutesPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { routesFound: number }).routesFound).toBeGreaterThanOrEqual(1);
    expect(Array.from(store.nodes.values()).some((n) => n.label === 'Route')).toBe(true);
  });

  it('skips BELONGS_TO edges when the parsed file is not found', async () => {
    const store = new InMemoryGraphStore();
    store.fileIndex.set('/proj/api.ts', 1);
    const ctx = makeCtx([makeFile('/proj/api.ts', EXPRESS)], store, {
      parsedFiles: [
        makeParsedFile('/proj/other.ts', [makeSymbol('f', 'file:/proj/other.ts:f', 1, 2)]),
      ],
    });
    const result = await new RoutesPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { routesFound: number }).routesFound).toBeGreaterThanOrEqual(1);
  });

  it('skips BELONGS_TO edges when the symbol node is not indexed', async () => {
    const store = new InMemoryGraphStore();
    store.fileIndex.set('/proj/api.ts', 1);
    const symbol = makeSymbol('handler', 'file:/proj/api.ts:handler', 1, 2);
    const ctx = makeCtx([makeFile('/proj/api.ts', EXPRESS)], store, {
      parsedFiles: [makeParsedFile('/proj/api.ts', [symbol])],
    });
    const result = await new RoutesPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { routesFound: number }).routesFound).toBeGreaterThanOrEqual(1);
  });

  it('reports a non-Error exception during execution', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([], store);
    ctx.phaseData.set('scan', {
      get discoveredFiles(): DiscoveredFile[] {
        throw 'boom';
      },
    });
    const result = await new RoutesPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
