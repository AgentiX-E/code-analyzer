// @code-analyzer/server — GraphQL Context
// Per-request context factory for GraphQL resolvers.
// Provides access to the graph store, analysis engine, and server configuration.

import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { ServerConfig } from '../server-config.js';

/**
 * GraphQL context — injected into every resolver via the third argument.
 * Holds shared resources that resolvers need to query data.
 */
export interface GraphQLContext {
  /** The in-memory graph store */
  store: InMemoryGraphStore;
  /** Server configuration */
  config: ServerConfig;
  /** Server start time (for health/uptime) */
  startTime: number;
}

/**
 * Create a GraphQL context for a request.
 * Returns a fresh context with shared store and config references.
 */
/* v8 ignore next 3 */ // Context factory tested via Yoga integration tests
export function createGraphQLContext(
  store: InMemoryGraphStore,
  config: ServerConfig,
  startTime: number,
): GraphQLContext {
  return { store, config, startTime };
}

/**
 * Create a minimal context for testing — accepts a store instance directly.
 * Tests should create their own InMemoryGraphStore and pass it here.
 */
export function createTestContext(store?: InMemoryGraphStore): GraphQLContext {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { InMemoryGraphStore } = require('@code-analyzer/infra') as {
    InMemoryGraphStore: new () => InMemoryGraphStore;
  };
  const storeInstance = store ?? new InMemoryGraphStore();
  return {
    store: storeInstance,
    config: {
      host: '0.0.0.0',
      port: 3000,
      apiPrefix: '/api/v1',
      cors: {
        origin: '*',
        methods: [],
        allowedHeaders: [],
        exposedHeaders: [],
        credentials: false,
        maxAge: 0,
      },
      auth: { enabled: false, apiKeys: [], headerName: '' },
      logging: { enabled: false, level: 'silent', includeBody: false, pretty: false },
      metadata: { name: 'test', version: '0.0.0', environment: 'test' },
      rateLimit: { enabled: false, windowMs: 60000, maxRequests: 100, addHeaders: false },
      mtls: {
        enabled: false,
        caCerts: [],
        requireCert: false,
        skipHealthEndpoints: true,
        failureMode: 'reject',
      },
      maxBodySize: 1048576,
      keepAliveTimeout: 61000,
      sseHeartbeatMs: 15000,
      maxConnections: 0,
    },
    startTime: Date.now(),
  };
}
