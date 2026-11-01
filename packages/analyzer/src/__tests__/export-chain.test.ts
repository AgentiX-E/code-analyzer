// @code-analyzer/analyzer — a name a module re-exports is that module's name, and the chain is walked to its end.
//
// **The resolver walked one hop, and a front door is not one hop.** `colinhacks/zod` declares `parse` in `src/types.ts`,
// re-exports it from `src/external.ts`, and re-exports that from `src/index.ts`. Every test file in the checkout writes
// `import * as z from "../index"` and calls `z.parse(…)`, so the name reaches a file that declares nothing, and the
// resolver stopped there: on that corpus **twelve call pairs the TypeScript checker expects and this graph never
// claimed**, and it was the largest single cause left.
//
// **Two statements are read, and both directions are stated as data.** `export * from "./x"` publishes every name `x`
// exports; `export { a as b } from "./x"` publishes `b` and means `a`. What is deliberately *not* read is as important:
// a barrel binds nothing - a bare call written in the barrel cannot reach the names it publishes - so a re-export is
// kept out of the map the barrel's own calls resolve against.
//
// Every case below is one of the four ways the walk can end: at a declaration, at a name two files publish, at itself,
// or at nothing.

import { beforeEach, describe, expect, it } from 'vitest';

import { buildGraph, callsFrom, targets } from './support/pipeline-graph.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

describe('a call through the module a name was imported from', () => {
  let graph: KnowledgeGraph;

  beforeEach(async () => {
    graph = await buildGraph('export-chain');
  });

  it('walks two barrels to the declaration, for a namespace alias', () => {
    // `import * as api from './barrel-two'` — `barrel-two` re-exports `barrel-one`, which re-exports `leaf`.
    expect(callsFrom(graph, 'viaNamespace')).toContainEqual(
      expect.objectContaining({ target: 'leafRun', file: 'leaf.ts', resolution: 'namespace' }),
    );
  });

  it('walks the same chain for a named import', () => {
    expect(callsFrom(graph, 'viaImport')).toContainEqual(
      expect.objectContaining({ target: 'leafRun', file: 'leaf.ts', resolution: 'import' }),
    );
  });

  it('publishes a name under the name the clause gives it', () => {
    // `export { leafRun as launch } from './leaf'` — the consumer imports `launch`, and the target declares `leafRun`.
    expect(callsFrom(graph, 'viaRenamed')).toContainEqual(
      expect.objectContaining({ target: 'leafRun', file: 'leaf.ts' }),
    );
  });

  it('answers with the file that declares the name rather than the barrel it was asked about', () => {
    // The edge's target is a node, and the node is the declaration: nothing points at `barrel-two`, which holds no
    // declaration to point at.
    const files = callsFrom(graph, 'viaImport').map((call) => call.file);
    expect(files).toEqual(['leaf.ts']);
  });

  it('refuses a name two files publish', () => {
    // `collide.ts` re-exports `clash` from two different files. One name, two declarations, no answer - the same rule
    // the file-scope index applies to a name declared twice inside one file.
    expect(targets(graph, 'viaAmbiguousBarrel')).toEqual([]);
  });

  it('prefers the declaration the file makes to the one it publishes', () => {
    // `shadow.ts` re-exports `clash` and declares its own. A local name shadows a published one, in this resolver as
    // in the language.
    expect(callsFrom(graph, 'viaShadowedBarrel')).toContainEqual(
      expect.objectContaining({ target: 'clash', file: 'shadow.ts' }),
    );
  });

  it('stops at a cycle instead of walking it forever', () => {
    // `cycle-a` publishes `cycle-b`'s names and `cycle-b` publishes `cycle-a`'s. Nothing is declared either way, and
    // the walk has to say so rather than revisit the two files forever.
    expect(targets(graph, 'viaCycle')).toEqual([]);
  });

  it('refuses a name the chain does not publish, even when a file on it declares one', () => {
    // `unpublished()` is declared in `quiet.ts`, which no barrel publishes. An import asking a barrel for it names
    // nothing, and the barrel is not a licence to answer with the nearest declaration.
    expect(targets(graph, 'viaUnpublishedName')).toEqual([]);
  });

  it('refuses a member the namespace does not publish', () => {
    // `api.leafIdleMissing()` — the alias is bound to a real module and the name is published by nobody.
    expect(targets(graph, 'viaAbsentName')).toEqual([]);
  });

  it('leaves the barrel itself with no call edges, because it declares no calls', () => {
    // **A re-export is not an import.** `barrel-two.ts` writes `export * from './barrel-one'`, and if that record were
    // filed as an import, every bare call in every barrel would resolve against the names of whatever it publishes.
    expect([...graph.nodes.values()].filter((node) => node.name === 'barrel-two')).toEqual([]);
  });
});
