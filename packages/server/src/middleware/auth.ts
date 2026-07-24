// @code-analyzer/server — Auth Middleware
// API key-based authentication for protected routes.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../server-config.js';

/**
 * Register authentication middleware on a Fastify instance.
 * When enabled, validates x-api-key or Authorization header against allowed keys.
 */
export function registerAuth(app: FastifyInstance, config: AuthConfig): void {
  if (!config.enabled) return;

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health and OPTIONS
    const url = request.url;
    if (url.startsWith('/health') || url === '/api/v1/health' || request.method === 'OPTIONS') {
      return;
    }

    const apiKey = extractApiKey(request, config.headerName);
    if (!apiKey) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: `Missing authentication. Provide '${config.headerName}' header.`,
      });
    }

    if (!config.apiKeys.includes(apiKey)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Invalid API key.',
      });
    }
  });
}

/**
 * Extract API key from request headers.
 * Checks custom header first, then Authorization Bearer token.
 */
function extractApiKey(request: FastifyRequest, headerName: string): string | null {
  // Check custom header
  const customKey = request.headers[headerName];
  if (typeof customKey === 'string' && customKey.length > 0) {
    return customKey;
  }

  // Check Authorization: Bearer <key>
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  return null;
}
