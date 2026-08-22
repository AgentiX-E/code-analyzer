// @code-analyzer/server — GraphQL Yoga Server
// Creates a Yoga GraphQL server that integrates with the existing Fastify HTTP server.
// Provides /graphql endpoint with GraphiQL playground in development mode.

import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
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
 * @example
 * ```ts
 * import { createGraphQLServer } from './graphql/server.js';
 * const yoga = createGraphQLServer({ store, config, startTime: Date.now() });
 * // Mount on Fastify:
 * app.route({ url: '/graphql', method: ['GET', 'POST', 'OPTIONS'], handler: async (req, reply) => {
 *   const response = await yoga.handleNodeRequestAndResponse(req, reply);
 *   response.headers.forEach((value, key) => reply.header(key, value));
 *   reply.status(response.status).send(response.body);
 * }});
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
    handler: async (req: any, reply: any) => {
      // Yoga v5 uses the node Request/Response pair
      const response = await yoga.handleNodeRequestAndResponse(req.raw || req, reply.raw || reply);

      // Copy response headers
      for (const [key, value] of response.headers.entries()) {
        reply.header(key, value);
      }

      reply.status(response.status).send(response.body);
    },
  });

  if (options.config.logging.enabled && options.config.logging.level !== 'silent') {
    console.log(
      `[code-analyzer] GraphQL: http://${options.config.host}:${options.config.port}${endpoint}`,
    );
  }
}
