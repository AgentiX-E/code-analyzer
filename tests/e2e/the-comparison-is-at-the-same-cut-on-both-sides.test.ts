// **The comparison the last round's claim needed and did not have.**
//
// §159 read our best cut (`k = 5`, `0.3221`) against the competitor's uncut output (`0.2817`) and called it a lead. The
// two numbers are about two different policies: ours had been allowed to choose how much it says and theirs had not.
// This case runs `scripts/same-cut.mjs` over the artifacts the repository actually holds and locks the corrected reading,
// because the correction is worth nothing if it lives in a document nobody re-runs.
//
// **What it asserts is uncomfortable and that is the point.** At equal comments per pull request the competitor leads on
// every one of the fourteen cuts, and the round's published target therefore moves from `0.2943` to `0.3735` on the
// board's 158. A repository that could not write that test would go on publishing the flattering comparison.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CORPUS = 'benchmarks/martian/positive_samples.json';
const THEIRS = 'benchmarks/aacr/competitor-baseline.json';

interface Comparison {
  version: string;
  ours: { profile: string; goldens: number; curve: { budget: number; f1: number }[] };
  theirs: {
    pullRequests: number;
    emitted: number;
    asPublished: { emitted: number; truePositives: number; f1: number };
    gated: { f1: number };
    curve: { budget: number; emitted: number; f1: number }[];
  };
  comparison: {
    budget: number;
    ours: { emitted: number; truePositives: number; f1: number };
    theirs: { emitted: number; truePositives: number; f1: number };
    gap: number;
  }[];
  best: Record<'ours' | 'theirs', { budget: number; f1: number }>;
  lead: number;
  guards: { theirsPublished: { source: string } };
}

function read(profile: 'core' | 'all'): Comparison {
  const ours =
    profile === 'core'
      ? 'benchmarks/cut-curve-wide-martian-core.json'
      : 'benchmarks/cut-curve-wide-martian.json';
  const json = join(mkdtempSync(join(tmpdir(), 'same-cut-e2e-')), 'out.json');
  execFileSync(
    'node',
    [
      'scripts/same-cut.mjs',
      '--ours',
      ours,
      '--theirs',
      THEIRS,
      '--corpus',
      CORPUS,
      '--profile',
      profile,
      '--json',
      json,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(readFileSync(json, 'utf8')) as Comparison;
}

interface FloorReading {
  profile: string;
  k: number;
  resolution: number;
  split: { chosen: { goldens: number }; heldOut: { goldens: number } };
  readings: Record<
    'ours' | 'theirs',
    { calibration: { floor: number }; heldOut: { delta: number }; verdict: string }
  >;
}

function floor(k: 5 | 12): FloorReading {
  const json = join(mkdtempSync(join(tmpdir(), 'score-floor-e2e-')), 'out.json');
  execFileSync(
    'node',
    [
      'scripts/score-floor.mjs',
      '--artifact',
      'benchmarks/martian-bench.json',
      '--baseline',
      THEIRS,
      '--corpus',
      CORPUS,
      '--profile',
      'core',
      '--k',
      String(k),
      '--json',
      json,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(readFileSync(json, 'utf8')) as FloorReading;
}

describe('the comparison is at the same cut on both sides', () => {
  const core = read('core');

  it('rebuilds the competitor figure §160 published before it prints a new one', () => {
    // The guard is the whole reason the table can be trusted: 616 comments and 109 credited goldens on the board's 158 is
    // the figure in §160.1, and these rows reproduce it.
    expect(core.guards.theirsPublished.source).toBe('published');
    expect(core.theirs.asPublished.emitted).toBe(616);
    expect(core.theirs.asPublished.truePositives).toBe(109);
    expect(core.theirs.asPublished.f1).toBeCloseTo(0.2817, 4);
    // **And the point §160 read as "their emission through our gate"**, which is a cut of the same rows and therefore
    // comparable with the curve below rather than with the uncut figure.
    expect(core.theirs.gated.f1).toBeCloseTo(0.3424, 4);
  });

  it('holds the denominator fixed across the two arms', () => {
    expect(core.ours.goldens).toBe(158);
    expect(core.ours.profile).toBe('core');
  });

  it('reads a gap that is ours minus theirs at every cut, and it is negative at every cut', () => {
    expect(core.comparison.length).toBeGreaterThanOrEqual(14);
    for (const row of core.comparison) {
      expect(row.gap).toBeCloseTo(row.ours.f1 - row.theirs.f1, 12);
      expect(row.gap).toBeLessThan(0);
    }
    expect(core.lead).toBe(0);
  });

  it('prices both arms at their own best cut, which is the number the target has to clear', () => {
    expect(core.best.ours.budget).toBe(5);
    expect(core.best.ours.f1).toBeCloseTo(0.3221, 4);
    expect(core.best.theirs.budget).toBe(4);
    expect(core.best.theirs.f1).toBeCloseTo(0.3735, 4);
    expect(core.best.ours.f1 - core.best.theirs.f1).toBeCloseTo(-0.0514, 4);
  });

  it('prices the board the repository used to publish, and the gap is wider there', () => {
    const all = read('all');
    expect(all.ours.goldens).toBe(173);
    expect(all.best.ours.f1).toBeCloseTo(0.315, 4);
    expect(all.best.theirs.f1).toBeCloseTo(0.3858, 4);
    expect(all.lead).toBe(0);
  });

  it('prices the score floor on one half and accepts it or refuses it on the other', () => {
    // **The device §162.5 proposed, measured instead of argued.** A floor is a cut, so it costs nothing to price; what
    // it costs is a claim, and the claim is only allowed when the half that did not choose the floor gains by the
    // board's own resolution. The reading is asymmetric, and the asymmetry is the diagnosis: their score separates hits
    // from misses in the tail of the list and ours does not.
    const five = floor(5);
    expect(five.readings.ours.calibration.floor).toBeCloseTo(0.4, 2);
    expect(five.readings.ours.heldOut.delta).toBeCloseTo(0.0017, 4);
    expect(five.readings.ours.verdict).toBe('refused');
    const twelve = floor(12);
    expect(twelve.readings.ours.heldOut.delta).toBeCloseTo(0.0026, 4);
    expect(twelve.readings.ours.verdict).toBe('refused');
    expect(twelve.readings.theirs.calibration.floor).toBeCloseTo(0.48, 2);
    expect(twelve.readings.theirs.heldOut.delta).toBeCloseTo(0.0254, 4);
    expect(twelve.readings.theirs.verdict).toBe('transfers');
    // **And the split is the corpus's, counted rather than assumed**: two halves of the board's 158.
    expect(twelve.split.chosen.goldens + twelve.split.heldOut.goldens).toBe(158);
  });

  it('draws the committed page from the committed readings', () => {
    const fresh = join(mkdtempSync(join(tmpdir(), 'same-cut-page-')), 'page.html');
    execFileSync('node', ['scripts/same-cut-page.mjs', '--out', fresh], { encoding: 'utf8' });
    const drawn = readFileSync(fresh, 'utf8');
    const committed = readFileSync('docs/same-cut.html', 'utf8');
    // **Byte for byte**, because the page is generated: a check that only compared a few numbers would pass on a page
    // whose other half had been edited by hand.
    expect(drawn).toBe(committed);
    expect(committed).toContain('0.3735');
    expect(committed).toContain('0 of 14');
  });
});
