// @code-analyzer/mcp — Daemon Branch Tests
// Exercises the stale-PID detection, PID file edge cases, shutdown-state health
// response, and pending-operation drain that the happy-path suite skips.

import { describe, it, expect, afterEach } from 'vitest';
import { CodeAnalyzerDaemon } from '../daemon/daemon.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function tempPidFile(): string {
  return path.join(
    os.tmpdir(),
    `code-analyzer-branch-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`,
  );
}

async function fetchHealth(port: number): Promise<{ status: number; body: any }> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await response.json();
  return { status: response.status, body };
}

const cleanupPaths: string[] = [];
afterEach(() => {
  while (cleanupPaths.length) {
    const p = cleanupPaths.pop()!;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

describe('CodeAnalyzerDaemon — branch coverage', () => {
  it('refuses to start when a live process already holds the PID file', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    // The current test process is alive, so a PID file pointing at it triggers
    // the `existingPid !== null && isProcessRunning(existingPid)` guard.
    fs.writeFileSync(pidFile, String(process.pid), 'utf-8');
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });

    await expect(daemon.start()).rejects.toThrow(/already running with PID/);
  });

  it('creates the PID file directory when it does not exist', async () => {
    const dir = path.join(
      os.tmpdir(),
      `code-analyzer-mkdir-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const pidFile = path.join(dir, 'nested', 'daemon.pid');
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });

    await daemon.start();
    expect(fs.existsSync(pidFile)).toBe(true);
    await daemon.stop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('treats a non-numeric PID file as a stale (null) PID', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    fs.writeFileSync(pidFile, 'not-a-number', 'utf-8');
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });

    await expect(daemon.start()).resolves.not.toThrow();
    expect(fs.readFileSync(pidFile, 'utf-8').trim()).toBe(String(process.pid));
    await daemon.stop();
  });

  it('removes a PID file that is already gone without throwing', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });
    await daemon.start();
    // Simulate an externally-deleted PID file; stop() must not throw.
    fs.unlinkSync(pidFile);

    await expect(daemon.stop()).resolves.not.toThrow();
  });

  it('emits an error event when the PID file cannot be written', async () => {
    // Make the PID file's parent a regular FILE (not a directory) so that the
    // writeFileSync call fails, driving the write-error emission path.
    const blocker = path.join(
      os.tmpdir(),
      `code-analyzer-blocker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.writeFileSync(blocker, '');
    cleanupPaths.push(blocker);
    const pidFile = path.join(blocker, 'daemon.pid');
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });

    const errors: string[] = [];
    daemon.on('error', (e: Error) => errors.push(e.message));
    await daemon.start();
    expect(errors.some((m) => m.includes('Failed to write PID file'))).toBe(true);
    await daemon.stop();
  });

  it('serves a 503 shutting_down health response during shutdown', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({
      pidFile,
      port: 0,
      shutdownGracePeriod: 5000,
    });
    await daemon.start();

    // Block the drain so the daemon stays in the shutting-down window.
    daemon.incrementPending();
    const stopPromise = daemon.stop();
    await new Promise((r) => setTimeout(r, 50));

    const { status, body } = await fetchHealth(daemon.getStatus().port);
    expect(status).toBe(503);
    expect(body.status).toBe('shutting_down');

    daemon.decrementPending();
    await stopPromise;
  });

  it('force-drains pending operations after the grace period', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({
      pidFile,
      port: 0,
      shutdownGracePeriod: 100,
    });
    await daemon.start();

    daemon.incrementPending();
    const warnings: string[] = [];
    daemon.on('warning', (w: string) => warnings.push(w));

    await daemon.stop();
    expect(warnings.some((w) => w.includes('Force draining'))).toBe(true);
    expect(daemon.getStatus().pendingOperations).toBe(0);
  });

  it('drains pending operations to zero before a normal stop', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({
      pidFile,
      port: 0,
      shutdownGracePeriod: 1000,
    });
    await daemon.start();
    daemon.incrementPending();
    daemon.decrementPending();
    await daemon.stop();
    expect(daemon.getStatus().pendingOperations).toBe(0);
  });
});
