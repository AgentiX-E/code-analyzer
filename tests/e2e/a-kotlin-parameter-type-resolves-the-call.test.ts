// @code-analyzer — the call a Kotlin parameter's type answers, and where that type is written.
//
// **Why this file exists.** Iteration 84 gave Kotlin a producer for `type.reference`, so `p: RetryPolicy` names a
// declaration. Iteration 85 published what the declaration *is* — `parameterType`, `parameterOwner`,
// `parameterCount`, `returnType`, `fieldTypes` — and this test is the half that keeps those facts from being written
// into the graph and read by nothing. A fact nobody consumes is the same defect the type reference was: a promise with
// no caller.
//
// **The user story is one sentence**: "`p.refresh()` inside `fun send(p: RetryPolicy)` must resolve to
// `RetryPolicy.refresh`." Before iteration 85 the graph held `signature: 'fun send(p: RetryPolicy)'` — the source
// again, one layer up — and no `parameterType` at all, so the receiver `p` had no type and the call had no target.
//
// **What would make this pass for the wrong reason.** A call by name alone would find `refresh` on the only class that
// declares it and prove nothing about the parameter, so a second class declares a `refresh` of its own and the test
// asserts **which** one is reached. The decoy is not decoration: name-only resolution picks the first by line order and
// would answer `Unrelated.refresh` if the parameter type were ignored.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { afterAll, describe, expect, it } from 'vitest';

import { fixedScratch } from './scratch-root.js';

import type { GraphEdge, PipelineContext } from '@code-analyzer/shared';

/**
 * **A fixed path, and the index is why.** A random suffix puts a different token into the index on every run, so the same
 * source ranks differently from one run to the next - a fixture defect that reads like a product one. `fixedScratch`
 * keeps the name fixed while keeping the directory out of the shared temporary namespace; see `scratch-root.ts`.
 */
const SCRATCH = fixedScratch('code-analyzer-kotlin-parameter');

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * Two classes with a `refresh` of their own, and one call written on a parameter.
 *
 * `Unrelated` is declared **first**, so a resolver reading only the name reaches it and the assertion fails by picking
 * the wrong target rather than by finding none.
 */
const SERVICE_KT = [
  'class Unrelated {',
  '  fun refresh() {}',
  '}',
  '',
  'class RetryPolicy {',
  '  fun refresh() {}',
  '}',
  '',
  'class Service {',
  '  fun send(p: RetryPolicy) {',
  '    p.refresh()',
  '  }',
  '}',
  '',
].join('\n');

describe('a call written on a Kotlin parameter', () => {
  it('resolves through the parameter type to the class that declares it', async () => {
    delete process.env['CODE_ANALYZER_CACHE_DIR'];
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(join(SCRATCH, 'src'), { recursive: true });
    writeFileSync(join(SCRATCH, 'src', 'Service.kt'), SERVICE_KT);

    const ctx = {
      projectId: 'kotlin-parameter-e2e',
      rootPath: SCRATCH,
      config: { ...getDefaultConfig(), rootPath: SCRATCH },
      signal: new AbortController().signal,
      metadata: {},
    } as unknown as PipelineContext;

    const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
    const { graph } = pipeline;

    const nodesNamed = (name: string): number[] =>
      [...graph.nodes.values()]
        .filter((node) => node.name === name && node.label !== 'File')
        .map((node) => node.id);
    const send = nodesNamed('send')[0];
    const refreshTargets = nodesNamed('refresh');
    expect(send).toBeDefined();
    // **Both decoys exist**, which is what makes the choice between them a fact rather than an accident.
    expect(refreshTargets).toHaveLength(2);

    const calls: GraphEdge[] = [...graph.edges.values()].filter(
      (edge) => edge.sourceId === send && String(edge.type) === 'CALLS',
    );
    expect(calls).toHaveLength(1);

    // **The class the parameter is typed with, not the first `refresh` in the file.** `Unrelated` is declared first and
    // is the wrong answer that name-only resolution gives.
    const target = graph.nodes.get(calls[0]!.targetId);
    expect(target?.name).toBe('refresh');
    expect(target?.qualifiedName).toContain('RetryPolicy');
    expect(target?.qualifiedName).not.toContain('Unrelated');
  });
});
