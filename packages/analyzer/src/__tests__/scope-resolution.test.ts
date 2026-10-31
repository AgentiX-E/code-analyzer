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
    // **The spelling the pipeline produces**, which is what the phase looks a declaration up by. A bare name
    // here made the symbol table empty and every new arm look broken.
    qualifiedName: `project:${PROJ}:${qualifiedName}`,
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
  span: readonly [number, number] = [1, 10],
): SymbolDefinition {
  return {
    name,
    kind,
    qualifiedName,
    startLine: span[0],
    endLine: span[1],
    isExported: true,
    properties,
  };
}

function makeReference(targetName: string, sourceLine: number, receiver?: string): ReferenceSite {
  return {
    sourceFile: FILE_A,
    sourceLine,
    sourceColumn: 0,
    targetName,
    referenceKind: 'call',
    ...(receiver === undefined ? {} : { receiver }),
  };
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

  it('resolves a call to a declaration in its own file, which nothing did before', async () => {
    // **This case used to assert the opposite**, under the name "skips a same-file call resolved via the
    // qualified-name fallback". The skip was justified as "handled elsewhere" and nothing else produced a `CALLS`
    // edge, so `self.validate()` produced no edge to the `validate` declared above it. Measured on `pallets/flask`
    // 3.0.3, **182 of 1 109 functions had any caller at all**; the reachability pass that would report dead code is
    // blocked by exactly this.
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
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
    const edges = Array.from(store.edges.values());
    expect(edges).toHaveLength(1);
    expect(edges[0]!.targetId).toBe(10);
  });

  it('refuses a name its own file declares twice, rather than picking the first', async () => {
    // **Two declarations of one spelling have no static answer** - `get` in two classes, `value` in two branches - and
    // an edge to the first is an edge nobody can defend. The index marks the name ambiguous on the second sighting.
    const store = seedGraph(
      [
        makeNode(10, 'Method', 'get', 'A.get', FILE_A),
        makeNode(11, 'Method', 'get', 'B.get', FILE_A),
      ],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('get', 2)],
    );
    const ctx = makeCtx(store, [parsed]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
    expect(store.edges.size).toBe(0);
  });

  it('resolves a method a base class declares in another file', async () => {
    // **The class chain is the evidence, and the name alone is not.** `self.helper()` inside `Child` reaches the
    // `helper` that `Base` declares, and `Child` says it extends `Base` - that statement is what the arm reads.
    // Measured against CPython's own parser this rule is 9 of 9 right on `pallets/flask`, where it resolves
    // `self._find_error_handler(...)` in `flask/app.py` to the `App` in `sansio/app.py`.
    const store = seedGraph(
      [
        makeNode(10, 'Method', 'helper', 'Base.helper', FILE_B),
        makeNode(20, 'Method', 'caller', 'Child.caller', FILE_A),
        makeNode(21, 'Class', 'Child', 'Child', FILE_A),
        makeNode(22, 'Class', 'Base', 'Base', FILE_B),
      ],
      { [`project:${PROJ}:Child.caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [
        makeSymbol('Class', 'Child', 'Child', { baseClasses: 'Base' }),
        makeSymbol('Method', 'caller', 'Child.caller', { enclosingClass: 'Child' }),
      ],
      [makeReference('helper', 2, 'self')],
    );
    const base = makeParsedFile(
      FILE_B,
      [
        makeSymbol('Class', 'Base', 'Base'),
        makeSymbol('Method', 'helper', 'Base.helper', { enclosingClass: 'Base' }),
      ],
      [],
    );
    const ctx = makeCtx(store, [parsed, base]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
    const edge = Array.from(store.edges.values())[0]!;
    expect(edge.targetId).toBe(10);
    expect(edge.properties?.['resolution']).toBe('inherited');
  });

  it('refuses a name declared once elsewhere when no class in the chain declares it', async () => {
    // **This is the arm that was removed, and this is the case it used to claim.** A module-level `helper` in another
    // file is not a member of `Base`, so nothing in the class chain declares it and the call stays unresolved -
    // measured, that arm claimed 4 edges across the two Python checkouts of which 1 was right, and 16 across the two
    // TypeScript checkouts of which **0** were. A missing edge is recoverable; a wrong one is inherited downstream.
    const store = seedGraph(
      [
        makeNode(10, 'Function', 'helper', 'helper', FILE_B),
        makeNode(20, 'Method', 'caller', 'Child.caller', FILE_A),
        makeNode(21, 'Class', 'Child', 'Child', FILE_A),
        makeNode(22, 'Class', 'Base', 'Base', FILE_B),
      ],
      {},
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [
        makeSymbol('Class', 'Child', 'Child', { baseClasses: 'Base' }),
        makeSymbol('Method', 'caller', 'Child.caller', { enclosingClass: 'Child' }),
      ],
      [makeReference('helper', 2, 'self')],
    );
    const base = makeParsedFile(FILE_B, [makeSymbol('Class', 'Base', 'Base')], []);
    const ctx = makeCtx(store, [parsed, base]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
    expect(store.edges.size).toBe(0);
  });

  it('refuses a bare name the whole graph declares once, because a builtin is not a declaration', async () => {
    // **Measured: `open(…)` in eight files resolved to the helper `open` in `flask/testing.py`.** A bare name a file
    // neither declares nor imports is a builtin, a language global, or a name the reader could not see - and in all
    // three cases a same-named declaration elsewhere in the repository is a coincidence. This arm claimed 911 edges
    // on `pallets/flask` at 6.5 % precision before the receiver became a requirement.
    const store = seedGraph(
      [makeNode(10, 'Function', 'open', 'open', FILE_B)],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('open', 2)],
    );
    const ctx = makeCtx(store, [parsed]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(0);
    expect(store.edges.size).toBe(0);
  });

  it('refuses a name the whole graph declares twice', async () => {
    const store = seedGraph(
      [
        makeNode(10, 'Function', 'helper', 'helper', FILE_B),
        makeNode(11, 'Function', 'helper', 'helper', FILE_C),
      ],
      { [`project:${PROJ}:caller`]: 20 },
      { [FILE_A]: 1, [FILE_B]: 2, [FILE_C]: 3 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [makeSymbol('Function', 'caller', 'caller')],
      [makeReference('helper', 2)],
    );
    const ctx = makeCtx(store, [parsed]);

    const result = await new ScopeResolutionPhase().execute(ctx);
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

  it('resolves `super().m()` to a base class and not to the override that calls it', async () => {
    // **`super` is a keyword with one meaning**, and the edge it produces must not be the method it is written in -
    // that would make every override look recursive. Measured on `pallets/flask` this is 3 of 3 right, and on
    // `pallets/werkzeug` it is the only rule that answers the `super().__init__(...)` calls in its middleware.
    const store = seedGraph(
      [
        makeNode(10, 'Method', 'helper', 'Base.helper', FILE_A),
        makeNode(20, 'Method', 'helper', 'Child.helper', FILE_A),
        makeNode(21, 'Class', 'Child', 'Child', FILE_A),
        makeNode(22, 'Class', 'Base', 'Base', FILE_A),
      ],
      { [`project:${PROJ}:Child.helper`]: 20 },
      { [FILE_A]: 1 },
    );
    const parsed = makeParsedFile(
      FILE_A,
      [
        makeSymbol('Class', 'Base', 'Base'),
        makeSymbol('Class', 'Child', 'Child', { baseClasses: 'Base' }),
        // **Two `helper` methods, and the line decides which one the call is written in** - which is the whole point
        // of the case: the edge must leave the override and land on the base.
        makeSymbol('Method', 'helper', 'Base.helper', { enclosingClass: 'Base' }, [1, 5]),
        makeSymbol('Method', 'helper', 'Child.helper', { enclosingClass: 'Child' }, [20, 30]),
      ],
      [makeReference('helper', 25, 'super()')],
    );
    const ctx = makeCtx(store, [parsed]);
    const result = await new ScopeResolutionPhase().execute(ctx);
    expect((result.output as { referencesResolved: number }).referencesResolved).toBe(1);
    const edge = Array.from(store.edges.values())[0]!;
    expect(edge.targetId).toBe(10);
    expect(edge.properties?.['resolution']).toBe('super');
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
