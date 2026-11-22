/**
 * **A batch size that reaches the judge and not the artifact is a price nobody can explain - and a batch size in the
 * artifact that the run did not use is worse.**
 *
 * The four connections held here are the four §106.7 established for the reviewer's call shape, applied to the client
 * that turned out to be the larger half of the bill:
 *
 * 1. an environment variable the workflow sets (`AACR_JUDGE_BATCH`);
 * 2. the seam that decides which judge the run buys, which is what makes a batch a device rather than a log line;
 * 3. the key in `configuration`, which is what lets a reader see that two figures were priced by two instruments;
 * 4. the refusal - a value that is not a positive integer throws before the first call, because **a run labelled `8`
 *    that bought singles is a comparison against the wrong history**.
 *
 * **`1` is the default on both sides**, and that is the same rule as `lane_mode`: every figure before §111 was measured
 * one pair at a time, so the per-pair arm is the one history is priced in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configurationBlock } from './configuration-block.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

describe('the judge batch size is wired from the dispatch to the artifact', () => {
  it('is read from the environment the workflow sets', () => {
    expect(BENCH).toContain("process.env['AACR_JUDGE_BATCH']");
    expect(WORKFLOW).toContain("AACR_JUDGE_BATCH: ${{ inputs.judge_batch || '1' }}");
  });

  it('chooses the seam the matrix buys its verdicts through', () => {
    expect(BENCH).toContain('let judgeManyFn = JUDGE_BATCH > 1 ? judgeBatchImpl : null;');
    // **And the matrix consults it before building a single pair**, so a batched arm never pays the per-pair price by
    // walking the per-pair path first.
    const matrix = BENCH.slice(BENCH.indexOf('async function judgeMatrix('));
    expect(matrix.slice(0, 200)).toContain(
      'if (batch > 1 && judgeManyFn !== null) return judgeMatrixBatched',
    );
  });

  it('falls back to the per-pair seam rather than to a second per-pair implementation', () => {
    const batched = BENCH.slice(BENCH.indexOf('async function judgeMatrixBatched('));
    expect(batched.slice(0, 2500)).toContain('await judgeFn(comment, goldens[job.golden])');
  });

  it('is recorded in the artifact, because two prices for one figure are two instruments', () => {
    expect(configurationBlock(BENCH)).toContain('judgeBatch: JUDGE_BATCH');
  });

  it('refuses a value that is not a positive integer, before a single call', () => {
    expect(BENCH).toContain('is not a positive integer');
    expect(BENCH).toMatch(/const JUDGE_BATCH = \(\(\) => \{/);
  });

  it('counts the batches it bought and the ones it had to re-buy, because those are two different prices', () => {
    // **The first batched run could not say which of the two it had done**: 2 206 requests where the arithmetic said
    // 657 was a fact without a cause. A counter for each makes the next run's answer arithmetic rather than inference.
    expect(BENCH).toContain('judgeSpend.batchCalls += 1;');
    expect(BENCH).toContain('judgeSpend.batchFallbacks += 1;');
    // **And both reach the artifact**, because the spend block spreads the counters rather than naming them.
    expect(BENCH).toContain('judge: {');
    expect(BENCH).toContain('...judgeSpend,');
  });

  it('is a dispatch input with the per-pair arm as its default', () => {
    const input = WORKFLOW.slice(WORKFLOW.indexOf('      judge_batch:'));
    expect(input.slice(0, 1600)).toContain("default: '1'");
  });
});
