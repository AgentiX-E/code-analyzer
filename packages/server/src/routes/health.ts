// @code-analyzer/server — Health Routes
// Health check, readiness, and liveness endpoints.

import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../server-config.js';

/** Detailed health status response. */
interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  name: string;
  environment: string;
  checks: {
    server: { status: 'ok'; uptime: number };
    memory: { status: 'ok' | 'warn'; heapUsedMB: number; heapTotalMB: number; rssMB: number };
  };
}

/**
 * Register health check routes.
 * GET /health — overall health status
 * GET /health/live — liveness probe (always 200)
 * GET /health/ready — readiness probe (200 when server is accepting connections)
 */
export function registerHealthRoutes(app: FastifyInstance, config: ServerConfig): void {
  const startTime = Date.now();

  // Liveness — always OK if the process is running
  app.get(`${config.apiPrefix}/health/live`, async (_req, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  // Health alias at root-level for simplicity
  app.get('/health', { config: { skipAuth: true } }, async (_req, reply) => {
    return reply.status(200).send(buildHealthResponse(config, startTime));
  });

  // Full health check
  app.get(`${config.apiPrefix}/health`, async (_req, reply) => {
    return reply.status(200).send(buildHealthResponse(config, startTime));
  });

  // Readiness — server is accepting requests
  app.get(`${config.apiPrefix}/health/ready`, async (_req, reply) => {
    const health = buildHealthResponse(config, startTime);
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    return reply.status(statusCode).send(health);
  });

  // Root endpoint returns basic info
  app.get('/', async (_req, reply) => {
    return reply.status(200).send({
      service: config.metadata.name,
      version: config.metadata.version,
      docs: `${config.apiPrefix}/tools/list`,
      health: `${config.apiPrefix}/health`,
    });
  });
}

function buildHealthResponse(
  config: ServerConfig,
  startTime: number,
): HealthResponse {
  const uptime = Date.now() - startTime;
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);

  return {
    status: heapUsedMB > heapTotalMB * 0.9 ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    uptime,
    version: config.metadata.version,
    name: config.metadata.name,
    environment: config.metadata.environment,
    checks: {
      server: { status: 'ok', uptime },
      memory: {
        status: heapUsedMB > heapTotalMB * 0.9 ? 'warn' : 'ok',
        heapUsedMB,
        heapTotalMB,
        rssMB,
      },
    },
  };
}

/** Exported for testing */
export { buildHealthResponse };
