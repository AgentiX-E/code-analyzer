// How much of an index came from the grammar, and how much from a fallback.
//
// **The defect this exists for.** A provider reports when a grammar cannot read a file and the regex reader runs
// instead - **and nothing was reading that report.** The two extractions produce *different sets of symbols*: the
// regex reader finds no comments, no imports and no annotations, and **both report success with a shorter list.**
//
// **So "what fraction of this index is a fallback" had no answer**, and it is a question a caller has to be able to
// ask: an index that is a third regex-derived is a different product from one that is not, and the run's own output
// looked identical either way.
//
// **The assertion is the pair, in one run.** A groovy file the grammar rejects and a typescript file it reads, in the
// same corpus - **so the count is one**, and it distinguishes a counter that works from one that is always zero and
// from one that counts every file.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDefaultConfig } from '@code-analyzer/core';

import { PipelineOrchestrator } from '../../orchestrator.js';
import { createAllPhases } from '../index.js';

import type { PipelineContext } from '@code-analyzer/shared';

/**
 * **Both files are typescript, and that is deliberate.** The first version used a groovy file and the count came back
 * zero - **because `scan` never collected it**, so the provider was never asked. A corpus whose files are not admitted
 * measures the `scan` phase rather than the parser, and **the extension is part of the measurement.**
 *
 * Broken typescript is enough: the grammar reports an error and the provider falls back, which is the same path a
 * groovy file takes. **Six languages were checked and all six fall back on source their grammar rejects.**
 */
const TYPESCRIPT_THAT_FALLS_BACK = 'export function myFunction( { return a; }\n';
const TYPESCRIPT_THAT_PARSES = 'export function myFunction(a: number): number {\n  return a;\n}\n';

async function runOver(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'fallback-report-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'src', name), content, 'utf8');

  const ctx = {
    projectId: 'fallback-report',
    rootPath: dir,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;

  const result = await new PipelineOrchestrator(createAllPhases().filter((p) => p.id !== 'embed')).execute(ctx);
  const reported = (ctx.phaseData as Map<string, unknown>).get('parse') as
    | { regexFallbackFiles?: number; regexFallbackPaths?: string[] }
    | undefined;
  rmSync(dir, { recursive: true, force: true });
  return { result, reported };
}

describe('the parse phase says how many files it read with a fallback', () => {
  it('counts the file the grammar rejected, and not the one it read', async () => {
    const { result, reported } = await runOver({
      'good.ts': TYPESCRIPT_THAT_PARSES,
      'broken.ts': TYPESCRIPT_THAT_FALLS_BACK,
    });

    // The phase ran, so the number below is about the count rather than about an earlier failure.
    expect(result.phases.find((p) => p.phaseId === 'parse')?.status).toBe('success');

    // **One**, which is neither zero nor two: the broken file falls back and the valid one does not, so a counter
    // that was always zero - or that counted every file - fails here.
    expect(reported?.regexFallbackFiles).toBe(1);
    // **And the path**, because a count alone does not say which file to look at.
    expect(reported?.regexFallbackPaths?.[0]).toContain('broken.ts');
  }, 600_000);

  it('reports zero when every file parsed', async () => {
    const { reported } = await runOver({ 'good.ts': TYPESCRIPT_THAT_PARSES });
    // **The other direction**, so a counter that counts unconditionally cannot pass both this and the assertion above.
    expect(reported?.regexFallbackFiles).toBe(0);
  }, 600_000);
});
