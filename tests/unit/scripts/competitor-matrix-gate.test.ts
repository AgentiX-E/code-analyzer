/**
 * Contract tests for the competitor matrix gate.
 *
 * A ratchet gate needs tests that feed it doctored input, because the gate's own tree is the one case where it must
 * pass, and the cases where it must fail are the ones that matter. The most important of them is the last one:
 *
 *   **A gate that passes on empty input is worse than no gate.** It reports success in exactly the situation where it
 *   stopped looking — the failure this whole class of gate exists to replace.
 *
 * Every case writes its own matrix and baseline into a temporary directory and runs the gate as a child process, so
 * what is under test is the command and not a helper the tests can reach into.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GATE = resolve(process.cwd(), 'scripts/competitor-matrix-gate.js');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runGate(dir: string, matrix: unknown, baseline?: unknown): Run {
  const matrixPath = join(dir, 'matrix.json');
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(matrixPath, JSON.stringify(matrix));
  const argv = ['--matrix', matrixPath, '--baseline', baselinePath];
  if (baseline !== undefined) {
    writeFileSync(baselinePath, JSON.stringify(baseline));
  }
  try {
    const stdout = execFileSync('node', [GATE, ...argv], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'matrix-gate-'));
}

/** A matrix whose one cell resolves to a value the test wrote into the tree. */
function matrixWithArtifact(artifactDir: string): Record<string, unknown> {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'fig.json'), JSON.stringify({ value: 42 }));
  return {
    competitors: [{ name: 'a', category: 'A' }],
    ourMetrics: {
      'x.measured': {
        category: 'A',
        axis: 'a measured axis',
        artifact: join(artifactDir, 'fig.json'),
        read: ['value'],
      },
    },
    pendingOurMetrics: {},
  };
}

describe('competitor matrix gate', () => {
  it('passes when every measured cell resolves and nothing is pending', () => {
    const dir = scratch();
    try {
      const result = runGate(dir, matrixWithArtifact(join(dir, 'art')), { missing: 0, cells: 1 });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('0.0075'.length > 0 ? 'measured 1' : 'measured 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when the MISSING count improves against the baseline', () => {
    const dir = scratch();
    try {
      const matrix = {
        competitors: [{ name: 'a', category: 'A' }],
        ourMetrics: {},
        pendingOurMetrics: { 'y.pending': { category: 'A', why: 'not wired yet' } },
      };
      const result = runGate(dir, matrix, { missing: 5, cells: 6 });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('missing 1 (baseline 5)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails, naming the count, when the MISSING count rises', () => {
    const dir = scratch();
    try {
      const matrix = {
        competitors: [{ name: 'a', category: 'A' }],
        ourMetrics: {},
        pendingOurMetrics: {
          'y.one': { category: 'A', why: 'one' },
          'y.two': { category: 'A', why: 'two' },
        },
      };
      const result = runGate(dir, matrix, { missing: 1, cells: 3 });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('rose');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an artifact whose declared component is disabled as MISSING rather than measured', () => {
    const dir = scratch();
    try {
      const artifact = join(dir, 'art');
      mkdirSync(artifact, { recursive: true });
      writeFileSync(join(artifact, 'fig.json'), JSON.stringify({ backend: 'none', recall: 1 }));
      const matrix = {
        competitors: [{ name: 'a', category: 'C' }],
        ourMetrics: {
          'vec.recall': {
            category: 'C',
            axis: 'recall with vectors',
            artifact: join(artifact, 'fig.json'),
            read: ['recall'],
            invalidWhen: { path: ['backend'], equals: 'none' },
          },
        },
        pendingOurMetrics: {},
      };
      const result = runGate(dir, matrix, { missing: 1, cells: 1 });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('disabled component');
      expect(result.stdout).toContain('measured 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a pending cell carries no reason, because the absence is then not actionable', () => {
    const dir = scratch();
    try {
      const matrix = {
        competitors: [{ name: 'a', category: 'A' }],
        ourMetrics: {},
        pendingOurMetrics: { 'z.noWhy': { category: 'A' } },
      };
      const result = runGate(dir, matrix, { missing: 1, cells: 1 });
      // **The first version of this test asserted a default sentence on stdout**, and that encoded the flawed design:
      // the gate filled the reason in, so its own check for a missing reason could never fire. **The expectation is the
      // failure now**, which is what rule 3 said in the first place.
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('carry no reason');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on an empty competitor list — "the gate did not look" is not a clean tree', () => {
    const dir = scratch();
    try {
      const result = runGate(
        dir,
        { competitors: [], ourMetrics: {}, pendingOurMetrics: {} },
        { missing: 0, cells: 0 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('no competitors');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when no metrics are declared at all', () => {
    const dir = scratch();
    try {
      const result = runGate(
        dir,
        { competitors: [{ name: 'a', category: 'A' }], ourMetrics: {}, pendingOurMetrics: {} },
        { missing: 0, cells: 0 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('no metrics');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when the matrix is absent', () => {
    const dir = scratch();
    try {
      const argv = ['--matrix', join(dir, 'nope.json'), '--baseline', join(dir, 'b.json')];
      let status = 0;
      let stderr = '';
      try {
        execFileSync('node', [GATE, ...argv], { encoding: 'utf8', stdio: 'pipe' });
      } catch (error) {
        const e = error as { status?: number; stderr?: string };
        status = e.status ?? 1;
        stderr = e.stderr ?? '';
      }
      expect(status).toBe(1);
      expect(stderr).toContain('not there');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
