// **A prior that cannot be traced to a count is an opinion with a decimal point.**
//
// `category-prior.ts` decides which categories of finding reach a reviewer, and it decides it by writing down how often
// each category was accepted on a corpus that carries an expert's verdict. **The table and the artifact are two copies
// of one measurement**, and the failure mode of two copies is that one moves and the other does not: the prior keeps
// dropping `test` findings at 0.116 while the artifact it cites says 0.31, and the sentence a reader is shown is wrong
// in the direction that matters - it is confident.
//
// **So this file recomputes the table from `benchmarks/aacr-bench.json` and fails when the two disagree.** It needs no
// model, no key and no network: the verdicts were bought once and are in the artifact.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyEmissionProfile,
  CATEGORY_ACCEPTANCE,
  categoryVerdict,
  DEFECT_FLOOR,
} from '../../../packages/intelligence/src/review/category-prior.js';

import type { EmissionProfile } from '../../../packages/intelligence/src/review/category-prior.js';

/**
 * **The profiles the code implements, as a total record rather than as a list.**
 *
 * `Record<EmissionProfile, true>` is exhaustive by construction: adding a profile to the union without adding it here
 * fails to compile, which is the only way a test can be told about a value it has never seen. A `readonly
 * EmissionProfile[]` would accept a list that had simply forgotten one.
 */
const KNOWN_PROFILES: Record<EmissionProfile, true> = { defect: true, advisory: true };
import { REVIEW_CATEGORIES } from '../../../packages/shared/src/types/graph.js';

import type { ReviewCategory } from '../../../packages/shared/src/types/graph.js';

interface ArtifactFinding {
  readonly category: ReviewCategory;
  readonly matchedGoldens: readonly number[];
}

const artifact = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'benchmarks', 'aacr-bench.json'),
    'utf8',
  ),
) as {
  readonly rankedFindings: readonly ArtifactFinding[];
  readonly prsInDataset: number;
  readonly coverage: { readonly byPullRequest: readonly { readonly prs: string }[] };
};

/** `accepted / emitted` per category, counted from the verdicts the run already paid for. */
function measuredFromArtifact(): Map<ReviewCategory, { emitted: number; accepted: number }> {
  const table = new Map<ReviewCategory, { emitted: number; accepted: number }>();
  for (const finding of artifact.rankedFindings) {
    const entry = table.get(finding.category) ?? { emitted: 0, accepted: 0 };
    entry.emitted += 1;
    if (finding.matchedGoldens.length > 0) entry.accepted += 1;
    table.set(finding.category, entry);
  }
  return table;
}

describe('the category prior is the artifact, restated', () => {
  it('covers every category the type allows', () => {
    // **A missing key would be an exception at runtime for one category and not another**, which is the kind of hole a
    // test with three examples never finds.
    expect(Object.keys(CATEGORY_ACCEPTANCE).sort()).toEqual([...REVIEW_CATEGORIES].sort());
  });

  it('agrees with the artifact on every count and every rate', () => {
    const measured = measuredFromArtifact();
    // **The artifact has to be a run over the corpus its own coverage table describes**, or this test would be checking
    // the table against a different corpus than the one it cites - the same drift, one level up. **The number of pull
    // requests is not asserted**, because a test that pins it has to be edited every time the corpus slice moves, and a
    // test people edit to make it pass is a test that has stopped checking anything.
    expect(artifact.prsInDataset).toBe(artifact.coverage.byPullRequest.length);

    for (const category of REVIEW_CATEGORIES) {
      const counted = measured.get(category) ?? { emitted: 0, accepted: 0 };
      const declared = CATEGORY_ACCEPTANCE[category];
      expect({ category, emitted: declared.emitted, accepted: declared.accepted }).toEqual({
        category,
        emitted: counted.emitted,
        accepted: counted.accepted,
      });
      const prior =
        counted.emitted === 0
          ? null
          : Math.round((counted.accepted / counted.emitted) * 10_000) / 10_000;
      expect({ category, prior: declared.prior }).toEqual({ category, prior });
    }
  });

  it('drops exactly the categories that fell below the floor, and keeps the unmeasured ones', () => {
    const dropped = REVIEW_CATEGORIES.filter(
      (category) => !categoryVerdict(category, 'defect').emit,
    ).sort();
    const expected = REVIEW_CATEGORIES.filter((category) => {
      const prior = CATEGORY_ACCEPTANCE[category].prior;
      return prior !== null && prior < DEFECT_FLOOR;
    }).sort();
    expect(dropped).toEqual(expected);
    // **And the unmeasured categories are kept**: `api` and `other` were never emitted in the measured run, and a
    // category nobody tried is not a category that failed.
    expect(categoryVerdict('api', 'defect').emit).toBe(true);
    expect(categoryVerdict('other', 'defect').emit).toBe(true);
  });

  it('keeps everything under the advisory profile, including what the defect profile drops', () => {
    for (const category of REVIEW_CATEGORIES) {
      expect(categoryVerdict(category, 'advisory').emit).toBe(true);
    }
    expect(categoryVerdict('test', 'advisory').reason).toContain('advisory profile');
  });

  it('names the count, the rate and the floor in the sentence a reader is shown', () => {
    const verdict = categoryVerdict('test', 'defect');
    expect(verdict.emit).toBe(false);
    expect(verdict.reason).toContain('11 of 95');
    expect(verdict.reason).toContain('0.116');
    expect(verdict.reason).toContain('0.22');
  });
});

describe('the workflow and the code offer the same profiles', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
    'utf8',
  );

  it('pins the profile the matrix runs to the one R-17 did not falsify', () => {
    // **This assertion used to require two profile arms, and iteration 124 retired the second one by measurement rather
    // than by preference.** §19.3 falsified the 0.22 floor at +0.0079 against a registered +0.02 on a hundred unseen
    // pull requests, so `advisory` is the default and `defect` is a measured but retired configuration. Keeping it as a
    // matrix key would have produced four arms over two keys, and the comparison job refuses any pair whose artifacts
    // differ in more than one key - four artifacts, zero comparisons, twice the bill.
    //
    // **The property worth holding is the one that survives the change**: every arm names a profile the code implements,
    // and the arm the artifact records is the arm that ran. A matrix arm the code does not implement runs the default
    // while the artifact records a name nobody ran, which is an experiment that measures the wrong arm and says so in its
    // own metadata.
    const arms = [...workflow.matchAll(/-\s*\{\s*profile:\s*([^,}]+)/g)].map((match) =>
      match[1]!.trim().replace(/^['"]|['"]$/g, ''),
    );
    expect(arms.length).toBeGreaterThan(0);
    for (const arm of arms) expect(Object.keys(KNOWN_PROFILES)).toContain(arm);
    // **And the retired configuration is not one of them**, because a device that is being re-measured every dispatch
    // without a registration is a device whose verdict is being re-rolled until it looks like a result.
    expect(arms).not.toContain('defect');
  });

  it('passes the arm to the process the script reads, so the artifact and the matrix cannot disagree', () => {
    expect(workflow).toContain('AACR_PROFILE: ${{ matrix.profile }}');
    // **And the retired device is off in both arms**, because a matrix that varies two things compares neither.
    expect(workflow).toContain("AACR_CHECKLIST: 'off'");
  });
});

describe('applying a profile to a ranked list', () => {
  const finding = (category: ReviewCategory, id: string) => ({ id, finding: { category } });

  it('keeps the input order and removes only the categories the profile drops', () => {
    const items = [
      finding('bug', 'a'),
      finding('test', 'b'),
      finding('architecture', 'c'),
      finding('security', 'd'),
      finding('test', 'e'),
    ];
    const outcome = applyEmissionProfile(items, 'defect');
    expect(outcome.kept.map((entry) => entry.id)).toEqual(['a', 'd']);
    // **One entry per dropped category with its count**, not one entry per finding: a list of 95 dropped findings is a
    // list nobody reads, and the reason is the same sentence 95 times.
    expect(outcome.dropped).toEqual([
      expect.objectContaining({ category: 'test', count: 2 }),
      expect.objectContaining({ category: 'architecture', count: 1 }),
    ]);
  });

  it('removes nothing under the advisory profile', () => {
    const items = [finding('bug', 'a'), finding('test', 'b'), finding('architecture', 'c')];
    const outcome = applyEmissionProfile(items, 'advisory');
    expect(outcome.kept.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(outcome.dropped).toEqual([]);
  });
});
