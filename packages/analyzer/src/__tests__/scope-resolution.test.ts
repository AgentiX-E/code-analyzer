import { describe, it, expect } from 'vitest';
import { ScopeResolutionPhase } from '../pipeline/phases/scope-resolution.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  KnowledgeGraph,
  GraphNode,
  NodeLabel,
  ParsedFile,
  SymbolDefinition,
  ReferenceSite,
  ResolvedImport,
} from '@code-analyzer/shared';

const PROJ = 'test-proj';
const ROOT = '/proj';
const FILE_A = '/proj/a.ts';
const FILE_B = '/proj/b.ts';
const FILE_C = '/proj/c.ts';

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

function makeNode(
  id: number,
  label: NodeLabel,
  name: string,
  qualifiedName: string,
  filePath: string,
): GraphNode {
  return {
    id,
    projectId: PROJ,
    label,
    name,
    qualifiedName,
    filePath,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: { filePath },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
  };
}

function makeSymbol(
  kind: NodeLabel,
  name: string,
  qualifiedName: string,
  properties: Record<string, unknown> = {},
): SymbolDefinition {
  return { name, kind, qualifiedName, startLine: 1, endLine: 10, isExported: true, properties };
}

function makeReference(targetName: string, sourceLine: number): ReferenceSite {
  return { sourceFile: FILE_A, sourceLine, sourceColumn: 0, targetName, referenceKind: 'call' };
}

function makeParsedFile(
  filePath: string,
  symbols: SymbolDefinition[],
  references: ReferenceSite[],
): ParsedFile {
  return {
    filePath,
    language: 'typescript',
    symbols,
    references,
    scopeTree: {
      name: 'file',
      kind: 'Class',
      startLine: 1,
      endLine: 100,
      children: [],
      symbols: [],
    },
    ast: null,
  };
}

function makeImport(
  sourceFile: string,
  resolvedFiles: string[],
  importedSymbols: string[],
): ResolvedImport {
  return {
    sourceFile,
    importPath: './other',
    importedSymbols,
    resolvedFiles,
    semantics: 'named',
  };
}

function makeCtx(
  store: InMemoryGraphStore,
  parsedFiles: ParsedFile[],
  resolvedImports?: ResolvedImport[],
): PipelineContext {
  const ctx: PipelineContext = {
    projectId: PROJ,
    rootPath: ROOT,
    phaseData: new Map(),
    config: makeConfig(),
    graph: store as unknown as KnowledgeGraph,
  };
  ctx.phaseData.set('parse', { parsedFiles });
  if (resolvedImports) {
    ctx.phaseData.set('crossFile', { resolvedImports, importEdgesCreated: 0 });
  }
  return ctx;
}

// Seed a graph store with symbol nodes and indices, returning the store.
function seedGraph(
  nodes: GraphNode[],
  qnames: Record<string, number>,
  files: Record<string, number>,
): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  for (const node of nodes) {
    store.nodes.set(node.id, node as GraphNode);
  }
  for (const [qname, id] of Object.entries(qnames)) {
    store.qnameIndex.set(qname, id);
  }
  for (const [file, id] of Object.entries(files)) {
    store.fileIndex.set(file, id);
  }
  return store;
}

describe('ScopeResolutionPhase', () => {
  it('skips parsed files that have no graph node', async () => {
    const store = seedGraph([], {}, {});
    const parsed = makeParsedFile(FILE_A, [], []);
    const ctx = makeCtx(store, [parsed]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('resolves a call via a wildcard import to a cross-file target', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('helper', 2)],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['*'])]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
    expect(store.edges.size).toBe(1);
  });

  it('skips a same-file call resolved via the qualified-name fallback', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_A)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('helper', 2)],
    );
    const ctx = makeCtx(store, [parsed]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('resolves a cross-file EXTENDS edge for a class base', async () => {
    const store = seedGraph(
      [makeNode(40, 'Class', 'BaseClass', 'B.BaseClass', FILE_B)],
      { [`project:${PROJ}:MyClass`]: 30 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { baseClasses: 'BaseClass' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['BaseClass'])]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
    const extendsEdges = Array.from(store.edges.values()).filter((e) => e.type === 'EXTENDS');
    expect(extendsEdges).toHaveLength(1);
  });

  it('resolves a cross-file IMPLEMENTS edge for an interface', async () => {
    const store = seedGraph(
      [makeNode(50, 'Interface', 'IFoo', 'B.IFoo', FILE_B)],
      { [`project:${PROJ}:MyClass`]: 30 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { interfaces: 'IFoo' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['IFoo'])]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
    const implementsEdges = Array.from(store.edges.values()).filter((e) => e.type === 'IMPLEMENTS');
    expect(implementsEdges).toHaveLength(1);
  });

  it('handles a non-Error exception during execution', async () => {
    const throwingGraph = {
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
      get nodes() {
        throw 'boom';
      },
    };
    const ctx: PipelineContext = {
      projectId: PROJ,
      rootPath: ROOT,
      phaseData: new Map(),
      config: makeConfig(),
      graph: throwingGraph as unknown as KnowledgeGraph,
    };
    ctx.phaseData.set('parse', { parsedFiles: [makeParsedFile(FILE_A, [], [])] });

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });

  it('handles an Error exception during execution', async () => {
    const throwingGraph = {
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
      get nodes() {
        throw new Error('kaboom');
      },
    };
    const ctx: PipelineContext = {
      projectId: PROJ,
      rootPath: ROOT,
      phaseData: new Map(),
      config: makeConfig(),
      graph: throwingGraph as unknown as KnowledgeGraph,
    };
    ctx.phaseData.set('parse', { parsedFiles: [makeParsedFile(FILE_A, [], [])] });

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('kaboom');
  });

  it('dedups repeated resolved files in the import map', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('helper', 2)],
    );
    const ctx = makeCtx(
      store,
      [parsed],
      [makeImport(FILE_A, [FILE_B], ['helper']), makeImport(FILE_A, [FILE_B], ['helper'])],
    );
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
    expect(store.edges.size).toBe(1);
  });

  it('skips symbol nodes without a filePath in the per-file index', async () => {
    const noFileNode = makeNode(11, 'Function', 'anon', 'anon', FILE_B);
    noFileNode.properties = {};
    const store = seedGraph([noFileNode], {}, { [FILE_A]: 1 });
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('anon', 2)],
    );
    const result = await new ScopeResolutionPhase().execute(makeCtx(store, [parsed]));
    expect(result.status).toBe('success');
  });

  it('handles a call whose resolved file has no symbol nodes', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2, [FILE_C]: 3 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('missing', 2)],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_C], ['missing', '*'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('handles a named import whose symbol is absent from the resolved file', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('known', 2)],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['known'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('handles a wildcard import whose symbol is absent from the resolved file', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('unknown', 2)],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['*'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('resolves a call via global name fallback to a cross-file target', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('helper', 2)],
    );
    const ctx = makeCtx(store, [parsed]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
  });

  it('skips a call edge when the source symbol has no graph node', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      {},
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('helper', 2)],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['helper'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('handles an extends import whose resolved file has no symbols', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:MyClass`]: 30 },
      { [FILE_A]: 1, [FILE_B]: 2, [FILE_C]: 3 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { baseClasses: 'MissingBase' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_C], ['MissingBase'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('handles an extends base class absent from the resolved file', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:MyClass`]: 30 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { baseClasses: 'MissingBase' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['MissingBase'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('skips an extends edge when the source class has no graph node', async () => {
    const store = seedGraph(
      [makeNode(40, 'Class', 'BaseClass', 'B.BaseClass', FILE_B)],
      {},
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { baseClasses: 'BaseClass' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['BaseClass'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('handles an implements import whose resolved file has no symbols', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:MyClass`]: 30 },
      { [FILE_A]: 1, [FILE_B]: 2, [FILE_C]: 3 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { interfaces: 'MissingIface' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_C], ['MissingIface'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('handles an implements interface absent from the resolved file', async () => {
    const store = seedGraph(
      [makeNode(10, 'Function', 'helper', 'helper', FILE_B)],
      { [`project:${PROJ}:MyClass`]: 30 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { interfaces: 'MissingIface' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['MissingIface'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });

  it('skips an implements edge when the source class has no graph node', async () => {
    const store = seedGraph(
      [makeNode(50, 'Interface', 'IFoo', 'B.IFoo', FILE_B)],
      {},
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Class', 'MyClass', 'MyClass', { interfaces: 'IFoo' })],
      [],
    );
    const ctx = makeCtx(store, [parsed], [makeImport(FILE_A, [FILE_B], ['IFoo'])]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
  });
});
