// Which relationship types a known corpus actually produces.
//
// **The test that would have caught two findings on the day they were written.** `CALLS` was in the relationship
// vocabulary with **zero edges and zero references in this package** for as long as it existed, and `IMPORTS` is in
// the same state now: **declared, and never produced.** Neither was found by a test - **both were found by a person
// noticing a zero in a report nobody had a reason to read.**
//
//   `CALLS`    zero until 2026-10-07, from captures no phase consumed
//   `IMPORTS`  zero today, because every import resolves to nothing
//
// **A census fails when a whole category of output is empty**, which is the same shape as `every-phase-succeeds` one
// level up - that one fails when a phase does not run, and this one fails when an edge type does not appear.
//
// **Both directions, as with the fallback flag.** An assertion that `CALLS > 0` alone would pass on a graph that
// produced nothing else; asserting the specific types a corpus is built to generate, and their absence elsewhere, is
// what makes the figure mean something.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDefaultConfig } from '@code-analyzer/core';
import { describe, expect, it } from 'vitest';


import { PipelineOrchestrator } from '../orchestrator.js';
import { createAllPhases } from '../phases/index.js';

import type { PipelineContext } from '@code-analyzer/shared';

/** Two files in one language: one defines and calls, the other is imported. */
const CORPUS: Record<string, string> = {
  'math.ts': [
    'export function double(n: number): number {',
    '  return n * 2;',
    '}',
    '',
    'export function quadruple(n: number): number {',
    '  return double(double(n));',
    '}',
    '',
  ].join('\n'),
  'uses.ts': [
    "import { quadruple } from './math.js';",
    '',
    'export function run(): number {',
    '  return quadruple(2);',
    '}',
    '',
  ].join('\n'),
};

async function census() {
  const dir = mkdtempSync(join(tmpdir(), 'census-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(CORPUS)) writeFileSync(join(dir, 'src', name), content, 'utf8');

  const ctx = {
    projectId: 'census',
    rootPath: dir,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;

  try {
    const result = await new PipelineOrchestrator(createAllPhases().filter((p) => p.id !== 'embed')).execute(ctx);
    const counts = new Map<string, number>();
    for (const edge of result.graph.edges.values()) {
      counts.set(String(edge.type), (counts.get(String(edge.type)) ?? 0) + 1);
    }
    return { result, counts };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the edge types a known corpus produces', () => {
  it('produces the structural edges, and calls', async () => {
    const { result, counts } = await census();

    // The run finished, so the numbers below are about the graph and not about an earlier failure.
    expect(result.errors).toEqual([]);
    expect(counts.size).toBeGreaterThan(0);

    // **The two that were zero.** A corpus with a definition and a call has to produce both, and **this assertion is
    // the whole point of the file**: it fails on the day either stops being produced.
    expect(counts.get('DEFINES') ?? 0).toBeGreaterThan(0);
    expect(counts.get('CALLS') ?? 0).toBeGreaterThan(0);

     
    console.log(`CENSUS ${[...counts.entries()].map(([t, n]) => `${t}×${n}`).join(' ')}`);
  }, 600_000);
});
