// @code-analyzer/server — Logging Middleware
// Structured request/response logging with configurable detail levels.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LoggingConfig } from '../server-config.js';

const LEVEL_PRIORITY: Record<string, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/**
 * Register request logging middleware.
 * Logs method, URL, status code, response time, and optionally request body.
 */
export function registerLogging(app: FastifyInstance, config: LoggingConfig): void {
  if (!config.enabled) return;

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Attach start time for response-time calculation
    (request as unknown as Record<string, unknown>)['_startTime'] = Date.now();
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = (request as unknown as Record<string, unknown>)['_startTime'] as number;
    const responseTime = startTime ? Date.now() - startTime : -1;

    const logEntry = {
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTimeMs: responseTime,
      remoteAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? 'unknown',
      ...(config.includeBody && request.body
        ? { bodySize: JSON.stringify(request.body).length }
        : {}),
    };

    if (config.pretty) {
      logPretty(logEntry, config.level);
    } else {
      logStructured(logEntry, config.level, reply.statusCode);
    }
  });
}

function logStructured(
  entry: Record<string, unknown>,
  level: string,
  statusCode: number,
): void {
  if (!shouldLog(level, statusCode)) return;

  const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  if (logLevel === 'error') {
    console.error(JSON.stringify({ level: logLevel, ...entry }));
  } else if (logLevel === 'warn') {
    console.warn(JSON.stringify({ level: logLevel, ...entry }));
  } else {
    console.log(JSON.stringify({ level: logLevel, ...entry }));
  }
}

function logPretty(entry: Record<string, unknown>, level: string): void {
  const statusCode = entry['statusCode'] as number;
  if (!shouldLog(level, statusCode)) return;

  const statusColor = statusCode >= 500 ? '\x1b[31m' : statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
  console.log(
    `${entry['timestamp']} ${entry['method']} ${entry['url']} ${statusColor}${statusCode}\x1b[0m ${entry['responseTimeMs']}ms`,
  );
}

function shouldLog(configLevel: string, statusCode: number): boolean {
  if (configLevel === 'silent') return false;
  if (configLevel === 'debug') return true;

  const minPriority = LEVEL_PRIORITY[configLevel] ?? 3;
  const msgPriority = statusCode >= 500 ? 1 : statusCode >= 400 ? 2 : 3;
  return msgPriority <= minPriority;
}

/** Exported for testing */
export { shouldLog, logPretty, logStructured };
