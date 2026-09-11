// @code-analyzer/server — GraphQL Yoga Server
// Creates a Yoga GraphQL server that integrates with the existing Fastify HTTP server.
// Provides /graphql endpoint with GraphiQL playground in development mode.

import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import type { GraphQLContext } from './context.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { ServerConfig } from '../server-config.js';

/**
 * Options for creating the GraphQL Yoga server.
 */
export interface GraphQLServerOptions {
  /** The in-memory graph store shared across the application */
  store: InMemoryGraphStore;
  /** Server configuration */
  config: ServerConfig;
  /** Server start time for health/uptime metrics */
  startTime: number;
}

/**
 * Create a Yoga GraphQL server instance configured for the code-analyzer platform.
 *
 * Provides:
 * - GraphQL endpoint at `/graphql`
 * - GraphiQL playground in non-production environments
 * - Request-scoped context with store/config/startTime
 *
 * Attach it to Fastify with {@link mountGraphQLOnFastify} rather than by hand: the
 * mounting helper rebuilds the request as a WHATWG `Request` and materialises the
 * response body, neither of which the raw node adapter can do once Fastify's
 * content-type parsers have drained the request stream.
 *
 * @example
 * ```ts
 * import { mountGraphQLOnFastify } from './graphql/server.js';
 *
 * mountGraphQLOnFastify(app, { store, config, startTime: Date.now() }, '/api/v1');
 * // Serves GET, POST and OPTIONS on `${apiPrefix}/graphql`.
 * ```
 */
export function createGraphQLServer(options: GraphQLServerOptions) {
  const { store, config, startTime } = options;

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const yoga = createYoga({
    schema,

    // Request-scoped context factory
    context: (): GraphQLContext => ({
      store,
      config,
      startTime,
    }),

    // Enable GraphiQL in non-production environments
    graphiql: process.env['NODE_ENV'] !== 'production',

    // Disable built-in landing page (we use GraphiQL)
    landingPage: false,

    // Mask unexpected errors in production
    maskedErrors: process.env['NODE_ENV'] === 'production',

    // CORS is handled by the existing Fastify middleware
    cors: false,

    // Logging
    logging: config.logging.enabled && config.logging.level !== 'silent' ? 'debug' : false,
  });

  return yoga;
}

/**
 * Build a WHATWG Request for Yoga out of a Fastify request.
 *
 * Fastify's content-type parsers consume the request stream before the route
 * handler runs, so the raw `IncomingMessage` is already drained by then. Handing
 * that drained stream to Yoga's node adapter leaves the adapter waiting for an
 * `end` event that has already fired, which hangs the request forever. The parsed
 * payload is re-serialised here so Yoga receives a self-contained body.
 */
function toYogaRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }

  const method = req.method.toUpperCase();
  return new Request(new URL(req.url, `http://${req.headers.host ?? 'localhost'}`), {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
  });
}

/**
 * Register the GraphQL Yoga server on a Fastify instance.
 * Mounts the /graphql endpoint for GET, POST, and OPTIONS methods.
 */
export function mountGraphQLOnFastify(
  app: any,
  options: GraphQLServerOptions,
  apiPrefix: string,
): void {
  const yoga = createGraphQLServer(options);
  const endpoint = `${apiPrefix}/graphql`;

  app.route({
    url: endpoint,
    method: ['GET', 'POST', 'OPTIONS'],
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const response = await yoga.fetch(toYogaRequest(req));

      // Copy response headers, except the framing ones: Fastify derives those from
      // the body materialised below, and a stale content-length would truncate it.
      for (const [key, value] of response.headers.entries()) {
        const name = key.toLowerCase();
        if (name === 'content-length' || name === 'transfer-encoding') continue;
        reply.header(key, value);
      }

      // `response.body` is a web ReadableStream, which Fastify cannot serialise.
      reply.status(response.status).send(await response.text());
    },
  });

  if (options.config.logging.enabled && options.config.logging.level !== 'silent') {
    console.log(
      `[code-analyzer] GraphQL: http://${options.config.host}:${options.config.port}${endpoint}`,
    );
  }
}
