// README number gate — the test that proves the gate can fail.
//
// The published table this gate was written for carried 13 uncited numbers, so the gate failing on the current
// README is the first thing it did; that run is recorded in the commit. These cases keep it failing correctly
// when the table comes back.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/readme-numbers-gate.js';

interface Citation {
  artifact?: string | null;
  groundTruthIssues?: number;
  independentValidation?: boolean;
}
interface Citations {
  minimumGroundTruth: number;
  citations: Record<string, Citation>;
}

function runGate(
  markdown: string,
  citations: Citations,
): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'readme-numbers-'));
  const readme = join(dir, 'README.md');
  const file = join(dir, 'citations.json');
  writeFileSync(readme, markdown, 'utf-8');
  writeFileSync(file, JSON.stringify(citations, null, 2), 'utf-8');
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, '--readme', readme, '--citations', file], {
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

const table = (columns: string[], rows: string[][]): string =>
  `## Benchmarks\n\n| Metric | ${columns.join(' | ')} |\n| --- | ${columns.map(() => '---').join(' | ')} |\n` +
  rows.map((r) => `| **${r[0]}** | ${r.slice(1).join(' | ')} |`).join('\n') +
  '\n\n## Documentation\n';

const OUR_ARTIFACT = 'benchmarks/citations.json';

describe('readme-numbers-gate', () => {
  it('passes when a published figure cites an artifact meeting the declared minimum', () => {
    const result = runGate(table(['Our run'], [['Precision', '79.4%']]), {
      minimumGroundTruth: 10,
      citations: {
        'Our run': { artifact: OUR_ARTIFACT, groundTruthIssues: 49, independentValidation: true },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('resolves to a citation');
  });

  it('fails on a published number with no citation', () => {
    const result = runGate(table(['Our run'], [['Precision', '79.4%']]), {
      minimumGroundTruth: 10,
      citations: {},
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('with no citation');
  });

  it('fails on a competitor column whose figure this project did not measure', () => {
    const result = runGate(table(['Our run', 'Vendor'], [['Precision', '79.4%', '72%']]), {
      minimumGroundTruth: 10,
      citations: {
        'Our run': { artifact: OUR_ARTIFACT, groundTruthIssues: 49, independentValidation: true },
        Vendor: { artifact: null, groundTruthIssues: 0 },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('names no artifact');
  });

  it('fails when the dataset is below the declared minimum', () => {
    const result = runGate(table(['Our run'], [['Precision', '79.4%']]), {
      minimumGroundTruth: 100,
      citations: {
        'Our run': { artifact: OUR_ARTIFACT, groundTruthIssues: 49, independentValidation: true },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('below the declared minimum');
  });

  it('fails when the citation is marked as not independently validated', () => {
    const result = runGate(table(['Our run'], [['Precision', '79.4%']]), {
      minimumGroundTruth: 10,
      citations: {
        'Our run': { artifact: OUR_ARTIFACT, groundTruthIssues: 49, independentValidation: false },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('independentValidation: false');
  });

  it('fails when the artifact a citation names does not exist', () => {
    const result = runGate(table(['Our run'], [['Precision', '79.4%']]), {
      minimumGroundTruth: 10,
      citations: {
        'Our run': {
          artifact: 'benchmarks/no-such-artifact.json',
          groundTruthIssues: 49,
          independentValidation: true,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('does not exist');
  });

  it('passes on this repository, so the committed README carries no uncited number', () => {
    const result = execFileSync(process.execPath, [GATE], { encoding: 'utf-8' });
    expect(result).toContain('nothing published, nothing to verify');
  });
});
