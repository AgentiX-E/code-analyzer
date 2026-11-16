// **Two runs over two slices of one corpus are not two experiments, and until now the job could not read them as one.**
//
// §63 established that a device has to be confirmed on two slices before it is called real, because one slice moved the
// sign of a device by 0.0518. That rule buys a second reading and throws away its arithmetic: `skip 50 max 100` and
// `skip 150 max 100` are disjoint halves of one 200-pull-request corpus, the registration names both, and **the effect
// measured on either half is an estimate of the same effect.**
//
// So the second slice is not only a direction check - it is **100 more rows of the same experiment**. At 100 rows R-32's
// +0.0296 is a 1.97-sigma result; the same effect over 200 rows is about 2.8 sigma, which is the difference between a
// boundary case and a signed one. **The corpus this project can afford is already twice the corpus this project has been
// testing on**, and nothing in the instrument could say so.
//
// Merging is not concatenation. Three things have to hold or the sum is a number about nothing:
//
// - **the slices do not overlap**, because a pull request counted twice is a corpus that weighs one row twice;
// - **the configuration is identical**, because two arms of two different devices summed is a device that does not exist;
// - **each slice says where it started**, because a merge of two runs whose slices are unrecorded is a merge of two
//   corpora into one anonymous one.
//
// And the registration has to be able to name more than one slice, which is the edit this file exercises through the
// job rather than through a copy of its rule.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mergeSlices } from '../../../scripts/lib/slice-merge.mjs';


interface SliceOptions {
  readonly skip: number;
  readonly rows: number;
  readonly tp: number;
  readonly fp: number;
  readonly secondConcern?: boolean;
  readonly omitSlice?: boolean;
  readonly prOffset?: number;
}

/** One arm's reading of one slice, with the totals summed from its rows. */
function slice(options: SliceOptions): Record<string, unknown> {
  const goldensPerRow = 7;
  const rows = Array.from({ length: options.rows }, (_, at) => {
    const covered = at < options.tp ? 1 : 0;
    return {
      pr: `https://github.com/example/repo/pull/${String((options.prOffset ?? 0) + at)}`,
      goldens: goldensPerRow,
      covered: covered ? [0] : [],
      shippedEmitted: covered + Math.floor(options.fp / options.rows) + (at < options.fp % options.rows ? 1 : 0),
    };
  });
  const totals = rows.reduce(
    (sum, row) => ({
      tp: sum.tp + row.covered.length,
      fp: sum.fp + Math.max(0, row.shippedEmitted - row.covered.length),
      fn: sum.fn + (row.goldens - row.covered.length),
    }),
    { tp: 0, fp: 0, fn: 0 },
  );
  const goldens = rows.length * goldensPerRow;
  return {
    corpus: 'fixture corpus',
    prsInDataset: rows.length,
    datasetRows: rows.length,
    prsReviewed: rows.length,
    corpusRead: { requested: rows.length, unread: 0, whole: true },
    ...(options.omitSlice ? {} : { corpusSlice: { skip: options.skip, requested: rows.length } }),
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: 'advisory',
      secondConcern: options.secondConcern ?? false,
    },
    truePositives: totals.tp,
    falsePositives: totals.fp,
    falseNegatives: totals.fn,
    precision: totals.tp / (totals.tp + totals.fp),
    recall: totals.tp / goldens,
    f1: (2 * totals.tp) / (2 * totals.tp + totals.fp + totals.fn),
    fullEmission: { k: totals.tp + totals.fp },
    coverage: { byPullRequest: rows },
  };
}

const script = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'aacr-ablation-compare.mjs',
);

function compare(
  withArtifact: Record<string, unknown>,
  withoutArtifact: Record<string, unknown>,
): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-merge-'));
  writeFileSync(join(dir, 'with.json'), JSON.stringify(withArtifact));
  writeFileSync(join(dir, 'without.json'), JSON.stringify(withoutArtifact));
  try {
    execFileSync(process.execPath, [script, 'with.json', 'without.json'], { cwd: dir, stdio: 'pipe' });
  } catch {
    /* the refusal path writes an artifact and exits non-zero; the artifact is what this file reads */
  }
  return JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('two slices of one registration are one corpus', () => {
  it('adds the rows and re-derives the totals from them', () => {
    const merged = mergeSlices([slice({ skip: 50, rows: 100, tp: 30, fp: 200 }), slice({ skip: 150, rows: 100, tp: 40, fp: 260, prOffset: 100 })]);
    expect(merged.prsReviewed).toBe(200);
    expect((merged.coverage as { byPullRequest: unknown[] }).byPullRequest).toHaveLength(200);
    // **Summed from the rows rather than from the two totals**, because the two can disagree and the rows are what the
    // corpus bar resamples.
    expect(merged.truePositives).toBe(70);
    expect(merged.falsePositives).toBe(460);
    expect(merged.falseNegatives).toBe(1330);
  });

  it('records where the rows came from, because a merged corpus without its slices is anonymous', () => {
    const merged = mergeSlices([slice({ skip: 50, rows: 100, tp: 30, fp: 200 }), slice({ skip: 150, rows: 100, tp: 40, fp: 260, prOffset: 100 })]);
    expect((merged.corpusSlice as { slices: unknown[] }).slices).toEqual([
      { skip: 50, max: 100 },
      { skip: 150, max: 100 },
    ]);
  });

  it('refuses two slices that share a pull request', () => {
    // A pull request counted twice is a corpus that weighs one row twice, and the error names the row so the caller can
    // see which dispatch overlapped.
    const first = slice({ skip: 50, rows: 100, tp: 30, fp: 200 });
    const second = slice({ skip: 60, rows: 100, tp: 40, fp: 260, prOffset: 90 });
    expect(() => mergeSlices([first, second])).toThrow(/pull\/90/);
  });

  it('refuses two arms of two different devices', () => {
    const withSwitch = slice({ skip: 50, rows: 100, tp: 30, fp: 200, secondConcern: true });
    const without = slice({ skip: 150, rows: 100, tp: 40, fp: 260, secondConcern: false, prOffset: 100 });
    expect(() => mergeSlices([withSwitch, without])).toThrow(/configuration/);
  });

  it('refuses a run that does not say which rows it read', () => {
    const silent = slice({ skip: 0, rows: 100, tp: 30, fp: 200, omitSlice: true });
    expect(() => mergeSlices([silent, slice({ skip: 150, rows: 100, tp: 40, fp: 260, prOffset: 100 })])).toThrow(
      /corpusSlice/,
    );
  });

  it('is accepted by the job as a confirmation of a registration that names both slices', () => {
    // **The end-to-end claim**: a registration whose `confirmation` lists both slices is answered by an artifact whose
    // `corpusSlice.slices` lists the same two, because that artifact *is* both of them.
    const on = mergeSlices([
      slice({ skip: 50, rows: 100, tp: 60, fp: 100, secondConcern: true }),
      slice({ skip: 150, rows: 100, tp: 60, fp: 100, secondConcern: true, prOffset: 100 }),
    ]);
    const off = mergeSlices([
      slice({ skip: 50, rows: 100, tp: 40, fp: 140 }),
      slice({ skip: 150, rows: 100, tp: 40, fp: 140, prOffset: 100 }),
    ]);
    const artifact = compare(on, off);
    const verdict = artifact['verdict'] as Record<string, unknown>;
    expect(verdict['sliceMatches']).toBe(true);
    expect(Number((artifact['significance'] as Record<string, number>)['pullRequests'])).toBe(200);
    // **200 rows of a device worth 0.05 F1**, and the corpus signs it. The fixture's rows are uniform, so the standard
    // deviation is zero and the sign is taken on the point estimate - which is stated rather than hidden, and is the
    // difference between this gate and a gate that reads a number it cannot compute.
    expect((artifact['verdict'] as Record<string, unknown>)['signed']).toBe(true);
  });
});

describe('the merge command', () => {
  const cli = join(import.meta.dirname, '..', '..', '..', 'scripts', 'aacr-merge-slices.mjs');

  const runCli = (args: readonly string[]) => {
    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' }).toString();
    } catch (error) {
      const failure = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
      status = failure.status ?? -1;
      stdout = failure.stdout?.toString() ?? '';
      stderr = failure.stderr?.toString() ?? '';
    }
    return { status, stdout, stderr };
  };

  it('writes two merged artifacts and never overwrites its inputs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aacr-merge-cli-'));
    const write = (name: string, artifact: Record<string, unknown>) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(artifact));
      return path;
    };
    const onA = write('on-a.json', slice({ skip: 50, rows: 10, tp: 4, fp: 20, secondConcern: true }));
    const onB = write('on-b.json', slice({ skip: 150, rows: 10, tp: 5, fp: 22, secondConcern: true, prOffset: 100 }));
    const offA = write('off-a.json', slice({ skip: 50, rows: 10, tp: 3, fp: 21 }));
    const offB = write('off-b.json', slice({ skip: 150, rows: 10, tp: 3, fp: 21, prOffset: 100 }));
    const out = join(dir, 'merged');

    const result = runCli(['--with', onA, onB, '--without', offA, offB, '--out', out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('20 pull requests');
    const merged = JSON.parse(readFileSync(join(out, 'with.json'), 'utf8')) as Record<string, unknown>;
    expect((merged.coverage as { byPullRequest: unknown[] }).byPullRequest).toHaveLength(20);
    // **The inputs are still one slice each**, which is what a merge that wrote over them would have destroyed.
    const original = JSON.parse(readFileSync(onA, 'utf8')) as Record<string, unknown>;
    expect(original['prsReviewed']).toBe(10);
  });

  it('exits non-zero and names the row when two slices overlap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aacr-merge-cli-'));
    const write = (name: string, artifact: Record<string, unknown>) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(artifact));
      return path;
    };
    const first = write('a.json', slice({ skip: 50, rows: 10, tp: 4, fp: 20, secondConcern: true }));
    const second = write('b.json', slice({ skip: 55, rows: 10, tp: 4, fp: 20, secondConcern: true, prOffset: 5 }));
    const result = runCli(['--with', first, second, '--without', first, second, '--out', join(dir, 'merged')]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('appears in both');
  });
});
