// code-analyzer — the coverage gate's contract.
//
// `scripts/coverage-report.js` decides whether a build passes, so the thing worth
// testing is not that it prints a table but that it **fails when it should**. A gate
// that cannot fail is worse than no gate: it reports a verdict nobody can act on.
// These tests drive the script as CI drives it and assert its exit code.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'scripts/coverage-report.js';

/** A `coverage-summary.json` with the given dimension percentages. */
function summaryWith(pcts: {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}): string {
  const dim = (pct: number) => ({ total: 100, covered: pct, skipped: 0, pct });
  return JSON.stringify({
    total: {
      lines: dim(pcts.lines),
      branches: dim(pcts.branches),
      functions: dim(pcts.functions),
      statements: dim(pcts.statements),
    },
  });
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'coverage-gate-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run the gate against a summary file and return its exit code and output. */
function runGate(jsonPath: string[], extraArgs: string[] = []) {
  const result =
    jsonPath.length === 0
      ? spawnSync('node', [SCRIPT, ...extraArgs], { encoding: 'utf-8' })
      : spawnSync('node', [SCRIPT, '--json', jsonPath[0]!, ...extraArgs], { encoding: 'utf-8' });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writeSummary(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe('coverage-report gate', () => {
  it('exits 0 when every dimension meets the threshold', () => {
    const path = writeSummary(
      'pass.json',
      summaryWith({ lines: 99, branches: 98, functions: 97, statements: 96 }),
    );

    const { code, stdout } = runGate([path]);

    expect(code).toBe(0);
    expect(stdout).toContain('meet the ≥95% threshold');
  });

  it('exits 1 when a dimension is below the threshold', () => {
    const path = writeSummary(
      'low-statements.json',
      summaryWith({ lines: 99, branches: 99, functions: 99, statements: 94 }),
    );

    const { code, stderr } = runGate([path]);

    expect(code).toBe(1);
    expect(stderr).toContain('Coverage threshold NOT met');
    expect(stderr).toContain('Statements: 94.0% < 95%');
  });

  it('names every failing dimension, not just the first', () => {
    const path = writeSummary(
      'two-low.json',
      summaryWith({ lines: 90, branches: 80, functions: 100, statements: 100 }),
    );

    const { code, stderr } = runGate([path]);

    expect(code).toBe(1);
    expect(stderr).toContain('Lines: 90.0% < 95%');
    expect(stderr).toContain('Branches: 80.0% < 95%');
    expect(stderr).not.toContain('Functions: 100.0% < 95%');
  });

  it('treats a value exactly on the threshold as passing', () => {
    const path = writeSummary(
      'exactly-95.json',
      summaryWith({ lines: 95, branches: 95, functions: 95, statements: 95 }),
    );

    expect(runGate([path]).code).toBe(0);
  });

  it('honours a custom threshold', () => {
    const path = writeSummary(
      'custom.json',
      summaryWith({ lines: 99, branches: 99, functions: 99, statements: 99 }),
    );

    expect(runGate([path], ['--threshold', '99.5']).code).toBe(1);
    expect(runGate([path], ['--threshold', '99']).code).toBe(0);
  });

  it('emits a GitHub annotation for each failure', () => {
    const path = writeSummary(
      'annotated.json',
      summaryWith({ lines: 99, branches: 99, functions: 99, statements: 10 }),
    );

    const { stdout } = runGate([path]);

    expect(stdout).toContain('::error title=Coverage Threshold Failed::Statements');
  });

  it('stays silent about the table under --quiet but still gates', () => {
    const path = writeSummary(
      'quiet.json',
      summaryWith({ lines: 99, branches: 99, functions: 99, statements: 99 }),
    );

    const { code, stdout } = runGate([path], ['--quiet']);

    expect(code).toBe(0);
    expect(stdout).not.toContain('Code Coverage Threshold Gate');
  });

  it('exits 1 when the summary is missing', () => {
    const { code, stderr } = runGate([join(dir, 'does-not-exist.json')]);

    expect(code).toBe(1);
    expect(stderr).toContain('Coverage summary not found');
  });

  it('exits 1 when the summary has no total', () => {
    const path = writeSummary('no-total.json', JSON.stringify({ 'file.ts': {} }));

    const { code, stderr } = runGate([path]);

    expect(code).toBe(1);
    expect(stderr).toContain('No "total" key');
  });

  it('exits 1 when a dimension is missing from the summary', () => {
    const incomplete = JSON.stringify({
      total: {
        lines: { total: 1, covered: 1, pct: 100 },
        branches: { total: 1, covered: 1, pct: 100 },
        functions: { total: 1, covered: 1, pct: 100 },
      },
    });
    const path = writeSummary('no-statements.json', incomplete);

    const { code, stderr } = runGate([path]);

    expect(code).toBe(1);
    expect(stderr).toContain('Missing "statements" dimension');
  });

  // The aggregate gate reads `total` and nothing else, so it is the easiest of the two to satisfy with an old
  // file: a perfect aggregate from before a regression is still a perfect aggregate. It asks the same freshness
  // question as the per-file gate, from the same summary, through the same module.
  it('exits 1 when the report predates a file it names', () => {
    const source = join(dir, 'aggregate-source.ts');
    writeFileSync(source, 'export const value = 1;\n');
    const wrote = new Date('2026-11-07T12:00:00Z');
    utimesSync(source, new Date('2026-11-07T12:30:00Z'), new Date('2026-11-07T12:30:00Z'));

    const path = writeSummary(
      'stale-total.json',
      JSON.stringify({
        total: {
          lines: { total: 100, covered: 100, skipped: 0, pct: 100 },
          branches: { total: 100, covered: 100, skipped: 0, pct: 100 },
          functions: { total: 100, covered: 100, skipped: 0, pct: 100 },
          statements: { total: 100, covered: 100, skipped: 0, pct: 100 },
        },
        [source]: { lines: { total: 1, covered: 1, skipped: 0, pct: 100 } },
      }),
    );
    utimesSync(path, wrote, wrote);

    const { code, stderr } = runGate([path]);

    expect(code).toBe(1);
    expect(stderr).toContain('older than a source file it describes');
    expect(stderr).toContain('aggregate-source.ts');
  });
});
