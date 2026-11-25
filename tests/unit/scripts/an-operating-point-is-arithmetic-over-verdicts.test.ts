/**
 * **An operating point is arithmetic over verdicts a run already paid for.**
 *
 * Every published figure in this repository is one cut of one run's judged matrix, and until now the cut could only be
 * changed by paying for another dispatch - so a question about which findings reach a reader arrived carrying two
 * hours of model variance on top of it. The artifact already carries the verdicts, which makes the question free and
 * noise-free, and this file is the arithmetic that has to be right for the answers to be worth having.
 *
 * Three properties are asserted here because three ways of getting this wrong all produce a plausible table:
 *
 * - **a golden is credited once per pull request**, not once per claimant;
 * - **goldens do not cross pull requests**, because every pull request numbers its goldens from zero;
 * - **recall's denominator is the corpus, not the cut**, because otherwise a cut that keeps a tenth of the emission
 *   reports the recall of the tenth it kept.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { CutStep } from '../../../scripts/lib/operating-point.mjs';
import {
  applyCut,
  cutFromSteps,
  describeCut,
  formatRow,
  maximumMatchingByPullRequest,
  operatingPointTable,
  parseCut,
  registeredCuts,
  score,
} from '../../../scripts/lib/operating-point.mjs';

const creditOf = (finding: { matchedGoldens?: readonly number[] }) => finding.matchedGoldens ?? [];

/** A finding is a coordinate, a category, and the goldens its verdicts allow. Nothing else is read. */
function finding(overrides: Record<string, unknown> = {}): {
  pr: string;
  category: string;
  actionable: boolean;
  score: number;
  matchedGoldens: readonly number[];
} {
  return {
    pr: 'pr-1',
    category: 'bug',
    actionable: true,
    score: 0.5,
    matchedGoldens: [],
    ...overrides,
  } as {
    pr: string;
    category: string;
    actionable: boolean;
    score: number;
    matchedGoldens: readonly number[];
  };
}

describe('a golden is credited once, however many findings claim it', () => {
  it('counts two findings claiming one golden as one', () => {
    // **The failure this prevents is the one a greedy assignment makes invisible.** Two findings both describe the
    // defect the first golden names, and reporting two true positives for it would inflate precision by a factor the
    // cut controls rather than the corpus.
    const findings = [finding({ matchedGoldens: [0] }), finding({ matchedGoldens: [0] })];
    expect(maximumMatchingByPullRequest(findings, creditOf)).toBe(1);
  });

  it('takes the second golden when two findings can each only take the first', () => {
    // The ordinary shape of a matching: one finding may claim two goldens, the other only the contested one. **Both
    // are true positives and only an augmenting path finds that**, because the first finding has to be moved off the
    // golden the second one needs.
    const findings = [finding({ matchedGoldens: [0, 1] }), finding({ matchedGoldens: [0] })];
    expect(maximumMatchingByPullRequest(findings, creditOf)).toBe(2);
  });

  it('does not let two pull requests share goldens that happen to share an index', () => {
    // **Every pull request numbers its goldens from zero**, so a matching computed over the run would credit one
    // pull request's golden to the other's finding and report a corpus-wide total that the corpus does not hold.
    const findings = [
      finding({ pr: 'pr-1', matchedGoldens: [0] }),
      finding({ pr: 'pr-2', matchedGoldens: [0] }),
    ];
    expect(maximumMatchingByPullRequest(findings, creditOf)).toBe(2);
  });

  it('reports zero for findings no verdict allowed', () => {
    expect(maximumMatchingByPullRequest([finding(), finding()], creditOf)).toBe(0);
  });
});

describe('a cut is steps over the list, in the order it names them', () => {
  it('drops only the categories it names', () => {
    const findings = [
      finding({ category: 'test', matchedGoldens: [0] }),
      finding({ category: 'bug', matchedGoldens: [1] }),
      finding({ category: 'architecture', matchedGoldens: [2] }),
    ];
    const kept = applyCut(findings, [{ kind: 'drop', categories: ['test'] }]);
    expect(kept.map((entry) => entry.category)).toEqual(['bug', 'architecture']);
  });

  it('keeps the top of the ranking per pull request, not per run', () => {
    // **A budget is a promise about one reader reading one pull request.** Applied across the run it would hand the
    // highest-scoring pull request every slot and leave the rest with none, which is a different product.
    const findings = [
      finding({ pr: 'pr-1', score: 0.9, matchedGoldens: [0] }),
      finding({ pr: 'pr-1', score: 0.8, matchedGoldens: [1] }),
      finding({ pr: 'pr-1', score: 0.1, matchedGoldens: [2] }),
      finding({ pr: 'pr-2', score: 0.2, matchedGoldens: [3] }),
    ];
    const kept = applyCut(findings, [{ kind: 'budget', k: 1 }]);
    expect(kept.map((entry) => entry.score)).toEqual([0.9, 0.2]);
  });

  it('breaks a tie with the artifact order, so the cut is reproducible', () => {
    const findings = [
      finding({ score: 0.5, matchedGoldens: [0] }),
      finding({ score: 0.5, matchedGoldens: [1] }),
      finding({ score: 0.5, matchedGoldens: [2] }),
    ];
    expect(applyCut(findings, [{ kind: 'budget', k: 2 }])).toHaveLength(2);
    expect(applyCut(findings, [{ kind: 'budget', k: 2 }])[0]).toBe(findings[0]);
  });

  it('applies the steps in order, so dropping before a budget buys the budget back', () => {
    // **This is the composition the campaign actually needs**: a category that never converts must not spend a slot
    // a converting category could have used, and that is only true if the drop happens first.
    const findings = [
      finding({ category: 'test', score: 0.99, matchedGoldens: [] }),
      finding({ category: 'bug', score: 0.5, matchedGoldens: [0] }),
      finding({ category: 'bug', score: 0.4, matchedGoldens: [1] }),
    ];
    const ordered = applyCut(findings, [
      { kind: 'drop', categories: ['test'] },
      { kind: 'budget', k: 2 },
    ]);
    expect(ordered.map((entry) => entry.matchedGoldens)).toEqual([[0], [1]]);
    const reversed = applyCut(findings, [
      { kind: 'budget', k: 2 },
      { kind: 'drop', categories: ['test'] },
    ]);
    expect(reversed.map((entry) => entry.matchedGoldens)).toEqual([[0]]);
  });

  it('refuses a step it does not know rather than ignoring it', () => {
    // **A cut that silently ignores a step is a table about a reviewer nobody ran**, which is the failure mode this
    // whole repository's gates exist to catch.
    const unimplemented = [{ kind: 'throttle', k: 3 }] as unknown as readonly CutStep[];
    expect(() => applyCut([finding()], unimplemented)).toThrow(/unknown cut step/u);
  });
});

describe('the shipped gate is a cut like any other', () => {
  it('keeps the findings the artifact marked actionable and drops the rest', () => {
    const findings = [
      finding({ actionable: true, matchedGoldens: [0] }),
      finding({ actionable: false, matchedGoldens: [1] }),
    ];
    expect(applyCut(findings, [{ kind: 'gate' }])).toHaveLength(1);
  });
});

describe('recall divides by the corpus, not by the cut', () => {
  it('holds the denominator still when the cut shrinks', () => {
    // **The arithmetic error this pins down**: a cut that keeps one finding which hits one golden must report 1/4
    // when the corpus held four goldens, not 1/1. The second number is a precision wearing a recall's name.
    const findings = [finding({ matchedGoldens: [0] })];
    const point = score(findings, creditOf, 4);
    expect(point).toMatchObject({
      emitted: 1,
      truePositives: 1,
      falseNegatives: 3,
      precision: 1,
      recall: 0.25,
    });
    expect(point.f1).toBeCloseTo((2 * 1 * 0.25) / 1.25, 10);
  });

  it('reports zeros rather than NaN on an empty cut', () => {
    expect(score([], creditOf, 10)).toMatchObject({ emitted: 0, precision: 0, recall: 0, f1: 0 });
  });

  it('matches the corpus formula, 2PR/(P+R)', () => {
    const findings = [
      finding({ matchedGoldens: [0] }),
      finding({ matchedGoldens: [1] }),
      finding(),
      finding(),
    ];
    const point = score(findings, creditOf, 10);
    expect(point.precision).toBeCloseTo(0.5, 10);
    expect(point.recall).toBeCloseTo(0.2, 10);
    expect(point.f1).toBeCloseTo((2 * 0.5 * 0.2) / 0.7, 10);
  });
});

describe('a cut survives being written down', () => {
  it('reads back every step it can write', () => {
    expect(parseCut('gate')).toEqual([{ kind: 'gate' }]);
    expect(parseCut('drop:test,architecture')).toEqual([
      { kind: 'drop', categories: ['test', 'architecture'] },
    ]);
    expect(parseCut('budget:13')).toEqual([{ kind: 'budget', k: 13 }]);
    expect(parseCut('drop:test+budget:13')).toEqual([
      { kind: 'drop', categories: ['test'] },
      { kind: 'budget', k: 13 },
    ]);
    expect(parseCut('no rule')).toEqual([]);
    expect(parseCut('')).toEqual([]);
  });

  it('names a cut the same way the table labels it', () => {
    // **The label has to come from the cut**, because a table row whose label was typed beside its rule is a row two
    // readers can disagree about without either of them being wrong.
    expect(describeCut(parseCut('drop:test+budget:13'))).toBe('drop test, budget 13');
    expect(describeCut([])).toBe('no rule');
  });

  it('refuses a cut that names no category, no budget, or a step nobody implemented', () => {
    expect(() => parseCut('drop:')).toThrow(/names no category/u);
    expect(() => parseCut('budget:0')).toThrow(/not a budget/u);
    expect(() => parseCut('budget:twelve')).toThrow(/not a budget/u);
    expect(() => parseCut('throttle:3')).toThrow(/unknown cut step/u);
  });
});

describe('the registered table is the campaign’s hypotheses, not a search space', () => {
  it('starts with the two extremes, because a cut never compared to no cut is unpriced', () => {
    const cuts = registeredCuts([12]);
    expect(describeCut(cuts[0]!.steps)).toBe('actionability gate');
    expect(describeCut(cuts[1]!.steps)).toBe('no rule');
  });

  it('offers the profile floor’s own category sets and nothing wider', () => {
    // **The three drop sets are the registered floor's ingredients**, so every row is a row a sentence in the contract
    // can point at. A wider set would be this table fitting the corpus.
    const dropped = registeredCuts([])
      .flatMap((cut) => cut.steps.filter((step) => step.kind === 'drop'))
      .map((step) => (step.kind === 'drop' ? step.categories.join('+') : ''));
    expect(dropped).toEqual(['test', 'test+architecture', 'test+architecture+style']);
  });
});

describe('a row is fixed-width so two runs can be diffed', () => {
  it('pads the label and aligns the numbers', () => {
    const row = formatRow('no rule', {
      emitted: 1125,
      truePositives: 172,
      falsePositives: 953,
      falseNegatives: 552,
      precision: 0.1529,
      recall: 0.2376,
      f1: 0.186,
    });
    expect(row.startsWith('no rule')).toBe(true);
    expect(row).toContain(' 1125  172  0.1529  0.2376  0.1860');
  });
});

/**
 * **The table a run publishes beside its own rows**, so the cut that produced the headline figure is not the only cut
 * the artifact can answer for.
 *
 * The property that matters is **self-consistency**: every row must be the same number a reader gets by taking the
 * row's own `steps`, applying them to the same `rankedFindings`, and scoring them. A table that could not be replayed
 * from its own artifact would be a second place for a figure to live.
 */
describe('the artifact can carry the cuts it was measured at', () => {
  const rows = [
    finding({ matchedGoldens: [0], category: 'bug', score: 0.9 }),
    finding({ matchedGoldens: [], category: 'test', score: 0.5 }),
    finding({ matchedGoldens: [1], category: 'maintainability', score: 0.4 }),
  ];

  it('prints every registered cut, and the shipped gate first', () => {
    const table = operatingPointTable(rows, 4);
    expect(table.length).toBe(registeredCuts().length);
    expect(table[0]?.cut).toBe('actionability gate');
    expect(table[0]?.steps).toEqual([{ kind: 'gate' }]);
  });

  it('replays every row to its own figure, which is the only property a table has to have', () => {
    const table = operatingPointTable(rows, 4);
    for (const row of table) {
      const replayed = score(applyCut(rows, row.steps), creditOf, 4);
      expect(replayed.f1).toBeCloseTo(row.f1, 12);
      expect(replayed.truePositives).toBe(row.truePositives);
    }
  });

  it('keeps the denominator the corpus, in every row', () => {
    const table = operatingPointTable(rows, 4);
    for (const row of table) {
      expect(row.truePositives + row.falseNegatives).toBe(4);
    }
  });

  it('names each row by its cut rather than by its position', () => {
    const table = operatingPointTable(rows, 4);
    expect(new Set(table.map((row) => row.cut)).size).toBe(table.length);
  });
});

/**
 * **The artifact has to carry the table, or the only question it answers is the one it was dispatched at.**
 *
 * A library nobody calls is a library with a test file beside it, and the failure this guards is specific: the CLI
 * prints these rows, the artifact does not carry them, and a reader weeks later meets one figure with no way to ask
 * what another cut would have scored without downloading a script.
 */
describe('the artifact carries the table, not only the cut it was dispatched at', () => {
  const source = readFileSync(
    new URL('../../../.github/scripts/aacr-bench.mjs', import.meta.url),
    'utf8',
  );

  it('writes the registered cuts from the same implementation the CLI prints', () => {
    expect(source).toContain(
      "import { operatingPointTable } from '../../scripts/lib/operating-point.mjs';",
    );
    expect(source).toContain('operatingPoints: operatingPointTable(');
  });

  it('divides by the corpus the run was scored against, not by the cut', () => {
    expect(source).toMatch(
      /operatingPointTable\(\s*rankedDetail,\s*gated\.truePositives \+ gated\.falseNegatives,?\s*\)/,
    );
  });
});

/**
 * **The cut an artifact records has to survive the trip back through the parser.**
 *
 * Run `45514219220` ended red at `martian_profile` with *"the artifact does not record a cut this instrument can rebuild"*
 * - and the artifact did record one: `drop test, drop path test, budget 12`. What failed was the reader, which
 * whitelisted `drop` and `budget` and returned `null` on the third step the shipped policy has carried since §106. **The
 * message blamed the artifact for a gap in the instrument**, and it did so on the run whose whole purpose was to publish a
 * figure.
 *
 * A whitelist is the defect rather than the missing entry: `parseCut` already accepts six kinds, and the third kind will
 * not be the last - so the reader below is exhaustive over `CutStep` and the round-trip is asserted for each kind. A new
 * kind on the union without a spelling here is a type error in this test rather than a red job in fourteen minutes.
 */
describe('a cut read off the steps an artifact records', () => {
  it('spells the policy the run that failed actually shipped, and parses back to the same steps', () => {
    // The three steps are copied out of `45514219220`'s `emissionRules.shipped.steps`, not invented for the test.
    const steps: readonly CutStep[] = [
      { kind: 'drop', categories: ['test'] },
      { kind: 'drop-path-class', classes: ['test'] },
      { kind: 'budget', k: 12 },
    ];
    const cut = cutFromSteps(steps);
    expect(cut).toBe('drop:test+drop-path:test+budget:12');
    expect(parseCut(cut ?? '')).toEqual(steps);
  });

  it('round-trips every kind the parser accepts, one at a time', () => {
    const each: readonly CutStep[] = [
      { kind: 'gate' },
      { kind: 'drop', categories: ['test', 'style'] },
      { kind: 'keep-category', categories: ['bug'] },
      { kind: 'drop-path-class', classes: ['test', 'docs'] },
      { kind: 'budget', k: 6 },
      { kind: 'quota', categories: ['bug'], k: 0 },
    ];
    for (const step of each) {
      const cut = cutFromSteps([step]);
      expect(cut, `${step.kind} has no spelling`).not.toBeNull();
      expect(parseCut(cut ?? ''), `${step.kind} does not survive the trip`).toEqual([step]);
    }
  });

  it('returns null for a kind it cannot spell, rather than spelling the rest and dropping one', () => {
    // A reader that skipped the unknown step would rebuild a *different* cut and then report it as this artifact's.
    expect(
      cutFromSteps([{ kind: 'budget', k: 3 }, { kind: 'cap', k: 1 } as unknown as CutStep]),
    ).toBeNull();
  });

  it('reads an empty policy as no cut rather than as no artifact', () => {
    expect(cutFromSteps([])).toBe('no rule');
  });
});
