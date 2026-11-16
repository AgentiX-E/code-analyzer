// **A refusal that can only say no is a refusal to spend the money twice.**
//
// R-31 was two arms of a hundred pull requests, three hours and forty minutes each, and the comparison job answered with
// one sentence: *the two artifacts are not the same experiment*. It was right about the totals - the lane arm reviewed
// 98 pull requests because two `.diff` requests returned 500, the reader arm reviewed 100, and **an F1 computed over 98
// rows cannot be subtracted from one computed over 100**. It was wrong about the whole of the rest: the pairs both arms
// read on their shared rows are pairs, the two arms were the same corpus on those rows, and the artifact that would have
// said so held every `(pull request, golden)` pair the arms were credited with.
//
// So the guard keeps refusing the totals - **and prints the paired reading over the pull requests both arms read**, with
// the dropped keys named. The distinction this file exists to hold is that the two numbers are different claims:
//
// - `delta.f1` is a comparison of two totals, and it is legitimate only when the totals are over the same rows.
// - `pairedOnCommonPullRequests` is a comparison of readings taken on the same rows, which is exactly what a paired test
//   wants, and the rows it could not use are dropped by name rather than by count.
//
// **The failure mode this replaces is not a wrong number, it is an unreadable artifact.** A job that refuses and says
// nothing about the usable pairs gets run again unchanged, at the same price, by whoever needs the answer - which is how
// a measurement defect turns into a budget defect.

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

/** One pull request both arms read, and one only the arm under test read. */
const SHARED = 'https://github.com/example/repo/pull/1';
const ONLY_WITH = 'https://github.com/example/repo/pull/2';

/**
 * One arm, with the covered goldens written per pull request rather than generated.
 *
 * **`covered` is the goldens the arm was credited with on that pull request**, which is the only thing the paired test
 * reads - so writing it by hand is what lets the expected 2x2 be written by hand as well. `configuration` differs
 * between the two arms in `ensemble` alone, so the pair is refused for its corpus and not for a second variable.
 */
function arm(options: {
  readonly variant: 'reader' | 'lane';
  readonly reviewed: readonly string[];
  readonly covered: Readonly<Record<string, readonly number[]>>;
  /** What the dispatch asked for, which is the corpus the two arms are supposed to share. */
  readonly requested?: number;
}): Record<string, unknown> {
  const goldens = 20;
  const requested = options.requested ?? 2;
  const universe = requested === 1 ? [SHARED] : [SHARED, ONLY_WITH];
  const coveredTotal = Object.values(options.covered).reduce((sum, at) => sum + at.length, 0);
  return {
    corpus: 'fixture corpus',
    prsInDataset: requested,
    datasetRows: 200,
    prsReviewed: options.reviewed.length,
    corpusRead: {
      requested,
      unread: requested - options.reviewed.length,
      whole: options.reviewed.length === requested,
    },
    prsWithoutDiffReasons: universe
      .filter((key) => !options.reviewed.includes(key))
      .map((key) => ({
        key,
        reason: 'the diff request returned 500 with 4615 requests left in the hour',
      })),
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: 'advisory',
      ensemble: options.variant === 'reader' ? 'reader' : false,
    },
    truePositives: coveredTotal,
    falsePositives: 16,
    falseNegatives: goldens - coveredTotal,
    precision: coveredTotal / (coveredTotal + 16),
    recall: coveredTotal / goldens,
    f1: (2 * coveredTotal) / (2 * coveredTotal + 16 + goldens - coveredTotal),
    fullEmission: { k: coveredTotal + 16 },
    coverage: {
      byPullRequest: options.reviewed.map((pr) => ({
        pr,
        goldens: 4,
        covered: options.covered[pr] ?? [],
      })),
    },
  };
}

/** Run the job's own entry point over two artifacts, and read the artifact and the line it printed. */
function compare(
  withArtifact: Record<string, unknown>,
  withoutArtifact: Record<string, unknown>,
): { readonly status: number; readonly artifact: Record<string, unknown>; readonly stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-compare-gap-'));
  const onPath = join(dir, 'with.json');
  const offPath = join(dir, 'without.json');
  writeFileSync(onPath, JSON.stringify(withArtifact));
  writeFileSync(offPath, JSON.stringify(withoutArtifact));
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [script, onPath, offPath], {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    status = failure.status ?? -1;
    stdout = failure.stdout ?? '';
  }
  const artifact = JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
  ) as Record<string, unknown>;
  return { status, artifact, stdout };
}

type Paired = {
  commonPullRequests: number;
  both: number;
  withOnly: number;
  withoutOnly: number;
  pValue: number;
  dropped: { with: readonly string[]; without: readonly string[] };
};

const pairedOf = (artifact: Record<string, unknown>): Paired =>
  (artifact['detail'] as { pairedOnCommonPullRequests: Paired }).pairedOnCommonPullRequests;

describe('a pair whose arms read different rows', () => {
  it('reports the paired reading over the pull requests both arms read, and drops the rest by name', () => {
    // The shape of R-31: the arm under test read both pull requests, the baseline read one - so **the baseline found a
    // golden on a pull request the arm under test never reached**, and counting it would report the corpus difference as
    // a device effect.
    const withArm = arm({
      variant: 'reader',
      reviewed: [SHARED, ONLY_WITH],
      covered: { [SHARED]: [0], [ONLY_WITH]: [5] },
    });
    const withoutArm = arm({
      variant: 'lane',
      reviewed: [SHARED],
      covered: { [SHARED]: [1] },
    });

    const { status, artifact, stdout } = compare(withArm, withoutArm);

    // **The totals are still refused**, because the two denominators are not the same rows.
    expect(status).toBe(1);
    expect(artifact['compared']).toBe(false);
    expect(artifact['delta']).toBeUndefined();

    const paired = pairedOf(artifact);
    // One shared row; the arm under test's golden on `ONLY_WITH` is not a pair, because a reading the baseline was
    // never given cannot disagree with it.
    expect(paired.commonPullRequests).toBe(1);
    expect(paired.withOnly).toBe(1);
    expect(paired.withoutOnly).toBe(1);
    expect(paired.both).toBe(0);
    expect(paired.dropped.with).toEqual([ONLY_WITH]);
    expect(paired.dropped.without).toEqual([]);

    // **And the line a human reads says which reading exists**, because the sentence that only says "not compared" is
    // the one that gets the run repeated.
    expect(stdout).toContain('paired on the 1 pull request both arms read');
  });

  it('does not credit a golden that sits on a row only one arm read', () => {
    // The tempting defect: a paired test over the union of the two corpora credits the baseline for goldens the other
    // arm was never shown, and every corpus loss reads as a device that hurts.
    const withArm = arm({ variant: 'reader', reviewed: [SHARED], covered: { [SHARED]: [0] } });
    const withoutArm = arm({
      variant: 'lane',
      reviewed: [SHARED, ONLY_WITH],
      covered: { [SHARED]: [0], [ONLY_WITH]: [2] },
    });

    const { artifact } = compare(withArm, withoutArm);

    const paired = pairedOf(artifact);
    expect(paired.commonPullRequests).toBe(1);
    // The baseline's extra golden is on a row the other arm did not read, so it is not a discordant pair.
    expect(paired.withoutOnly).toBe(0);
    expect(paired.both).toBe(1);
  });

  it('counts each golden on a shared row as its own pair', () => {
    const withArm = arm({ variant: 'reader', reviewed: [SHARED, ONLY_WITH], covered: { [SHARED]: [0] } });
    const withoutArm = arm({ variant: 'lane', reviewed: [SHARED], covered: { [SHARED]: [1, 2] } });

    const { artifact } = compare(withArm, withoutArm);

    const paired = pairedOf(artifact);
    expect(paired.commonPullRequests).toBe(1);
    expect(paired.withOnly).toBe(1);
    expect(paired.withoutOnly).toBe(2);
    expect(paired.both).toBe(0);
  });

  it('leaves a pair that read the whole corpus alone', () => {
    // **The repair must not turn every comparison into a paired-only one**, or the guard stops being able to refuse.
    const withArm = arm({ variant: 'reader', reviewed: [SHARED], covered: { [SHARED]: [0] }, requested: 1 });
    const withoutArm = arm({ variant: 'lane', reviewed: [SHARED], covered: { [SHARED]: [1] }, requested: 1 });

    const { status, artifact } = compare(withArm, withoutArm);

    expect(status).toBe(0);
    expect(artifact['compared']).toBe(true);
    expect((artifact['detail'] as { pairedOnCommonPullRequests?: unknown })?.pairedOnCommonPullRequests)
      .toBeUndefined();
  });
});
