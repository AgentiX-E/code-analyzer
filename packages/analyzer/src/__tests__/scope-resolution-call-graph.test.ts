// @code-analyzer/analyzer — Pipeline Phase: ScopeResolution, measured against a parser that is not ours.
//
// **Every case below encodes a defect that was found by comparing the graph with CPython's own parser**
// (`scripts/callgraph-oracle.py`), not by reading the code. The numbers in the comments are the measurements that
// made each one a bug rather than a preference, and they are reproducible with
// `npx tsx scripts/callgraph-quality.ts`.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect, afterAll } from 'vitest';

import { resolveImportPath } from '../pipeline/phase-helpers.js';
import { ScopeResolutionPhase } from '../pipeline/phases/scope-resolution.js';

import type {
  CodeAnalyzerConfig,
  GraphNode,
  KnowledgeGraph,
  NodeLabel,
  ParsedFile,
  PipelineContext,
  ReferenceSite,
  ResolvedImport,
  SymbolDefinition,
} from '@code-analyzer/shared';

const PROJ = 'test-proj';
const ROOT = '/proj';
const FILE_A = '/proj/a.py';
const FILE_B = '/proj/b.py';
const FILE_C = '/proj/c.py';

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

function node(
  id: number,
  label: NodeLabel,
  name: string,
  filePath: string,
  startLine: number,
  endLine: number,
): GraphNode {
  return {
    id,
    projectId: PROJ,
    label,
    name,
    qualifiedName: `project:${PROJ}:${filePath}:${name}`,
    filePath,
    startLine,
    endLine,
    language: 'python',
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

function symbol(
  kind: NodeLabel,
  name: string,
  startLine: number,
  endLine: number,
): SymbolDefinition {
  return {
    name,
    kind,
    qualifiedName: `${FILE_A}:${name}`,
    startLine,
    endLine,
    isExported: true,
    properties: {},
  };
}

function reference(targetName: string, sourceLine: number, receiver?: string): ReferenceSite {
  return {
    sourceFile: FILE_A,
    sourceLine,
    sourceColumn: 0,
    targetName,
    referenceKind: 'call',
    ...(receiver === undefined ? {} : { receiver }),
  };
}

function parsedFile(
  filePath: string,
  symbols: SymbolDefinition[],
  references: ReferenceSite[],
  language: ParsedFile['language'] = 'python',
): ParsedFile {
  return {
    filePath,
    language,
    symbols,
    references,
    scopeTree: {
      name: 'file',
      kind: 'Class',
      startLine: 1,
      endLine: 200,
      children: [],
      symbols: [],
    },
    ast: null,
  };
}

function ctxOf(
  store: InMemoryGraphStore,
  graph: KnowledgeGraph,
  files: ParsedFile[],
  imports: ResolvedImport[] = [],
): PipelineContext {
  const ctx = {
    projectId: PROJ,
    rootPath: ROOT,
    config: makeConfig(),
    signal: new AbortController().signal,
    metadata: {},
    graph,
    phaseData: new Map<string, unknown>(),
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as PipelineContext;
  ctx.phaseData.set('parse', { parsedFiles: files });
  if (imports.length > 0)
    ctx.phaseData.set('crossFile', { resolvedImports: imports, importEdgesCreated: 0 });
  void store;
  return ctx;
}

/** A graph holding exactly these nodes, filed under a project and a file index. */
function graphOf(nodes: GraphNode[], files: string[]): KnowledgeGraph {
  const store = new InMemoryGraphStore();
  void store;
  const graph: KnowledgeGraph = {
    projectId: PROJ,
    nodes: new Map<number, GraphNode>(nodes.map((n) => [n.id, n])),
    edges: new Map(),
    fileIndex: new Map<string, number>(),
    qnameIndex: new Map<string, number>(),
  };
  files.forEach((file, index) => {
    graph.fileIndex.set(file, 1000 + index);
    graph.nodes.set(1000 + index, node(1000 + index, 'File', file, file, 1, 200));
  });
  for (const entry of nodes) graph.qnameIndex.set(entry.qualifiedName, entry.id);
  return graph;
}

function callEdges(
  graph: KnowledgeGraph,
): { sourceId: number; targetId: number; resolution: string }[] {
  return [...graph.edges.values()]
    .filter((edge) => edge.type === 'CALLS')
    .map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      resolution: (() => {
        const arm: unknown = edge.properties?.['resolution'];
        return typeof arm === 'string' ? arm : '';
      })(),
    }));
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('ScopeResolution — a call resolves in the scope the language gives it', () => {
  it('files a class body member apart from a module-level function', async () => {
    // 1 `class Service` (lines 1-20) holds `run` (3-8); `main` (22-30) is module level.
    const graph = graphOf(
      [
        node(1, 'Class', 'Service', FILE_A, 1, 20),
        node(2, 'Function', 'run', FILE_A, 3, 8),
        node(3, 'Function', 'main', FILE_A, 22, 30),
        node(4, 'Function', 'boot', FILE_A, 22, 30),
      ],
      [FILE_A],
    );
    const files = [
      parsedFile(
        FILE_A,
        [symbol('Class', 'Service', 1, 20), symbol('Function', 'main', 22, 30)],
        [reference('boot', 25, 'self')],
      ),
    ];
    await new ScopeResolutionPhase().execute(ctxOf(new InMemoryGraphStore(), graph, files));

    // `self.boot()` reaches the member; a bare `boot()` would not, because Python has no implicit `self`.
    expect(callEdges(graph).map((edge) => edge.targetId)).toEqual([4]);
  });

  it('refuses a bare call that would need a member of a class in the same file', async () => {
    // **Measured before this rule: 49 of 83 wrong same-file edges on `pallets/flask` were bare calls resolved to a
    // method of a class in the same file**, which is a `NameError` in the program being described.
    const graph = graphOf(
      [
        node(1, 'Class', 'Service', FILE_A, 1, 20),
        node(2, 'Function', 'run', FILE_A, 3, 8),
        node(3, 'Function', 'main', FILE_A, 22, 30),
      ],
      [FILE_A],
    );
    const files = [
      parsedFile(
        FILE_A,
        [symbol('Class', 'Service', 1, 20), symbol('Function', 'main', 22, 30)],
        [reference('run', 25)],
      ),
    ];
    await new ScopeResolutionPhase().execute(ctxOf(new InMemoryGraphStore(), graph, files));

    expect(callEdges(graph)).toEqual([]);
  });

  it('lets a bare call reach a member where the language supplies the receiver implicitly', async () => {
    // The same graph, the same reference, a language with implicit `this` - so the same edge is right.
    const graph = graphOf(
      [
        node(1, 'Class', 'Service', FILE_A, 1, 20),
        node(2, 'Function', 'run', FILE_A, 3, 8),
        node(3, 'Function', 'main', FILE_A, 22, 30),
      ],
      [FILE_A],
    );
    const files = [
      parsedFile(
        FILE_A,
        [symbol('Class', 'Service', 1, 20), symbol('Function', 'main', 22, 30)],
        [reference('run', 25)],
        'typescript',
      ),
    ];
    await new ScopeResolutionPhase().execute(ctxOf(new InMemoryGraphStore(), graph, files));

    expect(callEdges(graph).map((edge) => edge.targetId)).toEqual([2]);
  });

  it('refuses a declaration nested in a function, which belongs to that function alone', async () => {
    // **Measured: 40 of the 43 remaining wrong same-file edges were a bare call from one function to a nested
    // declaration in a different function.** `def test_x(): class MyException(Exception)` is not module level.
    const graph = graphOf(
      [
        node(1, 'Function', 'outer', FILE_A, 1, 20),
        node(2, 'Class', 'Inner', FILE_A, 3, 8),
        node(3, 'Function', 'other', FILE_A, 22, 30),
      ],
      [FILE_A],
    );
    const files = [
      parsedFile(
        FILE_A,
        [symbol('Function', 'outer', 1, 20), symbol('Function', 'other', 22, 30)],
        [reference('Inner', 25)],
      ),
    ];
    await new ScopeResolutionPhase().execute(ctxOf(new InMemoryGraphStore(), graph, files));

    expect(callEdges(graph)).toEqual([]);
  });

  it('does not read two declarations with the same line range as one inside the other', async () => {
    // **A one-line arrow function and the function that holds it share a range**, and "contains or equals" made every
    // declaration look nested inside whatever it was compared with - which filed whole files into the local scope.
    const graph = graphOf(
      [
        node(1, 'Function', 'first', FILE_A, 5, 5),
        node(2, 'Function', 'second', FILE_A, 5, 5),
        node(3, 'Function', 'caller', FILE_A, 40, 50),
      ],
      [FILE_A],
    );
    const files = [
      parsedFile(FILE_A, [symbol('Function', 'caller', 40, 50)], [reference('second', 45)]),
    ];
    await new ScopeResolutionPhase().execute(ctxOf(new InMemoryGraphStore(), graph, files));

    expect(callEdges(graph).map((edge) => edge.targetId)).toEqual([2]);
  });
});

describe('ScopeResolution — the owner of a call is the innermost function that contains it', () => {
  it('attributes a call in a nested function to the nested function', async () => {
    // **Measured: 40 of 94 wrong `CALLS` edges on `pallets/flask` named an owner that does not contain the call.**
    // The phase took the first containing symbol in declaration order, which is the outer one whenever they nest.
    const graph = graphOf(
      [
        node(1, 'Function', 'decorator', FILE_A, 1, 30),
        node(2, 'Function', 'wrapper', FILE_A, 5, 12),
        node(3, 'Function', 'helper', FILE_A, 40, 50),
      ],
      [FILE_A],
    );
    const files = [
      parsedFile(
        FILE_A,
        [symbol('Function', 'decorator', 1, 30), symbol('Function', 'wrapper', 5, 12)],
        [reference('helper', 8)],
      ),
    ];
    await new ScopeResolutionPhase().execute(ctxOf(new InMemoryGraphStore(), graph, files));

    expect(callEdges(graph).map((edge) => edge.sourceId)).toEqual([2]);
  });
});

describe('ScopeResolution — an import reaches the file that declares the name', () => {
  it('follows one re-export, which is how a package front door is built', async () => {
    // **`from flask import redirect` names `flask/__init__.py`, which does not define `redirect`.** Measured: every
    // public name of every re-exporting package resolved to nothing, which lost `url_for` and `redirect` at ten call
    // sites in the tutorial example and nothing else.
    const graph = graphOf(
      [
        node(1, 'Function', 'redirect', FILE_C, 1, 10),
        node(2, 'Function', 'caller', FILE_A, 1, 10),
      ],
      [FILE_A, FILE_B, FILE_C],
    );
    const files = [
      parsedFile(FILE_A, [symbol('Function', 'caller', 1, 10)], [reference('redirect', 5)]),
      parsedFile(FILE_B, [], []),
      parsedFile(FILE_C, [], []),
    ];
    const imports: ResolvedImport[] = [
      {
        sourceFile: FILE_A,
        importPath: 'pkg',
        importedSymbols: ['redirect'],
        resolvedFiles: [FILE_B],
        semantics: 'named',
      },
      {
        sourceFile: FILE_B,
        importPath: '.helpers',
        importedSymbols: ['redirect'],
        resolvedFiles: [FILE_C],
        semantics: 'named',
      },
    ];
    await new ScopeResolutionPhase().execute(
      ctxOf(new InMemoryGraphStore(), graph, files, imports),
    );

    expect(callEdges(graph)).toEqual([{ sourceId: 2, targetId: 1, resolution: 'import' }]);
  });

  it('stops at one hop, so a chain of re-exports is not followed twice', async () => {
    // The second hop would need a module graph rather than a file graph, and following it here would let one
    // mis-resolved import pull in an unrelated file.
    const graph = graphOf(
      [
        node(1, 'Function', 'redirect', FILE_C, 1, 10),
        node(2, 'Function', 'caller', FILE_A, 1, 10),
      ],
      [FILE_A, FILE_B, FILE_C],
    );
    const files = [
      parsedFile(FILE_A, [symbol('Function', 'caller', 1, 10)], [reference('redirect', 5)]),
      parsedFile(FILE_B, [], []),
      parsedFile(FILE_C, [], []),
    ];
    const imports: ResolvedImport[] = [
      {
        sourceFile: FILE_A,
        importPath: 'pkg',
        importedSymbols: ['redirect'],
        resolvedFiles: [FILE_B],
        semantics: 'named',
      },
    ];
    await new ScopeResolutionPhase().execute(
      ctxOf(new InMemoryGraphStore(), graph, files, imports),
    );

    expect(callEdges(graph)).toEqual([]);
  });
});

describe('resolveImportPath — a checkout of a library holds the library', () => {
  it('resolves a bare package name against a src layout', () => {
    // **Measured on `pallets/flask` 3.0.3: every import from an example or a test into the library resolved to zero
    // files**, because the resolver looked for `<root>/flask/__init__.py` and the package is under `src/`.
    const root = mkdtempSync(join(tmpdir(), 'ca-src-layout-'));
    dirs.push(root);
    mkdirSync(join(root, 'src', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'src', 'pkg', '__init__.py'), '');
    mkdirSync(join(root, 'examples'), { recursive: true });
    const importer = join(root, 'examples', 'demo.py');
    writeFileSync(importer, 'from pkg import thing\n');

    expect(resolveImportPath('pkg', importer, root)).toBe(join(root, 'src', 'pkg', '__init__.py'));
    expect(resolveImportPath('pkg.helpers', importer, root)).toBeNull();
  });

  it('keeps a relative import anchored where it was written', () => {
    const root = mkdtempSync(join(tmpdir(), 'ca-relative-'));
    dirs.push(root);
    mkdirSync(join(root, 'pkg'), { recursive: true });
    writeFileSync(join(root, 'pkg', '__init__.py'), '');
    writeFileSync(join(root, 'pkg', 'helpers.py'), '');
    const importer = join(root, 'pkg', 'caller.py');
    writeFileSync(importer, 'from . import helpers\n');

    expect(resolveImportPath('.helpers', importer, root)).toBe(join(root, 'pkg', 'helpers.py'));
  });
});
