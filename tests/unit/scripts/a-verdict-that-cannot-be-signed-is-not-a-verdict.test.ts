// **A verdict that cannot be signed is not a verdict, and the field that would have signed it was already there.**
//
// Every comparison this job writes carries `pairedTest.pValue`, computed from the goldens the two arms agree and
// disagree on. No branch read it. A run could reach `magnitudeMet` with `p = 0.4` and be filed as
// `confirmed: at least 0.02 F1` - which is the definition of a table that fills with noise, because **the bar and the
// test are two different questions and only one of them was asked**:
//
// - the bar asks "is the gain at least what we said it would be", which is a claim about the device;
// - the test asks "could this gain have arrived by resampling", which is a claim about the corpus.
//
// §64 priced the second question and found it costs 0.0191 on 98 rows, so a 0.02 bar clears it by five percent - and a
// device that does nothing reads past a one-sigma bar about fifteen percent of the time. **`P(Z >= 1.05) = 0.147`.**
//
// The test here is the paired one, not McNemar on goldens: goldens inside a pull request are not independent, so a
// golden-level test treats 724 draws as 724 observations and is too optimistic by however much the rows cluster. **The
// unit is the pull request**, resampled with replacement, and the statistic is the paired difference over the draws.
//
// **R-32 is the case that made this urgent and the case that shows why it is not a formality.** Its gain is +0.0296 on
// 724 goldens with `p = 0.0022` from McNemar - and `z = 1.95` from the clustered bootstrap, which is p = 0.051. One
// instrument signs it, the other says "not quite", and the honest reading is the second: **the effect sits on this
// corpus' ability to sign, not comfortably inside it.** A job that reported only the first would have called a
// boundary case a confirmed device, and one that reported only the second would have thrown away the best result this
// project has measured.

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

const SLICE = { skip: 50, requested: 100 };

interface Row {
  readonly goldens: number;
  readonly covered: number[];
  readonly shippedEmitted: number;
}

/**
 * An artifact of `rows.length` pull requests, as the bench writes one.
 *
 * **The rows are the whole point of this file**: a fixture that declares a total and no per-row detail cannot be
 * resampled, and a job that resamples it anyway reports the shape of its fixture. Each row carries the three numbers a
 * contingency-table row has, and the totals are summed from them rather than written beside them.
 */
function arm(options: {
  readonly profile: 'defect' | 'advisory';
  readonly rows: readonly Row[];
}): Record<string, unknown> {
  const totals = options.rows.reduce(
    (sum, row) => ({
      tp: sum.tp + row.covered.length,
      fp: sum.fp + Math.max(0, row.shippedEmitted - row.covered.length),
      fn: sum.fn + (row.goldens - row.covered.length),
    }),
    { tp: 0, fp: 0, fn: 0 },
  );
  const goldens = options.rows.reduce((sum, row) => sum + row.goldens, 0);
  return {
    corpus: 'fixture corpus',
    prsInDataset: options.rows.length,
    datasetRows: options.rows.length,
    prsReviewed: options.rows.length,
    corpusRead: { requested: options.rows.length, unread: 0, whole: true },
    corpusSlice: SLICE,
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: options.profile,
    },
    ...{
      truePositives: totals.tp,
      falsePositives: totals.fp,
      falseNegatives: totals.fn,
    },
    precision: totals.tp / (totals.tp + totals.fp),
    recall: totals.tp / goldens,
    f1: (2 * totals.tp) / (2 * totals.tp + totals.fp + totals.fn),
    fullEmission: { k: totals.tp + totals.fp },
    coverage: {
      byPullRequest: options.rows.map((row, at) => ({
        pr: `https://github.com/example/repo/pull/${String(at)}`,
        goldens: row.goldens,
        covered: row.covered,
        shippedEmitted: row.shippedEmitted,
      })),
    },
  };
}

function compare(
  withArtifact: Record<string, unknown>,
  withoutArtifact: Record<string, unknown>,
): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-sign-'));
  const onPath = join(dir, 'with.json');
  const offPath = join(dir, 'without.json');
  writeFileSync(onPath, JSON.stringify(withArtifact));
  writeFileSync(offPath, JSON.stringify(withoutArtifact));
  execFileSync(process.execPath, [script, onPath, offPath], { cwd: dir, stdio: 'pipe' });
  return JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('a verdict that cannot be signed is not a verdict', () => {
  /**
   * **A corpus where the device finds two more goldens on every row than the baseline does**, with rows of different
   * sizes so that the resampling has something to vary. A gain this wide is far outside 0.0191, and a job that refused to
   * sign it would be a job that could not confirm anything.
   */
  const spread = (shortfall: number) =>
    Array.from({ length: 100 }, (_, at) => {
      const goldens = 6 + (at % 3);
      return {
        goldens,
        covered: Array.from({ length: goldens - shortfall }, (_, k) => k),
        shippedEmitted: 9,
      };
    });

  it('signs a gain that is larger than the corpus can move it', () => {
    const artifact = compare(
      arm({ profile: 'defect', rows: spread(2) }),
      arm({ profile: 'advisory', rows: spread(3) }),
    );
    const significance = artifact['significance'] as Record<string, number | string>;
    expect(significance['pullRequests']).toBe(100);
    expect(Number(significance['sd'])).toBeGreaterThan(0);
    expect(Number(significance['z'])).toBeGreaterThan(1.96);
    expect(String((artifact['verdict'] as Record<string, unknown>)['outcome'])).toMatch(
      /^confirmed/,
    );
  });

  it('refuses to sign a gain that five rows carried by themselves', () => {
    // **The same total gain, moved into five pull requests.** The baseline finds nothing; the device finds the whole of
    // seven goldens on five rows and nothing on the other ninety-five. Resampling that corpus drops the five rows
    // three times in four, so the difference is zero on most draws - and a job that reported the point estimate would
    // be reporting the five rows rather than the device.
    const without = Array.from({ length: 100 }, () => ({
      goldens: 7,
      covered: [] as number[],
      shippedEmitted: 1,
    }));
    const withRows = Array.from({ length: 100 }, (_, at) =>
      at < 2
        ? { goldens: 7, covered: [0, 1, 2, 3, 4, 5, 6], shippedEmitted: 9 }
        : { goldens: 7, covered: [] as number[], shippedEmitted: 1 },
    );
    const artifact = compare(
      arm({ profile: 'defect', rows: withRows }),
      arm({ profile: 'advisory', rows: without }),
    );
    const verdict = artifact['verdict'] as Record<string, unknown>;
    expect(verdict['magnitudeMet']).toBe(true);
    expect(verdict['confirms']).toBe(false);
    expect(String(verdict['outcome'])).toMatch(/^met but not signed/);
    const significance = artifact['significance'] as Record<string, number | string>;
    expect(Number(significance['z'])).toBeLessThan(1.96);
  });

  it('says which of the two questions a bar answers before the run is bought', () => {
    // **`resolvable` and `confirmable` are different**, and the second is the one that decides whether a paid dispatch
    // can produce a signed verdict: a bar at one standard deviation clears the first and cannot clear the second.
    const artifact = compare(
      arm({
        profile: 'defect',
        rows: Array.from({ length: 100 }, () => ({
          goldens: 7,
          covered: [0, 1, 2, 3],
          shippedEmitted: 9,
        })),
      }),
      arm({
        profile: 'advisory',
        rows: Array.from({ length: 100 }, () => ({
          goldens: 7,
          covered: [0, 1, 2],
          shippedEmitted: 9,
        })),
      }),
    );
    const verdict = artifact['verdict'] as Record<string, unknown>;
    expect(artifact['resolvable']).toBe(true);
    // R-32's 0.01 is under the corpus bar and was refused before the run; a 0.0191 bar clears it and still cannot be
    // signed, because signing needs 1.96 standard deviations rather than one.
    const confirmable = verdict['confirmable'] as {
      bar: number;
      needs: number;
      confirmed: boolean;
    };
    expect(confirmable.confirmed).toBe(false);
    expect(confirmable.needs).toBeGreaterThan(confirmable.bar);
  });

  it('publishes the interval it signed on, so a reader can disagree with it', () => {
    const sixty = (shortfall: number) =>
      Array.from({ length: 60 }, (_, at) => {
        const goldens = 6 + (at % 3);
        return {
          goldens,
          covered: Array.from({ length: goldens - shortfall }, (_, k) => k),
          shippedEmitted: 9,
        };
      });
    const artifact = compare(
      arm({ profile: 'defect', rows: sixty(2) }),
      arm({ profile: 'advisory', rows: sixty(3) }),
    );
    const significance = artifact['significance'] as Record<string, number | string>;
    expect(significance['resamples']).toBe(4000);
    expect(significance['unit']).toBe('pull request');
    expect(Number(significance['sd'])).toBeGreaterThan(0);
    expect(Number(significance['lower'])).toBeLessThan(Number(significance['upper']));
    // The point estimate the interval is centred on is the same one the delta block publishes, to the last digit that
    // two computations of one quantity can agree on.
    const delta = artifact['delta'] as Record<string, number>;
    expect(Number(significance['mean'])).toBeCloseTo(delta['f1'] as number, 3);
  });
});
