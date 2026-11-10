// @code-analyzer — A registered confirmation is a promise to spend money, and a promise the runner cannot keep is not a
// registration
//
// **Why this file exists.** R-17 was registered with a confirmation described as "a run of the 100 pull requests the
// discovery did not see", and **a hundred pull requests does not fit inside the 340-minute job ceiling**: §15.6 measures
// 46 minutes of whole job for 14 pull requests, so a hundred needs 329 minutes and eleven minutes of headroom. **Eleven
// minutes of headroom is not headroom** - one slow benchmark clone ends the run at minute 340, having spent the money and
// produced no artifact, and the comparison job then reports a comparison that did not happen.
//
// **So the confirmation is two slices of fifty, and the slice list lives in the script rather than in a document**, which
// is what makes it checkable: `REGISTRATIONS.emissionProfile.confirmation` names each slice's `skip` and `max`, and the
// assertions below read the ceiling out of the workflow file. **The defect this catches is the one iteration 119 found in
// the workflow's own comment** - it claimed the ceiling fitted 190 pull requests, which needs 1.8 minutes per pull request
// that no run has ever measured, while the sentence beside it gave 3.3.
//
// **What it does not check.** That the slices are the best split, or that the corpus holds a hundred pull requests after
// row 50 - the run itself records `corpusSlice` and total rows, and an artifact that disagrees with the plan is a fact
// about the corpus rather than a test failure.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_CEILING_FRACTION,
  MEASURED_MINUTES_PER_PULL_REQUEST,
  REGISTRATIONS,
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
  it('gives R-17 the hundred pull requests it registered, as disjoint slices', () => {
    const slices = REGISTRATIONS.emissionProfile.confirmation;

    // **The registration named a hundred, so the slices have to add up to a hundred.** A split that quietly confirmed on
    // fifty would be a registration answered by half an answer.
    expect(slices.reduce((total, slice) => total + slice.max, 0)).toBe(100);

    // **And none of them may read a row the discovery already read.** The discovery was rows 0-49, so every slice starts
    // at 50 or later, and the slices must not overlap each other either.
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

  it('keeps every slice inside half the job ceiling, with the numbers stated', () => {
    const ceiling = jobCeilingMinutes();

    for (const slice of REGISTRATIONS.emissionProfile.confirmation) {
      const minutes = wallClock(slice.max);
      // **The mechanism, so a failure says which slice and by how much rather than "false was not true".**
      expect(
        minutes,
        `a slice of ${String(slice.max)} needs ${minutes.toFixed(1)} of ${String(ceiling)} minutes`,
      ).toBeLessThanOrEqual(ceiling * CONFIRMATION_CEILING_FRACTION);
    }

    // **And the rejected alternative is asserted rather than described**, because the next person to have this idea will
    // have it in good faith: one slice of a hundred is 329 minutes of a 340-minute job.
    expect(wallClock(100)).toBeGreaterThan(ceiling * CONFIRMATION_CEILING_FRACTION);
  });

  it('derives the ceiling claim from the measured rate instead of remembering it', () => {
    const ceiling = jobCeilingMinutes();

    // `slicesThatFit` is the arithmetic the workflow's own comment states, and the two must agree.
    const fits = slicesThatFit(ceiling);
    expect(fits).toBe(103);
    expect(WORKFLOW).toContain(`**${String(fits)}** pull requests at the measured`);

    // **The number this replaced, kept as a negative assertion.** 190 pull requests inside the same ceiling would need
    // 1.8 minutes per pull request, and the same paragraph measures 3.3 - so the old figure was memory wearing the
    // clothes of arithmetic, which is the failure mode this whole file is about.
    expect(190 * MEASURED_MINUTES_PER_PULL_REQUEST).toBeGreaterThan(ceiling);
    expect(WORKFLOW).not.toContain('340 minutes is 190 pull requests');
  });

  it('records no confirmation for a device that has already been falsified', () => {
    // **An empty list, not a missing one.** The checklist was falsified at −0.0292 with p = 0.0049 on its own
    // confirmation, so a slice list there would be a plan to spend a hundred pull requests re-reading a read verdict.
    expect(REGISTRATIONS.languageChecklist.confirmation).toEqual([]);
  });
});
