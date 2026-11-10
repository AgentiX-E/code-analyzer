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
) as { readonly rankedFindings: readonly ArtifactFinding[]; readonly prsInDataset: number };

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
    // **The artifact has to be the fifty-pull-request run**, or this test would be checking the table against a corpus
    // eight times smaller than the one it cites - the same drift, one level up.
    expect(artifact.prsInDataset).toBe(50);

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

  it('runs the two profiles as the matrix arms the comparison job reads', () => {
    // **A matrix arm the code does not implement runs the default while the artifact records a name nobody ran** - an
    // experiment that measures the wrong arm and says so in its own metadata.
    const block = /profile: \[([^\]]+)\]/.exec(workflow);
    expect(block).not.toBeNull();
    const arms = block![1]!.split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, ''));
    expect(arms.sort()).toEqual(['advisory', 'defect']);
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
