// @code-analyzer/server — HTTP Server
// Assembles the Fastify server with all middleware and routes.
// Integrates GracefulShutdown, HealthCheckRegistry, rate limiting,
// and max connection limits for production readiness.

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { resolveConfig } from './server-config.js';
import type { ServerConfig } from './server-config.js';
import { registerCors } from './middleware/cors.js';
import { registerAuth } from './middleware/auth.js';
import { registerLogging } from './middleware/logging.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerRateLimit } from './middleware/rate-limit.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerSSERoutes } from './routes/sse.js';
import { GracefulShutdown, HealthCheckRegistry } from '@code-analyzer/core';
import type { ShutdownResult, HealthReport } from '@code-analyzer/core';
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
  /** Health check registry (creates default if not provided) */
  healthCheck?: HealthCheckRegistry;
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
  /** Health check registry */
  health: HealthCheckRegistry;
  /** Graceful shutdown manager */
  shutdown: GracefulShutdown;
  /** Active connection counter */
  readonly activeConnections: number;
}

/**
 * Create and configure an HTTP + SSE server wrapping the MCP ToolRegistry.
 *
 * Integrates production-grade features:
 * - Graceful shutdown with handler priorities and timeouts
 * - Health check registry (memory, disk, store, worker pool)
 * - Sliding-window rate limiting
 * - Max connection limits
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

  // Track active connections for graceful shutdown
  let activeConnections = 0;

  const app = Fastify({
    logger: false, // We handle logging via our middleware
    maxParamLength: 500,
    bodyLimit: config.maxBodySize,
    keepAliveTimeout: config.keepAliveTimeout,
    requestIdHeader: 'x-request-id',
    genReqId: () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    maxConnections: config.maxConnections > 0 ? config.maxConnections : undefined,
  });

  // --- Connection tracking ---
  app.addHook('onRequest', async (_request, _reply) => {
    activeConnections++;
  });
  app.addHook('onResponse', async (_request, _reply) => {
    activeConnections--;
  });

  // --- Middleware Pipeline ---
  registerCors(app, config.cors);
  registerAuth(app, config.auth);
  registerLogging(app, config.logging);
  registerRateLimit(app, config.rateLimit);
  registerErrorHandler(app);

  // --- Custom Plugins ---
  if (options.plugins) {
    for (const { plugin, opts } of options.plugins) {
      await app.register(plugin, opts ?? {});
    }
  }

  // --- Routes ---
  const healthRegistry = options.healthCheck ?? HealthCheckRegistry.createDefault();
  registerHealthRoutes(app, config, healthRegistry);
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

  const shutdown = new GracefulShutdown({
    signals: ['SIGTERM', 'SIGINT'],
    shutdownTimeout: 30_000,
    forceExitTimeout: 5_000,
  });

  // Register server close as a shutdown handler
  shutdown.register({
    name: 'http-server',
    priority: 100,
    timeout: 10_000,
    shutdown: async () => {
      // Give in-flight requests time to complete
      if (activeConnections > 0) {
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (activeConnections <= 0) {
              clearInterval(check);
              resolve();
            }
          }, 100);
          // Force resolve after 5s
          setTimeout(() => {
            clearInterval(check);
            resolve();
          }, 5_000);
        });
      }
      await app.close();
    },
  });

  shutdown.listen();

  // Prevent MaxListenersExceededWarning in test environments
  // where many server instances may be created
  if (process.env['NODE_ENV'] === 'test' || process.env['VITEST']) {
    process.setMaxListeners(50);
  }

  const stop = async (): Promise<void> => {
    const result = await shutdown.shutdown('SIGTERM', true);
    if (!result.success) {
      const failed = result.handlers.filter((h) => !h.success);
      console.error('[code-analyzer] Shutdown errors:', failed.map((h) => h.error).join(', '));
    }
  };

  return {
    app,
    config,
    start,
    stop,
    health: healthRegistry,
    shutdown,
    get activeConnections() {
      return activeConnections;
    },
  };
}
