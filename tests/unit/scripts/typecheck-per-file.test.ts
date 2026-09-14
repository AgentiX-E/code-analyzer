// code-analyzer — the per-file typecheck ratchet's contract.
//
// `scripts/typecheck-per-file.js` exists because `typecheck:tests` carries 1829 errors across
// 184 files and a single total is the wrong invariant: it holds while a clean file goes dirty and
// another file improves. The two rules worth testing are therefore that a file which was clean
// cannot gain a single error, that a file cannot exceed its recorded count — and that *improving*
// a file is never punished. Same reasoning as the coverage gate: a check that cannot fail is worse
// than no check.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'scripts/typecheck-per-file.js';

/** A line in the shape `tsc --pretty false` emits. */
function diagnostic(file: string, line: number, code = 'TS2532'): string {
  return `${file}(${line},3): error ${code}: Object is possibly 'undefined'.`;
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'typecheck-ratchet-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a fixture file. Objects are serialised, so baselines read naturally at the call site. */
function write(name: string, contents: string | object): string {
  const path = join(dir, name);
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

/** Run the ratchet and return its exit code plus combined output. */
function runRatchet(logPath: string | null, baselinePath?: string, extra: string[] = []) {
  const argv = [SCRIPT];
  if (logPath) argv.push('--log', logPath);
  if (baselinePath) argv.push('--baseline', baselinePath);
  argv.push(...extra);
  const result = spawnSync('node', argv, { encoding: 'utf-8' });
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('typecheck per-file ratchet', () => {
  it('requires a log path', () => {
    const { code, output } = runRatchet(null);

    expect(code).toBe(1);
    expect(output).toContain('--log <path> is required');
  });

  it('fails when the log file does not exist', () => {
    const { code, output } = runRatchet(join(dir, 'absent.log'));

    expect(code).toBe(1);
    expect(output).toContain('Compiler log not found');
  });

  it('fails rather than passing when the log is empty but the baseline is not', () => {
    const baseline = write('b0.json', { comment: [], files: { 'packages/a/x.test.ts': 12 } });
    const log = write('l0.log', 'Found 0 errors.\n');

    const { code, output } = runRatchet(log, baseline);

    expect(code).toBe(1);
    expect(output).toContain('the compiler did not run');
  });

  it('fails when a file that was clean gains a single error', () => {
    const baseline = write('b1.json', {
      comment: [],
      files: { 'packages/a/src/__tests__/dirty.test.ts': 2 },
    });
    const log = write(
      'l1.log',
      [
        diagnostic('packages/a/src/__tests__/dirty.test.ts', 1),
        diagnostic('packages/a/src/__tests__/dirty.test.ts', 2),
        diagnostic('packages/b/src/__tests__/was-clean.test.ts', 7),
      ].join('\n'),
    );

    const { code, output } = runRatchet(log, baseline);

    expect(code).toBe(1);
    expect(output).toContain('packages/b/src/__tests__/was-clean.test.ts');
    expect(output).toContain('in a file that was clean');
    expect(output).toContain('::error title=Typecheck ratchet::');
  });

  it('fails when a baselined file exceeds its recorded count', () => {
    const baseline = write('b2.json', {
      comment: [],
      files: { 'packages/a/src/__tests__/dirty.test.ts': 2 },
    });
    const log = write(
      'l2.log',
      [1, 2, 3, 4, 5]
        .map((n) => diagnostic('packages/a/src/__tests__/dirty.test.ts', n))
        .join('\n'),
    );

    const { code, output } = runRatchet(log, baseline);

    expect(code).toBe(1);
    expect(output).toContain('2 → 5 error(s)');
  });

  it('passes at exactly the recorded counts', () => {
    const baseline = write('b3.json', {
      comment: [],
      files: { 'packages/a/src/__tests__/dirty.test.ts': 2 },
    });
    const log = write(
      'l3.log',
      [1, 2].map((n) => diagnostic('packages/a/src/__tests__/dirty.test.ts', n)).join('\n'),
    );

    const { code, output } = runRatchet(log, baseline);

    expect(code).toBe(0);
    expect(output).toContain('No new type errors');
  });

  it('never punishes an improvement, and says the baseline can come down', () => {
    const baseline = write('b4.json', {
      comment: [],
      files: {
        'packages/a/src/__tests__/dirty.test.ts': 40,
        'packages/b/src/__tests__/now-clean.test.ts': 3,
      },
    });
    const log = write('l4.log', diagnostic('packages/a/src/__tests__/dirty.test.ts', 1));

    const { code, output } = runRatchet(log, baseline);

    expect(code).toBe(0);
    expect(output).toContain('Improved since the baseline');
    expect(output).toContain('packages/b/src/__tests__/now-clean.test.ts: 3 → 0');
  });

  it('rewrites the baseline with --update', () => {
    const baseline = write('b5.json', { comment: ['kept'], files: { 'old.test.ts': 99 } });
    const log = write('l5.log', diagnostic('packages/c/src/__tests__/new.test.ts', 1));

    const { code } = runRatchet(log, baseline, ['--update']);

    expect(code).toBe(0);
    const updated = JSON.parse(readFileSync(baseline, 'utf-8'));
    expect(updated.files).toEqual({ 'packages/c/src/__tests__/new.test.ts': 1 });
    expect(updated.comment).toEqual(['kept']);
  });
});
