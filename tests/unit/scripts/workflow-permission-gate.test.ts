// Workflow-permission gate — the test that proves a widened grant is caught, not just that today's set is narrow.
//
// Ten `TokenPermissionsID` alerts named ten grants wider than the job that used them: `checks: write` on four jobs of
// `pr-review.yml` where one wrote a check run, `security-events: write` on five jobs of `security-audit.yml` where one
// uploaded a SARIF file, `issues: write` on a workflow that opens no issue. The three shapes below are those three
// alerts, plus the two that make a mapping file dangerous — a file that states nothing, and one that says `write-all`.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/workflow-permission-gate.js';

interface Result {
  ok: boolean;
  stdout: string;
}

function runGate(workflows: Record<string, string>): Result {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-permissions-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(dir, '.github', 'workflows', name), body, 'utf-8');
  }
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, '--repo', dir, '--json'], {
        encoding: 'utf-8',
      }),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    expect(failure.status).toBe(1);
    return { ok: false, stdout: String(failure.stdout ?? '') };
  }
}

function parse(result: Result): {
  files: string[];
  findings: Array<{ file: string; kind: string; permission?: string; job?: string }>;
  jobLevelWrites: number;
} {
  return JSON.parse(result.stdout);
}

describe('a write granted above the job that uses it', () => {
  it('reports a workflow-level write, and names the permission', () => {
    const result = runGate({
      'security-audit.yml': [
        'name: Security Audit',
        'on: [push]',
        'permissions:',
        '  contents: read',
        '  security-events: write',
        'jobs:',
        '  secret-scan:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo hi',
        '',
      ].join('\n'),
    });

    expect(result.ok).toBe(false);
    expect(parse(result).findings).toEqual([
      {
        file: '.github/workflows/security-audit.yml',
        kind: 'workflow-level-write',
        permission: 'security-events',
      },
    ]);
  });

  it('reports a file that states no permissions at all', () => {
    // Absence is not neutrality: the jobs inherit the repository default, and the file does not say which that is.
    const result = runGate({
      'inherit.yml': [
        'name: Inherit',
        'on: [push]',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo hi',
        '',
      ].join('\n'),
    });

    expect(result.ok).toBe(false);
    expect(parse(result).findings).toEqual([
      { file: '.github/workflows/inherit.yml', kind: 'unstated' },
    ]);
  });

  it('reports write-all, which is the same blanket grant spelled shorter', () => {
    const result = runGate({
      'blanket.yml': ['name: Blanket', 'on: [push]', 'permissions: write-all', 'jobs: {}', ''].join(
        '\n',
      ),
    });

    expect(result.ok).toBe(false);
    expect(parse(result).findings).toEqual([
      { file: '.github/workflows/blanket.yml', kind: 'workflow-level-write', permission: '*' },
    ]);
  });
});

describe('a write granted to the job that uses it', () => {
  it('passes a read-all workflow whose one writing job declares the scope', () => {
    const result = runGate({
      'cosign.yml': [
        'name: Sign',
        'on: [push]',
        'permissions: read-all',
        'jobs:',
        '  sign:',
        '    runs-on: ubuntu-latest',
        '    permissions:',
        '      contents: write',
        '    steps:',
        '      - run: echo sign',
        '',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
    expect(parse(result)).toEqual({
      files: ['.github/workflows/cosign.yml'],
      findings: [],
      jobLevelWrites: 1,
    });
  });

  it('reads a block through its blank lines and comments', () => {
    // A gate that ended the block at the first comment would see `contents: read` and nothing else, which is a
    // narrower file than this one is.
    const result = runGate({
      'commented.yml': [
        'name: Commented',
        'on: [push]',
        'permissions:',
        '  contents: read',
        '',
        '  # the release is written by the job below',
        '  issues: write',
        'jobs: {}',
        '',
      ].join('\n'),
    });

    expect(result.ok).toBe(false);
    expect(parse(result).findings).toEqual([
      {
        file: '.github/workflows/commented.yml',
        kind: 'workflow-level-write',
        permission: 'issues',
      },
    ]);
  });

  it('accepts an empty job map as a job that asks for no token', () => {
    const result = runGate({
      'summary-only.yml': [
        'name: Summary',
        'on: [push]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  summary:',
        '    runs-on: ubuntu-latest',
        '    permissions: {}',
        '    steps:',
        '      - run: echo done',
        '',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
    expect(parse(result).jobLevelWrites).toBe(0);
  });
});

describe('this repository', () => {
  it('grants no write above the job that uses it', () => {
    // The check that the alerts closed and stay closed. The count of job-level writes is reported rather than
    // asserted, because it is the answer to "how much write is there" and not a threshold anybody chose.
    const stdout = execFileSync(process.execPath, [GATE, '--json'], { encoding: 'utf-8' });
    const result = JSON.parse(stdout) as {
      files: string[];
      findings: unknown[];
      jobLevelWrites: number;
    };

    expect(result.findings).toEqual([]);
    expect(result.files.length).toBeGreaterThan(30);
    expect(result.jobLevelWrites).toBeGreaterThan(0);
  });
});
