// README status gate — the test that proves the gate can fail.
//
// The table this gate was written for carried twenty rows reading `Verified — unit tested`, none of them pointing
// at anything. Two contradicted the project's own audit. These cases keep the gate able to say so.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/readme-status-gate.js';
const VOCAB = ['tested', 'verified', 'planned', 'partial'];

interface Entry {
  status: string;
  evidence?: string;
  artifact?: string;
  note?: string;
}
interface Register {
  vocabulary: string[];
  features: Record<string, Entry>;
}

function runGate(
  markdown: string,
  register: Register,
): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'readme-status-'));
  const readme = join(dir, 'README.md');
  const file = join(dir, 'register.json');
  writeFileSync(readme, markdown, 'utf-8');
  writeFileSync(file, JSON.stringify(register, null, 2), 'utf-8');
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, '--readme', readme, '--register', file], {
        encoding: 'utf-8',
      }),
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

const table = (rows: [string, string][]): string =>
  `## Features\n\n| Feature | Status |\n| --- | --- |\n` +
  rows.map(([f, s]) => `| ${f} | ${s} |`).join('\n') +
  '\n\n## Architecture\n';

const reg = (features: Record<string, Entry>): Register => ({ vocabulary: VOCAB, features });

describe('readme-status-gate', () => {
  it('passes when a status is in the vocabulary and matches its record', () => {
    const result = runGate(
      table([['Graph Store', 'Tested — unit']]),
      reg({ 'Graph Store': { status: 'tested' } }),
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('no stronger than its record');
  });

  it('fails on a row with no record', () => {
    const result = runGate(table([['Unknown Feature', 'Tested — unit']]), reg({}));
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('no record in the register');
  });

  it('fails on a status word outside the vocabulary', () => {
    const result = runGate(
      table([['Graph Store', 'Verified — unit tested']]),
      reg({ 'Graph Store': { status: 'verified', evidence: 'x' } }),
    );
    // `verified` is in the vocabulary, so this row is legal; an out-of-vocabulary word is what must fail.
    expect(result.ok).toBe(true);

    const bad = runGate(
      table([['Graph Store', 'Battle-tested — unit']]),
      reg({ 'Graph Store': { status: 'tested' } }),
    );
    expect(bad.ok).toBe(false);
    expect(bad.stderr).toContain('names no status from the vocabulary');
  });

  it('fails when a row claims verified while the register records a qualification', () => {
    const result = runGate(
      table([['Taint Analysis', 'Verified — unit tested']]),
      reg({
        'Taint Analysis': { status: 'partial', note: 'the audit lists this as a critical gap' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('records a qualification');
  });

  it('fails when a row claims more than its record supports', () => {
    const result = runGate(
      table([['MCP Server', 'Tested — integration']]),
      reg({ 'MCP Server': { status: 'partial' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('only supports');
  });

  it('fails when a row claims verified with no artifact recorded', () => {
    const result = runGate(
      table([['Graph Store', 'Verified — unit tested']]),
      reg({ 'Graph Store': { status: 'verified' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('no artifact recorded');
  });

  it('passes on this repository, so the committed README carries no unsupported claim', () => {
    const result = execFileSync(process.execPath, [GATE], { encoding: 'utf-8' });
    expect(result).toContain('no stronger than its record');
  });
});
