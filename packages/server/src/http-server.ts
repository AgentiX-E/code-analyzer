// @code-analyzer/server — HTTP Server
// Assembles the Fastify server with all middleware and routes.

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { resolveConfig } from './server-config.js';
import type { ServerConfig } from './server-config.js';
import { registerCors } from './middleware/cors.js';
import { registerAuth } from './middleware/auth.js';
import { registerLogging } from './middleware/logging.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerSSERoutes } from './routes/sse.js';
import type { ToolRegistry } from '@code-analyzer/mcp';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ServerOptions {
  /** Server configuration (merged with defaults) */
  config?: Partial<ServerConfig>;
  /** MCP ToolRegistry instance */
  registry: ToolRegistry;
  /** Custom Fastify plugins to register */
  plugins?: Array<{
    plugin: Parameters<FastifyInstance['register']>[0];
    opts?: Record<string, unknown>;
  }>;
}

export interface ServerInstance {
  /** The underlying Fastify instance */
  app: FastifyInstance;
  /** Start listening */
  start(): Promise<void>;
  /** Graceful shutdown */
  stop(): Promise<void>;
  /** Current server configuration */
  config: ServerConfig;
}

/**
 * Create and configure an HTTP + SSE server wrapping the MCP ToolRegistry.
 *
 * @example
 * ```ts
 * import { createToolRegistry } from '@code-analyzer/mcp';
 * const registry = createToolRegistry();
 * const server = createServer({ registry });
 * await server.start();
 * ```
 */
export async function createServer(options: ServerOptions): Promise<ServerInstance> {
  const config = resolveConfig(options.config);

  const app = Fastify({
    logger: false, // We handle logging via our middleware
    maxParamLength: 500,
    bodyLimit: config.maxBodySize,
    keepAliveTimeout: config.keepAliveTimeout,
    requestIdHeader: 'x-request-id',
    genReqId: () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  });

  // --- Middleware Pipeline ---
  registerCors(app, config.cors);
  registerAuth(app, config.auth);
  registerLogging(app, config.logging);
  registerErrorHandler(app);

  // --- Custom Plugins ---
  if (options.plugins) {
    for (const { plugin, opts } of options.plugins) {
      await app.register(plugin, opts ?? {});
    }
  }

  // --- Routes ---
  registerHealthRoutes(app, config);
  registerToolRoutes(app, config, () => options.registry);
  registerSSERoutes(app, config, () => options.registry);

  // --- Lifecycle ---
  await app.ready();

  const start = async (): Promise<void> => {
    await app.listen({ host: config.host, port: config.port });
    if (config.logging.enabled && config.logging.level !== 'silent') {
      const mode = config.auth.enabled ? 'authenticated' : 'open';
      console.log(
        `[code-analyzer] Server listening on http://${config.host}:${config.port} (${mode})`,
      );
      console.log(
        `[code-analyzer] Health: http://${config.host}:${config.port}${config.apiPrefix}/health`,
      );
      console.log(
        `[code-analyzer] Tools:  http://${config.host}:${config.port}${config.apiPrefix}/tools/list`,
      );
    }
  };

  const stop = async (): Promise<void> => {
    await app.close();
  };

  return { app, config, start, stop };
}
