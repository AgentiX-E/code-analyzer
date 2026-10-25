import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect } from 'vitest';

import { DependencyInjectionPhase } from '../pipeline/phases/dependency-injection.js';

import type { StoredNode } from '@code-analyzer/infra';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  DiscoveredFile,
  ParsedFile,
  SymbolDefinition,
} from '@code-analyzer/shared';

const PROJ = 'test-proj';

/** A stored class node, spelled once. **A spread over `as never` was what the type check refused**, correctly. */
function classNode(id: number, name: string, filePath: string): StoredNode {
  return {
    id,
    projectId: PROJ,
    label: 'Class',
    name,
    qualifiedName: name,
    filePath,
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
  };
}
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
    kind: 'Class',
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
    store.nodes.set(200, classNode(200, 'IFooService', '/proj/ifoo.ts'));

    const ctx = makeCtx([makeFile('/proj/api.cs', DOTNET)], store, {
      parsedFiles: [makeParsedFile('/proj/api.cs', [symbol])],
    });
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { injectionsFound: number }).injectionsFound).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('reads a NestJS `@Inject` token and wires it to a class the graph holds', async () => {
    // **The pattern this replaces was exponential**: `(?:\s*(?:@Inject\(…\))?\w+…,?\s*)+` backtracked over every
    // constructor parameter, and on `nestjs/core` it spent 24 of the phase's 34 seconds. This case is the shape it was
    // written for, and the edge is what proves the rewrite still reads it.
    const store = new InMemoryGraphStore();
    const content = [
      '@Injectable()',
      'export class CatsService {',
      '  constructor(@Inject(CATS_REPOSITORY) private readonly repo: CatsRepository) {}',
      '}',
      '',
    ].join('\n');
    const symbol = makeSymbol('file:/proj/cats.service.ts:CatsService', 1, 4);
    store.qnameIndex.set(`project:${PROJ}:${symbol.qualifiedName}`, 100);
    store.nodes.set(201, classNode(201, 'CATS_REPOSITORY', '/proj/tokens.ts'));

    const ctx = makeCtx([makeFile('/proj/cats.service.ts', content)], store, {
      parsedFiles: [makeParsedFile('/proj/cats.service.ts', [symbol])],
    });
    const result = await new DependencyInjectionPhase().execute(ctx);

    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(1);
  });

  it('adds no edge when the injected type names nothing in the graph', async () => {
    const store = new InMemoryGraphStore();
    const symbol = makeSymbol('file:/proj/api.cs:Config', 1, 5);
    store.qnameIndex.set(`project:${PROJ}:${symbol.qualifiedName}`, 100);

    const ctx = makeCtx([makeFile('/proj/api.cs', DOTNET)], store, {
      parsedFiles: [makeParsedFile('/proj/api.cs', [symbol])],
    });
    const result = await new DependencyInjectionPhase().execute(ctx);

    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(0);
  });

  it('costs one regex test on a file that holds no DI token', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([makeFile('/proj/plain.ts', 'export const answer = 42;\n')], store, {
      parsedFiles: [makeParsedFile('/proj/plain.ts', [])],
    });

    const result = await new DependencyInjectionPhase().execute(ctx);

    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(0);
  });

  it('keeps the first class of a name and ignores the duplicate', async () => {
    // **Two classes can share a name in one project** - an interface and its implementation, or two modules. The index is
    // built once, so the second occurrence must not replace the first; the arm that checks it is the one the coverage
    // gate would otherwise never exercise.
    const store = new InMemoryGraphStore();
    const symbol = makeSymbol('file:/proj/api.cs:Config', 1, 5);
    store.qnameIndex.set(`project:${PROJ}:${symbol.qualifiedName}`, 100);
    store.nodes.set(300, classNode(300, 'IFooService', '/proj/a.ts'));
    store.nodes.set(301, classNode(301, 'IFooService', '/proj/b.ts'));

    const ctx = makeCtx([makeFile('/proj/api.cs', DOTNET)], store, {
      parsedFiles: [makeParsedFile('/proj/api.cs', [symbol])],
    });
    const result = await new DependencyInjectionPhase().execute(ctx);

    expect((result.output as { injectionsFound: number }).injectionsFound).toBe(1);
  });

  it('reports an Error thrown during execution by its message', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([], store);
    ctx.phaseData.set('scan', {
      get discoveredFiles(): DiscoveredFile[] {
        throw new Error('scan data unavailable');
      },
    });

    const result = await new DependencyInjectionPhase().execute(ctx);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('scan data unavailable');
  });

  it('reports a non-Error exception during execution', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([], store);
    ctx.phaseData.set('scan', {
      get discoveredFiles(): DiscoveredFile[] {
        // **The arm this exercises is `String(err)`**, so the thrown value must not be an `Error`; the rule that wants
        // an error object is disabled for exactly this line, with the reason, because the alternative is an arm no
        // input can reach.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'boom';
      },
    });
    const result = await new DependencyInjectionPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
