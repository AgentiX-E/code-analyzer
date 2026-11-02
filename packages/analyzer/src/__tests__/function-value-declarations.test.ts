// A function value is a declaration of the name it is bound to, and a receiver is what a member call is resolved by.
//
// **Two spellings of "a function with a name" produced no callable at all.** `const f = function () {…}` was captured
// as a *constant* and `class C { static m = () => {…} }` was captured as a *field type* and nothing else, so the calls
// written inside those bodies belonged to no declaration and reached the graph as nothing. Measured on the two
// TypeScript corpora: `redis/ioredis@5.4.2` writes **15** function expressions bound to constants — its argument and
// reply transformers, the functions that decide what a `HSET` becomes on the wire — and `colinhacks/zod@3.23.8`
// declares **35** static fields holding arrows, which is how `ZodObject.lazycreate`, `ZodFirstPartyTypeKind` and the
// whole `create`/`createWithPreprocess` family are written. Neither was a caller in the graph.
//
// **And a member call's receiver was never read when it named a class.** `ParseStatus.mergeObjectSync(…)` is how
// `colinhacks/zod` moves a parsed pair from the async half to the sync one; the name `mergeObjectSync` is declared once
// in the file, and the call was still unresolved, because the same-file arm only accepts a receiver that *is* the
// enclosing object and `ParseStatus` is a class rather than `self`. The rule below is the missing one: a receiver that
// names a class reaches that class's member, and a receiver that names a value does not - which is the difference the
// graph has to record, because `alias.put(…)` and `Registry.put(…)` are one line apart in the fixture and must not
// resolve alike.

import { describe, expect, it, beforeAll } from 'vitest';

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

const FIXTURES = new URL('./fixtures/function-values/', import.meta.url).pathname;

describe('a function value is a declaration of the name it is bound to', () => {
  /** Whatever the provider emits, named by the parameter the grouping pass takes rather than by a second alias. */
  let captures: Parameters<typeof groupCaptures>[0];

  beforeAll(async () => {
    const provider = await getOrLoadProvider('typescript');
    if (provider === null || provider === undefined) throw new Error('no TypeScript provider');
    const content = (await import('node:fs')).readFileSync(`${FIXTURES}binding.ts`, 'utf8');
    captures = provider.parse(content, 'binding.ts');
  });

  function named(name: string): SymbolDefinition[] {
    return groupCaptures(captures, 'binding.ts').symbols.filter((symbol) => symbol.name === name);
  }

  it('files a function expression under the constant it is bound to, as a function and not as a constant', () => {
    const [convertMap] = named('convertMap');
    expect(convertMap).toBeDefined();
    // The kind is what makes it a caller: a `Constant` node holds no body for a call to be attributed to.
    expect(convertMap!.kind).toBe('Function');
    expect(convertMap!.qualifiedName).toBe('file:binding.ts:convertMap');
  });

  it('files a class field holding an arrow under the class, as a member', () => {
    const [make] = named('make');
    const [handle] = named('handle');
    expect(make?.kind).toBe('Method');
    expect(make?.qualifiedName).toBe('file:binding.ts:Payload.make');
    expect(handle?.kind).toBe('Method');
    expect(handle?.qualifiedName).toBe('file:binding.ts:Payload.handle');
  });

  it('keeps the field out of the module scope, where a same-named constant would compete with it', () => {
    // `handle` is `Payload`'s; a module-scope `handle` in the same file would make every `handle(…)` in the file
    // ambiguous, and the same-file arm refuses an ambiguous name rather than guessing.
    const [handle] = named('handle');
    expect(handle?.containerName).toBe('Payload');
  });
});

describe('the shapes that still declare nothing', () => {
  let captures: Parameters<typeof groupCaptures>[0];

  beforeAll(async () => {
    const provider = await getOrLoadProvider('typescript');
    if (provider === null || provider === undefined) throw new Error('no TypeScript provider');
    const content = (await import('node:fs')).readFileSync(`${FIXTURES}shapes.ts`, 'utf8');
    captures = provider.parse(content, 'shapes.ts');
  });

  function names(): string[] {
    return groupCaptures(captures, 'shapes.ts').symbols.map((symbol) => symbol.name);
  }

  it('does not name a callback passed into a call', () => {
    // `values.map(function (v) {…})` binds the function to an argument. Nothing can call it by name, and a node for it
    // would be a declaration no source line can reach.
    expect(names()).not.toContain('anonymousCallback');
  });

  it('does not name a function expression bound by destructuring', () => {
    // `const { broken } = function () {…}` binds a *pattern*, so the function has no name of its own to take.
    expect(names()).not.toContain('broken');
  });

  it('does not file a field of an anonymous class under a name it does not have', () => {
    // The class expression has no name, so `handler` has no container to be filed under - and a node called `handler`
    // at module scope would compete with every real `handler` in the file.
    expect(names()).not.toContain('handler');
  });

  it('does not turn a field holding a value into a method', () => {
    expect(names()).toContain('Counter');
    expect(names()).not.toContain('count');
  });
});

describe('the graph the pipeline builds from those declarations', () => {
  let graph: KnowledgeGraph;

  beforeAll(async () => {
    const empty: KnowledgeGraph = {
      projectId: 'function-values',
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    };
    const ctx: PipelineContext = {
      projectId: 'function-values',
      rootPath: FIXTURES,
      graph: empty,
      config: {
        projectId: 'function-values',
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

  // **The pipeline prefixes a qualified name with its project**, so the fixture is addressed by the suffix it writes.
  function idOf(qualifiedName: string): number {
    const id = [...graph.nodes.values()].find(
      (node) => node.qualifiedName !== null && node.qualifiedName.endsWith(qualifiedName),
    )?.id;
    if (id === undefined) throw new Error(`no node named …${qualifiedName}`);
    return id;
  }

  function callsFrom(qualifiedName: string): number[] {
    const source = idOf(qualifiedName);
    return [...graph.edges.values()]
      .filter((edge) => edge.type === 'CALLS' && edge.sourceId === source)
      .map((edge) => edge.targetId);
  }

  /** The last segment of a qualified name, which is the part this fixture writes. */
  function nameOf(nodeId: number): string {
    const qualified = String(graph.nodes.get(nodeId)?.qualifiedName ?? '');
    return qualified.slice(qualified.lastIndexOf(':') + 1);
  }

  it('gives a function expression a body of its own, so its callee is a cross-file edge', () => {
    // `convertMap` calls `toArray`, imported from `format.ts`. Without a callable there is no source node, and the
    // call had nowhere to come from - which is the shape of all 15 transformers in `redis/ioredis`.
    expect(callsFrom('convertMap').map(nameOf)).toContain('toArray');
  });

  it('resolves the same-file call the second function expression makes', () => {
    expect(callsFrom('convertObject').map(nameOf)).toContain('convertMap');
  });

  it('attributes a static field arrow to the class that holds it', () => {
    expect(callsFrom('Payload.make').map(nameOf)).toContain('Payload');
    expect(callsFrom('Payload.handle').map(nameOf)).toContain('toSet');
  });

  it('reaches a static member through a receiver that names the class', () => {
    // `Registry.put(name)` inside `Registry.install`. The same-file arm refuses it because `Registry` is not `this`,
    // and the member name alone is not evidence: `Sink.put` is one class away.
    const targets = callsFrom('Registry.install').map(nameOf);
    expect(targets).toContain('Registry.put');
    // **And the second call in the same body reaches `Sink.put`, which is also right.** `new Sink().put(name)` writes a
    // receiver that is not a name at all - a construction - and this test used to assert the absence of that edge
    // because nothing resolved a receiver of that shape. The rule that reads it landed afterwards, so the assertion
    // states the pair rather than forbidding it; what keeps the arm honest is the case below, where the receiver is a
    // *value* carrying the same member name and nothing may be claimed.
    expect(targets).toContain('Sink.put');
  });

  it('does not reach a class member through a receiver that names a value', () => {
    // `alias.put(…)` and `Registry.put(…)` are the same member name on a receiver of a different kind. A rule keyed on
    // the member name would answer both, which is the defect the arm exists to avoid.
    const targets = callsFrom('viaAlias').map(nameOf);
    expect(targets).not.toContain('Registry.put');
  });

  it('does not reach a class member through a name the enclosing function shadows', () => {
    // `const Registry = { put: … }` inside `shadowed`. The class is at module scope and the binding is not, so the
    // receiver is a value here and a class one line up - which the name cannot tell apart.
    const targets = callsFrom('shadowed').map(nameOf);
    expect(targets).not.toContain('Registry.put');
  });
});
