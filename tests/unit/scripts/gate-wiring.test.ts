// Gate wiring — the test that proves the meta-gate can fail.
//
// `baseline-anchors-gate.js` was a correct, tested and entirely uninvoked script until two workflow files were
// edited by hand. Nothing could tell the difference between a gate that guards a pull request and a gate that
// guards nothing, because both look the same in the tree. These cases build small repositories in which the only
// difference is who names the script, and assert that the gate separates them.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/gate-wiring.js';

interface SpawnFailure {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

interface Fixture {
  /** Script paths under `scripts/`, relative to the repository root. */
  scripts?: Record<string, string>;
  /** Script paths under `.github/scripts/`. */
  ciScripts?: Record<string, string>;
  /** Workflow file name -> its YAML text. */
  workflows?: Record<string, string>;
  /** `package.json` `scripts`. */
  packageScripts?: Record<string, string>;
  /** Register contents; omit for no register file at all. */
  register?: Record<string, string>;
}

function build(fixture: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate-wiring-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(dir, '.github', 'scripts'), { recursive: true });

  for (const [name, body] of Object.entries(fixture.scripts ?? {})) {
    writeFileSync(join(dir, 'scripts', name), body, 'utf-8');
  }
  for (const [name, body] of Object.entries(fixture.ciScripts ?? {})) {
    writeFileSync(join(dir, '.github', 'scripts', name), body, 'utf-8');
  }
  for (const [name, body] of Object.entries(fixture.workflows ?? {})) {
    writeFileSync(join(dir, '.github', 'workflows', name), body, 'utf-8');
  }
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: fixture.packageScripts ?? {} }, null, 2),
    'utf-8',
  );
  if (fixture.register) {
    writeFileSync(
      join(dir, 'scripts', 'gate-wiring-register.json'),
      JSON.stringify(fixture.register, null, 2),
      'utf-8',
    );
  }
  return dir;
}

function runGate(fixture: Fixture): { ok: boolean; stdout: string; stderr: string } {
  const dir = build(fixture);
  try {
    return {
      ok: true,
      stdout: execFileSync(
        process.execPath,
        [GATE, '--repo', dir, '--register', join(dir, 'scripts', 'gate-wiring-register.json')],
        { encoding: 'utf-8' },
      ),
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

const WORKFLOW = (body: string): string => `name: Fixture\njobs:\n  build:\n    steps:\n${body}`;

describe('gate-wiring', () => {
  it('passes when every script is reachable from a workflow', () => {
    const result = runGate({
      scripts: {
        'direct.js': "'use strict';\n",
        'via-script.js': "'use strict';\n",
      },
      workflows: {
        'ci.yml': WORKFLOW('      - run: node scripts/direct.js\n      - run: pnpm check:all\n'),
      },
      packageScripts: { 'check:all': 'node scripts/via-script.js' },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('every script is named by something that runs');
  });

  it('counts a module reachable only through a wired script as wired', () => {
    const result = runGate({
      scripts: {
        'gate.js': "const { check } = require('./shared.js');\ncheck();\n",
        'shared.js': 'module.exports = { check: () => 1 };\n',
      },
      workflows: { 'ci.yml': WORKFLOW('      - run: node scripts/gate.js\n') },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('wired');
  });

  it('fails on a script nothing names', () => {
    const result = runGate({
      scripts: {
        'gate.js': "'use strict';\n",
        'orphan.js': "'use strict';\n",
      },
      workflows: { 'ci.yml': WORKFLOW('      - run: node scripts/gate.js\n') },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('scripts/orphan.js');
  });

  it('fails on a script that only an uncalled package script names', () => {
    const result = runGate({
      scripts: {
        'gate.js': "'use strict';\n",
        'local-only.js': "'use strict';\n",
      },
      workflows: { 'ci.yml': WORKFLOW('      - run: node scripts/gate.js\n') },
      packageScripts: { 'local:only': 'node scripts/local-only.js' },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('scripts/local-only.js');
  });

  it('accepts a registered local tool, and prints the reason it gave', () => {
    const result = runGate({
      scripts: {
        'gate.js': "'use strict';\n",
        'local-only.js': "'use strict';\n",
      },
      workflows: { 'ci.yml': WORKFLOW('      - run: node scripts/gate.js\n') },
      packageScripts: { 'local:only': 'node scripts/local-only.js' },
      register: { 'scripts/local-only.js': 'needs a credential a pull request does not have' },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('1 registered local tool');
  });

  it('fails when a register entry is already wired', () => {
    const result = runGate({
      scripts: {
        'gate.js': "'use strict';\n",
        'local-only.js': "'use strict';\n",
      },
      workflows: { 'ci.yml': WORKFLOW('      - run: node scripts/gate.js\n') },
      register: {
        'scripts/gate.js': 'a reason that stopped being true when the workflow named it',
        'scripts/local-only.js': 'needs a credential',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('scripts/gate.js');
    expect(result.stderr).toContain('already names');
  });

  it('fails on a register entry with no reason', () => {
    const result = runGate({
      scripts: { 'local-only.js': "'use strict';\n" },
      register: { 'scripts/local-only.js': '   ' },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('no reason');
  });

  it('fails on a register entry for a file that does not exist', () => {
    const result = runGate({
      scripts: { 'gate.js': "'use strict';\n" },
      workflows: { 'ci.yml': WORKFLOW('      - run: node scripts/gate.js\n') },
      register: { 'scripts/deleted-last-year.js': 'a reason nobody re-read' },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('scripts/deleted-last-year.js');
    expect(result.stderr).toContain('no such file');
  });

  it('scans .github/scripts as well, because eight entry points live there', () => {
    const result = runGate({
      scripts: { 'gate.js': "'use strict';\n" },
      ciScripts: { 'harness.mjs': 'export const run = () => 1;\n' },
      workflows: { 'ci.yml': WORKFLOW('      - run: node scripts/gate.js\n') },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('.github/scripts/harness.mjs');
  });

  it('does not mistake a longer filename for the script it contains', () => {
    const result = runGate({
      scripts: {
        'benchmark.js': "'use strict';\n",
        'benchmark.ts': "'use strict';\n",
      },
      workflows: {
        'ci.yml': WORKFLOW('      - run: npx tsx scripts/benchmark.ts\n'),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('scripts/benchmark.js');
    expect(result.stderr).not.toContain('scripts/benchmark.ts');
  });
});
