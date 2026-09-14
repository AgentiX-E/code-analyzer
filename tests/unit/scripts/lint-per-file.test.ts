// The lint ratchet's contract.
//
// A gate that cannot fail is worse than no gate, and this one exists because the step it replaces
// could not fail: `pnpm lint` ran `turbo lint` with no package declaring a `lint` script, so it ran
// zero tasks and exited 0. These cases exercise the failure modes directly by feeding the gate
// ESLint-shaped JSON through `--json` with a baseline of their own.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const SCRIPT = 'scripts/lint-per-file.js';

function run(json: unknown, baseline: unknown): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lint-gate-'));
  const jsonPath = join(dir, 'lint.json');
  const basePath = join(dir, 'baseline.json');
  writeFileSync(jsonPath, typeof json === 'string' ? json : JSON.stringify(json));
  writeFileSync(basePath, JSON.stringify(baseline));
  try {
    const out = execFileSync('node', [SCRIPT, '--json', jsonPath, '--baseline', basePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// The gate keys findings by their path relative to the repository root, so these have to sit under it.
const entry = (file: string, count: number) => ({
  filePath: join(process.cwd(), file),
  messages: Array.from({ length: count }, () => ({
    line: 1,
    column: 1,
    ruleId: 'r',
    message: 'm',
  })),
});

describe('lint-per-file ratchet', () => {
  it('passes when every file is at or below its recorded count', () => {
    const { status } = run([entry('packages/a/src/x.ts', 3)], {
      files: { 'packages/a/src/x.ts': 3 },
    });
    expect(status).toBe(0);
  });

  it('passes when a file improved', () => {
    const { status } = run([entry('packages/a/src/x.ts', 1)], {
      files: { 'packages/a/src/x.ts': 3 },
    });
    expect(status).toBe(0);
  });

  it('fails when a file exceeds its recorded count, and names it', () => {
    const { status, out } = run([entry('packages/a/src/x.ts', 5)], {
      files: { 'packages/a/src/x.ts': 3 },
    });
    expect(status).toBe(1);
    expect(out).toContain('packages/a/src/x.ts');
    expect(out).toContain('3 → 5');
  });

  it('fails when a file with no recorded findings gains some', () => {
    const { status, out } = run([entry('packages/a/src/new.ts', 2)], { files: {} });
    expect(status).toBe(1);
    expect(out).toContain('packages/a/src/new.ts');
  });

  it('fails on empty input — the linter not running is not a clean tree', () => {
    const { status, out } = run([], { files: {} });
    expect(status).toBe(1);
    expect(out).toContain('did not run');
  });

  it('fails when the input is not an ESLint JSON array', () => {
    const { status, out } = run('not json at all', { files: {} });
    expect(status).toBe(1);
    expect(out).toContain('did not run');
  });
});
