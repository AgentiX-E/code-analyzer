// @code-analyzer/server — Health Routes
// Health check, readiness, and liveness endpoints.
// Integrates with HealthCheckRegistry for comprehensive health monitoring.

import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../server-config.js';
import type { HealthCheckRegistry } from '@code-analyzer/core';

/**
 * Register health check routes.
 * GET /health — overall health status
 * GET {prefix}/health — full health status from registry
 * GET {prefix}/health/live — liveness probe (always 200 if process alive)
 * GET {prefix}/health/ready — readiness probe (200 if all critical checks pass)
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  healthRegistry: HealthCheckRegistry,
): void {
  // Liveness — always OK if the process is running
  app.get(`${config.apiPrefix}/health/live`, async (_req, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  // Health alias at root-level for simplicity
  app.get('/health', { config: { skipAuth: true } }, async (_req, reply) => {
    const health = await healthRegistry.runAll();
    return reply.status(200).send(health);
  });

  // Full health check via registry
  app.get(`${config.apiPrefix}/health`, async (_req, reply) => {
    const health = await healthRegistry.runAll();
    return reply.status(200).send(health);
  });

  // Readiness — server is accepting requests and all critical checks pass
  app.get(`${config.apiPrefix}/health/ready`, async (_req, reply) => {
    const ready = await healthRegistry.readiness();
    const health = await healthRegistry.runAll();
    const statusCode = ready ? 200 : 503;
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

// Keep backward-compatible exports
export { buildHealthResponse } from './health-legacy.js';
