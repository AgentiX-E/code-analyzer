// @code-analyzer — a declaration named only in a type position, and the report that called it dead.
//
// **Why this file exists.** `captureTagToReferenceKind` has mapped the capture tag `type.reference` to the reference
// kind `type` since the table was written, and **no provider ever emitted the tag**: 3,479 references in
// `colinhacks/zod`'s `src/types.ts` (a real file, counted) held **zero** of them. The phase had arms for `call` and
// `access` and none for `type`, so the kind was a classification with no producer and no consumer.
//
// **What it cost, measured.** `abstract class Class` in `colinhacks/zod@3.23.8` is named exactly once, inside
// `<T extends typeof Class>`, and `Dead Code Accuracy` held the product to a ceiling of zero findings on that corpus
// and read **one** — on a library that publishes every name it declares. The finding was not about zod; it was about
// a reference nobody recorded.
//
// **What would make this pass for the wrong reason.** A fixture where the class is exported would be kept alive by the
// published surface and prove nothing, so the class here is private. A fixture where the mentioning function is dead
// would leave the class unreachable for the right reason and also prove nothing, so the function is exported - the
// dependency chain is `published name → function → USES_TYPE → class` and every link is asserted. And a decoy class
// that nothing names is asserted to remain dead, because an edge that exempts every type from the report would pass
// the first two assertions and mean the opposite of what it claims.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { afterAll, describe, expect, it } from 'vitest';

import { computeReachability } from '../../packages/intelligence/src/impact/reachability.js';

import { fixedScratch } from './scratch-root.js';

import type { GraphEdge, PipelineContext } from '@code-analyzer/shared';

/**
 * **A fixed path, and the index is why.** A random suffix puts a different token into the index on every run, so the same
 * source ranks differently from one run to the next - a fixture defect that reads like a product one. `fixedScratch`
 * keeps the name fixed while keeping the directory out of the shared temporary namespace; see `scratch-root.ts`.
 */
const SCRATCH = fixedScratch('code-analyzer-type-mention');

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * The shape zod writes, in nine lines.
 *
 * `Class` is private and is named once, in a type position. `Unused` is private and is named nowhere. `instanceOfType`
 * is exported, so the published surface reaches it and the question is what it reaches in turn.
 */
const TYPES_TS = [
  'abstract class Class {',
  '  constructor(..._: unknown[]) {}',
  '}',
  '',
  'export const instanceOfType = <T extends typeof Class>(cls: T): boolean => cls !== null;',
  '',
  'class Unused {',
  '  run(): void {}',
  '}',
  '',
].join('\n');

describe('a class named only in a type position', () => {
  it('is a dependency of the declaration that names it, and is not reported as dead', async () => {
    delete process.env['CODE_ANALYZER_CACHE_DIR'];
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(join(SCRATCH, 'src'), { recursive: true });
    writeFileSync(join(SCRATCH, 'src', 'types.ts'), TYPES_TS);
    writeFileSync(
      join(SCRATCH, 'src', 'index.ts'),
      "export { instanceOfType } from './types.js';\n",
    );

    const ctx = {
      projectId: 'type-mention-e2e',
      rootPath: SCRATCH,
      config: { ...getDefaultConfig(), rootPath: SCRATCH },
      signal: new AbortController().signal,
      metadata: {},
    } as unknown as PipelineContext;

    const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
    const { graph } = pipeline;

    const nodeNamed = (name: string): number | undefined => {
      for (const node of graph.nodes.values()) {
        if (node.name === name && node.label !== 'File') return node.id;
      }
      return undefined;
    };

    const classNode = nodeNamed('Class');
    const factoryNode = nodeNamed('instanceOfType');
    expect(classNode).toBeDefined();
    expect(factoryNode).toBeDefined();

    // **The edge itself, with the rule that produced it on it.** A reader of the report has to be able to disagree
    // with `type-mention` rather than with "something kept it alive".
    const typeEdges: GraphEdge[] = [...graph.edges.values()].filter(
      (edge) => edge.targetId === classNode && String(edge.type) === 'USES_TYPE',
    );
    expect(typeEdges).toHaveLength(1);
    expect(typeEdges[0]!.properties['resolution']).toBe('type-mention');
    expect(typeEdges[0]!.properties['sourceLine']).toBe(5);
    // **And it is not a call.** `typeof Class` reads a type, and the call graph must not learn that something invokes
    // `Class` - the mistake that made every JavaScript method call a `FUNCTION_CALL` in an earlier iteration.
    expect(
      [...graph.edges.values()].filter(
        (edge) => edge.targetId === classNode && edge.type === 'CALLS',
      ),
    ).toEqual([]);

    // The chain the fix exists for: a published name reaches the function, the function names the type.
    expect(
      [...graph.edges.values()].some(
        (edge) => edge.sourceId === factoryNode && edge.targetId === classNode,
      ),
    ).toBe(true);

    const report = computeReachability(graph);
    const dead = report.dead.map((symbol) => symbol.name);
    expect(dead).not.toContain('Class');
    // **The decoy, which is the half that keeps this honest.** `Unused` is private, named nowhere, and still reported.
    expect(dead).toContain('Unused');
  });
});
