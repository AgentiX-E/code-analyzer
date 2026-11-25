/**
 * **A ceiling is only worth computing if it cannot be raised by the arithmetic that computed it.**
 *
 * The claim this file guards is the one four null devices needed and nobody had: **at the precision this run achieved,
 * no filter reaches the target, whatever it does with the findings it has.** Three ways of stating that claim are
 * wrong in ways that flatter a fifth device, and each is a case below:
 *
 * - **a ceiling computed from the kept set** is a ceiling on the run rather than on the findings: it moves whenever a
 *   device throws a matched finding away, so it can never refute a filter;
 * - **a ceiling computed from `truePositives`** counts findings rather than goldens, and the artifact publishes both -
 *   85 and 123 - so the wrong one is always available;
 * - **a frontier without a floor** reports a required number of goldens for every precision, so the precision at which
 *   the target becomes impossible looks like a hard target rather than an impossible one.
 *
 * The last two cases read the committed artifacts rather than a fixture, because **the number that decides the next
 * quarter of work is the number in the file**, not a number a fixture was built to produce.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildCeiling, formatCeiling } from '../../../scripts/filter-ceiling.mjs';

const REPO = join(__dirname, '..', '..', '..');
const read = (path: string): unknown => JSON.parse(readFileSync(join(REPO, path), 'utf8'));

const OURS = read('benchmarks/aacr-bench.json') as Parameters<typeof buildCeiling>[0];
const THEIRS = read('benchmarks/aacr/competitor-baseline.json') as Parameters<
  typeof buildCeiling
>[1];

/** One reviewer's rows, in the shape both artifacts share: the goldens each finding matched, and whether it was kept. */
function bench(rows: Array<{ goldens: number[]; kept: boolean }>, goldens: number, target = 0.45) {
  return {
    measuredAt: '2026-11-19T00:00:00.000Z',
    scoring: {
      registeredRule: `exceeds the competitor figure of ${target.toFixed(4)} F1 on the same corpus`,
    },
    coverage: { byPullRequest: [{ pr: 'pr', goldens }] },
    rankedFindings: rows.map((row, at) => ({
      pr: 'pr',
      actionable: row.kept,
      matchedGoldens: row.goldens.map((golden) => String(golden)),
      at,
    })),
  } as unknown as Parameters<typeof buildCeiling>[0];
}

const theirBench = (rows: Array<{ goldens: number[]; kept: boolean }>, goldens: number) =>
  ({
    pulls: {
      pr: {
        goldens,
        keep: rows.map((row) => row.kept),
        matches: rows.map((row) => row.goldens),
      },
    },
  }) as Parameters<typeof buildCeiling>[1];

describe('the ceiling a filter can reach', () => {
  it('reads the baseline rows of this corpus and not another corpus filed in the same record', () => {
    // **One baseline file now holds two corpora's rows**, because a row is found by pull request and recording the
    // Martian board did not invalidate the AACR slice's rows. A ceiling is a statement about *one* corpus: the moment
    // the other corpus's rows enter `theirs.goldens`, their generator recall is a rate over two corpora and the verdict
    // below it is about neither. **The first version of this function read every row in the file**, and the merged
    // record moved `theirs.goldens` from 266 to 605 without a single figure having changed.
    const ours = bench([{ goldens: [0], kept: true }], 2);
    const theirs = {
      pulls: {
        pr: { goldens: 2, keep: [true], matches: [[0]] },
        'https://elsewhere.test/other/pull/9': {
          goldens: 40,
          keep: [true],
          matches: [[0, 1, 2, 3, 4, 5, 6, 7]],
        },
      },
    } as unknown as Parameters<typeof buildCeiling>[1];
    const ceiling = buildCeiling(ours, theirs);
    expect(ceiling.theirs.goldens).toBe(2);
    expect(ceiling.theirs.generatorMatched).toBe(1);
  });

  it('counts the goldens the run matched anywhere, not the findings it kept', () => {
    // Four findings, three of them matched, two kept. A filter that dropped the matched-but-unkept one would be a
    // better filter, so the ceiling has to be computed over all four.
    const ceiling = buildCeiling(
      bench(
        [
          { goldens: [1], kept: true },
          { goldens: [2], kept: false },
          { goldens: [3], kept: false },
          { goldens: [], kept: true },
        ],
        10,
      ),
      theirBench([{ goldens: [], kept: true }], 10),
    );
    expect(ceiling.ours.generatorMatched).toBe(3);
    expect(ceiling.ours.generatorRecall).toBeCloseTo(0.3, 4);
    expect(ceiling.ours.ceilingAtPerfectPrecision).toBeCloseTo((2 * 0.3) / 1.3, 4);
  });

  it('never reports a ceiling below the F1 the run achieved, because keeping the run is one of the filters', () => {
    const ceiling = buildCeiling(OURS, THEIRS);
    expect(ceiling.ours.ceilingAtPerfectPrecision).toBeGreaterThanOrEqual(ceiling.ours.f1);
    expect(ceiling.ours.ceilingRescued).toBeGreaterThanOrEqual(ceiling.ours.f1);
  });

  it('says the target is outside the ceiling of a generator whose matched goldens cannot reach it', () => {
    const ceiling = buildCeiling(
      bench(
        [
          { goldens: [1], kept: true },
          { goldens: [], kept: true },
        ],
        100,
        0.45,
      ),
      theirBench([{ goldens: [], kept: true }], 100),
    );
    // 2 * 0.01 / 1.01 = 0.0198 at perfect precision, against a target of 0.45.
    expect(ceiling.verdict.targetInsideOurCeiling).toBe(false);
  });

  it('draws a frontier with a floor: below half the target no number of goldens reaches it', () => {
    const ceiling = buildCeiling(OURS, THEIRS);
    expect(ceiling.frontier.floorPrecision).toBeCloseTo(ceiling.target / 2, 6);
    const below = ceiling.frontier.rows.filter((row) => row.precision < ceiling.target / 2);
    expect(below.length).toBeGreaterThan(0);
    for (const row of below) expect(row.requiredMatched).toBeNull();
    const above = ceiling.frontier.rows.filter((row) => row.precision > ceiling.target / 2);
    for (const row of above) expect(row.requiredMatched).not.toBeNull();
  });

  it('costs more matched goldens as precision falls, monotonically, until the frontier leaves the corpus', () => {
    const ceiling = buildCeiling(OURS, THEIRS);
    const reachable = ceiling.frontier.rows.filter((row) => row.requiredMatched !== null);
    for (let at = 1; at < reachable.length; at += 1) {
      expect(reachable[at]!.requiredMatched!).toBeGreaterThan(reachable[at - 1]!.requiredMatched!);
    }
    // The last rows ask for more goldens than the corpus has, which is the arithmetic saying "not by recall alone".
    expect(reachable.some((row) => row.requiredMatched! > ceiling.ours.goldens)).toBe(true);
  });

  it('reads the target off the artifact rather than holding a copy of it', () => {
    const moved = buildCeiling(OURS, THEIRS).target;
    const shifted = buildCeiling(
      {
        ...OURS,
        scoring: {
          registeredRule: 'exceeds the competitor figure of 0.5000 F1 on the same corpus',
        },
      },
      THEIRS,
    );
    expect(shifted.target).not.toBe(moved);
    expect(shifted.target).toBe(0.5);
  });

  it('compares the two reviewers on the pull requests they share, over one golden count', () => {
    const { shared } = buildCeiling(OURS, THEIRS);
    // **One corpus or no comparison**: both sides of the shared block are scored against the same goldens, which is the
    // property that makes the two halves of the gap comparable. A block whose two sides carried different denominators
    // would be two measurements printed next to each other.
    expect(shared.ours.goldens).toBe(shared.theirs.goldens);
    expect(shared.pullRequests).toBeGreaterThan(0);
    expect(shared.pullRequests).toBeLessThanOrEqual(OURS.coverage.byPullRequest.length);
    // And the restriction is a restriction: no reviewer keeps more findings on a subset than on the whole.
    expect(shared.ours.kept).toBeLessThanOrEqual(buildCeiling(OURS, THEIRS).ours.kept);
  });
});

describe('the committed ceiling', () => {
  it('equals what its two sources say, so no figure in a document can drift from them', () => {
    const committed = read('benchmarks/filter-ceiling.json');
    expect(committed).toEqual(buildCeiling(OURS, THEIRS));
  });

  it('prints the verdict in the same run as the table, so a reader cannot read one without the other', () => {
    const text = formatCeiling(buildCeiling(OURS, THEIRS));
    expect(text).toContain('sits inside our ceiling:');
    expect(text).toContain('matched goldens needed, by precision:');
  });
});
