// @code-analyzer/analyzer — the arm that reads the receiver's type, measured on the graph rather than on a corpus.
//
// **The corpus figure says this arm is worth 33 edges and every one of them is right** (`receiverType` 33/33 across
// `colinhacks/zod` and `redis/ioredis`), and a corpus figure is a summary: it cannot say which rule produced which
// edge, and it cannot state the shapes the rule must refuse. These cases do, one shape each, on a graph built by hand.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { ScopeResolutionPhase } from '../pipeline/phases/scope-resolution.js';

import type {
  CodeAnalyzerConfig,
  GraphNode,
  KnowledgeGraph,
  NodeLabel,
  ParsedFile,
  PipelineContext,
  ReferenceSite,
  SymbolDefinition,
} from '@code-analyzer/shared';

const PROJ = 'test-proj';
const ROOT = '/proj';
const FILE_A = '/proj/index.ts';
const FILE_B = '/proj/holder.ts';

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

function declaration(
  kind: NodeLabel,
  name: string,
  startLine: number,
  endLine: number,
  options: { containerName?: string; properties?: Record<string, unknown> } = {},
): SymbolDefinition {
  return {
    name,
    kind,
    qualifiedName: options.containerName ? `${options.containerName}.${name}` : name,
    startLine,
    endLine,
    isExported: true,
    ...(options.containerName === undefined ? {} : { containerName: options.containerName }),
    properties: options.properties ?? {},
  };
}

function reference(
  filePath: string,
  targetName: string,
  sourceLine: number,
  receiver?: string,
): ReferenceSite {
  return {
    sourceFile: filePath,
    sourceLine,
    sourceColumn: 0,
    targetName,
    referenceKind: 'call',
    ...(receiver === undefined ? {} : { receiver }),
  };
}

function graphNode(
  id: number,
  symbol: SymbolDefinition,
  filePath: string,
  language: string,
): GraphNode {
  return {
    id,
    projectId: PROJ,
    label: symbol.kind,
    name: symbol.name,
    // **The same spelling the pipeline produces**, which is what the phase looks the caller up by.
    qualifiedName: `project:${PROJ}:${symbol.qualifiedName}`,
    filePath,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    language,
    properties: { filePath, ...symbol.properties },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
  };
}

interface Built {
  readonly graph: KnowledgeGraph;
  /** `qualifiedName` of a declaration → its node id, so a case can name the endpoint it expects. */
  readonly idOf: (qualifiedName: string) => number;
}

/**
 * The graph and the parse output, built from one list so the two cannot disagree.
 *
 * **The first version of this file built them separately and every case failed for that reason**: a symbol the graph
 * had no node for is a call whose caller does not exist, and the phase correctly wrote no edge.
 */
function built(files: Record<string, SymbolDefinition[]>): Built {
  const graph: KnowledgeGraph = {
    projectId: PROJ,
    nodes: new Map<number, GraphNode>(),
    edges: new Map(),
    fileIndex: new Map<string, number>(),
    qnameIndex: new Map<string, number>(),
  };
  void new InMemoryGraphStore();
  const ids = new Map<string, number>();
  let nextId = 1;
  for (const [filePath, symbols] of Object.entries(files)) {
    const fileId = 900 + nextId;
    graph.fileIndex.set(filePath, fileId);
    graph.nodes.set(fileId, {
      ...graphNode(fileId, declaration('File', filePath, 1, 200), filePath, 'typescript'),
      name: filePath,
      qualifiedName: `file:${filePath}`,
    });
    for (const symbol of symbols) {
      const id = nextId++;
      const entry = graphNode(id, symbol, filePath, 'typescript');
      graph.nodes.set(id, entry);
      graph.qnameIndex.set(entry.qualifiedName, id);
      ids.set(`${filePath}\u0000${symbol.qualifiedName}`, id);
    }
  }
  return {
    graph,
    idOf: (qualifiedName) => ids.get(`${FILE_B}\u0000${qualifiedName}`) ?? -1,
  };
}

function ctxOf(graph: KnowledgeGraph, files: ParsedFile[]): PipelineContext {
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
  return ctx;
}

function parsedFile(
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
      endLine: 200,
      children: [],
      symbols: [],
    },
    ast: null,
  };
}

interface CallEdge {
  readonly targetId: number;
  readonly resolution: string;
  readonly receiver: string | undefined;
  readonly receiverClass: string | undefined;
}

/** A property the edge carries as a string, or `undefined` when it carries something else or nothing. */
function stringProperty(
  properties: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = properties?.[name];
  return typeof value === 'string' ? value : undefined;
}

function callEdges(graph: KnowledgeGraph): CallEdge[] {
  return [...graph.edges.values()]
    .filter((edge) => edge.type === 'CALLS')
    .map((edge) => ({
      targetId: edge.targetId,
      resolution: stringProperty(edge.properties, 'resolution') ?? '',
      receiver: stringProperty(edge.properties, 'receiver'),
      receiverClass: stringProperty(edge.properties, 'receiverClass'),
    }));
}

/** `class Index { buildIndex() {} }`, alone in one file. */
function indexFile(): SymbolDefinition[] {
  return [
    declaration('Class', 'Index', 1, 10),
    declaration('Method', 'buildIndex', 2, 9, { containerName: 'Index' }),
  ];
}

describe('ScopeResolution — the receiver names a class, and the class names the member', () => {
  it('resolves a call on a field whose type was declared in another file', async () => {
    // `class Holder { index: Index; run() { this.index.buildIndex(); } }`
    const symbols = [
      // **The field's type is filed on the class**, which is what the provider emits and what the resolver reads.
      declaration('Class', 'Holder', 1, 20, {
        properties: { fieldTypes: JSON.stringify({ index: 'Index' }) },
      }),
      declaration('Method', 'run', 3, 19, { containerName: 'Holder' }),
    ];
    const { graph, idOf } = built({ [FILE_A]: indexFile(), [FILE_B]: symbols });
    const ctx = ctxOf(graph, [
      parsedFile(FILE_A, indexFile(), []),
      parsedFile(FILE_B, symbols, [reference(FILE_B, 'buildIndex', 5, 'this.index')]),
    ]);

    const result = await new ScopeResolutionPhase().execute(ctx);

    expect(callEdges(graph)).toEqual([
      {
        targetId: 2,
        resolution: 'receiverType',
        receiver: 'this.index',
        // **The class, on the edge**, so a reviewer of this edge can see what answered it.
        receiverClass: 'Index',
      },
    ]);
    // The arm that answered is reported by name, so a run can be read without counting edges by hand.
    const callsByArm = (result.output ?? {}) as Record<string, unknown>;
    expect(callsByArm['callsByArm']).toMatchObject({ receiverType: 1 });
    // The caller is the method that contains the call site, and the id is the one the edge points from.
    expect(graph.edges.size).toBe(1);
    expect([...graph.edges.values()][0]?.sourceId).toBe(idOf('Holder.run'));
  });

  it('resolves nothing from a receiver whose type nobody wrote down', async () => {
    const symbols = [
      declaration('Class', 'Holder', 1, 20),
      declaration('Method', 'run', 3, 19, { containerName: 'Holder' }),
    ];
    const { graph } = built({ [FILE_A]: indexFile(), [FILE_B]: symbols });

    await new ScopeResolutionPhase().execute(
      ctxOf(graph, [
        parsedFile(FILE_A, indexFile(), []),
        parsedFile(FILE_B, symbols, [reference(FILE_B, 'buildIndex', 5, 'this.index')]),
      ]),
    );

    // The field is there and the method is there, and without the annotation the two are unrelated facts.
    expect(callEdges(graph)).toEqual([]);
  });

  it('resolves nothing when two classes answer to the type name', async () => {
    const symbols = [
      // **The field's type is filed on the class**, which is what the provider emits and what the resolver reads.
      declaration('Class', 'Holder', 1, 20, {
        properties: { fieldTypes: JSON.stringify({ index: 'Index' }) },
      }),
      declaration('Method', 'run', 3, 19, { containerName: 'Holder' }),
    ];
    const { graph } = built({
      [FILE_A]: indexFile(),
      // A second `Index` in another file, with different members - a simple name with two answers.
      '/proj/other.ts': [
        declaration('Class', 'Index', 30, 40),
        declaration('Method', 'query', 31, 39, { containerName: 'Index' }),
      ],
      [FILE_B]: symbols,
    });

    await new ScopeResolutionPhase().execute(
      ctxOf(graph, [
        parsedFile(FILE_A, indexFile(), []),
        parsedFile(
          '/proj/other.ts',
          [
            declaration('Class', 'Index', 30, 40),
            declaration('Method', 'query', 31, 39, { containerName: 'Index' }),
          ],
          [],
        ),
        parsedFile(FILE_B, symbols, [reference(FILE_B, 'buildIndex', 5, 'this.index')]),
      ]),
    );

    expect(callEdges(graph)).toEqual([]);
  });

  it('resolves a call on a parameter whose type was declared', async () => {
    // **The shape that scored 0 of 18 claims for the global-name arm on `redis/ioredis`**: a function standing outside
    // any class receives the object it works on, and the annotation is the only thing that says what it is.
    const symbols = [
      declaration('Function', 'connect', 1, 10),
      declaration('Variable', 'self', 1, 1, {
        properties: { parameterOwner: 'connect', parameterType: 'Index' },
      }),
    ];
    const { graph } = built({ [FILE_A]: indexFile(), [FILE_B]: symbols });

    await new ScopeResolutionPhase().execute(
      ctxOf(graph, [
        parsedFile(FILE_A, indexFile(), []),
        parsedFile(FILE_B, symbols, [reference(FILE_B, 'buildIndex', 4, 'self')]),
      ]),
    );

    expect(callEdges(graph)).toEqual([
      {
        targetId: 2,
        resolution: 'receiverType',
        receiver: 'self',
        receiverClass: 'Index',
      },
    ]);
  });

  it("leaves the import arm's answer alone", async () => {
    // A call an import already explains must keep `resolution: 'import'`: the evidence is stronger than any inference
    // from a type, and moving it would make one rule's precision describe another's.
    const symbols = [
      declaration('Function', 'connect', 1, 10),
      declaration('Variable', 'self', 1, 1, {
        properties: { parameterOwner: 'connect', parameterType: 'Index' },
      }),
      // A module-level declaration of the same name, which the same-file arm would reach first.
      declaration('Function', 'buildIndex', 20, 25),
    ];
    const { graph } = built({ [FILE_A]: indexFile(), [FILE_B]: symbols });
    const ctx = ctxOf(graph, [
      parsedFile(FILE_A, indexFile(), []),
      parsedFile(FILE_B, symbols, [reference(FILE_B, 'buildIndex', 4, 'self')]),
    ]);
    ctx.phaseData.set('crossFile', {
      resolvedImports: [
        { sourceFile: FILE_B, resolvedFiles: [FILE_A], importedSymbols: ['buildIndex'] },
      ],
      importEdgesCreated: 0,
    });

    await new ScopeResolutionPhase().execute(ctx);

    expect(callEdges(graph)[0]).toMatchObject({ targetId: 2, resolution: 'import' });
  });
});
