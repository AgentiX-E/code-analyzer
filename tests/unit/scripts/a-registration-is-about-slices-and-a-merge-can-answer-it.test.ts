// **A registration is a sentence about rows, and until now it could only be looked up by a field name.**
//
// `REGISTRATIONS` is keyed by the configuration field a device varies, so `secondConcern` maps to exactly one entry. That
// was enough while one dispatch was one slice. §67 made two dispatches into one corpus, and the same field now needs two
// sentences: **the 0.01 bar R-32 was dispatched against on the hundred rows starting at fifty, and a bar for the two
// hundred rows that dispatch plus R-33 cover.**
//
// **The lookup has to pick by rows, not by key.** A single-slice artifact must be judged against the registration whose
// confirmation names that slice - rewriting the old bar after seeing its result would be fitting a threshold to an
// outcome - and a merged artifact must be judged against the sentence that names both slices. **The most specific
// registration that the artifact's rows can answer wins**, and a field with one entry is unaffected.
//
// **And the bar for the merge has to be written before the second slice is read.** It is 0.021, derived from arithmetic
// rather than from a result: §67 puts the standard deviation at 0.0106 over 200 rows, signing needs 1.96 of them, and
// 1.96 x 0.0106 = 0.0208. **A bar chosen after seeing 0.0296 would be a description of that number, which is the defect
// the skip 50 / skip 150 split exists to prevent.**

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REGISTRATIONS, registrationFor } from '../../../.github/scripts/aacr-ablation-compare.mjs';
import { mergeSlices } from '../../../scripts/lib/slice-merge.mjs';

const script = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'aacr-ablation-compare.mjs',
);

/**
 * One arm's reading of one slice.
 *
 * The device finds `tp` goldens of `goldens` and posts `comments`; every row is the same shape, so the only thing that
 * varies between the two arms of one dispatch is what the device changed.
 */
function slice(options: {
  readonly skip: number;
  readonly rows: number;
  readonly tp: number;
  readonly fp: number;
  readonly secondConcern: boolean;
  readonly prOffset?: number;
}): Record<string, unknown> {
  const goldensPerRow = 7;
  const rows = Array.from({ length: options.rows }, (_, at) => {
    const covered = at < options.tp ? [0, 1] : [];
    const shipped =
      at < options.tp
        ? 2 + Math.round(options.fp / options.rows)
        : Math.round(options.fp / options.rows);
    return {
      pr: `https://github.com/example/repo/pull/${String((options.prOffset ?? 0) + at)}`,
      goldens: goldensPerRow,
      covered,
      shippedEmitted: Math.max(shipped, covered.length),
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
    corpusSlice: { skip: options.skip, requested: rows.length },
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: 'advisory',
      secondConcern: options.secondConcern,
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

// **`object` rather than `Record<string, unknown>`**, because the two inputs are a merged artifact and a slice and only
// the first has an index signature - and a helper that demands one makes the test serialize a copy of the thing it is
// testing before it can be written to disk. What this function does with them is `JSON.stringify`.
function compare(withArtifact: object, withoutArtifact: object): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-reg-'));
  writeFileSync(join(dir, 'with.json'), JSON.stringify(withArtifact));
  writeFileSync(join(dir, 'without.json'), JSON.stringify(withoutArtifact));
  try {
    execFileSync(process.execPath, [script, 'with.json', 'without.json'], {
      cwd: dir,
      stdio: 'pipe',
    });
  } catch {
    /* refusals write an artifact and exit non-zero; the artifact is what this file reads */
  }
  return JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('a registration is about rows, so a merged corpus can answer a wider one', () => {
  it('judges one dispatch against the bar that was written for its slice', () => {
    // The hundred rows starting at fifty belong to the 0.01 sentence, and nothing about R-33 existing changes what that
    // run was measured against.
    const entry = registrationFor('secondConcern', [{ skip: 50, max: 100 }]);
    expect(entry?.section).toBe('§59 (R-32)');
    expect(entry?.registeredGain).toBe(0.01);
  });

  it('judges two slices against the bar that names both of them', () => {
    const entry = registrationFor('secondConcern', [
      { skip: 50, max: 100 },
      { skip: 150, max: 100 },
    ]);
    expect(entry?.registeredGain).toBe(0.021);
    // **Specifically the two slices, not "more than one"**: a corpus that reads fifty and a hundred and fifty is not the
    // corpus this bar was written for, and the fallback is the narrower sentence rather than the wider one.
    expect(entry?.confirmation).toEqual([
      { skip: 50, max: 100 },
      { skip: 150, max: 100 },
    ]);
  });

  it('falls back to the field the device varies rather than answering with nothing', () => {
    // A field with one entry keeps working, and a field with two keeps working for a slice neither of them names.
    expect(registrationFor('emissionProfile', [{ skip: 50, max: 100 }])?.section).toBe(
      '§19 (R-17)',
    );
    expect(registrationFor('secondConcern', [{ skip: 0, max: 40 }])?.registeredGain).toBe(0.01);
    expect(registrationFor('noSuchField', [{ skip: 50, max: 100 }])).toBeNull();
  });

  it('signs a two-slice corpus at the wider bar and refuses the narrow one underneath it', () => {
    // The device is worth about 0.03 F1 and the merge is 200 rows, so the 0.021 bar is cleared and signed while the
    // 0.01 bar would have been refused as unresolvable - which is the whole reason for writing a second sentence.
    const on = mergeSlices([
      slice({ skip: 50, rows: 100, tp: 40, fp: 120, secondConcern: true }),
      slice({ skip: 150, rows: 100, tp: 40, fp: 120, secondConcern: true, prOffset: 100 }),
    ]);
    const off = mergeSlices([
      slice({ skip: 50, rows: 100, tp: 20, fp: 140, secondConcern: false }),
      slice({ skip: 150, rows: 100, tp: 20, fp: 140, secondConcern: false, prOffset: 100 }),
    ]);
    const artifact = compare(on, off);
    const registration = artifact['registration'] as Record<string, unknown>;
    expect(registration['registeredGain']).toBe(0.021);
    const verdict = artifact['verdict'] as Record<string, unknown>;
    expect(verdict['sliceMatches']).toBe(true);
    expect(verdict['magnitudeMet']).toBe(true);
    expect(Number((artifact['significance'] as Record<string, number>)['pullRequests'])).toBe(200);
    expect(verdict['signed']).toBe(true);
    expect(verdict['confirms']).toBe(true);
  });

  it('keeps the older sentence answerable, because a published verdict has to stay reproducible', () => {
    // **R-32's reading must not change because a new bar exists.** A single-slice artifact is still judged against
    // 0.01, and its `unfalsifiable` outcome is still what the job says about it.
    const on = slice({ skip: 50, rows: 100, tp: 40, fp: 120, secondConcern: true });
    const off = slice({ skip: 50, rows: 100, tp: 30, fp: 130, secondConcern: false });
    const artifact = compare(on, off);
    expect((artifact['registration'] as Record<string, unknown>)['registeredGain']).toBe(0.01);
    expect(String((artifact['verdict'] as Record<string, unknown>)['outcome'])).toMatch(
      /^unfalsifiable/,
    );
    // And the wider sentence is not silently applied to a corpus that never read its second slice.
    // **Read off the typed registry rather than through a cast to `Record<string, unknown>`**, which the compiler refuses
    // for exactly the right reason: an interface with named fields is not an index signature, and the cast was hiding the
    // fact that this assertion had been written against a shape the declaration did not have.
    expect(REGISTRATIONS.secondConcern200.registeredGain).toBe(0.021);
  });
});
