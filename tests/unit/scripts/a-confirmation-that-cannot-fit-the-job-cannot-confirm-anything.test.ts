// @code-analyzer — A registered confirmation is a promise to spend money, and a promise the runner cannot keep is not a
// registration
//
// **Why this file exists.** R-17 was registered with a confirmation described as "a run of the 100 pull requests the
// discovery did not see", and **whether a hundred fits inside the 340-minute job ceiling is arithmetic performed on a
// rate, and the rate had been borrowed from a run that did not resemble the one it would be applied to.**
//
// The history is the point. §15.6 measured 46 minutes for fourteen pull requests - **468 model calls per pull request** -
// and every ceiling figure derived from it said a hundred pull requests were impossible: 103 fit, and a hundred needs 329
// of 340 minutes. **The fifty-pull-request run of 2026-11-10 cost 301 calls per pull request and its arms took 61.0 and
// 79.7 minutes**, so a hundred is 159 minutes and the whole 200-row corpus is 319. **A conclusion about what the
// infrastructure cannot do was, in fact, a conclusion about a configuration that had been replaced.**
//
// **So the rate is a constant with a run id beside it**, `MEASURED_MINUTES_PER_PULL_REQUEST` in
// `.github/scripts/aacr-ablation-compare.mjs`, the registered slice list is data rather than prose, and the assertions
// below read the ceiling out of the workflow file. **What they cannot check is that the rate is the right one for the
// next run** - only a run measures that, and this file's job is to make sure the number written down is the number the
// current measurement supports rather than the one that was true two configurations ago.
//
// **And the same lesson was learned twice: the guard was a fraction of the ceiling, which is a proxy for the property
// the guard exists to hold.** "Half of 340 minutes" is 106 rows, and 106 was chosen in the era when the rate was
// believed to be 3.29 minutes per pull request and a hundred rows really did cost 329 of 340. At 1.594 that fraction
// refuses **every slice that carries a bar only 146 rows can sign** (R-35's, at 0.026) while still admitting a
// hundred - so the fraction was measuring the era it was written in. **What a confirmation actually needs is to finish
// on an ordinary slow day**, and the width of an ordinary slow day is now measured rather than assumed: one run
// dispatched the same 46 pull requests twice and its arms took 56.8 and 64.5 minutes, **1.135×**, and
// `MEASURED_MINUTES_PER_PULL_REQUEST` is already the slower arm (79.7 of 61.0 and 79.7) of the run it came from. So the
// guard is `minutes × 1.15 ≤ ceiling`, which admits 185 rows and refuses 186 - **inside the full 196-row corpus, which
// is the thing it has to refuse.**

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_OVERRUN_TOLERANCE,
  MEASURED_MINUTES_PER_PULL_REQUEST,
  REGISTRATIONS,
  slicesAConfirmationCanFit,
  slicesThatFit,
} from '../../../.github/scripts/aacr-ablation-compare.mjs';

const WORKFLOW = readFileSync(
  resolve(import.meta.dirname, '../../../.github/workflows/aacr-bench.yml'),
  'utf8',
);

function jobCeilingMinutes(): number {
  const match = /timeout-minutes:\s*(\d+)/.exec(WORKFLOW);
  expect(match, 'the benchmark job must declare a timeout').not.toBeNull();
  return Number(match?.[1]);
}

function wallClock(max: number): number {
  return max * MEASURED_MINUTES_PER_PULL_REQUEST;
}

describe('a confirmation slice is a promise the runner can keep', () => {
  it('gives R-17 the hundred unseen pull requests it registered, starting where the discovery ended', () => {
    const slices = REGISTRATIONS.emissionProfile.confirmation;

    // **The registration named a hundred, so the slices have to add up to a hundred.** A plan that quietly confirmed on
    // fifty would be a registration answered by half an answer.
    expect(slices.reduce((total, slice) => total + slice.max, 0)).toBe(100);

    // **And none of them may read a row the discovery already read.** The discovery was rows 0-49, so a slice starts at
    // 50 or later, and no two slices may overlap.
    const read = new Set<number>();
    for (const slice of slices) {
      expect(slice.skip).toBeGreaterThanOrEqual(50);
      for (let row = slice.skip; row < slice.skip + slice.max; row += 1) {
        expect(read.has(row), `row ${String(row)} is read twice`).toBe(false);
        read.add(row);
      }
    }
    expect(read.size).toBe(100);
  });

  it('keeps every confirmation inside the job even on a fifteen-percent-slow day', () => {
    const ceiling = jobCeilingMinutes();

    for (const slice of REGISTRATIONS.emissionProfile.confirmation) {
      const minutes = wallClock(slice.max);
      // **The mechanism, so a failure says which slice and by how much rather than "false was not true".**
      expect(
        minutes * CONFIRMATION_OVERRUN_TOLERANCE,
        `a slice of ${String(slice.max)} needs ${minutes.toFixed(1)} minutes of ${String(ceiling)}, ` +
          `${(minutes * CONFIRMATION_OVERRUN_TOLERANCE).toFixed(1)} with the tolerance`,
      ).toBeLessThanOrEqual(ceiling);
    }

    // **And the bound is asserted at the exact row where it turns over rather than described.** 185 rows survive the
    // tolerance and 186 do not, so the rule that admits R-35's 146 still refuses the whole 196-row corpus in one
    // dispatch - **a guard that admits everything is not a guard, and a guard whose edge is not tested is a comment.**
    const rows = slicesAConfirmationCanFit(ceiling);
    expect(rows).toBe(185);
    expect(wallClock(rows) * CONFIRMATION_OVERRUN_TOLERANCE).toBeLessThanOrEqual(ceiling);
    expect(wallClock(rows + 1) * CONFIRMATION_OVERRUN_TOLERANCE).toBeGreaterThan(ceiling);
    expect(rows).toBeLessThan(196);
  });

  it('derives the ceiling claim from the fifty-pull-request run rather than from the fourteen', () => {
    const ceiling = jobCeilingMinutes();

    // `slicesThatFit` is the arithmetic the workflow's own comment states, and the two must agree.
    const fits = slicesThatFit(ceiling);
    expect(fits).toBe(213);
    expect(WORKFLOW).toContain(`**${String(fits)}** pull requests at the`);

    // **The rate that used to be in this constant, kept as a negative assertion.** 46 minutes over 14 pull requests
    // gives 103, and 103 is what this project believed until it checked the run the rate belonged to: **a rate per pull
    // request is a property of the configuration, and the configuration had changed underneath it.**
    const retired = 46 / 14;
    expect(Math.floor(ceiling / retired)).toBe(103);
    expect(WORKFLOW).not.toContain('340 minutes is 190 pull requests');
  });

  it('records no confirmation for a device that has already been falsified', () => {
    // **An empty list, not a missing one.** The checklist was falsified at −0.0292 with p = 0.0049 on its own
    // confirmation, so a slice list there would be a plan to spend a hundred pull requests re-reading a read verdict.
    expect(REGISTRATIONS.languageChecklist.confirmation).toEqual([]);
  });
});
