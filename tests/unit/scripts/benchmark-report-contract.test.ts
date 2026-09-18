// The report contract — the test that proves it can fail, including on the state the repository was in.
//
// The README published precision and recall from a dataset nobody could identify. The four fields this gate
// requires are the questions a reader would have had to ask, so the gate fails on a report that omits any of them
// and on one that fills a field with the word "unspecified" — a placeholder that looks like a value.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/benchmark-report-contract.js';

const complete = {
  metadata: {
    suiteName: 'CA-Bench',
    source: 'packages/intelligence/src/benchmark/benchmark-data.ts',
    timestamp: '2026-09-18T00:00:00.000Z',
    arm: 'full',
    datasetRevision: '49-issues-2026-08',
  },
};

function runGate(report: unknown): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'report-contract-'));
  const file = join(dir, 'report.json');
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8');
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, file], { encoding: 'utf-8' }),
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

describe('benchmark-report-contract', () => {
  it('passes a report that names all four', () => {
    const result = runGate(complete);

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('names its source, date, arm and dataset revision');
  });

  for (const field of ['source', 'timestamp', 'arm', 'datasetRevision']) {
    it(`fails a report with no ${field}`, () => {
      const report = { metadata: { ...complete.metadata } } as {
        metadata: Record<string, unknown>;
      };
      delete report.metadata[field];

      const result = runGate(report);

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain(`metadata.${field} is missing`);
    });
  }

  it('fails a report that fills a field with the word unspecified', () => {
    // The value the implementation defaults to. A placeholder that reads like an answer is worse than an absent
    // field, because an absent field is visibly absent.
    const result = runGate({ metadata: { ...complete.metadata, arm: 'unspecified' } });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('states nothing');
  });

  it('fails a report that is not JSON at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'report-contract-'));
    const file = join(dir, 'report.json');
    writeFileSync(file, 'not json', 'utf-8');
    expect(() => execFileSync(process.execPath, [GATE, file], { encoding: 'utf-8' })).toThrow();
  });
});
