// The orchestrator's contract with its callers, tested on the path the CLI uses.
//
// **The defect this exists for.** `analyze` is the CLI's headline command - "Analyze and index a repository into the
// knowledge graph" - and on an ordinary directory **six of the phases crashed**:
//
//   [scan] Cannot read properties of undefined (reading 'set')
//   [crossFile] [scopeResolution] [routes] [tools] [di]   Cannot read properties of undefined (reading 'get')
//
// `scan` opens with `ctx.phaseData.set('scan', ...)` and five later phases read what it wrote. **`phaseData` is the
// channel the phases talk through and no caller constructed it**; `graph` was the same. The CLI assembled its own
// context, omitted both, and needed `as unknown as PipelineContext` to compile - **the type system saying the same
// thing in a quieter voice.**
//
// **The fix belongs in the orchestrator, not in the CLI.** The orchestrator owns the context's lifetime, and a
// context assembled by a caller is a context that can omit what the pipeline requires. Every caller benefits from
// one place doing it, and this file is what holds that place.

import { describe, expect, it } from 'vitest';

import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { createAllPhases } from '../pipeline/phases/index.js';

import type { PipelineContext } from '@code-analyzer/shared';

/** A context as a caller would plausibly write one: the fields it knows about, and nothing else. */
function callerContext(rootDir: string): PipelineContext {
  const controller = new AbortController();
  return {
    projectId: 'orchestrator-contract',
    repoPath: rootDir,
    rootDir,
    signal: controller.signal,
    metadata: {},
  } as unknown as PipelineContext;
}

describe('the orchestrator and a context a caller assembled', () => {
  it('supplies the phase channel and the graph itself, so no phase crashes on their absence', async () => {
    const phases = createAllPhases();
    expect(phases.length).toBeGreaterThan(0);

    const result = await new PipelineOrchestrator(phases).execute(callerContext(process.cwd()));

    // **No phase failed**, which is the whole assertion: a phase that threw is reported in `errors` and its status is
    // not `success`. Six of them did before the orchestrator guaranteed these two fields - this is the test that
    // fails without the fix, and it failed exactly the way the CLI did.
    expect(result.errors).toHaveLength(0);
    const notSuccessful = result.phases.filter((p) => p.status !== 'success').map((p) => p.phaseId);
    expect(notSuccessful).toEqual([]);
    // And the pipeline ran everything it declares, rather than stopping early with a green summary.
    expect(result.phases).toHaveLength(phases.length);
  }, 300_000);

  it('does not overwrite a channel or a graph the caller did supply', async () => {
    const ctx = callerContext(process.cwd());
    (ctx as { phaseData?: Map<string, unknown> }).phaseData = new Map([['pre', 'existing']]);
    await new PipelineOrchestrator(createAllPhases()).execute(ctx);
    // The orchestrator creates what is missing; it is not a place that resets what is there.
    expect((ctx as { phaseData: Map<string, unknown> }).phaseData.get('pre')).toBe('existing');
  }, 300_000);
});
