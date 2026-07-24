// @code-analyzer/server — CORS Middleware
// Configurable Cross-Origin Resource Sharing handling.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CorsConfig } from '../server-config.js';

/**
 * Register CORS middleware on a Fastify instance.
 * Handles preflight OPTIONS requests and sets CORS headers on all responses.
 */
export function registerCors(app: FastifyInstance, config: CorsConfig): void {
  // Add CORS headers hook for all routes
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestOrigin = request.headers.origin;
    if (!requestOrigin && config.origin !== '*') return;

    // Determine allowed origin
    const allowedOrigin = resolveAllowedOrigin(requestOrigin, config.origin);
    if (allowedOrigin) {
      void reply.header('Access-Control-Allow-Origin', allowedOrigin);
    }

    if (config.credentials) {
      void reply.header('Access-Control-Allow-Credentials', 'true');
    }
  });

  // Add response headers
  app.addHook('onSend', async (_request: FastifyRequest, reply: FastifyReply) => {
    void reply.header('Access-Control-Allow-Methods', config.methods.join(', '));
    void reply.header('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
    void reply.header('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
    void reply.header('Access-Control-Max-Age', String(config.maxAge));
    void reply.header('Vary', 'Origin');
  });

  // Handle OPTIONS preflight
  app.options('*', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(204).send();
  });
}

/**
 * Resolve whether an origin is allowed and return the appropriate header value.
 */
function resolveAllowedOrigin(
  requestOrigin: string | undefined,
  allowed: string | string[],
): string | null {
  if (allowed === '*') return '*';
  if (!requestOrigin) return null;

  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  if (allowedList.includes('*') || allowedList.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}
