// @code-analyzer — the same declaration named only in a type position, in the three languages that had no producer.
//
// **Why this file exists.** Iteration 83 gave TypeScript a producer for the reference kind `type` and left Java,
// Kotlin and Python without one, which is the shape of defect the audit `the-reference-kind-nobody-wrote` described:
// a classified reference with no emitter. The cost is not abstract - `private final Registry registry;` is how a
// dependency-injected Java service is written, `def send(p: RetryPolicy)` is how a Python one is, and in both the class
// is named at the annotation and nowhere else. A reachability pass that reads calls and value mentions reports the
// injected class dead on code that cannot start without it.
//
// **One checkout, because the question is one question.** A user does not ask "is the Java walk right" - they ask
// whether the report over their repository is right, and their repository is not one language. The three files below
// are the same user story three times, and each one carries its own decoy: a declaration that nothing names and that
// must stay in the report. Without the decoy, an implementation that exempted every type from the dead list would pass.
//
// **Kotlin's assertion is an edge and not a missing finding, deliberately.** This provider reports every declaration as
// exported - `fun send()` at the top level of a `.kt` file is public, and there is no modifier to check - so a Kotlin
// class never appears in the dead list whether the edge exists or not, and asserting its absence would pass on a graph
// with no type references at all. What the edge buys on Kotlin is change impact: "who is affected if `Outcome`
// changes" now answers `send`, and that is what is asserted.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { afterAll, describe, expect, it } from 'vitest';

import { computeReachability } from '../../packages/intelligence/src/impact/reachability.js';

import type { GraphEdge, PipelineContext } from '@code-analyzer/shared';

/** A fixed path: the index holds absolute paths, and a random suffix would change the tokens on every run. */
const SCRATCH = join(tmpdir(), 'code-analyzer-type-positions');

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * Java: a package-private class named by a field and a parameter, and a package-private one named by nothing.
 *
 * **`Service` is `public` and `Registry` is not**, which is what makes the chain the assertion is about: the published
 * class is a root, `Registry` is reachable only through the two annotations, and `Orphan` is reachable through
 * nothing.
 */
const SERVICE_JAVA = [
  'class Registry {',
  '  void refresh() { }',
  '}',
  '',
  'class Orphan {',
  '  void nobody() { }',
  '}',
  '',
  'public class Service {',
  '  private final Registry registry;',
  '  public Service(Registry registry) { this.registry = registry; }',
  '  public void run() { registry.refresh(); }',
  '}',
  '',
].join('\n');

/**
 * Python: the annotated class is module-private, so the annotation is the only thing that can keep it alive - and a
 * module-private class named by nothing stays in the report.
 */
const SERVICE_PY = [
  'class _RetryPolicy:',
  '    def refresh(self):',
  '        pass',
  '',
  'class _Orphan:',
  '    def nobody(self):',
  '        pass',
  '',
  'def send(p: _RetryPolicy) -> None:',
  '    p.refresh()',
  '',
].join('\n');

/** Kotlin: the return type is the only place `Outcome` is written. */
const SERVICE_KT = [
  'class Outcome {',
  '  fun isOk(): Boolean = true',
  '}',
  '',
  'fun send(o: Outcome): Boolean = o.isOk()',
  '',
].join('\n');

describe('a class named only in a type position, in Java and Python and Kotlin', () => {
  it('keeps every one of them out of the dead report, and leaves the decoys in it', async () => {
    delete process.env['CODE_ANALYZER_CACHE_DIR'];
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(join(SCRATCH, 'src', 'main', 'java'), { recursive: true });
    writeFileSync(join(SCRATCH, 'src', 'main', 'java', 'Service.java'), SERVICE_JAVA);
    writeFileSync(join(SCRATCH, 'src', 'service.py'), SERVICE_PY);
    writeFileSync(join(SCRATCH, 'src', 'Service.kt'), SERVICE_KT);

    const ctx = {
      projectId: 'type-positions-e2e',
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
    const typeEdgesInto = (name: string): GraphEdge[] => {
      const target = nodeNamed(name);
      return target === undefined
        ? []
        : [...graph.edges.values()].filter(
            (edge) => edge.targetId === target && String(edge.type) === 'USES_TYPE',
          );
    };

    // **The edge itself, for every language, with the rule that produced it on it.** A reader of a report has to be
    // able to disagree with `type-mention` rather than with "something kept it alive".
    for (const name of ['Registry', '_RetryPolicy', 'Outcome']) {
      const edges = typeEdgesInto(name);
      expect(edges.length).toBeGreaterThan(0);
      expect(edges.every((edge) => edge.properties['resolution'] === 'type-mention')).toBe(true);
    }
    // **And a type is a dependency, not a call.** A `CALLS` edge here would tell the call graph that the field's
    // declaration invokes the class it is typed with.
    const registry = nodeNamed('Registry');
    expect(
      [...graph.edges.values()].filter(
        (edge) => edge.targetId === registry && String(edge.type) === 'CALLS',
      ),
    ).toEqual([]);

    // **The entry points are named rather than inferred**, so what this asserts is the type edges and nothing about
    // the rules that decide what a package publishes. The published-surface rules have their own tests; a fixture that
    // leaned on them would fail for reasons that have nothing to do with a type position.
    const report = computeReachability(graph, { entryPoints: ['Service', 'send'] });
    const dead = report.dead.map((symbol) => symbol.name);

    // The three user stories: the annotated class is not dead ...
    expect(dead).not.toContain('Registry');
    expect(dead).not.toContain('_RetryPolicy');
    expect(dead).not.toContain('Outcome');
    // ... and the classes nothing names still are, which is the half that keeps this from passing on a rule that
    // exempts every type.
    expect(dead).toContain('Orphan');
    expect(dead).toContain('_Orphan');
  });
});
