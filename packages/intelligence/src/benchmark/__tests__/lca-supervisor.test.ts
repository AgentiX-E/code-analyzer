// The supervisor's own tests, against real child processes.
//
// **Why these are children rather than stubs.** The supervisor's job is to judge what a process did - wrote a row,
// exited, was killed at a ceiling, never finished - and a stub would be this file asserting that its own idea of those
// outcomes is its own idea. Every case here starts a real `node` process that really writes, really fails, really
// allocates, and really sleeps; the only thing that is simulated is the work, because the work is another module's
// subject and has its own tests.
//
// **The three failure modes are the three ways the Kotlin leg died**, so each is pinned by a test rather than by a
// comment: a process killed at a memory ceiling, a process that outlives its clock, and a process that exits without
// leaving a row.

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawn } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ceilingBreach,
  isRow,
  lastLine,
  readResidentMb,
  residentMbFromStatus,
  stopProcessTree,
  superviseInstance,
} from '../lca-supervisor.js';

const SCRATCH = mkdtempSync(join(tmpdir(), 'lca-supervisor-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** A row that satisfies the shape the artifact publishes, built by hand so a case can assert one field at a time. */
function rowJson(id: number): string {
  return JSON.stringify({
    row: {
      id,
      repo: 'owner/repo',
      corpusFiles: 10,
      expectedFiles: 1,
      expectedOutside: 0,
      offered: 3,
      outside: 0,
      offeredPaths: ['a.py'],
      skipped: null,
      retrieval: { at1: {} },
      map: 0.5,
      answer: null,
    },
  });
}

describe('readResidentMb', () => {
  it('reads the resident set of a live process off /proc', () => {
    const resident = readResidentMb(process.pid);
    expect(resident).not.toBeNull();
    // **A Node process holding a test runner is more than a megabyte**, so a figure of zero is a parse defect rather
    // than a small process.
    expect(resident!).toBeGreaterThan(1);
  });

  it('answers null for a process that does not exist, rather than zero', () => {
    // A monitor that read a missing file as "no memory used" would never fire, which is the defect this pins.
    expect(readResidentMb(2_147_483_646)).toBeNull();
  });
});

describe('residentMbFromStatus', () => {
  it('reads VmRSS and not VmSize, because a reserved page is not a used one', () => {
    const status = 'Name:\tnode\nVmSize:\t 4096000 kB\nVmRSS:\t  204800 kB\nThreads:\t11\n';
    expect(residentMbFromStatus(status)).toBe(200);
  });

  it('answers null for a value that is not a number at all', () => {
    // **A corrupt read**: the pattern matches digits, and four hundred of them overflow to `Infinity`. A monitor that
    // published that as a figure would kill a healthy child at once.
    expect(residentMbFromStatus(`VmRSS:\t${'9'.repeat(400)} kB`)).toBeNull();
  });

  it('answers null for a status without the field rather than zero', () => {
    // **A zero would read as "this process is using no memory"**, which is the opposite of what a missing field means.
    expect(residentMbFromStatus('Name:\tnode\nVmSize:\t 4096000 kB\n')).toBeNull();
  });
});

describe('ceilingBreach', () => {
  const base = { rssMb: 100, capMb: 1000, elapsedMs: 0, timeoutMs: 1000, alreadyStopped: false };

  it('lets a run continue while it is under both bounds', () => {
    expect(ceilingBreach(base)).toBeNull();
  });

  it('names the ceiling and the figure that passed it', () => {
    const breach = ceilingBreach({ ...base, rssMb: 1400 });
    expect(breach).toContain('1400 MB resident');
    expect(breach).toContain('1000 MB');
  });

  it('names the clock, and how much memory the run held when it ran out', () => {
    const breach = ceilingBreach({ ...base, elapsedMs: 5000, rssMb: 300 });
    expect(breach).toContain('had not finished after 1000 ms');
    expect(breach).toContain('300 MB resident');
  });

  it('does not breach on an unreadable sample, which is a process that has already gone', () => {
    expect(ceilingBreach({ ...base, rssMb: null, elapsedMs: 5000 })).toBeNull();
  });

  it('reports the first breach only, so a kill is explained once', () => {
    expect(ceilingBreach({ ...base, rssMb: 1400, alreadyStopped: true })).toBeNull();
  });
});

describe('stopProcessTree', () => {
  it('kills the process group when the child leads one', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      detached: true,
      stdio: 'ignore',
    });
    const exited = new Promise<void>((resolve) => child.on('close', () => resolve()));
    stopProcessTree(child.pid!, (pid, signal) => process.kill(pid, signal));
    await exited;
    expect(child.killed || child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('falls back to the process itself when there is no group to signal', async () => {
    // **Not detached**, so `kill(-pid)` has no group and throws ESRCH; the fallback is what actually stops it.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore',
    });
    const exited = new Promise<void>((resolve) => child.on('close', () => resolve()));
    stopProcessTree(child.pid!, (pid, signal) => process.kill(pid, signal));
    await exited;
    expect(child.signalCode).toBe('SIGKILL');
  });

  it('says nothing when the process is already gone', () => {
    // **The expected race**: a child that exits between the sample and the kill. Both attempts throw and neither is an
    // error the caller has to handle.
    expect(() =>
      stopProcessTree(2_147_483_646, (pid, signal) => process.kill(pid, signal)),
    ).not.toThrow();
  });
});

describe('lastLine', () => {
  it('takes the last line that says something', () => {
    expect(lastLine(['first', '', '  the defect  ', ''])).toBe('the defect');
  });

  it('answers an empty string when nothing was written', () => {
    expect(lastLine([])).toBe('');
    expect(lastLine(['', '   '])).toBe('');
  });
});

describe('isRow', () => {
  it('accepts a row the artifact can publish', () => {
    expect(isRow(JSON.parse(rowJson(7)).row)).toBe(true);
  });

  it('refuses a value with the right keys and the wrong types', () => {
    const parsed: unknown = JSON.parse(rowJson(7)).row;
    expect(isRow({ ...(parsed as object), id: 'seven' })).toBe(false);
    expect(isRow({ ...(parsed as object), map: null })).toBe(false);
    expect(isRow({ ...(parsed as object), skipped: 3 })).toBe(false);
    expect(isRow({ ...(parsed as object), retrieval: null })).toBe(false);
    expect(isRow(null)).toBe(false);
    expect(isRow('row')).toBe(false);
  });
});

describe('superviseInstance', () => {
  it('takes the row a child wrote, and reports the resident set it saw', async () => {
    const outFile = join(SCRATCH, 'written.json');
    // **The child stays alive past one sampling interval**, because a peak is a figure the parent observed: a child
    // that exits in twenty milliseconds never reaches a sample, and its peak is reported as zero rather than invented.
    const outcome = await superviseInstance({
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(outFile)}, ${JSON.stringify(rowJson(11))});` +
          'setTimeout(() => {}, 400)',
      ],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('row');
    if (outcome.kind !== 'row') return;
    expect(outcome.row.id).toBe(11);
    expect(outcome.peakRssMb).toBeGreaterThan(0);
  });

  it('reads a bare row as well as a wrapped one, because two callers write two shapes', async () => {
    const outFile = join(SCRATCH, 'bare.json');
    const bare = (JSON.parse(rowJson(12)) as { row: unknown }).row;
    const outcome = await superviseInstance({
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(outFile)}, ${JSON.stringify(JSON.stringify(bare))})`,
      ],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('row');
  });

  it('deletes a stale row first, so a child that writes nothing is not scored twice', async () => {
    const outFile = join(SCRATCH, 'stale.json');
    // The stale row is a *valid* row, which is the only version of this that can be confused with a measurement.
    writeFileSync(outFile, rowJson(99), 'utf8');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: ['-e', 'process.exitCode = 1'],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.because).toContain('exited with code 1');
  });

  it('quotes the last line a failing child printed', async () => {
    const outFile = join(SCRATCH, 'noisy.json');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: ['-e', "console.error('the analysis failed: ENOENT'); process.exitCode = 3"],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.because).toContain('code 3');
    expect(outcome.because).toContain('the analysis failed: ENOENT');
  });

  it('stops a child that outlives its clock, and says how long it had', async () => {
    const outFile = join(SCRATCH, 'slow.json');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 400,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.because).toContain('had not finished after 400 ms');
    // **The kill is real**: the run ends near its clock rather than at the child's own sleep.
    expect(outcome.ms).toBeLessThan(20_000);
  });

  it('stops a child that passes its resident ceiling, and names the figure that refused it', async () => {
    const outFile = join(SCRATCH, 'hungry.json');
    // **Real allocation, touched**: `Buffer.alloc` is zero-filled by the allocator, so the pages exist whether or not
    // the process reads them. Two hundred megabytes against a hundred-megabyte ceiling is a breach no sampling
    // interval can miss at fifty milliseconds.
    const script = [
      'const held = [];',
      'for (let i = 0; i < 8; i += 1) held.push(Buffer.alloc(32 * 1024 * 1024, 1));',
      "process.stdout.write('allocated\\n');",
      'setTimeout(() => {}, 60000);',
    ].join('\n');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: ['--max-old-space-size=256', '-e', script],
      outFile,
      rssCapMb: 120,
      timeoutMs: 30_000,
      pollMs: 20,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.because).toContain('resident');
    expect(outcome.because).toContain('120 MB');
  });

  it('refuses an output file that is not a row, rather than publishing it', async () => {
    const outFile = join(SCRATCH, 'garbage.json');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(outFile)}, '{"row": {"id": "x"}}')`,
      ],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('refused');
  });

  it('refuses unreadable output rather than throwing', async () => {
    const outFile = join(SCRATCH, 'truncated.json');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(outFile)}, '{"row": ')`],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('refused');
  });

  it('reports a command that cannot be started as a refusal', async () => {
    const outcome = await superviseInstance({
      command: join(SCRATCH, 'no-such-executable'),
      args: [],
      outFile: join(SCRATCH, 'missing.json'),
      rssCapMb: 512,
      timeoutMs: 5_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.because).toContain('could not be started');
  });

  it('passes the environment the caller stated, and only that', async () => {
    const outFile = join(SCRATCH, 'env.json');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({` +
          `row: {id: 13, repo: 'o/r', corpusFiles: 1, expectedFiles: 1, expectedOutside: 0, offered: 1, outside: 0,` +
          `offeredPaths: [], skipped: process.env.LCA_MARK === 'yes' ? null : 'no mark', retrieval: {}, map: 0,` +
          `answer: null}}))`,
      ],
      outFile,
      env: { LCA_MARK: 'yes' },
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('row');
    if (outcome.kind !== 'row') return;
    expect(outcome.row.skipped).toBeNull();
  });

  it('keeps the default bounds when the caller states none, and quotes the last of a long output', async () => {
    // **The defaults are part of the contract**: an interval of a quarter second and twenty lines of tail. A child that
    // prints more than the tail is a child whose first lines are dropped, and the sentence must quote the last one.
    const outFile = join(SCRATCH, 'chatty.json');
    const script = [
      'for (let i = 0; i < 40; i += 1) console.error(`line ${i}`);',
      "console.error('the defect is here');",
      'process.exitCode = 4;',
    ].join('\n');
    const outcome = await superviseInstance({
      command: process.execPath,
      args: ['-e', script],
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.because).toContain('code 4');
    expect(outcome.because).toContain('the defect is here');
  });

  it('runs the child in the directory the caller named', async () => {
    // **`cwd` is how a harness measures the checkout it was given** rather than the directory the parent happens to be
    // in, so the child's own answer is what the test reads.
    const outFile = join(SCRATCH, 'cwd.json');
    const row = (JSON.parse(rowJson(21)) as { row: Record<string, unknown> }).row;
    const script =
      'const fs = require("node:fs");' +
      `fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({row: {...${JSON.stringify(row)},` +
      ' repo: process.cwd()}}));';
    const outcome = await superviseInstance({
      command: process.execPath,
      args: ['-e', script],
      cwd: SCRATCH,
      outFile,
      rssCapMb: 4096,
      timeoutMs: 30_000,
      pollMs: 50,
    });
    expect(outcome.kind).toBe('row');
    if (outcome.kind !== 'row') return;
    // **`realpath`, because `/tmp` is a symlink on macOS** and the comparison would otherwise fail for a reason that
    // has nothing to do with the supervisor.
    expect(realpathSync(outcome.row.repo)).toBe(realpathSync(SCRATCH));
  });
});
