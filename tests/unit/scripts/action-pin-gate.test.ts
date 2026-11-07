// Action-pin gate — the test that proves drift is detected, not just absence.
//
// Ninety-seven `PinnedDependenciesID` alerts pointed at the same thing: a workflow run executes whatever a mutable
// tag points at today. A tag is a promise the action's owner can rewrite, and the run that did it has no record of
// what it actually executed. These cases cover the two shapes the repository was in — a tag instead of a commit,
// and a commit with no record of which release it came from — plus the drift that produced the alerts: one
// repository pinned twice, at two different commits, in two workflows that were meant to do the same thing.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/action-pin-gate.js';

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const OTHER_SHA = 'cf430e030ddbb5b0abf93d22962f4752f3646cd9';

interface SpawnFailure {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

function runGate(workflows: Record<string, string>): {
  ok: boolean;
  stdout: string;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'action-pin-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(dir, '.github', 'workflows', name), body, 'utf-8');
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

const workflow = (uses: string): string => `name: Fixture
on: push
jobs:
  build:
    steps:
${uses
  .split('\n')
  .map((line) => `      - uses: ${line}`)
  .join('\n')}
`;

describe('action-pin-gate', () => {
  it('passes a commit with the release it came from', () => {
    const result = runGate({ 'ci.yml': workflow(`actions/checkout@${SHA} # v7`) });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('1 action reference');
  });

  it('fails a mutable tag', () => {
    const result = runGate({ 'ci.yml': workflow('actions/checkout@v7') });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('actions/checkout@v7');
    expect(result.stderr).toContain('40');
  });

  it('fails a commit with no release comment', () => {
    const result = runGate({ 'ci.yml': workflow(`actions/checkout@${SHA}`) });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('which release');
  });

  it('fails a short commit, which is a prefix and not a pin', () => {
    const result = runGate({ 'ci.yml': workflow(`actions/checkout@3d3c42e # v7`) });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('actions/checkout');
  });

  it('fails one repository pinned to two commits', () => {
    const result = runGate({
      'a.yml': workflow(`actions/checkout@${SHA} # v7`),
      'b.yml': workflow(`actions/checkout@${OTHER_SHA} # v7`),
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('actions/checkout');
    expect(result.stderr).toContain('two commits');
  });

  it('fails one repository described by two releases', () => {
    const result = runGate({
      'a.yml': workflow(`actions/checkout@${SHA} # v7`),
      'b.yml': workflow(`actions/checkout@${SHA} # v6`),
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('v6');
    expect(result.stderr).toContain('v7');
  });

  it('ignores a local action, which has no release to pin', () => {
    const result = runGate({ 'ci.yml': workflow('./.github/actions/report') });

    expect(result.ok).toBe(true);
  });

  it('ignores a docker image reference', () => {
    const result = runGate({ 'ci.yml': workflow('docker://alpine:3') });

    expect(result.ok).toBe(true);
  });

  it('fails when a workflow has no jobs at all only if it has uses, which it does not', () => {
    const result = runGate({ 'empty.yml': 'name: Fixture\non: push\njobs: {}\n' });

    expect(result.ok).toBe(true);
  });
});
