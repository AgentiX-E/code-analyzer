import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **A run that did not finish must not publish a number, and the number it published on R-30 was three weeks old.**
 *
 * `benchmarks/aacr-bench.json` is a tracked file: it is the figure this repository publishes, so it exists in every
 * checkout. The upload step was `always()` - deliberately, because a *skipped* run (no corpus, no credential) still has
 * a marker to publish and exits zero. **The consequence was not intended**: a run that died during the review step also
 * uploaded whatever was at that path, and on R-30 that was the figure from 2026-11-10 - `F1 0.2026`, produced by a
 * different device - published as
 * `aacr-bench-advisory-off-off-off-on-on-off`, which is the merge arm's name.
 *
 * **Nothing downstream could tell.** The name matched the matrix, the schema matched the reader, the numbers added up,
 * and the run's own status was `cancelled` only in the API - not in the artifact. The two guards below are the two
 * halves of the repair, and each is asserted here because **neither can be observed from a figure**: a stale artifact and
 * a fresh one are the same file.
 */
const BENCH = readFileSync(resolve(__dirname, '../../../.github/scripts/aacr-bench.mjs'), 'utf8');
const WORKFLOW = readFileSync(
  resolve(__dirname, '../../../.github/workflows/aacr-bench.yml'),
  'utf8',
);

describe('the figure a run publishes', () => {
  it('is cleared before the first request, because the path is a tracked file', () => {
    // **`force: true`, because absent is the normal case** - the file only exists in a checkout, and a run whose first
    // act is a crash on a missing file would fail for the wrong reason.
    expect(BENCH).toContain(
      "rmSync(resolve(process.cwd(), 'benchmarks', 'aacr-bench.json'), { force: true });",
    );
    // **And it happens after the dry run**, which is a local arithmetic check that must not delete a published figure,
    // and before the corpus is read, which is the first thing that can fail for a reason worth a rerun.
    const dryRunReturn = BENCH.indexOf('await dryRun();');
    const clear = BENCH.indexOf("rmSync(resolve(process.cwd(), 'benchmarks', 'aacr-bench.json')");
    const firstCorpusRead = BENCH.indexOf('const positive = findSamples(');
    expect(dryRunReturn).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(dryRunReturn);
    expect(firstCorpusRead).toBeGreaterThan(clear);
  });

  it('carries the run that wrote it, and the moment it finished, which only a run that finished can carry', () => {
    // The base object names the run, so every artifact - result, skip, shutout - inherits it.
    expect(BENCH).toContain("runId: process.env['GITHUB_RUN_ID'] ?? null");
    expect(BENCH).toContain("sha: process.env['GITHUB_SHA'] ?? null");
    // **`finishedAt` is stamped at the single point of writing**, so a path out of this script cannot forget it - and a
    // file that lacks it is a file this script did not finish, which is the whole test.
    expect(BENCH).toContain(
      'provenance: { ...(payload.provenance ?? {}), finishedAt: new Date().toISOString() }',
    );
  });

  it('is uploaded only by a job that succeeded', () => {
    // The step, its condition and its position, read from the workflow rather than from a comment: `always()` on the
    // figure upload is the line that published a cancelled run's predecessor.
    const upload = WORKFLOW.slice(WORKFLOW.indexOf('- name: Upload the figure'));
    const head = upload.slice(0, upload.indexOf('uses:'));
    // **`always()` is back, and the reason it left is the reason it returns.** Without it, a step whose `if` names no
    // status function is implicitly `success() && …` - so a *derived* table that failed **after** the figure was sound
    // suppressed the upload. That is not hypothetical: run 45411086146 reviewed fifty pull requests, passed both proofs,
    // scored the competitor, failed `martian_profile`, and published nothing (§154.4).
    //
    // **What keeps a cancelled run out is the two proofs, not the absence of `always()`.** Both sit on steps that can
    // only have run after the review wrote a file, so a run that died mid-review fails the condition twice over - and the
    // assertion below is on the pair, because `always()` alone would publish a stale tracked file, which is the defect
    // this case was written for.
    expect(head).toContain('always()');
    expect(head).toContain(
      "steps.replay.outcome == 'success' && steps.audit.outcome == 'success'",
    );
    expect(head).not.toMatch(/if:\s*always\(\)\s*$/m);
    for (const proof of ['replay', 'audit']) {
      const step = WORKFLOW.slice(WORKFLOW.indexOf(`id: ${proof}`));
      expect(step.slice(0, step.indexOf('- name:', 10)), `${proof} runs no command`).toContain(
        'run:',
      );
    }
  });

  it('still publishes the marker a skipped run writes, because that is what the old condition was for', () => {
    // **The repair removes the case it was not meant to cover.** A run with no corpus or no credential returns zero and
    // writes a `skipped` artifact, so `success()` keeps it; only a run that died mid-flight loses its upload.
    expect(BENCH).toContain("skipped: { reason: 'no judge credential configured' }");
    expect(BENCH).toContain(
      "skipped: { reason: 'positive_samples.json was not found; clone alibaba/aacr-bench' }",
    );
  });
});
