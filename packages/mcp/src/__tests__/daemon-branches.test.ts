// @code-analyzer/mcp — Daemon Branch Tests
// Exercises the stale-PID detection, PID file edge cases, shutdown-state health
// response, and pending-operation drain that the happy-path suite skips.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { CodeAnalyzerDaemon } from '../daemon/daemon.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';

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

  it('rejects when the health port is already taken', async () => {
    // Occupy a port, then ask the daemon for it: the listen fails asynchronously,
    // which is the only way the health server's `error` listener ever runs.
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    const taken = (blocker.address() as AddressInfo).port;

    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: taken, host: '127.0.0.1' });

    await expect(daemon.start()).rejects.toThrow(/Health server failed to start/);

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it('stops cleanly when it was never started', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });

    // No health server was ever created, so the stop path has to tolerate that
    // rather than dereference a null. Every other case here starts first.
    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  it('force-closes the health server once the grace period elapses', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({
      pidFile,
      port: 0,
      host: '127.0.0.1',
      shutdownGracePeriod: 20,
    });
    await daemon.start();

    // A kept-alive socket keeps `close()` from completing on its own, so the
    // grace-period branch is what has to finish the shutdown.
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: daemon.getStatus().port, path: '/health', agent },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.end();
    });

    await daemon.stop();

    agent.destroy();
    expect(daemon.getStatus().running).toBe(false);
  });

  it('stops and exits when a shutdown signal arrives', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0, shutdownGracePeriod: 50 });
    await daemon.start();

    const signals: string[] = [];
    daemon.on('signal', (s: string) => signals.push(s));
    const exits: number[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exits.push(code ?? 0);
      return undefined as never;
    }) as never);

    try {
      // The handler is a private field; invoking it is the only way to reach the
      // signal path, and `process.exit` is stubbed so the test process survives.
      await (
        daemon as unknown as { handleShutdownSignal: () => Promise<void> }
      ).handleShutdownSignal();
    } finally {
      exitSpy.mockRestore();
    }

    expect(signals).toEqual(['SIGTERM']);
    expect(exits).toEqual([0]);
  });

  it('emits signal and config-reload when a reload signal arrives', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });

    const events: string[] = [];
    daemon.on('signal', (s: string) => events.push(`signal:${s}`));
    daemon.on('config-reload', () => events.push('config-reload'));

    (daemon as unknown as { handleReloadSignal: () => void }).handleReloadSignal();

    // Order matters: a reload announces which signal caused it before telling the
    // readers to reload, so asserting the sequence pins both emits.
    expect(events).toEqual(['signal:SIGHUP', 'config-reload']);
  });

  it('force-closes the health server when a connection outlives the grace period', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({
      pidFile,
      port: 0,
      host: '127.0.0.1',
      shutdownGracePeriod: 30,
    });
    await daemon.start();

    // A socket that connects and then says nothing. `close()` waits for existing
    // connections to end, so with a short grace period the timer is what finishes
    // shutdown — the path a well-behaved client never triggers. An idle keep-alive
    // socket will not do: Node closes those itself on `close()`.
    const socket = net.connect(daemon.getStatus().port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));

    await daemon.stop();

    socket.destroy();
    expect(daemon.getStatus().running).toBe(false);
  });

  it('tolerates a stop whose health server was already released', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0, host: '127.0.0.1' });
    await daemon.start();

    // `stopHealthServer()` is reached only from `stop()`, and `stop()` returns early
    // unless the daemon is running — which `start()` cannot be without having created
    // the server. The null guard therefore covers a second, overlapping stop (SIGTERM
    // and SIGINT can land back to back). Releasing the server by hand reproduces that
    // state deterministically, where racing two real stops would not be.
    (daemon as unknown as { healthServer: unknown }).healthServer = null;

    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  it('exits non-zero when the shutdown itself fails', async () => {
    const pidFile = tempPidFile();
    cleanupPaths.push(pidFile);
    const daemon = new CodeAnalyzerDaemon({ pidFile, port: 0, shutdownGracePeriod: 50 });
    await daemon.start();

    // A listener that throws turns `stop()` into a rejection, which is the only way
    // the handler's catch arm is reached.
    daemon.on('stopped', () => {
      throw new Error('listener failed during shutdown');
    });
    const exits: number[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exits.push(code ?? 0);
      return undefined as never;
    }) as never);

    try {
      const handler = (daemon as unknown as { handleShutdownSignal: () => Promise<void> })
        .handleShutdownSignal;
      await handler();
    } finally {
      exitSpy.mockRestore();
    }

    expect(exits).toEqual([1]);
  });
});
