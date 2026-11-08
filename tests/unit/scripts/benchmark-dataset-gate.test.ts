// Benchmark dataset gate — the test that proves the gate can fail, and the one that pins the unit it counts in.
//
// The state this gate was written for: the citations file declared a minimum of 100, the suite held 49, and the
// README published figures anyway. The gate has to say "not publishable" and say why, and it has to catch a citation
// that overstates its own dataset.
//
// **And it has to count the right thing.** It counted `id:` strings, which in `benchmark-data.ts` are cases rather
// than ground-truth entries, so the suite was recorded as 15 + 34 = 49 when it is 30 + 34 = 64. Both sides of the
// comparison used the same wrong unit, so the check passed. The third test below is that defect.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/benchmark-dataset-gate.js';
/** Absolute, because the fixture runs the gate with the temporary tree as its working directory. */
const GATE_PATH = join(process.cwd(), GATE);

interface Citation {
  groundTruthIssues?: number;
  samples?: number;
  groundTruthSource?: string;
  countFrom?: string;
  datasets?: { source: string; samples: number; groundTruthIssues: number }[];
}
interface Citations {
  minimumGroundTruth: number;
  citations: Record<string, Citation>;
}

function runGate(
  citations: Citations,
  files: Record<string, string> = {},
): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'benchmark-dataset-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf-8');
  }
  const file = join(dir, 'citations.json');
  writeFileSync(file, JSON.stringify(citations, null, 2), 'utf-8');
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE_PATH, '--citations', file], {
        cwd: dir,
        encoding: 'utf-8',
      }),
      stderr: '',
    };
  } catch (err) {
    const failure = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      stdout: (failure.stdout ?? '').toString(),
      stderr: (failure.stderr ?? '').toString(),
    };
  }
}

/** A TypeScript dataset that declares its own totals, which is what the gate reads. */
const dataset = (fixtures: number, issues: number): string =>
  `export const STATS = {\n  totalFixtures: ${String(fixtures)},\n  totalGroundTruthIssues: ${String(issues)},\n};\n`;

describe('benchmark-dataset-gate', () => {
  it('reports the real dataset against the declared minimum, on this repository', () => {
    const out = execFileSync(process.execPath, [GATE, '--json'], { encoding: 'utf-8' });
    const result = JSON.parse(out) as { minimum: number; counted: number; publishable: boolean };

    // **It is still an assertion about the world, not a wish**: if the dataset falls below the minimum, this fails.
    expect(result.minimum).toBe(100);
    expect(result.counted).toBeGreaterThanOrEqual(100);
    expect(result.publishable).toBe(true);
  });

  it('counts ground-truth entries rather than `id:` strings, per dataset', () => {
    const out = execFileSync(process.execPath, [GATE, '--json'], { encoding: 'utf-8' });
    const result = JSON.parse(out) as {
      perCitation: Record<string, { counted: number; sources: string[] }>;
    };
    const suite = result.perCitation['internal-suite-2026-08'];

    // 30 in `benchmark-data.ts` (fifteen cases, two entries each) and 34 in `benchmark-fixtures.ts`. The citation
    // said 49 until this iteration, and 15 of that 49 was a case count.
    expect(suite?.counted).toBe(64);
    expect(suite?.sources).toEqual(['benchmark-data.ts=30', 'benchmark-fixtures.ts=34']);
  });

  it('reports below-minimum without failing, because a small dataset is a state rather than a defect', () => {
    // Failing CI here would leave the build permanently red until the dataset grows, and a permanently red job
    // teaches people to ignore red. The publication refusal lives in the numbers gate; this one states the fact.
    const result = runGate({
      minimumGroundTruth: 100,
      citations: {
        suite: {
          groundTruthIssues: 64,
          groundTruthSource: 'two internal datasets, counted at build time',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('below the declared minimum');
    expect(result.stdout).toContain('publishable: false');
  });

  it('fails a publication step that requires a publishable dataset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchmark-dataset-'));
    const file = join(dir, 'citations.json');
    writeFileSync(
      file,
      JSON.stringify({
        minimumGroundTruth: 100,
        citations: {
          suite: {
            groundTruthIssues: 64,
            groundTruthSource: 'two internal datasets, counted at build time',
          },
        },
      }),
      'utf-8',
    );
    expect(() =>
      execFileSync(process.execPath, [GATE_PATH, '--citations', file, '--require-publishable'], {
        encoding: 'utf-8',
      }),
    ).toThrow();
  });

  it('fails when a citation overstates the dataset it points at', () => {
    const result = runGate(
      {
        minimumGroundTruth: 10,
        citations: { suite: { groundTruthIssues: 100, countFrom: 'data/ground-truth.json' } },
      },
      { 'data/ground-truth.json': JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) },
    );

    expect(result.ok).toBe(false);
    const said = result.stderr + result.stdout;
    expect(said).toContain('its sources hold 3');
    expect(said).toContain('100');
  });

  it('fails when a citation names no countable dataset and does not say where its number came from', () => {
    const result = runGate({
      minimumGroundTruth: 10,
      citations: { elsewhere: { groundTruthIssues: 500 } },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('groundTruthSource');
  });

  it('fails when a dataset it lists declares a different size than the citation says', () => {
    const result = runGate(
      {
        minimumGroundTruth: 10,
        citations: {
          suite: {
            // The total is right and the split is wrong: 20 in each file, but the files hold 12 and 8. Only the
            // per-dataset check can catch this, which is the check the 15-beside-34 error needed.
            groundTruthIssues: 40,
            samples: 20,
            datasets: [
              { source: 'data/one.ts', samples: 10, groundTruthIssues: 20 },
              { source: 'data/two.ts', samples: 10, groundTruthIssues: 20 },
            ],
          },
        },
      },
      { 'data/one.ts': dataset(10, 12), 'data/two.ts': dataset(10, 8) },
    );

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('says `data/one.ts` holds 20');
    expect(result.stderr).toContain('it declares 12');
  });

  it('passes only when the count matches and reaches the minimum', () => {
    const result = runGate(
      {
        minimumGroundTruth: 10,
        citations: { suite: { groundTruthIssues: 12, samples: 4, countFrom: 'data/set.ts' } },
      },
      { 'data/set.ts': dataset(4, 12) },
    );

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('is what the citation says it is');
  });

  it('**fails when a listed dataset exists but declares no total**, which is what a generated corpus does', () => {
    // The state that turned `Coverage Gate` red on the permission arm: `agentic-permissions` pointed at
    // `agentic/permissions.ts`, the file existed, and it declared nothing - so the gate counted 0, recorded
    // `publishable: false`, and failed. The refusal was right. A corpus written at run time has no directory of
    // samples to count, and a number nobody can verify is exactly what this gate exists to refuse.
    const result = runGate(
      {
        minimumGroundTruth: 100,
        citations: {
          suite: {
            groundTruthIssues: 100,
            samples: 100,
            datasets: [{ source: 'data/corpus.ts', samples: 100, groundTruthIssues: 100 }],
          },
        },
      },
      // An array with a hundred entries and no declaration is still nothing the gate can read.
      {
        'data/corpus.ts': 'export const CORPUS = [\n'.concat('  {},\n'.repeat(100)).concat('];\n'),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('declares no `totalGroundTruthIssues`');
  });

  it('**accepts a generated corpus that declares its size**, so the fix for the above is a declaration', () => {
    // The declaration is not a loosening: `permissions.test.ts` recomputes it from `CORPUS` and fails when they
    // disagree, so the gate reads a number that a test has already proved. Without that test this shape would be a
    // downgrade from counting files to believing a constant.
    const result = runGate(
      {
        minimumGroundTruth: 100,
        citations: {
          suite: {
            groundTruthIssues: 100,
            samples: 100,
            datasets: [{ source: 'data/corpus.ts', samples: 100, groundTruthIssues: 100 }],
          },
        },
      },
      {
        'data/corpus.ts': 'export const CORPUS = [];\n'.concat(
          'export const STATS = { totalCases: 100, totalGroundTruthIssues: 100 };\n',
        ),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('corpus.ts=100');
  });
});
