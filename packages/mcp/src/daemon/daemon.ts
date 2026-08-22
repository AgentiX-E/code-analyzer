// @code-analyzer/mcp — Daemon Process Manager
// Manages the MCP server as a long-running daemon process with PID file,
// signal handling, health checks, and graceful shutdown sequencing.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DaemonOptions {
  /** PID file path (default: /tmp/code-analyzer.pid) */
  pidFile?: string;
  /** HTTP port for health checks (default: 3000) */
  port?: number;
  /** HTTP host for health checks (default: '127.0.0.1') */
  host?: string;
  /** Process title to set (default: 'code-analyzer-daemon') */
  processTitle?: string;
  /** Shutdown grace period in ms before force kill (default: 5000) */
  shutdownGracePeriod?: number;
}

export interface DaemonStatus {
  /** Whether the daemon is currently running */
  running: boolean;
  /** Process ID */
  pid: number;
  /** Daemon uptime in milliseconds */
  uptime: number;
  /** Port the health check server is on */
  port: number;
  /** Timestamp the daemon was started */
  startedAt: string;
  /** Number of pending operations to drain before shutdown */
  pendingOperations: number;
  /** Whether the daemon is in the process of shutting down */
  shuttingDown: boolean;
}

// ---------------------------------------------------------------------------
// CodeAnalyzerDaemon
// ---------------------------------------------------------------------------

export class CodeAnalyzerDaemon extends EventEmitter {
  private pidFile: string;
  private port: number;
  private host: string;
  private processTitle: string;
  private shutdownGracePeriod: number;

  private startTime: number;
  private running: boolean;
  private shuttingDown: boolean;
  private pendingOperations: number;
  private healthServer: ReturnType<typeof import('node:http').createServer> | null;

  constructor(options: DaemonOptions = {}) {
    super();
    this.pidFile = options.pidFile ?? '/tmp/code-analyzer.pid';
    this.port = options.port ?? 3000;
    this.host = options.host ?? '127.0.0.1';
    this.processTitle = options.processTitle ?? 'code-analyzer-daemon';
    this.shutdownGracePeriod = options.shutdownGracePeriod ?? 5000;

    this.startTime = 0;
    this.running = false;
    this.shuttingDown = false;
    this.pendingOperations = 0;
    this.healthServer = null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start the daemon process. */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Daemon is already running');
    }

    // Check for existing daemon (stale PID file)
    const existingPid = this.readPidFile();
    if (existingPid !== null && this.isProcessRunning(existingPid)) {
      throw new Error(`Daemon is already running with PID ${existingPid}`);
    }

    // Clean up stale PID file
    if (existingPid !== null) {
      this.removePidFile();
    }

    // Write PID file
    this.writePidFile();

    // Set process title
    try {
      process.title = this.processTitle;
    } catch {
      // process.title may not be settable in some environments
    }

    // Register signal handlers
    this.registerSignalHandlers();

    // Start health check server
    await this.startHealthServer();

    this.startTime = Date.now();
    this.running = true;
    this.shuttingDown = false;

    this.emit('started', { pid: process.pid, port: this.port });
  }

  /** Stop the daemon gracefully. */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.shuttingDown = true;
    this.emit('stopping');

    // Stop accepting new connections
    // (health check server will respond with 503 during shutdown)

    // Wait for pending operations to drain
    await this.drainPendingOperations();

    // Stop health server
    await this.stopHealthServer();

    // Remove PID file
    this.removePidFile();

    // Remove signal handlers
    this.unregisterSignalHandlers();

    this.running = false;
    this.shuttingDown = false;
    this.startTime = 0;

    this.emit('stopped');
  }

  /** Restart the daemon. */
  async restart(): Promise<void> {
    await this.stop();
    // Small delay to ensure clean stop
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.start();
  }

  // -------------------------------------------------------------------------
  // Status & Health
  // -------------------------------------------------------------------------

  /** Get the current daemon status. */
  getStatus(): DaemonStatus {
    return {
      running: this.running,
      pid: process.pid,
      uptime: this.running ? Date.now() - this.startTime : 0,
      port: this.port,
      startedAt: this.running ? new Date(this.startTime).toISOString() : '',
      pendingOperations: this.pendingOperations,
      shuttingDown: this.shuttingDown,
    };
  }

  /** Check if the daemon is running. */
  isRunning(): boolean {
    return this.running && !this.shuttingDown;
  }

  /** Wait until the daemon is ready to accept connections. */
  async waitForReady(timeoutMs: number = 10000): Promise<void> {
    const start = Date.now();
    while (!this.isRunning()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Daemon failed to become ready within timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Increment pending operations count (called before processing a request). */
  incrementPending(): void {
    this.pendingOperations++;
  }

  /** Decrement pending operations count (called after processing a request). */
  decrementPending(): void {
    if (this.pendingOperations > 0) {
      this.pendingOperations--;
    }
  }

  // -------------------------------------------------------------------------
  // PID File Management
  // -------------------------------------------------------------------------

  private writePidFile(): void {
    try {
      const dir = path.dirname(this.pidFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.pidFile, String(process.pid), { encoding: 'utf-8', mode: 0o644 });
    } catch (err) {
      this.emit(
        'error',
        new Error(`Failed to write PID file: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  private removePidFile(): void {
    try {
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private readPidFile(): number | null {
    try {
      if (fs.existsSync(this.pidFile)) {
        const content = fs.readFileSync(this.pidFile, 'utf-8').trim();
        const pid = parseInt(content, 10);
        return isNaN(pid) ? null : pid;
      }
    } catch {
      // File may be inaccessible
    }
    return null;
  }

  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 does not actually send a signal but checks if the process exists
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Health Check Server
  // -------------------------------------------------------------------------

  private async startHealthServer(): Promise<void> {
    const http = await import('node:http');

    this.healthServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/health' || req.url === '/') {
        const status = this.getStatus();
        const healthResponse = {
          status: this.shuttingDown ? 'shutting_down' : this.running ? 'ok' : 'stopped',
          timestamp: new Date().toISOString(),
          pid: status.pid,
          uptime: status.uptime,
          port: status.port,
          startedAt: status.startedAt,
          pendingOperations: status.pendingOperations,
        };

        if (this.shuttingDown) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify(healthResponse, null, 2));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.healthServer!.on('error', (err: Error) => {
        reject(new Error(`Health server failed to start: ${err.message}`));
      });

      this.healthServer!.listen(this.port, this.host, () => {
        // Update port to the actual assigned port (useful when port: 0 for auto-assign)
        const addr = this.healthServer!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  private async stopHealthServer(): Promise<void> {
    if (!this.healthServer) return;

    return new Promise<void>((resolve) => {
      // Stop accepting new connections immediately
      this.healthServer!.close(() => {
        this.healthServer = null;
        resolve();
      });

      // Force close after grace period
      setTimeout(() => {
        if (this.healthServer) {
          this.healthServer.close();
          this.healthServer = null;
          resolve();
        }
      }, this.shutdownGracePeriod);
    });
  }

  // -------------------------------------------------------------------------
  // Drain
  // -------------------------------------------------------------------------

  private async drainPendingOperations(): Promise<void> {
    const deadline = Date.now() + this.shutdownGracePeriod;

    while (this.pendingOperations > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // If operations still pending after deadline, force drain
    if (this.pendingOperations > 0) {
      this.emit('warning', `Force draining ${this.pendingOperations} pending operations`);
      this.pendingOperations = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Signal Handling
  // -------------------------------------------------------------------------

  private registerSignalHandlers(): void {
    process.on('SIGTERM', this.handleShutdownSignal);
    process.on('SIGINT', this.handleShutdownSignal);
    process.on('SIGHUP', this.handleReloadSignal);
  }

  private unregisterSignalHandlers(): void {
    process.off('SIGTERM', this.handleShutdownSignal);
    process.off('SIGINT', this.handleShutdownSignal);
    process.off('SIGHUP', this.handleReloadSignal);
  }

  private handleShutdownSignal = async (): Promise<void> => {
    this.emit('signal', 'SIGTERM');
    try {
      await this.stop();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };

  private handleReloadSignal = (): void => {
    this.emit('signal', 'SIGHUP');
    this.emit('config-reload');
  };
}
