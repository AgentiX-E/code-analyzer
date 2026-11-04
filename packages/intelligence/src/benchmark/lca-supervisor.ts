// @code-analyzer/intelligence — one instance, one process, and a bound that is enforced rather than promised
//
// **The failure this module exists to convert.** The Kotlin leg of the Long Code Arena job died on its first instance:
// `airbnb/lottie-android`, eleven hundred files, an analysis that outgrew what the runner could hold, and a
// `SIGTERM` - `exit 143` - five minutes in. The row was lost, the part was lost, and the job said `The runner has
// received a shutdown signal`, which names the symptom and not the cause.
//
// **Every bound in the harness was a statement about the machine, and the analysis runs in a process.** `decideInstance`
// compared a checkout against the memory the *runner* had left (`room=4011` files), while the process that had to hold
// the result was capped at four gigabytes of heap - and tree-sitter's trees are native memory that no heap flag bounds.
// A budget computed from the larger number promises an analysis the smaller one cannot survive.
//
// **So the unit of execution becomes the unit of failure.** One instance is measured by one child process; the parent
// samples that process's resident set while it runs, kills it at a stated ceiling, and writes the row as *refused* with
// the number that refused it. Three things follow, and all three are measurements rather than intentions:
//
//   1. **A kill costs one row.** The measurement continues with the next instance, and the artifact says which instance
//      was too large for the runner it ran on.
//   2. **Resident memory stops accumulating.** V8 returns reclaimed pages to itself and not to the operating system, so
//      a process that analyses eight checkouts ends at the high-water mark of all eight. A process that analyses one
//      ends at its own, and the ninth instance starts where the first one did.
//   3. **The ceiling is enforced where it is spent.** The parent kills at `rssCapMb`; the heap flag is the child's own
//      bound. Neither is inferred from what the machine reports.
//
// **What this module is not.** It is not a scheduler and it does not decide whether an instance *should* run - that is
// `decideInstance`'s job, and it happens before a process is started. This module answers one question: given a command,
// did it produce a row, and if not, what stopped it.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';

import type { LcaRowScore } from './lca-merge.js';

/** What one supervised run produced. **Every refusal carries the sentence the artifact will publish.** */
export type InstanceOutcome =
  | {
      /** The child wrote a row. **It may still say `skipped`** - an analysis that threw inside the child records that
       * fact in its own row, which is a property of the repository rather than a refusal by the runner. */
      readonly kind: 'row';
      readonly row: LcaRowScore;
      readonly ms: number;
      readonly peakRssMb: number;
    }
  | {
      /** No row was written, and `because` is the sentence the artifact publishes. */
      readonly kind: 'refused';
      readonly because: string;
      readonly ms: number;
      readonly peakRssMb: number;
    };

/**
 * A note on `peakRssMb: 0`.
 *
 * **The figure is the largest resident set the parent *observed*, and a child that finishes before the first sample has
 * none.** That is stated rather than papered over with an initial reading: the first sample after `spawn` returns sees
 * a process that shares its pages with the parent copy-on-write, so an immediate reading would report the parent's
 * memory as the child's - a number that looks like a measurement and is not one. A zero therefore means "this instance
 * never reached a sampling point", which is also why it can never be the reason a row was refused.
 */

/** Everything a supervised run needs. **No defaults for the bounds**, because a bound nobody stated is not a bound. */
export interface SupervisorOptions {
  /** The executable, e.g. `npx` or `node`. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Where the child writes its row. **Deleted first**, so a stale row cannot be read as this run's. */
  readonly outFile: string;
  /** Resident megabytes the child may reach before it is killed. */
  readonly rssCapMb: number;
  /** Milliseconds the child may run before it is killed. */
  readonly timeoutMs: number;
  /** How often the resident set is sampled. */
  readonly pollMs?: number;
  /** Lines of the child's own output kept for the refusal sentence. */
  readonly tailLines?: number;
}

/** Default sampling interval: often enough to catch a runaway, cheap enough not to poll a scheduler. */
const DEFAULT_POLL_MS = 250;
/** How much of the child's output is kept. **A refusal quotes one line**, so the buffer is bounded. */
const DEFAULT_TAIL_LINES = 20;

/**
 * The resident set of a process, in megabytes, or `null` where the operating system does not publish it.
 *
 * **`VmRSS` and not `VmSize`.** Virtual size counts address space a process has reserved and may never touch - a Node
 * process reports several gigabytes of it while holding a hundred megabytes of pages - so a bound on `VmSize` would
 * kill healthy runs. `null` is returned rather than `0` for a missing file, because a monitor that reads a failure as
 * "no memory used" is a monitor that never fires.
 */
export function residentMbFromStatus(status: string): number | null {
  const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
  if (match === null) return null;
  const kilobytes = Number(match[1]);
  return Number.isFinite(kilobytes) ? Math.round(kilobytes / 1024) : null;
}

/**
 * The process group one pid leads, and the resident set of everything in it.
 *
 * **Sampling the child's own pid was measuring the wrapper.** With `npx tsx` the child is npm's shim and the analysis
 * runs in *its* child: on the first run of this design the Kotlin leg reported `peakRss=83MB` while the worker it had
 * started aborted at `exit 134` five minutes later. A ceiling read from the shim can never fire, so the question was
 * wrong rather than the number - **the memory an instance costs is the memory of its process group**.
 *
 * **The operating system's two files are an argument rather than an import**, because the alternative is a function
 * whose failure paths - a process that exits between the listing and the read, a status without `VmRSS`, a `stat` that
 * cannot be parsed - can only be reached by a race. `residentOfGroup` is the decision and takes the reader; the
 * exported `groupResidentMb` binds it to `/proc` and is what the supervisor calls.
 */
export interface ProcFilesystem {
  /** Every directory name under `/proc`, which is one per process plus a handful of kernel entries. */
  readonly list: () => string[];
  /** One file's contents, or a throw when the process has gone. */
  readonly read: (path: string) => string;
}

/**
 * Sum the resident sets of every process whose group leader is `leaderPid`.
 *
 * **`null` when the group cannot be seen at all**, which is the same contract as `readResidentMb`: a monitor that
 * cannot see must not report zero, because zero is a reading and blindness is not.
 */
export function residentOfGroup(leaderPid: number, proc: ProcFilesystem): number | null {
  let entries: string[];
  try {
    entries = proc.list();
  } catch {
    return null;
  }
  let total = 0;
  let seen = 0;
  for (const entry of entries) {
    const pid = Number.parseInt(entry, 10);
    // **A cheap filter before a read**: `/proc` holds a directory per process and a file per kernel knob.
    if (!Number.isFinite(pid)) continue;
    try {
      const stat = proc.read(`/proc/${entry}/stat`);
      // **The comm field may contain spaces and parentheses**, so the fields after it start at the last `)`. A stat
      // without one is not a stat, and its `pgrp` parses to `NaN`, which matches no leader - no guard needed.
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(' ');
      if (Number.parseInt(fields[2] ?? '', 10) !== leaderPid) continue;
      const rss = residentMbFromStatus(proc.read(`/proc/${entry}/status`));
      if (rss === null) continue;
      total += rss;
      seen += 1;
    } catch {
      // **A process that exits between the listing and the read** is the expected race, not an error.
      continue;
    }
  }
  return seen === 0 ? null : total;
}

/** The resident set of a process group, from the real `/proc`. */
export function groupResidentMb(leaderPid: number): number | null {
  return residentOfGroup(leaderPid, {
    list: () => readdirSync('/proc'),
    read: (path) => readFileSync(path, 'utf8'),
  });
}

/** The resident set of a process, in megabytes, or `null` where the operating system does not publish it. */
export function readResidentMb(pid: number): number | null {
  try {
    return residentMbFromStatus(readFileSync(`/proc/${String(pid)}/status`, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * What the sample that just arrived means: **the sentence that stops this child, or `null` to let it run**.
 *
 * **A pure function because the alternative is a closure nobody can test.** The ways a sample can end a run - the
 * ceiling, the clock, and a sample that is not a number - are decisions with numbers in them, and a decision inside a
 * `setInterval` callback is one that only a killed runner ever exercises.
 */
export function ceilingBreach(input: {
  readonly rssMb: number | null;
  readonly capMb: number;
  readonly elapsedMs: number;
  readonly timeoutMs: number;
  readonly alreadyStopped: boolean;
}): string | null {
  if (input.alreadyStopped) return null;
  // **An unreadable sample is not a breach.** The process may have exited between the read and the parse, and killing
  // a dead process would report a ceiling that never fired.
  if (input.rssMb === null) return null;
  if (input.rssMb > input.capMb) {
    return (
      `the analysis reached ${String(input.rssMb)} MB resident, above the stated ceiling of ` +
      `${String(input.capMb)} MB, and was stopped`
    );
  }
  if (input.elapsedMs > input.timeoutMs) {
    return (
      `the analysis had not finished after ${String(input.timeoutMs)} ms and was stopped with ` +
      `${String(input.rssMb)} MB resident`
    );
  }
  return null;
}

/**
 * Whether a parsed value is a row this harness can publish.
 *
 * **Checked rather than cast**, because the child is a separate program: a crash mid-write leaves valid JSON with the
 * wrong shape, and a row with no `id` would be published as an instance that scored zero.
 */
export function isRow(value: unknown): value is LcaRowScore {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<LcaRowScore>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.repo === 'string' &&
    typeof candidate.map === 'number' &&
    (candidate.skipped === null || typeof candidate.skipped === 'string') &&
    typeof candidate.retrieval === 'object' &&
    candidate.retrieval !== null
  );
}

/** The last non-empty line of a child's output, **which is the line that names a defect**. */
export function lastLine(lines: readonly string[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line !== undefined && line.trim().length > 0) return line.trim();
  }
  return '';
}

/**
 * Stop a child **and anything it started**.
 *
 * **The process group, not the process.** The child is spawned detached, so it leads its own group; killing only the
 * leader leaves a `git` or a parser worker holding the memory the ceiling was meant to free. `process.kill` throws for
 * an already-dead group, which is the expected case when a child exits between the sample and the kill.
 */
export function stopProcessTree(
  pid: number,
  kill: (pid: number, signal: NodeJS.Signals) => void,
): void {
  try {
    kill(-pid, 'SIGKILL');
  } catch {
    try {
      kill(pid, 'SIGKILL');
    } catch {
      // **Already gone**: a process that exited between the sample and the kill is the outcome this function wants.
    }
  }
}

/** The row a child left behind, or `null` when it left something that is not one. */
function readRow(outFile: string): LcaRowScore | null {
  if (!existsSync(outFile)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(outFile, 'utf8'));
    // **`in` narrows the object, so no assertion is needed** - and the lint gate proved it by refusing the cast.
    const candidate =
      parsed !== null && typeof parsed === 'object' && 'row' in parsed ? parsed.row : parsed;
    return isRow(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Run one instance and report what happened to it.
 *
 * **The order of the checks on exit is the design.** A row that exists and parses is a measurement whatever the exit
 * code was, because the child writes the row before it flushes and a non-zero exit after a written row is a cleanup
 * failure rather than a measurement failure. A missing row is a refusal, and which refusal it is comes from the reason
 * the child stopped: the ceiling, the clock, the signal, or its own exit code.
 */
export function superviseInstance(options: SupervisorOptions): Promise<InstanceOutcome> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const tailLines = options.tailLines ?? DEFAULT_TAIL_LINES;
  const startedAt = Date.now();

  // **A stale row is the worst possible input**, because it is indistinguishable from a fresh one and would score an
  // instance twice.
  rmSync(options.outFile, { force: true });

  return new Promise<InstanceOutcome>((resolve) => {
    const output: string[] = [];
    let peakRssMb = 0;
    let stoppedBecause: string | null = null;

    const child = spawn(options.command, [...options.args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
      // **Its own process group**, so the kill reaches what the child started (see `stop`).
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const keep = (chunk: Buffer): void => {
      // **Bounded**: the child's full output is not the artifact, and an unbounded buffer is a leak with a friendly name.
      output.push(...chunk.toString('utf8').split('\n'));
      while (output.length > tailLines) output.shift();
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);

    // **The pid is read once, and a spawn that produced no process is not sampled.** `spawn` answers `undefined` for a
    // binary that does not exist, and its `error` event is what carries the reason; a sampling loop over no process
    // would only repeat that answer as a timeout.
    const pid = child.pid;
    const timer =
      pid === undefined
        ? null
        : setInterval(() => {
            // **The group, not the process**: `npx` is a shim and the analysis runs in its child, which is why the first
            // run of this design reported 83 MB while the worker aborted at `exit 134`.
            const rss = groupResidentMb(pid);
            // **`?? 0` rather than a guard**: an unreadable sample cannot raise a maximum, and a branch whose arm is
            // "the process was gone when we looked" is one only a race can reach.
            peakRssMb = Math.max(peakRssMb, rss ?? 0);
            const breach = ceilingBreach({
              rssMb: rss,
              capMb: options.rssCapMb,
              elapsedMs: Date.now() - startedAt,
              timeoutMs: options.timeoutMs,
              alreadyStopped: stoppedBecause !== null,
            });
            if (breach === null) return;
            stoppedBecause = breach;
            stopProcessTree(pid, (target, signal) => process.kill(target, signal));
          }, pollMs);

    // **`close` rather than `exit`**: `exit` fires when the process ends, `close` when its output is drained, and a row
    // written immediately before the exit is read from the file rather than the pipe - but the refusal sentence comes
    // from the pipe, and a sentence read before the drain is a sentence with its last line missing.
    child.on('close', (code, signal) => {
      if (timer !== null) clearInterval(timer);
      const ms = Date.now() - startedAt;
      const row = readRow(options.outFile);
      if (row !== null) {
        resolve({ kind: 'row', row, ms, peakRssMb });
        return;
      }
      const tail = lastLine(output);
      const exit =
        signal !== null
          ? `the instance process was killed by ${signal}`
          : `the instance process exited with code ${String(code)}`;
      const why = stoppedBecause ?? (tail === '' ? exit : `${exit}: ${tail}`);
      resolve({ kind: 'refused', because: why, ms, peakRssMb });
    });

    // **A spawn that never starts is a refusal, not a hang.** `error` fires for a missing executable and for a
    // permission failure, and both are properties of the job rather than of the instance.
    // **`close` always follows `error`**, so the interval is cleared there rather than twice: a handler that clears it
    // in both places has an arm - "an error after a process started" - that no spawn failure produces.
    child.on('error', (error) => {
      resolve({
        kind: 'refused',
        because: `the instance process could not be started: ${error.message}`,
        ms: Date.now() - startedAt,
        peakRssMb,
      });
    });
  });
}
