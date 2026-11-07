// Node-version gate — the test that proves the three declarations can disagree.
//
// The floor said `>=20.0.0` and no workflow installed 20; the CI matrix said `22` and resolved to whatever patch
// was newest, across the exact range where `better-sqlite3` 13 segfaults; the Dockerfile said `22` again. Three
// numbers describing one runtime, and nothing compared them. These cases build small repositories where one of the
// three has drifted and assert that the gate names it.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/node-version-gate.js';

interface SpawnFailure {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

interface Fixture {
  nvmrc?: string | null;
  engines?: string;
  workflow?: string;
  dockerfile?: string | null;
  packages?: Record<string, string>;
}

const WORKFLOW = `name: Fixture
on: push
jobs:
  test:
    strategy:
      matrix:
        node-version: ['22.14.0', '22.23.4']
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: \${{ matrix.node-version }}
      - run: echo \${{ matrix.node-version == '22.23.4' }}
`;

function runGate(fixture: Fixture): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'node-version-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  if (fixture.nvmrc !== null)
    writeFileSync(join(dir, '.nvmrc'), fixture.nvmrc ?? '22.23.4\n', 'utf-8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', engines: { node: fixture.engines ?? '>=22.14.0' } }, null, 2),
    'utf-8',
  );
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), fixture.workflow ?? WORKFLOW, 'utf-8');
  if (fixture.dockerfile !== null) {
    writeFileSync(
      join(dir, 'Dockerfile'),
      fixture.dockerfile ?? 'ARG NODE_VERSION=22.23.4\n',
      'utf-8',
    );
  }
  for (const [name, engines] of Object.entries(fixture.packages ?? {})) {
    mkdirSync(join(dir, 'packages', name), { recursive: true });
    writeFileSync(
      join(dir, 'packages', name, 'package.json'),
      JSON.stringify({ name, engines: { node: engines } }, null, 2),
      'utf-8',
    );
  }
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, '--repo', dir], { encoding: 'utf-8' }),
      stderr: '',
    };
  } catch (err) {
    const failure = err as SpawnFailure;
    return {
      ok: false,
      stdout: (failure.stdout ?? '').toString(),
      stderr: (failure.stderr ?? '').toString(),
    };
  }
}

describe('node-version-gate', () => {
  it('passes when the three declarations agree', () => {
    const result = runGate({});

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('22.23.4');
    expect(result.stdout).toContain('22.14.0');
  });

  it('fails with no .nvmrc at all', () => {
    const result = runGate({ nvmrc: null });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('.nvmrc');
  });

  it('fails on an .nvmrc that names a line rather than a version', () => {
    const result = runGate({ nvmrc: '22\n' });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('.nvmrc');
    expect(result.stderr).toMatch(/full version|x\.y\.z/);
  });

  it('fails on a scalar node-version input, which floats', () => {
    const result = runGate({
      workflow: WORKFLOW.replace('node-version: ${{ matrix.node-version }}', "node-version: '22'"),
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('node-version-file');
  });

  it('fails when the matrix tests a version the floor does not allow', () => {
    const result = runGate({
      workflow: WORKFLOW.replace("'22.14.0'", "'22.0.0'"),
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('22.0.0');
    expect(result.stderr).toContain('>=22.14.0');
  });

  it('fails when the matrix never installs the pinned version', () => {
    const result = runGate({ workflow: WORKFLOW.replace("'22.23.4'", "'22.20.0'") });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('22.23.4');
  });

  it('fails when a condition compares a version the matrix does not contain', () => {
    const result = runGate({
      workflow: WORKFLOW.replace("matrix.node-version == '22.23.4'", "matrix.node-version == '22'"),
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("'22'");
    expect(result.stderr).toMatch(/never true|always false/);
  });

  it('fails on an engines floor that disagrees across manifests', () => {
    const result = runGate({ packages: { cli: '>=20.0.0' } });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('>=20.0.0');
  });

  it('fails on a floor above the pinned version', () => {
    const result = runGate({ engines: '>=22.99.0' });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('floor');
  });

  it('fails on a Dockerfile that builds a different runtime', () => {
    const result = runGate({ dockerfile: 'ARG NODE_VERSION=22\n' });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('Dockerfile');
  });
});
