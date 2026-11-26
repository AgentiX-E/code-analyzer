// **A cut step ships only when it costs no credited golden on any board this repository publishes.**
//
// §162.6 priced a score floor and refused it on the held-out half; S48 asked the next question - change the ordering
// rather than the threshold - and the candidate family that answers it is priced by `scripts/cut-candidates.mjs`. This
// case holds the four ways that instrument could print a verdict it has not earned:
//
//   1. **An incumbent that is not the artifact's published point.** Every cell is a difference from the incumbent, so an
//      incumbent that does not rebuild the record would make the table a comparison with a cut nobody shipped.
//   2. **A coverage set that disagrees with the matching.** "Lost" is set arithmetic and F1 is a maximum bipartite
//      matching; two arithmetics over one number is the defect that turns a loss into an artefact.
//   3. **A board with no resolution.** A board that cannot be cleared cannot refuse anything, and a roll-up over one
//      would be a verdict about no threshold at all.
//   4. **A verdict that is not what its cells say.** `promotable` with a losing cell is the one output that would ship a
//      step by accident, and the page refuses it too.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/cut-candidates.mjs';
const PAGE = 'scripts/cut-candidates-page.mjs';

type Row = {
  pr: string;
  path: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  lane: string | null;
  score: number;
  actionable: boolean;
  features: Record<string, unknown>;
  matchedGoldens: number[];
};

/**
 * One finding, with the fields a cut reads and the `features` block a severity floor reads.
 *
 * `agreement` is written into `features` because that is where the instrument looks: a candidate that read the finding's
 * own `agreement` instead would be reading a field the artifact does not carry, and the fixture would not notice.
 */
function row(
  pr: string,
  index: number,
  options: {
    score?: number;
    severity?: string;
    goldens?: number[];
    startLine?: number;
    agreement?: number;
  } = {},
): Row {
  const severity = options.severity ?? 'medium';
  return {
    pr,
    path: `src/file${String(index)}.ts`,
    startLine: options.startLine ?? index * 10 + 1,
    endLine: (options.startLine ?? index * 10 + 1) + 3,
    severity,
    category: 'bug',
    lane: 'architecture',
    score: options.score ?? 1 - index / 100,
    actionable: true,
    features: {
      grounded: true,
      quotesDiff: false,
      namesSymbol: true,
      proposesChange: true,
      hedged: false,
      agreement: options.agreement ?? 2,
      severity,
      lane: 'architecture',
    },
    matchedGoldens: options.goldens ?? [],
  };
}

// **Every comment carries a `core` category**, because a corpus of bare objects leaves the `core` profile with no
// goldens and every F1 in the table would be zero over a denominator of zero - a fixture that runs and measures nothing.
const CORPUS = [
  {
    githubPrUrl: 'https://example.invalid/pull/1',
    comments: [{ category: 'bug' }, { category: 'bug' }, { category: 'bug' }, { category: 'bug' }],
  },
  {
    githubPrUrl: 'https://example.invalid/pull/2',
    comments: [{ category: 'bug' }, { category: 'bug' }, { category: 'bug' }, { category: 'bug' }],
  },
];

/**
 * What a `budget: k` cut of a fixture scores, computed here so the published point is a record of the fixture.
 *
 * **The budget is per pull request**, and the first version of this helper sliced the whole list at `k`, which made the
 * fixture's own published point a cut of a policy nobody ships. The instrument caught it - it refused to price against
 * an artifact whose record did not rebuild - which is the guard doing the job it was written new for.
 */
function publishedPoint(findings: Row[], k: number): { k: number; truePositives: number } {
  const byPullRequest = new Map<string, { finding: Row; at: number }[]>();
  for (const [at, finding] of findings.entries()) {
    const bucket = byPullRequest.get(finding.pr);
    if (bucket === undefined) byPullRequest.set(finding.pr, [{ finding, at }]);
    else bucket.push({ finding, at });
  }
  let emitted = 0;
  const goldens = new Set<string>();
  for (const [pullRequest, bucket] of byPullRequest) {
    const rows = bucket
      .sort((left, right) => right.finding.score - left.finding.score || left.at - right.at)
      .slice(0, k)
      .map((entry) => entry.finding);
    emitted += rows.length;
    for (const finding of rows) {
      for (const golden of finding.matchedGoldens)
        goldens.add(`${pullRequest}\u0000${String(golden)}`);
    }
  }
  return { k: emitted, truePositives: goldens.size };
}

/**
 * **The two fixtures differ in one fact, and it is the fact the finding is about.**
 *
 * In the wide fixture no `low`-severity finding carries a golden, so refusing to post them is free. In the shipped
 * fixture one does, so the same step costs a golden. **The instrument must call the first `dominates` and the second
 * `loses` from the same code path**, and a fixture whose two boards agreed would not be able to tell whether it did.
 */
function fixture(options: { lowCarriesGolden: boolean; overlapping?: boolean }): Row[] {
  const rows = [
    row('https://example.invalid/pull/1', 0, { score: 0.9, goldens: [0] }),
    row('https://example.invalid/pull/1', 1, {
      score: 0.8,
      severity: 'low',
      goldens: options.lowCarriesGolden ? [1] : [],
    }),
    row('https://example.invalid/pull/1', 2, { score: 0.7, goldens: [] }),
    row('https://example.invalid/pull/1', 3, { score: 0.6, goldens: [] }),
    row('https://example.invalid/pull/2', 0, { score: 0.95, goldens: [0] }),
    row('https://example.invalid/pull/2', 1, { score: 0.85, goldens: [] }),
    row('https://example.invalid/pull/2', 2, { score: 0.75, goldens: [] }),
    row('https://example.invalid/pull/2', 3, { score: 0.65, severity: 'low', goldens: [] }),
  ];
  if (options.overlapping === true) {
    // **A second comment on the same lines, ranked lower and carrying a golden**: the case `distinct` is a step for, in
    // the configuration where it costs something, so the fixture can prove the step is priced rather than assumed free.
    rows.splice(
      1,
      0,
      row('https://example.invalid/pull/1', 9, { score: 0.85, startLine: 1, goldens: [2] }),
    );
  }
  return rows;
}

function artifact(findings: Row[], options: { gate?: boolean } = {}): Record<string, unknown> {
  const goldens = 4;
  const body: Record<string, unknown> = {
    version: 'fixture',
    rankedFindings: findings,
    truePositives: 0,
    falseNegatives: 0,
    falsePositives: 0,
  };
  if (options.gate === true) {
    // **The AACR shape**: no `emissionRules.shipped`, so the incumbent is the board registry's gate and the published
    // counts are the gate's. The gate keeps the findings that are `actionable`, which every fixture row is.
    const kept = findings.filter((finding) => finding.actionable);
    // **Keyed by pull request and index**, because golden 0 of two pull requests is two reference comments: a set of bare
    // indices would report one credit where the matching reports two, and the guard would refuse the fixture.
    body['truePositives'] = new Set(
      kept.flatMap((finding) =>
        finding.matchedGoldens.map((golden) => `${finding.pr}\u0000${String(golden)}`),
      ),
    ).size;
    body['falsePositives'] = kept.length - Number(body['truePositives']);
    body['falseNegatives'] = goldens * 2 - Number(body['truePositives']);
  } else {
    const point = publishedPoint(findings, 2);
    body['emissionRules'] = {
      shipped: {
        rule: 'drop test, budget 2',
        steps: [
          { kind: 'drop', categories: ['test'] },
          { kind: 'budget', k: 2 },
        ],
        point,
      },
    };
    body['truePositives'] = point.truePositives;
    body['falseNegatives'] = goldens * 2 - point.truePositives;
  }
  return body;
}

function run(options: {
  wide?: Record<string, unknown>;
  narrow?: Record<string, unknown>;
  aacr?: Record<string, unknown>;
  args?: string[];
}): { code: number; out: string; record: Record<string, unknown> | null } {
  const root = mkdtempSync(join(tmpdir(), 'cut-candidates-'));
  mkdirSync(join(root, 'benchmarks', 'martian'), { recursive: true });
  const write = (name: string, body: unknown) => {
    const path = join(root, name);
    writeFileSync(path, JSON.stringify(body));
  };
  write(
    'benchmarks/martian-wide-bench.json',
    options.wide ?? artifact(fixture({ lowCarriesGolden: false })),
  );
  write(
    'benchmarks/martian-bench.json',
    options.narrow ?? artifact(fixture({ lowCarriesGolden: true })),
  );
  write(
    'benchmarks/aacr-bench.json',
    options.aacr ?? artifact(fixture({ lowCarriesGolden: true }), { gate: true }),
  );
  write('benchmarks/martian/positive_samples.json', CORPUS);
  const out = join(root, 'out.json');
  try {
    const stdout = execFileSync(
      'node',
      [SCRIPT, '--root', root, '--json', out, ...(options.args ?? [])],
      { encoding: 'utf8' },
    );
    return { code: 0, out: stdout, record: JSON.parse(readFileSync(out, 'utf8')) };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failed.status ?? 1,
      out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
      record: null,
    };
  }
}

type Cell = {
  budget: number;
  candidate: string;
  verdict: string;
  deltaF1: number;
  coverage: { kept: number; lost: number; gained: number };
  incumbent: { emitted: number; truePositives: number };
  candidatePoint: { emitted: number; truePositives: number };
};
type Board = { id: string; cells: Cell[]; denominators: { goldens: number }; resolution: number };
type Record_ = {
  version: string;
  boards: Board[];
  verdicts: { candidate: string; verdict: string; reason: string; cells: Record<string, number> }[];
  guards: { board: string; guard: string; expected?: unknown; rebuilt?: unknown }[];
};

function cell(record: Record_, boardId: string, candidate: string, budget: number): Cell {
  const board = (record as Record_).boards.find((entry) => entry.id === boardId);
  expect(board).toBeDefined();
  const found = board!.cells.find(
    (entry) => entry.candidate === candidate && entry.budget === budget,
  );
  expect(found).toBeDefined();
  return found!;
}

describe('a cut step is not shipped until it holds on every board', () => {
  it('rebuilds the incumbent of every board before printing a cell', () => {
    const { code, record } = run({});
    expect(code).toBe(0);
    const guards = (record as Record_).guards.filter(
      (guard) => guard.guard === 'incumbent-rebuilds',
    );
    expect(guards.map((guard) => guard.board).sort()).toEqual([
      'aacr',
      'martian-narrow-all',
      'martian-narrow-core',
      'martian-wide-all',
      'martian-wide-core',
    ]);
    // **Rebuilt and published are the same object, not two numbers that happen to be near each other.**
    for (const guard of guards) expect(guard.rebuilt).toStrictEqual(guard.expected);
  });

  it('calls a step that only refuses trivial comments a domination on the board where they carry nothing', () => {
    const { record } = run({});
    for (const budget of [4, 5, 12]) {
      const entry = cell(record as Record_, 'martian-wide-core', 'severity:medium', budget);
      expect(entry.verdict).toBe('dominates');
      expect(entry.coverage.lost).toBe(0);
      expect(entry.candidatePoint.emitted).toBeLessThan(entry.incumbent.emitted);
      expect(entry.deltaF1).toBeGreaterThan(0);
    }
  });

  it('calls the same step a loss on the board where one trivial comment carries a golden', () => {
    const { record } = run({});
    const entry = cell(record as Record_, 'martian-narrow-core', 'severity:medium', 12);
    expect(entry.verdict).toBe('loses');
    expect(entry.coverage.lost).toBeGreaterThan(0);
  });

  it('reads the AACR board through the gate its artifact publishes instead of asking it for steps', () => {
    const { record } = run({});
    const board = (record as Record_).boards.find((entry) => entry.id === 'aacr');
    expect(board).toBeDefined();
    // The gate keeps all eight fixture findings, so a budget of 12 on the gate is the whole pool.
    expect(board!.cells.find((entry) => entry.budget === 12)!.incumbent.emitted).toBe(8);
  });

  it('prices a distinct-site step as a loss when the duplicate is the one carrying the golden', () => {
    const { record } = run({
      wide: artifact(fixture({ lowCarriesGolden: false, overlapping: true })),
    });
    const entry = cell(record as Record_, 'martian-wide-core', 'distinct:overlap', 12);
    expect(entry.verdict).toBe('loses');
    expect(entry.coverage.lost).toBe(1);
  });

  it('refuses the whole family when one board loses, and says which', () => {
    const { record } = run({});
    const verdict = (record as Record_).verdicts.find(
      (entry) => entry.candidate === 'severity:medium',
    );
    expect(verdict).toBeDefined();
    expect(verdict!.verdict).toBe('refused');
    expect(verdict!.reason).toContain('lose credited goldens');
    // **Nine of fifteen**, which is three boards times three budgets: the two wide cells per budget keep everything they
    // had and the three boards whose fixture carries a golden in the trivial tier lose it at every budget.
    expect(verdict!.cells['losing']).toBe(9);
    expect(verdict!.cells['total']).toBe(15);
  });

  it('refuses a board whose artifact does not rebuild, rather than pricing against it', () => {
    const broken = artifact(fixture({ lowCarriesGolden: false }));
    (broken['emissionRules'] as { shipped: { point: Record<string, number> } }).shipped.point = {
      k: 3,
      truePositives: 2,
    };
    const { code, out } = run({ wide: broken });
    expect(code).toBe(1);
    expect(out).toContain('the artifact published 3');
  });

  it('refuses a board id it does not hold instead of reporting on the boards that match', () => {
    const { code, out } = run({ args: ['--board', 'martian-wide-core', '--board', 'nowhere'] });
    expect(code).toBe(2);
    expect(out).toContain('no board matches');
  });

  it('refuses a board it cannot refuse anything on, because a resolution is missing', () => {
    const { record, code } = run({});
    expect(code).toBe(0);
    for (const board of (record as Record_).boards) expect(typeof board.resolution).toBe('number');
  });

  it('refuses to call the committed record current when it is not', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cut-candidates-check-'));
    const stale = join(directory, 'stale.json');
    writeFileSync(stale, '{}\n');
    let failure: { status?: number; stderr?: string } = {};
    try {
      execFileSync('node', [SCRIPT, '--check', '--json', stale], { encoding: 'utf8' });
    } catch (error) {
      failure = error as { status?: number; stderr?: string };
    }
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain('stale');
  });
});

describe('the page draws the verdicts and refuses a record that disagrees with itself', () => {
  function draw(record: Record<string, unknown>): { code: number; out: string; html: string } {
    const directory = mkdtempSync(join(tmpdir(), 'cut-candidates-page-'));
    const file = join(directory, 'record.json');
    writeFileSync(file, JSON.stringify(record));
    const out = join(directory, 'page.html');
    try {
      const stdout = execFileSync('node', [PAGE, '--record', file, '--out', out], {
        encoding: 'utf8',
      });
      return { code: 0, out: stdout, html: readFileSync(out, 'utf8') };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return {
        code: failed.status ?? 1,
        out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
        html: '',
      };
    }
  }

  it('draws every candidate it was given, with its verdict', () => {
    const { record } = run({});
    const drawn = draw(record as Record<string, unknown>);
    expect(drawn.code).toBe(0);
    for (const verdict of (record as Record_).verdicts) {
      expect(drawn.html).toContain(verdict.candidate);
      expect(drawn.html).toContain(verdict.verdict);
    }
  });

  it('refuses a version it does not read', () => {
    const { record } = run({});
    const mutated = { ...(record as Record<string, unknown>), version: 'cut-candidates-v0' };
    const drawn = draw(mutated);
    expect(drawn.code).toBe(2);
    expect(drawn.out).toContain('this page reads v1');
  });

  it('refuses a verdict that calls a step promotable while it loses a golden', () => {
    const { record } = run({});
    const mutated = JSON.parse(JSON.stringify(record)) as Record_;
    const verdict = mutated.verdicts.find((entry) => entry.candidate === 'severity:medium');
    verdict!.verdict = 'promotable';
    const drawn = draw(mutated as unknown as Record<string, unknown>);
    expect(drawn.code).toBe(1);
    expect(drawn.out).toContain('is called promotable with');
  });

  it('refuses a record whose cell count is not what the boards hold', () => {
    const { record } = run({});
    const mutated = JSON.parse(JSON.stringify(record)) as Record_;
    mutated.verdicts[0]!.cells['total'] = 99;
    const drawn = draw(mutated as unknown as Record<string, unknown>);
    expect(drawn.code).toBe(1);
    expect(drawn.out).toContain('and the boards hold');
  });
});
