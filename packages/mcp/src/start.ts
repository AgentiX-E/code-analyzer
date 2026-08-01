// @code-analyzer/mcp — MCP Server Entry Point
// Starts the MCP (Model Context Protocol) server for integration with AI agents.
//
// Usage:
//   node packages/mcp/dist/start.js
//   MCP_TRANSPORT=stdio node packages/mcp/dist/start.js
//
// Environment variables:
//   MCP_TRANSPORT  — Transport mode: stdio or sse (default: sse)
//   MCP_PORT       — Port for SSE transport (default: 3000)
//   MCP_HOST       — Bind address (default: 0.0.0.0)
//   MCP_API_KEY    — API key for authentication (optional)
//   LOG_LEVEL      — Log level: debug, info, warn, error (default: info)

import { CodeAnalyzerMCPServer } from './server/mcp-server.js';

// ---------------------------------------------------------------------------
// Signal handling for graceful shutdown
// ---------------------------------------------------------------------------

let mcpServer: CodeAnalyzerMCPServer | null = null;

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[mcp] Received ${signal}, shutting down gracefully...`);

  if (mcpServer) {
    try {
      await mcpServer.stop();
      console.log('[mcp] MCP server stopped.');
    } catch (err) {
      console.error('[mcp] Error during shutdown:', err);
      process.exit(1);
    }
  }

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGHUP', () => void shutdown('SIGHUP'));

process.on('unhandledRejection', (reason) => {
  console.error('[mcp] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[mcp] Uncaught exception:', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = (process.env['MCP_TRANSPORT'] ?? 'sse') as 'stdio' | 'sse';
  const port = parseInt(process.env['MCP_PORT'] ?? '3000', 10);
  const host = process.env['MCP_HOST'] ?? '0.0.0.0';

  console.log('[mcp] Starting Code Analyzer MCP Server...');
  console.log(`[mcp] Transport: ${transport}`);
  if (transport === 'sse') {
    console.log(`[mcp] Listening on http://${host}:${port}`);
  }

  mcpServer = new CodeAnalyzerMCPServer();

  await mcpServer.start({ transport, port, host });

  console.log('[mcp] Ready. Waiting for client connections...');
}

main().catch((err) => {
  console.error('[mcp] Fatal startup error:', err);
  process.exit(1);
});
