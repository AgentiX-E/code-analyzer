// A name is not an identity, and containment is what gives one.
//
// **The defect this file exists for, measured rather than guessed.** `Response.status` is a property getter and a
// property setter. Both are declared in the same class, both are called `status`, and every store, index and "open
// this symbol" link in this product identifies a node by one string — its qualified name. Keyed by name, the setter
// did not exist: `pallets/flask@3.0.3` merged **317**, `pallets/werkzeug@3.0.3` **372**, `colinhacks/zod@3.23.8`
// **378** and `redis/ioredis@5.4.2` **65** callable declarations into a same-named neighbour.
//
// What that looked like from the outside: `_clean_status` in `werkzeug/wrappers/response.py` reported as dead **while
// carrying an incoming `CALLS` edge**. The edge's source was `status` — the *parameter* of `Response.__init__`, which
// shares the setter's name. The call had been resolved to the wrong declaration, so the right one had no callers.
//
// Three questions follow, and each has a test below that runs the real provider and the real phases over a fixture:
//
//   1. **Do two declarations of one name survive?** Two nodes, two names, one distinguished by its line.
//   2. **Does a nested declaration get the name its nesting implies?** `outer.inner`, held by `outer`.
//   3. **Does a call reach the declaration or the name?** Two functions that each define `helper` and call it must
//      each call their own.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, beforeAll } from 'vitest';

import { GraphBuilder } from '../graph/graph-builder.js';
import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { getOrLoadProvider, groupCaptures } from '../pipeline/phase-helpers.js';
import {
  CrossFilePhase,
  ParsePhase,
  ScanPhase,
  ScopeResolutionPhase,
  StructurePhase,
} from '../pipeline/phases/index.js';

import type { KnowledgeGraph, PipelineContext, SymbolDefinition } from '@code-analyzer/shared';

const FIXTURES = fileURLToPath(new URL('./fixtures/declaration-identity/', import.meta.url));

interface Grouped {
  readonly symbols: SymbolDefinition[];
  readonly parents: number[];
}

/** The captures of one fixture file, grouped exactly as the parse phase groups them. */
async function grouped(language: string, file: string): Promise<Grouped> {
  const provider = await getOrLoadProvider(language);
  if (provider === null || provider === undefined) throw new Error(`no provider for ${language}`);
  const content = readFileSync(`${FIXTURES}${file}`, 'utf8');
  return groupCaptures(provider.parse(content, file), file);
}

function named(symbols: readonly SymbolDefinition[], name: string): SymbolDefinition[] {
  return symbols.filter((symbol) => symbol.name === name);
}

describe('two declarations of one name are two declarations', () => {
  it('keeps a property getter and its setter apart, and says which line the second is on', async () => {
    const { symbols, parents } = await grouped('python', 'models.py');
    const statuses = named(symbols, 'status').filter((symbol) => symbol.kind === 'Function');

    // The getter and the setter of one property. A merge by name keeps one and loses the other, which is exactly the
    // case that made a live method read as dead.
    expect(statuses).toHaveLength(2);
    const [getter, setter] = [statuses[0]!, statuses[1]!];
    expect(getter.startLine).toBe(14);
    expect(setter.startLine).toBe(18);

    // Two identities: the base name and the base name plus the line the second declaration is written on.
    expect(getter.qualifiedName).toBe('file:models.py:Response.status');
    expect(setter.qualifiedName).toBe('file:models.py:Response.status@18');

    // Both are held by the class, so both carry it as their container rather than the file.
    expect(getter.containerName).toBe('Response');
    expect(setter.containerName).toBe('Response');
    expect(parents[symbols.indexOf(setter)]).toBe(parents[symbols.indexOf(getter)]);
  });

  it('gives a graph node per declaration, while a re-add of one declaration is not a second node', async () => {
    const builder = new GraphBuilder(null);
    const ctx = {
      projectId: 'identity',
      rootPath: FIXTURES,
      phaseData: new Map<string, unknown>(),
      config: { projectId: 'identity', rootPath: FIXTURES },
    } as unknown as PipelineContext;
    const graph: KnowledgeGraph = builder.build(ctx);
    const fileNode = builder.addNode(graph, 'File', 'models.py', { filePath: 'models.py' });
    const getter = { filePath: 'models.py', startLine: 14, endLine: 15 };
    const setter = { filePath: 'models.py', startLine: 18, endLine: 19 };
    const first = builder.addNode(
      graph,
      'Method',
      'status',
      getter,
      'file:models.py:Response.status',
    );
    const second = builder.addNode(
      graph,
      'Method',
      'status',
      setter,
      'file:models.py:Response.status@18',
    );

    expect(first.id).not.toBe(second.id);
    expect(graph.nodes.size).toBe(5); // project + root folder + file + the two declarations
    expect(graph.qnameIndex.get('file:models.py:Response.status')).toBe(first.id);
    expect(graph.qnameIndex.get('file:models.py:Response.status@18')).toBe(second.id);
    expect(graph.fileIndex.get('models.py')).toBe(fileNode.id);

    // **The same declaration asked for twice is one node.** A pipeline that parses a file again, or a provider that
    // emits a member from two arms, must not double the graph.
    const again = builder.addNode(
      graph,
      'Method',
      'status',
      getter,
      'file:models.py:Response.status',
    );
    expect(again.id).toBe(first.id);
    expect(graph.nodes.size).toBe(5);
  });
});

describe('containment names a declaration', () => {
  it('files a function inside another function under the one that holds it', async () => {
    const { symbols, parents } = await grouped('python', 'models.py');
    const [inner] = named(symbols, 'inner');
    const [outer] = named(symbols, 'outer');
    expect(inner).toBeDefined();
    expect(outer).toBeDefined();
    expect(inner!.qualifiedName).toBe('file:models.py:outer.inner');
    expect(inner!.containerName).toBe('outer');
    expect(parents[symbols.indexOf(inner!)]).toBe(symbols.indexOf(outer!));
  });

  it('keeps a container the provider named when the file does not declare it', async () => {
    const { symbols } = await grouped('typescript', 'shapes.ts');
    const [fetchAll] = named(symbols, 'fetchAll');
    expect(fetchAll).toBeDefined();
    // `Legacy.prototype.fetchAll = function …` augments a class declared elsewhere. The name has to say which class
    // holds the member, not which file wrote to it.
    expect(fetchAll!.qualifiedName).toBe('Legacy.fetchAll');
    expect(fetchAll!.containerName).toBe('Legacy');
  });

  it('does not turn an object literal method into a member declaration', async () => {
    const { symbols } = await grouped('typescript', 'shapes.ts');
    // `routes = { handler() {} }` declares a property of an object; nothing holds it as a class member, and filing it
    // as one gives the graph a `handler` that competes with every real `handler` in the file.
    expect(named(symbols, 'handler')).toHaveLength(0);
    expect(named(symbols, 'routes')[0]?.kind).toBe('Variable');
    expect(named(symbols, 'store')[0]?.kind).toBe('Variable');
    // The class member that shares the object's method name is still a declaration, and still `Repo`'s.
    expect(named(symbols, 'load').map((symbol) => symbol.qualifiedName)).toEqual([
      'file:shapes.ts:Repo.load',
    ]);
  });
});

describe('a call reaches the declaration, not the name', () => {
  let graph: KnowledgeGraph;

  beforeAll(async () => {
    const empty: KnowledgeGraph = {
      projectId: 'declaration-identity',
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    };
    const ctx: PipelineContext = {
      projectId: 'declaration-identity',
      rootPath: FIXTURES,
      graph: empty,
      config: {
        projectId: 'declaration-identity',
        rootPath: FIXTURES,
        ignorePaths: [],
        excludePatterns: [],
        includePatterns: [],
        maxFileSize: 10 * 1024 * 1024,
        maxFiles: 1000,
        parseWorkers: 1,
        cacheDir: '.code-analyzer-test',
      },
      phaseData: new Map<string, unknown>(),
    };
    await new PipelineOrchestrator([
      new ScanPhase(),
      new StructurePhase(),
      new ParsePhase(),
      new CrossFilePhase(),
      new ScopeResolutionPhase(),
    ]).execute(ctx);
    graph = ctx.graph as KnowledgeGraph;
  });

  function idOf(suffix: string): number {
    for (const node of graph.nodes.values()) {
      if (node.qualifiedName !== null && node.qualifiedName.endsWith(suffix)) return node.id;
    }
    throw new Error(`no node named …${suffix}`);
  }

  function callsFrom(sourceId: number): number[] {
    return [...graph.edges.values()]
      .filter((edge) => edge.type === 'CALLS' && edge.sourceId === sourceId)
      .map((edge) => edge.targetId);
  }

  it('sends each caller to the helper it declared, not to the other one', () => {
    // Two functions, one local name. Resolved by name, both calls land on whichever `helper` the index kept last, and
    // the other one reports as dead while being called on the next line up.
    expect(callsFrom(idOf('first_caller'))).toContain(idOf('first_caller.helper'));
    expect(callsFrom(idOf('second_caller'))).toContain(idOf('second_caller.helper'));
    expect(callsFrom(idOf('first_caller'))).not.toContain(idOf('second_caller.helper'));
    expect(callsFrom(idOf('second_caller'))).not.toContain(idOf('first_caller.helper'));
  });

  it('resolves a name declared inside a function to that function, not to the module', () => {
    expect(callsFrom(idOf(':outer'))).toContain(idOf('outer.inner'));
  });

  it('gives the getter and the setter a node each in the full pipeline', () => {
    const statuses = [...graph.nodes.values()].filter(
      (node) => node.qualifiedName !== null && /:Response\.status(@\d+)?$/.test(node.qualifiedName),
    );
    expect(statuses.map((node) => node.startLine)).toEqual([14, 18]);
    expect(new Set(statuses.map((node) => node.id)).size).toBe(2);
  });
});
