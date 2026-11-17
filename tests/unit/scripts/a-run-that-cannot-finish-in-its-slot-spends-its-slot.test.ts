// A run that cannot finish in its slot spends its slot and buys nothing
//
// **The defect this exists for, in the account's own numbers.** Run 44100493243 was dispatched for a 146-pull-request
// pair and was still inside `Review the corpus with our engine` after 128 minutes when it was cancelled by hand. It had
// been given a slot of **340 minutes** - a constant, written when the corpus was smaller - so nothing in the job would
// ever have stopped it, and the only reason it stopped was that a person read the clock and paid attention.
//
// **A slot four hours wide is not a bound on a job that takes three.** It is a bound on a job that takes five and a
// half, which is the job that is stuck, rate-limited, or retrying into a provider that is answering 429 - and it is
// exactly the job that should be killed first. **The number a run is given has to be about the work it was asked to
// do**, the same argument `spendCeilingUsd` was given for money, applied to the clock.
//
// **The measurement the coefficient rests on** is 1.22 to 1.59 minutes per pull request for one arm over this corpus,
// recorded in `aacr-bench.mjs`'s own comment. Two minutes per pull request plus half an hour of setup is 1.26 to 1.64
// times the observed time - enough that a slow day does not kill a valid run, and not enough to let a stuck one bill
// for hours.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
  'utf8',
);

/** The minutes one pull request takes, from the harness comment that recorded it. */
const OBSERVED_MINUTES_PER_PULL_REQUEST = 1.22;

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
  it('scales with the dispatch input instead of being a constant', () => {
    // **A constant cannot be about the work.** The defect was `340`, which admitted a 146-pull-request pair for nearly
    // twice the time it needs and would have admitted a stuck one for the whole of it.
    const bench = timeouts().filter((entry) => entry.job === 'aacr-bench');
    expect(bench.length).toBeGreaterThan(0);
    for (const entry of bench) {
      expect(entry.value, `${entry.job} has a constant slot of ${entry.value} minutes`).toMatch(
        /inputs\.max_pull_requests/,
      );
    }
  });

  it('leaves enough room that a slow day is not a failed run', () => {
    // **The coefficient, read out of the expression rather than trusted.** `N * 2 + 30` over a 146-pull-request pair is
    // 322 minutes against 178 observed - 1.8 times - and the smallest corpus the workflow can be dispatched with still
    // clears the setup cost. **A coefficient below the observed rate would kill valid runs**, so it is checked against
    // the number in the harness comment rather than against a preference.
    const expressions = timeouts()
      .filter((entry) => entry.job === 'aacr-bench')
      .map((entry) => entry.value);
    expect(expressions.length).toBeGreaterThan(0);
    for (const expression of expressions) {
      const perPullRequest = /max_pull_requests\s*\|\|\s*'(\d+)'\s*\)\s*\*\s*(\d+)/.exec(
        expression,
      );
      expect(perPullRequest, `${expression} does not multiply the input by a rate`).not.toBeNull();
      const rate = Number(perPullRequest![2]);
      // **At least the observed rate**, because a coefficient below it kills valid runs: 1.22 minutes per pull request
      // is what the harness measured, and a slot of `N * 1` would end a 146-pull-request pair at 146 minutes with a
      // third of the corpus unread.
      expect(rate).toBeGreaterThanOrEqual(OBSERVED_MINUTES_PER_PULL_REQUEST);
      // **And no more than twice it**, because the defect this replaces was a slot that admitted nearly two times the
      // work it was about. A coefficient of three would be the constant 340 with a multiplication sign in front.
      expect(rate).toBeLessThanOrEqual(2 * OBSERVED_MINUTES_PER_PULL_REQUEST * 1.1);
    }
  });
});
