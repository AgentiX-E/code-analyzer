// @code-analyzer/code-analyzer — a gate is judged on its removals, not on the figure it leaves behind
//
// **§75.3 states the criterion the next precision device has to meet**: R-37 supplies the recall (+32 goldens) and a gate
// has to supply the precision (**209 false positives removed**) **at a removal pool that is ≤ 4 % true positives**, which
// is the number §74's gate missed at 24.9 %. That sentence is the sharpest instrument this project has - it is measured
// on the removals rather than on the whole run, so it does not move when the reviewer's generation changes - and until
// now it was prose in a document.
//
// **A figure that measures the pool has to be published with the figure**, for the reason §46 gave about the variant
// table: a criterion a reader has to recompute from six numbers is a criterion that gets recomputed differently each
// time. `removalPool` puts `removed`, the true positives among them, their share, and whether the share is inside the
// target beside the delta - **so a run that misses F1 by 0.002 and a run that misses it by deleting the right comments
// for the wrong reason are distinguishable without opening the rows.**
//
// **`share` is `null` when nothing was removed, and not `0`.** A device that removed nothing has no pool, and a zero would
// read as a perfect pool: the failure `activity: { observed: null }` was written to prevent, one field further out.

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
  'aacr-ablation-compare.mjs',
);

const GOLDENS = 1054;
const PULL_REQUESTS = 146;

const corpus = Array.from(
  { length: PULL_REQUESTS },
  (_, at) => `https://github.com/example/repo/pull/${String(at)}`,
);

const rows = corpus.map((_pr, at) => ({
  first: at * 7 + Math.min(at, 32),
  goldens: at < 32 ? 8 : 7,
}));

/** One arm, with the counts the caller names; `covered` is spread over the rows so the paired test can resample it. */
function arm(options: {
  readonly falsifier: string | false;
  readonly profile?: string;
  readonly truePositives: number;
  readonly falsePositives: number;
}): Record<string, unknown> {
  const falseNegatives = GOLDENS - options.truePositives;
  const emitted = options.truePositives + options.falsePositives;
  const perRow = Math.round(options.falsePositives / PULL_REQUESTS);
  let remaining = options.truePositives;
  const covered = rows.map((row) => {
    const take = Math.min(row.goldens, Math.ceil(remaining / 2));
    remaining -= take;
    return Array.from({ length: take }, (_, at) => row.first + at);
  });
  return {
    corpus: 'fixture corpus',
    prsInDataset: PULL_REQUESTS,
    datasetRows: 200,
    prsReviewed: PULL_REQUESTS,
    corpusRead: { requested: PULL_REQUESTS, unread: 0, whole: true },
    corpusSlice: { skip: 50, requested: PULL_REQUESTS },
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: options.profile ?? 'advisory',
      falsifier: options.falsifier,
    },
    truePositives: options.truePositives,
    falsePositives: options.falsePositives,
    falseNegatives,
    precision: options.truePositives / emitted,
    recall: options.truePositives / GOLDENS,
    f1:
      (2 * options.truePositives) /
      (2 * options.truePositives + options.falsePositives + falseNegatives),
    fullEmission: { emitted },
    coverage: {
      byPullRequest: rows.map((row, at) => ({
        pr: corpus[at],
        goldens: row.goldens,
        covered: covered[at],
        shippedEmitted: (covered[at] ?? []).length + perRow,
      })),
    },
  };
}

/** Run the job's own entry point over the pair, and read the artifact it wrote. */
function compare(
  withArtifact: Record<string, unknown>,
  withoutArtifact: Record<string, unknown>,
): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-pool-'));
  const onPath = join(dir, 'with.json');
  const offPath = join(dir, 'without.json');
  writeFileSync(onPath, JSON.stringify(withArtifact));
  writeFileSync(offPath, JSON.stringify(withoutArtifact));
  try {
    execFileSync(process.execPath, [script, onPath, offPath], { cwd: dir, stdio: 'pipe' });
  } catch {
    // The artifact is written before the exit code is decided.
  }
  return JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('the removal pool a device was judged on', () => {
  it('publishes how many findings it removed, how many of them were true positives, and whether that is inside 4 %', () => {
    // **§73's gate at 557 removals and 69 true positives**: 12.4 % of the pool, three times the target, and the reason
    // the figure fell. The fixture is scaled to the same corpus so the share is the number §74 read off the rows.
    const artifact = compare(
      arm({ falsifier: 'quoted-falsifier-v1', truePositives: 139, falsePositives: 561 }),
      arm({ falsifier: false, truePositives: 208, falsePositives: 769 }),
    );

    expect(artifact['removalPool']).toEqual({
      removed: 277,
      truePositivesRemoved: 69,
      share: 0.2491,
      target: 0.04,
      withinTarget: false,
    });
  });

  it('says `share: null` for a device that removed nothing, rather than a perfect pool of zero', () => {
    const artifact = compare(
      arm({ falsifier: 'independent-evidence-v2', truePositives: 208, falsePositives: 769 }),
      arm({ falsifier: false, truePositives: 208, falsePositives: 769 }),
    );

    expect(artifact['removalPool']).toEqual({
      removed: 0,
      truePositivesRemoved: 0,
      share: null,
      target: 0.04,
      withinTarget: null,
    });
  });

  it('treats a device that added findings as having no removal pool at all', () => {
    // **A substitution replaces comments rather than deleting them**: this arm posts 2 200 findings where the baseline
    // posted 2 000, so it removed nothing and the pool is empty. The field says so instead of publishing a share computed
    // from a negative denominator.
    const artifact = compare(
      arm({ falsifier: false, profile: 'defect', truePositives: 400, falsePositives: 1800 }),
      arm({ falsifier: false, truePositives: 300, falsePositives: 1700 }),
    );

    expect(artifact['removalPool']).toEqual({
      removed: 0,
      truePositivesRemoved: 0,
      share: null,
      target: 0.04,
      withinTarget: null,
    });
  });
});
