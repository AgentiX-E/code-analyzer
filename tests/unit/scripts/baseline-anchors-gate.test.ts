// The baseline-anchor gate — the test that proves the gate can fail.
//
// Every ratchet in this repository is a JSON file keyed by repository-relative path, and each of them is read
// by a gate that compares *numbers*. None of them compared the key to the tree. The consequence is not
// theoretical: iteration 94 deleted eleven modules and `scripts/lint-baseline.json` kept fourteen allowances for
// files that no longer exist — 190 findings' worth, 143 of them from one deleted test — while
// `scripts/coverage-exclusion-register.json` spent forty words justifying the exclusion of a test file that has
// never been in this repository's history.
//
// These cases feed the gate a temporary tree and assert that each check fires on its own: a path that is gone, a
// glob with no literal anchor, a baseline file that is missing, and a baseline whose declared key field is not
// the one the gate expects. The clean case is here too, so a gate that failed unconditionally would not pass.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GATE = 'scripts/baseline-anchors-gate.js';

/** The four baselines the repository keeps, with the field each keys its records by. */
const SHAPE = {
  'scripts/lint-baseline.json': 'files',
  'scripts/typecheck-tests-baseline.json': 'files',
  'scripts/coverage-per-file-exclusions.json': 'exclusions',
  'scripts/coverage-exclusion-register.json': 'configEntries',
} as const;

interface Tree {
  /** Repository-relative paths that exist in the temporary tree. */
  paths?: string[];
  /** Overrides for the four baseline files, keyed by their repository-relative path. */
  baselines?: Record<string, unknown>;
}

/** Build a temporary tree holding the four baselines, and run the gate against it. */
function runGate(tree: Tree = {}): { ok: boolean; stdout: string; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), 'baseline-anchors-'));
  for (const relative of tree.paths ?? []) {
    const full = join(root, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '// fixture\n', 'utf-8');
  }
  for (const [relative, field] of Object.entries(SHAPE)) {
    const body = tree.baselines?.[relative] ?? { [field]: {} };
    mkdirSync(join(root, dirname(relative)), { recursive: true });
    writeFileSync(join(root, relative), `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
  }
  try {
    const stdout = execFileSync(process.execPath, [GATE, '--root', root], { encoding: 'utf-8' });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      stdout: (failure.stdout ?? '').toString(),
      stderr: (failure.stderr ?? '').toString(),
    };
  }
}

describe('baseline-anchors-gate', () => {
  it('passes when every recorded path exists', () => {
    const result = runGate({
      paths: ['packages/analyzer/src/index.ts'],
      baselines: {
        'scripts/lint-baseline.json': { files: { 'packages/analyzer/src/index.ts': 3 } },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('1 record');
  });

  it('fails on a recorded path that does not exist, and names it', () => {
    const result = runGate({
      baselines: {
        'scripts/lint-baseline.json': { files: { 'packages/analyzer/src/deleted.ts': 143 } },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('packages/analyzer/src/deleted.ts');
    expect(result.stderr).toContain('143');
  });

  it('accepts a `**/`-anchored glob whose literal remainder resolves deeper in the tree', () => {
    // `**/benchmarks/ca-bench/suites/**` is a real entry: the directory is `tests/benchmarks/ca-bench/suites`.
    // A gate that only tried `existsSync(entry)` would call this a phantom.
    const result = runGate({
      paths: ['tests/benchmarks/ca-bench/suites/one.test.ts'],
      baselines: {
        'scripts/coverage-exclusion-register.json': {
          configEntries: { '**/benchmarks/ca-bench/suites/**': 'benchmark suites, not tests' },
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it('accepts a trailing-`/**` glob whose directory exists', () => {
    const result = runGate({
      paths: ['packages/web/src/main.ts'],
      baselines: {
        'scripts/coverage-exclusion-register.json': {
          configEntries: { 'packages/web/**': 'its own config' },
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it('fails on a glob with no literal anchor, because nothing can check it', () => {
    const result = runGate({
      paths: ['packages/web/src/main.ts'],
      baselines: {
        'scripts/coverage-exclusion-register.json': {
          configEntries: { '**/*.generated.ts': 'generated code' },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('no literal anchor');
    expect(result.stderr).toContain('**/*.generated.ts');
  });

  it('fails when a glob anchor resolves nowhere', () => {
    const result = runGate({
      paths: ['packages/web/src/main.ts'],
      baselines: {
        'scripts/coverage-exclusion-register.json': {
          configEntries: { '**/benchmarks/gone/**': 'a directory that is not there' },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('resolves to nothing');
    expect(result.stderr).toContain('benchmarks/gone');
  });

  it('fails when one of the baselines is missing, rather than passing on the ones that are left', () => {
    const result = runGate({
      baselines: {},
      paths: [],
    });
    expect(result.ok).toBe(true); // all four exist and are empty — the baseline of this test

    const root = mkdtempSync(join(tmpdir(), 'baseline-anchors-'));
    for (const relative of Object.keys(SHAPE).slice(1)) {
      mkdirSync(join(root, dirname(relative)), { recursive: true });
      writeFileSync(
        join(root, relative),
        '{ "files": {}, "exclusions": {}, "configEntries": {} }\n',
      );
    }
    let failed = false;
    try {
      execFileSync(process.execPath, [GATE, '--root', root], { encoding: 'utf-8' });
    } catch (err) {
      failed = true;
      expect(((err as { stderr?: Buffer }).stderr ?? '').toString()).toContain(
        'scripts/lint-baseline.json',
      );
    }
    expect(failed).toBe(true);
  });

  it('fails when a baseline does not carry the field the gate reads', () => {
    // A gate that read `files` and found none would report "0 records, 0 phantoms" over a file whose records
    // live under another key — the empty-input failure this repository has already paid for once.
    const result = runGate({
      baselines: { 'scripts/lint-baseline.json': { allowances: { 'gone.ts': 1 } } },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('has no `files` field');
  });

  it('reports every baseline it checked, so the CI log carries the evidence', () => {
    const result = runGate({ paths: ['packages/web/src/main.ts'] });

    expect(result.ok).toBe(true);
    for (const relative of Object.keys(SHAPE)) expect(result.stdout).toContain(relative);
  });
});
