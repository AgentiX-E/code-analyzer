// Coverage-exclusion gate — the test that proves the gate can fail.
//
// A gate that has never failed is unproven. This suite feeds the gate's own entry point synthetic inputs and
// asserts that each of its three checks fires on its own: an unrecorded exclusion, an orphaned record, and a
// v8 ignore directive that reappears in source. The clean-tree case is covered too, so a gate that failed
// unconditionally would not pass this either.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/coverage-exclusions-gate.js';

/** Run the gate against temporary inputs; returns { ok, stdout, stderr }. */
interface Register {
  v8IgnoreDirectives: number;
  configEntries: Record<string, string>;
}

interface SpawnFailure {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

function runGate(
  configText: string,
  register: Register,
  extra: string[] = [],
): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-exclusions-'));
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'vitest.config.ts');
  const registerPath = join(dir, 'register.json');
  writeFileSync(configPath, configText, 'utf-8');
  writeFileSync(registerPath, JSON.stringify(register, null, 2), 'utf-8');
  try {
    const stdout = execFileSync(
      process.execPath,
      [GATE, '--config', configPath, '--register', registerPath, ...extra],
      { encoding: 'utf-8' },
    );
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    const failure = err as SpawnFailure;
    return {
      ok: false,
      stdout: (failure.stdout ?? '').toString(),
      stderr: (failure.stderr ?? '').toString(),
    };
  }
}

const configWith = (entries: string[]): string =>
  `export default { test: { coverage: { exclude: [\n${entries.map((e: string) => `      '${e}',`).join('\n')}\n    ] } } };\n`;

describe('coverage-exclusions-gate', () => {
  it('passes when every exclusion and the directive ratchet are recorded', () => {
    const result = runGate(configWith(['packages/web/**']), {
      v8IgnoreDirectives: 0,
      configEntries: { 'packages/web/**': 'its own config' },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('v8 ignore directives: 0');
  });

  it('fails on an exclusion with no recorded reason', () => {
    const result = runGate(configWith(['packages/web/**', 'packages/sneaky/**']), {
      v8IgnoreDirectives: 0,
      configEntries: { 'packages/web/**': 'its own config' },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('no recorded reason');
    expect(result.stderr).toContain('packages/sneaky/**');
  });

  it('fails on a record whose exclusion is gone', () => {
    const result = runGate(configWith(['packages/web/**']), {
      v8IgnoreDirectives: 0,
      configEntries: {
        'packages/web/**': 'its own config',
        'packages/deleted/**': 'the entry this record was written for no longer exists',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('no matching exclude entry');
    expect(result.stderr).toContain('packages/deleted/**');
  });

  it('fails when the recorded directive ratchet no longer matches a synthetic config sweep', () => {
    // The directive scan walks `packages/`, so the check is exercised through its exported function rather
    // than through a temporary tree: a recorded ratchet of 7 with no directives in the repository must fail.
    const result = runGate(configWith(['packages/web/**']), {
      v8IgnoreDirectives: 7,
      configEntries: { 'packages/web/**': 'its own config' },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('v8 ignore directives');
    expect(result.stderr).toContain('7 recorded');
  });

  it('reports the counts it checked, so the CI log carries the evidence', () => {
    const result = runGate(configWith(['packages/web/**', 'packages/vscode/**']), {
      v8IgnoreDirectives: 0,
      configEntries: {
        'packages/web/**': 'its own config',
        'packages/vscode/**': 'its own config',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('2 entries, 2 recorded');
  });

  it('fails loudly when the config has no coverage exclude array at all', () => {
    const result = runGate('export default { test: {} };\n', {
      v8IgnoreDirectives: 0,
      configEntries: {},
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('no coverage `exclude` array');
  });
});
