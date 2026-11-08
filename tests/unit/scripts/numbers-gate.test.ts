// numbers gate — the tests that prove it can fail, and the one that proves it is no longer vacuous.
//
// The gate this replaces ended with a test asserting `nothing published, nothing to verify`, which is the message it
// printed on every run for as long as the withdrawn figures stood in `docs/`. That test was green and the repository
// was wrong, so the cases below are written the other way round: each one names a failure the gate must produce, and
// the last one asserts that the gate found something to judge.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const GATE = 'scripts/numbers-gate.js';
const REPO = process.cwd();

interface Citation {
  artifact?: string | null;
  groundTruthIssues?: number;
  independentValidation?: boolean;
  metrics?: Record<string, number>;
}

interface Fixture {
  /** Markdown files, keyed by path relative to the temporary root. */
  readonly files: Record<string, string>;
  /** Citations written to `benchmarks/citations.json` unless a `citations` string is given. */
  readonly citations?: { minimumGroundTruth: number; citations: Record<string, Citation> };
  /** Files created so that an artifact path resolves. */
  readonly artifacts?: readonly string[];
  /** A symlink from `at` to `target`, to exercise the deduplication. */
  readonly link?: { at: string; target: string };
}

function run(fixture: Fixture, extraArgs: readonly string[] = []): { ok: boolean; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'numbers-gate-'));
  for (const [path, body] of Object.entries(fixture.files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf-8');
  }
  for (const path of fixture.artifacts ?? []) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '{}', 'utf-8');
  }
  mkdirSync(join(root, 'benchmarks'), { recursive: true });
  writeFileSync(
    join(root, 'benchmarks/citations.json'),
    JSON.stringify(
      fixture.citations ?? {
        minimumGroundTruth: 100,
        citations: {
          strong: { artifact: 'benchmarks/strong.json', groundTruthIssues: 500 },
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  if (fixture.link) {
    const at = join(root, fixture.link.at);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(fixture.link.target, at);
  }
  const args = [
    join(REPO, GATE),
    '--citations',
    join(root, 'benchmarks/citations.json'),
    ...extraArgs,
  ];
  try {
    return {
      ok: true,
      out: execFileSync(process.execPath, args, { cwd: root, encoding: 'utf-8' }),
    };
  } catch (error) {
    const failure = error as { stdout?: Buffer | string; stderr?: string };
    return { ok: false, out: `${String(failure.stdout ?? '')}${String(failure.stderr ?? '')}` };
  }
}

const withdrawnCitations = {
  minimumGroundTruth: 100,
  citations: {
    weak: {
      artifact: 'benchmarks/weak.json',
      groundTruthIssues: 49,
      metrics: { precision: 0.794, recall: 0.73, f1: 0.761 },
    },
    strong: { artifact: 'benchmarks/strong.json', groundTruthIssues: 500 },
  },
};

describe('numbers-gate — a withdrawn value may not be restated', () => {
  it('fails when a document outside the publishing set restates one', () => {
    // The incident: `docs/BENCHMARK_REPORT.md` went on printing 79.4 % after README withdrew it.
    const result = run({
      files: { 'docs/notes.md': '| **Precision** | 79.4 % |\n| **F1** | 0.761 |\n' },
      citations: withdrawnCitations,
      artifacts: ['benchmarks/weak.json', 'benchmarks/strong.json'],
    });

    expect(result.ok).toBe(false);
    expect(result.out).toContain('restates `79.4 %`');
    expect(result.out).toContain('`weak`');
  });

  it('fails on the percentage form of a withdrawn proportion, and on the decimal form', () => {
    const asPercent = run({
      files: { 'docs/notes.md': 'Recall is 73 % on this suite.\n' },
      citations: withdrawnCitations,
      artifacts: ['benchmarks/weak.json', 'benchmarks/strong.json'],
    });
    const asDecimal = run({
      files: { 'docs/notes.md': 'Recall is 0.73 on this suite.\n' },
      citations: withdrawnCitations,
      artifacts: ['benchmarks/weak.json', 'benchmarks/strong.json'],
    });

    expect(asPercent.ok).toBe(false);
    expect(asDecimal.ok).toBe(false);
  });

  it('does not confuse a count with a rate of the same digits', () => {
    // `trace 73/73` is a count of call paths; `73 %` is the withdrawn recall. A gate that cannot tell them apart
    // fails on the cross-repository paragraph and gets switched off, which is worse than not having it.
    const result = run(
      {
        files: { 'docs/notes.md': 'The trace is 73/73 and the impact set is 49/49, recall 1.0.\n' },
        citations: withdrawnCitations,
        artifacts: ['benchmarks/weak.json', 'benchmarks/strong.json'],
      },
      ['--min-claims', '1'],
    );

    expect(result.ok).toBe(true);
  });

  it('passes when the line says the figure is withheld', () => {
    const result = run(
      {
        files: {
          'docs/notes.md':
            '| **Precision** | 79.4 % | — withheld, the suite is below the floor |\n',
        },
        citations: withdrawnCitations,
        artifacts: ['benchmarks/weak.json', 'benchmarks/strong.json'],
      },
      ['--min-claims', '1'],
    );

    expect(result.ok).toBe(true);
  });

  it('passes when the line states the floor instead of the word', () => {
    const result = run(
      {
        files: {
          'docs/notes.md':
            'Recall 0.73 on ninety-nine questions, below the publication floor, is a composition\n',
        },
        citations: withdrawnCitations,
        artifacts: ['benchmarks/weak.json', 'benchmarks/strong.json'],
      },
      ['--min-claims', '1'],
    );

    expect(result.ok).toBe(true);
  });
});

describe('numbers-gate — a publishing document names its sources', () => {
  it('fails on README figures with no declaration', () => {
    const result = run({
      files: { 'README.md': '## Benchmarks\n\nF1 0.217 over a hundred fixes, precision 0.148.\n' },
      artifacts: ['benchmarks/strong.json'],
    });

    expect(result.ok).toBe(false);
    expect(result.out).toContain('declares no source');
  });

  it('fails when a declaration names a citation that does not exist', () => {
    const result = run({
      files: {
        'README.md': '<!-- figures: citations:ghost -->\n\nF1 0.217 over a hundred fixes.\n',
      },
      artifacts: ['benchmarks/strong.json'],
    });

    expect(result.ok).toBe(false);
    expect(result.out).toContain('`citations:ghost`, which is not in');
  });

  it('fails when the artifact behind a declared citation is missing', () => {
    const result = run({
      files: {
        'README.md': '<!-- figures: citations:strong -->\n\nF1 0.217 over a hundred fixes.\n',
      },
      // `benchmarks/strong.json` is deliberately not created.
    });

    expect(result.ok).toBe(false);
    expect(result.out).toContain('does not exist');
  });

  it('passes when every declared citation resolves to an artifact that exists', () => {
    const result = run(
      {
        files: {
          'README.md': '<!-- figures: citations:strong -->\n\nF1 0.217 over a hundred fixes.\n',
        },
        artifacts: ['benchmarks/strong.json'],
      },
      ['--min-claims', '1'],
    );

    expect(result.ok).toBe(true);
  });
});

describe('numbers-gate — a check that finds nothing is not a check that passed', () => {
  it('fails when the tree holds fewer figure lines than the floor', () => {
    const result = run({ files: { 'README.md': '# Nothing measured here.\n' } }, [
      '--min-claims',
      '20',
    ]);

    expect(result.ok).toBe(false);
    expect(result.out).toContain('a check that finds nothing is not a check that passed');
  });

  it('counts a symlinked document once', () => {
    // `docs/guide/*.md` are symlinks into `docs/`. Reading one twice would report every failure twice and inflate the
    // count that the floor is computed from.
    const result = run(
      {
        files: { 'docs/a.md': 'precision 0.9 and recall 0.8 over a hundred cases.\n' },
        link: { at: 'docs/guide/a.md', target: '../a.md' },
      },
      ['--min-claims', '1', '--json'],
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.out)).toMatchObject({ scanned: 1, documents: 1 });
  });
});

describe('numbers-gate — the repository', () => {
  it('is not vacuous: it scans figures and finds no withdrawn value', () => {
    const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: 'utf-8' });

    const scanned = /^✅ (\d+) figure lines across (\d+) documents/.exec(out);
    expect(scanned).not.toBeNull();
    expect(Number(scanned?.[1] ?? 0)).toBeGreaterThanOrEqual(20);
  });

  it('agrees with the citations file about which citations are withdrawn', () => {
    const out = execFileSync(process.execPath, [GATE, '--json'], { cwd: REPO, encoding: 'utf-8' });
    const report = JSON.parse(out) as { withdrawn: number; failures: string[] };

    // Two citations sit below the floor: the internal suite (3 metrics × 2 written forms = 6) and the paraphrase
    // corpus (4 metrics × 2 = 8). Pinned rather than computed, so that a citation crossing the floor or falling under
    // it is a change someone had to make deliberately.
    expect(report.withdrawn).toBe(14);
    expect(report.failures).toEqual([]);
  });
});
