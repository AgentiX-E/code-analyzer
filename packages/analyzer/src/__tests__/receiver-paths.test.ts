// @code-analyzer/analyzer — a receiver's type is a path through declarations, and every hop is a declaration.
//
// **Iteration 42 found the discriminator and stopped one hop short of it.** `this.index.buildIndex()` resolved because
// the field's annotation named a class; `a.b.m()`, a parameter property, a local bound to `new`, a local bound to
// `this`, and a union a guard narrows were all refused - not because the evidence was missing, but because the rule
// read exactly one annotation and gave up. On `redis/ioredis@5.4.2` that is 40 of the 68 call pairs the TypeScript
// checker expects and this graph did not claim: `this.redis.condition.subscriber.add(…)`,
// `this.connectionPool.findOrCreate(…)`, `const _this = this; _this.flushQueue(…)`.
//
// **So the rule is stated once, as a walk.** A receiver is a base and a path; the base is `this`, a parameter or a
// local, and every hop reads a field of the class the previous hop landed on. Nothing is inferred, and a hop with no
// annotation ends the walk - which is why every negative case below is as important as the positive one.

import { beforeEach, describe, expect, it } from 'vitest';

import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import {
  CrossFilePhase,
  ParsePhase,
  ScanPhase,
  ScopeResolutionPhase,
  StructurePhase,
} from '../pipeline/phases/index.js';

import type { KnowledgeGraph, PipelineContext } from '@code-analyzer/shared';

const FIXTURES = new URL('./fixtures/receiver-paths/', import.meta.url).pathname;

describe('the receiver of a call, resolved through the declarations that spell it', () => {
  let graph: KnowledgeGraph;

  beforeEach(async () => {
    const empty = {
      projectId: 'receiver-paths',
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    };
    const ctx = {
      projectId: 'receiver-paths',
      rootPath: FIXTURES,
      graph: empty,
      config: {
        projectId: 'receiver-paths',
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
    } as unknown as PipelineContext;
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
    const id = [...graph.nodes.values()].find(
      (node) => node.qualifiedName !== null && node.qualifiedName.endsWith(suffix),
    )?.id;
    if (id === undefined) throw new Error(`no node named …${suffix}`);
    return id;
  }

  /** The call edge from one declaration to another, with the arm that produced it. */
  function edgeOf(
    sourceSuffix: string,
    targetSuffix: string,
  ): { readonly resolution: unknown } | undefined {
    const source = idOf(sourceSuffix);
    const target = idOf(targetSuffix);
    const edge = [...graph.edges.values()].find(
      (candidate) =>
        candidate.type === 'CALLS' &&
        candidate.sourceId === source &&
        candidate.targetId === target,
    );
    return edge === undefined ? undefined : { resolution: edge.properties['resolution'] };
  }

  function callsFrom(suffix: string): string[] {
    const source = idOf(suffix);
    return [...graph.edges.values()]
      .filter((edge) => edge.type === 'CALLS' && edge.sourceId === source)
      .map((edge) => {
        const qualified = String(graph.nodes.get(edge.targetId)?.qualifiedName ?? '');
        return qualified.slice(qualified.lastIndexOf(':') + 1);
      });
  }

  it('reaches the member of the class a parameter property is declared to be', () => {
    // `constructor(private readonly store: Store)` writes a field the constructor does not name in its body. Two hops
    // follow it: `store` is a `Store`, and `index` is a `Store`'s `Index`.
    expect(edgeOf('Service.throughConstructor', 'Index.insert')?.resolution).toBe('receiverType');
  });

  it('reaches the member of what a local constructed', () => {
    expect(edgeOf('Service.throughConstruction', 'Index.insert')?.resolution).toBe('receiverType');
  });

  it('reaches the member of what a local annotated itself to be', () => {
    // `const chosen: Index = this.pick()` - the annotation is the only evidence, and the initialiser returns it.
    expect(edgeOf('Service.throughAnnotation', 'Index.insert')?.resolution).toBe('receiverType');
  });

  it('treats a local bound to `this` as the enclosing object', () => {
    // `const _this = this; _this.helper()` - the alias is how callback-style code keeps its receiver past a closure,
    // and the call is the same call `this.helper()` would have been. `_this` is not a name any language reads as the
    // enclosing object, which is why this is a rule and `self` is a coincidence.
    expect(edgeOf('Service.throughAlias', 'Service.helper')?.resolution).toBe('receiverType');
  });

  it('still reaches a member through one field, which is where the rule started', () => {
    expect(edgeOf('Service.throughField', 'Index.insert')?.resolution).toBe('receiverType');
    expect(edgeOf('Store.add', 'Index.insert')?.resolution).toBe('receiverType');
  });

  it('strips a union whose only other member is not a value, and then walks the path', () => {
    // `subscriber: false | SubscriptionSet` is how ioredis spells "off, or a set". The guard makes the call legal,
    // and the union has one member that is a type.
    expect(edgeOf('Store.subscribe', 'SubscriptionSet.add')?.resolution).toBe('receiverType');
  });

  it('walks a base named with an argument', () => {
    // `class Child extends Base<number>` - the base is `Base`, and a rule reading the whole text found no such class.
    expect(edgeOf('Child.run', 'Base.dispatch')?.resolution).toBe('inherited');
  });

  it('walks the extends clause an interface merged into a class contributes', () => {
    // `interface CommandSet extends CommandBase {}` beside `class CommandSet`: the class names no base and has one.
    // ioredis writes its whole command table this way, which is why `this.info(…)` had nowhere to go.
    expect(edgeOf('CommandSet.run', 'CommandBase.ping')?.resolution).toBe('inherited');
  });

  it('refuses a member no chain reaches, even when one declaration in the file carries the name', () => {
    // `this.begin()` in `Outsider` and `begin` in `Unrelated`: same name, same file, no relation. A rule that answered
    // this by name would be the global-name arm the measurement already deleted.
    expect(callsFrom('Outsider.go')).not.toContain('Unrelated.begin');
  });

  it('does not let a local bound to an object literal shadow a class of the same name into a resolution', () => {
    // `const Registry = { put: … }` is a value, and `Registry.put(...)` is a call on that value - not on the class
    // `Registry` that this file also declares and that carries the same member name.
    expect(callsFrom('Caller.run')).not.toContain('Registry.put');
  });

  it('attributes every call it claims to the declaration that holds it', () => {
    // **The whole set, not one edge.** A rule that resolves a path must not also emit the edges the path was built
    // from, and `new Index()` is a call on the class and stays one - constructing an object runs its constructor.
    expect(callsFrom('Service.throughConstructor')).toEqual(['Index.insert']);
    expect(callsFrom('Service.throughField')).toEqual(['Index.insert']);
    // The initialiser is a call of its own - `this.pick()` - and the annotation is what types the name it returns.
    expect(callsFrom('Service.throughAnnotation')).toEqual(['Service.pick', 'Index.insert']);
    expect(callsFrom('Service.throughConstruction')).toEqual(['Index', 'Index.insert']);
  });
});
