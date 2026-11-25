// **A page that draws a reading is a second claim, and the second claim is where a page learns to disagree.**
//
// `docs/pool-density.html` is generated from two JSON files that `scripts/pool-density.mjs` wrote, so the page cannot hold
// an opinion the instrument does not. These cases hold the three ways that could stop being true:
//
//   1. **A reading it does not understand.** A file from a future version is refused rather than drawn with the fields
//      that happen to line up, which is how a page silently drops a column.
//   2. **A group list that does not cover its own pool.** Shares that do not add up to the pool are shares of a subset,
//      and a page that drew them would present a filtered reading as the whole.
//   3. **Non-determinism.** Two runs over the same files have to produce the same bytes, or the CI check that compares the
//      committed page against a fresh render becomes a coin toss.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/pool-density-page.mjs';

/** One reading, shaped exactly as `scripts/pool-density.mjs` writes it. */
function reading(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'pool-density-v1',
    artifact: 'benchmarks/fixture.json',
    corpus: 'benchmarks/fixture-corpus.json',
    profile: 'core',
    group: 'lane',
    laneSet: 'fixture',
    budget: 5,
    shippedBudget: 12,
    goldens: 10,
    fullEmission: 9,
    pool: 6,
    poolPoint: { emitted: 6, truePositives: 3 },
    point: { emitted: 4, truePositives: 3 },
    groups: [
      {
        group: 'loud',
        comments: 4,
        share: 4 / 6,
        truePositives: 1,
        density: 0.25,
        delta: 0.5,
      },
      {
        group: 'quiet',
        comments: 2,
        share: 2 / 6,
        truePositives: 2,
        density: 1,
        delta: -0.5,
      },
    ],
    splitHalf: {
      budget: 5,
      chosenGoldens: 5,
      heldOutGoldens: 5,
      groups: [
        { group: 'loud', chosenDelta: 0.25, heldOutDelta: 0.25, verdict: 'removal-gains' },
        { group: 'quiet', chosenDelta: -0.25, heldOutDelta: -0.25, verdict: 'load-bearing' },
      ],
    },
    ...overrides,
  };
}

function render(readings: Record<string, unknown>[]): { code: number; out: string; page: string } {
  const directory = mkdtempSync(join(tmpdir(), 'density-page-'));
  const sources = readings.map((record, index) => {
    const path = join(directory, `reading-${String(index)}.json`);
    writeFileSync(path, JSON.stringify(record));
    return path;
  });
  const target = join(directory, 'page.html');
  // **`--out` rather than rendering in place**: a case that wrote `docs/pool-density.html` would replace the committed
  // page with its own fixture, and the next CI run would report the repository's page as stale.
  try {
    const out = execFileSync('node', [SCRIPT, ...sources, '--out', target], { encoding: 'utf8' });
    return { code: 0, out, page: readFileSync(target, 'utf8') };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failed.status ?? 1,
      out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
      page: '',
    };
  }
}

describe('the density page draws what the instrument read', () => {
  it('draws one tab per reading and one row per group', () => {
    const { code, page } = render([reading()]);
    expect(code).toBe(0);
    expect(page).toContain('<label for="view-0">grouped by lane</label>');
    expect(page).toContain('loud');
    expect(page).toContain('quiet');
    // **The two stages are printed side by side**, because the pool's density is the first one's rate and the budget's is
    // the second's.
    expect(page).toContain('pool 6 with 3 credited');
    expect(page).toContain('budget 5 (shipped 12)');
  });

  it('shows the verdict the split-half produced rather than deriving one', () => {
    const { page } = render([reading()]);
    expect(page).toContain('chip removal-gains');
    expect(page).toContain('chip load-bearing');
  });

  it('refuses a reading from a version it does not know', () => {
    const { code, out } = render([reading({ version: 'pool-density-v2' })]);
    expect(code).toBe(1);
    expect(out).toContain('is not pool-density-v1');
  });

  it('refuses groups that do not cover the pool they claim to divide', () => {
    const { code, out } = render([reading({ pool: 7 })]);
    expect(code).toBe(1);
    expect(out).toContain('the groups hold 6 comments and the pool holds 7');
  });

  it('renders the same bytes twice', () => {
    const first = render([reading()]).page;
    const second = render([reading()]).page;
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(1000);
  });
});
