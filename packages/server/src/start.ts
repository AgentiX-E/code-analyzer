// @code-analyzer/server — Server Entry Point
// Starts the HTTP REST API server. This is the executable entry point for
// Docker containers and standalone deployments.
//
// Usage:
//   node packages/server/dist/start.js
//   PORT=3001 node packages/server/dist/start.js
//
// Environment variables:
//   PORT           — HTTP port (default: 3000)
//   HOST           — Bind address (default: 0.0.0.0)
//   LOG_LEVEL      — Log level: debug, info, warn, error (default: info)
//   SERVER_API_KEY — API key for authentication (optional)
//   NODE_ENV       — Environment: development, production

import { createServer } from './http-server.js';
import type { ServerInstance, ServerOptions } from './http-server.js';
import { ToolRegistry } from '@code-analyzer/mcp';

// ---------------------------------------------------------------------------
// Signal handling for graceful shutdown
// ---------------------------------------------------------------------------

let server: ServerInstance | null = null;

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[server] Received ${signal}, shutting down gracefully...`);

  if (server) {
    try {
      await server.stop();
      console.log('[server] Server stopped.');
    } catch (err) {
      console.error('[server] Error during shutdown:', err);
      process.exit(1);
    }
  }

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGHUP', () => void shutdown('SIGHUP'));

// ---------------------------------------------------------------------------
// Unhandled rejection/exception safety net
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const logLevel = process.env['LOG_LEVEL'] ?? 'info';

  console.log('[server] Starting Code Analyzer Server...');
  console.log(`[server] Listening on http://${host}:${port}`);
  console.log(`[server] Environment: ${process.env['NODE_ENV'] ?? 'development'}`);

  // Create a minimal tool registry for the HTTP server
  const registry = new ToolRegistry();

  const options: ServerOptions = {
    config: {
      host,
      port,
    },
    registry,
  };

  server = await createServer(options);
  await server.start();

  console.log(`[server] Ready. Log level: ${logLevel}`);
}

main().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
