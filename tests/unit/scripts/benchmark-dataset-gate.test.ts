// Benchmark dataset gate — the test that proves the gate can fail.
//
// The state this gate was written for: the citations file declares a minimum of 100, the suite holds 49, and the
// README published figures anyway. The gate has to say "not publishable" and say why, and it has to catch a
// citation that overstates its own dataset.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/benchmark-dataset-gate.js';

interface Citation {
  groundTruthIssues?: number;
}
interface Citations {
  minimumGroundTruth: number;
  citations: Record<string, Citation>;
}

function runGate(citations: Citations): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'benchmark-dataset-'));
  mkdirSync(join(dir, 'benchmarks'), { recursive: true });
  const file = join(dir, 'citations.json');
  writeFileSync(file, JSON.stringify(citations, null, 2), 'utf-8');
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, '--citations', file], { encoding: 'utf-8' }),
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

describe('benchmark-dataset-gate', () => {
  it('reports the real dataset against the declared minimum, on this repository', () => {
    const out = execFileSync(process.execPath, [GATE, '--json'], { encoding: 'utf-8' });
    const result = JSON.parse(out) as { minimum: number; counted: number; publishable: boolean };

    // **This assertion used to read 49 and `publishable: false`** - the state I20.2 recorded, and the reason no
    // PR-review figure was published: 49 hand-written fixtures against a minimum of 100, and not independent
    // because this project wrote them. On 2026-10-05 the real dataset from public bug-fix commits reached the
    // minimum, so the assertion states the new truth. **It is still an assertion about the world, not a wish**:
    // if the count falls below the minimum again, this fails.
    expect(result.minimum).toBe(100);
    expect(result.counted).toBeGreaterThanOrEqual(100);
    expect(result.publishable).toBe(true);
  });

  it('reports below-minimum without failing, because a small dataset is a state rather than a defect', () => {
    // Failing CI here would leave the build permanently red until the dataset grows, and a permanently red job
    // teaches people to ignore red. The publication refusal lives in the README gate; this one states the fact.
    const result = runGate({
      minimumGroundTruth: 100,
      citations: { suite: { groundTruthIssues: 49 } },
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
      JSON.stringify({ minimumGroundTruth: 100, citations: { suite: { groundTruthIssues: 49 } } }),
      'utf-8',
    );
    expect(() =>
      execFileSync(process.execPath, [GATE, '--citations', file, '--require-publishable'], {
        encoding: 'utf-8',
      }),
    ).toThrow();
  });

  it('fails when a citation overstates the dataset it points at', () => {
    const result = runGate({
      minimumGroundTruth: 10,
      citations: { suite: { groundTruthIssues: 100 } },
    });

    expect(result.ok).toBe(false);
    // **The gate says which sources it counted and what they hold.** The wording changed when a citation began
    // counting the sources it names rather than a global list, so the assertion checks the substance: the
    // discrepancy is named, and both numbers appear.
    const said = result.stderr + result.stdout;
    expect(said).toContain('sources hold');
    expect(said).toContain('100');
    expect(said).toContain('49');
  });

  it('passes only when the count matches and reaches the minimum', () => {
    const result = runGate({
      minimumGroundTruth: 10,
      citations: { suite: { groundTruthIssues: 49 } },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('is what the citation says it is');
  });
});
