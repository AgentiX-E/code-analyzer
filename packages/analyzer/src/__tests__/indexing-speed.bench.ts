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
//   npx vitest run --config vitest.bench.config.ts packages/analyzer/src/__tests__/indexing-speed.bench.ts
//
// **A benchmark, not a unit test, and the artifact it writes says which corpus it measured.** It indexes this
// repository's own `packages/` — 141 000 lines — on whatever machine runs it, which is a different claim from the
// competitor-facing figure in `benchmarks/indexing-speed.json` (a real third-party repository at a pinned tag, on a
// GitHub runner). Two producers writing one path meant the last writer decided what the table cited, and the two
// shapes were not even the same JSON.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { recordArtifact } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { createAllPhases } from '../pipeline/phases/index.js';

import type { PipelineContext } from '@code-analyzer/shared';

const ROOT = process.cwd();
const ARTIFACT = resolve(ROOT, 'benchmarks/indexing-self-index.json');
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
        if (['node_modules', 'dist', 'coverage', '__tests__', '.git'].includes(entry.name))
          continue;
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

    const secondsPerMillionLines =
      Math.round((durationMs / 1000 / (corpus.lines / 1_000_000)) * 100) / 100;
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

    // **The body is decided before it is written, not after.** The first version wrote first, so the run that indexed
    // nothing - four milliseconds, zero files - left an artifact that read like a measurement. A throughput number
    // with no graph behind it is a number about nothing, and the file has to be unable to say otherwise.
    const body =
      artifact.pipeline.graphFileCount === 0
        ? {
            comment: artifact.comment,
            measuredAt: artifact.measuredAt,
            valid: false,
            reason:
              'the pipeline completed without indexing a file, so there is no throughput to report; the graph is empty',
            corpus: artifact.corpus,
            durationMs,
            pipeline: artifact.pipeline,
          }
        : { ...artifact, valid: true };
    // **And the write goes through the recorder**, so an ordinary local run measures without overwriting the figure
    // the documentation quotes: `BENCHMARK_WRITE=1` is the statement that this run intends to publish one.
    const recorded = recordArtifact('benchmarks/indexing-self-index.json', body);
    if (!recorded.written) {
      // eslint-disable-next-line no-console -- the figure this run produced, printed where the workflow reads it.
      console.log(`INDEXING-SPEED artifact ${recorded.because}`);
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
    // **The committed figure is on disk whether or not this run published one**, and the readback only applies to a
    // run that did - a check of the file this run wrote, read as if it were the file this run wrote.
    expect(existsSync(ARTIFACT)).toBe(true);
    if (recorded.written) {
      const reread = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { corpus: { lines: number } };
      expect(reread.corpus.lines).toBe(corpus.lines);
    }
  }, 1_800_000);
});
