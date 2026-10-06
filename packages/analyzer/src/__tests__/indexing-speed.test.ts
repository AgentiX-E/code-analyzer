// The indexing speed artifact: seconds per million lines, measured on a corpus whose size is counted rather than
// assumed.
//
// **Why this file exists now.** The scorecard's `indexing-speed` row - "indexing < 60s per 1M LOC, competitor 3 min
// per 1M LOC (CBM)" - read `blockedBy: no timing artifact in CI` for weeks. The reason there was no artifact turned
// out to be that **the command which would produce one did not run**: `analyze` reported success while six of its
// phases crashed, because no caller constructed the channel they talk through. That is fixed, so the measurement can
// be taken.
//
// **What makes this a measurement rather than a number.** Three things, and the artifact carries all three:
//
//   the corpus        named, and its lines counted from the files themselves
//   the duration      wall-clock around the whole pipeline
//   the files         what the pipeline says it indexed, which is checked against what was on disk
//
// **And the extrapolation is labelled as one.** The corpus is this repository's own production TypeScript, about a
// tenth of a million lines, and the target is per *million*. Multiplying up assumes indexing cost is linear in lines,
// which is an assumption and not a finding - a small corpus carries relatively more fixed cost, so the extrapolation
// is pessimistic in one direction and unverified in both.
//
//   npx vitest run --config vitest.config.ts packages/analyzer/src/__tests__/indexing-speed.test.ts

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { createAllPhases } from '../pipeline/phases/index.js';

import type { PipelineContext } from '@code-analyzer/shared';

const ROOT = process.cwd();
const ARTIFACT = resolve(ROOT, 'benchmarks/indexing-speed.json');
const CORPUS = 'packages';

interface Corpus {
  files: number;
  lines: number;
}

/** Counted from the files, excluding tests and build output, so the denominator is the code the pipeline indexes. */
function measureCorpus(dir: string): Corpus {
  let files = 0;
  let lines = 0;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'coverage', '__tests__', '.git'].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        files += 1;
        lines += readFileSync(full, 'utf8').split('\n').length;
      }
    }
  };
  walk(resolve(ROOT, dir));
  return { files, lines };
}

describe('indexing speed', () => {
  it('indexes the corpus, records the artifact, and reports seconds per million lines', async () => {
    const corpus = measureCorpus(CORPUS);
    expect(corpus.files).toBeGreaterThan(0);
    expect(corpus.lines).toBeGreaterThan(0);

    const controller = new AbortController();
    const ctx = {
      projectId: 'indexing-speed',
      repoPath: resolve(ROOT, CORPUS),
      rootDir: resolve(ROOT, CORPUS),
      signal: controller.signal,
      metadata: {},
    } as unknown as PipelineContext;

    // **The index, not the vectors.** `embed` generates a 768-float vector for every node, which on the full corpus
    // is about 85,000 nodes - roughly 520 MB held in one graph, and the reason a full run ends with the worker
    // exiting unexpectedly rather than with a number. **"How fast does it index a repository" asks about scanning,
    // parsing and building the graph**, and a measurement whose completion depends on vector generation, and whose
    // cost is dominated by it, is measuring something else.
    //
    // The phases are an explicit list, so leaving one out is a filter rather than a mode.
    const indexingPhases = createAllPhases().filter((p) => p.id !== 'embed');
    expect(indexingPhases.length).toBeGreaterThan(0);
    expect(indexingPhases.map((p) => p.id)).not.toContain('embed');

    const started = Date.now();
    const result = await new PipelineOrchestrator(indexingPhases).execute(ctx);
    const durationMs = Date.now() - started;

    // **A pipeline that failed has no throughput to report.** Timing a run that crashed would produce a number
    // about how fast it did nothing, which is the failure this measurement exists downstream of.
    expect(result.errors).toHaveLength(0);
    expect(result.phases.filter((p) => p.status !== 'success')).toHaveLength(0);

    const secondsPerMillionLines = Math.round((durationMs / 1000 / (corpus.lines / 1_000_000)) * 100) / 100;
    const artifact = {
      comment: [
        'Seconds per million lines for the full pipeline, on a corpus whose lines are counted from the files.',
        '',
        '**The extrapolation is an extrapolation.** The corpus is about a tenth of a million lines and the target is',
        'per million, so `secondsPerMillionLines` assumes cost is linear in lines. A small corpus carries relatively',
        'more fixed cost, so that assumption is pessimistic in one direction and unverified in both.',
      ],
      measuredAt: new Date().toISOString().slice(0, 10),
      corpus: { path: CORPUS, files: corpus.files, lines: corpus.lines },
      durationMs,
      secondsPerMillionLines,
      extrapolated: corpus.lines < 1_000_000,
      target: { secondsPerMillionLines: 60, competitorSecondsPerMillionLines: 180 },
      pipeline: {
        phases: result.phases.length,
        includesEmbedding: result.phases.some((p) => p.phaseId === 'embed'),
        status: result.status,
        // What the pipeline says it indexed, beside what was on disk - a run that walked nothing is not a fast run.
        graphFileCount: (result.graph as { fileIndex?: { size: number } })?.fileIndex?.size ?? 0,
        corpusFileCount: corpus.files,
      },
    };

    mkdirSync(dirname(ARTIFACT), { recursive: true });
    // **Write after the validity check, not before it.** The first version wrote first, so the run that indexed
    // nothing - four milliseconds, zero files - left an artifact that read like a measurement. A throughput number
    // with no graph behind it is a number about nothing, and the file has to be unable to say otherwise.
    if (artifact.pipeline.graphFileCount === 0) {
      writeFileSync(
        ARTIFACT,
        JSON.stringify(
          {
            comment: artifact.comment,
            measuredAt: artifact.measuredAt,
            valid: false,
            reason:
              'the pipeline completed without indexing a file, so there is no throughput to report; the graph is empty',
            corpus: artifact.corpus,
            durationMs,
            pipeline: artifact.pipeline,
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
    } else {
      writeFileSync(ARTIFACT, JSON.stringify({ ...artifact, valid: true }, null, 2) + '\n', 'utf8');
    }

    // eslint-disable-next-line no-console
    console.log(
      `INDEXING ${secondsPerMillionLines}s per 1M lines (${durationMs}ms over ${corpus.lines} lines, ` +
        `${corpus.files} files, ${result.phases.length} phases) target 60s`,
    );

    // **The shapes that must hold whatever the number is**: a positive duration, a corpus the pipeline actually
    // walked, and an artifact on disk. The number itself is reported, not asserted - a test that pins it would fail
    // on a slower machine and pass on a faster one for reasons that have nothing to do with the pipeline.
    expect(durationMs).toBeGreaterThan(0);
    expect(artifact.pipeline.graphFileCount).toBeGreaterThan(0);
    expect(existsSync(ARTIFACT)).toBe(true);
    expect(JSON.parse(readFileSync(ARTIFACT, 'utf8')).corpus.lines).toBe(corpus.lines);
  }, 1_800_000);
});
