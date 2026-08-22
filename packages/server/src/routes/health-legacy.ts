// @code-analyzer/server — Legacy Health Helpers
// Kept for backward compatibility with tests that import buildHealthResponse directly.

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

function buildHealthResponse(config: ServerConfig, startTime: number): HealthResponse {
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
