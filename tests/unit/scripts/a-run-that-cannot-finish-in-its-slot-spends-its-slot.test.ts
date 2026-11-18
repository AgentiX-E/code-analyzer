// A run that cannot finish in its slot spends its slot and buys nothing
//
// **The defect this exists for, in the account's own numbers.** Run 44100493243 was dispatched for a 146-pull-request
// pair and was still inside `Review the corpus with our engine` after 128 minutes when it was cancelled by hand. It had
// been given a slot of **340 minutes** - a constant, written when the corpus was smaller - so nothing in the job would
// ever have stopped it, and the only reason it stopped was that a person read the clock and paid attention.
//
// **A slot that is a round number is not a bound on the work; it is a bound on the accident.** 340 was 1.79 times the
// 190 minutes the pair finally took, which is enough room for a job that is stuck, rate-limited, or retrying into a
// provider answering 429 - exactly the job that should be killed first.
//
// **The fix is a derived number, and the first version of it was refused by the platform.** `timeout-minutes:
// ${{ fromJSON(github.event.inputs.max_pull_requests || '146') * 2 }}` was the right shape and a dispatch answered
// `Unexpected symbol: '*' ... Located at position 58 within expression`: the field takes contexts, not arithmetic. **So
// the slot is fixed at the corpus this job is dispatched with and the scaling lives where a test can call it** -
// `slicesThatFit` in `aacr-ablation-compare.mjs` refuses a dispatch the slot cannot cover.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
  'utf8',
);

/**
 * **The minutes one pull request takes, as measured on the pair that finally ran**: 190 minutes for 146 pull requests
 * over two arms, 1.30 each. The harness comment's 1.22 to 1.59 is the same figure from earlier runs, and a slot has to
 * cover the slow end.
 */
const OBSERVED_MINUTES_PER_PULL_REQUEST = 1.3;

/** The corpus the slot is sized for: the largest this job is dispatched with. */
const MODELLED_PULL_REQUESTS = 146;

/** Every `timeout-minutes:` line in the workflow, with the job it belongs to. */
function timeouts(): { job: string; value: string }[] {
  const found: { job: string; value: string }[] = [];
  let job = '';
  for (const line of WORKFLOW.split('\n')) {
    const jobMatch = /^ {2}([a-z][a-z-]*):$/.exec(line);
    if (jobMatch) job = jobMatch[1]!;
    const timeout = /^\s+timeout-minutes:\s*(.+)$/.exec(line);
    if (timeout) found.push({ job, value: timeout[1]!.trim() });
  }
  return found;
}

describe('the slot a bench job is given is about the corpus it was asked for', () => {
  it('is about the work rather than a round number', () => {
    // **The defect was 340 for a pair that needs 190.** The slot cannot scale on this platform, so the only thing left
    // to check is that the fixed number is derived from the measurement instead of from a preference.
    const bench = timeouts().filter((entry) => entry.job === 'aacr-bench');
    expect(bench.length).toBeGreaterThan(0);
    const needed = MODELLED_PULL_REQUESTS * OBSERVED_MINUTES_PER_PULL_REQUEST;
    for (const entry of bench) {
      const minutes = Number(entry.value);
      expect(Number.isInteger(minutes), `${entry.job} slot ${entry.value} is not a number`).toBe(
        true,
      );
      // **At least the work it covers**, because a slot below it kills valid runs.
      expect(minutes).toBeGreaterThanOrEqual(needed);
      // **And no more than 1.8 times it**, because 340 was 1.79 times 190 and that was the defect.
      expect(minutes).toBeLessThanOrEqual(1.8 * needed);
    }
  });

  it('records why it is not an expression, so the next attempt does not reopen it', () => {
    // **The attempt is in the file**, because the shape is right and the platform is what refused it: a future edit that
    // reintroduces `${{ }}` here would fail the dispatch rather than the job, which is a failure nobody reads.
    expect(WORKFLOW).toContain('Unexpected symbol');
    expect(WORKFLOW).toContain('slicesThatFit');
  });

  it('leaves the corpus-size refusal to a function rather than to the runner', () => {
    // **A slot that cannot scale has to have its limit written somewhere a test can call it**, and that is
    // `slicesThatFit`: at 1.594 minutes per pull request with the confirmation tolerance, 280 minutes covers 175 rows -
    // above the 146 this job is dispatched with and below the whole 196-row corpus. **A dispatch that would exceed the
    // slot fails on a returned number, not on a kill.**
    const bench = timeouts().filter((entry) => entry.job === 'aacr-bench');
    const smallest = Math.min(...bench.map((entry) => Number(entry.value)));
    const fits = Math.floor(smallest / (1.594 * 1.15));
    expect(fits).toBeGreaterThanOrEqual(146);
    expect(fits).toBeLessThan(196);
  });
});
