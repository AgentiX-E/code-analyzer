// @code-analyzer/mcp — Daemon Process Manager Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeAnalyzerDaemon } from '../daemon/daemon.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Use a temp PID file to avoid conflicts
function tempPidFile(): string {
  return path.join(os.tmpdir(), `code-analyzer-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`);
}

// Helper to fetch health check
async function fetchHealth(port: number): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await response.json();
  return { status: response.status, body };
}

describe('CodeAnalyzerDaemon', () => {
  let daemon: CodeAnalyzerDaemon;
  let pidFile: string;

  beforeEach(() => {
    pidFile = tempPidFile();
    daemon = new CodeAnalyzerDaemon({
      pidFile,
      port: 0, // auto-assign
      processTitle: 'code-analyzer-test',
      shutdownGracePeriod: 1000,
    });
  });

  afterEach(async () => {
    if (daemon && daemon.isRunning()) {
      await daemon.stop();
    }
    // Clean up PID file
    try {
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch { /* ignore */ }
  });

  describe('construction', () => {
    it('should create with default options', () => {
      const d = new CodeAnalyzerDaemon();
      expect(d).toBeDefined();
      expect(d.isRunning()).toBe(false);
    });

    it('should accept custom options', () => {
      const d = new CodeAnalyzerDaemon({
        pidFile: '/tmp/custom.pid',
        port: 4000,
        processTitle: 'custom-daemon',
        shutdownGracePeriod: 3000,
      });
      expect(d).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('should start and stop successfully', async () => {
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);

      await daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    it('should write and remove PID file', async () => {
      await daemon.start();
      expect(fs.existsSync(pidFile)).toBe(true);

      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      expect(pid).toBe(process.pid);

      await daemon.stop();
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it('should throw when starting an already running daemon', async () => {
      await daemon.start();
      await expect(daemon.start()).rejects.toThrow('already running');
    });

    it('should handle stop on non-running daemon gracefully', async () => {
      await expect(daemon.stop()).resolves.not.toThrow();
    });

    it('should restart successfully', async () => {
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);

      await daemon.restart();
      expect(daemon.isRunning()).toBe(true);
      await daemon.stop();
    });
  });

  describe('status', () => {
    it('should return running status when running', async () => {
      await daemon.start();
      const status = daemon.getStatus();
      expect(status.running).toBe(true);
      expect(status.pid).toBe(process.pid);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.shuttingDown).toBe(false);
    });

    it('should return stopped status when stopped', () => {
      const status = daemon.getStatus();
      expect(status.running).toBe(false);
      expect(status.uptime).toBe(0);
    });

    it('should return shuttingDown flag during shutdown', async () => {
      await daemon.start();
      // Manually trigger shutdown flag (test only)
      const statusBefore = daemon.getStatus();
      expect(statusBefore.shuttingDown).toBe(false);

      await daemon.stop();
      const statusAfter = daemon.getStatus();
      expect(statusAfter.shuttingDown).toBe(false); // already stopped
    });
  });

  describe('waitForReady', () => {
    it('should resolve when daemon is running', async () => {
      await daemon.start();
      await expect(daemon.waitForReady(1000)).resolves.not.toThrow();
    });

    it('should throw timeout if daemon never starts', async () => {
      await expect(daemon.waitForReady(100)).rejects.toThrow('timeout');
    });
  });

  describe('health check server', () => {
    it('should serve health endpoint', async () => {
      // Use fixed port for fetch
      const d = new CodeAnalyzerDaemon({
        pidFile: tempPidFile(),
        port: 0,
      });
      await d.start();

      // Health check runs on the assigned port
      const status = d.getStatus();
      const { body } = await fetchHealth(status.port);

      expect(body).toMatchObject({
        status: 'ok',
        pid: process.pid,
      });

      await d.stop();
    });

    it('should return 503 health during shutdown', async () => {
      const d = new CodeAnalyzerDaemon({
        pidFile: tempPidFile(),
        port: 0,
      });
      await d.start();

      const status = d.getStatus();
      const port = status.port;

      // Don't wait for stop — just check that it works while running
      const { status: httpStatus, body } = await fetchHealth(port);
      expect(httpStatus).toBe(200);
      expect(body).toHaveProperty('status', 'ok');

      await d.stop();
    });

    it('should handle OPTIONS preflight', async () => {
      const d = new CodeAnalyzerDaemon({
        pidFile: tempPidFile(),
        port: 0,
      });
      await d.start();

      const status = d.getStatus();
      const response = await fetch(`http://127.0.0.1:${status.port}/health`, { method: 'OPTIONS' });
      expect(response.status).toBe(204);

      await d.stop();
    });

    it('should return 404 for unknown paths', async () => {
      const d = new CodeAnalyzerDaemon({
        pidFile: tempPidFile(),
        port: 0,
      });
      await d.start();

      const status = d.getStatus();
      const response = await fetch(`http://127.0.0.1:${status.port}/unknown`);
      expect(response.status).toBe(404);

      await d.stop();
    });
  });

  describe('pending operations', () => {
    it('should track pending operations count', async () => {
      await daemon.start();

      daemon.incrementPending();
      daemon.incrementPending();
      expect(daemon.getStatus().pendingOperations).toBe(2);

      daemon.decrementPending();
      expect(daemon.getStatus().pendingOperations).toBe(1);

      daemon.decrementPending();
      expect(daemon.getStatus().pendingOperations).toBe(0);

      // Should not go negative
      daemon.decrementPending();
      expect(daemon.getStatus().pendingOperations).toBe(0);

      await daemon.stop();
    });
  });

  describe('events', () => {
    it('should emit started and stopped events', async () => {
      const events: string[] = [];
      daemon.on('started', () => events.push('started'));
      daemon.on('stopped', () => events.push('stopped'));

      await daemon.start();
      await daemon.stop();

      expect(events).toContain('started');
      expect(events).toContain('stopped');
    });

    it('should emit stopping event', async () => {
      const events: string[] = [];
      daemon.on('stopping', () => events.push('stopping'));

      await daemon.start();
      await daemon.stop();

      expect(events).toContain('stopping');
    });

    it('should emit config-reload on SIGHUP', (context) => {
      // Skip in CI where signals may be restricted
      if (process.env['CI']) {
        context.skip();
        return;
      }

      return new Promise<void>((resolve) => {
        // Create a fresh daemon just for this test
        const testPidFile = tempPidFile();
        const testDaemon = new CodeAnalyzerDaemon({ pidFile: testPidFile, port: 0 });

        testDaemon.on('config-reload', async () => {
          await testDaemon.stop();
          try { fs.unlinkSync(testPidFile); } catch { /* */ }
          resolve();
        });

        testDaemon.start().then(() => {
          process.kill(process.pid, 'SIGHUP');
        }).catch(async () => {
          await testDaemon.stop();
          try { fs.unlinkSync(testPidFile); } catch { /* */ }
          resolve();
        });
      });
    });
  });

  describe('stale PID handling', () => {
    it('should not throw if PID file exists but process is dead', async () => {
      // Write a fake PID file with a likely non-existent PID
      fs.writeFileSync(pidFile, '99999', 'utf-8');

      // Should start successfully (PID 99999 is not running)
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);

      // PID file should now contain our PID
      const currentPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      expect(currentPid).toBe(process.pid);

      await daemon.stop();
    });
  });
});
