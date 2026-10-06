// Every phase succeeds on a real corpus, so a phase cannot die quietly again.
//
// **The defect this exists for.** The `tools` phase returned `failed` on **every corpus since it was written** - one of
// its regexes has no capture group and the code read the tool name from `match[1]!` under a comment claiming the group
// was not optional. **The run reports `status: partial` and carries on**, so from the outside every run looked fine
// and the phase was dead for its whole life.
//
// **Six other findings in this stretch had the same shape** - a cast, a silent branch, an artifact written before it
// was checked, a test that passed both ways, a fallback nobody reported, and a comment asserting something false.
// **Each one turned a failure into something that looked like a result**, and each was found by accident.
//
// **This is the check that would have caught all of them on the day they arrived**: run the pipeline over a corpus of
// a known size and require that no phase failed and none was skipped.
//
// **It was verified by removing the fix**: with `match[1]!` restored, `tools` reports `failed` and this fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDefaultConfig } from '@code-analyzer/core';

import { PipelineOrchestrator } from '../orchestrator.js';
import { createAllPhases } from '../phases/index.js';

import type { PipelineContext } from '@code-analyzer/shared';

/** A corpus of a known size, built from one real file, so the run finishes and the result is comparable. */
function corpus(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'every-phase-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  const source = readFileSync('packages/shared/src/types/graph.ts', 'utf8');
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(dir, 'src', `c${i}.ts`), source.replace(/PipelineContext/g, `PipelineContext${i}`), 'utf8');
  }
  return dir;
}

describe('a full pipeline run', () => {
  it('leaves no phase failed and none skipped', async () => {
    const dir = corpus(10);
    try {
      const ctx = {
        projectId: 'every-phase',
        rootPath: dir,
        config: getDefaultConfig(),
        signal: new AbortController().signal,
        metadata: {},
      } as unknown as PipelineContext;

      const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);

      // **Both, because they fail differently.** `errors` is how the orchestrator reports a phase throwing;
      // `status` is how a phase reports its own outcome, and a phase can return `failed` without an entry in `errors`.
      const failed = result.phases.filter((p) => p.status !== 'success');
      expect(result.errors.map((e) => `[${e.phaseId}] ${e.message}`)).toEqual([]);
      expect(failed.map((p) => `${p.phaseId}: ${p.status}`)).toEqual([]);

      // **And the run's own summary**, which is what a caller reads: `partial` means a phase did not finish, and this
      // test is the reason to treat that as a failure rather than as a note.
      expect(result.status).toBe('complete');
      // A run that reached no files would satisfy everything above while measuring nothing.
      expect((result.graph as { fileIndex?: { size: number } }).fileIndex?.size ?? 0).toBeGreaterThan(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
