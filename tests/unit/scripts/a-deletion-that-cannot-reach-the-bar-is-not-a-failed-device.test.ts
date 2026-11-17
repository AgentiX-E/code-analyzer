// @code-analyzer/code-analyzer — a deletion device that could not have reached the bar has not failed it
//
// **§75's arithmetic, made a branch.** A registration is confirmed by a move in F1, and a removal-only device can only
// move F1 by deleting findings. **What the figure would have been had every one of its removals been a false positive is
// computable from the two artifacts** - and when that number is under the bar, the run has said something about the size
// of the pool it was given rather than about the judgement it exercised on it.
//
// The distinction is the one `registrationResolvable` already draws for a bar under the instrument's resolution: *a
// failed device is dropped, an unfalsifiable registration is rewritten*. A removal-only device priced on a pool too small
// to reach its bar is neither. **It is a third verdict**, and without it a shortfall on this corpus is filed as the
// device's failure for ever.
//
// **The bound is charitable on purpose.** It assumes every claim the gate removed was a false positive *and* that every
// one of them changed what the reviewer posted - two things that cannot both be true for a device that removes true
// positives, and both of which favour the device. A bound that generous is the only one that can carry the word
// "cannot": if even the best case is under the bar, no version of this device on this pool could have cleared it.
//
// **And it is not an excuse for timidity.** The bound is computed from what the device removed, so a gate that removed
// forty of a thousand claims is `unreachable` - and the sentence says so, which is the fact §74.4 was reaching for when
// it wrote the activity floor. A gate that removed five hundred and still did not move the figure is `falsified`, because
// at five hundred removals the bar was inside its reach and it deleted the wrong ones. **§74's gate is exactly that
// case**: 557 removals could have bought +0.077 F1 and bought −0.046.

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

/** The goldens the registered slice carries, from the artifact §73 measured: 146 pull requests, 1 054 goldens. */
const GOLDENS = 1054;
const PULL_REQUESTS = 146;

/** Every pull request the fixtures read, named the way the bench names them. */
const corpus = Array.from(
  { length: PULL_REQUESTS },
  (_, at) => `https://github.com/example/repo/pull/${String(at)}`,
);

/** The goldens split across the rows in uneven amounts that still add to `GOLDENS` - thirty-two eights, the rest sevens. */
const rows = corpus.map((_pr, at) => ({
  first: at * 7 + Math.min(at, 32),
  goldens: at < 32 ? 8 : 7,
}));

/** One arm of the pair. **`covered` is spread over the rows**, because the paired test resamples them and a fixture
 * whose rows disagree with its totals is refused by the signature gate before any verdict is written. */
function arm(options: {
  readonly falsifier: string | false;
  readonly profile?: string;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly dropped?: number;
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
    ...(typeof options.dropped === 'number'
      ? {
          engineCounters: {
            falsifier: {
              enabled: true,
              contract: 'independent-evidence-v2',
              dropped: options.dropped,
              candidates: options.dropped * 2,
            },
          },
        }
      : {}),
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
  const dir = mkdtempSync(join(tmpdir(), 'aacr-reach-'));
  const onPath = join(dir, 'with.json');
  const offPath = join(dir, 'without.json');
  writeFileSync(onPath, JSON.stringify(withArtifact));
  writeFileSync(offPath, JSON.stringify(withoutArtifact));
  try {
    execFileSync(process.execPath, [script, onPath, offPath], { cwd: dir, stdio: 'pipe' });
  } catch {
    // **A failure still leaves the artifact**, and the artifact is what this file reads: the verdict is written before
    // the exit code is decided, so a job that failed for another reason still says what it thought.
  }
  return JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
  ) as Record<string, unknown>;
}

/** The verdict object, narrowed to the three fields this file is about. */
function verdictOf(artifact: Record<string, unknown>): {
  outcome: string;
  magnitudeMet: boolean;
  reach: { removed: number; ceilingGain: number; reachable: boolean } | null;
} {
  return artifact['verdict'] as {
    outcome: string;
    magnitudeMet: boolean;
    reach: { removed: number; ceilingGain: number; reachable: boolean } | null;
  };
}

describe('a removal-only device priced on a pool too small for its bar', () => {
  it('is unreachable rather than falsified when even its best case is under the registered gain', () => {
    // **The pool, not the pool's quality.** The gate removed 80 claims; had every one of them been a false positive and
    // had every one of them changed the posted review, the figure moves by 0.0084 - and the registration asks for 0.02.
    const artifact = compare(
      arm({
        falsifier: 'independent-evidence-v2',
        truePositives: 208,
        falsePositives: 729,
        dropped: 80,
      }),
      arm({ falsifier: false, truePositives: 208, falsePositives: 769 }),
    );

    expect(artifact['compared']).toBe(true);
    const verdict = verdictOf(artifact);
    expect(verdict.magnitudeMet).toBe(false);
    expect(verdict.outcome.startsWith('unreachable:')).toBe(true);
    // **The bound is published with the verdict**, because a sentence that says "could not reach" without the number it
    // could have reached is an excuse rather than a measurement.
    expect(verdict.reach).toMatchObject({ removed: 80, reachable: false });
    expect(verdict.reach?.ceilingGain).toBeCloseTo(0.0084, 4);
    // **And the sentence names the pool size**, because that is the repair: a corpus with more claims, not a better gate.
    expect(verdict.outcome).toContain('80');
  });

  it('is falsified when the pool was inside its reach and the device deleted the wrong claims', () => {
    // **Five hundred removals could have bought +0.0669 F1**, and the device posted sixty fewer findings with the same
    // goldens. At that pool size the bar was reachable and the shortfall is the device's judgement, not the corpus's.
    const artifact = compare(
      arm({
        falsifier: 'independent-evidence-v2',
        truePositives: 208,
        falsePositives: 709,
        dropped: 500,
      }),
      arm({ falsifier: false, truePositives: 208, falsePositives: 769 }),
    );

    const verdict = verdictOf(artifact);
    expect(verdict.magnitudeMet).toBe(false);
    expect(verdict.outcome.startsWith('falsified:')).toBe(true);
    expect(verdict.reach).toMatchObject({ removed: 500, reachable: true });
  });

  it('keeps the bound out of the verdict for a device that is not removal-only', () => {
    // **A lane substitution adds findings as well as removing them**, so a bound computed from what it deleted is a
    // number about a different device. The §19 registration is the fixture, and its verdict carries no `reach` at all.
    const artifact = compare(
      arm({ falsifier: false, profile: 'defect', truePositives: 335, falsePositives: 1590 }),
      arm({ falsifier: false, truePositives: 300, falsePositives: 1700 }),
    );

    expect(verdictOf(artifact).reach).toBeNull();
  });
});
