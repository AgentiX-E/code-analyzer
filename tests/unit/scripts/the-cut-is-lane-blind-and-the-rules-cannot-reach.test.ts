// **Two instruments, one question: is anything left upstream of the cut?**
//
// `§173.2` excluded the cut and the score terms and left detection. These two scripts test the two hypotheses that were
// still open - that the cut is *lane-blind*, and that a deterministic lane could reach the maintainability goldens the
// model misses. **Both answers are negative, and a negative answer is only worth publishing if the instrument that
// produced it can be wrong in a way somebody would notice** - so every case here is about a refusal or an arithmetic
// identity rather than about a number.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function run(script: string, args: string[], cwd = ROOT): { code: number; out: string } {
  try {
    const out = execFileSync('node', [join(ROOT, 'scripts', script), ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function write(name: string, value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'lane-budget-'));
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/** A finding, in the shape the artifact publishes: `score` is a number or an object, and both are read. */
function finding(
  pr: string,
  lane: string,
  startLine: number,
  score: number,
  matchedGoldens: number[],
): Record<string, unknown> {
  return {
    pr,
    path: 'src/a.ts',
    startLine,
    endLine: startLine,
    lane,
    category: 'bug',
    score,
    matchedGoldens,
  };
}

/**
 * **Two pull requests, two lanes, and one budget of two.**
 *
 * `architecture` floods - three findings on each pull request, one of them credited - and `security` files one credited
 * finding each. **A global budget of two keeps the two highest scores, which are both architecture**; a lane-fair budget
 * would keep one of each. The fixture is small enough that the arithmetic can be checked by hand, which is the only way
 * a table about allocations can be trusted.
 */
function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    truePositives: 4,
    falseNegatives: 6,
    emissionRules: {
      shipped: {
        steps: [
          { kind: 'drop', categories: ['test'] },
          { kind: 'budget', k: 2 },
        ],
        point: { k: 2 },
      },
    },
    rankedFindings: [
      finding('https://example.test/a/pull/1', 'architecture', 10, 0.9, [0]),
      finding('https://example.test/a/pull/1', 'architecture', 20, 0.8, []),
      finding('https://example.test/a/pull/1', 'architecture', 30, 0.7, [1]),
      finding('https://example.test/a/pull/1', 'security', 40, 0.6, [2]),
      finding('https://example.test/a/pull/2', 'architecture', 10, 0.9, [0]),
      finding('https://example.test/a/pull/2', 'architecture', 20, 0.8, []),
      finding('https://example.test/a/pull/2', 'security', 40, 0.6, [1]),
    ],
    ...overrides,
  };
}

describe('the cut’s per-lane cost is a number, not an impression', () => {
  it('reports the shipped point, and every lane’s emitted, credited and lost counts', () => {
    const { code, out } = run('lane-budget.mjs', [write('a.json', artifact())]);
    expect(code).toBe(0);
    // **Architecture loses four of its five credited rows to the budget** and security keeps both of its own: the
    // flooding lane takes the slots, which is the hypothesis the script exists to test.
    expect(out).toContain('architecture');
    expect(out).toContain('security');
    // **Architecture emits five, credits three, keeps four, and loses one; security credits two and keeps none.** The
    // global order puts architecture's 0.9 and 0.8 in both slots of both pull requests, and a 0.6 that is the only
    // credited finding of its lane never reaches a reader - which is the hypothesis, visible in two rows.
    expect(out).toMatch(/architecture\s+5\s+3\s+4\s+2\s+1/);
    expect(out).toMatch(/security\s+2\s+2\s+0\s+0\s+2/);
    // The shipped point, recomputed from the artifact's own steps.
    expect(out).toMatch(/shipped\s+emitted 4\s+tp 2/);
  });

  it('prices four allocations at the same emission, and says which is best', () => {
    const { code, out } = run('lane-budget.mjs', [write('a.json', artifact())]);
    expect(code).toBe(0);
    for (const label of [
      'shipped',
      'unbudgeted',
      'per-lane budget 1',
      'per-lane budget 2',
      'floor 1 + budget 2',
    ]) {
      expect(out).toContain(label);
    }
    // **The best allocation is named rather than left to the reader**, because the claim in the document is a comparison
    // and a table nobody totals is a table two people can read differently.
    expect(out).toMatch(/the best allocation is `[^`]+` at \d\.\d{4}/);
  });

  it('applies the drop steps to every allocation, not only to the shipped one', () => {
    // `testing` floods here and the shipped cut drops the category outright. **An unbudgeted arm without the drop would
    // be buying a different pool and crediting itself for the difference** - the confound the script's own docstring
    // names, and this is the case that holds it.
    const withTest = artifact({
      rankedFindings: [
        ...(artifact()['rankedFindings'] as Record<string, unknown>[]),
        { ...finding('https://example.test/a/pull/1', 'testing', 50, 0.99, [3]), category: 'test' },
      ],
    });
    const { code, out } = run('lane-budget.mjs', [write('a.json', withTest)]);
    expect(code).toBe(0);
    // **The un-budgeted row is the pool after the drop**, so the 0.99 `testing` row is not in it: seven rows, not eight.
    expect(out).toMatch(/unbudgeted\s+7\s+5/);
  });
});

describe('the lane table refuses an artifact it cannot decompose', () => {
  it('refuses an artifact with no shipped cut', () => {
    const { code, out } = run('lane-budget.mjs', [
      write('a.json', artifact({ emissionRules: {} })),
    ]);
    expect(code).toBe(2);
    expect(out).toContain('does not publish its shipped cut');
  });

  it('refuses an artifact whose golden total is not a total', () => {
    const { code, out } = run('lane-budget.mjs', [
      write('a.json', artifact({ truePositives: 0, falseNegatives: 0 })),
    ]);
    expect(code).toBe(2);
    expect(out).toContain('no denominator to score against');
  });

  it('refuses an artifact that ranks nothing', () => {
    const { code, out } = run('lane-budget.mjs', [
      write('a.json', artifact({ rankedFindings: [] })),
    ]);
    expect(code).toBe(2);
    expect(out).toContain('ranks no rows');
  });
});

describe('a deterministic lane’s reach is priced against the corpus, not against its own intentions', () => {
  it('refuses a slice with no goldens to reach', () => {
    const directory = mkdtempSync(join(tmpdir(), 'idiom-reach-'));
    const corpus = write('corpus.json', [
      { githubPrUrl: 'https://github.com/o/r/pull/1', comments: [] },
    ]);
    const { code, out } = run('idiom-reach.mjs', ['--corpus', corpus, '--patches', directory]);
    expect(code).toBe(2);
    expect(out).toContain('there is nothing to price');
  });

  it('does not count a pull request it could not read as one it found nothing in', () => {
    // **A hole is printed, not skipped** (§147.3 applied to an instrument): the corpus asked about this pull request and
    // no diff was read for it, so the figure is over a slice that is smaller than the run's and says so.
    const directory = mkdtempSync(join(tmpdir(), 'idiom-reach-'));
    const corpus = write('corpus.json', [
      {
        githubPrUrl: 'https://github.com/example/absent/pull/9',
        comments: [{ category: 'Code Defect' }],
      },
    ]);
    const { code, out } = run('idiom-reach.mjs', ['--corpus', corpus, '--patches', directory]);
    expect(code).toBe(2);
    expect(out).toContain('no diff could be read');
  });
});

describe('the page draws the record and computes nothing', () => {
  /** A record whose lanes add up, which is the smallest page the renderer can be asked to draw. */
  function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 'lane-budget-v1',
      source: 'benchmarks/example.json',
      rankedRows: 3,
      goldens: 10,
      shipped: {
        steps: [{ kind: 'budget', k: 2 }],
        emitted: 2,
        truePositives: 1,
        precision: 0.5,
        recall: 0.1,
        f1: 0.1667,
      },
      lanes: [{ lane: 'security', emitted: 3, credited: 1, kept: 2, keptCredited: 1 }],
      allocations: [
        { label: 'shipped', emitted: 2, truePositives: 1, f1: 0.1667, delta: 0 },
        { label: 'per-lane budget 1', emitted: 1, truePositives: 1, f1: 0.1818, delta: 0.0151 },
      ],
      best: { label: 'per-lane budget 1', f1: 0.1818, delta: 0.0151 },
      ...overrides,
    };
  }

  it('draws both tables, the best tag, and the source it read', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lane-budget-page-'));
    const out = join(directory, 'page.html');
    const { code, out: stdout } = run('lane-budget-page.mjs', [
      '--record',
      write('r.json', record()),
      '--out',
      out,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('page.html');
    const html = readFileSync(out, 'utf8');
    expect(html).toContain('Who takes the budget');
    expect(html).toContain('security');
    expect(html).toContain('per-lane budget 1');
    expect(html).toContain('best');
    expect(html).toContain('benchmarks/example.json');
    // **No script and no network**: a page that fetched anything would be a page whose figure could change after it was
    // quoted, which is the reason every rendering in this repository is generated from a committed record.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
  });

  it('refuses a version it does not read, and lanes that do not add up to their own total', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lane-budget-page-'));
    const out = join(directory, 'page.html');
    const unknown = run('lane-budget-page.mjs', [
      '--record',
      write('r.json', record({ version: 'lane-budget-v0' })),
      '--out',
      out,
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.out).toContain('this page reads v1');

    // A lane table that claims fewer credited rows than the point it decomposes is a table about other rows; the page
    // refuses it rather than drawing a picture of it.
    const short = run('lane-budget-page.mjs', [
      '--record',
      write(
        'r.json',
        record({ shipped: { ...(record()['shipped'] as object), truePositives: 2 } }),
      ),
      '--out',
      out,
    ]);
    expect(short.code).toBe(1);
    expect(short.out).toContain('credited rows kept against');
  });
});
