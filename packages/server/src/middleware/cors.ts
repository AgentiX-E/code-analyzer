// @code-analyzer/server — CORS Middleware
// Configurable Cross-Origin Resource Sharing handling.

import type { CorsConfig } from '../server-config.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Register CORS middleware on a Fastify instance.
 * Handles preflight OPTIONS requests and sets CORS headers on all responses.
 */
export function registerCors(app: FastifyInstance, config: CorsConfig): void {
  // **`*` and `credentials` are not two settings that happen to be set together; together they are one defect.** A
  // wildcard allowlist answers with the origin the request named, and `Access-Control-Allow-Credentials: true` then tells
  // the browser that any site may *read* an authenticated response. Refused at registration so the server does not start
  // with a configuration whose effect is worse than the outage. `*` alone stays supported, because a wildcard without
  // credentials discloses nothing the anonymous internet did not already have.
  if (config.credentials && allowsEveryOrigin(config.origin)) {
    throw new Error(
      "CORS: credentials with a '*' origin lets any site read authenticated responses; list the origins instead",
    );
  }

  // Add CORS headers hook for all routes
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestOrigin = request.headers.origin;
    if (!requestOrigin && config.origin !== '*') return;

    // Determine allowed origin
    const allowedOrigin = resolveAllowedOrigin(requestOrigin, config.origin, config.credentials);
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

/** Whether the allowlist names every origin. */
function allowsEveryOrigin(allowed: string | string[]): boolean {
  return allowed === '*' || (Array.isArray(allowed) && allowed.includes('*'));
}

/**
 * Resolve whether an origin is allowed and return the appropriate header value.
 *
 * **The value returned is never the request's, and that is the point.** Every branch answers with a string that came from
 * the configuration - the wildcard itself, or the allowlist entry that matched - so the header cannot carry anything the
 * request chose. Equality is what decides, and the answer is the entry that was equal. With `credentials` a wildcard
 * answers nothing and the request's origin falls through to an exact match; `null` is a refusal the caller writes no
 * header for.
 */
function resolveAllowedOrigin(
  requestOrigin: string | undefined,
  allowed: string | string[],
  credentials: boolean,
): string | null {
  if (allowed === '*') return credentials ? null : '*';
  if (!requestOrigin) return null;

  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  const matched = allowedList.find((entry) => entry === requestOrigin);
  if (matched !== undefined) return matched;
  return !credentials && allowedList.includes('*') ? '*' : null;
}

/** Exported for testing */
export { allowsEveryOrigin, resolveAllowedOrigin };
