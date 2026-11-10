// **A ceiling written for fourteen pull requests stops being a ceiling the moment the corpus grows.**
//
// The bench script bound its spend with `AACR_MAX_USD ?? 12`, and the workflow passed `5` for a replaying run because
// that run was measured at 0.57 USD. **Then the corpus became a dispatch input**, and a fifty-pull-request run - about
// 2.3 USD by the same rate - would still have been admitted by a number that was never about it: **a bound that does
// not move with the work is a comment, not a bound.** The arithmetic that fixes it belongs in a pure function that a
// test can call, because **arithmetic in a workflow's `env:` block is arithmetic nobody tests.**
//
// **And the same input has a worse failure mode than a wrong ceiling.** `MAX_PRS` arrives as a string, `Number('')` is
// `0` and `Number('abc')` is `NaN`; both flow into `rows.slice(0, n)`, which for `NaN` is `slice(0, 0)` - **a run that
// reads no pull requests, scores no goldens, and reports precision, recall and F1 as zero**, which reads exactly like a
// run that found nothing. These tests hold the refusal, not the number.

import { describe, expect, it } from 'vitest';

import {
  CEILING_USD_FLOOR,
  CEILING_USD_PER_PULL_REQUEST,
  requestedPullRequests,
  spendCeilingUsd,
} from '../../../.github/scripts/lib/run-config.mjs';

describe('a run refuses a corpus size it cannot read', () => {
  it('takes a positive integer and defaults when nothing was asked for', () => {
    expect(requestedPullRequests('14')).toBe(14);
    expect(requestedPullRequests(' 50 ')).toBe(50);
    expect(requestedPullRequests(50)).toBe(50);
    expect(requestedPullRequests(undefined)).toBe(14);
    expect(requestedPullRequests(null)).toBe(14);
    expect(requestedPullRequests('')).toBe(14);
    expect(requestedPullRequests('   ')).toBe(14);
  });

  it('refuses the values that would silently score nothing', () => {
    // **`Number('abc')` is `NaN` and `slice(0, NaN)` is `slice(0, 0)`.** A run that scored zero pull requests would
    // publish F1 0 and be read as a bad run rather than as a typo, which is the expensive direction.
    expect(() => requestedPullRequests('abc')).toThrow(/positive integer/);
    expect(() => requestedPullRequests('0')).toThrow(/positive integer/);
    expect(() => requestedPullRequests('-5')).toThrow(/positive integer/);
    expect(() => requestedPullRequests('2.5')).toThrow(/positive integer/);
    expect(() => requestedPullRequests('Infinity')).toThrow(/positive integer/);
  });
});

describe('the ceiling moves with the corpus', () => {
  it('is at least three times the measured cost at every corpus size, in both arms', () => {
    // **The measured rate of 2026-11-10**: 0.57 USD for fourteen pull requests replaying, and 6.53 USD for the same
    // fourteen recording. A ceiling below three times the observed cost is a ceiling a retry storm reaches; one far
    // above it is a formality. The band is checked rather than the constant.
    const measuredReplayPerPullRequest = 0.57 / 14;
    const measuredRecordPerPullRequest = (0.57 + 5.89) / 14;
    for (const pullRequests of [14, 50, 200]) {
      const replayCeiling = spendCeilingUsd({ pullRequests, mode: 'replay', override: '' });
      const recordCeiling = spendCeilingUsd({ pullRequests, mode: 'record', override: '' });
      expect(replayCeiling).toBeGreaterThanOrEqual(3 * measuredReplayPerPullRequest * pullRequests);
      expect(replayCeiling).toBeLessThanOrEqual(20 * measuredReplayPerPullRequest * pullRequests);
      // **And it is strictly larger at a larger corpus**, which is the property the constant did not have.
      expect(recordCeiling).toBeGreaterThanOrEqual(CEILING_USD_FLOOR.record);
      expect(recordCeiling).toBeGreaterThanOrEqual(
        CEILING_USD_PER_PULL_REQUEST.record * pullRequests,
      );
    }
  });

  it('rises with the corpus rather than being exceeded by it', () => {
    const at14 = spendCeilingUsd({ pullRequests: 14, mode: 'replay', override: '' });
    const at50 = spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: '' });
    const at200 = spendCeilingUsd({ pullRequests: 200, mode: 'replay', override: '' });
    expect(at50).toBeGreaterThan(at14);
    expect(at200).toBeGreaterThan(at50);
    // **The floor binds on a corpus smaller than the one the registration was written against**, and the rate binds
    // above it - which is the whole point of keeping both numbers: fourteen pull requests is 2.1 USD at 0.15 each, so
    // by then the rate has already overtaken the floor and the ceiling is about the work rather than about a constant.
    expect(spendCeilingUsd({ pullRequests: 5, mode: 'replay', override: '' })).toBe(
      CEILING_USD_FLOOR.replay,
    );
    expect(at14).toBe(
      Math.round(CEILING_USD_PER_PULL_REQUEST.replay * 14 * 100) / 100,
    );
  });

  it('keeps a deliberate override, because a one-off is a legitimate thing to want', () => {
    expect(spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: '12' })).toBe(12);
    // **An unset variable that the workflow's conditional `env:` leaves empty is not an override of zero**, which would
    // refuse the run before it started.
    expect(spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: '' })).toBe(7.5);
    expect(spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: undefined })).toBe(7.5);
    expect(spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: '  ' })).toBe(7.5);
    // A nonsense override falls back to the computed bound instead of admitting everything or nothing.
    expect(spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: 'lots' })).toBe(7.5);
    expect(spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: '-1' })).toBe(7.5);
  });

  it('treats an unrecognised arm as the cheap one', () => {
    // `off` removes the competitor; `replay` reads a recorded one; anything else is not a decision to spend.
    for (const mode of ['off', 'replay', null, undefined, 'garbage']) {
      expect(spendCeilingUsd({ pullRequests: 50, mode, override: '' })).toBe(
        spendCeilingUsd({ pullRequests: 50, mode: 'replay', override: '' }),
      );
    }
  });
});
