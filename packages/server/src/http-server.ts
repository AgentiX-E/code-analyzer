// @code-analyzer/server — HTTP Server
// Assembles the Fastify server with all middleware and routes.
// Integrates GracefulShutdown, HealthCheckRegistry, rate limiting,
// and max connection limits for production readiness.

import { GracefulShutdown, HealthCheckRegistry } from '@code-analyzer/core';
import Fastify from 'fastify';

import { registerAuth } from './middleware/auth.js';
import { registerCors } from './middleware/cors.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerLogging } from './middleware/logging.js';
import { registerMtls } from './middleware/mtls.js';
import { registerRateLimit } from './middleware/rate-limit.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSSERoutes } from './routes/sse.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerWebhookRoutes } from './routes/webhook.js';
import { resolveConfig } from './server-config.js';

import type { WebhookConfig } from './routes/webhook.js';
import type { DeepPartial, ServerConfig } from './server-config.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { ToolRegistry } from '@code-analyzer/mcp';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ServerOptions {
  /**
   * Server configuration. Deep-merged with the defaults by `resolveConfig`, so any level of it may be
   * partial — `Partial<ServerConfig>` said otherwise and rejected `{ logging: { enabled: false } }`.
   */
  config?: DeepPartial<ServerConfig>;
  /** MCP ToolRegistry instance */
  registry: ToolRegistry;
  /** Custom Fastify plugins to register */
  plugins?: Array<{
    plugin: any;
    opts?: Record<string, unknown>;
  }>;
  /** Health check registry (creates default if not provided) */
  healthCheck?: HealthCheckRegistry;
  /** GitHub webhook configuration for cross-repo PR review */
  webhook?: WebhookConfig;
  /** InMemoryGraphStore for graph visualization endpoint */
  graphStore?: InMemoryGraphStore;
  /** Enable the GraphQL API endpoint at /api/v1/graphql */
  graphql?: boolean;
}

export interface ServerInstance {
  /** The underlying Fastify instance */
  app: any;
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
 * How long a shutdown waits for the requests already running, and how often it asks.
 *
 * **Two numbers rather than one timer with a fallback**: a request that finishes is noticed within a poll interval,
 * and a request that never finishes is given up on at the deadline. Both ends are the same loop, so neither can leave
 * a timer behind.
 */
const SHUTDOWN_GRACE_MS = 5_000;
const SHUTDOWN_POLL_MS = 100;

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
  registerMtls(app, config.mtls);
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

  // Register webhook endpoint if configured
  if (options.webhook) {
    registerWebhookRoutes(app, config, options.webhook);
  }

  // Register graph visualization endpoint if store is provided
  if (options.graphStore) {
    registerGraphRoutes(app, config, () => options.graphStore!);
  }

  // Register GraphQL endpoint if enabled and store is available
  if (options.graphql && options.graphStore) {
    const { mountGraphQLOnFastify } = await import('./graphql/server.js');
    const startTime = Date.now();
    mountGraphQLOnFastify(
      app,
      {
        store: options.graphStore,
        config,
        startTime,
      },
      config.apiPrefix,
    );
  }

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
      // **A request that is already running gets five seconds to finish, and the wait ends whichever way it ends.**
      // The first version raced two timers - an interval that resolved when the count reached zero and a timeout
      // that resolved anyway - and the timeout was never cleared, so a clean drain left a five-second handle on the
      // event loop and the arm that fires when a request *doesn't* finish was a callback nothing could reach. One
      // deadline states both facts: the loop exits when the connections drain, and it exits when the time is up.
      const deadline = Date.now() + SHUTDOWN_GRACE_MS;
      while (activeConnections > 0 && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_POLL_MS));
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
