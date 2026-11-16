import { describe, expect, it } from 'vitest';

import {
  CORPUS_SAMPLING,
  MINIMUM_REGISTERED_GAIN,
  REGISTRATIONS,
  REPRODUCTION,
  registrationResolvable,
  resolutionFor,
} from '../../../.github/scripts/aacr-ablation-compare.mjs';

/**
 * **The instrument's error bar was a number from five pull requests, and a two-run repeat over ninety-eight contradicts
 * it by eleven times.**
 *
 * `resolutionFor()` carried `0.04 measured at 170 goldens`, taken from three runs over the *same five pull requests*. The
 * run of 2026-11-16 produced the measurement that function never had: two dispatches of **one configuration** - lanes
 * only, every switch off, the same slice, the same judge, the same corpus — read the same 98 pull requests and, per
 * pull request, the same goldens (0 of 98 differ), and returned 143 and 139 true positives, F1 0.2072 and 0.2055.
 *
 * **So the reviewer's own sampling moves F1 by 0.0017 at this corpus, and the formula said 0.0195.** The old anchor
 * priced three runs whose code was not recorded as identical over five pull requests, where one true positive is four
 * percent of the figure; the new one prices the same reviewer twice with everything else held.
 *
 * **The cost of the over-estimate is a verdict that cannot be reached.** A registration is confirmed only when its gain
 * exceeds the resolution, so at 715 goldens every bar under 0.0195 was unfalsifiable by construction - and R-32's 0.01
 * was dispatched against exactly that. **A bar below the error bar is not a strict bar, it is a bar that cannot be
 * cleared**, and it is the one shape of registration that no amount of evidence repairs.
 */
describe('a bar below the instrument error bar is not a strict bar', () => {
  it('measures reproduction from two runs of one configuration, not from a memory', () => {
    expect(REPRODUCTION.goldens).toBe(715);
    expect(REPRODUCTION.pullRequests).toBe(98);
    expect(REPRODUCTION.truePositives).toEqual([143, 139]);
    // **The figure that replaced the anchor.** It is the observed difference rather than a standard error, because two
    // runs estimate a spread and do not measure one - and the larger of the two readings is the conservative one.
    expect(REPRODUCTION.f1Delta).toBeCloseTo(0.0017, 4);
    // **And the corpus is not what moved**: per pull request the goldens are identical in all 98, so the whole
    // difference is the reviewer.
    expect(REPRODUCTION.pullRequestsWithDifferentGoldens).toBe(0);
    expect(REPRODUCTION.pullRequestsWithDifferentCoverage).toBe(47);
  });

  it('resolves what the repeat saw, at the corpus the repeat ran on', () => {
    // **This file's original assertion was `toBe(0.0017)`, and §64 replaced it.** The repeat is a real measurement of
    // the reviewer with the corpus held fixed; a registration is a claim about a corpus, and a corpus the same size moved
    // the paired difference by 0.0191 when its 98 rows were resampled. The repeat is still reachable - by asking for it.
    expect(resolutionFor(715, { measuredAt: 715, measuredResolution: REPRODUCTION.f1Delta })).toBe(
      0.0017,
    );
    expect(resolutionFor(715)).toBe(CORPUS_SAMPLING.deltaSd);
    // **The law is unchanged**, because a standard error that does not fall with the sample would be a claim that the
    // instrument never improves - which the paired tests have already contradicted.
    expect(resolutionFor(4 * 715)).toBeCloseTo(CORPUS_SAMPLING.deltaSd / 2, 3);
    expect(resolutionFor(715 / 4)).toBeCloseTo(CORPUS_SAMPLING.deltaSd * 2, 3);
    // **And the corpus the old anchor was carried for resolves far more coarsely than either bar**: 100 goldens resolve
    // about 0.05, so a 0.005 registration on them was never answerable.
    expect(resolutionFor(100)).toBeGreaterThan(0.04);
  });

  it('says which of the two anchors a resolution came from', () => {
    // **A caller that wants the old number can still have it, and gets it labelled.** The point of the change is not
    // that 0.04 was wrong about the world; it is that 0.04 was never about this corpus.
    expect(resolutionFor(170, { measuredAt: 170, measuredResolution: 0.04 })).toBe(0.04);
    expect(resolutionFor(170)).toBeLessThan(0.04);
    // **And the three anchors this document has carried are three different numbers**, which is the reason each one is
    // named: 0.04 at 170 goldens from three runs over five pull requests, 0.0017 from one configuration twice, 0.0191
    // from resampling the corpus. Only the last one prices the thing a registration claims.
    expect(CORPUS_SAMPLING.deltaSd).toBeGreaterThan(REPRODUCTION.f1Delta);
  });

  it('refuses a registration whose bar sits under the resolution it will be judged against', () => {
    const below = registrationResolvable({ registeredGain: 0.001, section: 'R-x' }, 715);
    expect(below.resolvable).toBe(false);
    expect(below.reason).toContain('0.001');
    expect(below.reason).toContain('unfalsifiable');

    // **R-32's own bar is now one of the refused ones**, and the assertion that used to call it answerable is what §64
    // overturned: 0.01 is inside the 0.0191 a second corpus of these rows moves the difference by.
    const secondConcern = registrationResolvable({ registeredGain: 0.01, section: 'R-32' }, 715);
    expect(secondConcern.resolvable).toBe(false);
    expect(secondConcern.resolution).toBe(CORPUS_SAMPLING.deltaSd);

    const above = registrationResolvable({ registeredGain: 0.02, section: 'R-31' }, 715);
    expect(above.resolvable).toBe(true);

    // **An unregistered comparison has no bar to be under**, so the guard has nothing to say.
    expect(registrationResolvable(null, 715).resolvable).toBe(true);
    // **And a bar exactly at the resolution is resolvable**: the registration asks for the smallest thing the instrument
    // can see, which is a weak claim but a claim.
    expect(
      registrationResolvable({ registeredGain: CORPUS_SAMPLING.deltaSd }, 715).resolvable,
    ).toBe(true);
  });

  it('holds every registration on file above the instrument it is judged by, or marked', () => {
    // **The corpus every registration is confirmed on is the hundred-pull-request slice**, 715 goldens on the repeat.
    // **One entry is exempt and says so in its own record**: R-32 was dispatched against §60's 0.0017, before the corpus
    // bar existed, and rewriting its bar after the fact would be the one thing worse than registering it too low. Its
    // outcome may only be read as a point estimate, which is what `registeredBelowResolution` buys it - not a pass.
    for (const [key, registration] of Object.entries(REGISTRATIONS)) {
      if (typeof registration.registeredGain !== 'number') continue;
      const verdict = registrationResolvable(registration, 715);
      if (registration.registeredBelowResolution === true) {
        expect(verdict.resolvable, key).toBe(false);
        expect(registration.registeredGain, key).toBeLessThan(CORPUS_SAMPLING.deltaSd);
        continue;
      }
      expect(verdict.resolvable, `${key}: ${String(verdict.reason)}`).toBe(true);
      expect(registration.registeredGain, key).toBeGreaterThanOrEqual(MINIMUM_REGISTERED_GAIN);
    }
  });
});
