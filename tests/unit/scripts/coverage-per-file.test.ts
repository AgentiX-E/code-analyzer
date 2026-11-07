// code-analyzer — the per-file coverage gate's contract.
//
// `scripts/coverage-per-file.js` exists because the aggregate gate reads only `total`,
// which is how thirteen files sat between 50% and 94% while CI stayed green. The thing
// worth testing is therefore not the summary line but the three rules that make the gate
// both strict and honest: it fails on a below-threshold file, it fails when a file drops
// under a recorded floor, and it *skips* a file that has no countable code rather than
// failing it. A gate that cannot fail is worse than no gate; a gate that fails on an
// empty file teaches people to delete files.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'scripts/coverage-per-file.js';

/** A per-file entry with the given dimension percentages and non-zero totals. */
function fileEntry(pcts: {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}) {
  const dim = (pct: number) => ({ total: 100, covered: pct, skipped: 0, pct });
  return {
    lines: dim(pcts.lines),
    branches: dim(pcts.branches),
    functions: dim(pcts.functions),
    statements: dim(pcts.statements),
  };
}

/** What a pure type module looks like to v8: countable-looking entries with zero totals. */
function emptyFileEntry() {
  const dim = () => ({ total: 0, covered: 0, skipped: 0, pct: 0 });
  return { lines: dim(), branches: dim(), functions: dim(), statements: dim() };
}

const PASSING = { lines: 100, branches: 100, functions: 100, statements: 100 };

/** An absolute path under the repo root, so the gate can match it against the exclusion list. */
function repoPath(relativePath: string): string {
  return join(process.cwd(), relativePath);
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'per-file-gate-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(name: string, contents: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

/** Run the gate and return its exit code plus combined output. */
function runGate(summaryPath: string, exclusionsPath?: string) {
  const argv = [SCRIPT, '--json', summaryPath];
  if (exclusionsPath) argv.push('--exclusions', exclusionsPath);
  const result = spawnSync('node', argv, { encoding: 'utf-8' });
  return {
    code: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('coverage-per-file gate', () => {
  it('fails when the summary is missing', () => {
    const { code, output } = runGate(join(dir, 'does-not-exist.json'));

    expect(code).toBe(1);
    expect(output).toContain('Coverage summary not found');
  });

  it('passes when every file with countable code meets the threshold', () => {
    const summary = writeJson('all-pass.json', {
      total: fileEntry(PASSING),
      [repoPath('packages/foo/src/a.ts')]: fileEntry(PASSING),
      [repoPath('packages/foo/src/b.ts')]: fileEntry({ ...PASSING, branches: 95.5 }),
    });

    const { code, output } = runGate(summary);

    expect(code).toBe(0);
    expect(output).toContain('2 checked');
    expect(output).toContain('Every file with countable code meets the threshold');
  });

  it('fails on a single file below the threshold and names the dimension', () => {
    const summary = writeJson('one-below.json', {
      total: fileEntry(PASSING), // the aggregate is perfect — that is the whole point
      [repoPath('packages/foo/src/a.ts')]: fileEntry(PASSING),
      [repoPath('packages/foo/src/regressed.ts')]: fileEntry({ ...PASSING, branches: 76.47 }),
    });

    const { code, output } = runGate(summary);

    expect(code).toBe(1);
    expect(output).toContain('packages/foo/src/regressed.ts');
    expect(output).toContain('branch 76.47% < 95%');
    // The aggregate line must not be what decided the verdict.
    expect(output).toContain('::error title=Per-file coverage::');
  });

  it('skips a file with no countable code instead of failing it', () => {
    const summary = writeJson('pure-types.json', {
      total: fileEntry(PASSING),
      [repoPath('packages/foo/src/a.ts')]: fileEntry(PASSING),
      [repoPath('packages/foo/src/types.ts')]: emptyFileEntry(),
    });

    const { code, output } = runGate(summary);

    expect(code).toBe(0);
    expect(output).toContain('1 skipped (no countable code)');
  });

  it('holds an excluded file to its recorded floor, not to the threshold', () => {
    const exclusions = writeJson('exclusions.json', {
      exclusions: {
        'packages/bar/src/platform.ts': {
          reason: 'platform-dependent arms',
          floors: { branches: 85 },
        },
      },
    });
    const atFloor = writeJson('at-floor.json', {
      total: fileEntry(PASSING),
      [repoPath('packages/bar/src/platform.ts')]: fileEntry({ ...PASSING, branches: 85.18 }),
    });

    const passing = runGate(atFloor, exclusions);

    expect(passing.code).toBe(0);
    expect(passing.output).toContain('recorded floor');
    expect(passing.output).toContain('branches ≥ 85%');
  });

  it('fails a file that drops below its own recorded floor', () => {
    const exclusions = writeJson('exclusions-2.json', {
      exclusions: {
        'packages/bar/src/platform.ts': {
          reason: 'platform-dependent arms',
          floors: { branches: 85 },
        },
      },
    });
    const belowFloor = writeJson('below-floor.json', {
      total: fileEntry(PASSING),
      [repoPath('packages/bar/src/platform.ts')]: fileEntry({ ...PASSING, branches: 80 }),
    });

    const { code, output } = runGate(belowFloor, exclusions);

    expect(code).toBe(1);
    expect(output).toContain('inside a recorded floor');
    expect(output).toContain('branch 80.00% < 85%');
  });
});

// A gate that reads a report without asking when it was written answers a question about the past. The per-file
// gate went green on a commit the runner then failed, because the artifact it read had been produced half an hour
// before the file it named was rewritten — so the rule these cases fix is that the report must be at least as new
// as the sources it claims to have measured.
describe('coverage-per-file gate — a report is evidence only if it is current', () => {
  /** A source file with an explicit modification time, so the comparison is not a race with the test clock. */
  function sourceAt(name: string, mtime: Date): string {
    const path = join(dir, name);
    writeFileSync(path, 'export const value = 1;\n');
    utimesSync(path, mtime, mtime);
    return path;
  }

  it('fails a report written before the source it describes, and says how far behind it is', () => {
    const source = sourceAt('stale-source.ts', new Date('2026-11-07T12:30:00Z'));
    const summary = writeJson('stale.json', {
      total: fileEntry(PASSING),
      [source]: fileEntry(PASSING),
    });
    const writtenAt = new Date('2026-11-07T12:00:00Z');
    utimesSync(summary, writtenAt, writtenAt);

    const { code, output } = runGate(summary);

    expect(code).toBe(1);
    expect(output).toContain('older than a source file it describes');
    expect(output).toContain('stale-source.ts');
    // The lag is the diagnosis: thirty minutes is the incident this rule was written for.
    expect(output).toContain('30m');
    expect(output).toContain('::error title=Stale coverage report::');
  });

  it('accepts a report written after every source it names', () => {
    const source = sourceAt('fresh-source.ts', new Date('2026-11-07T12:00:00Z'));
    const summary = writeJson('fresh.json', {
      total: fileEntry(PASSING),
      [source]: fileEntry(PASSING),
    });
    const writtenAt = new Date('2026-11-07T12:30:00Z');
    utimesSync(summary, writtenAt, writtenAt);

    expect(runGate(summary).code).toBe(0);
  });

  it('does not mistake a vanished path for a stale report', () => {
    // A summary from an older tree names files that are gone. Whether a recorded path still exists is a separate
    // question with its own gate (`baselines:anchors`); reporting it here would answer one with the other.
    const summary = writeJson('vanished.json', {
      total: fileEntry(PASSING),
      [join(dir, 'deleted-long-ago.ts')]: fileEntry(PASSING),
    });
    const writtenAt = new Date('2020-01-01T00:00:00Z');
    utimesSync(summary, writtenAt, writtenAt);

    expect(runGate(summary).code).toBe(0);
  });
});
