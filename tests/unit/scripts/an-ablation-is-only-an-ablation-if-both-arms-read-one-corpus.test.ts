// **An ablation is only an ablation if both arms read the same corpus, and the comparison job did not check.**
//
// The run of 2026-11-10 asked both arms of the checklist experiment for fifty pull requests. The `without` arm read
// fifty; the `with` arm read forty-six, because its diff requests went out unauthenticated and the four it lost are
// recorded verbatim in its artifact - `"the diff request returned 500 with 51 requests left in the hour and the request
// was unauthenticated"`. The two artifacts then said `prsInDataset: 50` on both sides, and the comparison job - whose
// whole job is to refuse confounded pairs - compared them.
//
// **The comparison was not wrong about the arithmetic; it was wrong about what it was comparing.** `prsInDataset` is
// what a run asked for. `prsReviewed` is what it got. A guard that reads only the first turns a quarter-lost corpus
// into a denominator, and the paired test then has to be rebuilt by hand from the two artifacts - which is how the
// previous iteration's readout had to be produced.
//
// **This file is that guard, exercised through the job's own entry point** rather than through a copy of its logic: the
// fixtures below are written to a directory, the script is spawned on them, and both the exit code and the artifact it
// leaves behind are asserted. A guard that only exists inside a unit test is a guard that the job does not have.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'aacr-checklist-compare.mjs',
);

/** The four pull requests the `with` arm could not read in run 42823966835, verbatim from its artifact. */
const LOST = [
  'https://github.com/comfyanonymous/ComfyUI/pull/7952',
  'https://github.com/comfyanonymous/ComfyUI/pull/8446',
  'https://github.com/comfyanonymous/ComfyUI/pull/6033',
  'https://github.com/mrdoob/three.js/pull/30750',
];

/**
 * The corpus the run asked for: the four pull requests the `with` arm lost, plus the forty-six both arms read.
 *
 * **The lost ones are in it on purpose.** A fixture that generated fifty keys and then filtered four names that were
 * never there is a fixture whose "short arm" is not short - and that is exactly how the first version of this file
 * passed while asserting nothing.
 */
const all = [
  ...LOST,
  ...Array.from({ length: 46 }, (_, at) => `https://github.com/example/repo/pull/${at}`),
];

/**
 * One arm, as the bench writes it.
 *
 * **`covered` is the goldens the registered operating point found**, which is what the paired test consumes; the
 * fixture gives the two arms different ones so that a comparison that runs has something to say.
 */
function arm(options: {
  readonly checklist: boolean;
  readonly reviewed: readonly string[];
  readonly found: readonly number[];
  readonly truePositives: number;
  readonly falsePositives: number;
}): Record<string, unknown> {
  const goldens = 20;
  const falseNegatives = goldens - options.truePositives;
  return {
    corpus: 'fixture corpus',
    prsInDataset: all.length,
    datasetRows: 200,
    prsReviewed: options.reviewed.length,
    corpusRead: {
      requested: all.length,
      unread: all.length - options.reviewed.length,
      whole: options.reviewed.length === all.length,
    },
    prsWithoutDiffReasons: all
      .filter((key) => !options.reviewed.includes(key))
      .map((key) => ({ key, reason: 'the diff request was unauthenticated' })),
    configuration: { judgeModel: 'fixture-model', languageChecklist: options.checklist },
    truePositives: options.truePositives,
    falsePositives: options.falsePositives,
    falseNegatives,
    precision: options.truePositives / (options.truePositives + options.falsePositives),
    recall: options.truePositives / goldens,
    f1:
      (2 * options.truePositives) /
      (2 * options.truePositives + options.falsePositives + falseNegatives),
    fullEmission: { k: options.truePositives + options.falsePositives },
    coverage: {
      byPullRequest: options.reviewed.map((pr, at) => ({
        pr,
        goldens: 1,
        covered: options.found.filter((golden) => golden % options.reviewed.length === at),
      })),
    },
  };
}

/** Run the job's own entry point over two artifacts in a directory of their own, and read what it wrote. */
function compare(
  withArtifact: Record<string, unknown>,
  withoutArtifact: Record<string, unknown>,
): { readonly status: number; readonly artifact: Record<string, unknown> } {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-compare-'));
  const onPath = join(dir, 'with.json');
  const offPath = join(dir, 'without.json');
  writeFileSync(onPath, JSON.stringify(withArtifact));
  writeFileSync(offPath, JSON.stringify(withoutArtifact));
  let status = 0;
  try {
    execFileSync(process.execPath, [script, onPath, offPath], { cwd: dir, stdio: 'pipe' });
  } catch (error) {
    status = (error as { status?: number }).status ?? -1;
  }
  const artifact = JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-checklist-paired.json'), 'utf8'),
  ) as Record<string, unknown>;
  return { status, artifact };
}

describe('the comparison between two arms of an ablation', () => {
  it('refuses a pair whose arms read different amounts of the corpus, and names what was lost', () => {
    const withArm = arm({
      checklist: true,
      reviewed: all.filter((key) => !LOST.includes(key)),
      found: [0, 2, 4, 6],
      truePositives: 4,
      falsePositives: 16,
    });
    const withoutArm = arm({
      checklist: false,
      reviewed: all,
      found: [0, 1, 3, 5],
      truePositives: 4,
      falsePositives: 16,
    });

    const { status, artifact } = compare(withArm, withoutArm);

    // **The job fails**, because **a comparison that did not happen must not turn a workflow green** - the defect
    // iteration 102 of this repository was about.
    expect(status).toBe(1);
    expect(artifact['compared']).toBe(false);

    const detail = artifact['detail'] as {
      confounds: Array<Record<string, unknown>>;
      corpus: { with: { missing: Array<{ key: string; reason: string }> } };
    };
    const fields = detail.confounds.map((confound) => confound['field']);
    expect(fields).toContain('prsReviewed');
    expect(fields).toContain('corpusRead.whole');
    expect(fields).toContain('corpusRows');

    // **The four pull requests are named, not counted**: "four short" is a number and `comfyanonymous/ComfyUI#7952` is
    // the repair.
    const rows = detail.confounds.find((confound) => confound['field'] === 'corpusRows');
    expect(rows?.['onlyWithout']).toEqual(LOST);
    expect(rows?.['onlyWith']).toEqual([]);
    expect(detail.corpus.with.missing.map((entry) => entry.key)).toEqual(LOST);
    expect(detail.corpus.with.missing[0]!.reason).toContain('unauthenticated');
  });

  it('compares two arms that read the whole corpus, and publishes the paired test', () => {
    const withArm = arm({
      checklist: true,
      reviewed: all,
      found: [0, 1, 2, 3, 4, 5],
      truePositives: 6,
      falsePositives: 14,
    });
    const withoutArm = arm({
      checklist: false,
      reviewed: all,
      found: [0, 1, 2],
      truePositives: 3,
      falsePositives: 17,
    });

    const { status, artifact } = compare(withArm, withoutArm);

    expect(status).toBe(0);
    expect(artifact['compared']).toBe(true);
    const paired = artifact['pairedTest'] as Record<string, unknown>;
    expect(paired['withOnly']).toBe(3);
    expect(paired['withoutOnly']).toBe(0);
    expect(artifact['delta']).toMatchObject({ truePositives: 3 });
  });

  it('refuses an arm that declares itself incomplete even when the counts agree', () => {
    // **Two arms can read the same number and not the same pull requests**, which is the case a count cannot see: here
    // the `with` arm swaps one pull request for another, so `prsReviewed` is 50 on both sides.
    const swapped = [...all.slice(0, 49), 'https://github.com/example/repo/pull/999'];
    const { status, artifact } = compare(
      arm({
        checklist: true,
        reviewed: swapped,
        found: [0],
        truePositives: 2,
        falsePositives: 18,
      }),
      arm({ checklist: false, reviewed: all, found: [1], truePositives: 2, falsePositives: 18 }),
    );

    expect(status).toBe(1);
    const confounds = (artifact['detail'] as { confounds: Array<Record<string, unknown>> })
      .confounds;
    // **`prsReviewed` agrees and the experiment still is not one**, which is why the rows are compared as a set.
    expect(confounds.map((c) => c['field'])).not.toContain('prsReviewed');
    const rows = confounds.find((confound) => confound['field'] === 'corpusRows');
    expect(rows?.['onlyWith']).toEqual(['https://github.com/example/repo/pull/999']);
    // **The key the swap dropped, read from the corpus rather than retyped**, so the assertion cannot drift from the
    // fixture it is about.
    expect(rows?.['onlyWithout']).toEqual([all.at(-1)]);
  });
});
