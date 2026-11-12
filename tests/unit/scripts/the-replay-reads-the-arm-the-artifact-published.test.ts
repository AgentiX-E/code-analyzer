// The replay reads the arm the artifact published, instead of guessing it
//
// **A hundred-pull-request run failed on nothing.** Its measurement finished, its artifact was correct and complete -
// 100 pull requests, 724 goldens, published F1 0.1947 - and the job that checks whether a figure is derivable from its
// own rows replayed it against the actionability gate's 0.072 and reported a disagreement. The reading reviewer publishes
// what its own filing rule kept; `compareReplayToArtifact` answered `gate` for every run that was not the `defect`
// profile, so the checker held a different arm from the one the figure came from.
//
// **The artifact was already recording it.** `emissionRules.shipped` and `emissionRules.laneGate` were both in the file
// beside the published figures. An artifact that records two arms and a checker that reads a third is the defect.
//
// What is asserted here is the reading, not the number: the arm name for each shape of artifact, and the fact that a
// recorded name wins over any derivation - because the derivation is what was wrong.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compareReplayToArtifact } from '../../../scripts/lib/paired-replay.mjs';
import type { PairedReplay } from '../../../scripts/lib/paired-replay.mjs';

type Point = { precision: number; recall: number; f1: number };

/**
 * **A replay result whose arms carry the real triples**, one value per arm, so which arm a comparison used is visible in
 * its own answer. A single number per arm would not do: precision, recall and F1 are three different numbers on the same
 * arm, and a fixture that collapsed them could pass while the comparison read the wrong field.
 */
function replayWith(values: Record<string, Point>): PairedReplay {
  // **The assertion is the fixture's whole point, and it is narrow**: `compareReplayToArtifact` reads `whole[arm]` and
  // nothing else, so the counts, the paired block and the discordances are not inputs to the question under test.
  // Building a complete `PairedReplay` here would add twelve fields no assertion looks at and would still prove nothing
  // about the arm.
  return { whole: values } as unknown as PairedReplay;
}

/** The arms of the run that failed, at their measured values. */
const FAILED = { everything: { precision: 0.187, recall: 0.203, f1: 0.1947 } };
const FAILED_GATE = { gate: { precision: 0.2752, recall: 0.0414, f1: 0.072 } };

describe('the arm a published figure is checked against', () => {
  it('is `everything` for the reading reviewer, which is what its 0.1947 was', () => {
    // **The shape that failed.** `configuration.agent` was true and no arm name had been recorded, which is every
    // artifact written between the reading arm shipping and this fix.
    const bench = {
      precision: 0.187,
      recall: 0.203,
      f1: 0.1947,
      configuration: { agent: true, emissionProfile: 'advisory' },
    };
    const verdict = compareReplayToArtifact(replayWith({ ...FAILED, ...FAILED_GATE }), bench);
    expect(verdict.arm).toBe('everything');
    expect(verdict.ok).toBe(true);
    expect(verdict.mismatches).toEqual([]);
  });

  it('is `everything-filtered` for the reading reviewer under a category profile', () => {
    // The reading arm files what it can locate; the profile floor is the only thing on top of that. **It does not
    // require actionability**, which is exactly what separates it from `profile`.
    const bench = {
      precision: 0.19,
      recall: 0.21,
      f1: 0.2,
      configuration: { agent: true, emissionProfile: 'defect' },
    };
    const verdict = compareReplayToArtifact(
      replayWith({
        'everything-filtered': { precision: 0.19, recall: 0.21, f1: 0.2 },
        ...FAILED_GATE,
      }),
      bench,
    );
    expect(verdict.arm).toBe('everything-filtered');
    expect(verdict.ok).toBe(true);
  });

  it('is `gate` for the five lanes, which is what a lane figure always was', () => {
    const bench = {
      precision: 0.2752,
      recall: 0.0414,
      f1: 0.072,
      configuration: { agent: false, emissionProfile: 'advisory' },
    };
    const verdict = compareReplayToArtifact(replayWith({ ...FAILED, ...FAILED_GATE }), bench);
    expect(verdict.arm).toBe('gate');
    expect(verdict.ok).toBe(true);
  });

  it('is `profile` for the five lanes under the category profile', () => {
    const bench = {
      precision: 0.3,
      recall: 0.1,
      f1: 0.15,
      configuration: { agent: false, emissionProfile: 'defect' },
    };
    const verdict = compareReplayToArtifact(
      replayWith({ ...FAILED_GATE, profile: { precision: 0.3, recall: 0.1, f1: 0.15 } }),
      bench,
    );
    expect(verdict.arm).toBe('profile');
    expect(verdict.ok).toBe(true);
  });

  it('is whatever the artifact recorded, even when the shape would have implied another arm', () => {
    // **The point of recording it.** A future arm the derivation does not know about is checkable the day it is written,
    // and a name in the file cannot disagree with itself the way two copies of a rule can.
    const bench = {
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      configuration: { agent: false, emissionProfile: 'advisory' },
      scoring: { publishedArm: 'profile' },
    };
    const verdict = compareReplayToArtifact(
      replayWith({ ...FAILED_GATE, profile: { precision: 0.5, recall: 0.5, f1: 0.5 } }),
      bench,
    );
    expect(verdict.arm).toBe('profile');
    expect(verdict.ok).toBe(true);
  });

  it('still reports a genuine disagreement, so the check did not become a rubber stamp', () => {
    // **A checker that always agrees is worse than none.** This is the same shape as the failing run with the published
    // number changed, and it must still fail.
    const bench = {
      precision: 0.9,
      recall: 0.9,
      f1: 0.9,
      configuration: { agent: true, emissionProfile: 'advisory' },
      scoring: { publishedArm: 'everything' },
    };
    const verdict = compareReplayToArtifact(replayWith(FAILED), bench);
    expect(verdict.ok).toBe(false);
    expect(verdict.mismatches.map((m: { field: string }) => m.field)).toEqual([
      'precision',
      'recall',
      'f1',
    ]);
  });
});

describe('the artifact names the arm it published', () => {
  it('records `publishedArm` in the scoring block, derived from the same two switches the figure is', () => {
    // **A source-level assertion, because the value is computed inside a hundred-pull-request job.** The field has to be
    // there or the checker falls back to the derivation this file exists to retire.
    const source = readFileSync('.github/scripts/aacr-bench.mjs', 'utf8');
    expect(source).toContain('publishedArm:');
    expect(source).toContain("'everything-filtered'");
    const script = readFileSync('scripts/aacr-paired-replay.mjs', 'utf8');
    expect(script).toContain(
      "const OUR_ARMS = ['everything', 'gate', 'profile', 'everything-filtered']",
    );
  });
});
